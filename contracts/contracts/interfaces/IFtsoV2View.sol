// SPDX-License-Identifier: MIT
pragma solidity >=0.7.6 <0.9;

interface IFtsoV2View {
    function getFeedByIdInWei(bytes21 feedId) external view returns (uint256 value, uint64 timestamp);
}

