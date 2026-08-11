package extension

import (
	"testing"
	"time"
)

// tee-node aborts POST /action after a hard 2s ProxyTimeout. Every on-chain read on
// an /action path (verifyAnchorOnChain, verifyDepositRecord) is bounded by
// actionChainReadTimeout so the handler returns a result the relayer can act on —
// a retryable confirmation or a RECOVER_DEPOSIT — instead of having the loopback cut
// mid-read. If this bound is ever raised back toward the 15s httpClient timeout, the
// deposit-stranding regression ("Vault confirmed; waiting for FCC") returns.
func TestActionChainReadTimeoutStaysWithinProxyBudget(t *testing.T) {
	const proxyTimeout = 2 * time.Second
	if actionChainReadTimeout >= proxyTimeout {
		t.Fatalf(
			"actionChainReadTimeout %v must stay under tee-node's %v /action ProxyTimeout",
			actionChainReadTimeout, proxyTimeout,
		)
	}
}
