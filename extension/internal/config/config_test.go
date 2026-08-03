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

func TestValidateProductionEnvironmentRejectsSimulation(t *testing.T) {
	validProductionEnv(t)
	t.Setenv("SIMULATED_TEE", "true")
	if err := ValidateProductionEnvironment(Config{ChainID: 114}); err == nil {
		t.Fatal("expected simulated TEE mode to be rejected")
	}
}

func TestValidateProductionEnvironmentRejectsNonProductionMode(t *testing.T) {
	validProductionEnv(t)
	t.Setenv("MODE", "1")
	if err := ValidateProductionEnvironment(Config{ChainID: 114}); err == nil {
		t.Fatal("expected non-production mode to be rejected")
	}
}
