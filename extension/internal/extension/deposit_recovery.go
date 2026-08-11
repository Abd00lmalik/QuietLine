package extension

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	"github.com/quietline/quietline/extension/internal/ledger"
	quiettypes "github.com/quietline/quietline/extension/pkg/types"
)

var depositRecordABI = mustABI(`[{
	"inputs":[{"name":"","type":"bytes32"}],
	"name":"depositById",
	"outputs":[
		{"name":"account","type":"address"},
		{"name":"token","type":"address"},
		{"name":"amount","type":"uint256"},
		{"name":"depositedAt","type":"uint64"}
	],
	"stateMutability":"view",
	"type":"function"
}]`)

func (e *Extension) handleDepositRecovery(
	action teetypes.Action,
	df *instruction.DataFixed,
	message []byte,
) (int, []byte) {
	var payload quiettypes.RecoverDepositPayload
	err := json.Unmarshal(message, &payload)
	if err == nil {
		err = e.verifyDepositRecord(payload)
	}
	if err == nil {
		asset, assetErr := assetForToken(e.cfg, payload.Token)
		if assetErr != nil {
			err = assetErr
		} else {
			err = e.engine.Deposit(
				payload.Account.Hex(),
				asset,
				payload.Amount,
				payload.DepositID.Hex(),
			)
		}
	}
	if errors.Is(err, ledger.ErrDuplicate) {
		return resultJSON(
			action,
			df,
			[]byte(`{"result":{"alreadyProcessed":true}}`),
			nil,
		)
	}
	var anchor *quiettypes.SettlementResponse
	if err == nil {
		anchor, err = e.checkpoint(action.Data.ID, payload.Account)
	}
	data, _ := json.Marshal(quiettypes.MutationResponse{Anchor: derefAnchor(anchor)})
	return resultJSON(action, df, data, err)
}

func (e *Extension) verifyDepositRecord(payload quiettypes.RecoverDepositPayload) error {
	if payload.DepositID == (common.Hash{}) ||
		payload.Account == (common.Address{}) ||
		payload.Token == (common.Address{}) ||
		payload.Amount == 0 {
		return errors.New("invalid deposit recovery payload")
	}
	data, err := depositRecordABI.Pack("depositById", payload.DepositID)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), e.httpClient.Timeout)
	defer cancel()
	output, err := e.chain.CallContract(
		ctx,
		ethereum.CallMsg{To: &e.cfg.Vault, Data: data},
		nil,
	)
	if err != nil {
		return fmt.Errorf("reading QuietVault deposit record: %w", err)
	}
	values, err := depositRecordABI.Unpack("depositById", output)
	if err != nil {
		return fmt.Errorf("decoding QuietVault deposit record: %w", err)
	}
	if len(values) != 4 {
		return errors.New("QuietVault returned a malformed deposit record")
	}
	account, accountOK := values[0].(common.Address)
	token, tokenOK := values[1].(common.Address)
	amount, amountOK := values[2].(*big.Int)
	depositedAt, timestampOK := values[3].(uint64)
	if !accountOK || !tokenOK || !amountOK || !timestampOK ||
		!amount.IsUint64() || depositedAt == 0 {
		return errors.New("QuietVault returned invalid deposit record values")
	}
	if account != payload.Account ||
		token != payload.Token ||
		amount.Uint64() != payload.Amount {
		return errors.New("deposit recovery payload does not match QuietVault")
	}
	return nil
}
