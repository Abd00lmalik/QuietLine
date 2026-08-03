// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IFtsoV2View} from "../interfaces/IFtsoV2View.sol";

contract MockFtsoV2 is IFtsoV2View {
    uint256 public value;
    uint64 public timestamp;

    function setPrice(uint256 value_, uint64 timestamp_) external {
        value = value_;
        timestamp = timestamp_;
    }

    function getFeedByIdInWei(bytes21) external view returns (uint256, uint64) {
        return (value, timestamp);
    }
}

