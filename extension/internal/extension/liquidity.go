package extension

import (
	"context"
	"fmt"
	"math/big"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/common"
)

const (
	liquidityReadTimeout = 10 * time.Second
	// liquidityRefreshInterval keeps the cached vault balances a few seconds old at
	// worst, so the withdrawal hot path never has to touch the chain itself.
	liquidityRefreshInterval = 3 * time.Second
	// liquidityCacheMaxAge bounds how stale a served balance may be. Beyond it the
	// check fails closed: a withdrawal is refused rather than authorized against a
	// balance the FCC can no longer vouch for. The refresher updates every 3s, so
	// this only trips when the refresher is genuinely stalled, which is exactly
	// when refusing is the safe behaviour.
	liquidityCacheMaxAge = 30 * time.Second
)

var erc20BalanceABI = mustABI(`[{
	"constant": true,
	"inputs": [{"name": "account", "type": "address"}],
	"name": "balanceOf",
	"outputs": [{"name": "", "type": "uint256"}],
	"stateMutability": "view",
	"type": "function"
}]`)

type vaultLiquidityValue struct {
	balance uint64
	readAt  time.Time
}

// vaultLiquidityCache mirrors priceCache: a background refresher keeps the vault's
// token balances warm so /action can answer inside tee-node's 2s ProxyTimeout
// without a live Coston2 read. nil in unit tests that build Extension directly;
// vaultLiquidity then reports the balance as unknown and the withdrawal check
// fails closed.
type vaultLiquidityCache struct {
	mu     sync.RWMutex
	values map[common.Address]vaultLiquidityValue
}

func (c *vaultLiquidityCache) get(token common.Address) (uint64, time.Time, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	value, ok := c.values[token]
	if !ok {
		return 0, time.Time{}, false
	}
	return value.balance, value.readAt, true
}

func (c *vaultLiquidityCache) set(token common.Address, balance uint64, at time.Time) {
	c.mu.Lock()
	c.values[token] = vaultLiquidityValue{balance: balance, readAt: at}
	c.mu.Unlock()
}

// vaultLiquidity returns the cached vault balance for the token only while it is
// fresh. It never reads the chain: the withdrawal check is fail-closed, so an
// absent or stale cache means "unknown" and the withdrawal is refused. Doing a
// live read here would put a Coston2 round-trip on the /action hot path.
func (e *Extension) vaultLiquidity(token common.Address) (uint64, bool) {
	if e.liquidity == nil {
		return 0, false
	}
	balance, readAt, ok := e.liquidity.get(token)
	if !ok || e.clock().Sub(readAt) > liquidityCacheMaxAge {
		return 0, false
	}
	return balance, true
}

// readVaultLiquidity performs the live balanceOf read through the configured
// chain client. It runs only inside the background refresher, never on the
// /action hot path.
func (e *Extension) readVaultLiquidity(token common.Address) (uint64, error) {
	data, err := erc20BalanceABI.Pack("balanceOf", e.cfg.Vault)
	if err != nil {
		return 0, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), liquidityReadTimeout)
	defer cancel()
	output, err := e.chain.CallContract(ctx, ethereum.CallMsg{To: &token, Data: data}, nil)
	if err != nil {
		return 0, fmt.Errorf("reading vault %s liquidity: %w", token.Hex(), err)
	}
	values, err := erc20BalanceABI.Unpack("balanceOf", output)
	if err != nil || len(values) != 1 {
		return 0, fmt.Errorf("decoding vault %s balance: %w", token.Hex(), err)
	}
	balance, ok := values[0].(*big.Int)
	if !ok || !balance.IsUint64() {
		return 0, fmt.Errorf("vault %s balance exceeds uint64", token.Hex())
	}
	return balance.Uint64(), nil
}

// startVaultLiquidityRefresher keeps the vault's token balances warm on a ticker
// until stop is closed, closing done when it exits. It reads once immediately so
// the cache primes shortly after boot without blocking New.
func (e *Extension) startVaultLiquidityRefresher(stop <-chan struct{}, done chan<- struct{}) {
	defer close(done)
	ticker := time.NewTicker(liquidityRefreshInterval)
	defer ticker.Stop()
	tokens := []common.Address{e.cfg.USDT0, e.cfg.FXRP}
	refresh := func() {
		now := e.clock()
		for _, token := range tokens {
			if balance, err := e.readVaultLiquidity(token); err == nil {
				e.liquidity.set(token, balance, now)
			}
		}
	}
	refresh()
	for {
		select {
		case <-stop:
			return
		case <-ticker.C:
			refresh()
		}
	}
}
