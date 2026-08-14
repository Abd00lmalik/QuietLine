package extension

import (
	"math/big"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"
	"github.com/quietline/quietline/extension/internal/config"
	"github.com/quietline/quietline/extension/internal/ledger"
)

var (
	liquidityTestVault = common.HexToAddress("0x1000000000000000000000000000000000000001")
	liquidityTestUSDT0 = common.HexToAddress("0x2000000000000000000000000000000000000002")
	liquidityTestFXRP  = common.HexToAddress("0x3000000000000000000000000000000000000003")
	liquiditySender    = common.HexToAddress("0x4000000000000000000000000000000000000004")
	liquidityDest      = common.HexToAddress("0x5000000000000000000000000000000000000005")
)

// newLiquidityTestExtension builds an Extension with a real ledger engine, a
// primed liquidity cache shape, and a nil chain client: any code path that tries
// a live read will panic, so passing tests prove the cache-only discipline.
func newLiquidityTestExtension(t *testing.T) (*Extension, *ledger.Engine) {
	t.Helper()
	store, err := ledger.OpenStore(filepath.Join(t.TempDir(), "liquidity.bolt"), []byte("0123456789abcdef0123456789abcdef"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	engine, err := ledger.NewEngine(store)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_785_528_000, 0)
	e := &Extension{
		cfg: config.Config{Vault: liquidityTestVault, USDT0: liquidityTestUSDT0, FXRP: liquidityTestFXRP},
		// chain deliberately nil: a live read anywhere on this path would panic.
		engine:  engine,
		clock:   func() time.Time { return now },
		httpClient: &http.Client{Timeout: 2 * time.Second}, // reached only after a successful mutation (settlement signing)
		liquidity: &vaultLiquidityCache{values: map[common.Address]vaultLiquidityValue{}},
	}
	return e, engine
}

func confirmLiquidityAnchor(t *testing.T, engine *ledger.Engine) {
	t.Helper()
	pending := engine.State().PendingAnchor
	if pending == nil {
		t.Fatal("expected a pending anchor")
	}
	if err := engine.ConfirmAnchor(pending.NextSequence, pending.NextRoot); err != nil {
		t.Fatalf("confirm anchor: %v", err)
	}
}

// runWithdrawal drives handleWithdrawal end-to-end for the test sender: a USDT0
// withdrawal instruction carrying (sender, token, amount, destination).
func runWithdrawal(e *Extension, id string, amount uint64) teetypes.ActionResult {
	addr, _ := abi.NewType("address", "", nil)
	u256, _ := abi.NewType("uint256", "", nil)
	message, _ := abi.Arguments{{Type: addr}, {Type: addr}, {Type: u256}, {Type: addr}}.Pack(
		liquiditySender, e.cfg.USDT0, new(big.Int).SetUint64(amount), liquidityDest,
	)
	action := teetypes.Action{Data: teetypes.ActionData{
		ID:            crypto.Keccak256Hash([]byte(id)),
		Type:          teetypes.Instruction,
		SubmissionTag: teetypes.Threshold,
	}}
	df := &instruction.DataFixed{
		OPType:          teeutils.ToHash(config.OPTypeCredit),
		OPCommand:       teeutils.ToHash(config.OPWithdrawRequest),
		OriginalMessage: hexutil.Bytes(message),
	}
	return e.handleWithdrawal(action, df)
}

// The withdrawal hot path must answer from the warm cache without a chain read;
// a nil chain client makes any real read panic.
func TestVaultLiquidityServesWarmCacheWithoutChainRead(t *testing.T) {
	now := time.Unix(1_785_528_000, 0)
	e := &Extension{
		clock: func() time.Time { return now },
		// chain deliberately nil
		liquidity: &vaultLiquidityCache{values: map[common.Address]vaultLiquidityValue{}},
	}
	e.liquidity.set(liquidityTestUSDT0, 42*ledger.Scale, now)

	got, ok := e.vaultLiquidity(liquidityTestUSDT0)
	if !ok || got != 42*ledger.Scale {
		t.Fatalf("warm cache returned (%d, %t), want (42*Scale, true)", got, ok)
	}
}

// A stale cache must report unknown and fail closed, not fall through to a live
// read: unlike the price path, withdrawals never put a Coston2 round-trip on the
// /action hot path.
func TestVaultLiquidityStaleCacheFailsClosedWithoutChainRead(t *testing.T) {
	now := time.Unix(1_785_528_000, 0)
	clock := now
	e := &Extension{
		clock: func() time.Time { return clock },
		liquidity: &vaultLiquidityCache{values: map[common.Address]vaultLiquidityValue{}},
	}
	e.liquidity.set(liquidityTestUSDT0, 42*ledger.Scale, now)
	clock = now.Add(liquidityCacheMaxAge + time.Second)

	if got, ok := e.vaultLiquidity(liquidityTestUSDT0); ok {
		t.Fatalf("stale cache must report unknown, got (%d, true)", got)
	}
}

// A nil cache (the shape unit tests build by default) must also fail closed.
func TestVaultLiquidityNilCacheFailsClosed(t *testing.T) {
	e := &Extension{clock: time.Now} // liquidity nil
	if got, ok := e.vaultLiquidity(liquidityTestUSDT0); ok || got != 0 {
		t.Fatalf("nil cache must report unknown, got (%d, %t)", got, ok)
	}
}

// The core hardening: a withdrawal must never be authorized when the vault's
// cached liquidity is below the request. The refusal happens before the engine
// mutation, so no pending anchor is created and no state changes.
func TestHandleWithdrawalRefusesWhenVaultLiquidityInsufficient(t *testing.T) {
	e, engine := newLiquidityTestExtension(t)
	if err := engine.Deposit(liquiditySender.Hex(), ledger.AssetUSDT0, 10*ledger.Scale, "dep-liq-insufficient"); err != nil {
		t.Fatal(err)
	}
	confirmLiquidityAnchor(t, engine)
	// The account could withdraw 10, but the vault only holds 5.
	e.liquidity.set(e.cfg.USDT0, 5*ledger.Scale, e.clock())

	before := engine.State()
	result := runWithdrawal(e, "wd-liq-insufficient", 6*ledger.Scale)
	if result.Status != 0 {
		t.Fatalf("expected refusal, got status %d: %s", result.Status, result.Log)
	}
	after := engine.State()
	if after.Root != before.Root || after.Sequence != before.Sequence {
		t.Fatal("refused withdrawal must not mutate state")
	}
	if after.PendingAnchor != nil {
		t.Fatal("refused withdrawal must not create a pending anchor")
	}
	if got := after.Accounts[strings.ToLower(liquiditySender.Hex())].Balances[ledger.AssetUSDT0].Available; got != 10*ledger.Scale {
		t.Fatalf("refused withdrawal must leave the balance untouched, got %d", got)
	}
}

// An unknown (unprimed) cache fails closed the same way: no mutation, no anchor,
// no state change — and no chain read (a nil chain would panic otherwise).
func TestHandleWithdrawalRefusesWhenVaultLiquidityUnknown(t *testing.T) {
	e, engine := newLiquidityTestExtension(t)
	if err := engine.Deposit(liquiditySender.Hex(), ledger.AssetUSDT0, 10*ledger.Scale, "dep-liq-unknown"); err != nil {
		t.Fatal(err)
	}
	confirmLiquidityAnchor(t, engine)
	// Cache deliberately unprimed.

	before := engine.State()
	result := runWithdrawal(e, "wd-liq-unknown", ledger.Scale)
	if result.Status != 0 {
		t.Fatalf("expected refusal, got status %d: %s", result.Status, result.Log)
	}
	after := engine.State()
	if after.Root != before.Root || after.Sequence != before.Sequence {
		t.Fatal("refused withdrawal must not mutate state")
	}
	if after.PendingAnchor != nil {
		t.Fatal("refused withdrawal must not create a pending anchor")
	}
}

// When the cached vault liquidity covers the request the pre-check lets the
// withdrawal through: the engine debits the balance and a pending anchor is
// created. (The settlement signature step then fails in unit tests because there
// is no TEE signer, which happens after the mutation and is irrelevant to the
// gating decision.)
func TestHandleWithdrawalProceedsWhenVaultLiquidityCovers(t *testing.T) {
	e, engine := newLiquidityTestExtension(t)
	if err := engine.Deposit(liquiditySender.Hex(), ledger.AssetUSDT0, 10*ledger.Scale, "dep-liq-ok"); err != nil {
		t.Fatal(err)
	}
	confirmLiquidityAnchor(t, engine)
	e.liquidity.set(e.cfg.USDT0, 10*ledger.Scale, e.clock())

	_ = runWithdrawal(e, "wd-liq-ok", 4*ledger.Scale)
	state := engine.State()
	if got := state.Accounts[strings.ToLower(liquiditySender.Hex())].Balances[ledger.AssetUSDT0].Available; got != 6*ledger.Scale {
		t.Fatalf("authorized withdrawal must debit the balance, got %d", got)
	}
	if state.PendingAnchor == nil {
		t.Fatal("authorized withdrawal must create a pending anchor")
	}
}
