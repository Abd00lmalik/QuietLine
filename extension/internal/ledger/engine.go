package ledger

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"
)

var (
	ErrInsufficientBalance = errors.New("insufficient private balance")
	ErrDuplicate           = errors.New("operation already processed")
	ErrLiquidityChanged    = errors.New("liquidity changed; request a new quote")
	ErrAnchorPending       = errors.New("previous confidential mutation is awaiting on-chain anchor")
)

type Engine struct {
	mu    sync.RWMutex
	store *Store
	state *State
	clock func() time.Time
}

func NewEngine(store *Store) (*Engine, error) {
	state, err := store.Load()
	if err != nil {
		return nil, err
	}
	return &Engine{store: store, state: state, clock: time.Now}, nil
}

func (e *Engine) State() State {
	e.mu.RLock()
	defer e.mu.RUnlock()
	b, _ := json.Marshal(e.state)
	var out State
	_ = json.Unmarshal(b, &out)
	return out
}

func (e *Engine) mutate(kind, operationID string, fn func(*State) error) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.state.PendingAnchor != nil {
		return ErrAnchorPending
	}
	b, _ := json.Marshal(e.state)
	var next State
	if err := json.Unmarshal(b, &next); err != nil {
		return err
	}
	if err := fn(&next); err != nil {
		return err
	}
	previousSequence, previousRoot := e.state.Sequence, e.state.Root
	next.Sequence = previousSequence + 1
	next.Root = rootOf(&next)
	next.PendingAnchor = &PendingAnchor{
		Kind:             kind,
		OperationID:      operationID,
		PreviousSequence: previousSequence,
		NextSequence:     next.Sequence,
		PreviousRoot:     previousRoot,
		NextRoot:         next.Root,
	}
	if err := e.store.Commit(&next, kind); err != nil {
		return fmt.Errorf("persisting mutation: %w", err)
	}
	e.state = &next
	return nil
}

func rootOf(state *State) string {
	clone := *state
	clone.Root = ""
	clone.PendingAnchor = nil
	b, _ := json.Marshal(clone)
	sum := sha256.Sum256(b)
	return "0x" + hex.EncodeToString(sum[:])
}

func account(state *State, owner string) *Account {
	owner = strings.ToLower(owner)
	a := state.Accounts[owner]
	if a == nil {
		a = &Account{Owner: owner, Balances: map[string]Balance{AssetFXRP: {}, AssetUSDT0: {}}}
		state.Accounts[owner] = a
	}
	return a
}

func consumeNonce(a *Account, expected uint64) error {
	if a.Nonce != expected {
		return fmt.Errorf("stale or future account nonce: expected %d, got %d", a.Nonce, expected)
	}
	a.Nonce++
	return nil
}

func (e *Engine) OpenAccount(owner, operationID string, expectedNonce uint64) error {
	return e.mutate("OPEN_ACCOUNT", operationID, func(s *State) error {
		if s.Processed[operationID] {
			return ErrDuplicate
		}
		if err := consumeNonce(account(s, owner), expectedNonce); err != nil {
			return err
		}
		s.Processed[operationID] = true
		return nil
	})
}

func (e *Engine) Deposit(owner, asset string, amount uint64, depositID string) error {
	if amount == 0 || (asset != AssetFXRP && asset != AssetUSDT0) {
		return errors.New("invalid deposit")
	}
	return e.mutate("DEPOSIT", depositID, func(s *State) error {
		if s.Processed[depositID] {
			return ErrDuplicate
		}
		a := account(s, owner)
		bal := a.Balances[asset]
		if ^uint64(0)-bal.Available < amount {
			return errors.New("private balance exceeds uint64")
		}
		bal.Available += amount
		a.Balances[asset] = bal
		s.Processed[depositID] = true
		s.Activities = append(s.Activities, Activity{ID: depositID, Account: a.Owner, Kind: "deposit", Asset: asset, Amount: amount, CreatedAt: nowUnix(e.clock())})
		return nil
	})
}

func (e *Engine) SetMandate(owner, id string, amount uint64, minAPR uint32, termMask uint8, perBorrowerCap uint64, expectedNonce uint64) error {
	if amount == 0 || minAPR < 600 || minAPR > 2000 || termMask == 0 || termMask > 7 || perBorrowerCap == 0 {
		return errors.New("invalid mandate")
	}
	return e.mutate("SET_MANDATE", id, func(s *State) error {
		if _, exists := s.Mandates[id]; exists {
			return ErrDuplicate
		}
		a := account(s, owner)
		if err := consumeNonce(a, expectedNonce); err != nil {
			return err
		}
		bal := a.Balances[AssetUSDT0]
		if bal.Available < amount {
			return ErrInsufficientBalance
		}
		bal.Available -= amount
		bal.Reserved += amount
		a.Balances[AssetUSDT0] = bal
		s.Mandates[id] = &Mandate{ID: id, Lender: a.Owner, Available: amount, MinAPRBPS: minAPR, TermMask: termMask, PerBorrowerCap: perBorrowerCap, Active: true, CreatedAt: nowUnix(e.clock())}
		return nil
	})
}

func (e *Engine) CancelMandate(owner, id string, expectedNonce uint64) error {
	return e.mutate("CANCEL_MANDATE", id, func(s *State) error {
		m := s.Mandates[id]
		if m == nil || m.Lender != strings.ToLower(owner) || !m.Active {
			return errors.New("mandate unavailable")
		}
		a := account(s, owner)
		if err := consumeNonce(a, expectedNonce); err != nil {
			return err
		}
		bal := a.Balances[AssetUSDT0]
		bal.Reserved -= m.Available
		bal.Available += m.Available
		a.Balances[AssetUSDT0] = bal
		m.Available = 0
		m.Active = false
		return nil
	})
}

func (e *Engine) Quote(req QuoteRequest) (Quote, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	return quote(e.state, req, e.clock())
}

func (e *Engine) QuoteAtPrice(req QuoteRequest, observed Price) (Quote, error) {
	e.mu.RLock()
	defer e.mu.RUnlock()
	now := e.clock()
	if observed.XRPUSDE6 == 0 || observed.UpdatedAt > now.Unix() || now.Unix()-observed.UpdatedAt > 300 {
		return Quote{}, errors.New("invalid or stale FTSO observation")
	}
	snapshot := *e.state
	snapshot.Price = observed
	return quote(&snapshot, req, now)
}

func quote(s *State, req QuoteRequest, now time.Time) (Quote, error) {
	if req.Amount < Scale || req.Amount > 5*Scale || termBit(req.TermDays) == 0 || req.MaxAPRBPS < 650 || req.ExpiresAt <= now.Unix() {
		return Quote{}, errors.New("invalid quote request")
	}
	if s.Price.XRPUSDE6 == 0 || now.Unix()-s.Price.UpdatedAt > 300 {
		return Quote{}, errors.New("FTSO price is stale")
	}
	value := req.CollateralFXRP * s.Price.XRPUSDE6 / Scale
	if value == 0 || req.Amount*BPS/value > 5000 {
		return Quote{}, errors.New("initial LTV exceeds 50%")
	}
	if s.ActiveDebt+req.Amount > 8*Scale {
		return Quote{}, errors.New("global active debt cap exceeded")
	}
	eligible := make([]*Mandate, 0)
	for _, m := range s.Mandates {
		if m.Active && m.Available > 0 && m.TermMask&termBit(req.TermDays) != 0 && uint32(m.MinAPRBPS+50) <= req.MaxAPRBPS {
			eligible = append(eligible, m)
		}
	}
	sort.Slice(eligible, func(i, j int) bool {
		if eligible[i].MinAPRBPS != eligible[j].MinAPRBPS {
			return eligible[i].MinAPRBPS < eligible[j].MinAPRBPS
		}
		hi := sha256.Sum256([]byte(eligible[i].ID + req.ID))
		hj := sha256.Sum256([]byte(eligible[j].ID + req.ID))
		return string(hi[:]) < string(hj[:])
	})
	remaining, weighted := req.Amount, uint64(0)
	tranches := []Tranche{}
	for _, m := range eligible {
		take := m.Available
		if take > m.PerBorrowerCap {
			take = m.PerBorrowerCap
		}
		if take > remaining {
			take = remaining
		}
		if take == 0 {
			continue
		}
		tranches = append(tranches, Tranche{MandateID: m.ID, Lender: m.Lender, Principal: take, APRBPS: m.MinAPRBPS})
		weighted += take * uint64(m.MinAPRBPS)
		remaining -= take
		if remaining == 0 {
			break
		}
	}
	if remaining != 0 {
		return Quote{}, ErrLiquidityChanged
	}
	lenderAPR := uint32(weighted / req.Amount)
	return Quote{RequestID: req.ID, Borrower: strings.ToLower(req.Borrower), Amount: req.Amount, TermDays: req.TermDays, CollateralFXRP: req.CollateralFXRP, LenderAPRBPS: lenderAPR, BorrowerAPRBPS: lenderAPR + 50, MaxAPRBPS: req.MaxAPRBPS, Tranches: tranches, ExpiresAt: req.ExpiresAt, PriceE6: s.Price.XRPUSDE6}, nil
}

func (e *Engine) AcceptQuote(q Quote, loanID string, expectedNonce uint64, observedPrice *Price) error {
	return e.mutate("BORROW_ACCEPT", q.RequestID, func(s *State) error {
		if s.Processed[q.RequestID] {
			return ErrDuplicate
		}
		if observedPrice != nil {
			now := e.clock().Unix()
			if observedPrice.XRPUSDE6 == 0 || observedPrice.UpdatedAt > now || now-observedPrice.UpdatedAt > 300 {
				return errors.New("invalid or stale FTSO observation")
			}
			s.Price = *observedPrice
		}
		fresh, err := quote(s, QuoteRequest{ID: q.RequestID, Borrower: q.Borrower, Amount: q.Amount, TermDays: q.TermDays, MaxAPRBPS: q.MaxAPRBPS, CollateralFXRP: q.CollateralFXRP, ExpiresAt: q.ExpiresAt}, e.clock())
		if err != nil || !sameTranches(fresh.Tranches, q.Tranches) {
			return ErrLiquidityChanged
		}
		a := account(s, q.Borrower)
		if err := consumeNonce(a, expectedNonce); err != nil {
			return err
		}
		if a.LoanID != "" {
			return errors.New("one active loan per account")
		}
		fxrp := a.Balances[AssetFXRP]
		if fxrp.Available < q.CollateralFXRP {
			return ErrInsufficientBalance
		}
		fxrp.Available -= q.CollateralFXRP
		fxrp.Reserved += q.CollateralFXRP
		a.Balances[AssetFXRP] = fxrp
		for _, t := range q.Tranches {
			m := s.Mandates[t.MandateID]
			if m == nil || m.Available < t.Principal {
				return ErrLiquidityChanged
			}
			m.Available -= t.Principal
			m.AllocatedPrincipal += t.Principal
		}
		now := nowUnix(e.clock())
		loan := &Loan{ID: loanID, Borrower: a.Owner, Principal: q.Amount, CollateralFXRP: q.CollateralFXRP, BorrowerAPRBPS: q.BorrowerAPRBPS, TermDays: q.TermDays, StartedAt: now, LastAccruedAt: now, MaturesAt: now + int64(q.TermDays)*86400, Tranches: q.Tranches, Status: "healthy"}
		updateRisk(loan, s.Price.XRPUSDE6, now)
		s.Loans[loanID] = loan
		a.LoanID = loanID
		s.ActiveDebt += q.Amount
		s.Processed[q.RequestID] = true
		return nil
	})
}

func sameTranches(a, b []Tranche) bool {
	aa, _ := json.Marshal(a)
	bb, _ := json.Marshal(b)
	return string(aa) == string(bb)
}

func (e *Engine) RiskTick(price Price, operationID string) error {
	now := e.clock().Unix()
	if price.XRPUSDE6 == 0 || price.UpdatedAt > now || now-price.UpdatedAt > 300 {
		return errors.New("invalid or stale FTSO observation")
	}
	return e.mutate("RISK_TICK", operationID, func(s *State) error {
		if s.Processed[operationID] {
			return ErrDuplicate
		}
		s.Price = price
		for _, l := range s.Loans {
			if l.Status != "closed" && l.Status != "liquidated" {
				accrue(l, e.clock().Unix())
				updateRisk(l, price.XRPUSDE6, e.clock().Unix())
				if l.Status == "liquidatable" && s.BackstopUSDT0 >= debt(l) {
					if err := liquidateInState(s, l); err != nil {
						return err
					}
				}
			}
		}
		s.Processed[operationID] = true
		return nil
	})
}

func accrue(l *Loan, now int64) uint64 {
	if now <= l.LastAccruedAt {
		return l.AccruedInterestRay
	}
	elapsed := uint64(now - l.LastAccruedAt)
	apr := uint64(l.BorrowerAPRBPS)
	if now > l.MaturesAt+86400 {
		apr += 300
	}
	l.AccruedInterestRay += l.Principal * apr * elapsed * Scale / (BPS * Year)
	l.LastAccruedAt = now
	return l.AccruedInterestRay
}

func debt(l *Loan) uint64 { return l.Principal + l.AccruedInterestRay/Scale }

func updateRisk(l *Loan, price uint64, now int64) {
	value := l.CollateralFXRP * price / Scale
	d := debt(l)
	if value == 0 {
		l.Status = "liquidatable"
		return
	}
	ltv := d * BPS / value
	l.LastHealthFactorBPS = 6500 * BPS / ltv
	l.LiquidationPriceE6 = d * BPS * Scale / (l.CollateralFXRP * 6500)
	switch {
	case now > l.MaturesAt+86400 || ltv >= 6500:
		l.Status = "liquidatable"
	case ltv >= 5500:
		l.Status = "warning"
	case ltv >= 5000:
		l.Status = "restricted"
	default:
		l.Status = "healthy"
	}
}

func (e *Engine) Repay(owner string, amount uint64, operationID string, expectedNonce uint64) error {
	return e.mutate("APPLY_REPAYMENT", operationID, func(s *State) error {
		if s.Processed[operationID] {
			return ErrDuplicate
		}
		a := account(s, owner)
		if err := consumeNonce(a, expectedNonce); err != nil {
			return err
		}
		l := s.Loans[a.LoanID]
		if l == nil {
			return errors.New("no active loan")
		}
		accrue(l, e.clock().Unix())
		due := debt(l)
		if amount < due {
			return errors.New("hackathon repayment must close the loan")
		}
		bal := a.Balances[AssetUSDT0]
		if bal.Available < due {
			return ErrInsufficientBalance
		}
		bal.Available -= due
		a.Balances[AssetUSDT0] = bal
		interest := due - l.Principal
		var principalReturned uint64
		var interestDistributed uint64
		for _, t := range l.Tranches {
			lender := account(s, t.Lender)
			lb := lender.Balances[AssetUSDT0]
			share := interest * t.Principal / l.Principal
			lenderInterest := share * uint64(t.APRBPS) / uint64(l.BorrowerAPRBPS)
			lb.Reserved -= t.Principal
			lb.Available += t.Principal + lenderInterest
			lender.Balances[AssetUSDT0] = lb
			m := s.Mandates[t.MandateID]
			m.AllocatedPrincipal -= t.Principal
			m.InterestEarned += lenderInterest
			if m.Available == 0 && m.AllocatedPrincipal == 0 {
				m.Active = false
			}
			principalReturned += t.Principal
			interestDistributed += share
			s.ProtocolReserve += share - lenderInterest
		}
		if principalReturned != l.Principal {
			return errors.New("tranche conservation failure")
		}
		if interestDistributed < interest {
			s.ProtocolReserve += interest - interestDistributed
		}
		fxrp := a.Balances[AssetFXRP]
		fxrp.Reserved -= l.CollateralFXRP
		fxrp.Available += l.CollateralFXRP
		a.Balances[AssetFXRP] = fxrp
		s.ActiveDebt -= l.Principal
		l.Status = "closed"
		a.LoanID = ""
		s.Processed[operationID] = true
		return nil
	})
}

func (e *Engine) Liquidate(loanID, operationID string) error {
	return e.mutate("LIQUIDATE", operationID, func(s *State) error {
		if s.Processed[operationID] {
			return ErrDuplicate
		}
		l := s.Loans[loanID]
		if l == nil || l.Status != "liquidatable" {
			return errors.New("loan is not liquidatable")
		}
		if err := liquidateInState(s, l); err != nil {
			return err
		}
		s.Processed[operationID] = true
		return nil
	})
}

func (e *Engine) SeedBackstop(amount uint64, operationID string) error {
	if amount == 0 {
		return errors.New("invalid backstop deposit")
	}
	return e.mutate("BACKSTOP_DEPOSIT", operationID, func(s *State) error {
		if s.Processed[operationID] {
			return ErrDuplicate
		}
		if ^uint64(0)-s.BackstopUSDT0 < amount {
			return errors.New("backstop balance exceeds uint64")
		}
		s.BackstopUSDT0 += amount
		s.Processed[operationID] = true
		return nil
	})
}

func liquidateInState(s *State, l *Loan) error {
	due := debt(l)
	if s.BackstopUSDT0 < due {
		return errors.New("backstop insufficient")
	}
	seize := due * Scale * BPS / (s.Price.XRPUSDE6 * 9500)
	if seize > l.CollateralFXRP {
		seize = l.CollateralFXRP
	}
	s.BackstopUSDT0 -= due
	s.BackstopFXRP += seize
	borrower := account(s, l.Borrower)
	fxrp := borrower.Balances[AssetFXRP]
	fxrp.Reserved -= l.CollateralFXRP
	fxrp.Available += l.CollateralFXRP - seize
	borrower.Balances[AssetFXRP] = fxrp
	interest := due - l.Principal
	var principalReturned uint64
	var interestDistributed uint64
	for _, t := range l.Tranches {
		lender := account(s, t.Lender)
		lb := lender.Balances[AssetUSDT0]
		share := interest * t.Principal / l.Principal
		lenderInterest := share * uint64(t.APRBPS) / uint64(l.BorrowerAPRBPS)
		lb.Reserved -= t.Principal
		lb.Available += t.Principal + lenderInterest
		lender.Balances[AssetUSDT0] = lb
		m := s.Mandates[t.MandateID]
		m.AllocatedPrincipal -= t.Principal
		m.InterestEarned += lenderInterest
		if m.Available == 0 && m.AllocatedPrincipal == 0 {
			m.Active = false
		}
		principalReturned += t.Principal
		interestDistributed += share
		s.ProtocolReserve += share - lenderInterest
	}
	if principalReturned != l.Principal {
		return errors.New("tranche conservation failure")
	}
	if interestDistributed < interest {
		s.ProtocolReserve += interest - interestDistributed
	}
	s.ActiveDebt -= l.Principal
	borrower.LoanID = ""
	l.Status = "liquidated"
	return nil
}

func (e *Engine) ConfirmAnchor(sequence uint64, root string) error {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.state.PendingAnchor == nil {
		if e.state.Sequence == sequence && strings.EqualFold(e.state.Root, root) {
			return nil
		}
		return errors.New("no anchor is pending")
	}
	if e.state.PendingAnchor.NextSequence != sequence || !strings.EqualFold(e.state.PendingAnchor.NextRoot, root) {
		return errors.New("anchor confirmation does not match pending state")
	}
	next := *e.state
	next.PendingAnchor = nil
	if err := e.store.SaveState(&next); err != nil {
		return fmt.Errorf("persisting anchor confirmation: %w", err)
	}
	e.state = &next
	return nil
}

func (e *Engine) Withdraw(owner, asset string, amount uint64, operationID string, expectedNonce uint64) error {
	if amount == 0 || (asset != AssetFXRP && asset != AssetUSDT0) {
		return errors.New("invalid withdrawal")
	}
	return e.mutate("WITHDRAW_REQUEST", operationID, func(s *State) error {
		if s.Processed[operationID] {
			return ErrDuplicate
		}
		a := account(s, owner)
		if err := consumeNonce(a, expectedNonce); err != nil {
			return err
		}
		bal := a.Balances[asset]
		if bal.Available < amount {
			return ErrInsufficientBalance
		}
		bal.Available -= amount
		a.Balances[asset] = bal
		s.Processed[operationID] = true
		s.Activities = append(s.Activities, Activity{
			ID: operationID, Account: a.Owner, Kind: "withdrawal",
			Asset: asset, Amount: amount, CreatedAt: nowUnix(e.clock()),
		})
		return nil
	})
}
