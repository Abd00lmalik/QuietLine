package extension

import (
	"testing"
	"time"

	"github.com/quietline/quietline/extension/internal/ledger"
)

// The QUOTE hot path must answer from the warm cache without a chain read, or
// tee-node's 2s ProxyTimeout aborts /action. A nil chain client makes any real
// read panic, so a passing test proves the cached branch never touches the chain.
func TestCurrentXrpUsdPriceServesWarmCacheWithoutChainRead(t *testing.T) {
	now := time.Unix(1_785_528_000, 0)
	e := &Extension{
		price: &priceCache{},
		clock: func() time.Time { return now },
		// chain deliberately nil: a cache miss would dereference it and panic.
	}
	want := ledger.Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}
	e.price.set(want, now)

	got, err := e.currentXrpUsdPrice()
	if err != nil {
		t.Fatalf("warm cache read errored: %v", err)
	}
	if got != want {
		t.Fatalf("warm cache returned %+v, want %+v", got, want)
	}
}

// A price older than priceCacheMaxAge must not be served from cache; the reader
// falls through to a live read (here nil chain) rather than returning a stale price.
func TestCurrentXrpUsdPriceRejectsExpiredCache(t *testing.T) {
	now := time.Unix(1_785_528_000, 0)
	clock := now
	e := &Extension{
		price: &priceCache{},
		clock: func() time.Time { return clock },
	}
	e.price.set(ledger.Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, now)
	clock = now.Add(priceCacheMaxAge + time.Second)

	defer func() {
		if recover() == nil {
			t.Fatal("expired cache should fall through to a live read, not serve the stale value")
		}
	}()
	_, _ = e.currentXrpUsdPrice() // nil chain -> panic proves the live path was taken
}

// A nil price cache (the shape used by unit tests that build Extension directly)
// must fall through to a live read rather than panicking on the cache access.
func TestCurrentXrpUsdPriceNilCacheFallsThrough(t *testing.T) {
	e := &Extension{clock: time.Now}
	defer func() {
		if recover() == nil {
			t.Fatal("nil cache should reach the live read (nil chain panics), not short-circuit")
		}
	}()
	_, _ = e.currentXrpUsdPrice()
}
