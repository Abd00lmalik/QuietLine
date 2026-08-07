// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

library QuietPolicy {
    uint8 internal constant PROTOCOL_VERSION = 2;
    uint16 internal constant INITIAL_LTV_BPS = 5_000;
    uint16 internal constant WARNING_LTV_BPS = 5_500;
    uint16 internal constant LIQUIDATION_LTV_BPS = 6_500;
    uint16 internal constant LIQUIDATION_DISCOUNT_BPS = 500;
    uint16 internal constant PROTOCOL_SPREAD_BPS = 50;
    uint16 internal constant LATE_SPREAD_BPS = 300;
    uint64 internal constant QUOTE_VALIDITY = 5 minutes;
    uint64 internal constant SETTLEMENT_VALIDITY = 10 minutes;
    uint64 internal constant MATURITY_GRACE = 1 days;
    uint64 internal constant MAX_ORACLE_AGE = 5 minutes;
}
