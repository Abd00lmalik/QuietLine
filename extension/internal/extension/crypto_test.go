package extension

import (
	"encoding/json"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/quietline/quietline/extension/internal/config"
	quiettypes "github.com/quietline/quietline/extension/pkg/types"
)

func TestSignedActionDigestMatchesEVMWallet(t *testing.T) {
	req := quiettypes.SignedAction{
		Sender:            common.HexToAddress("0xFCAd0B19bB29D4674531d6f115237E16AfCE377c"),
		Nonce:             0,
		Deadline:          2_000_000_000,
		Action:            config.OPOpenAccount,
		Payload:           json.RawMessage(`{"operationId":"00000000-0000-4000-8000-000000000001"}`),
		ResponsePublicKey: hexutil.MustDecode("0x0411111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111"),
		Signature:         hexutil.MustDecode("0xbe18e63676205fd8754dd9ecb3a47a65cf3eecee0830eade7f4db82a3b7a50ef31e62c38e0d05e5cf520824e72bd71e00ac37062391dca31116ee6d8a315ca431c"),
	}
	digest, err := signedActionDigest(req, 114, common.HexToAddress("0x77257Ea28B27a7a1da87a9a8e150465Adb373d1b"))
	if err != nil {
		t.Fatal(err)
	}
	if want := common.HexToHash("0xc9f08ad3db21fd0fbfcdc83c1f91482def77be137d940966d65337cad5f0b83a"); digest != want {
		t.Fatalf("digest mismatch: got %s, want %s", digest, want)
	}
	signature := append([]byte(nil), req.Signature...)
	if signature[64] >= 27 {
		signature[64] -= 27
	}
	publicKey, err := crypto.SigToPub(digest.Bytes(), signature)
	if err != nil {
		t.Fatal(err)
	}
	if recovered := crypto.PubkeyToAddress(*publicKey); recovered != req.Sender {
		t.Fatalf("recovered %s, want %s", recovered, req.Sender)
	}
}

func TestRequiresCurrentNonce(t *testing.T) {
	readOnly := []string{
		config.OPOpenAccount,
		config.OPAccountQuery,
		config.OPStressQuery,
		config.OPQuoteRequest,
	}
	for _, action := range readOnly {
		if requiresCurrentNonce(action) {
			t.Fatalf("%s should be reconnect-safe and replay-safe", action)
		}
	}

	mutations := []string{
		config.OPSetMandate,
		config.OPCancelMandate,
		config.OPApplyRepayment,
		config.OPBorrowAccept,
	}
	for _, action := range mutations {
		if !requiresCurrentNonce(action) {
			t.Fatalf("%s must consume the current account nonce", action)
		}
	}
}
