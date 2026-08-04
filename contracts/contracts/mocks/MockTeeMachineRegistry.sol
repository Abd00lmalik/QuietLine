// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ITeeMachineRegistry} from "../interfaces/ITeeMachineRegistry.sol";

contract MockTeeMachineRegistry is ITeeMachineRegistry {
    address public teeId;
    mapping(address => uint256) public extensionIdByTee;
    mapping(address => uint8) public statusByTee;

    constructor(address teeId_) {
        teeId = teeId_;
        extensionIdByTee[teeId_] = 65_536;
        statusByTee[teeId_] = 2;
    }

    function setMachine(address teeId_, uint256 extensionId, uint8 status) external {
        teeId = teeId_;
        extensionIdByTee[teeId_] = extensionId;
        statusByTee[teeId_] = status;
    }

    function getRandomTeeIds(uint256, uint256 count) external view returns (address[] memory teeIds) {
        teeIds = new address[](count);
        for (uint256 i; i < count; ++i) teeIds[i] = teeId;
    }

    function getExtensionId(address teeId_) external view returns (uint256) {
        return extensionIdByTee[teeId_];
    }

    function getTeeMachineStatus(address teeId_) external view returns (uint8) {
        return statusByTee[teeId_];
    }
}
