// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    uint8 private immutable tokenDecimals;
    constructor(string memory name, string memory symbol, uint8 decimals_) ERC20(name, symbol) { tokenDecimals = decimals_; }
    function decimals() public view override returns (uint8) { return tokenDecimals; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

