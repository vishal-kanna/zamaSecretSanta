"use client";

import { ethers } from "ethers";
import {
  RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  FhevmDecryptionSignature,
  type FhevmInstance,
  type GenericStringStorage,
} from "@fhevm/react";

/*
  The following two files should be automatically generated when `npx hardhat deploy` is called
  If not, create them manually based on your deployment:
  
  - <root>/packages/site/abi/SecretSantaABI.ts
  - <root>/packages/site/abi/SecretSantaAddresses.ts
*/
import { FHESecretAddresses } from "@/abi/FHESecretAddress";
import { FHESecretSantaABI } from "@/abi/FHESecretSanta";

export type SecretSantaMatch = {
  handle: string;
  matchIndex: number | bigint;
  matchAddress: string;
};

type SecretSantaInfoType = {
  abi: typeof FHESecretSantaABI.abi;
  address?: `0x${string}`;
  chainId?: number;
  chainName?: string;
};

/**
 * Resolves SecretSanta contract metadata for the given EVM `chainId`.
 */
function getSecretSantaByChainId(
  chainId: number | undefined
): SecretSantaInfoType {
  console.log("Looking up SecretSanta for chainId:", chainId);

  if (!chainId) return { abi: FHESecretSantaABI.abi };

  const entry =
    FHESecretAddresses[chainId.toString() as keyof typeof FHESecretAddresses];

  console.log("Found entry:", entry);

  if (!entry || !("address" in entry) || entry.address === ethers.ZeroAddress) {
    console.warn("No deployment found for this chainId");
    return { abi: FHESecretSantaABI.abi, chainId };
  }

  return {
    address: entry?.address as `0x${string}`,
    chainId: entry?.chainId ?? chainId,
    chainName: entry?.chainName,
    abi: FHESecretSantaABI.abi,
  };
}

/**
 * Custom React hook for Secret Santa contract interactions
 *
 * Features:
 * - Join the Secret Santa pool
 * - Generate encrypted matches (admin only)
 * - Decrypt your match using FHE
 * - Request match via contract callback
 * - Track participants and game state
 */
export const useSecretSanta = (parameters: {
  instance: FhevmInstance | undefined;
  fhevmDecryptionSignatureStorage: GenericStringStorage;
  eip1193Provider: ethers.Eip1193Provider | undefined;
  chainId: number | undefined;
  ethersSigner: ethers.JsonRpcSigner | undefined;
  ethersReadonlyProvider: ethers.ContractRunner | undefined;
  sameChain: RefObject<(chainId: number | undefined) => boolean>;
  sameSigner: RefObject<
    (ethersSigner: ethers.JsonRpcSigner | undefined) => boolean
  >;
}) => {
  const {
    instance,
    fhevmDecryptionSignatureStorage,
    chainId,
    ethersSigner,
    ethersReadonlyProvider,
    sameChain,
    sameSigner,
  } = parameters;

  //////////////////////////////////////////////////////////////////////////////
  // States + Refs
  //////////////////////////////////////////////////////////////////////////////

  const [participants, setParticipants] = useState<string[]>([]);
  const [hasJoined, setHasJoined] = useState<boolean>(false);
  const [matchesGenerated, setMatchesGenerated] = useState<boolean>(false);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [matchHandle, setMatchHandle] = useState<string | undefined>(undefined);
  const [decryptedMatch, setDecryptedMatch] = useState<
    SecretSantaMatch | undefined
  >(undefined);
  const decryptedMatchRef = useRef<SecretSantaMatch | undefined>(undefined);

  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isJoining, setIsJoining] = useState<boolean>(false);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isDecrypting, setIsDecrypting] = useState<boolean>(false);
  const [isRequesting, setIsRequesting] = useState<boolean>(false);
  const [message, setMessage] = useState<string>("");

  const secretSantaRef = useRef<SecretSantaInfoType | undefined>(undefined);
  const isRefreshingRef = useRef<boolean>(isRefreshing);
  const isDecryptingRef = useRef<boolean>(isDecrypting);
  const isJoiningRef = useRef<boolean>(isJoining);
  const isGeneratingRef = useRef<boolean>(isGenerating);
  const isRequestingRef = useRef<boolean>(isRequesting);

  const isMatchDecrypted =
    matchHandle && matchHandle === decryptedMatch?.handle;

  //////////////////////////////////////////////////////////////////////////////
  // SecretSanta Contract
  //////////////////////////////////////////////////////////////////////////////

  const secretSanta = useMemo(() => {
    const c = getSecretSantaByChainId(chainId);

    console.log("c---------------", c);
    secretSantaRef.current = c;

    if (!c.address) {
      setMessage(`SecretSanta deployment not found for chainId=${chainId}.`);
    }

    return c;
  }, [chainId]);

  const isDeployed = useMemo(() => {
    if (!secretSanta) {
      return undefined;
    }
    return (
      Boolean(secretSanta.address) && secretSanta.address !== ethers.ZeroAddress
    );
  }, [secretSanta]);

  //////////////////////////////////////////////////////////////////////////////
  // Refresh Game State
  //////////////////////////////////////////////////////////////////////////////

  const canRefresh = useMemo(() => {
    return secretSanta.address && ethersReadonlyProvider && !isRefreshing;
  }, [secretSanta.address, ethersReadonlyProvider, isRefreshing]);

  const refreshGameState = useCallback(() => {
    console.log("[useSecretSanta] call refreshGameState()");
    if (isRefreshingRef.current) {
      return;
    }

    if (
      !secretSantaRef.current ||
      !secretSantaRef.current?.chainId ||
      !secretSantaRef.current?.address ||
      !ethersReadonlyProvider ||
      !ethersSigner
    ) {
      return;
    }

    isRefreshingRef.current = true;
    setIsRefreshing(true);

    const thisChainId = secretSantaRef.current.chainId;
    const thisSecretSantaAddress = secretSantaRef.current.address;

    const contract = new ethers.Contract(
      thisSecretSantaAddress,
      secretSantaRef.current.abi,
      ethersReadonlyProvider
    );

    const run = async () => {
      try {
        const userAddress = await ethersSigner.getAddress();

        const [participantsList, userJoined, matchesGen, adminAddress] =
          await Promise.all([
            contract.getAllParticipants(),
            contract.hasJoined(userAddress),
            contract.matchesGenerated(),
            contract.admin(),
          ]);

        if (
          sameChain.current(thisChainId) &&
          thisSecretSantaAddress === secretSantaRef.current?.address
        ) {
          setParticipants(participantsList);
          setHasJoined(userJoined);
          setMatchesGenerated(matchesGen);
          setIsAdmin(adminAddress.toLowerCase() === userAddress.toLowerCase());

          // If matches are generated and user has joined, get their encrypted match
          if (matchesGen && userJoined) {
            const encryptedMatch = await contract.matches(userAddress);
            if (encryptedMatch && encryptedMatch !== ethers.ZeroHash) {
              setMatchHandle(encryptedMatch);
            }
          }
        }
      } catch (e) {
        setMessage("Failed to refresh game state: " + e);
      } finally {
        isRefreshingRef.current = false;
        setIsRefreshing(false);
      }
    };

    run();
  }, [ethersReadonlyProvider, ethersSigner, sameChain]);

  // Auto refresh game state
  useEffect(() => {
    if (ethersSigner && ethersReadonlyProvider) {
      refreshGameState();
    }
  }, [refreshGameState, ethersSigner, ethersReadonlyProvider]);

  //////////////////////////////////////////////////////////////////////////////
  // Join Pool
  //////////////////////////////////////////////////////////////////////////////

  const canJoin = useMemo(() => {
    return (
      secretSanta.address &&
      ethersSigner &&
      !hasJoined &&
      !matchesGenerated &&
      !isJoining &&
      !isRefreshing
    );
  }, [
    secretSanta.address,
    ethersSigner,
    hasJoined,
    matchesGenerated,
    isJoining,
    isRefreshing,
  ]);

  const joinPool = useCallback(() => {
    if (isJoiningRef.current || isRefreshingRef.current) {
      return;
    }

    if (!secretSanta.address || !ethersSigner) {
      return;
    }

    const thisChainId = chainId;
    const thisSecretSantaAddress = secretSanta.address;
    const thisEthersSigner = ethersSigner;

    isJoiningRef.current = true;
    setIsJoining(true);
    setMessage("Joining Secret Santa pool...");

    const run = async () => {
      const isStale = () =>
        thisSecretSantaAddress !== secretSantaRef.current?.address ||
        !sameChain.current(thisChainId) ||
        !sameSigner.current(thisEthersSigner);

      try {
        const contract = new ethers.Contract(
          thisSecretSantaAddress,
          secretSanta.abi,
          thisEthersSigner
        );

        const tx: ethers.TransactionResponse = await contract.joinPool();
        setMessage(`Waiting for transaction: ${tx.hash}...`);

        const receipt = await tx.wait();
        setMessage(`Successfully joined! Status: ${receipt?.status} 🎉`);

        if (isStale()) {
          setMessage("Ignoring stale join operation");
          return;
        }

        refreshGameState();
      } catch (e) {
        setMessage("Failed to join pool: " + e);
      } finally {
        isJoiningRef.current = false;
        setIsJoining(false);
      }
    };

    run();
  }, [
    secretSanta.address,
    secretSanta.abi,
    ethersSigner,
    chainId,
    refreshGameState,
    sameChain,
    sameSigner,
  ]);

  //////////////////////////////////////////////////////////////////////////////
  // Generate Matches (Admin Only)
  //////////////////////////////////////////////////////////////////////////////

  const canGenerateMatches = useMemo(() => {
    return (
      secretSanta.address &&
      ethersSigner &&
      isAdmin &&
      !matchesGenerated &&
      participants.length >= 3 &&
      !isGenerating &&
      !isRefreshing
    );
  }, [
    secretSanta.address,
    ethersSigner,
    isAdmin,
    matchesGenerated,
    participants.length,
    isGenerating,
    isRefreshing,
  ]);

  const generateMatches = useCallback(() => {
    if (isGeneratingRef.current || isRefreshingRef.current) {
      return;
    }

    if (!secretSanta.address || !ethersSigner || !isAdmin) {
      return;
    }

    const thisChainId = chainId;
    const thisSecretSantaAddress = secretSanta.address;
    const thisEthersSigner = ethersSigner;

    isGeneratingRef.current = true;
    setIsGenerating(true);
    setMessage("Generating encrypted matches...");

    const run = async () => {
      const isStale = () =>
        thisSecretSantaAddress !== secretSantaRef.current?.address ||
        !sameChain.current(thisChainId) ||
        !sameSigner.current(thisEthersSigner);

      try {
        const contract = new ethers.Contract(
          thisSecretSantaAddress,
          secretSanta.abi,
          thisEthersSigner
        );

        const tx: ethers.TransactionResponse = await contract.generateMatches();
        setMessage(`Waiting for transaction: ${tx.hash}...`);

        const receipt = await tx.wait();
        setMessage(
          `Matches generated successfully! Status: ${receipt?.status} 🎄`
        );

        if (isStale()) {
          setMessage("Ignoring stale generate operation");
          return;
        }

        refreshGameState();
      } catch (e) {
        setMessage("Failed to generate matches: " + e);
      } finally {
        isGeneratingRef.current = false;
        setIsGenerating(false);
      }
    };

    run();
  }, [
    secretSanta.address,
    secretSanta.abi,
    ethersSigner,
    isAdmin,
    chainId,
    refreshGameState,
    sameChain,
    sameSigner,
  ]);

  //////////////////////////////////////////////////////////////////////////////
  // Decrypt Match (Client-Side)
  //////////////////////////////////////////////////////////////////////////////

  const canDecrypt = useMemo(() => {
    return (
      secretSanta.address &&
      instance &&
      ethersSigner &&
      hasJoined &&
      matchesGenerated &&
      !isRefreshing &&
      !isDecrypting &&
      matchHandle &&
      matchHandle !== ethers.ZeroHash &&
      matchHandle !== decryptedMatch?.handle
    );
  }, [
    secretSanta.address,
    instance,
    ethersSigner,
    hasJoined,
    matchesGenerated,
    isRefreshing,
    isDecrypting,
    matchHandle,
    decryptedMatch,
  ]);

  const decryptMatch = useCallback(() => {
    if (isRefreshingRef.current || isDecryptingRef.current) {
      return;
    }

    if (!secretSanta.address || !instance || !ethersSigner || !matchHandle) {
      return;
    }

    // Already computed
    if (matchHandle === decryptedMatchRef.current?.handle) {
      return;
    }

    if (matchHandle === ethers.ZeroHash) {
      setMessage("No match assigned yet");
      return;
    }

    const thisChainId = chainId;
    const thisSecretSantaAddress = secretSanta.address;
    const thisMatchHandle = matchHandle;
    const thisEthersSigner = ethersSigner;

    isDecryptingRef.current = true;
    setIsDecrypting(true);
    setMessage("Starting decryption...");

    const run = async () => {
      const isStale = () =>
        thisSecretSantaAddress !== secretSantaRef.current?.address ||
        !sameChain.current(thisChainId) ||
        !sameSigner.current(thisEthersSigner);

      try {
        const sig: FhevmDecryptionSignature | null =
          await FhevmDecryptionSignature.loadOrSign(
            instance,
            [secretSanta.address as `0x${string}`],
            ethersSigner,
            fhevmDecryptionSignatureStorage
          );

        if (!sig) {
          setMessage("Unable to build FHEVM decryption signature");
          return;
        }

        if (isStale()) {
          setMessage("Ignoring stale decryption");
          return;
        }

        setMessage("Decrypting your match... This may take a moment...");

        const res = await instance.userDecrypt(
          [
            {
              handle: thisMatchHandle,
              contractAddress: thisSecretSantaAddress,
            },
          ],
          sig.privateKey,
          sig.publicKey,
          sig.signature,
          sig.contractAddresses,
          sig.userAddress,
          sig.startTimestamp,
          sig.durationDays
        );

        if (isStale()) {
          setMessage("Ignoring stale decryption");
          return;
        }

        const matchIndex = Number(res[thisMatchHandle]);

        // Get the address of the match
        const contract = new ethers.Contract(
          thisSecretSantaAddress,
          secretSanta.abi,
          ethersReadonlyProvider!
        );

        const matchAddress = await contract.getParticipant(matchIndex);

        const matchData: SecretSantaMatch = {
          handle: thisMatchHandle,
          matchIndex,
          matchAddress,
        };

        setDecryptedMatch(matchData);
        decryptedMatchRef.current = matchData;

        setMessage(`Your Secret Santa match revealed! 🎁`);
      } catch (e) {
        setMessage("Decryption failed: " + e);
      } finally {
        isDecryptingRef.current = false;
        setIsDecrypting(false);
      }
    };

    run();
  }, [
    fhevmDecryptionSignatureStorage,
    ethersSigner,
    ethersReadonlyProvider,
    secretSanta.address,
    secretSanta.abi,
    instance,
    matchHandle,
    chainId,
    sameChain,
    sameSigner,
  ]);

  //////////////////////////////////////////////////////////////////////////////
  // Request Match via Contract Callback
  //////////////////////////////////////////////////////////////////////////////

  const canRequestMatch = useMemo(() => {
    return (
      secretSanta.address &&
      ethersSigner &&
      hasJoined &&
      matchesGenerated &&
      !isRequesting &&
      !isRefreshing
    );
  }, [
    secretSanta.address,
    ethersSigner,
    hasJoined,
    matchesGenerated,
    isRequesting,
    isRefreshing,
  ]);

  const requestMatchViaCallback = useCallback(() => {
    if (isRequestingRef.current || isRefreshingRef.current) {
      return;
    }

    if (!secretSanta.address || !ethersSigner) {
      return;
    }

    const thisChainId = chainId;
    const thisSecretSantaAddress = secretSanta.address;
    const thisEthersSigner = ethersSigner;

    isRequestingRef.current = true;
    setIsRequesting(true);
    setMessage("Requesting match via contract callback...");

    const run = async () => {
      const isStale = () =>
        thisSecretSantaAddress !== secretSantaRef.current?.address ||
        !sameChain.current(thisChainId) ||
        !sameSigner.current(thisEthersSigner);

      try {
        const contract = new ethers.Contract(
          thisSecretSantaAddress,
          secretSanta.abi,
          thisEthersSigner
        );

        const tx: ethers.TransactionResponse = await contract.requestMyMatch();
        setMessage(`Waiting for transaction: ${tx.hash}...`);

        const receipt = await tx.wait();

        // Get request ID from event
        const event = receipt.logs.find((log) => {
          try {
            const parsed = contract.interface.parseLog(log);
            return parsed && parsed.name === "MatchRequested";
          } catch (e) {
            return false;
          }
        });

        if (event) {
          const parsedEvent = contract.interface.parseLog(event);
          const requestId = parsedEvent.args.requestId;
          setMessage(
            `Match requested! Request ID: ${requestId}. Waiting for KMS decryption (30-60s)...`
          );

          // Poll for result
          await pollForMatchResult(
            contract,
            requestId,
            thisSecretSantaAddress,
            thisChainId,
            thisEthersSigner
          );
        } else {
          setMessage("Match requested, but could not get request ID");
        }

        if (isStale()) {
          setMessage("Ignoring stale request");
          return;
        }
      } catch (e) {
        setMessage("Failed to request match: " + e);
      } finally {
        isRequestingRef.current = false;
        setIsRequesting(false);
      }
    };

    run();
  }, [
    secretSanta.address,
    secretSanta.abi,
    ethersSigner,
    chainId,
    sameChain,
    sameSigner,
  ]);

  const pollForMatchResult = async (
    contract: ethers.Contract,
    requestId: bigint,
    address: string,
    thisChainId: number | undefined,
    thisEthersSigner: ethers.JsonRpcSigner
  ) => {
    let attempts = 0;
    const maxAttempts = 60; // 2 minutes

    return new Promise<void>((resolve) => {
      const checkInterval = setInterval(async () => {
        try {
          const isStale = () =>
            address !== secretSantaRef.current?.address ||
            !sameChain.current(thisChainId) ||
            !sameSigner.current(thisEthersSigner);

          if (isStale()) {
            clearInterval(checkInterval);
            resolve();
            return;
          }

          const isProcessed = await contract.isRequestProcessed(requestId);

          if (isProcessed) {
            clearInterval(checkInterval);

            // Get the match revealed event
            const userAddress = await thisEthersSigner.getAddress();
            const filter = contract.filters.MatchRevealed(userAddress);
            const events = await contract.queryFilter(filter);

            if (events.length > 0) {
              const latestEvent = events[events.length - 1];
              const matchIndex = Number(latestEvent.args.matchIndex);
              const matchAddress = await contract.getParticipant(matchIndex);

              const matchData: SecretSantaMatch = {
                handle: matchHandle || "",
                matchIndex,
                matchAddress,
              };

              setDecryptedMatch(matchData);
              decryptedMatchRef.current = matchData;
              setMessage(`Your Secret Santa match revealed via callback! 🎁`);
            }

            resolve();
            return;
          }

          attempts++;
          if (attempts >= maxAttempts) {
            clearInterval(checkInterval);
            setMessage(
              "Decryption taking longer than expected. Please try again later."
            );
            resolve();
          }
        } catch (e) {
          console.error("Error polling for match result:", e);
          clearInterval(checkInterval);
          resolve();
        }
      }, 2000);
    });
  };

  //////////////////////////////////////////////////////////////////////////////
  // Reset Game (Admin Only)
  //////////////////////////////////////////////////////////////////////////////

  const resetGame = useCallback(async () => {
    if (!secretSanta.address || !ethersSigner || !isAdmin) {
      return;
    }

    try {
      setMessage("Resetting game...");
      const contract = new ethers.Contract(
        secretSanta.address,
        secretSanta.abi,
        ethersSigner
      );

      const tx = await contract.reset();
      await tx.wait();

      setMessage("Game reset successfully!");
      setDecryptedMatch(undefined);
      decryptedMatchRef.current = undefined;
      setMatchHandle(undefined);

      refreshGameState();
    } catch (e) {
      setMessage("Failed to reset game: " + e);
    }
  }, [
    secretSanta.address,
    secretSanta.abi,
    ethersSigner,
    isAdmin,
    refreshGameState,
  ]);

  //////////////////////////////////////////////////////////////////////////////
  // Return Hook API
  //////////////////////////////////////////////////////////////////////////////

  return {
    // Contract info
    contractAddress: secretSanta.address,
    isDeployed,

    // Game state
    participants,
    hasJoined,
    matchesGenerated,
    isAdmin,
    matchHandle,
    decryptedMatch,
    isMatchDecrypted,

    // Capabilities
    canRefresh,
    canJoin,
    canGenerateMatches,
    canDecrypt,
    canRequestMatch,

    // Actions
    refreshGameState,
    joinPool,
    generateMatches,
    decryptMatch,
    requestMatchViaCallback,
    resetGame,

    // Status
    isRefreshing,
    isJoining,
    isGenerating,
    isDecrypting,
    isRequesting,
    message,
  };
};
