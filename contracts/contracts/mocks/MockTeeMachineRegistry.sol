// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ITeeMachineRegistry} from "../interfaces/ITeeMachineRegistry.sol";

contract MockTeeMachineRegistry is ITeeMachineRegistry {
    address public teeId;

    constructor(address teeId_) {
        teeId = teeId_;
    }

    function getRandomTeeIds(uint256, uint256 count) external view returns (address[] memory teeIds) {
        teeIds = new address[](count);
        for (uint256 i; i < count; ++i) teeIds[i] = teeId;
    }
}

