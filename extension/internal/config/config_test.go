package config

import (
	"testing"

	"github.com/ethereum/go-ethereum/common"
)

func validProductionEnv(t *testing.T) {
	t.Helper()
	t.Setenv("MODE", "0")
	t.Setenv("SIMULATED_TEE", "false")
	t.Setenv("PROXY_URL", "http://tee-proxy:6663")
	t.Setenv("INITIAL_OWNER", "0x1111111111111111111111111111111111111111")
	t.Setenv("GOVERNANCE_SIGNERS", "0x1111111111111111111111111111111111111111")
	t.Setenv("GOVERNANCE_THRESHOLD", "1")
}

func TestValidateProductionEnvironment(t *testing.T) {
	validProductionEnv(t)
	cfg := Config{ChainID: 114, Vault: common.HexToAddress("0x1111111111111111111111111111111111111111")}
	if err := ValidateProductionEnvironment(cfg); err != nil {
		t.Fatal(err)
	}
}

func TestValidateProductionEnvironmentAcceptsExplicitSimulation(t *testing.T) {
	validProductionEnv(t)
	t.Setenv("MODE", "1")
	t.Setenv("SIMULATED_TEE", "true")
	if err := ValidateProductionEnvironment(Config{ChainID: 114}); err != nil {
		t.Fatal(err)
	}
}

func TestValidateProductionEnvironmentRejectsMismatchedMode(t *testing.T) {
	validProductionEnv(t)
	t.Setenv("MODE", "1")
	if err := ValidateProductionEnvironment(Config{ChainID: 114}); err == nil {
		t.Fatal("expected mismatched simulation flags to be rejected")
	}
}

func TestLoadAcceptsBytes32ExtensionID(t *testing.T) {
	t.Setenv("EXTENSION_ID", "0x0000000000000000000000000000000000000000000000000000000000010189")
	t.Setenv("CHAIN_URL", "https://coston2-api.flare.network/ext/C/rpc")
	t.Setenv("STATE_ENCRYPTION_KEY", "0000000000000000000000000000000000000000000000000000000000000000")
	t.Setenv("QUIET_VAULT", "0x1111111111111111111111111111111111111111")
	t.Setenv("FXRP_ADDRESS", "0x2222222222222222222222222222222222222222")
	t.Setenv("USDT0_ADDRESS", "0x3333333333333333333333333333333333333333")

	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.ExtensionID != 65929 {
		t.Fatalf("expected extension ID 65929, got %d", cfg.ExtensionID)
	}
}
