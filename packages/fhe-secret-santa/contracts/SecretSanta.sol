// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity ^0.8.24;

import {FHE, euint32} from "@fhevm/solidity/lib/FHE.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract SecretSanta is SepoliaConfig {
    // Participants list
    address[] public participants;

    // Each participant's encrypted match (stores INDEX of recipient)
    mapping(address => euint32) public matches;

    // Game state
    address public admin;
    bool public matchesGenerated = false;
    uint256 public minParticipants = 3;

    // Decryption request tracking
    mapping(uint256 => address) public pendingRequests;
    mapping(address => bool) public hasJoined;
    mapping(uint256 => bool) public processedRequests;

    // Events
    event ParticipantJoined(address participant, uint256 totalCount);
    event MatchesGenerated(uint256 participantCount);
    event MatchRequested(address participant, uint256 requestId);
    event MatchRevealed(address participant, uint256 matchIndex);

    constructor() {
        admin = msg.sender;
    }

    // Step 1: Join the Secret Santa pool
    function joinPool() external {
        require(!matchesGenerated, "Matches already generated");
        require(!hasJoined[msg.sender], "Already joined");

        participants.push(msg.sender);
        hasJoined[msg.sender] = true;
        emit ParticipantJoined(msg.sender, participants.length);
    }

    // Step 2: Generate encrypted matches with TRUE random derangement
    function generateMatches() external {
        require(msg.sender == admin, "Only admin can generate");
        require(participants.length >= minParticipants, "Need more participants");
        require(!matchesGenerated, "Already assigned");

        uint256 n = participants.length;
        uint32[] memory assignment = generateRandomDerangement(n);

        // Store encrypted assignments
        for (uint256 i = 0; i < n; i++) {
            matches[participants[i]] = FHE.asEuint32(assignment[i]);

            // CRITICAL: Allow contract to request decryption
            FHE.allowThis(matches[participants[i]]);

            // Also allow participant to decrypt client-side if needed
            FHE.allow(matches[participants[i]], participants[i]);
        }

        matchesGenerated = true;
        emit MatchesGenerated(participants.length);
    }

    // Generate a true random derangement (permutation where no element stays in place)
    function generateRandomDerangement(uint256 n) private view returns (uint32[] memory) {
        require(n >= 2, "Need at least 2 participants");

        uint32[] memory derangement = new uint32[](n);
        uint256 maxAttempts = 100; // Prevent infinite loops
        uint256 attempts = 0;
        bool isValid = false;

        while (!isValid && attempts < maxAttempts) {
            attempts++;

            // Generate a random permutation using Fisher-Yates
            uint32[] memory temp = new uint32[](n);
            for (uint32 i = 0; i < n; i++) {
                temp[i] = i;
            }

            // Fisher-Yates shuffle with enhanced randomness
            for (uint256 i = n - 1; i > 0; i--) {
                uint256 seed = uint256(
                    keccak256(
                        abi.encodePacked(
                            block.timestamp,
                            block.prevrandao,
                            block.number,
                            msg.sender,
                            participants[i],
                            i,
                            attempts,
                            blockhash(block.number - 1)
                        )
                    )
                );
                uint256 j = seed % (i + 1);

                // Swap
                uint32 swapTemp = temp[i];
                temp[i] = temp[j];
                temp[j] = swapTemp;
            }

            // Check if this is a valid derangement (no fixed points)
            isValid = true;
            for (uint256 i = 0; i < n; i++) {
                if (temp[i] == i) {
                    isValid = false;
                    break;
                }
            }

            if (isValid) {
                derangement = temp;
            }
        }

        require(isValid, "Failed to generate derangement");
        return derangement;
    }

    // Alternative: Deterministic derangement generation (always succeeds)
    // Uses the "early refusal" algorithm for derangements
    function generateDeterministicDerangement(uint256 n) private view returns (uint32[] memory) {
        require(n >= 2, "Need at least 2 participants");

        uint32[] memory result = new uint32[](n);
        bool[] memory used = new bool[](n);

        if (!fillDerangement(result, used, 0, n)) {
            // Fallback: generate any valid derangement
            return generateSimpleDerangement(n);
        }

        return result;
    }

    // Recursive backtracking for derangement
    function fillDerangement(
        uint32[] memory result,
        bool[] memory used,
        uint256 pos,
        uint256 n
    ) private view returns (bool) {
        if (pos == n) {
            return true;
        }

        // Generate random order to try values
        uint256[] memory order = getRandomOrder(n, pos);

        for (uint256 i = 0; i < n; i++) {
            uint32 value = uint32(order[i]);

            // Skip if it's a fixed point or already used
            if (value == pos || used[value]) {
                continue;
            }

            // Try this assignment
            result[pos] = value;
            used[value] = true;

            if (fillDerangement(result, used, pos + 1, n)) {
                return true;
            }

            // Backtrack
            used[value] = false;
        }

        return false;
    }

    // Generate random ordering of indices
    function getRandomOrder(uint256 n, uint256 salt) private view returns (uint256[] memory) {
        uint256[] memory order = new uint256[](n);
        for (uint256 i = 0; i < n; i++) {
            order[i] = i;
        }

        // Shuffle the order
        for (uint256 i = n - 1; i > 0; i--) {
            uint256 seed = uint256(keccak256(abi.encodePacked(block.timestamp, block.prevrandao, i, salt)));
            uint256 j = seed % (i + 1);

            uint256 temp = order[i];
            order[i] = order[j];
            order[j] = temp;
        }

        return order;
    }

    // Simple fallback derangement (guaranteed to work)
    function generateSimpleDerangement(uint256 n) private pure returns (uint32[] memory) {
        uint32[] memory result = new uint32[](n);

        if (n == 2) {
            result[0] = 1;
            result[1] = 0;
        } else if (n == 3) {
            result[0] = 1;
            result[1] = 2;
            result[2] = 0;
        } else {
            // For n >= 4, use a cycle decomposition
            // Create a large cycle plus potentially smaller ones
            for (uint256 i = 0; i < n - 1; i++) {
                result[i] = uint32(i + 1);
            }
            result[n - 1] = 0;
        }

        return result;
    }

    //  Step 3: Request decryption of your match
    function requestMyMatch() external returns (uint256 requestId) {
        require(matchesGenerated, "Matches not generated yet");
        require(hasJoined[msg.sender], "You haven't joined");

        euint32 encryptedMatch = matches[msg.sender];

        // Request decryption
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(encryptedMatch);

        requestId = FHE.requestDecryption(cts, this.callbackMatchDecryption.selector);

        pendingRequests[requestId] = msg.sender;
        processedRequests[requestId] = false;

        emit MatchRequested(msg.sender, requestId);
        return requestId;
    }

    // Callback for decryption
    function callbackMatchDecryption(uint256 requestId, bytes memory cleartexts, bytes memory decryptionProof) public {
        require(!processedRequests[requestId], "Request already processed");

        address user = pendingRequests[requestId];
        require(user != address(0), "Invalid request");

        // Verify KMS signatures
        FHE.checkSignatures(requestId, cleartexts, decryptionProof);

        // Decode the decrypted value
        uint32 decryptedIndex = abi.decode(cleartexts, (uint32));

        processedRequests[requestId] = true;

        emit MatchRevealed(user, decryptedIndex);
    }

    // Helper: Get total participants
    function getParticipantCount() external view returns (uint256) {
        return participants.length;
    }

    // Helper: Get participant at index
    function getParticipant(uint256 index) external view returns (address) {
        require(index < participants.length, "Index out of bounds");
        return participants[index];
    }

    // Helper: Get all participants
    function getAllParticipants() external view returns (address[] memory) {
        return participants;
    }

    // Check if request has been processed
    function isRequestProcessed(uint256 requestId) external view returns (bool) {
        return processedRequests[requestId];
    }

    // Reset game (admin only, for testing)
    function reset() external {
        require(msg.sender == admin, "Only admin");

        // Clear state
        for (uint i = 0; i < participants.length; i++) {
            hasJoined[participants[i]] = false;
        }

        delete participants;
        matchesGenerated = false;
    }
}
