package extension

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/crypto"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	"github.com/quietline/quietline/extension/internal/config"
	"github.com/quietline/quietline/extension/internal/ledger"
	quiettypes "github.com/quietline/quietline/extension/pkg/types"
)

func (e *Extension) anchorSettlement(requestID common.Hash, settlementType uint8, account, token common.Address, amount uint64, destination common.Address) (*quiettypes.SettlementResponse, error) {
	state := e.engine.State()
	pending := state.PendingAnchor
	if pending == nil {
		return nil, errors.New("mutation did not produce a pending anchor")
	}
	nextRoot := common.HexToHash(pending.NextRoot)
	settlement := quiettypes.Settlement{
		ProtocolVersion: 2, SettlementType: settlementType, Account: account, Token: token,
		Amount: amount, Destination: destination, RequestID: requestID,
		SettlementID:     crypto.Keccak256Hash(requestID.Bytes(), nextRoot.Bytes(), []byte(pending.Kind)),
		PreviousSequence: pending.PreviousSequence, NextSequence: pending.NextSequence,
		PreviousRoot: common.HexToHash(pending.PreviousRoot), NextRoot: nextRoot,
		Deadline: uint64(e.clock().Add(10 * time.Minute).Unix()),
	}
	preimage, err := e.packSettlement(settlement)
	if err != nil {
		return nil, err
	}
	signature, err := e.signWithTEE(preimage)
	if err != nil {
		return nil, err
	}
	return &quiettypes.SettlementResponse{Settlement: settlement, Signature: signature}, nil
}

func (e *Extension) checkpoint(requestID common.Hash, account common.Address) (*quiettypes.SettlementResponse, error) {
	return e.anchorSettlement(requestID, 2, account, common.Address{}, 0, common.Address{})
}

func (e *Extension) packSettlement(s quiettypes.Settlement) ([]byte, error) {
	bytes32Ty, _ := abi.NewType("bytes32", "", nil)
	uint256Ty, _ := abi.NewType("uint256", "", nil)
	addressTy, _ := abi.NewType("address", "", nil)
	uint8Ty, _ := abi.NewType("uint8", "", nil)
	uint64Ty, _ := abi.NewType("uint64", "", nil)
	args := abi.Arguments{
		{Type: bytes32Ty}, {Type: uint256Ty}, {Type: addressTy}, {Type: uint256Ty},
		{Type: uint8Ty}, {Type: uint8Ty}, {Type: addressTy}, {Type: addressTy}, {Type: uint256Ty}, {Type: addressTy},
		{Type: bytes32Ty}, {Type: bytes32Ty}, {Type: uint64Ty}, {Type: uint64Ty}, {Type: bytes32Ty}, {Type: bytes32Ty}, {Type: uint64Ty},
	}
	return args.Pack(
		crypto.Keccak256Hash([]byte("QUIETLINE_SETTLEMENT_V2")),
		new(big.Int).SetUint64(e.cfg.ChainID), e.cfg.Vault, new(big.Int).SetUint64(e.cfg.ExtensionID),
		s.ProtocolVersion, s.SettlementType, s.Account, s.Token, new(big.Int).SetUint64(s.Amount), s.Destination,
		s.RequestID, s.SettlementID, s.PreviousSequence, s.NextSequence, s.PreviousRoot, s.NextRoot, s.Deadline,
	)
}

func (e *Extension) signWithTEE(message []byte) (hexutil.Bytes, error) {
	body, _ := json.Marshal(teetypes.SignRequest{Message: message})
	resp, err := e.httpClient.Post(fmt.Sprintf("http://localhost:%d/sign", e.cfg.SignPort), "application/json", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("POST /sign: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("sign server returned %d", resp.StatusCode)
	}
	var out teetypes.SignResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	if len(out.Signature) != 65 {
		return nil, errors.New("TEE returned an invalid signature")
	}
	return normalizeEthereumSignature(out.Signature)
}

func normalizeEthereumSignature(signature []byte) (hexutil.Bytes, error) {
	if len(signature) != 65 {
		return nil, errors.New("TEE returned an invalid signature")
	}
	normalized := append(hexutil.Bytes(nil), signature...)
	if normalized[64] <= 1 {
		normalized[64] += 27
	}
	if normalized[64] != 27 && normalized[64] != 28 {
		return nil, errors.New("TEE returned an invalid recovery id")
	}
	return normalized, nil
}

func assetForToken(cfg config.Config, token common.Address) (string, error) {
	switch token {
	case cfg.FXRP:
		return ledger.AssetFXRP, nil
	case cfg.USDT0:
		return ledger.AssetUSDT0, nil
	default:
		return "", errors.New("unsupported asset")
	}
}
