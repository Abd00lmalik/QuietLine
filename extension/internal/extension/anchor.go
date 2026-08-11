package extension

import (
	"context"
	"encoding/json"
	"errors"
	"math/big"
	"sync"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	"github.com/quietline/quietline/extension/internal/config"
	quiettypes "github.com/quietline/quietline/extension/pkg/types"
)

func (e *Extension) handleAnchorConfirmation(action teetypes.Action, df *instruction.DataFixed, message []byte) (int, []byte) {
	var payload quiettypes.AnchorConfirmedPayload
	err := json.Unmarshal(message, &payload)
	if err == nil {
		err = e.verifyAnchorOnChain(payload.Sequence, payload.Root)
	}
	if err == nil {
		err = e.engine.ConfirmAnchor(payload.Sequence, payload.Root)
	}
	return resultJSON(action, df, []byte(`{"confirmed":true}`), err)
}

func (e *Extension) handleAnchorRecovery(action teetypes.Action, df *instruction.DataFixed) (int, []byte) {
	state := e.engine.State()
	if state.PendingAnchor == nil {
		return resultJSON(action, df, nil, errors.New("no confidential anchor is pending"))
	}
	if !isRecoverableCheckpoint(state.PendingAnchor.Kind) {
		return resultJSON(
			action,
			df,
			nil,
			errors.New("pending fund-movement anchor requires operator intervention"),
		)
	}
	anchor, err := e.checkpoint(action.Data.ID, common.Address{})
	data, _ := json.Marshal(anchor)
	return resultJSON(action, df, data, err)
}

func isRecoverableCheckpoint(kind string) bool {
	switch kind {
	case config.OPRiskTick,
		config.OPDeposit,
		config.OPBackstopDeposit,
		config.OPOpenAccount,
		config.OPSetMandate,
		config.OPCancelMandate,
		config.OPApplyRepayment:
		return true
	default:
		return false
	}
}

func (e *Extension) verifyAnchorOnChain(sequence uint64, root string) error {
	ctx, cancel := context.WithTimeout(context.Background(), e.httpClient.Timeout)
	defer cancel()
	call := func(signature string) ([]byte, error) {
		data := crypto.Keccak256([]byte(signature))[:4]
		return e.chain.CallContract(ctx, ethereum.CallMsg{To: &e.cfg.Vault, Data: data}, nil)
	}
	// stateSequence() and stateRoot() are independent latest-block view reads. Each
	// is a ~1s Coston2 round-trip, so running them sequentially summed to as much as
	// ~2.3s and could exceed tee-node's 2s ProxyTimeout on ANCHOR_CONFIRMED, leaving
	// a settled anchor perpetually unconfirmed. Overlap the two round-trips so wall
	// time is the slower read, not their sum; both values are still fully verified
	// below, so the check is unchanged.
	var (
		sequenceRaw, rootRaw []byte
		sequenceErr, rootErr error
		wg                   sync.WaitGroup
	)
	wg.Add(2)
	go func() { defer wg.Done(); sequenceRaw, sequenceErr = call("stateSequence()") }()
	go func() { defer wg.Done(); rootRaw, rootErr = call("stateRoot()") }()
	wg.Wait()
	if sequenceErr != nil {
		return sequenceErr
	}
	if rootErr != nil {
		return rootErr
	}
	if len(sequenceRaw) != 32 || len(rootRaw) != 32 {
		return errors.New("vault returned malformed anchor state")
	}
	onChainSequence := new(big.Int).SetBytes(sequenceRaw)
	if !onChainSequence.IsUint64() || onChainSequence.Uint64() != sequence {
		return errors.New("vault sequence does not match confirmation")
	}
	if common.BytesToHash(rootRaw) != common.HexToHash(root) {
		return errors.New("vault root does not match confirmation")
	}
	return nil
}
