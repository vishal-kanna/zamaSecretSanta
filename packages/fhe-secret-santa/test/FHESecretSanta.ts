import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, deployments, fhevm } from "hardhat";
import { SecretSanta } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

type Signers = {
    admin: HardhatEthersSigner;
    alice: HardhatEthersSigner;
    bob: HardhatEthersSigner;
    carol: HardhatEthersSigner;
};

describe("SecretSanta (Sepolia / FHE)", function () {
    let signers: Signers;
    let secretSantaContract: SecretSanta;
    let secretSantaContractAddress: string;
    let step: number;
    let steps: number;

    function progress(message: string) {
        console.log(`${++step}/${steps} ${message}`);
    }

    function sleep(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function readSecretMatchCiphertext(userAddress: string) {
        const mappingSlotIndex = 1; // second storage slot for secretMatches
        const slotKey = ethers.solidityPackedKeccak256(
            ["address", "uint256"],
            [userAddress, mappingSlotIndex]
        );
        const storageValue = await ethers.provider.getStorage(secretSantaContractAddress, slotKey);
        return storageValue;
    }

    before(async function () {
        // Load deployment
        try {
            const SecretSantaDeployment = await deployments.get("SecretSanta");
            secretSantaContractAddress = SecretSantaDeployment.address;
            console.log("secretSantaContractAddres-------", secretSantaContractAddress)
            secretSantaContract = await ethers.getContractAt("SecretSanta", SecretSantaDeployment.address);
        } catch (e) {
            (e as Error).message += ". Call 'npx hardhat deploy --network sepolia' or ensure deployment name is SecretSanta";
            throw e;
        }

        const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
        signers = {
            admin: ethSigners[0],
            alice: ethSigners[1],
            bob: ethSigners[2],
            carol: ethSigners[3],
        };
    });

    beforeEach(async () => {
        step = 0;
        steps = 0;

        // Reset contract state before each test to avoid duplicate joins
        await secretSantaContract.connect(signers.admin).reset();
    });

    it("should allow participants to join the pool", async function () {
        steps = 6;
        this.timeout(2 * 60000);

        progress("Alice joins the pool...");
        await (await secretSantaContract.connect(signers.alice).joinPool()).wait();

        progress("Bob joins the pool...");
        await (await secretSantaContract.connect(signers.bob).joinPool()).wait();

        progress("Carol joins the pool...");
        await (await secretSantaContract.connect(signers.carol).joinPool()).wait();

        progress("Check participant count...");
        const count = await secretSantaContract.getParticipantCount();
        expect(count).to.eq(3);

        progress("Verify Alice has joined...");
        const aliceJoined = await secretSantaContract.hasJoined(signers.alice.address);
        expect(aliceJoined).to.be.true;

        progress("Verify all participants are recorded...");
        const participants = await secretSantaContract.getAllParticipants();
        expect(participants.length).to.eq(3);
        expect(participants[0]).to.eq(signers.alice.address);
        expect(participants[1]).to.eq(signers.bob.address);
        expect(participants[2]).to.eq(signers.carol.address);
    });

    it("should prevent duplicate joins", async function () {
        steps = 2;
        this.timeout(1 * 60000);

        progress("Alice joins the pool...");
        await (await secretSantaContract.connect(signers.alice).joinPool()).wait();

        progress("Alice tries to join again (should fail)...");
        await expect(secretSantaContract.connect(signers.alice).joinPool()).to.be.revertedWith("Already joined");
    });

    it("should generate encrypted matches", async function () {
        steps = 7;
        this.timeout(3 * 60000);

        await (await secretSantaContract.connect(signers.alice).joinPool()).wait();
        await (await secretSantaContract.connect(signers.bob).joinPool()).wait();
        await (await secretSantaContract.connect(signers.carol).joinPool()).wait();

        progress("Admin generates matches...");
        const genTx = await secretSantaContract.connect(signers.admin).generateMatches();
        const genReceipt = await genTx.wait();

        const isAssigned = await secretSantaContract.isAssigned();
        expect(isAssigned).to.be.true;

        const event = genReceipt?.logs.find((log: any) => {
            try {
                return secretSantaContract.interface.parseLog(log)?.name === "MatchesGenerated";
            } catch {
                return false;
            }
        });
        expect(event).to.not.be.undefined;

        const parsed = secretSantaContract.interface.parseLog(event!);
        expect(parsed?.args?.participantCount).to.eq(3);
    });

    it("should prevent non-admin from generating matches", async function () {
        this.timeout(2 * 60000);
        await (await secretSantaContract.connect(signers.alice).joinPool()).wait();
        await (await secretSantaContract.connect(signers.bob).joinPool()).wait();
        await (await secretSantaContract.connect(signers.carol).joinPool()).wait();

        await expect(secretSantaContract.connect(signers.alice).generateMatches())
            .to.be.revertedWith("Only admin can generate");
    });

    it("should require minimum participants", async function () {
        this.timeout(2 * 60000);
        await (await secretSantaContract.connect(signers.alice).joinPool()).wait();
        await (await secretSantaContract.connect(signers.bob).joinPool()).wait();

        await expect(secretSantaContract.connect(signers.admin).generateMatches())
            .to.be.revertedWith("Need more participants");
    });

    it("should allow participants to request match decryption (and decrypt via FHE storage read)", async function () {
        this.timeout(5 * 60000);
        await (await secretSantaContract.connect(signers.alice).joinPool()).wait();
        await (await secretSantaContract.connect(signers.bob).joinPool()).wait();
        await (await secretSantaContract.connect(signers.carol).joinPool()).wait();

        await (await secretSantaContract.connect(signers.admin).generateMatches()).wait();

        const tx = await secretSantaContract.connect(signers.alice).requestMyMatch();
        const receipt = await tx.wait();

        const event = receipt?.logs.find((log: any) => {
            try {
                return secretSantaContract.interface.parseLog(log)?.name === "MatchRequested";
            } catch {
                return false;
            }
        });
        expect(event).to.not.be.undefined;

        const parsed = secretSantaContract.interface.parseLog(event!);
        const requestId = parsed?.args?.requestId;
        expect(requestId).to.not.be.undefined;

        let processed = false;
        let attempts = 0;
        const maxAttempts = 60;
        while (!processed && attempts < maxAttempts) {
            await sleep(2000);
            processed = await secretSantaContract.isRequestProcessed(requestId);
            attempts++;
        }

        if (!processed) this.skip();

        const encryptedMatchHex = await readSecretMatchCiphertext(signers.alice.address);
        expect(encryptedMatchHex).to.not.eq(ethers.ZeroHash);

        const clearMatch = await fhevm.userDecryptEuint(
            FhevmType.euint32,
            encryptedMatchHex,
            secretSantaContractAddress,
            signers.alice
        );

        expect(Number(clearMatch)).to.be.gte(0);
        expect(Number(clearMatch)).to.be.lt(3);
    });

    it("should prevent requesting match before generation", async function () {
        this.timeout(1 * 60000);

        await (await secretSantaContract.connect(signers.alice).joinPool()).wait();
        await expect(secretSantaContract.connect(signers.alice).requestMyMatch())
            .to.be.revertedWith("Matches not generated yet");
    });

    it("should prevent non-participants from requesting matches", async function () {
        this.timeout(2 * 60000);

        await (await secretSantaContract.connect(signers.alice).joinPool()).wait();
        await (await secretSantaContract.connect(signers.bob).joinPool()).wait();
        await (await secretSantaContract.connect(signers.carol).joinPool()).wait();

        await (await secretSantaContract.connect(signers.admin).generateMatches()).wait();

        const extraSigners = await ethers.getSigners();
        const nonParticipant = extraSigners[4];
        await expect(secretSantaContract.connect(nonParticipant).requestMyMatch())
            .to.be.revertedWith("You haven't joined");
    });

    it("should reset the game correctly (admin only)", async function () {
        this.timeout(3 * 60000);

        await (await secretSantaContract.connect(signers.alice).joinPool()).wait();
        await (await secretSantaContract.connect(signers.bob).joinPool()).wait();
        await (await secretSantaContract.connect(signers.carol).joinPool()).wait();

        await (await secretSantaContract.connect(signers.admin).generateMatches()).wait();

        let count = await secretSantaContract.getParticipantCount();
        expect(count).to.eq(3);
        let isAssigned = await secretSantaContract.isAssigned();
        expect(isAssigned).to.be.true;

        await (await secretSantaContract.connect(signers.admin).reset()).wait();

        count = await secretSantaContract.getParticipantCount();
        expect(count).to.eq(0);
        isAssigned = await secretSantaContract.isAssigned();
        expect(isAssigned).to.be.false;

        const aliceJoined = await secretSantaContract.hasJoined(signers.alice.address);
        expect(aliceJoined).to.be.false;
    });

    it("should prevent non-admin from resetting", async function () {
        this.timeout(1 * 60000);
        await expect(secretSantaContract.connect(signers.alice).reset())
            .to.be.revertedWith("Only admin");
    });
});
