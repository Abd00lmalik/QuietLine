package extension

import (
	"testing"

	"github.com/quietline/quietline/extension/internal/config"
)

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
