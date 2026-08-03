package ledger

import (
	"errors"
	"path/filepath"
	"testing"
	"time"
)

var testKey = []byte("0123456789abcdef0123456789abcdef")

func newTestEngine(t *testing.T) (*Engine, *Store, *time.Time) {
	t.Helper()
	store, err := OpenStore(filepath.Join(t.TempDir(), "quietline.bolt"), testKey)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	engine, err := NewEngine(store)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 7, 31, 12, 0, 0, 0, time.UTC)
	engine.clock = func() time.Time { return now }
	return engine, store, &now
}

func confirmPending(t *testing.T, e *Engine) {
	t.Helper()
	pending := e.State().PendingAnchor
	if pending == nil {
		t.Fatal("expected a pending anchor")
	}
	if err := e.ConfirmAnchor(pending.NextSequence, pending.NextRoot); err != nil {
		t.Fatalf("confirm anchor: %v", err)
	}
	if err := e.ConfirmAnchor(pending.NextSequence, pending.NextRoot); err != nil {
		t.Fatalf("repeat anchor confirmation must be idempotent: %v", err)
	}
}

func seedCanonical(t *testing.T, e *Engine, now time.Time) {
	t.Helper()
	steps := []struct {
		name string
		fn   func() error
	}{
		{"price", func() error { return e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-1") }},
		{"lender one deposit", func() error { return e.Deposit("0xLender1", AssetUSDT0, 10*Scale, "dep-l1") }},
		{"lender two deposit", func() error { return e.Deposit("0xLender2", AssetUSDT0, 10*Scale, "dep-l2") }},
		{"borrower deposit", func() error { return e.Deposit("0xBorrower", AssetFXRP, 10*Scale, "dep-b") }},
		{"mandate one", func() error { return e.SetMandate("0xLender1", "mandate-1", 10*Scale, 750, 7, 2*Scale, 0) }},
		{"mandate two", func() error { return e.SetMandate("0xLender2", "mandate-2", 10*Scale, 900, 3, 2*Scale, 0) }},
	}
	for _, step := range steps {
		if err := step.fn(); err != nil {
			t.Fatalf("%s: %v", step.name, err)
		}
		confirmPending(t, e)
	}
}

func TestCanonicalTwoLenderQuoteAndAccept(t *testing.T) {
	e, _, now := newTestEngine(t)
	seedCanonical(t, e, *now)
	quote, err := e.Quote(QuoteRequest{ID: "quote-1", Borrower: "0xBorrower", Amount: 3 * Scale, TermDays: 14, MaxAPRBPS: 1200, CollateralFXRP: 10 * Scale, ExpiresAt: now.Add(5 * time.Minute).Unix()})
	if err != nil {
		t.Fatal(err)
	}
	if quote.LenderAPRBPS != 800 || quote.BorrowerAPRBPS != 850 {
		t.Fatalf("unexpected rates: lender=%d borrower=%d", quote.LenderAPRBPS, quote.BorrowerAPRBPS)
	}
	if len(quote.Tranches) != 2 || quote.Tranches[0].Principal != 2*Scale || quote.Tranches[1].Principal != Scale {
		t.Fatalf("unexpected tranches: %+v", quote.Tranches)
	}
	if err := e.AcceptQuote(quote, "loan-1", 0, nil); err != nil {
		t.Fatal(err)
	}
	state := e.State()
	loan := state.Loans["loan-1"]
	if state.ActiveDebt != 3*Scale || loan == nil || loan.Status != "restricted" {
		t.Fatalf("loan not active: %+v", loan)
	}
	if state.Accounts["0xborrower"].Balances[AssetFXRP].Reserved != 10*Scale {
		t.Fatal("collateral was not reserved")
	}
}

func TestQuoteDoesNotReserveAndAcceptanceRevalidates(t *testing.T) {
	e, _, now := newTestEngine(t)
	seedCanonical(t, e, *now)
	request := QuoteRequest{ID: "quote-race", Borrower: "0xBorrower", Amount: 3 * Scale, TermDays: 14, MaxAPRBPS: 1200, CollateralFXRP: 10 * Scale, ExpiresAt: now.Add(5 * time.Minute).Unix()}
	q, err := e.Quote(request)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.CancelMandate("0xLender2", "mandate-2", 1); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	if err := e.AcceptQuote(q, "loan-race", 0, nil); !errors.Is(err, ErrLiquidityChanged) {
		t.Fatalf("expected liquidity changed, got %v", err)
	}
}

func TestFullRepaymentConservesPrincipalAndReleasesCollateral(t *testing.T) {
	e, _, now := newTestEngine(t)
	seedCanonical(t, e, *now)
	q, _ := e.Quote(QuoteRequest{ID: "quote-close", Borrower: "0xBorrower", Amount: 3 * Scale, TermDays: 14, MaxAPRBPS: 1200, CollateralFXRP: 10 * Scale, ExpiresAt: now.Add(5 * time.Minute).Unix()})
	if err := e.AcceptQuote(q, "loan-close", 0, nil); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	*now = now.Add(7 * 24 * time.Hour)
	if err := e.Deposit("0xBorrower", AssetUSDT0, 4*Scale, "repay-deposit"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	if err := e.Repay("0xBorrower", 4*Scale, "repay-1", 1); err != nil {
		t.Fatal(err)
	}
	state := e.State()
	if state.ActiveDebt != 0 || state.Loans["loan-close"].Status != "closed" {
		t.Fatal("loan did not close")
	}
	if state.Accounts["0xborrower"].Balances[AssetFXRP].Available != 10*Scale {
		t.Fatal("collateral was not released")
	}
	if state.Accounts["0xlender1"].Balances[AssetUSDT0].Available <= 2*Scale {
		t.Fatal("first lender did not receive principal and yield")
	}
	if state.ProtocolReserve == 0 {
		t.Fatal("protocol spread was not credited")
	}
	var accounted uint64
	for _, acct := range state.Accounts {
		balance := acct.Balances[AssetUSDT0]
		accounted += balance.Available + balance.Reserved
	}
	accounted += state.ProtocolReserve + state.BackstopUSDT0
	if accounted != 21*Scale {
		t.Fatalf("repayment accounting did not conserve vault claims: got %d, want %d", accounted, 21*Scale)
	}
}

func TestRiskTickRejectsStaleAndFutureObservations(t *testing.T) {
	e, _, now := newTestEngine(t)
	if err := e.RiskTick(
		Price{XRPUSDE6: 600_000, UpdatedAt: now.Add(-301 * time.Second).Unix()},
		"stale-risk",
	); err == nil {
		t.Fatal("expected stale risk observation to be rejected")
	}
	if err := e.RiskTick(
		Price{XRPUSDE6: 600_000, UpdatedAt: now.Add(time.Second).Unix()},
		"future-risk",
	); err == nil {
		t.Fatal("expected future risk observation to be rejected")
	}
	if e.State().Sequence != 0 {
		t.Fatal("rejected risk observations must not mutate state")
	}
}

func TestDepositAndBackstopRejectUint64Overflow(t *testing.T) {
	e, _, _ := newTestEngine(t)
	if err := e.Deposit("0xAlice", AssetUSDT0, ^uint64(0), "max-deposit"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	if err := e.Deposit("0xAlice", AssetUSDT0, 1, "overflow-deposit"); err == nil {
		t.Fatal("expected private balance overflow to be rejected")
	}

	e2, _, _ := newTestEngine(t)
	if err := e2.SeedBackstop(^uint64(0), "max-backstop"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e2)
	if err := e2.SeedBackstop(1, "overflow-backstop"); err == nil {
		t.Fatal("expected backstop overflow to be rejected")
	}
}

func TestRiskTickAndBackstopLiquidation(t *testing.T) {
	e, _, now := newTestEngine(t)
	seedCanonical(t, e, *now)
	if err := e.SeedBackstop(10*Scale, "backstop-1"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	q, _ := e.Quote(QuoteRequest{ID: "quote-liquidate", Borrower: "0xBorrower", Amount: 3 * Scale, TermDays: 14, MaxAPRBPS: 1200, CollateralFXRP: 10 * Scale, ExpiresAt: now.Add(5 * time.Minute).Unix()})
	if err := e.AcceptQuote(q, "loan-liquidate", 0, nil); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	*now = now.Add(7 * 24 * time.Hour)
	if err := e.RiskTick(Price{XRPUSDE6: 400_000, UpdatedAt: now.Unix()}, "price-crash"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	state := e.State()
	if state.ActiveDebt != 0 || state.BackstopFXRP == 0 || state.Loans["loan-liquidate"].Status != "liquidated" {
		t.Fatal("liquidation did not conserve and close")
	}
	if state.Accounts["0xlender1"].Balances[AssetUSDT0].Available <= 2*Scale {
		t.Fatal("liquidation did not return principal and accrued lender interest")
	}
	if state.ProtocolReserve == 0 {
		t.Fatal("liquidation did not allocate the protocol spread")
	}
}

func TestEncryptedPersistenceSurvivesRestartAndRejectsDuplicates(t *testing.T) {
	path := filepath.Join(t.TempDir(), "state.bolt")
	store, err := OpenStore(path, testKey)
	if err != nil {
		t.Fatal(err)
	}
	e, err := NewEngine(store)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.Deposit("0xAlice", AssetFXRP, 7*Scale, "deposit-once"); err != nil {
		t.Fatal(err)
	}
	root, sequence := e.State().Root, e.State().Sequence
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	reopened, err := OpenStore(path, testKey)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	recovered, err := NewEngine(reopened)
	if err != nil {
		t.Fatal(err)
	}
	state := recovered.State()
	if state.Root != root || state.Sequence != sequence || state.Accounts["0xalice"].Balances[AssetFXRP].Available != 7*Scale {
		t.Fatal("restart recovery mismatch")
	}
	if err := recovered.Deposit("0xAlice", AssetFXRP, Scale, "another-deposit"); !errors.Is(err, ErrAnchorPending) {
		t.Fatalf("expected restart anchor gate, got %v", err)
	}
	confirmPending(t, recovered)
	if err := recovered.Deposit("0xAlice", AssetFXRP, 7*Scale, "deposit-once"); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("expected duplicate rejection, got %v", err)
	}
}

func TestWithdrawalDebitsOnlyAvailableBalance(t *testing.T) {
	e, _, _ := newTestEngine(t)
	if err := e.Deposit("0xAlice", AssetUSDT0, 5*Scale, "deposit-withdraw"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	if err := e.Withdraw("0xAlice", AssetUSDT0, 2*Scale, "withdraw-1", 0); err != nil {
		t.Fatal(err)
	}
	if got := e.State().Accounts["0xalice"].Balances[AssetUSDT0].Available; got != 3*Scale {
		t.Fatalf("unexpected remaining balance: %d", got)
	}
}
