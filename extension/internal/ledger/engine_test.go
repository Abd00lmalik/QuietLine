package ledger

import (
	"errors"
	"fmt"
	"path/filepath"
	"reflect"
	"strings"
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

// assertStateUnchanged proves a rejected operation persisted nothing: the state
// root is a hash of the whole committed state, so an identical root and sequence
// mean the balances, mandates, and nonces are all byte-for-byte unchanged.
func assertStateUnchanged(t *testing.T, before, after State) {
	t.Helper()
	if after.Root != before.Root || after.Sequence != before.Sequence {
		t.Fatalf("rejected operation mutated state: root %s -> %s, sequence %d -> %d", before.Root, after.Root, before.Sequence, after.Sequence)
	}
}

// expectedLenderInterest mirrors distributeRepayment's per-tranche split so tests
// can assert exact interest credits instead of just "something increased".
func expectedLenderInterest(l *Loan, t *Tranche, interest uint64) (uint64, error) {
	share, err := mulDiv([]uint64{interest, t.Principal}, l.Principal, false)
	if err != nil {
		return 0, err
	}
	return mulDiv([]uint64{share, uint64(t.APRBPS)}, uint64(l.BorrowerAPRBPS), false)
}

// accountingSnapshot captures every balance-affecting field so a test can prove
// an operation did not touch lender, borrower, mandate, or protocol accounting.
// Price, Root, Sequence, and Processed are deliberately excluded: RiskTick must
// legitimately advance them while leaving accounting untouched.
type accountingSnapshot struct {
	accounts     map[string]map[string]Balance
	mandates     map[string]Mandate
	loans        map[string]Loan
	backstop     uint64
	backstopFXRP uint64
	protocol     uint64
	activeDebt   uint64
}

func snapshotAccounting(e *Engine) accountingSnapshot {
	s := e.State()
	out := accountingSnapshot{
		accounts:     map[string]map[string]Balance{},
		mandates:     map[string]Mandate{},
		loans:        map[string]Loan{},
		backstop:     s.BackstopUSDT0,
		backstopFXRP: s.BackstopFXRP,
		protocol:     s.ProtocolReserve,
		activeDebt:   s.ActiveDebt,
	}
	for owner, a := range s.Accounts {
		out.accounts[owner] = a.Balances
	}
	for id, m := range s.Mandates {
		out.mandates[id] = *m
	}
	for id, l := range s.Loans {
		out.loans[id] = *l
	}
	return out
}

// assertReservedInvariant fails if any account's reserved USDT0 balance diverges
// from the mandate backing it is supposed to represent.
func assertReservedInvariant(t *testing.T, e *Engine) {
	t.Helper()
	state := e.State()
	for _, acct := range state.Accounts {
		var backing uint64
		for _, m := range state.Mandates {
			if m.Lender == acct.Owner {
				backing += m.Available + m.AllocatedPrincipal
			}
		}
		if acct.Balances[AssetUSDT0].Reserved != backing {
			t.Fatalf("reserved invariant broken for %s: reserved=%d backing=%d", acct.Owner, acct.Balances[AssetUSDT0].Reserved, backing)
		}
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
			ID:             "quote-canonical",
			Borrower:       "0xBorrower",
			Amount:         3 * Scale,
			TermDays:       14,
			MaxAPRBPS:      1200,
			CollateralFXRP: 10 * Scale,
			ExpiresAt:      now.Add(5 * time.Minute).Unix(),
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
	// The repaid principal stays reserved in the restored mandate; only interest
	// lands in the lender's withdrawable balance.
	lenderOne := state.Accounts["0xlender1"].Balances[AssetUSDT0]
	if lenderOne.Available == 0 {
		t.Fatal("first lender did not receive accrued interest")
	}
	if lenderOne.Reserved != 10*Scale {
		t.Fatalf("repaid principal must stay reserved in the mandate: %+v", lenderOne)
	}
	if m1 := state.Mandates["mandate-1"]; m1.Available != 10*Scale || m1.AllocatedPrincipal != 0 || !m1.Active {
		t.Fatalf("mandate must be restored and stay active: %+v", m1)
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
	// Liquidation returns principal to the restored mandate; only interest lands
	// in the lender's withdrawable balance.
	lenderOne := state.Accounts["0xlender1"].Balances[AssetUSDT0]
	if lenderOne.Available == 0 {
		t.Fatal("liquidation did not credit accrued lender interest")
	}
	if lenderOne.Reserved != 10*Scale {
		t.Fatalf("repaid principal must stay reserved in the mandate: %+v", lenderOne)
	}
	if m1 := state.Mandates["mandate-1"]; m1.Available != 10*Scale || m1.AllocatedPrincipal != 0 || !m1.Active {
		t.Fatalf("mandate must be restored and stay active after liquidation: %+v", m1)
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

func TestMutationWaitsForAnchorConfirmation(t *testing.T) {
	e, _, _ := newTestEngine(t)
	e.anchorWaitTimeout = time.Second
	if err := e.Deposit("0xAlice", AssetUSDT0, Scale, "deposit-first"); err != nil {
		t.Fatal(err)
	}

	result := make(chan error, 1)
	go func() {
		result <- e.Deposit("0xAlice", AssetUSDT0, 2*Scale, "deposit-second")
	}()
	time.Sleep(20 * time.Millisecond)
	confirmPending(t, e)

	if err := <-result; err != nil {
		t.Fatalf("waiting mutation failed after anchor confirmation: %v", err)
	}
	state := e.State()
	if got := state.Accounts["0xalice"].Balances[AssetUSDT0].Available; got != 3*Scale {
		t.Fatalf("unexpected balance after serialized deposits: %d", got)
	}
	if state.PendingAnchor == nil || state.PendingAnchor.OperationID != "deposit-second" {
		t.Fatalf("second mutation did not produce its own anchor: %+v", state.PendingAnchor)
	}
}

func TestMutationReturnsAnchorPendingAfterWaitTimeout(t *testing.T) {
	e, _, _ := newTestEngine(t)
	e.anchorWaitTimeout = 10 * time.Millisecond
	if err := e.Deposit("0xAlice", AssetUSDT0, Scale, "deposit-first"); err != nil {
		t.Fatal(err)
	}
	if err := e.Deposit("0xAlice", AssetUSDT0, Scale, "deposit-timeout"); !errors.Is(err, ErrAnchorPending) {
		t.Fatalf("expected anchor timeout, got %v", err)
	}
	if got := e.State().Accounts["0xalice"].Balances[AssetUSDT0].Available; got != Scale {
		t.Fatalf("timed-out mutation changed private balance: %d", got)
	}
}

// Regression guard for the 0aa85e4 deposit-stranding regression. That commit tried to
// force a pending-anchor mutation to surface ErrAnchorPending *inside* tee-node's hard
// 2s /action ProxyTimeout by cutting the wait to 1.2s (and the on-chain read budget to
// 1.5s). It backfired: a real anchor confirmation takes several on-chain seconds, so the
// sub-2s gate rejected mutations that would have succeeded, and the matching short read
// budget stranded the very anchor the relayer's recovery had to clear — a deterministic
// global mutation lock (funds move on-chain, private balance never credits: "Vault
// confirmed; waiting for FCC"). The wait is restored to the known-good 20s, comfortably
// past the 2s budget, so a blocked mutation waits for recovery instead of being rejected
// at ~1.2s. tee-node's 2s constraint is handled where it belongs — concurrent, generously
// timed on-chain reads in verifyAnchorOnChain — not by an artificially short internal wait.
func TestDefaultAnchorWaitAllowsRecoveryBeyondProxyBudget(t *testing.T) {
	const proxyTimeout = 2 * time.Second

	e, _, _ := newTestEngine(t) // production default wait, not a test override
	if e.anchorWaitTimeout <= proxyTimeout {
		t.Fatalf(
			"anchor wait %v must exceed the 2s proxy budget so anchor recovery is not curtailed (0aa85e4 regression)",
			e.anchorWaitTimeout,
		)
	}

	if err := e.Deposit("0xAlice", AssetUSDT0, Scale, "deposit-first"); err != nil {
		t.Fatal(err)
	}

	// A second mutation lands while the first anchor is still pending. Under the restored
	// wait it blocks rather than failing fast; the prior anchor clears only after a delay
	// longer than 0aa85e4's 1.2s gate would have tolerated, yet the mutation still lands.
	result := make(chan error, 1)
	go func() {
		result <- e.Deposit("0xAlice", AssetUSDT0, Scale, "deposit-second")
	}()
	time.Sleep(1300 * time.Millisecond) // past the old 1200ms gate
	confirmPending(t, e)

	if err := <-result; err != nil {
		t.Fatalf("mutation blocked past the old 1.2s gate must still complete after recovery, got %v", err)
	}
	if got := e.State().Accounts["0xalice"].Balances[AssetUSDT0].Available; got != 2*Scale {
		t.Fatalf("recovered mutation credited wrong balance: %d", got)
	}
}

// Proves the new-account OPEN_ACCOUNT flow is intact under the restored 20s wait: opening
// a fresh account is an ordinary gated mutation that produces its own pending anchor,
// credits (advances the account nonce) once the anchor is confirmed, and rejects a replay
// of the same operation as a duplicate.
func TestOpenAccountFlowUnderRestoredWait(t *testing.T) {
	e, _, _ := newTestEngine(t) // production default wait, not a test override

	if err := e.OpenAccount("0xNewbie", "open-1", 0); err != nil {
		t.Fatalf("opening a new account must succeed: %v", err)
	}
	if pending := e.State().PendingAnchor; pending == nil || pending.OperationID != "open-1" {
		t.Fatalf("open-account did not produce its own anchor: %+v", pending)
	}

	confirmPending(t, e)

	if got := e.State().Accounts["0xnewbie"].Nonce; got != 1 {
		t.Fatalf("opened account nonce must advance to 1, got %d", got)
	}
	if err := e.OpenAccount("0xNewbie", "open-1", 1); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("replayed OPEN_ACCOUNT must be idempotent, got %v", err)
	}
}

// Models the reported failure and its recovery end-to-end at the ledger layer: a
// stranded pending anchor blocks the user's deposit (returned as ErrAnchorPending,
// uncredited); once the anchor is confirmed, the relayer's RECOVER_DEPOSIT re-applies
// the same deposit, which must credit it exactly once and reject any replay.
func TestStrandedDepositCreditsAfterAnchorRecovery(t *testing.T) {
	e, _, _ := newTestEngine(t)
	e.anchorWaitTimeout = 20 * time.Millisecond // keep the blocked wait short for the test

	if err := e.Deposit("0xBob", AssetFXRP, 5*Scale, "prior-op"); err != nil {
		t.Fatal(err)
	}
	// The user's deposit lands while the prior anchor is still pending: blocked.
	if err := e.Deposit("0xBob", AssetFXRP, 3*Scale, "user-deposit"); !errors.Is(err, ErrAnchorPending) {
		t.Fatalf("expected ErrAnchorPending while a prior anchor is pending, got %v", err)
	}
	if got := e.State().Accounts["0xbob"].Balances[AssetFXRP].Available; got != 5*Scale {
		t.Fatalf("blocked deposit must not credit: got %d", got)
	}
	// Recovery confirms the stranded anchor, then re-applies the user's deposit.
	confirmPending(t, e)
	if err := e.Deposit("0xBob", AssetFXRP, 3*Scale, "user-deposit"); err != nil {
		t.Fatalf("recovery re-apply must credit the deposit: %v", err)
	}
	if got := e.State().Accounts["0xbob"].Balances[AssetFXRP].Available; got != 8*Scale {
		t.Fatalf("recovered deposit credited wrong balance: %d", got)
	}
	confirmPending(t, e)
	// A duplicate replay of the recovery must be idempotent.
	if err := e.Deposit("0xBob", AssetFXRP, 3*Scale, "user-deposit"); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("replayed recovery must be idempotent, got %v", err)
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

func TestWithdrawalFromUnallocatedMandateLiquidity(t *testing.T) {
	e, _, now := newTestEngine(t)
	steps := []func() error{
		func() error { return e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-wl") },
		func() error { return e.Deposit("0xLender", AssetUSDT0, 10*Scale, "dep-wl") },
		func() error { return e.SetMandate("0xLender", "mandate-wl", 10*Scale, 750, 7, 10*Scale, 0) },
	}
	for _, step := range steps {
		if err := step(); err != nil {
			t.Fatal(err)
		}
		confirmPending(t, e)
	}
	// Fully mandated: the account has no available balance, only the mandate does.
	state := e.State()
	if got := state.Accounts["0xlender"].Balances[AssetUSDT0]; got.Available != 0 || got.Reserved != 10*Scale {
		t.Fatalf("unexpected pre-withdrawal balance: %+v", got)
	}
	// Partial withdrawal of unallocated liquidity keeps the mandate active.
	if err := e.Withdraw("0xLender", AssetUSDT0, 4*Scale, "withdraw-wl-1", 1); err != nil {
		t.Fatalf("partial mandate withdrawal: %v", err)
	}
	confirmPending(t, e)
	state = e.State()
	if got := state.Accounts["0xlender"].Balances[AssetUSDT0]; got.Available != 0 || got.Reserved != 6*Scale {
		t.Fatalf("unexpected balance after partial withdrawal: %+v", got)
	}
	if m := state.Mandates["mandate-wl"]; m == nil || m.Available != 6*Scale || m.AllocatedPrincipal != 0 || !m.Active {
		t.Fatalf("mandate not partially released: %+v", m)
	}
	// Withdrawing the remaining unallocated liquidity empties and deactivates it.
	if err := e.Withdraw("0xLender", AssetUSDT0, 6*Scale, "withdraw-wl-2", 2); err != nil {
		t.Fatalf("remaining mandate withdrawal: %v", err)
	}
	confirmPending(t, e)
	state = e.State()
	if got := state.Accounts["0xlender"].Balances[AssetUSDT0]; got.Available != 0 || got.Reserved != 0 {
		t.Fatalf("unexpected balance after full withdrawal: %+v", got)
	}
	if m := state.Mandates["mandate-wl"]; m == nil || m.Available != 0 || m.Active {
		t.Fatalf("mandate should be emptied and inactive: %+v", m)
	}
	// Nothing is left to withdraw.
	if err := e.Withdraw("0xLender", AssetUSDT0, Scale, "withdraw-wl-3", 3); !errors.Is(err, ErrInsufficientBalance) {
		t.Fatalf("expected insufficient balance, got %v", err)
	}
}

func TestWithdrawalCannotTouchCommittedMandatePrincipal(t *testing.T) {
	e, _, now := newTestEngine(t)
	seedCanonical(t, e, *now) // lender1: 10 mandated (per-borrower cap 2), lender2: 10 mandated (cap 2)
	// 2 requested is capped at 2 by lender1's per-borrower cap, committing 2 of its
	// 10-unit mandate at 33% initial LTV (10 FXRP at 0.6 USD).
	q, err := e.Quote(QuoteRequest{
		ID: "quote-wd", Borrower: "0xBorrower", Amount: 2 * Scale, TermDays: 14,
		MaxAPRBPS: 1200, CollateralFXRP: 10 * Scale,
		ExpiresAt: now.Add(5 * time.Minute).Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.AcceptQuote(q, "loan-wd", 0, nil); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	state := e.State()
	m1 := state.Mandates["mandate-1"]
	if m1.AllocatedPrincipal != 2*Scale || m1.Available != 8*Scale {
		t.Fatalf("unexpected mandate-1 allocation: %+v", m1)
	}
	// Lender 1 may withdraw only its unallocated 8, not the 2 committed to the loan.
	if err := e.Withdraw("0xLender1", AssetUSDT0, 8*Scale, "withdraw-committed-ok", 1); err != nil {
		t.Fatalf("withdrawing unallocated mandate liquidity: %v", err)
	}
	confirmPending(t, e)
	if err := e.Withdraw("0xLender1", AssetUSDT0, 1, "withdraw-committed-over", 2); !errors.Is(err, ErrInsufficientBalance) {
		t.Fatalf("expected committed principal to be untouchable, got %v", err)
	}
	state = e.State()
	m1 = state.Mandates["mandate-1"]
	if m1.AllocatedPrincipal != 2*Scale || m1.Available != 0 {
		t.Fatalf("committed principal was disturbed: %+v", m1)
	}
	if got := state.Accounts["0xlender1"].Balances[AssetUSDT0]; got.Reserved != 2*Scale {
		t.Fatalf("reserved balance must equal committed principal: %+v", got)
	}
	if loan := state.Loans["loan-wd"]; loan == nil || loan.Principal != 2*Scale {
		t.Fatalf("loan must remain intact: %+v", loan)
	}
}

func TestWithdrawalAcrossMandatesPreservesReservedConservation(t *testing.T) {
	e, _, now := newTestEngine(t)
	steps := []func() error{
		func() error { return e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-wm") },
		func() error { return e.Deposit("0xLender", AssetUSDT0, 10*Scale, "dep-wm") },
		func() error { return e.SetMandate("0xLender", "mandate-wm-1", 3*Scale, 750, 7, 3*Scale, 0) },
		func() error { return e.SetMandate("0xLender", "mandate-wm-2", 7*Scale, 800, 7, 7*Scale, 1) },
	}
	for _, step := range steps {
		if err := step(); err != nil {
			t.Fatal(err)
		}
		confirmPending(t, e)
	}
	// Withdraw 5 across both mandates: oldest (3) drained first, then 2 from the second.
	if err := e.Withdraw("0xLender", AssetUSDT0, 5*Scale, "withdraw-wm", 2); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	state := e.State()
	m1 := state.Mandates["mandate-wm-1"]
	m2 := state.Mandates["mandate-wm-2"]
	if m1.Available != 0 || m1.AllocatedPrincipal != 0 || m1.Active {
		t.Fatalf("oldest mandate not drained and deactivated first: %+v", m1)
	}
	if m2.Available != 5*Scale || m2.AllocatedPrincipal != 0 || !m2.Active {
		t.Fatalf("second mandate took the remainder: %+v", m2)
	}
	bal := state.Accounts["0xlender"].Balances[AssetUSDT0]
	if bal.Available != 0 || bal.Reserved != 5*Scale {
		t.Fatalf("reserved conservation broken: %+v", bal)
	}
	backing := m1.Available + m1.AllocatedPrincipal + m2.Available + m2.AllocatedPrincipal
	if bal.Reserved != backing {
		t.Fatalf("reserved does not match mandate backing: reserved=%d mandates=%d", bal.Reserved, backing)
	}
}

// Regression for the Earn mandate-withdrawal bug: a per-mandate withdrawal must
// debit exactly the selected mandate's available-to-lend and leave the private
// unallocated balance (and any other mandate) untouched. The generic Withdraw
// drains the private balance first, which is what the Earn page reported as
// "withdrew from my private balance instead of the mandate".
func TestWithdrawFromMandateDebitsOnlyThatMandate(t *testing.T) {
	e, _, now := newTestEngine(t)
	steps := []func() error{
		func() error { return e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-wfm") },
		// Deposit 10; mandate A takes 4, mandate B takes 3, leaving 3 private.
		func() error { return e.Deposit("0xLender", AssetUSDT0, 10*Scale, "dep-wfm") },
		func() error { return e.SetMandate("0xLender", "mandate-wfm-a", 4*Scale, 750, 7, 4*Scale, 0) },
		func() error { return e.SetMandate("0xLender", "mandate-wfm-b", 3*Scale, 800, 7, 3*Scale, 1) },
	}
	for _, step := range steps {
		if err := step(); err != nil {
			t.Fatal(err)
		}
		confirmPending(t, e)
	}
	state := e.State()
	if got := state.Accounts["0xlender"].Balances[AssetUSDT0]; got.Available != 3*Scale || got.Reserved != 7*Scale {
		t.Fatalf("unexpected pre-withdrawal balance: %+v", got)
	}
	// Withdraw 2 from mandate A. The private balance (3) must stay at 3 even
	// though the generic Withdraw would have drained it first.
	if err := e.WithdrawFromMandate("0xLender", "mandate-wfm-a", 2*Scale, "withdraw-wfm", 2); err != nil {
		t.Fatalf("mandate withdrawal: %v", err)
	}
	confirmPending(t, e)
	state = e.State()
	a := state.Mandates["mandate-wfm-a"]
	b := state.Mandates["mandate-wfm-b"]
	if a.Available != 2*Scale || !a.Active {
		t.Fatalf("mandate A not debited exactly: %+v", a)
	}
	if b.Available != 3*Scale || !b.Active {
		t.Fatalf("unrelated mandate B must be untouched: %+v", b)
	}
	bal := state.Accounts["0xlender"].Balances[AssetUSDT0]
	if bal.Available != 3*Scale || bal.Reserved != 5*Scale {
		t.Fatalf("private balance must stay intact and reserved must mirror the debit: %+v", bal)
	}
	if a.AllocatedPrincipal != 0 || b.AllocatedPrincipal != 0 {
		t.Fatal("no committed principal exists and none may be created by a withdrawal")
	}
}

// Withdrawing the full unallocated amount of a mandate empties and deactivates
// it, and the account's reserved mirrors the reduction (conservation holds).
func TestWithdrawFromMandateEmptiesAndDeactivates(t *testing.T) {
	e, _, now := newTestEngine(t)
	steps := []func() error{
		func() error { return e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-wfme") },
		func() error { return e.Deposit("0xLender", AssetUSDT0, 6*Scale, "dep-wfme") },
		func() error { return e.SetMandate("0xLender", "mandate-wfme", 4*Scale, 750, 7, 4*Scale, 0) },
	}
	for _, step := range steps {
		if err := step(); err != nil {
			t.Fatal(err)
		}
		confirmPending(t, e)
	}
	if err := e.WithdrawFromMandate("0xLender", "mandate-wfme", 4*Scale, "withdraw-wfme", 1); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	state := e.State()
	m := state.Mandates["mandate-wfme"]
	if m.Available != 0 || m.Active {
		t.Fatalf("emptied mandate must be deactivated: %+v", m)
	}
	bal := state.Accounts["0xlender"].Balances[AssetUSDT0]
	if bal.Reserved != 0 || bal.Available != 2*Scale {
		t.Fatalf("reserved must mirror emptied mandate: %+v", bal)
	}
}

// A mandate withdrawal that exceeds the mandate's available liquidity (or targets
// an inactive/foreign mandate) must be refused without mutating state.
func TestWithdrawFromMandateRefusesOverspendAndForeignMandate(t *testing.T) {
	e, _, now := newTestEngine(t)
	steps := []func() error{
		func() error { return e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-wfmr") },
		func() error { return e.Deposit("0xLender", AssetUSDT0, 5*Scale, "dep-wfmr") },
		func() error { return e.SetMandate("0xLender", "mandate-wfmr", 4*Scale, 750, 7, 4*Scale, 0) },
		func() error { return e.Deposit("0xOther", AssetUSDT0, 5*Scale, "dep-wfmr-other") },
	}
	for _, step := range steps {
		if err := step(); err != nil {
			t.Fatal(err)
		}
		confirmPending(t, e)
	}
	before := e.State()
	if err := e.WithdrawFromMandate("0xLender", "mandate-wfmr", 5*Scale, "withdraw-wfmr-over", 1); !errors.Is(err, ErrInsufficientBalance) {
		t.Fatalf("expected insufficient balance for overspend, got %v", err)
	}
	assertStateUnchanged(t, before, e.State())
	if err := e.WithdrawFromMandate("0xOther", "mandate-wfmr", Scale, "withdraw-wfmr-foreign", 0); err == nil {
		t.Fatal("expected a foreign mandate withdrawal to be refused")
	}
	assertStateUnchanged(t, before, e.State())
	if err := e.WithdrawFromMandate("0xLender", "no-such-mandate", Scale, "withdraw-wfmr-missing", 1); err == nil {
		t.Fatal("expected a missing mandate withdrawal to be refused")
	}
	assertStateUnchanged(t, before, e.State())
}

// Regression for the reported "three lenders, ~20 USD₮0 supplied, borrower could
// only access ~2" incident. The point of the reproduction: the 20 is the total
// mandated (available + committed), matching uses only Mandate.Available, and
// committed principal is invisible until it is repaid. Term and APR eligibility
// rules continue to exclude mandates independently.
func TestIncidentThreeLendersSuppliedTwentyOnlyUnallocatedLends(t *testing.T) {
	e, _, now := newTestEngine(t)
	steps := []struct {
		name string
		fn   func() error
	}{
		{"price", func() error { return e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-inc") }},
		{"lender one deposit", func() error { return e.Deposit("0xLender1", AssetUSDT0, 7*Scale, "dep-inc-1") }},
		{"lender two deposit", func() error { return e.Deposit("0xLender2", AssetUSDT0, 7*Scale, "dep-inc-2") }},
		{"lender three deposit", func() error { return e.Deposit("0xLender3", AssetUSDT0, 6*Scale, "dep-inc-3") }},
		// Term mask 3 = 7- and 14-day terms only, so a 30-day request is ineligible.
		{"lender one mandate", func() error { return e.SetMandate("0xLender1", "mandate-inc-1", 7*Scale, 700, 3, 7*Scale, 0) }},
		{"lender two mandate", func() error { return e.SetMandate("0xLender2", "mandate-inc-2", 7*Scale, 800, 3, 7*Scale, 0) }},
		{"lender three mandate", func() error { return e.SetMandate("0xLender3", "mandate-inc-3", 6*Scale, 900, 3, 6*Scale, 0) }},
		{"borrower A collateral", func() error { return e.Deposit("0xBorrowerA", AssetFXRP, 30*Scale, "dep-inc-a") }},
		{"borrower B collateral", func() error { return e.Deposit("0xBorrowerB", AssetFXRP, 30*Scale, "dep-inc-b") }},
		{"borrower C collateral", func() error { return e.Deposit("0xBorrowerC", AssetFXRP, 30*Scale, "dep-inc-c") }},
	}
	for _, step := range steps {
		if err := step.fn(); err != nil {
			t.Fatalf("%s: %v", step.name, err)
		}
		confirmPending(t, e)
	}
	// Commit 19 of the 20 supplied across three active loans.
	loans := []struct {
		borrower string
		amount   uint64
		loanID   string
	}{
		{"0xBorrowerA", 6 * Scale, "loan-inc-a"},
		{"0xBorrowerB", 7 * Scale, "loan-inc-b"},
		{"0xBorrowerC", 6 * Scale, "loan-inc-c"},
	}
	for _, loan := range loans {
		q, err := e.Quote(QuoteRequest{ID: loan.loanID, Borrower: loan.borrower, Amount: loan.amount, TermDays: 14, MaxAPRBPS: 1200, CollateralFXRP: 30 * Scale, ExpiresAt: now.Add(5 * time.Minute).Unix()})
		if err != nil {
			t.Fatalf("quote %s: %v", loan.loanID, err)
		}
		if err := e.AcceptQuote(q, loan.loanID, 0, nil); err != nil {
			t.Fatalf("accept %s: %v", loan.loanID, err)
		}
		confirmPending(t, e)
	}
	state := e.State()
	var supplied, committed, available uint64
	for _, id := range []string{"mandate-inc-1", "mandate-inc-2", "mandate-inc-3"} {
		m := state.Mandates[id]
		supplied += m.Available + m.AllocatedPrincipal
		committed += m.AllocatedPrincipal
		available += m.Available
	}
	if supplied != 20*Scale || committed != 19*Scale || available != Scale {
		t.Fatalf("unexpected market split: supplied=%d committed=%d available=%d", supplied, committed, available)
	}
	// A new borrower requests 5; only the 1 unit of eligible liquidity matches.
	q, err := e.Quote(QuoteRequest{ID: "quote-inc-final", Borrower: "0xBorrowerD", Amount: 5 * Scale, TermDays: 14, MaxAPRBPS: 1200, CollateralFXRP: 30 * Scale, ExpiresAt: now.Add(5 * time.Minute).Unix()})
	if err != nil {
		t.Fatal(err)
	}
	if !q.Partial || q.Amount != Scale || q.RequestedAmount != 5*Scale || len(q.Tranches) != 1 {
		t.Fatalf("expected a 1-unit partial quote from eligible liquidity only: %+v", q)
	}
	if q.Tranches[0].Lender != "0xlender3" || q.Tranches[0].Principal != Scale {
		t.Fatalf("unexpected tranche: %+v", q.Tranches)
	}
	// Term mismatch: lenders opted into 7/14-day terms only, so a 30-day request finds no liquidity.
	if _, err := e.Quote(QuoteRequest{ID: "quote-inc-30", Borrower: "0xBorrowerD", Amount: 5 * Scale, TermDays: 30, MaxAPRBPS: 1200, CollateralFXRP: 30 * Scale, ExpiresAt: now.Add(5 * time.Minute).Unix()}); !errors.Is(err, ErrInsufficientLiquidity) {
		t.Fatalf("expected term mismatch to exclude all liquidity, got %v", err)
	}
	// APR spread: lender minimums plus the 50 bps spread must fit under the borrower's maximum.
	if _, err := e.Quote(QuoteRequest{ID: "quote-inc-apr", Borrower: "0xBorrowerD", Amount: 5 * Scale, TermDays: 14, MaxAPRBPS: 749, CollateralFXRP: 30 * Scale, ExpiresAt: now.Add(5 * time.Minute).Unix()}); !errors.Is(err, ErrInsufficientLiquidity) {
		t.Fatalf("expected APR rules to exclude all liquidity, got %v", err)
	}
	// Repay borrower A in full: the 6 repaid becomes lendable again in lender one's mandate.
	*now = now.Add(3 * 24 * time.Hour)
	if err := e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-inc-2"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	if err := e.Deposit("0xBorrowerA", AssetUSDT0, 7*Scale, "repay-inc-deposit"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	if err := e.Repay("0xBorrowerA", 7*Scale, "repay-inc-a", 1); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	state = e.State()
	m1 := state.Mandates["mandate-inc-1"]
	if m1.Available != 6*Scale || m1.AllocatedPrincipal != Scale || !m1.Active {
		t.Fatalf("repaid principal did not return to the active mandate: %+v", m1)
	}
	lenderOne := state.Accounts["0xlender1"].Balances[AssetUSDT0]
	if lenderOne.Available == 0 {
		t.Fatal("lender interest was not credited to the withdrawable balance")
	}
	if lenderOne.Reserved != 7*Scale {
		t.Fatalf("restored principal must stay reserved: %+v", lenderOne)
	}
	// The restored liquidity is now eligible: a 5-unit request fills completely.
	q, err = e.Quote(QuoteRequest{ID: "quote-inc-after-repay", Borrower: "0xBorrowerD", Amount: 5 * Scale, TermDays: 14, MaxAPRBPS: 1200, CollateralFXRP: 30 * Scale, ExpiresAt: now.Add(5 * time.Minute).Unix()})
	if err != nil {
		t.Fatal(err)
	}
	if q.Partial || q.Amount != 5*Scale || len(q.Tranches) != 1 || q.Tranches[0].Lender != "0xlender1" {
		t.Fatalf("restored liquidity must fully fund the request: %+v", q)
	}
	// Unallocated mandate liquidity is withdrawable; committed principal is not.
	if err := e.Withdraw("0xLender3", AssetUSDT0, Scale, "withdraw-inc-unallocated", 1); err != nil {
		t.Fatalf("unallocated mandate liquidity must be withdrawable: %v", err)
	}
	confirmPending(t, e)
	if err := e.Withdraw("0xLender2", AssetUSDT0, 1, "withdraw-inc-committed", 1); !errors.Is(err, ErrInsufficientBalance) {
		t.Fatalf("committed principal must not be withdrawable, got %v", err)
	}
	// The Reserved accounting invariant holds for every account after all ops.
	state = e.State()
	for _, acct := range state.Accounts {
		var backing uint64
		for _, m := range state.Mandates {
			if m.Lender == acct.Owner {
				backing += m.Available + m.AllocatedPrincipal
			}
		}
		if acct.Balances[AssetUSDT0].Reserved != backing {
			t.Fatalf("reserved invariant broken for %s: reserved=%d backing=%d", acct.Owner, acct.Balances[AssetUSDT0].Reserved, backing)
		}
	}
}

func TestRepaidPrincipalReLendsThroughExistingMandate(t *testing.T) {
	e, _, now := newTestEngine(t)
	steps := []func() error{
		func() error { return e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-rl") },
		func() error { return e.Deposit("0xLender", AssetUSDT0, 10*Scale, "dep-rl-l") },
		func() error { return e.Deposit("0xBorrower", AssetFXRP, 40*Scale, "dep-rl-b") },
		func() error { return e.SetMandate("0xLender", "mandate-rl", 10*Scale, 750, 7, 10*Scale, 0) },
	}
	for _, step := range steps {
		if err := step(); err != nil {
			t.Fatal(err)
		}
		confirmPending(t, e)
	}
	q, err := e.Quote(QuoteRequest{ID: "quote-rl", Borrower: "0xBorrower", Amount: 4 * Scale, TermDays: 14, MaxAPRBPS: 1200, CollateralFXRP: 40 * Scale, ExpiresAt: now.Add(5 * time.Minute).Unix()})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.AcceptQuote(q, "loan-rl", 0, nil); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	if m := e.State().Mandates["mandate-rl"]; m.Available != 6*Scale || m.AllocatedPrincipal != 4*Scale {
		t.Fatalf("unexpected loan allocation: %+v", m)
	}
	// Repay in full after a little accrual; refresh the FTSO observation first so
	// the subsequent quote is not stale.
	*now = now.Add(5 * 24 * time.Hour)
	if err := e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-rl-2"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	if err := e.Deposit("0xBorrower", AssetUSDT0, 5*Scale, "dep-rl-repay"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	if err := e.Repay("0xBorrower", 5*Scale, "repay-rl", 1); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	state := e.State()
	m := state.Mandates["mandate-rl"]
	if m.Available != 10*Scale || m.AllocatedPrincipal != 0 || !m.Active {
		t.Fatalf("repaid principal must re-lend through the same active mandate: %+v", m)
	}
	bal := state.Accounts["0xlender"].Balances[AssetUSDT0]
	if bal.Reserved != 10*Scale {
		t.Fatalf("restored principal must stay reserved: %+v", bal)
	}
	if bal.Available == 0 {
		t.Fatal("interest must be credited to the withdrawable balance")
	}
	// A fresh quote can use the restored liquidity immediately, without re-activation.
	q2, err := e.Quote(QuoteRequest{ID: "quote-rl-2", Borrower: "0xBorrower2", Amount: 4 * Scale, TermDays: 14, MaxAPRBPS: 1200, CollateralFXRP: 40 * Scale, ExpiresAt: now.Add(5 * time.Minute).Unix()})
	if err != nil {
		t.Fatal(err)
	}
	if q2.Partial || q2.Amount != 4*Scale || len(q2.Tranches) != 1 || q2.Tranches[0].MandateID != "mandate-rl" {
		t.Fatalf("restored mandate liquidity must fund a new quote: %+v", q2)
	}
}

func TestCancelledMandateRepaidPrincipalReturnsToAvailable(t *testing.T) {
	// A lender who cancels their mandate opted out: repaid principal must return
	// to the account's withdrawable balance instead of silently re-lending.
	e, _, now := newTestEngine(t)
	steps := []func() error{
		func() error { return e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-cm") },
		func() error { return e.Deposit("0xLender", AssetUSDT0, 10*Scale, "dep-cm") },
		func() error { return e.Deposit("0xBorrower", AssetFXRP, 40*Scale, "dep-cm-b") },
		func() error { return e.SetMandate("0xLender", "mandate-cm", 10*Scale, 750, 7, 10*Scale, 0) },
	}
	for _, step := range steps {
		if err := step(); err != nil {
			t.Fatal(err)
		}
		confirmPending(t, e)
	}
	q, err := e.Quote(QuoteRequest{ID: "quote-cm", Borrower: "0xBorrower", Amount: 4 * Scale, TermDays: 14, MaxAPRBPS: 1200, CollateralFXRP: 40 * Scale, ExpiresAt: now.Add(5 * time.Minute).Unix()})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.AcceptQuote(q, "loan-cm", 0, nil); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	// Cancel the mandate while the loan is active.
	if err := e.CancelMandate("0xLender", "mandate-cm", 1); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	state := e.State()
	if m := state.Mandates["mandate-cm"]; m.Available != 0 || m.AllocatedPrincipal != 4*Scale || m.Active {
		t.Fatalf("unexpected cancelled mandate: %+v", m)
	}
	if bal := state.Accounts["0xlender"].Balances[AssetUSDT0]; bal.Available != 6*Scale || bal.Reserved != 4*Scale {
		t.Fatalf("unexpected account after cancel: %+v", bal)
	}
	// Repay: the committed principal must come back to the available balance, not the mandate.
	*now = now.Add(5 * 24 * time.Hour)
	if err := e.Deposit("0xBorrower", AssetUSDT0, 5*Scale, "dep-cm-repay"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	if err := e.Repay("0xBorrower", 5*Scale, "repay-cm", 1); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	state = e.State()
	m := state.Mandates["mandate-cm"]
	if m.Available != 0 || m.AllocatedPrincipal != 0 || m.Active {
		t.Fatalf("cancelled mandate must stay empty and inactive: %+v", m)
	}
	bal := state.Accounts["0xlender"].Balances[AssetUSDT0]
	if bal.Reserved != 0 {
		t.Fatalf("no reserved balance may remain after repay: %+v", bal)
	}
	if bal.Available < 10*Scale {
		t.Fatalf("principal and interest must return to the available balance: %+v", bal)
	}
	// The returned capital is withdrawable.
	if err := e.Withdraw("0xLender", AssetUSDT0, 4*Scale, "withdraw-cm", 2); err != nil {
		t.Fatalf("returned principal must be withdrawable: %v", err)
	}
}

func TestRepaymentRestoresMultipleMandates(t *testing.T) {
	e, _, now := newTestEngine(t)
	steps := []func() error{
		func() error { return e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-rm") },
		func() error { return e.Deposit("0xLender", AssetUSDT0, 10*Scale, "dep-rm") },
		func() error { return e.Deposit("0xBorrower", AssetFXRP, 40*Scale, "dep-rm-b") },
		func() error { return e.SetMandate("0xLender", "mandate-rm-1", 3*Scale, 750, 7, 3*Scale, 0) },
		func() error { return e.SetMandate("0xLender", "mandate-rm-2", 7*Scale, 800, 7, 7*Scale, 1) },
	}
	for _, step := range steps {
		if err := step(); err != nil {
			t.Fatal(err)
		}
		confirmPending(t, e)
	}
	q, err := e.Quote(QuoteRequest{ID: "quote-rm", Borrower: "0xBorrower", Amount: 5 * Scale, TermDays: 14, MaxAPRBPS: 1200, CollateralFXRP: 40 * Scale, ExpiresAt: now.Add(5 * time.Minute).Unix()})
	if err != nil {
		t.Fatal(err)
	}
	if len(q.Tranches) != 2 || q.Tranches[0].MandateID != "mandate-rm-1" || q.Tranches[0].Principal != 3*Scale || q.Tranches[1].MandateID != "mandate-rm-2" || q.Tranches[1].Principal != 2*Scale {
		t.Fatalf("unexpected tranches: %+v", q.Tranches)
	}
	if err := e.AcceptQuote(q, "loan-rm", 0, nil); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	// Repay in full; both mandates must be restored and stay active. Refresh the
	// FTSO observation first so the subsequent quote is not stale.
	*now = now.Add(5 * 24 * time.Hour)
	if err := e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-rm-2"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	if err := e.Deposit("0xBorrower", AssetUSDT0, 6*Scale, "dep-rm-repay"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	if err := e.Repay("0xBorrower", 6*Scale, "repay-rm", 1); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	state := e.State()
	m1 := state.Mandates["mandate-rm-1"]
	m2 := state.Mandates["mandate-rm-2"]
	if m1.Available != 3*Scale || m1.AllocatedPrincipal != 0 || !m1.Active {
		t.Fatalf("mandate one not restored: %+v", m1)
	}
	if m2.Available != 7*Scale || m2.AllocatedPrincipal != 0 || !m2.Active {
		t.Fatalf("mandate two not restored: %+v", m2)
	}
	bal := state.Accounts["0xlender"].Balances[AssetUSDT0]
	if bal.Reserved != 10*Scale {
		t.Fatalf("reserved must back both mandates: %+v", bal)
	}
	if backing := m1.Available + m1.AllocatedPrincipal + m2.Available + m2.AllocatedPrincipal; bal.Reserved != backing {
		t.Fatalf("reserved invariant broken: reserved=%d backing=%d", bal.Reserved, backing)
	}
	// Both mandates lend again on the next quote.
	q2, err := e.Quote(QuoteRequest{ID: "quote-rm-2", Borrower: "0xBorrower2", Amount: 5 * Scale, TermDays: 14, MaxAPRBPS: 1200, CollateralFXRP: 40 * Scale, ExpiresAt: now.Add(5 * time.Minute).Unix()})
	if err != nil {
		t.Fatal(err)
	}
	if q2.Partial || q2.Amount != 5*Scale || len(q2.Tranches) != 2 {
		t.Fatalf("restored mandates must fund again: %+v", q2)
	}
}

// TestMixedActiveAndCancelledLenderRepayment: one loan, two tranches. Lender A
// cancels its mandate while 3 units of principal are still committed to the loan;
// lender B stays active. Repayment must send A's principal to A's withdrawable
// account balance and B's principal back into B's active mandate, with interest
// credited exactly once to each lender's account.
func TestMixedActiveAndCancelledLenderRepayment(t *testing.T) {
	e, _, now := newTestEngine(t)
	steps := []func() error{
		func() error { return e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-mix") },
		func() error { return e.Deposit("0xLenderA", AssetUSDT0, 10*Scale, "dep-mix-a") },
		func() error { return e.Deposit("0xLenderB", AssetUSDT0, 10*Scale, "dep-mix-b") },
		func() error { return e.Deposit("0xBorrower", AssetFXRP, 40*Scale, "dep-mix-borrower") },
		// Caps force a two-tranche loan: A lends 3 (cap), B lends 2.
		func() error { return e.SetMandate("0xLenderA", "mandate-mix-a", 10*Scale, 750, 7, 3*Scale, 0) },
		func() error { return e.SetMandate("0xLenderB", "mandate-mix-b", 10*Scale, 800, 7, 7*Scale, 0) },
	}
	for _, step := range steps {
		if err := step(); err != nil {
			t.Fatal(err)
		}
		confirmPending(t, e)
	}
	q, err := e.Quote(QuoteRequest{ID: "quote-mix", Borrower: "0xBorrower", Amount: 5 * Scale, TermDays: 14, MaxAPRBPS: 1200, CollateralFXRP: 40 * Scale, ExpiresAt: now.Add(5 * time.Minute).Unix()})
	if err != nil {
		t.Fatal(err)
	}
	if len(q.Tranches) != 2 || q.Tranches[0].MandateID != "mandate-mix-a" || q.Tranches[0].Principal != 3*Scale || q.Tranches[1].MandateID != "mandate-mix-b" || q.Tranches[1].Principal != 2*Scale {
		t.Fatalf("unexpected two-tranche quote: %+v", q.Tranches)
	}
	if err := e.AcceptQuote(q, "loan-mix", 0, nil); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	// Lender A cancels while 3 is still committed.
	if err := e.CancelMandate("0xLenderA", "mandate-mix-a", 1); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	state := e.State()
	mA := state.Mandates["mandate-mix-a"]
	if mA.Available != 0 || mA.AllocatedPrincipal != 3*Scale || mA.Active {
		t.Fatalf("unexpected cancelled mandate A: %+v", mA)
	}
	balA := state.Accounts["0xlendera"].Balances[AssetUSDT0]
	if balA.Available != 7*Scale || balA.Reserved != 3*Scale {
		t.Fatalf("unexpected lender A balance after cancel: %+v", balA)
	}
	// Accrue and repay in full.
	*now = now.Add(10 * 24 * time.Hour)
	if err := e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-mix-2"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	loan := e.State().Loans["loan-mix"]
	due := loan.Principal + loan.AccruedInterestRay/Scale
	interest := due - loan.Principal
	intA, err := expectedLenderInterest(loan, &loan.Tranches[0], interest)
	if err != nil {
		t.Fatal(err)
	}
	intB, err := expectedLenderInterest(loan, &loan.Tranches[1], interest)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.Deposit("0xBorrower", AssetUSDT0, due, "dep-mix-repay"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	if err := e.Repay("0xBorrower", due, "repay-mix", 1); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	assertReservedInvariant(t, e)
	state = e.State()
	// A's cancelled mandate: principal went to the account, mandate stays inert.
	mA = state.Mandates["mandate-mix-a"]
	if mA.Available != 0 || mA.AllocatedPrincipal != 0 || mA.Active {
		t.Fatalf("cancelled mandate must stay empty and inactive: %+v", mA)
	}
	balA = state.Accounts["0xlendera"].Balances[AssetUSDT0]
	if balA.Available != 10*Scale+intA {
		t.Fatalf("lender A must receive principal + interest exactly once, got %d want %d", balA.Available, 10*Scale+intA)
	}
	if balA.Reserved != 0 {
		t.Fatalf("lender A must have no reserved balance left: %+v", balA)
	}
	// B's active mandate: principal re-lends, only interest hits the account.
	mB := state.Mandates["mandate-mix-b"]
	if mB.Available != 10*Scale || mB.AllocatedPrincipal != 0 || !mB.Active {
		t.Fatalf("active mandate B not restored: %+v", mB)
	}
	balB := state.Accounts["0xlenderb"].Balances[AssetUSDT0]
	if balB.Available != intB {
		t.Fatalf("lender B must receive interest exactly once, got %d want %d", balB.Available, intB)
	}
	if balB.Reserved != 10*Scale {
		t.Fatalf("lender B principal must stay reserved: %+v", balB)
	}
}

// TestWithdrawThenRepayCycleBoundsRestoration: a lender withdraws part of the
// unallocated liquidity while a loan is live. Repayment must restore only the
// remaining mandate claim: the withdrawn amount can never come back, so no
// over-credit is possible and AllocatedPrincipal lands exactly at zero.
func TestWithdrawThenRepayCycleBoundsRestoration(t *testing.T) {
	e, _, now := newTestEngine(t)
	steps := []func() error{
		func() error { return e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-wr") },
		func() error { return e.Deposit("0xLender", AssetUSDT0, 10*Scale, "dep-wr-l") },
		func() error { return e.Deposit("0xBorrower", AssetFXRP, 40*Scale, "dep-wr-b") },
		func() error { return e.SetMandate("0xLender", "mandate-wr", 10*Scale, 750, 7, 10*Scale, 0) },
	}
	for _, step := range steps {
		if err := step(); err != nil {
			t.Fatal(err)
		}
		confirmPending(t, e)
	}
	q, err := e.Quote(QuoteRequest{ID: "quote-wr", Borrower: "0xBorrower", Amount: 4 * Scale, TermDays: 14, MaxAPRBPS: 1200, CollateralFXRP: 40 * Scale, ExpiresAt: now.Add(5 * time.Minute).Unix()})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.AcceptQuote(q, "loan-wr", 0, nil); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	// Withdraw 4 of the 6 unallocated.
	if err := e.Withdraw("0xLender", AssetUSDT0, 4*Scale, "withdraw-wr", 1); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	state := e.State()
	if m := state.Mandates["mandate-wr"]; m.Available != 2*Scale || m.AllocatedPrincipal != 4*Scale || !m.Active {
		t.Fatalf("unexpected mandate after withdraw: %+v", m)
	}
	if bal := state.Accounts["0xlender"].Balances[AssetUSDT0]; bal.Available != 0 || bal.Reserved != 6*Scale {
		t.Fatalf("unexpected balance after withdraw: %+v", bal)
	}
	// Repay in full.
	*now = now.Add(10 * 24 * time.Hour)
	if err := e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-wr-2"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	loan := e.State().Loans["loan-wr"]
	due := loan.Principal + loan.AccruedInterestRay/Scale
	interest := due - loan.Principal
	intL, err := expectedLenderInterest(loan, &loan.Tranches[0], interest)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.Deposit("0xBorrower", AssetUSDT0, due, "dep-wr-repay"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	if err := e.Repay("0xBorrower", due, "repay-wr", 1); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	assertReservedInvariant(t, e)
	state = e.State()
	m := state.Mandates["mandate-wr"]
	if m.Available != 6*Scale || m.AllocatedPrincipal != 0 || !m.Active {
		t.Fatalf("repayment must restore only the remaining claim: %+v", m)
	}
	bal := state.Accounts["0xlender"].Balances[AssetUSDT0]
	if bal.Reserved != 6*Scale {
		t.Fatalf("reserved must equal restored mandate claim: %+v", bal)
	}
	if bal.Available != intL {
		t.Fatalf("only interest may land in the withdrawable balance, got %d want %d", bal.Available, intL)
	}
	// Total lender claim: 6 restored + 4 already withdrawn = 10. Never more.
	if bal.Available+bal.Reserved != 6*Scale+intL {
		t.Fatalf("principal was duplicated or destroyed: %+v", bal)
	}
}

// TestReplayAndClosedLoanBoundaries: every re-entry point after a loan closes or
// liquidates must fail without mutating state, and a second RiskTick must not
// re-liquidate an already-liquidated loan.
func TestReplayAndClosedLoanBoundaries(t *testing.T) {
	e, _, now := newTestEngine(t)
	steps := []func() error{
		func() error { return e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-rb") },
		func() error { return e.Deposit("0xLender", AssetUSDT0, 10*Scale, "dep-rb-l") },
		func() error { return e.Deposit("0xBorrower", AssetFXRP, 40*Scale, "dep-rb-b1") },
		func() error { return e.Deposit("0xBorrower2", AssetFXRP, 40*Scale, "dep-rb-b2") },
		func() error { return e.SetMandate("0xLender", "mandate-rb", 10*Scale, 750, 7, 10*Scale, 0) },
	}
	for _, step := range steps {
		if err := step(); err != nil {
			t.Fatal(err)
		}
		confirmPending(t, e)
	}
	// Loan 1: repay it, then probe every post-close re-entry.
	q, err := e.Quote(QuoteRequest{ID: "quote-rb-1", Borrower: "0xBorrower", Amount: 4 * Scale, TermDays: 14, MaxAPRBPS: 1200, CollateralFXRP: 40 * Scale, ExpiresAt: now.Add(5 * time.Minute).Unix()})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.AcceptQuote(q, "loan-rb-1", 0, nil); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	*now = now.Add(5 * 24 * time.Hour)
	if err := e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-rb-2"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	loan := e.State().Loans["loan-rb-1"]
	due := loan.Principal + loan.AccruedInterestRay/Scale
	if err := e.Deposit("0xBorrower", AssetUSDT0, due, "dep-rb-repay"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	if err := e.Repay("0xBorrower", due, "repay-rb-1", 1); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	// Replaying the same operation ID must be a no-op.
	before := e.State()
	if err := e.Repay("0xBorrower", due, "repay-rb-1", 1); !errors.Is(err, ErrDuplicate) {
		t.Fatalf("expected ErrDuplicate on replay, got %v", err)
	}
	assertStateUnchanged(t, before, e.State())
	// A fresh operation ID after close fails with no active loan. The nonce check
	// runs first, so pass the current nonce (2) to reach the loan lookup.
	before = e.State()
	if err := e.Repay("0xBorrower", due, "repay-rb-fresh", 2); !strings.Contains(err.Error(), "no active loan") {
		t.Fatalf("expected no active loan, got %v", err)
	}
	assertStateUnchanged(t, before, e.State())
	// Liquidating a closed loan fails.
	before = e.State()
	if err := e.Liquidate("loan-rb-1", "liq-rb-after-close"); !strings.Contains(err.Error(), "not liquidatable") {
		t.Fatalf("expected not liquidatable, got %v", err)
	}
	assertStateUnchanged(t, before, e.State())
	// Loan 2: drive it to liquidation, then probe post-liquidation re-entry.
	if err := e.SeedBackstop(10*Scale, "backstop-rb"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	q2, err := e.Quote(QuoteRequest{ID: "quote-rb-2", Borrower: "0xBorrower2", Amount: 4 * Scale, TermDays: 14, MaxAPRBPS: 1200, CollateralFXRP: 40 * Scale, ExpiresAt: now.Add(5 * time.Minute).Unix()})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.AcceptQuote(q2, "loan-rb-2", 0, nil); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	// Maturity + 1 day makes the loan liquidatable regardless of price, which is
	// deterministic and independent of the collateral math.
	*now = now.Add(20 * 24 * time.Hour)
	if err := e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-rb-crash"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	if got := e.State().Loans["loan-rb-2"].Status; got != "liquidated" {
		t.Fatalf("loan should be liquidated, status=%s", got)
	}
	// Repay after liquidation fails. Borrower2's nonce is 1 after accepting.
	before = e.State()
	if err := e.Repay("0xBorrower2", 1, "repay-rb-after-liq", 1); !strings.Contains(err.Error(), "no active loan") {
		t.Fatalf("expected no active loan after liquidation, got %v", err)
	}
	assertStateUnchanged(t, before, e.State())
	// Liquidating an already-liquidated loan fails.
	before = e.State()
	if err := e.Liquidate("loan-rb-2", "liq-rb-twice"); !strings.Contains(err.Error(), "not liquidatable") {
		t.Fatalf("expected not liquidatable after liquidation, got %v", err)
	}
	assertStateUnchanged(t, before, e.State())
	// A second RiskTick cannot double-liquidate or re-credit anything.
	snap := snapshotAccounting(e)
	if err := e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-rb-again"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	after := snapshotAccounting(e)
	if !reflect.DeepEqual(snap, after) {
		t.Fatalf("second RiskTick changed accounting: before=%+v after=%+v", snap, after)
	}
	if got := e.State().Loans["loan-rb-2"].Status; got != "liquidated" {
		t.Fatalf("already-liquidated loan must stay liquidated, status=%s", got)
	}
}

// TestMultipleLoansOnCancelledMandateReturnPrincipal: one lender, one mandate
// backing two simultaneous loans. Cancellation releases only unallocated
// liquidity; each repayment must return exactly that loan's principal to the
// account balance and shrink Reserved in lockstep, with no double-credit.
func TestMultipleLoansOnCancelledMandateReturnPrincipal(t *testing.T) {
	e, _, now := newTestEngine(t)
	steps := []func() error{
		func() error { return e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-mc") },
		func() error { return e.Deposit("0xLender", AssetUSDT0, 10*Scale, "dep-mc-l") },
		func() error { return e.Deposit("0xBorrower1", AssetFXRP, 40*Scale, "dep-mc-b1") },
		func() error { return e.Deposit("0xBorrower2", AssetFXRP, 40*Scale, "dep-mc-b2") },
		func() error { return e.SetMandate("0xLender", "mandate-mc", 10*Scale, 750, 7, 10*Scale, 0) },
	}
	for _, step := range steps {
		if err := step(); err != nil {
			t.Fatal(err)
		}
		confirmPending(t, e)
	}
	q1, err := e.Quote(QuoteRequest{ID: "quote-mc-1", Borrower: "0xBorrower1", Amount: 3 * Scale, TermDays: 14, MaxAPRBPS: 1200, CollateralFXRP: 40 * Scale, ExpiresAt: now.Add(5 * time.Minute).Unix()})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.AcceptQuote(q1, "loan-mc-1", 0, nil); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	q2, err := e.Quote(QuoteRequest{ID: "quote-mc-2", Borrower: "0xBorrower2", Amount: 3 * Scale, TermDays: 14, MaxAPRBPS: 1200, CollateralFXRP: 40 * Scale, ExpiresAt: now.Add(5 * time.Minute).Unix()})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.AcceptQuote(q2, "loan-mc-2", 0, nil); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	state := e.State()
	if m := state.Mandates["mandate-mc"]; m.Available != 4*Scale || m.AllocatedPrincipal != 6*Scale {
		t.Fatalf("unexpected mandate after two loans: %+v", m)
	}
	if bal := state.Accounts["0xlender"].Balances[AssetUSDT0]; bal.Available != 0 || bal.Reserved != 10*Scale {
		t.Fatalf("unexpected balance after two loans: %+v", bal)
	}
	// Cancel while both loans are committed.
	if err := e.CancelMandate("0xLender", "mandate-mc", 1); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	state = e.State()
	if m := state.Mandates["mandate-mc"]; m.Available != 0 || m.AllocatedPrincipal != 6*Scale || m.Active {
		t.Fatalf("unexpected cancelled mandate: %+v", m)
	}
	if bal := state.Accounts["0xlender"].Balances[AssetUSDT0]; bal.Available != 4*Scale || bal.Reserved != 6*Scale {
		t.Fatalf("cancel must release only unallocated: %+v", bal)
	}
	// Accrue both loans, then repay them in separate operations.
	*now = now.Add(10 * 24 * time.Hour)
	if err := e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-mc-2"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	loan1 := e.State().Loans["loan-mc-1"]
	due1 := loan1.Principal + loan1.AccruedInterestRay/Scale
	int1, err := expectedLenderInterest(loan1, &loan1.Tranches[0], due1-loan1.Principal)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.Deposit("0xBorrower1", AssetUSDT0, due1, "dep-mc-repay-1"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	if err := e.Repay("0xBorrower1", due1, "repay-mc-1", 1); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	state = e.State()
	if bal := state.Accounts["0xlender"].Balances[AssetUSDT0]; bal.Reserved != 3*Scale {
		t.Fatalf("reserved must shrink by exactly loan 1 principal: %+v", bal)
	}
	loan2 := state.Loans["loan-mc-2"]
	due2 := loan2.Principal + loan2.AccruedInterestRay/Scale
	int2, err := expectedLenderInterest(loan2, &loan2.Tranches[0], due2-loan2.Principal)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.Deposit("0xBorrower2", AssetUSDT0, due2, "dep-mc-repay-2"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	if err := e.Repay("0xBorrower2", due2, "repay-mc-2", 1); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	assertReservedInvariant(t, e)
	state = e.State()
	m := state.Mandates["mandate-mc"]
	if m.Available != 0 || m.AllocatedPrincipal != 0 || m.Active {
		t.Fatalf("mandate must stay cancelled and empty: %+v", m)
	}
	bal := state.Accounts["0xlender"].Balances[AssetUSDT0]
	want := 10*Scale + int1 + int2
	if bal.Available != want {
		t.Fatalf("principal + interest must return exactly once: got %d want %d", bal.Available, want)
	}
	if bal.Reserved != 0 {
		t.Fatalf("no reserved balance may remain: %+v", bal)
	}
}

// TestCancelMandateAfterPartialWithdrawal: cancelling after withdrawing part of
// the unallocated liquidity must release exactly the remaining unallocated
// amount and leave committed principal untouched.
func TestCancelMandateAfterPartialWithdrawal(t *testing.T) {
	e, _, now := newTestEngine(t)
	steps := []func() error{
		func() error { return e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-cw") },
		func() error { return e.Deposit("0xLender", AssetUSDT0, 10*Scale, "dep-cw-l") },
		func() error { return e.Deposit("0xBorrower", AssetFXRP, 40*Scale, "dep-cw-b") },
		func() error { return e.SetMandate("0xLender", "mandate-cw", 10*Scale, 750, 7, 10*Scale, 0) },
	}
	for _, step := range steps {
		if err := step(); err != nil {
			t.Fatal(err)
		}
		confirmPending(t, e)
	}
	q, err := e.Quote(QuoteRequest{ID: "quote-cw", Borrower: "0xBorrower", Amount: 4 * Scale, TermDays: 14, MaxAPRBPS: 1200, CollateralFXRP: 40 * Scale, ExpiresAt: now.Add(5 * time.Minute).Unix()})
	if err != nil {
		t.Fatal(err)
	}
	if err := e.AcceptQuote(q, "loan-cw", 0, nil); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	// Withdraw 3 of the 6 unallocated, then cancel.
	if err := e.Withdraw("0xLender", AssetUSDT0, 3*Scale, "withdraw-cw", 1); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	if err := e.CancelMandate("0xLender", "mandate-cw", 2); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	state := e.State()
	m := state.Mandates["mandate-cw"]
	if m.Available != 0 || m.AllocatedPrincipal != 4*Scale || m.Active {
		t.Fatalf("unexpected cancelled mandate: %+v", m)
	}
	bal := state.Accounts["0xlender"].Balances[AssetUSDT0]
	if bal.Available != 3*Scale || bal.Reserved != 4*Scale {
		t.Fatalf("cancel must release only the remaining unallocated: %+v", bal)
	}
	// Committed principal is untouched; repay unwinds it to the account.
	*now = now.Add(10 * 24 * time.Hour)
	if err := e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-cw-2"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	loan := e.State().Loans["loan-cw"]
	due := loan.Principal + loan.AccruedInterestRay/Scale
	intL, err := expectedLenderInterest(loan, &loan.Tranches[0], due-loan.Principal)
	if err != nil {
		t.Fatal(err)
	}
	if err := e.Deposit("0xBorrower", AssetUSDT0, due, "dep-cw-repay"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	if err := e.Repay("0xBorrower", due, "repay-cw", 1); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	assertReservedInvariant(t, e)
	state = e.State()
	m = state.Mandates["mandate-cw"]
	if m.Available != 0 || m.AllocatedPrincipal != 0 || m.Active {
		t.Fatalf("mandate must stay cancelled and empty: %+v", m)
	}
	bal = state.Accounts["0xlender"].Balances[AssetUSDT0]
	want := 7*Scale + intL // 3 withdrawn earlier + 4 principal + interest
	if bal.Available != want {
		t.Fatalf("principal must return exactly once: got %d want %d", bal.Available, want)
	}
	if bal.Reserved != 0 {
		t.Fatalf("no reserved balance may remain: %+v", bal)
	}
}

// TestWithdrawalExactBoundaryAndZeroMutationOnOverdraw: withdrawing exactly the
// withdrawable amount (account.Available + sum of mandate.Available) succeeds and
// consumes all of it; one more base unit fails with ErrInsufficientBalance and
// leaves the state root, sequence, and nonce byte-for-byte unchanged.
func TestWithdrawalExactBoundaryAndZeroMutationOnOverdraw(t *testing.T) {
	e, _, now := newTestEngine(t)
	steps := []func() error{
		func() error { return e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-eb") },
		func() error { return e.Deposit("0xLender", AssetUSDT0, 10*Scale, "dep-eb") },
		func() error { return e.SetMandate("0xLender", "mandate-eb", 8*Scale, 750, 7, 8*Scale, 0) },
	}
	for _, step := range steps {
		if err := step(); err != nil {
			t.Fatal(err)
		}
		confirmPending(t, e)
	}
	state := e.State()
	bal := state.Accounts["0xlender"].Balances[AssetUSDT0]
	m := state.Mandates["mandate-eb"]
	if bal.Available != 2*Scale || bal.Reserved != 8*Scale || m.Available != 8*Scale {
		t.Fatalf("unexpected setup: %+v %+v", bal, m)
	}
	withdrawable := bal.Available + m.Available
	if withdrawable != 10*Scale {
		t.Fatalf("withdrawable should be 10 USDT0, got %d", withdrawable)
	}
	if err := e.Withdraw("0xLender", AssetUSDT0, withdrawable, "withdraw-eb", 1); err != nil {
		t.Fatalf("exact-boundary withdrawal must succeed: %v", err)
	}
	confirmPending(t, e)
	state = e.State()
	bal = state.Accounts["0xlender"].Balances[AssetUSDT0]
	m = state.Mandates["mandate-eb"]
	if bal.Available != 0 || bal.Reserved != 0 {
		t.Fatalf("all withdrawable liquidity must be consumed: %+v", bal)
	}
	if m.Available != 0 || m.Active {
		t.Fatalf("mandate must be emptied and deactivated: %+v", m)
	}
	// One base unit more must fail and change nothing at all.
	before := e.State()
	if err := e.Withdraw("0xLender", AssetUSDT0, 1, "withdraw-eb-over", 2); !errors.Is(err, ErrInsufficientBalance) {
		t.Fatalf("expected ErrInsufficientBalance, got %v", err)
	}
	assertStateUnchanged(t, before, e.State())
	if nonce := e.State().Accounts["0xlender"].Nonce; nonce != 2 {
		t.Fatalf("failed withdrawal must not consume the nonce: got %d want 2", nonce)
	}
}

// TestMultiCycleConservationAndReLend: several lend -> borrow -> repay cycles on
// one active mandate. Repaid principal must return to Mandate.Available every
// cycle, only interest may accumulate in the withdrawable balance, InterestEarned
// must track it exactly, ProtocolReserve must accumulate the spread, and the
// Reserved invariant must hold after every operation.
func TestMultiCycleConservationAndReLend(t *testing.T) {
	e, _, now := newTestEngine(t)
	steps := []func() error{
		func() error { return e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-cyc") },
		func() error { return e.Deposit("0xLender", AssetUSDT0, 10*Scale, "dep-cyc-l") },
		func() error { return e.Deposit("0xBorrower", AssetFXRP, 40*Scale, "dep-cyc-b") },
		func() error { return e.SetMandate("0xLender", "mandate-cyc", 10*Scale, 750, 7, 10*Scale, 0) },
	}
	for _, step := range steps {
		if err := step(); err != nil {
			t.Fatal(err)
		}
		confirmPending(t, e)
	}
	var totalInterest, totalSpread uint64
	for i := 1; i <= 3; i++ {
		quoteID := fmt.Sprintf("quote-cyc-%d", i)
		q, err := e.Quote(QuoteRequest{ID: quoteID, Borrower: "0xBorrower", Amount: 4 * Scale, TermDays: 14, MaxAPRBPS: 1200, CollateralFXRP: 40 * Scale, ExpiresAt: now.Add(5 * time.Minute).Unix()})
		if err != nil {
			t.Fatal(err)
		}
		if q.Partial || q.Amount != 4*Scale || len(q.Tranches) != 1 {
			t.Fatalf("cycle %d: restored liquidity must fully fund the quote: %+v", i, q)
		}
		if err := e.AcceptQuote(q, fmt.Sprintf("loan-cyc-%d", i), uint64((i-1)*2), nil); err != nil {
			t.Fatalf("cycle %d accept: %v", i, err)
		}
		confirmPending(t, e)
		assertReservedInvariant(t, e)
		// Accrue, then repay in full.
		*now = now.Add(10 * 24 * time.Hour)
		if err := e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, fmt.Sprintf("price-cyc-%d", i)); err != nil {
			t.Fatal(err)
		}
		confirmPending(t, e)
		loan := e.State().Loans[fmt.Sprintf("loan-cyc-%d", i)]
		due := loan.Principal + loan.AccruedInterestRay/Scale
		interest := due - loan.Principal
		intL, err := expectedLenderInterest(loan, &loan.Tranches[0], interest)
		if err != nil {
			t.Fatal(err)
		}
		totalInterest += intL
		totalSpread += interest - intL
		if err := e.Deposit("0xBorrower", AssetUSDT0, due, fmt.Sprintf("dep-cyc-repay-%d", i)); err != nil {
			t.Fatal(err)
		}
		confirmPending(t, e)
		if err := e.Repay("0xBorrower", due, fmt.Sprintf("repay-cyc-%d", i), uint64((i-1)*2+1)); err != nil {
			t.Fatalf("cycle %d repay: %v", i, err)
		}
		confirmPending(t, e)
		assertReservedInvariant(t, e)
		state := e.State()
		m := state.Mandates["mandate-cyc"]
		if m.Available != 10*Scale || m.AllocatedPrincipal != 0 || !m.Active {
			t.Fatalf("cycle %d: principal must re-lend through the mandate: %+v", i, m)
		}
		bal := state.Accounts["0xlender"].Balances[AssetUSDT0]
		if bal.Reserved != 10*Scale {
			t.Fatalf("cycle %d: principal must stay reserved: %+v", i, bal)
		}
		if bal.Available != totalInterest {
			t.Fatalf("cycle %d: only interest may accumulate in Available: got %d want %d", i, bal.Available, totalInterest)
		}
		if m.InterestEarned != totalInterest {
			t.Fatalf("cycle %d: InterestEarned must track credited interest: got %d want %d", i, m.InterestEarned, totalInterest)
		}
		if state.ProtocolReserve != totalSpread {
			t.Fatalf("cycle %d: protocol spread mismatch: got %d want %d", i, state.ProtocolReserve, totalSpread)
		}
	}
	// After three cycles the lender holds exactly 10 principal + all interest.
	state := e.State()
	bal := state.Accounts["0xlender"].Balances[AssetUSDT0]
	if bal.Available+bal.Reserved != 10*Scale+totalInterest {
		t.Fatalf("principal duplicated or destroyed across cycles: %+v", bal)
	}
	if state.Mandates["mandate-cyc"].InterestEarned != totalInterest {
		t.Fatalf("InterestEarned mismatch: %+v", state.Mandates["mandate-cyc"])
	}
}

// TestWithdrawableBoundedByVaultEquivalentClaims pins the FCC-side guarantee that
// underpins the on-chain vault-liquidity pre-check: at every point the sum of all
// lenders' withdrawable amounts (available balance + unallocated mandate
// liquidity) never exceeds total USDT0 claims minus active debt — the amount the
// vault provably holds (conservation: vault = claims − ActiveDebt) — and the
// engine authorizes exactly that much per lender, never more.
func TestWithdrawableBoundedByVaultEquivalentClaims(t *testing.T) {
	e, _, now := newTestEngine(t)
	steps := []func() error{
		func() error { return e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-bv") },
		func() error { return e.Deposit("0xLender1", AssetUSDT0, 10*Scale, "dep-bv-l1") },
		func() error { return e.Deposit("0xLender2", AssetUSDT0, 10*Scale, "dep-bv-l2") },
		func() error { return e.Deposit("0xBorrower1", AssetFXRP, 40*Scale, "dep-bv-b1") },
		func() error { return e.Deposit("0xBorrower2", AssetFXRP, 40*Scale, "dep-bv-b2") },
		// Caps force each loan to split across both lenders: 2 + 2 per loan.
		func() error { return e.SetMandate("0xLender1", "mandate-bv-1", 10*Scale, 750, 7, 2*Scale, 0) },
		func() error { return e.SetMandate("0xLender2", "mandate-bv-2", 10*Scale, 800, 7, 2*Scale, 0) },
	}
	for _, step := range steps {
		if err := step(); err != nil {
			t.Fatal(err)
		}
		confirmPending(t, e)
	}
	assertWithdrawableBound(t, e, true)
	// Two live loans: 4 each, split 2/2 across the lenders. Each lender is now
	// committed 4 and withdrawable 6.
	for _, loan := range []struct {
		id       string
		borrower string
	}{
		{"loan-bv-1", "0xBorrower1"},
		{"loan-bv-2", "0xBorrower2"},
	} {
		q, err := e.Quote(QuoteRequest{ID: "quote-" + loan.id, Borrower: loan.borrower, Amount: 4 * Scale, TermDays: 14, MaxAPRBPS: 1200, CollateralFXRP: 40 * Scale, ExpiresAt: now.Add(5 * time.Minute).Unix()})
		if err != nil {
			t.Fatal(err)
		}
		if len(q.Tranches) != 2 {
			t.Fatalf("expected a two-tranche loan, got %+v", q.Tranches)
		}
		if err := e.AcceptQuote(q, loan.id, 0, nil); err != nil {
			t.Fatal(err)
		}
		confirmPending(t, e)
	}
	assertWithdrawableBound(t, e, true)
	// Each lender can withdraw exactly their full withdrawable 6 — the vault
	// equivalent bound — and not one unit more.
	for i, lender := range []string{"0xLender1", "0xLender2"} {
		state := e.State()
		acct := state.Accounts[strings.ToLower(lender)]
		var withdrawable uint64 = acct.Balances[AssetUSDT0].Available
		for _, m := range state.Mandates {
			if m.Lender == acct.Owner {
				withdrawable += m.Available
			}
		}
		if withdrawable != 6*Scale {
			t.Fatalf("lender %s should be withdrawable for 6, got %d", lender, withdrawable)
		}
		if err := e.Withdraw(lender, AssetUSDT0, withdrawable, fmt.Sprintf("withdraw-bv-%d", i), 1); err != nil {
			t.Fatalf("full withdrawable withdrawal must succeed: %v", err)
		}
		confirmPending(t, e)
	}
	assertWithdrawableBound(t, e, true)
	// Withdrawing beyond the bound is refused, and refusing changes nothing.
	before := e.State()
	if err := e.Withdraw("0xLender1", AssetUSDT0, 1, "withdraw-bv-over", 2); !errors.Is(err, ErrInsufficientBalance) {
		t.Fatalf("expected ErrInsufficientBalance beyond the bound, got %v", err)
	}
	assertStateUnchanged(t, before, e.State())
	// Repay loan one: the restored principal becomes withdrawable again through
	// the active mandates, and the bound still holds (protocol spread narrows it).
	*now = now.Add(5 * 24 * time.Hour)
	if err := e.RiskTick(Price{XRPUSDE6: 600_000, UpdatedAt: now.Unix()}, "price-bv-2"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	loan := e.State().Loans["loan-bv-1"]
	due := loan.Principal + loan.AccruedInterestRay/Scale
	if err := e.Deposit("0xBorrower1", AssetUSDT0, due, "dep-bv-repay"); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	if err := e.Repay("0xBorrower1", due, "repay-bv-1", 1); err != nil {
		t.Fatal(err)
	}
	confirmPending(t, e)
	assertWithdrawableBound(t, e, false) // protocol spread has accrued, so strict equality no longer holds
	assertReservedInvariant(t, e)
}

// assertWithdrawableBound verifies that the sum of all lenders' withdrawable
// amounts never exceeds the vault-equivalent liquidity (total USDT0 claims minus
// active debt). When strict is true it also verifies the identity holds with
// equality, which is the case before any protocol spread or backstop exists.
func assertWithdrawableBound(t *testing.T, e *Engine, strict bool) {
	t.Helper()
	state := e.State()
	var totalClaims, withdrawable uint64
	for _, acct := range state.Accounts {
		withdrawable += acct.Balances[AssetUSDT0].Available
		totalClaims += acct.Balances[AssetUSDT0].Available + acct.Balances[AssetUSDT0].Reserved
		for _, m := range state.Mandates {
			if m.Lender == acct.Owner {
				withdrawable += m.Available
			}
		}
	}
	totalClaims += state.ProtocolReserve + state.BackstopUSDT0
	vaultEquivalent := totalClaims - state.ActiveDebt
	if withdrawable > vaultEquivalent {
		t.Fatalf("withdrawable %d exceeds vault-equivalent liquidity %d (claims %d, debt %d)", withdrawable, vaultEquivalent, totalClaims, state.ActiveDebt)
	}
	if strict && withdrawable != vaultEquivalent {
		t.Fatalf("withdrawable %d must equal vault-equivalent %d when no spread/backstop exists", withdrawable, vaultEquivalent)
	}
}
