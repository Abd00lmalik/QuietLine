// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {QuietPolicy} from "./QuietPolicy.sol";
import {ITeeExtensionRegistry} from "./interfaces/ITeeExtensionRegistry.sol";
import {ITeeMachineRegistry} from "./interfaces/ITeeMachineRegistry.sol";
import {IFtsoV2View} from "./interfaces/IFtsoV2View.sol";

contract QuietVault is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using MessageHashUtils for bytes32;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant OP_TYPE_CREDIT = bytes32("CREDIT");
    bytes32 public constant OP_DEPOSIT = bytes32("DEPOSIT");
    bytes32 public constant OP_BORROW_ACCEPT = bytes32("BORROW_ACCEPT");
    bytes32 public constant OP_WITHDRAW_REQUEST = bytes32("WITHDRAW_REQUEST");
    bytes32 public constant OP_BACKSTOP_DEPOSIT = bytes32("BACKSTOP_DEPOSIT");
    bytes32 public constant OP_RISK_TICK = bytes32("RISK_TICK");
    bytes32 public constant SETTLEMENT_DOMAIN = keccak256("QUIETLINE_SETTLEMENT_V2");
    uint256 private constant FIRST_PUBLIC_EXTENSION_ID = 0x10000;
    uint8 private constant TEE_STATUS_PRODUCTION = 2;

    enum SettlementType { BorrowPayout, UserWithdrawal, Checkpoint }

    struct Settlement {
        uint8 protocolVersion;
        SettlementType settlementType;
        address account;
        address token;
        uint256 amount;
        address destination;
        bytes32 requestId;
        bytes32 settlementId;
        uint64 previousSequence;
        uint64 nextSequence;
        bytes32 previousRoot;
        bytes32 nextRoot;
        uint64 deadline;
    }

    struct DepositRecord {
        address account;
        address token;
        uint256 amount;
        uint64 submittedAt;
    }

    error UnsupportedAsset();
    error InvalidAmount();
    error InvalidDestination();
    error FeeOnTransferUnsupported();
    error InvalidSettlement();
    error SettlementAlreadyUsed();
    error SettlementExpired();
    error InvalidStateTransition();
    error InvalidTeeSignature();
    error InsufficientVaultLiquidity();
    error InvalidOraclePrice();
    error StaleOraclePrice();

    event DepositSubmitted(bytes32 indexed depositId, address indexed account, address indexed token, uint256 amount, bytes32 requestId);
    event ConfidentialRequestSubmitted(bytes32 indexed requestId, bytes32 indexed command, address indexed account);
    event BackstopFunded(bytes32 indexed depositId, address indexed funder, uint256 amount, bytes32 requestId);
    event SettlementExecuted(bytes32 indexed settlementId, SettlementType indexed settlementType, address indexed account, uint64 sequence, bytes32 stateRoot);
    event ExtensionConfigured(uint256 indexed extensionId);
    event TeeSignerConfigured(address indexed signer);

    ITeeExtensionRegistry public immutable teeExtensionRegistry;
    ITeeMachineRegistry public immutable teeMachineRegistry;
    IFtsoV2View public immutable ftsoV2;
    bytes21 public immutable xrpUsdFeedId;
    address public immutable fxrp;
    address public immutable usdt0;

    uint256 public extensionId;
    address public activeTeeSigner;
    uint64 public stateSequence;
    bytes32 public stateRoot;
    uint64 public depositNonce;

    mapping(address asset => bool) public supportedAsset;
    mapping(bytes32 settlementId => bool) public usedSettlementId;
    mapping(bytes32 depositId => DepositRecord) public depositById;

    constructor(address extensionRegistry, address machineRegistry, address ftsoV2_, bytes21 xrpUsdFeedId_, address fxrp_, address usdt0_, address admin, address operator) {
        if (extensionRegistry == address(0) || machineRegistry == address(0) || ftsoV2_ == address(0) || xrpUsdFeedId_ == bytes21(0) || fxrp_ == address(0) || usdt0_ == address(0) || admin == address(0)) revert InvalidDestination();
        if (extensionRegistry.code.length == 0 || machineRegistry.code.length == 0 || ftsoV2_.code.length == 0) revert InvalidDestination();
        teeExtensionRegistry = ITeeExtensionRegistry(extensionRegistry);
        teeMachineRegistry = ITeeMachineRegistry(machineRegistry);
        ftsoV2 = IFtsoV2View(ftsoV2_);
        xrpUsdFeedId = xrpUsdFeedId_;
        fxrp = fxrp_;
        usdt0 = usdt0_;
        supportedAsset[fxrp_] = true;
        supportedAsset[usdt0_] = true;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(OPERATOR_ROLE, operator == address(0) ? admin : operator);
    }

    function setExtensionId(uint256 id) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (
            extensionId != 0
                || id < FIRST_PUBLIC_EXTENSION_ID
                || teeExtensionRegistry.getTeeExtensionInstructionsSender(id) != address(this)
        ) revert InvalidSettlement();
        extensionId = id;
        emit ExtensionConfigured(id);
    }

    function setTeeSigner(address signer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (signer == address(0)) revert InvalidDestination();
        if (!isAuthorizedTeeSigner(signer)) revert InvalidTeeSignature();
        activeTeeSigner = signer;
        emit TeeSignerConfigured(signer);
    }

    function isAuthorizedTeeSigner(address signer) public view returns (bool) {
        if (signer == address(0) || extensionId == 0) return false;
        try teeMachineRegistry.getExtensionId(signer) returns (uint256 signerExtensionId) {
            if (signerExtensionId != extensionId) return false;
        } catch {
            return false;
        }
        try teeMachineRegistry.getTeeMachineStatus(signer) returns (uint8 status) {
            return status == TEE_STATUS_PRODUCTION;
        } catch {
            return false;
        }
    }

    function pause() external onlyRole(OPERATOR_ROLE) { _pause(); }
    function unpause() external onlyRole(OPERATOR_ROLE) { _unpause(); }

    function deposit(address token, uint256 amount) external payable nonReentrant returns (bytes32 depositId, bytes32 requestId) {
        if (!supportedAsset[token]) revert UnsupportedAsset();
        if (amount == 0 || amount > type(uint64).max) revert InvalidAmount();

        uint256 beforeBalance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - beforeBalance;
        if (received != amount) revert FeeOnTransferUnsupported();

        uint64 nonce = ++depositNonce;
        depositId = keccak256(abi.encode(block.chainid, address(this), msg.sender, token, amount, nonce));
        depositById[depositId] = DepositRecord(msg.sender, token, amount, uint64(block.timestamp));
        requestId = _send(OP_DEPOSIT, abi.encode(msg.sender, token, amount, depositId));
        emit DepositSubmitted(depositId, msg.sender, token, amount, requestId);
    }

    function requestBorrow(bytes calldata encryptedAcceptance) external payable whenNotPaused returns (bytes32 requestId) {
        if (encryptedAcceptance.length == 0) revert InvalidAmount();
        (uint64 priceE6, uint64 priceTimestamp) = currentXrpUsdPrice();
        requestId = _send(OP_BORROW_ACCEPT, abi.encode(msg.sender, encryptedAcceptance, priceE6, priceTimestamp));
        emit ConfidentialRequestSubmitted(requestId, OP_BORROW_ACCEPT, msg.sender);
    }

    function requestWithdrawal(address token, uint256 amount, address destination) external payable returns (bytes32 requestId) {
        if (!supportedAsset[token]) revert UnsupportedAsset();
        if (amount == 0 || amount > type(uint64).max) revert InvalidAmount();
        if (destination == address(0)) revert InvalidDestination();
        requestId = _send(OP_WITHDRAW_REQUEST, abi.encode(msg.sender, token, amount, destination));
        emit ConfidentialRequestSubmitted(requestId, OP_WITHDRAW_REQUEST, msg.sender);
    }

    function requestRiskTick() external payable returns (bytes32 requestId) {
        (uint64 priceE6, uint64 priceTimestamp) = currentXrpUsdPrice();
        requestId = _send(OP_RISK_TICK, abi.encode(priceE6, priceTimestamp));
        emit ConfidentialRequestSubmitted(requestId, OP_RISK_TICK, msg.sender);
    }

    function fundBackstop(uint256 amount) external payable onlyRole(OPERATOR_ROLE) nonReentrant returns (bytes32 depositId, bytes32 requestId) {
        if (amount == 0 || amount > type(uint64).max) revert InvalidAmount();
        uint256 beforeBalance = IERC20(usdt0).balanceOf(address(this));
        IERC20(usdt0).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(usdt0).balanceOf(address(this)) - beforeBalance;
        if (received != amount) revert FeeOnTransferUnsupported();
        uint64 nonce = ++depositNonce;
        depositId = keccak256(abi.encode(block.chainid, address(this), msg.sender, usdt0, amount, nonce, OP_BACKSTOP_DEPOSIT));
        requestId = _send(OP_BACKSTOP_DEPOSIT, abi.encode(msg.sender, amount, depositId));
        emit BackstopFunded(depositId, msg.sender, amount, requestId);
        emit ConfidentialRequestSubmitted(requestId, OP_BACKSTOP_DEPOSIT, msg.sender);
    }

    function currentXrpUsdPrice() public view returns (uint64 priceE6, uint64 priceTimestamp) {
        (uint256 valueWei, uint64 timestamp) = ftsoV2.getFeedByIdInWei(xrpUsdFeedId);
        if (valueWei == 0 || valueWei / 1e12 > type(uint64).max) revert InvalidOraclePrice();
        if (timestamp > block.timestamp || block.timestamp - timestamp > QuietPolicy.MAX_ORACLE_AGE) revert StaleOraclePrice();
        return (uint64(valueWei / 1e12), timestamp);
    }

    function settlementHash(Settlement calldata settlement) public view returns (bytes32) {
        return keccak256(abi.encode(
            SETTLEMENT_DOMAIN,
            block.chainid,
            address(this),
            extensionId,
            settlement.protocolVersion,
            settlement.settlementType,
            settlement.account,
            settlement.token,
            settlement.amount,
            settlement.destination,
            settlement.requestId,
            settlement.settlementId,
            settlement.previousSequence,
            settlement.nextSequence,
            settlement.previousRoot,
            settlement.nextRoot,
            settlement.deadline
        ));
    }

    function executeSettlement(Settlement calldata settlement, bytes calldata signature) external nonReentrant {
        if (settlement.protocolVersion != QuietPolicy.PROTOCOL_VERSION) revert InvalidSettlement();
        if (usedSettlementId[settlement.settlementId]) revert SettlementAlreadyUsed();
        if (settlement.deadline < block.timestamp) revert SettlementExpired();
        if (settlement.previousSequence != stateSequence || settlement.nextSequence != stateSequence + 1 || settlement.previousRoot != stateRoot || settlement.nextRoot == bytes32(0)) revert InvalidStateTransition();

        bool checkpoint = settlement.settlementType == SettlementType.Checkpoint;
        if (checkpoint) {
            if (settlement.token != address(0) || settlement.amount != 0 || settlement.destination != address(0)) revert InvalidSettlement();
        } else {
            if (!supportedAsset[settlement.token]) revert UnsupportedAsset();
            if (settlement.amount == 0 || settlement.amount > type(uint64).max) revert InvalidAmount();
            if (settlement.destination == address(0)) revert InvalidDestination();
        }

        if (settlement.settlementType == SettlementType.BorrowPayout) {
            if (paused()) revert EnforcedPause();
            if (settlement.token != usdt0) revert InvalidSettlement();
            if (IERC20(usdt0).balanceOf(address(this)) < settlement.amount) revert InsufficientVaultLiquidity();
        }

        address recovered = ECDSA.recover(settlementHash(settlement).toEthSignedMessageHash(), signature);
        if (!isAuthorizedTeeSigner(recovered)) revert InvalidTeeSignature();

        usedSettlementId[settlement.settlementId] = true;
        stateSequence = settlement.nextSequence;
        stateRoot = settlement.nextRoot;

        if (!checkpoint) IERC20(settlement.token).safeTransfer(settlement.destination, settlement.amount);
        emit SettlementExecuted(settlement.settlementId, settlement.settlementType, settlement.account, settlement.nextSequence, settlement.nextRoot);
    }

    function _send(bytes32 command, bytes memory message) private returns (bytes32) {
        if (extensionId == 0) revert InvalidSettlement();
        address[] memory teeIds = teeMachineRegistry.getRandomTeeIds(extensionId, 1);
        address[] memory cosigners = new address[](0);
        ITeeExtensionRegistry.TeeInstructionParams memory params = ITeeExtensionRegistry.TeeInstructionParams({
            opType: OP_TYPE_CREDIT,
            opCommand: command,
            message: message,
            cosigners: cosigners,
            cosignersThreshold: 0,
            claimBackAddress: msg.sender
        });
        return teeExtensionRegistry.sendInstructions{value: msg.value}(teeIds, params);
    }
}
