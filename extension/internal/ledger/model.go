package ledger

import "time"

const (
	AssetFXRP  = "FXRP"
	AssetUSDT0 = "USDT0"
	Scale      = uint64(1_000_000)
	BPS        = uint64(10_000)
	Year       = uint64(365 * 24 * 60 * 60)
)

type Balance struct {
	Available uint64 `json:"available"`
	Reserved  uint64 `json:"reserved"`
}

type Account struct {
	Owner    string             `json:"owner"`
	Nonce    uint64             `json:"nonce"`
	Balances map[string]Balance `json:"balances"`
	LoanID   string             `json:"loanId,omitempty"`
}

type Mandate struct {
	ID                 string `json:"id"`
	Lender             string `json:"lender"`
	Available          uint64 `json:"available"`
	MinAPRBPS          uint32 `json:"minAprBps"`
	TermMask           uint8  `json:"termMask"`
	PerBorrowerCap     uint64 `json:"perBorrowerCap"`
	Active             bool   `json:"active"`
	CreatedAt          int64  `json:"createdAt"`
	AllocatedPrincipal uint64 `json:"allocatedPrincipal"`
	InterestEarned     uint64 `json:"interestEarned"`
}

type Tranche struct {
	MandateID string `json:"mandateId"`
	Lender    string `json:"lender"`
	Principal uint64 `json:"principal"`
	APRBPS    uint32 `json:"aprBps"`
}

type Loan struct {
	ID                  string    `json:"id"`
	Borrower            string    `json:"borrower"`
	Principal           uint64    `json:"principal"`
	InterestPaid        uint64    `json:"interestPaid"`
	CollateralFXRP      uint64    `json:"collateralFxrp"`
	BorrowerAPRBPS      uint32    `json:"borrowerAprBps"`
	TermDays            uint16    `json:"termDays"`
	StartedAt           int64     `json:"startedAt"`
	MaturesAt           int64     `json:"maturesAt"`
	LastAccruedAt       int64     `json:"lastAccruedAt"`
	AccruedInterestRay  uint64    `json:"accruedInterestRay"`
	Tranches            []Tranche `json:"tranches"`
	Status              string    `json:"status"`
	LastHealthFactorBPS uint64    `json:"lastHealthFactorBps"`
	LiquidationPriceE6  uint64    `json:"liquidationPriceE6"`
}

type QuoteRequest struct {
	ID             string `json:"id"`
	Borrower       string `json:"borrower"`
	Amount         uint64 `json:"amount"`
	TermDays       uint16 `json:"termDays"`
	MaxAPRBPS      uint32 `json:"maxAprBps"`
	CollateralFXRP uint64 `json:"collateralFxrp"`
	ExpiresAt      int64  `json:"expiresAt"`
}

type Quote struct {
	RequestID      string    `json:"requestId"`
	Borrower       string    `json:"borrower"`
	Amount         uint64    `json:"amount"`
	TermDays       uint16    `json:"termDays"`
	CollateralFXRP uint64    `json:"collateralFxrp"`
	LenderAPRBPS   uint32    `json:"lenderAprBps"`
	BorrowerAPRBPS uint32    `json:"borrowerAprBps"`
	MaxAPRBPS      uint32    `json:"maxAprBps"`
	Tranches       []Tranche `json:"tranches"`
	ExpiresAt      int64     `json:"expiresAt"`
	PriceE6        uint64    `json:"priceE6"`
}

type Price struct {
	XRPUSDE6  uint64 `json:"xrpUsdE6"`
	UpdatedAt int64  `json:"updatedAt"`
}

type Activity struct {
	ID        string `json:"id"`
	Account   string `json:"account"`
	Kind      string `json:"kind"`
	Amount    uint64 `json:"amount,omitempty"`
	Asset     string `json:"asset,omitempty"`
	CreatedAt int64  `json:"createdAt"`
}

type PendingAnchor struct {
	Kind             string `json:"kind"`
	OperationID      string `json:"operationId"`
	PreviousSequence uint64 `json:"previousSequence"`
	NextSequence     uint64 `json:"nextSequence"`
	PreviousRoot     string `json:"previousRoot"`
	NextRoot         string `json:"nextRoot"`
}

type State struct {
	Version         uint8               `json:"version"`
	Sequence        uint64              `json:"sequence"`
	Root            string              `json:"root"`
	Accounts        map[string]*Account `json:"accounts"`
	Mandates        map[string]*Mandate `json:"mandates"`
	Loans           map[string]*Loan    `json:"loans"`
	Processed       map[string]bool     `json:"processed"`
	Activities      []Activity          `json:"activities"`
	Price           Price               `json:"price"`
	ActiveDebt      uint64              `json:"activeDebt"`
	ProtocolReserve uint64              `json:"protocolReserve"`
	BackstopUSDT0   uint64              `json:"backstopUsdt0"`
	BackstopFXRP    uint64              `json:"backstopFxrp"`
	PendingAnchor   *PendingAnchor      `json:"pendingAnchor,omitempty"`
}

func NewState() *State {
	return &State{Version: 1, Accounts: map[string]*Account{}, Mandates: map[string]*Mandate{}, Loans: map[string]*Loan{}, Processed: map[string]bool{}, Activities: []Activity{}}
}

func termBit(days uint16) uint8 {
	switch days {
	case 7:
		return 1
	case 14:
		return 2
	case 30:
		return 4
	default:
		return 0
	}
}

func nowUnix(t time.Time) int64 { return t.UTC().Unix() }
