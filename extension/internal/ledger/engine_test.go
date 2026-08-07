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

func TestAcceptanceCanonicalizesBorrowerAndRefreshesPrice(t *testing.T) {
	e, _, now := newTestEngine(t)
	seedCanonical(t, e, *now)
	q, err := e.QuoteAtPrice(
		QuoteRequest{
			ID: "quote-canonical",
			Borrower: "0xBorrower",
			Amount: 3 * Scale,
			TermDays: 14,
			MaxAPRBPS: 1200,
			CollateralFXRP: 10 * Scale,
			ExpiresAt: now.Add(5 * time.Minute).Unix(),
		},
		Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()},
	)
	if err != nil {
		t.Fatal(err)
	}
	q.Borrower = "0xBoRrOwEr"
	if err := e.AcceptQuote(
		q,
		"loan-canonical",
		0,
		&Price{XRPUSDE6: 605_000, UpdatedAt: now.Unix()},
	); err != nil {
		t.Fatalf("accepting a canonical quote at a fresh valid price: %v", err)
	}
	if e.State().Loans["loan-canonical"] == nil {
		t.Fatal("canonical quote did not create a loan")
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

func TestQuoteDistinguishesMissingLiquidityFromAcceptanceRace(t *testing.T) {
	e, _, now := newTestEngine(t)
	if err := e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-only"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	_, err := e.Quote(QuoteRequest{
		ID: "quote-empty", Borrower: "0xBorrower", Amount: 3 * Scale,
		TermDays: 14, MaxAPRBPS: 1200, CollateralFXRP: 10 * Scale,
		ExpiresAt: now.Add(5 * time.Minute).Unix(),
	})
	if !errors.Is(err, ErrInsufficientLiquidity) {
		t.Fatalf("expected insufficient lender liquidity, got %v", err)
	}
}

func TestQuoteSupportsOneHundredFromSingleLender(t *testing.T) {
	e, _, now := newTestEngine(t)
	for _, step := range []func() error{
		func() error { return e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-100") },
		func() error { return e.Deposit("0xLender", AssetUSDT0, 100*Scale, "dep-lender-100") },
		func() error { return e.Deposit("0xBorrower", AssetFXRP, 400*Scale, "dep-borrower-100") },
		func() error { return e.SetMandate("0xLender", "mandate-100", 100*Scale, 750, 7, 100*Scale, 0) },
	} {
		if err := step(); err != nil {
			t.Fatal(err)
		}
		confirmPending(t, e)
	}
	q, err := e.Quote(QuoteRequest{
		ID: "quote-100", Borrower: "0xBorrower", Amount: 100 * Scale,
		TermDays: 30, MaxAPRBPS: 1000, CollateralFXRP: 400 * Scale,
		ExpiresAt: now.Add(5 * time.Minute).Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if q.Partial || q.Amount != 100*Scale || q.RequestedAmount != 100*Scale || len(q.Tranches) != 1 {
		t.Fatalf("unexpected full quote: %+v", q)
	}
	if err := e.AcceptQuote(q, "loan-100", 0, nil); err != nil {
		t.Fatal(err)
	}
	if got := e.State().Loans["loan-100"].Principal; got != 100*Scale {
		t.Fatalf("unexpected principal: %d", got)
	}
}

func TestQuoteSupportsOneHundredAcrossMultipleLenders(t *testing.T) {
	e, _, now := newTestEngine(t)
	steps := []func() error{
		func() error { return e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-multi-100") },
		func() error { return e.Deposit("0xLender1", AssetUSDT0, 40*Scale, "dep-multi-1") },
		func() error { return e.Deposit("0xLender2", AssetUSDT0, 60*Scale, "dep-multi-2") },
		func() error { return e.Deposit("0xBorrower", AssetFXRP, 400*Scale, "dep-multi-b") },
		func() error { return e.SetMandate("0xLender1", "mandate-multi-1", 40*Scale, 700, 7, 40*Scale, 0) },
		func() error { return e.SetMandate("0xLender2", "mandate-multi-2", 60*Scale, 800, 7, 60*Scale, 0) },
	}
	for _, step := range steps {
		if err := step(); err != nil {
			t.Fatal(err)
		}
		confirmPending(t, e)
	}
	q, err := e.Quote(QuoteRequest{
		ID: "quote-multi-100", Borrower: "0xBorrower", Amount: 100 * Scale,
		TermDays: 30, MaxAPRBPS: 1000, CollateralFXRP: 400 * Scale,
		ExpiresAt: now.Add(5 * time.Minute).Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if q.Partial || len(q.Tranches) != 2 || q.Tranches[0].Principal+q.Tranches[1].Principal != 100*Scale {
		t.Fatalf("unexpected multi-lender quote: %+v", q)
	}
}

func TestQuoteReturnsPrivatePartialFunding(t *testing.T) {
	e, _, now := newTestEngine(t)
	steps := []func() error{
		func() error { return e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-partial") },
		func() error { return e.Deposit("0xLender1", AssetUSDT0, 50*Scale, "dep-partial-1") },
		func() error { return e.Deposit("0xLender2", AssetUSDT0, 22_500_000, "dep-partial-2") },
		func() error { return e.Deposit("0xBorrower", AssetFXRP, 400*Scale, "dep-partial-b") },
		func() error { return e.SetMandate("0xLender1", "mandate-partial-1", 50*Scale, 700, 7, 50*Scale, 0) },
		func() error { return e.SetMandate("0xLender2", "mandate-partial-2", 22_500_000, 800, 7, 22_500_000, 0) },
	}
	for _, step := range steps {
		if err := step(); err != nil {
			t.Fatal(err)
		}
		confirmPending(t, e)
	}
	q, err := e.Quote(QuoteRequest{
		ID: "quote-partial", Borrower: "0xBorrower", Amount: 100 * Scale,
		TermDays: 30, MaxAPRBPS: 1000, CollateralFXRP: 400 * Scale,
		ExpiresAt: now.Add(5 * time.Minute).Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if !q.Partial || q.RequestedAmount != 100*Scale || q.Amount != 72_500_000 {
		t.Fatalf("unexpected partial amount: %+v", q)
	}
	if q.RequestedCollateralFXRP != 400*Scale || q.CollateralFXRP != 290*Scale {
		t.Fatalf("unexpected partial collateral: %+v", q)
	}
	if err := e.AcceptQuote(q, "loan-partial", 0, nil); err != nil {
		t.Fatal(err)
	}
	loan := e.State().Loans["loan-partial"]
	if loan.Principal != 72_500_000 || loan.CollateralFXRP != 290*Scale {
		t.Fatalf("partial quote was not settled exactly: %+v", loan)
	}
}

func TestPerBorrowerCapsProducePartialQuote(t *testing.T) {
	e, _, now := newTestEngine(t)
	steps := []func() error{
		func() error { return e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-caps") },
		func() error { return e.Deposit("0xLender", AssetUSDT0, 100*Scale, "dep-caps") },
		func() error { return e.SetMandate("0xLender", "mandate-cap-1", 50*Scale, 700, 7, 30*Scale, 0) },
		func() error { return e.SetMandate("0xLender", "mandate-cap-2", 50*Scale, 710, 7, 30*Scale, 1) },
	}
	for _, step := range steps {
		if err := step(); err != nil {
			t.Fatal(err)
		}
		confirmPending(t, e)
	}
	q, err := e.Quote(QuoteRequest{
		ID: "quote-caps", Borrower: "0xBorrower", Amount: 100 * Scale,
		TermDays: 30, MaxAPRBPS: 1000, CollateralFXRP: 400 * Scale,
		ExpiresAt: now.Add(5 * time.Minute).Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if !q.Partial || q.Amount != 60*Scale || len(q.Tranches) != 2 {
		t.Fatalf("caps were not respected: %+v", q)
	}
}

func TestQuoteRejectsAboveFiftyPercentInitialLTV(t *testing.T) {
	e, _, now := newTestEngine(t)
	for _, step := range []func() error{
		func() error { return e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-ltv") },
		func() error { return e.Deposit("0xLender", AssetUSDT0, 100*Scale, "dep-ltv") },
		func() error { return e.SetMandate("0xLender", "mandate-ltv", 100*Scale, 700, 7, 100*Scale, 0) },
	} {
		if err := step(); err != nil {
			t.Fatal(err)
		}
		confirmPending(t, e)
	}
	_, err := e.Quote(QuoteRequest{
		ID: "quote-ltv", Borrower: "0xBorrower", Amount: 100 * Scale,
		TermDays: 30, MaxAPRBPS: 1000, CollateralFXRP: 300 * Scale,
		ExpiresAt: now.Add(5 * time.Minute).Unix(),
	})
	if err == nil || err.Error() != "initial LTV exceeds 50%" {
		t.Fatalf("expected LTV rejection, got %v", err)
	}
}

func TestLargePositionArithmeticDoesNotOverflow(t *testing.T) {
	e, _, now := newTestEngine(t)
	const principal = uint64(10_000_000_000_000)
	const collateral = uint64(40_000_000_000_000)
	for _, step := range []func() error{
		func() error { return e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-large") },
		func() error { return e.Deposit("0xLender", AssetUSDT0, principal, "dep-large-l") },
		func() error { return e.Deposit("0xBorrower", AssetFXRP, collateral, "dep-large-b") },
		func() error { return e.SetMandate("0xLender", "mandate-large", principal, 750, 7, principal, 0) },
	} {
		if err := step(); err != nil {
			t.Fatal(err)
		}
		confirmPending(t, e)
	}
	q, err := e.Quote(QuoteRequest{
		ID: "quote-large", Borrower: "0xBorrower", Amount: principal,
		TermDays: 30, MaxAPRBPS: 1000, CollateralFXRP: collateral,
		ExpiresAt: now.Add(5 * time.Minute).Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.AcceptQuote(q, "loan-large", 0, nil); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	*now = now.Add(365 * 24 * time.Hour)
	if err := e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "risk-large"); err != nil {
		t.Fatal(err)
	}
	if e.State().Loans["loan-large"].AccruedInterestRay == 0 {
		t.Fatal("large position did not accrue interest")
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
