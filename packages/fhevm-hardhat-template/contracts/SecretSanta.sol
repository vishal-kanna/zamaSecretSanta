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

    // Step 2: Generate encrypted matches with random shuffle
    function generateMatches() external {
        require(msg.sender == admin, "Only admin can generate");
        require(participants.length >= minParticipants, "Need more participants");
        require(!matchesGenerated, "Already assigned");

        uint256 n = participants.length;

        // Create initial assignment array
        uint32[] memory assignment = new uint32[](n);
        for (uint32 i = 0; i < n; i++) {
            assignment[i] = i;
        }

        // Fisher-Yates shuffle using block randomness
        for (uint256 i = n - 1; i > 0; i--) {
            uint256 seed = uint256(
                keccak256(abi.encodePacked(block.timestamp, block.prevrandao, msg.sender, participants[i], i))
            );
            uint256 j = seed % (i + 1);

            // Swap assignment[i] with assignment[j]
            uint32 temp = assignment[i];
            assignment[i] = assignment[uint32(j)];
            assignment[uint32(j)] = temp;
        }

        // Fix self-assignments
        for (uint256 i = 0; i < n; i++) {
            if (assignment[i] == i) {
                uint256 swapIdx = (i + 1) % n;

                // Find a valid swap partner
                while (assignment[swapIdx] == swapIdx) {
                    swapIdx = (swapIdx + 1) % n;
                }

                uint32 temp = assignment[i];
                assignment[i] = assignment[swapIdx];
                assignment[swapIdx] = temp;
            }
        }

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

    // Callback for decryption - CORRECT SIGNATURE for current FHE library
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
