package config

import (
	"encoding/hex"
	"errors"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum/common"
)

const (
	Version           = "0.1.0"
	OPTypeCredit      = "CREDIT"
	OPDeposit         = "DEPOSIT"
	OPBorrowAccept    = "BORROW_ACCEPT"
	OPWithdrawRequest = "WITHDRAW_REQUEST"
	OPRiskTick        = "RISK_TICK"
	OPBackstopDeposit = "BACKSTOP_DEPOSIT"
	OPOpenAccount     = "OPEN_ACCOUNT"
	OPSetMandate      = "SET_MANDATE"
	OPCancelMandate   = "CANCEL_MANDATE"
	OPQuoteRequest    = "QUOTE_REQUEST"
	OPApplyRepayment  = "APPLY_REPAYMENT"
	OPAccountQuery    = "ACCOUNT_QUERY"
	OPStressQuery     = "STRESS_QUERY"
	OPAnchorConfirmed = "ANCHOR_CONFIRMED"
)

type Config struct {
	ExtensionPort int
	SignPort      int
	StatePath     string
	StateKey      []byte
	ChainID       uint64
	Vault         common.Address
	FXRP          common.Address
	USDT0         common.Address
	ExtensionID   uint64
	ChainURL      string
}

func ValidateProductionEnvironment(cfg Config) error {
	if cfg.ChainID != 114 {
		return errors.New("FCC workload must use Coston2 chain ID 114")
	}
	mode := os.Getenv("MODE")
	simulated := strings.EqualFold(os.Getenv("SIMULATED_TEE"), "true")
	if (mode == "1") != simulated {
		return errors.New("MODE=1 requires SIMULATED_TEE=true and MODE=0 requires SIMULATED_TEE=false")
	}
	if mode != "0" && mode != "1" {
		return errors.New("MODE must be 0 for real attestation or 1 for simulated judging")
	}
	if os.Getenv("PROXY_URL") == "" {
		return errors.New("PROXY_URL is required")
	}
	if os.Getenv("INITIAL_OWNER") == "" {
		return errors.New("INITIAL_OWNER is required")
	}
	if os.Getenv("GOVERNANCE_SIGNERS") == "" {
		return errors.New("GOVERNANCE_SIGNERS is required")
	}
	threshold, err := strconv.ParseUint(os.Getenv("GOVERNANCE_THRESHOLD"), 10, 64)
	if err != nil || threshold == 0 {
		return errors.New("GOVERNANCE_THRESHOLD must be a positive integer")
	}
	return nil
}

func Load() (Config, error) {
	cfg := Config{
		ExtensionPort: intEnv("EXTENSION_PORT", 7702),
		SignPort:      intEnv("SIGN_PORT", 7701),
		StatePath:     stringEnv("STATE_PATH", "data/quietline.bolt"),
		ChainID:       uint64Env("CHAIN_ID", 114),
		ChainURL:      os.Getenv("CHAIN_URL"),
	}
	var err error
	if cfg.ExtensionID, err = requiredUint64Env("EXTENSION_ID"); err != nil {
		return Config{}, err
	}
	if cfg.ChainURL == "" {
		return Config{}, errors.New("CHAIN_URL is required")
	}
	if cfg.StateKey, err = stateKey(); err != nil {
		return Config{}, err
	}
	cfg.Vault, err = addressEnv("QUIET_VAULT")
	if err != nil {
		return Config{}, err
	}
	cfg.FXRP, err = addressEnv("FXRP_ADDRESS")
	if err != nil {
		return Config{}, err
	}
	cfg.USDT0, err = addressEnv("USDT0_ADDRESS")
	if err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func intEnv(name string, fallback int) int {
	v, err := strconv.Atoi(os.Getenv(name))
	if err == nil {
		return v
	}
	return fallback
}
func uint64Env(name string, fallback uint64) uint64 {
	v, err := strconv.ParseUint(os.Getenv(name), 10, 64)
	if err == nil {
		return v
	}
	return fallback
}
func requiredUint64Env(name string) (uint64, error) {
	v, err := strconv.ParseUint(os.Getenv(name), 10, 64)
	if err != nil || v < 65_536 {
		return 0, errors.New(name + " must be a registered public extension ID")
	}
	return v, nil
}
func stringEnv(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}
func addressEnv(name string) (common.Address, error) {
	v := os.Getenv(name)
	if !common.IsHexAddress(v) {
		return common.Address{}, errors.New(name + " must be a valid address")
	}
	return common.HexToAddress(v), nil
}
func stateKey() ([]byte, error) {
	raw := strings.TrimPrefix(os.Getenv("STATE_ENCRYPTION_KEY"), "0x")
	if raw == "" {
		return nil, errors.New("STATE_ENCRYPTION_KEY is required")
	}
	key, err := hex.DecodeString(raw)
	if err != nil || len(key) != 32 {
		return nil, errors.New("STATE_ENCRYPTION_KEY must be 32-byte hex")
	}
	return key, nil
}

var ShutdownTimeout = 5 * time.Second
