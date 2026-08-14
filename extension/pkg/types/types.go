package types

import (
	"encoding/json"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/quietline/quietline/extension/internal/ledger"
)

type SignedAction struct {
	Sender            common.Address  `json:"sender"`
	Nonce             uint64          `json:"nonce"`
	Deadline          uint64          `json:"deadline"`
	Action            string          `json:"action"`
	Payload           json.RawMessage `json:"payload"`
	ResponsePublicKey hexutil.Bytes   `json:"responsePublicKey"`
	Signature         hexutil.Bytes   `json:"signature"`
}

type OpenAccountPayload struct {
	OperationID string `json:"operationId"`
}
type SetMandatePayload struct {
	MandateID      string `json:"mandateId"`
	Amount         uint64 `json:"amount"`
	MinAPRBPS      uint32 `json:"minAprBps"`
	TermMask       uint8  `json:"termMask"`
	PerBorrowerCap uint64 `json:"perBorrowerCap"`
}
type CancelMandatePayload struct {
	MandateID string `json:"mandateId"`
}
type WithdrawFromMandatePayload struct {
	MandateID   string         `json:"mandateId"`
	Amount      uint64         `json:"amount"`
	Destination common.Address `json:"destination"`
}
type QuotePayload = ledger.QuoteRequest
type BorrowAcceptPayload struct {
	Quote  ledger.Quote `json:"quote"`
	LoanID string       `json:"loanId"`
}
type RepaymentPayload struct {
	Amount      uint64 `json:"amount"`
	OperationID string `json:"operationId"`
}
type AccountQueryPayload struct{}
type StressQueryPayload struct {
	XRPUSDE6 uint64 `json:"xrpUsdE6"`
}
type AnchorConfirmedPayload struct {
	Sequence uint64 `json:"sequence"`
	Root     string `json:"root"`
}
type RecoverDepositPayload struct {
	DepositID common.Hash    `json:"depositId"`
	Account   common.Address `json:"account"`
	Token     common.Address `json:"token"`
	Amount    uint64         `json:"amount,string"`
}

type Settlement struct {
	ProtocolVersion  uint8          `json:"protocolVersion"`
	SettlementType   uint8          `json:"settlementType"`
	Account          common.Address `json:"account"`
	Token            common.Address `json:"token"`
	Amount           uint64         `json:"amount"`
	Destination      common.Address `json:"destination"`
	RequestID        common.Hash    `json:"requestId"`
	SettlementID     common.Hash    `json:"settlementId"`
	PreviousSequence uint64         `json:"previousSequence"`
	NextSequence     uint64         `json:"nextSequence"`
	PreviousRoot     common.Hash    `json:"previousRoot"`
	NextRoot         common.Hash    `json:"nextRoot"`
	Deadline         uint64         `json:"deadline"`
}

type SettlementResponse struct {
	Settlement Settlement    `json:"settlement"`
	Signature  hexutil.Bytes `json:"signature"`
}
type MutationResponse struct {
	Anchor SettlementResponse `json:"anchor"`
	Result any                `json:"result,omitempty"`
}
type SecureResponse struct {
	Anchor     *SettlementResponse `json:"anchor,omitempty"`
	Ciphertext hexutil.Bytes       `json:"ciphertext"`
}
type PrivateAccountView struct {
	Account    *ledger.Account   `json:"account"`
	Loan       *ledger.Loan      `json:"loan,omitempty"`
	Mandates   []*ledger.Mandate `json:"mandates"`
	Activities []ledger.Activity `json:"activities"`
	Price      ledger.Price      `json:"price"`
}
type StressView struct {
	XRPUSDE6        uint64 `json:"xrpUsdE6"`
	Debt            uint64 `json:"debt"`
	CollateralValue uint64 `json:"collateralValue"`
	LTVBPS          uint64 `json:"ltvBps"`
	HealthFactorBPS uint64 `json:"healthFactorBps"`
	Status          string `json:"status"`
}
type StateView struct {
	Version        uint8                 `json:"version"`
	Sequence       uint64                `json:"sequence"`
	Root           string                `json:"root"`
	PendingAnchor  *ledger.PendingAnchor `json:"pendingAnchor,omitempty"`
	Accounts       int                   `json:"accounts"`
	Mandates       int                   `json:"mandates"`
	Loans          int                   `json:"loans"`
	ActiveDebt     uint64                `json:"activeDebt"`
	PriceUpdatedAt int64                 `json:"priceUpdatedAt"`
}
