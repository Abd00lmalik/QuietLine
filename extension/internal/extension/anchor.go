package extension

import (
	"context"
	"encoding/json"
	"errors"
	"math/big"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
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

func (e *Extension) verifyAnchorOnChain(sequence uint64, root string) error {
	ctx, cancel := context.WithTimeout(context.Background(), e.httpClient.Timeout)
	defer cancel()
	call := func(signature string) ([]byte, error) {
		data := crypto.Keccak256([]byte(signature))[:4]
		return e.chain.CallContract(ctx, ethereum.CallMsg{To: &e.cfg.Vault, Data: data}, nil)
	}
	sequenceRaw, err := call("stateSequence()")
	if err != nil {
		return err
	}
	rootRaw, err := call("stateRoot()")
	if err != nil {
		return err
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
