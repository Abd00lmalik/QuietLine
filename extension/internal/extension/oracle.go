package extension

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/quietline/quietline/extension/internal/ledger"
)

// tee-node forwards every action to the extension's POST /action with a hard 2s
// client timeout (settings.ProxyTimeout, a non-configurable const). A live Coston2
// eth_call to read FTSOv2 through QuietVault routinely takes longer than that, so
// reading the oracle synchronously on the QUOTE hot path made the in-container
// loopback abort with "context deadline exceeded (Client.Timeout exceeded while
// awaiting headers)" even though the quote had already been computed. We keep the
// price warm on a background ticker and serve quotes from it, so /action answers
// well inside the 2s budget.
//
// This does not weaken correctness: the ledger engine independently rejects any
// observation whose FTSO timestamp is older than 300s (see QuoteAtPrice), and the
// cache carries the feed's real timestamp. A served price is at most
// priceCacheMaxAge old by wall clock — far inside that window — and settlement
// (borrow accept, withdrawal, risk tick) always carries its own on-chain price,
// never this cache.
const (
	priceReadTimeout = 10 * time.Second
	// priceRefreshInterval is well under priceCacheMaxAge so the cache is refreshed
	// several times before it could expire — the /action hot path essentially never
	// falls back to a live read. It is also comfortably below the FTSOv2 feed's own
	// update cadence, so polling faster would just re-read an unchanged price.
	priceRefreshInterval = 3 * time.Second
	// priceCacheMaxAge bounds how old a served price may be by wall clock. It is far
	// inside the ledger engine's 300s staleness rejection (see QuoteAtPrice), so a
	// cache hit is always a price the engine would also accept from a live read.
	priceCacheMaxAge = 30 * time.Second
)

var quietVaultOracleABI = mustABI(`[{
	"inputs": [],
	"name": "currentXrpUsdPrice",
	"outputs": [
		{"internalType": "uint64", "name": "priceE6", "type": "uint64"},
		{"internalType": "uint64", "name": "priceTimestamp", "type": "uint64"}
	],
	"stateMutability": "view",
	"type": "function"
}]`)

type priceCache struct {
	mu     sync.RWMutex
	price  ledger.Price
	readAt time.Time
	primed bool
}

func (c *priceCache) get() (ledger.Price, time.Time, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.price, c.readAt, c.primed
}

func (c *priceCache) set(price ledger.Price, at time.Time) {
	c.mu.Lock()
	c.price, c.readAt, c.primed = price, at, true
	c.mu.Unlock()
}

// currentXrpUsdPrice serves the QUOTE hot path. It returns the background-refreshed
// price while it is fresh enough to keep /action inside tee-node's 2s budget, and
// otherwise performs a live read so a stalled refresher surfaces as a real error
// rather than a silently stale quote.
func (e *Extension) currentXrpUsdPrice() (ledger.Price, error) {
	if e.price != nil {
		if price, readAt, ok := e.price.get(); ok && e.clock().Sub(readAt) <= priceCacheMaxAge {
			return price, nil
		}
	}
	price, err := e.readXrpUsdPrice()
	if err != nil {
		return ledger.Price{}, err
	}
	if e.price != nil {
		e.price.set(price, e.clock())
	}
	return price, nil
}

// readXrpUsdPrice performs the live FTSOv2 read through QuietVault. It is kept off
// the /action hot path except as the degraded-mode fallback in currentXrpUsdPrice.
func (e *Extension) readXrpUsdPrice() (ledger.Price, error) {
	data, err := quietVaultOracleABI.Pack("currentXrpUsdPrice")
	if err != nil {
		return ledger.Price{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), priceReadTimeout)
	defer cancel()
	output, err := e.chain.CallContract(ctx, ethereum.CallMsg{
		To:   &e.cfg.Vault,
		Data: data,
	}, nil)
	if err != nil {
		return ledger.Price{}, fmt.Errorf("reading FTSOv2 through QuietVault: %w", err)
	}
	values, err := quietVaultOracleABI.Unpack("currentXrpUsdPrice", output)
	if err != nil || len(values) != 2 {
		return ledger.Price{}, fmt.Errorf("decoding QuietVault price: %w", err)
	}
	price, okPrice := values[0].(uint64)
	updatedAt, okTimestamp := values[1].(uint64)
	if !okPrice || !okTimestamp {
		return ledger.Price{}, fmt.Errorf("QuietVault returned unexpected price types")
	}
	return ledger.Price{XRPUSDE6: price, UpdatedAt: int64(updatedAt)}, nil
}

// startPriceRefresher keeps the price cache warm on a ticker until stop is closed,
// closing done when it exits. It reads once immediately so the cache primes shortly
// after boot without blocking New.
func (e *Extension) startPriceRefresher(stop <-chan struct{}, done chan<- struct{}) {
	defer close(done)
	ticker := time.NewTicker(priceRefreshInterval)
	defer ticker.Stop()
	for {
		if price, err := e.readXrpUsdPrice(); err == nil {
			e.price.set(price, e.clock())
		}
		select {
		case <-stop:
			return
		case <-ticker.C:
		}
	}
}

func mustABI(value string) abi.ABI {
	parsed, err := abi.JSON(strings.NewReader(value))
	if err != nil {
		panic(err)
	}
	return parsed
}
