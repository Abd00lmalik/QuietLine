// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ITeeExtensionRegistry} from "../interfaces/ITeeExtensionRegistry.sol";

contract MockTeeExtensionRegistry is ITeeExtensionRegistry {
    uint256 public nonce;
    mapping(uint256 => address) public senderByExtension;

    event Request(
        bytes32 indexed instructionId,
        address[] teeIds,
        bytes32 opType,
        bytes32 opCommand,
        bytes message,
        address claimBackAddress
    );

    function setSender(uint256 extensionId, address sender) external {
        senderByExtension[extensionId] = sender;
    }

    function getTeeExtensionInstructionsSender(uint256 extensionId) external view returns (address) {
        return senderByExtension[extensionId];
    }

    function sendInstructions(address[] calldata teeIds, TeeInstructionParams calldata params)
        external
        payable
        returns (bytes32 instructionId)
    {
        instructionId = keccak256(
            abi.encode(msg.sender, ++nonce, teeIds, params.opType, params.opCommand, params.message)
        );
        emit Request(
            instructionId,
            teeIds,
            params.opType,
            params.opCommand,
            params.message,
            params.claimBackAddress
        );
    }
}
