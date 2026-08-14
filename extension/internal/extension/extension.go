package extension

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/ethclient"
	"github.com/flare-foundation/go-flare-common/pkg/tee/instruction"
	"github.com/flare-foundation/tee-node/pkg/processorutils"
	teetypes "github.com/flare-foundation/tee-node/pkg/types"
	teeutils "github.com/flare-foundation/tee-node/pkg/utils"
	"github.com/quietline/quietline/extension/internal/config"
	"github.com/quietline/quietline/extension/internal/ledger"
	quiettypes "github.com/quietline/quietline/extension/pkg/types"
)

type Extension struct {
	Server     *http.Server
	cfg        config.Config
	store      *ledger.Store
	engine     *ledger.Engine
	httpClient *http.Client
	chain      *ethclient.Client
	clock      func() time.Time
	// price serves the QUOTE hot path from a background-refreshed cache so /action
	// answers inside tee-node's 2s ProxyTimeout instead of blocking on a live
	// Coston2 read. nil in unit tests that build Extension directly; currentXrpUsdPrice
	// falls back to a live read whenever it is nil or not yet primed.
	price     *priceCache
	priceStop chan struct{}
	priceDone chan struct{}
	// liquidity serves the WITHDRAW_REQUEST pre-check from a background-refreshed
	// cache of the vault's token balances. Unlike price there is deliberately no
	// live-read fallback: an unknown or stale balance fails the withdrawal closed
	// rather than putting a Coston2 round-trip on the /action hot path.
	liquidity     *vaultLiquidityCache
	liquidityStop chan struct{}
	liquidityDone chan struct{}
}

func New(cfg config.Config) (*Extension, error) {
	store, err := ledger.OpenStore(cfg.StatePath, cfg.StateKey)
	if err != nil {
		return nil, err
	}
	engine, err := ledger.NewEngine(store)
	if err != nil {
		_ = store.Close()
		return nil, err
	}
	chain, err := ethclient.Dial(cfg.ChainURL)
	if err != nil {
		_ = store.Close()
		return nil, fmt.Errorf("dialing chain: %w", err)
	}
	e := &Extension{cfg: cfg, store: store, engine: engine, chain: chain, httpClient: &http.Client{Timeout: 15 * time.Second}, clock: time.Now}
	e.price = &priceCache{}
	e.priceStop = make(chan struct{})
	e.priceDone = make(chan struct{})
	go e.startPriceRefresher(e.priceStop, e.priceDone)
	e.liquidity = &vaultLiquidityCache{values: map[common.Address]vaultLiquidityValue{}}
	e.liquidityStop = make(chan struct{})
	e.liquidityDone = make(chan struct{})
	go e.startVaultLiquidityRefresher(e.liquidityStop, e.liquidityDone)
	mux := http.NewServeMux()
	mux.HandleFunc("POST /action", e.actionHandler)
	mux.HandleFunc("GET /state", e.stateHandler)
	mux.HandleFunc("GET /health", e.healthHandler)
	e.Server = &http.Server{Addr: fmt.Sprintf(":%d", cfg.ExtensionPort), Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	return e, nil
}

func (e *Extension) Close() error {
	// Stop the price refresher before tearing down the chain client so it never
	// reads through a closed connection. Bounded by ShutdownTimeout so an in-flight
	// RPC can never hold shutdown open indefinitely.
	if e.priceStop != nil {
		close(e.priceStop)
		select {
		case <-e.priceDone:
		case <-time.After(config.ShutdownTimeout):
		}
	}
	// Stop the liquidity refresher the same way so it never reads through a closed
	// chain connection.
	if e.liquidityStop != nil {
		close(e.liquidityStop)
		select {
		case <-e.liquidityDone:
		case <-time.After(config.ShutdownTimeout):
		}
	}
	e.chain.Close()
	return e.store.Close()
}

func (e *Extension) healthHandler(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"status": "ok", "version": config.Version, "anchorPending": e.engine.State().PendingAnchor != nil})
}

func (e *Extension) stateHandler(w http.ResponseWriter, _ *http.Request) {
	state := e.engine.State()
	view := quiettypes.StateView{Version: state.Version, Sequence: state.Sequence, Root: state.Root, PendingAnchor: state.PendingAnchor, Accounts: len(state.Accounts), Mandates: len(state.Mandates), Loans: len(state.Loans), ActiveDebt: state.ActiveDebt, PriceUpdatedAt: state.Price.UpdatedAt}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"stateVersion": teeutils.ToHash(config.Version), "state": view})
}

func (e *Extension) actionHandler(w http.ResponseWriter, r *http.Request) {
	var action teetypes.Action
	if err := json.NewDecoder(r.Body).Decode(&action); err != nil {
		http.Error(w, "decoding action: "+err.Error(), http.StatusBadRequest)
		return
	}
	status, body := e.processAction(action)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func (e *Extension) processAction(action teetypes.Action) (int, []byte) {
	switch action.Data.Type {
	case teetypes.Instruction:
		return e.processInstruction(action)
	case teetypes.Direct:
		return e.processDirect(action)
	default:
		return http.StatusBadRequest, []byte("unsupported action type")
	}
}

func (e *Extension) processInstruction(action teetypes.Action) (int, []byte) {
	df, err := processorutils.Parse[instruction.DataFixed](action.Data.Message)
	if err != nil {
		return http.StatusBadRequest, []byte("decoding fixed data: " + err.Error())
	}
	if df.OPType != teeutils.ToHash(config.OPTypeCredit) {
		return http.StatusNotImplemented, []byte("unsupported op type")
	}
	var result teetypes.ActionResult
	switch df.OPCommand {
	case teeutils.ToHash(config.OPDeposit):
		result = e.handleDeposit(action, df)
	case teeutils.ToHash(config.OPBorrowAccept):
		result = e.handleBorrowAccept(action, df)
	case teeutils.ToHash(config.OPWithdrawRequest):
		result = e.handleWithdrawal(action, df)
	case teeutils.ToHash(config.OPRiskTick):
		result = e.handleRiskTick(action, df)
	case teeutils.ToHash(config.OPBackstopDeposit):
		result = e.handleBackstopDeposit(action, df)
	default:
		return http.StatusNotImplemented, []byte("unsupported instruction op command")
	}
	body, _ := json.Marshal(result)
	return http.StatusOK, body
}

func (e *Extension) processDirect(action teetypes.Action) (int, []byte) {
	di, err := processorutils.Parse[teetypes.DirectInstruction](action.Data.Message)
	if err != nil {
		return http.StatusBadRequest, []byte("decoding direct instruction: " + err.Error())
	}
	if di.OPType != teeutils.ToHash(config.OPTypeCredit) {
		return http.StatusNotImplemented, []byte("unsupported op type")
	}
	df := &instruction.DataFixed{InstructionID: action.Data.ID, OPType: di.OPType, OPCommand: di.OPCommand}
	if di.OPCommand == teeutils.ToHash(config.OPAnchorConfirmed) {
		return e.handleAnchorConfirmation(action, df, di.Message)
	}
	if di.OPCommand == teeutils.ToHash(config.OPRecoverAnchor) {
		return e.handleAnchorRecovery(action, df)
	}
	if di.OPCommand == teeutils.ToHash(config.OPRecoverDeposit) {
		return e.handleDepositRecovery(action, df, di.Message)
	}
	plain, err := e.decrypt(di.Message)
	if err != nil {
		return resultJSON(action, df, nil, fmt.Errorf("decrypting direct action: %w", err))
	}
	var req quiettypes.SignedAction
	if err := json.Unmarshal(plain, &req); err != nil {
		return resultJSON(action, df, nil, err)
	}
	if err := e.verifySignedAction(req, hashString(di.OPCommand)); err != nil {
		return resultJSON(action, df, nil, err)
	}
	return e.handleSignedDirect(action, df, req)
}

func buildResult(a teetypes.Action, df *instruction.DataFixed, data []byte, err error) teetypes.ActionResult {
	status := uint8(1)
	log := "ok"
	if err != nil {
		status = 0
		log = "error: " + err.Error()
		data = nil
	}
	return teetypes.ActionResult{ID: a.Data.ID, SubmissionTag: a.Data.SubmissionTag, Status: status, Log: log, OPType: df.OPType, OPCommand: df.OPCommand, Version: config.Version, Data: data}
}

func resultJSON(a teetypes.Action, df *instruction.DataFixed, data []byte, err error) (int, []byte) {
	out, _ := json.Marshal(buildResult(a, df, data, err))
	return http.StatusOK, out
}

func hashString(hash common.Hash) string {
	raw := hash.Bytes()
	for len(raw) > 0 && raw[len(raw)-1] == 0 {
		raw = raw[:len(raw)-1]
	}
	return string(raw)
}
