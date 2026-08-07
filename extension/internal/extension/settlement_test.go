package extension

import (
	"math/big"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/quietline/quietline/extension/internal/config"
	quiettypes "github.com/quietline/quietline/extension/pkg/types"
)

func TestPackSettlementMatchesSolidityABIShape(t *testing.T) {
	e := &Extension{cfg: config.Config{ChainID: 114, ExtensionID: 65_536, Vault: common.HexToAddress("0x1000000000000000000000000000000000000001")}}
	s := quiettypes.Settlement{ProtocolVersion: 2, SettlementType: 0, Account: common.HexToAddress("0x2000000000000000000000000000000000000002"), Token: common.HexToAddress("0x3000000000000000000000000000000000000003"), Amount: 3_000_000, Destination: common.HexToAddress("0x4000000000000000000000000000000000000004"), RequestID: crypto.Keccak256Hash([]byte("request")), SettlementID: crypto.Keccak256Hash([]byte("settlement")), PreviousSequence: 7, NextSequence: 8, PreviousRoot: crypto.Keccak256Hash([]byte("root-7")), NextRoot: crypto.Keccak256Hash([]byte("root-8")), Deadline: uint64(time.Now().Add(time.Minute).Unix())}
	got, err := e.packSettlement(s)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 17*32 {
		t.Fatalf("unexpected ABI length: %d", len(got))
	}
	uint256Ty, _ := abi.NewType("uint256", "", nil)
	values, err := abi.Arguments{{Type: uint256Ty}}.Unpack(got[32:64])
	if err != nil {
		t.Fatal(err)
	}
	if values[0].(*big.Int).Uint64() != 114 {
		t.Fatal("chain id was not domain-bound")
	}
	if common.BytesToAddress(got[64+12:96]) != e.cfg.Vault {
		t.Fatal("vault was not domain-bound")
	}
}

func TestRecoverableCheckpointKinds(t *testing.T) {
	recoverable := []string{
		config.OPRiskTick,
		config.OPDeposit,
		config.OPBackstopDeposit,
		config.OPOpenAccount,
		config.OPSetMandate,
		config.OPCancelMandate,
		config.OPApplyRepayment,
	}
	for _, kind := range recoverable {
		if !isRecoverableCheckpoint(kind) {
			t.Fatalf("%s should be recoverable as a checkpoint", kind)
		}
	}
	for _, kind := range []string{config.OPBorrowAccept, config.OPWithdrawRequest} {
		if isRecoverableCheckpoint(kind) {
			t.Fatalf("%s must not be recoverable without fund-movement details", kind)
		}
	}
}

func TestNormalizeEthereumSignature(t *testing.T) {
	for recoveryID, want := range map[byte]byte{0: 27, 1: 28, 27: 27, 28: 28} {
		signature := make([]byte, 65)
		signature[64] = recoveryID
		got, err := normalizeEthereumSignature(signature)
		if err != nil {
			t.Fatalf("normalizing recovery id %d: %v", recoveryID, err)
		}
		if got[64] != want {
			t.Fatalf("recovery id %d normalized to %d, want %d", recoveryID, got[64], want)
		}
	}

	invalid := make([]byte, 65)
	invalid[64] = 2
	if _, err := normalizeEthereumSignature(invalid); err == nil {
		t.Fatal("invalid recovery id should be rejected")
	}
}
