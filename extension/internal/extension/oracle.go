package extension

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/quietline/quietline/extension/internal/ledger"
)

var quietVaultOracleABI = mustABI(`[{
	"inputs": [],
	"name": "currentXrpUsdPrice",
	"outputs": [
		{"internalType": "uint64", "name": "priceE6", "type": "uint64"},
		{"internalType": "uint64", "name": "priceTimestamp", "type": "uint64"}
	],
	"stateMutability": "view",
	"type": "function"
}]`)

func (e *Extension) currentXrpUsdPrice() (ledger.Price, error) {
	data, err := quietVaultOracleABI.Pack("currentXrpUsdPrice")
	if err != nil {
		return ledger.Price{}, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	output, err := e.chain.CallContract(ctx, ethereum.CallMsg{
		To:   &e.cfg.Vault,
		Data: data,
	}, nil)
	if err != nil {
		return ledger.Price{}, fmt.Errorf("reading FTSOv2 through QuietVault: %w", err)
	}
	values, err := quietVaultOracleABI.Unpack("currentXrpUsdPrice", output)
	if err != nil || len(values) != 2 {
		return ledger.Price{}, fmt.Errorf("decoding QuietVault price: %w", err)
	}
	price, okPrice := values[0].(uint64)
	updatedAt, okTimestamp := values[1].(uint64)
	if !okPrice || !okTimestamp {
		return ledger.Price{}, fmt.Errorf("QuietVault returned unexpected price types")
	}
	return ledger.Price{XRPUSDE6: price, UpdatedAt: int64(updatedAt)}, nil
}

func mustABI(value string) abi.ABI {
	parsed, err := abi.JSON(strings.NewReader(value))
	if err != nil {
		panic(err)
	}
	return parsed
}
