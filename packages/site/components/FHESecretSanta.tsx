"use client";

import React, { useState, useEffect } from "react";
import {
  Gift,
  Users,
  Shuffle,
  Eye,
  EyeOff,
  RefreshCw,
  Sparkles,
  Lock,
  Minimize2,
  X,
} from "lucide-react";
import { useFhevm } from "@fhevm/react";
import { useInMemoryStorage } from "../hooks/useInMemoryStorage";
import { useMetaMaskEthersSigner } from "../hooks/metamask/useMetaMaskEthersSigner";
import { Contract, getAddress } from "ethers";
import { useSecretSanta } from "@/hooks/useFHESeceretSanta";

import { FHESecretSantaABI } from "../abi/FHESecretSanta";

const SecretSantaApp = () => {
  const { storage: fhevmDecryptionSignatureStorage } = useInMemoryStorage();

  const {
    provider,
    chainId,
    accounts,
    isConnected,
    connect,
    ethersSigner,
    ethersReadonlyProvider,
    sameChain,
    sameSigner,
  } = useMetaMaskEthersSigner();

  const { instance: fhevmInstance, status: fhevmStatus } = useFhevm({
    provider,
    chainId,
    enabled: isConnected,
  });

  const fhesecreatsanta = useSecretSanta({
    instance: fhevmInstance,
    fhevmDecryptionSignatureStorage,
    eip1193Provider: provider,
    chainId,
    ethersSigner,
    ethersReadonlyProvider,
    sameChain,
    sameSigner,
  });

  // Contract state
  const [contract, setContract] = useState<Contract | null>(null);
  const [readonlyContract, setReadonlyContract] = useState<Contract | null>(
    null
  );
  const [participants, setParticipants] = useState([]);
  const [hasJoined, setHasJoined] = useState(false);
  const [matchesGenerated, setMatchesGenerated] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [myMatch, setMyMatch] = useState(null);
  const [myMatchAddress, setMyMatchAddress] = useState(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [isDecrypting, setIsDecrypting] = useState(false);

  // NEW: Encrypted match state
  const [encryptedMatchHandle, setEncryptedMatchHandle] = useState(null);
  const [showEncryptedMatch, setShowEncryptedMatch] = useState(false);
  const [revealModalOpen, setRevealModalOpen] = useState(false);
  const [matchRevealed, setMatchRevealed] = useState(false);
  const [matchMinimized, setMatchMinimized] = useState(false);

  // Initialize contracts
  useEffect(() => {
    if (!ethersSigner || !fhesecreatsanta.contractAddress) return;

    const contractInstance = new Contract(
      fhesecreatsanta.contractAddress,
      FHESecretSantaABI.abi,
      ethersSigner
    );

    setContract(contractInstance);
  }, [ethersSigner, fhesecreatsanta.contractAddress]);

  useEffect(() => {
    if (ethersReadonlyProvider && fhesecreatsanta.contractAddress) {
      const readonlyInstance = new Contract(
        fhesecreatsanta.contractAddress,
        FHESecretSantaABI.abi,
        ethersReadonlyProvider
      );
      setReadonlyContract(readonlyInstance);
    }
  }, [ethersReadonlyProvider, fhesecreatsanta.contractAddress]);

  // Load contract state
  useEffect(() => {
    if (readonlyContract && accounts && accounts.length > 0) {
      loadContractState();
    }
  }, [readonlyContract, accounts]);

  const loadContractState = async () => {
    if (!readonlyContract || !accounts || accounts.length === 0) return;

    try {
      const userAddress = accounts[0];
      const [participantsList, userJoined, matchesGen, adminAddress] =
        await Promise.all([
          readonlyContract.getAllParticipants(),
          readonlyContract.hasJoined(userAddress),
          readonlyContract.matchesGenerated(),
          readonlyContract.admin(),
        ]);

      setParticipants(participantsList);
      setHasJoined(userJoined);
      setMatchesGenerated(matchesGen);
      setIsAdmin(adminAddress.toLowerCase() === userAddress.toLowerCase());

      // NEW: Load encrypted match if matches are generated
      if (matchesGen && userJoined) {
        const encryptedMatch = await readonlyContract.matches(userAddress);
        if (
          encryptedMatch &&
          encryptedMatch !==
            "0x0000000000000000000000000000000000000000000000000000000000000000"
        ) {
          setEncryptedMatchHandle(encryptedMatch);
          setShowEncryptedMatch(true);
        }
      }
    } catch (error) {
      console.error("Error loading state:", error);
    }
  };

  const joinPool = async () => {
    if (!contract) return;

    try {
      setLoading(true);
      setStatus("Joining Secret Santa pool...");

      const tx = await contract.joinPool();
      setStatus("Transaction sent! Waiting for confirmation...");

      await tx.wait();
      setStatus("Successfully joined! 🎉");

      await loadContractState();
    } catch (error) {
      console.error("Error joining pool:", error);
      setStatus("Error: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  const generateMatches = async () => {
    if (!contract) return;

    try {
      setLoading(true);
      setStatus("Generating encrypted matches...");

      const tx = await contract.generateMatches();
      setStatus("Transaction sent! Generating matches...");

      await tx.wait();
      setStatus("Matches generated successfully! 🎄");

      await loadContractState();
    } catch (error) {
      console.error("Error generating matches:", error);
      setStatus("Error: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  const getMyEncryptedMatch = async () => {
    if (!readonlyContract || !accounts || accounts.length === 0) return null;

    try {
      const userAddress = accounts[0];
      const encryptedMatch = await readonlyContract.matches(userAddress);
      return encryptedMatch;
    } catch (error) {
      console.error("Error getting encrypted match:", error);
      return null;
    }
  };

  const decryptMyMatch = async () => {
    if (
      !fhevmInstance ||
      !readonlyContract ||
      !accounts ||
      accounts.length === 0 ||
      !ethersSigner ||
      !fhesecreatsanta.contractAddress
    ) {
      setStatus("FHEVM instance, signer, or contract not ready");
      return;
    }

    try {
      setIsDecrypting(true);
      setStatus("Getting your encrypted match...");

      const encryptedHandle = await getMyEncryptedMatch();

      if (
        !encryptedHandle ||
        encryptedHandle ===
          "0x0000000000000000000000000000000000000000000000000000000000000000"
      ) {
        setStatus("No match found. Please wait for matches to be generated.");
        setIsDecrypting(false);
        return;
      }

      setStatus("Generating decryption keypair...");

      const keypair = fhevmInstance.generateKeypair();

      const userAddress = getAddress(accounts[0]);
      const contractAddress = getAddress(fhesecreatsanta.contractAddress);

      const handleContractPairs = [
        {
          handle: encryptedHandle,
          contractAddress: contractAddress,
        },
      ];

      const startTimeStamp = Math.floor(Date.now() / 1000).toString();
      const durationDays = "10";
      const contractAddresses = [contractAddress];

      setStatus("Creating EIP712 signature...");

      const eip712 = fhevmInstance.createEIP712(
        keypair.publicKey,
        contractAddresses,
        startTimeStamp,
        durationDays
      );

      setStatus("Please sign the decryption request...");

      const signature = await ethersSigner.signTypedData(
        eip712.domain,
        {
          UserDecryptRequestVerification:
            eip712.types.UserDecryptRequestVerification,
        },
        eip712.message
      );

      setStatus("Decrypting your match... This may take 30-60 seconds...");

      const result = await fhevmInstance.userDecrypt(
        handleContractPairs,
        keypair.privateKey,
        keypair.publicKey,
        signature.replace("0x", ""),
        contractAddresses,
        userAddress,
        startTimeStamp,
        durationDays
      );

      const decryptedValue = result[encryptedHandle];
      const matchIndex = Number(decryptedValue);

      if (isNaN(matchIndex) || matchIndex < 0) {
        throw new Error(`Invalid match index: ${matchIndex}`);
      }

      setMyMatch(matchIndex);

      const matchAddress = await readonlyContract.getParticipant(matchIndex);
      setMyMatchAddress(matchAddress);

      setStatus(`Your Secret Santa match revealed! 🎁`);
      setMatchRevealed(true);
      setRevealModalOpen(false);
    } catch (error) {
      console.error("Error decrypting match:", error);

      if (error?.code === 4001 || error?.code === "ACTION_REJECTED") {
        setStatus("Signature rejected by user");
      } else if (error?.message?.includes("user rejected")) {
        setStatus("Signature rejected by user");
      } else {
        setStatus("Error decrypting: " + (error?.message || "Unknown error"));
      }
    } finally {
      setIsDecrypting(false);
    }
  };

  const resetGame = async () => {
    if (!contract) return;

    try {
      setLoading(true);
      setStatus("Resetting game...");

      const tx = await contract.reset();
      await tx.wait();

      setStatus("Game reset successfully!");
      setMyMatch(null);
      setMyMatchAddress(null);
      setEncryptedMatchHandle(null);
      setShowEncryptedMatch(false);
      setMatchRevealed(false);
      setMatchMinimized(false);
      await loadContractState();
    } catch (error) {
      console.error("Error resetting game:", error);
      setStatus("Error: " + error.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCancelReveal = () => {
    setRevealModalOpen(false);
    setStatus("Decryption cancelled - your match remains secret");
  };

  const handleMinimizeMatch = () => {
    setMatchMinimized(true);
    setStatus("Match minimized - click to view again");
  };

  const handleCloseMatch = () => {
    if (
      window.confirm(
        "Are you sure you want to close the match reveal? You can decrypt it again anytime."
      )
    ) {
      setMatchRevealed(false);
      setMyMatch(null);
      setMyMatchAddress(null);
      setMatchMinimized(false);
      setStatus("Match closed - decrypt again whenever you're ready");
    }
  };

  const formatAddress = (addr) => {
    if (!addr) return "";
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
  };

  const buttonClass =
    "inline-flex items-center justify-center rounded-xl px-6 py-4 font-semibold text-white shadow-lg " +
    "transition-all duration-200 transform hover:scale-105 active:scale-95 " +
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 " +
    "disabled:opacity-50 disabled:pointer-events-none disabled:transform-none";

  if (!isConnected) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-red-900 via-green-900 to-red-900 flex items-center justify-center p-6">
        <div className="bg-white/90 backdrop-blur rounded-2xl shadow-2xl p-8 text-center max-w-md">
          <Gift className="w-20 h-20 text-red-600 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-800 mb-4">
            Welcome to Secret Santa!
          </h2>
          <p className="text-gray-600 mb-6">
            Connect your wallet to join the festive fun
          </p>
          <button
            onClick={connect}
            className={
              buttonClass +
              " bg-gradient-to-r from-red-600 to-green-600 hover:from-red-700 hover:to-green-700"
            }
          >
            Connect to MetaMask
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-900 via-green-900 to-red-900 p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Gift className="w-12 h-12 text-red-300" />
            <h1 className="text-5xl font-bold text-white">Secret Santa</h1>
            <Sparkles className="w-12 h-12 text-yellow-300" />
          </div>
          <p className="text-red-200 text-lg">
            Blockchain-powered Secret Santa with FHE encryption 🎄
          </p>
        </div>

        <div className="space-y-6">
          {/* Account Info */}
          <div className="bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <p className="text-sm text-gray-600">Connected Account</p>
                <p className="text-lg font-mono font-semibold text-gray-800">
                  {formatAddress(accounts[0])}
                </p>
                {isAdmin && (
                  <span className="inline-block mt-2 bg-yellow-400 text-yellow-900 px-3 py-1 rounded-full text-xs font-bold">
                    👑 ADMIN
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-green-700">
                <Users className="w-5 h-5" />
                <span className="text-2xl font-bold">
                  {participants.length}
                </span>
                <span className="text-sm">Participants</span>
              </div>
              <div className="text-sm">
                <p className="text-gray-600">FHEVM Status:</p>
                <p
                  className={`font-semibold ${fhevmStatus === "ready" ? "text-green-600" : "text-orange-600"}`}
                >
                  {fhevmStatus}
                </p>
              </div>
            </div>
          </div>

          {/* Status Message */}
          {status && (
            <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded">
              <p className="text-blue-800">{status}</p>
            </div>
          )}

          {/* Encrypted Match Display */}
          {showEncryptedMatch && encryptedMatchHandle && !matchRevealed && (
            <div className="bg-gradient-to-r from-purple-100 to-pink-100 border-2 border-purple-400 rounded-2xl shadow-xl p-6">
              <div className="flex items-center gap-3 mb-4">
                <Lock className="w-6 h-6 text-purple-600" />
                <h3 className="text-xl font-bold text-gray-800">
                  Your Encrypted Match
                </h3>
              </div>

              <div className="bg-white/70 backdrop-blur p-4 rounded-lg mb-4">
                <p className="text-sm text-gray-600 mb-2">Encrypted Handle:</p>
                <p className="text-xs font-mono text-gray-700 break-all bg-gray-100 p-2 rounded">
                  {encryptedMatchHandle}
                </p>
                <p className="text-xs text-gray-500 mt-2 italic">
                  🔐 This encrypted value contains your Secret Santa match
                </p>
              </div>

              <button
                onClick={() => setRevealModalOpen(true)}
                disabled={isDecrypting || fhevmStatus !== "ready"}
                className={
                  buttonClass +
                  " w-full bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700"
                }
              >
                <Eye className="w-5 h-5 mr-2" />
                Decrypt & Reveal My Match
              </button>

              {fhevmStatus !== "ready" && (
                <p className="text-sm text-orange-600 mt-2 text-center">
                  Waiting for FHEVM to be ready...
                </p>
              )}
            </div>
          )}

          {/* Decryption Modal */}
          {revealModalOpen && (
            <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 transform transition-all">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                    <Eye className="w-6 h-6 text-purple-600" />
                    Reveal Your Match?
                  </h3>
                  <button
                    onClick={handleCancelReveal}
                    disabled={isDecrypting}
                    className="text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <X className="w-6 h-6" />
                  </button>
                </div>

                <div className="bg-yellow-50 border-l-4 border-yellow-500 p-4 mb-4">
                  <p className="text-sm text-yellow-800">
                    ⚠️ <strong>Warning:</strong> Once decrypted, your match will
                    be visible. Make sure no one is watching your screen!
                  </p>
                </div>

                {isDecrypting && (
                  <div className="mb-4 text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto mb-2"></div>
                    <p className="text-sm text-gray-600">
                      Decrypting... This may take 30-60 seconds
                    </p>
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={handleCancelReveal}
                    disabled={isDecrypting}
                    className="flex-1 px-4 py-3 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold rounded-lg transition-colors disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={decryptMyMatch}
                    disabled={isDecrypting}
                    className="flex-1 px-4 py-3 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-700 hover:to-pink-700 text-white font-semibold rounded-lg transition-all disabled:opacity-50"
                  >
                    {isDecrypting ? "Decrypting..." : "Yes, Reveal"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Revealed Match Display */}
          {matchRevealed && myMatchAddress && !matchMinimized && (
            <div className="bg-gradient-to-r from-red-100 to-green-100 border-2 border-red-400 rounded-2xl shadow-xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                  <Gift className="w-6 h-6 text-red-600" />
                  Your Secret Santa Match 🎁
                </h3>
                <div className="flex gap-2">
                  <button
                    onClick={handleMinimizeMatch}
                    className="p-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg transition-colors"
                    title="Minimize"
                  >
                    <Minimize2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleCloseMatch}
                    className="p-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-colors"
                    title="Close"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="bg-white p-4 rounded-lg">
                <p className="text-sm text-gray-600 mb-1">
                  You're giving a gift to:
                </p>
                <p className="text-2xl font-mono font-bold text-red-700 mb-2">
                  {formatAddress(myMatchAddress)}
                </p>
                <p className="text-xs text-gray-500 font-mono mb-2">
                  Full: {myMatchAddress}
                </p>
                <p className="text-xs text-gray-500">Index: {myMatch}</p>

                <div className="mt-4 pt-4 border-t border-gray-200">
                  <p className="text-sm text-gray-700 font-semibold flex items-center gap-2">
                    <EyeOff className="w-4 h-4" />
                    Keep it secret! 🤫
                  </p>
                  <p className="text-xs text-gray-600 mt-1">
                    Don't let anyone see this screen
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Minimized Match Indicator */}
          {matchRevealed && matchMinimized && (
            <div
              onClick={() => setMatchMinimized(false)}
              className="bg-blue-100 border-2 border-blue-400 rounded-xl p-4 cursor-pointer hover:bg-blue-200 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Gift className="w-5 h-5 text-blue-600" />
                  <span className="font-semibold text-blue-800">
                    Match Revealed (Minimized)
                  </span>
                </div>
                <Eye className="w-5 h-5 text-blue-600" />
              </div>
              <p className="text-sm text-blue-600 mt-1">
                Click to view your match again
              </p>
            </div>
          )}

          {/* Main Actions */}
          <div className="bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6">
            <h2 className="text-2xl font-bold text-gray-800 mb-6 flex items-center gap-2">
              <Gift className="w-6 h-6 text-red-600" />
              Game Actions
            </h2>

            <div className="space-y-4">
              {/* Join Pool */}
              {!hasJoined && !matchesGenerated && (
                <button
                  onClick={joinPool}
                  disabled={loading}
                  className={
                    buttonClass + " w-full bg-green-600 hover:bg-green-700"
                  }
                >
                  <Users className="w-5 h-5 mr-2" />
                  Join Secret Santa Pool
                </button>
              )}

              {hasJoined && !matchesGenerated && (
                <div className="bg-green-50 border-l-4 border-green-500 p-4 rounded">
                  <p className="text-green-800 font-semibold">
                    ✓ You've joined! Waiting for matches to be generated...
                  </p>
                </div>
              )}

              {/* Generate Matches (Admin) */}
              {isAdmin && !matchesGenerated && participants.length >= 3 && (
                <button
                  onClick={generateMatches}
                  disabled={loading}
                  className={
                    buttonClass + " w-full bg-purple-600 hover:bg-purple-700"
                  }
                >
                  <Shuffle className="w-5 h-5 mr-2" />
                  Generate Encrypted Matches
                </button>
              )}

              {/* Reset (Admin) */}
              {isAdmin && (
                <button
                  onClick={resetGame}
                  disabled={loading}
                  className={
                    buttonClass + " w-full bg-gray-600 hover:bg-gray-700"
                  }
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Reset Game (Admin Only)
                </button>
              )}
            </div>
          </div>

          {/* Participants List */}
          {participants.length > 0 && (
            <div className="bg-white/90 backdrop-blur rounded-2xl shadow-xl p-6">
              <h3 className="text-xl font-bold text-gray-800 mb-4 flex items-center gap-2">
                <Users className="w-5 h-5 text-green-600" />
                Participants ({participants.length})
              </h3>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {participants.map((participant, idx) => (
                  <div
                    key={idx}
                    className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                  >
                    <span className="font-mono text-sm text-gray-700">
                      {formatAddress(participant)}
                    </span>
                    {participant.toLowerCase() ===
                      accounts[0].toLowerCase() && (
                      <span className="bg-green-500 text-white px-2 py-1 rounded text-xs font-bold">
                        YOU
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-red-200 text-sm">
          <p>🎄 Powered by Zama's fhEVM - Fully Homomorphic Encryption 🎄</p>
          <p className="mt-2">
            Your match is encrypted on-chain until you decrypt it!
          </p>
        </div>
      </div>
    </div>
  );
};

export default SecretSantaApp;
