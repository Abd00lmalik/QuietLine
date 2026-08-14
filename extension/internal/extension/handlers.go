package extension

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	"github.com/quietline/quietline/extension/internal/config"
	"github.com/quietline/quietline/extension/internal/ledger"
	quiettypes "github.com/quietline/quietline/extension/pkg/types"
)

func (e *Extension) handleDeposit(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	sender, token, amount, depositID, err := decodeDeposit(df.OriginalMessage)
	if err == nil {
		var asset string
		asset, err = assetForToken(e.cfg, token)
		if err == nil {
			err = e.engine.Deposit(sender.Hex(), asset, amount, depositID.Hex())
		}
	}
	var anchor *quiettypes.SettlementResponse
	if err == nil {
		anchor, err = e.checkpoint(action.Data.ID, sender)
	}
	data, _ := json.Marshal(quiettypes.MutationResponse{Anchor: derefAnchor(anchor)})
	return buildResult(action, df, data, err)
}

func (e *Extension) handleBorrowAccept(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	sender, ciphertext, priceE6, timestamp, err := decodeBorrow(df.OriginalMessage)
	var req quiettypes.SignedAction
	if err == nil {
		var plain []byte
		plain, err = e.decrypt(ciphertext)
		if err == nil {
			err = json.Unmarshal(plain, &req)
		}
	}
	if err == nil && req.Sender != sender {
		err = errors.New("encrypted acceptance sender does not match transaction sender")
	}
	if err == nil {
		err = e.verifySignedAction(req, config.OPBorrowAccept)
	}
	var payload quiettypes.BorrowAcceptPayload
	if err == nil {
		err = json.Unmarshal(req.Payload, &payload)
	}
	if err == nil {
		payload.Quote.Borrower = sender.Hex()
		err = e.engine.AcceptQuote(payload.Quote, payload.LoanID, req.Nonce, &ledger.Price{XRPUSDE6: priceE6, UpdatedAt: int64(timestamp)})
	}
	var anchor *quiettypes.SettlementResponse
	if err == nil {
		anchor, err = e.anchorSettlement(action.Data.ID, 0, sender, e.cfg.USDT0, payload.Quote.Amount, sender)
	}
	data, _ := json.Marshal(anchor)
	return buildResult(action, df, data, err)
}

func (e *Extension) handleWithdrawal(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	sender, token, amount, destination, err := decodeWithdrawal(df.OriginalMessage)
	var asset string
	if err == nil {
		asset, err = assetForToken(e.cfg, token)
	}
	// Vault-liquidity pre-check, served from the background-refreshed cache (never
	// a live read on this path). It runs BEFORE the engine mutation so an
	// unpayable withdrawal is refused without creating a pending anchor: a
	// settlement that would revert on-chain would otherwise strand the FCC anchor
	// and block every subsequent mutation (WITHDRAW_REQUEST is intentionally not
	// checkpoint-recoverable). Unknown or stale liquidity fails closed.
	if err == nil {
		balance, ok := e.vaultLiquidity(token)
		switch {
		case !ok:
			err = errors.New("vault liquidity is currently unknown; withdrawal refused, retry shortly")
		case balance < amount:
			err = fmt.Errorf("insufficient vault liquidity for withdrawal: %d available, %d requested", balance, amount)
		}
	}
	if err == nil {
		state := e.engine.State()
		acct := state.Accounts[lower(sender)]
		if acct == nil {
			err = errors.New("private account does not exist")
		} else {
			err = e.engine.Withdraw(sender.Hex(), asset, amount, action.Data.ID.Hex(), acct.Nonce)
		}
	}
	var anchor *quiettypes.SettlementResponse
	if err == nil {
		anchor, err = e.anchorSettlement(action.Data.ID, 1, sender, token, amount, destination)
	}
	data, _ := json.Marshal(anchor)
	return buildResult(action, df, data, err)
}

func (e *Extension) handleRiskTick(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	price, timestamp, err := decodeRisk(df.OriginalMessage)
	if err == nil {
		err = e.engine.RiskTick(ledger.Price{XRPUSDE6: price, UpdatedAt: int64(timestamp)}, action.Data.ID.Hex())
	}
	var anchor *quiettypes.SettlementResponse
	if err == nil {
		anchor, err = e.checkpoint(action.Data.ID, common.Address{})
	}
	data, _ := json.Marshal(anchor)
	return buildResult(action, df, data, err)
}

func (e *Extension) handleBackstopDeposit(action teetypes.Action, df *instruction.DataFixed) teetypes.ActionResult {
	funder, amount, depositID, err := decodeBackstopDeposit(df.OriginalMessage)
	if err == nil {
		err = e.engine.SeedBackstop(amount, depositID.Hex())
	}
	var anchor *quiettypes.SettlementResponse
	if err == nil {
		anchor, err = e.checkpoint(action.Data.ID, funder)
	}
	data, _ := json.Marshal(quiettypes.MutationResponse{Anchor: derefAnchor(anchor)})
	return buildResult(action, df, data, err)
}

func (e *Extension) handleSignedDirect(action teetypes.Action, df *instruction.DataFixed, req quiettypes.SignedAction) (int, []byte) {
	var private any
	var anchor *quiettypes.SettlementResponse
	var err error
	switch req.Action {
	case config.OPOpenAccount:
		var p quiettypes.OpenAccountPayload
		err = json.Unmarshal(req.Payload, &p)
		if err == nil {
			err = e.engine.OpenAccount(req.Sender.Hex(), p.OperationID, req.Nonce)
		}
	case config.OPSetMandate:
		var p quiettypes.SetMandatePayload
		err = json.Unmarshal(req.Payload, &p)
		if err == nil {
			err = e.engine.SetMandate(req.Sender.Hex(), p.MandateID, p.Amount, p.MinAPRBPS, p.TermMask, p.PerBorrowerCap, req.Nonce)
		}
	case config.OPCancelMandate:
		var p quiettypes.CancelMandatePayload
		err = json.Unmarshal(req.Payload, &p)
		if err == nil {
			err = e.engine.CancelMandate(req.Sender.Hex(), p.MandateID, req.Nonce)
		}
	case config.OPQuoteRequest:
		var p quiettypes.QuotePayload
		err = json.Unmarshal(req.Payload, &p)
		if err == nil {
			p.Borrower = req.Sender.Hex()
			var price ledger.Price
			price, err = e.currentXrpUsdPrice()
			if err == nil {
				private, err = e.engine.QuoteAtPrice(p, price)
			}
		}
	case config.OPApplyRepayment:
		var p quiettypes.RepaymentPayload
		err = json.Unmarshal(req.Payload, &p)
		if err == nil {
			err = e.engine.Repay(req.Sender.Hex(), p.Amount, p.OperationID, req.Nonce)
		}
	case config.OPAccountQuery:
		private, err = e.accountView(req.Sender)
	case config.OPStressQuery:
		var p quiettypes.StressQueryPayload
		err = json.Unmarshal(req.Payload, &p)
		if err == nil {
			private, err = e.stressView(req.Sender, p.XRPUSDE6)
		}
	default:
		err = fmt.Errorf("unsupported direct action %s", req.Action)
	}
	if err == nil && isMutation(req.Action) {
		anchor, err = e.checkpoint(action.Data.ID, req.Sender)
	}
	var data []byte
	if err == nil {
		plain, _ := json.Marshal(private)
		var cipher []byte
		cipher, err = e.encryptResponse(plain, req.ResponsePublicKey)
		if err == nil {
			data, _ = json.Marshal(quiettypes.SecureResponse{Anchor: anchor, Ciphertext: cipher})
		}
	}
	return resultJSON(action, df, data, err)
}

func isMutation(action string) bool {
	switch action {
	case config.OPOpenAccount, config.OPSetMandate, config.OPCancelMandate, config.OPApplyRepayment:
		return true
	default:
		return false
	}
}

func (e *Extension) accountView(sender common.Address) (quiettypes.PrivateAccountView, error) {
	state := e.engine.State()
	account := state.Accounts[lower(sender)]
	if account == nil {
		return quiettypes.PrivateAccountView{}, errors.New("private account does not exist")
	}
	var loan *ledger.Loan
	if account.LoanID != "" {
		loan = state.Loans[account.LoanID]
	}
	activities := make([]ledger.Activity, 0)
	mandates := make([]*ledger.Mandate, 0)
	for _, mandate := range state.Mandates {
		if mandate.Lender == lower(sender) {
			mandates = append(mandates, mandate)
		}
	}
	for _, item := range state.Activities {
		if item.Account == lower(sender) {
			activities = append(activities, item)
		}
	}
	return quiettypes.PrivateAccountView{Account: account, Loan: loan, Mandates: mandates, Activities: activities, Price: state.Price}, nil
}

func (e *Extension) stressView(sender common.Address, price uint64) (quiettypes.StressView, error) {
	view, err := e.accountView(sender)
	if err != nil || view.Loan == nil {
		return quiettypes.StressView{}, errors.New("no active loan")
	}
	loan := view.Loan
	now := e.clock().Unix()
	elapsed := uint64(0)
	if now > loan.LastAccruedAt {
		elapsed = uint64(now - loan.LastAccruedAt)
	}
	apr := uint64(loan.BorrowerAPRBPS)
	if now > loan.MaturesAt+86400 {
		apr += 300
	}
	debt := loan.Principal + (loan.AccruedInterestRay+loan.Principal*apr*elapsed*ledger.Scale/(ledger.BPS*ledger.Year))/ledger.Scale
	value := loan.CollateralFXRP * price / ledger.Scale
	if value == 0 {
		return quiettypes.StressView{}, errors.New("stress price produces zero collateral value")
	}
	ltv := debt * ledger.BPS / value
	health := uint64(0)
	if ltv > 0 {
		health = 6500 * ledger.BPS / ltv
	}
	status := "healthy"
	if ltv >= 6500 {
		status = "liquidatable"
	} else if ltv >= 5500 {
		status = "warning"
	} else if ltv >= 5000 {
		status = "restricted"
	}
	return quiettypes.StressView{XRPUSDE6: price, Debt: debt, CollateralValue: value, LTVBPS: ltv, HealthFactorBPS: health, Status: status}, nil
}

func derefAnchor(anchor *quiettypes.SettlementResponse) quiettypes.SettlementResponse {
	if anchor == nil {
		return quiettypes.SettlementResponse{}
	}
	return *anchor
}

func decodeDeposit(msg []byte) (common.Address, common.Address, uint64, common.Hash, error) {
	addr, _ := abi.NewType("address", "", nil)
	u256, _ := abi.NewType("uint256", "", nil)
	b32, _ := abi.NewType("bytes32", "", nil)
	values, err := abi.Arguments{{Type: addr}, {Type: addr}, {Type: u256}, {Type: b32}}.Unpack(msg)
	if err != nil {
		return common.Address{}, common.Address{}, 0, common.Hash{}, err
	}
	amount := values[2].(*big.Int)
	if !amount.IsUint64() {
		return common.Address{}, common.Address{}, 0, common.Hash{}, errors.New("amount exceeds uint64")
	}
	return values[0].(common.Address), values[1].(common.Address), amount.Uint64(), values[3].([32]byte), nil
}
func decodeBorrow(msg []byte) (common.Address, []byte, uint64, uint64, error) {
	addr, _ := abi.NewType("address", "", nil)
	bytesTy, _ := abi.NewType("bytes", "", nil)
	u64, _ := abi.NewType("uint64", "", nil)
	values, err := abi.Arguments{{Type: addr}, {Type: bytesTy}, {Type: u64}, {Type: u64}}.Unpack(msg)
	if err != nil {
		return common.Address{}, nil, 0, 0, err
	}
	return values[0].(common.Address), values[1].([]byte), values[2].(uint64), values[3].(uint64), nil
}
func decodeWithdrawal(msg []byte) (common.Address, common.Address, uint64, common.Address, error) {
	addr, _ := abi.NewType("address", "", nil)
	u256, _ := abi.NewType("uint256", "", nil)
	values, err := abi.Arguments{{Type: addr}, {Type: addr}, {Type: u256}, {Type: addr}}.Unpack(msg)
	if err != nil {
		return common.Address{}, common.Address{}, 0, common.Address{}, err
	}
	amount := values[2].(*big.Int)
	if !amount.IsUint64() {
		return common.Address{}, common.Address{}, 0, common.Address{}, errors.New("amount exceeds uint64")
	}
	return values[0].(common.Address), values[1].(common.Address), amount.Uint64(), values[3].(common.Address), nil
}
func decodeRisk(msg []byte) (uint64, uint64, error) {
	u64, _ := abi.NewType("uint64", "", nil)
	values, err := abi.Arguments{{Type: u64}, {Type: u64}}.Unpack(msg)
	if err != nil {
		return 0, 0, err
	}
	return values[0].(uint64), values[1].(uint64), nil
}

func decodeBackstopDeposit(msg []byte) (common.Address, uint64, common.Hash, error) {
	addr, _ := abi.NewType("address", "", nil)
	u256, _ := abi.NewType("uint256", "", nil)
	b32, _ := abi.NewType("bytes32", "", nil)
	values, err := abi.Arguments{{Type: addr}, {Type: u256}, {Type: b32}}.Unpack(msg)
	if err != nil {
		return common.Address{}, 0, common.Hash{}, err
	}
	amount := values[1].(*big.Int)
	if !amount.IsUint64() {
		return common.Address{}, 0, common.Hash{}, errors.New("amount exceeds uint64")
	}
	return values[0].(common.Address), amount.Uint64(), values[2].([32]byte), nil
}

var _ = crypto.Keccak256Hash
