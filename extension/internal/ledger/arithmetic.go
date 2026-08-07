package ledger

import (
	"errors"
	"math/big"
)

var errArithmeticOverflow = errors.New("confidential arithmetic exceeds uint64")

func checkedAdd(a, b uint64) (uint64, error) {
	if ^uint64(0)-a < b {
		return 0, errArithmeticOverflow
	}
	return a + b, nil
}

func checkedSub(a, b uint64) (uint64, error) {
	if a < b {
		return 0, errors.New("confidential arithmetic underflow")
	}
	return a - b, nil
}

func mulDiv(values []uint64, denominator uint64, roundUp bool) (uint64, error) {
	return mulDivBy(values, []uint64{denominator}, roundUp)
}

func mulDivBy(values, denominators []uint64, roundUp bool) (uint64, error) {
	product := new(big.Int).SetUint64(1)
	for _, value := range values {
		product.Mul(product, new(big.Int).SetUint64(value))
	}
	divisor := new(big.Int).SetUint64(1)
	for _, denominator := range denominators {
		if denominator == 0 {
			return 0, errors.New("division by zero")
		}
		divisor.Mul(divisor, new(big.Int).SetUint64(denominator))
	}
	quotient, remainder := new(big.Int), new(big.Int)
	quotient.QuoRem(product, divisor, remainder)
	if roundUp && remainder.Sign() != 0 {
		quotient.Add(quotient, big.NewInt(1))
	}
	if !quotient.IsUint64() {
		return 0, errArithmeticOverflow
	}
	return quotient.Uint64(), nil
}

func weightedAverage(tranches []Tranche, total uint64) (uint32, error) {
	if total == 0 {
		return 0, errors.New("cannot average zero principal")
	}
	weighted := new(big.Int)
	for _, tranche := range tranches {
		term := new(big.Int).Mul(
			new(big.Int).SetUint64(tranche.Principal),
			new(big.Int).SetUint64(uint64(tranche.APRBPS)),
		)
		weighted.Add(weighted, term)
	}
	weighted.Div(weighted, new(big.Int).SetUint64(total))
	if !weighted.IsUint64() || weighted.Uint64() > uint64(^uint32(0)) {
		return 0, errArithmeticOverflow
	}
	return uint32(weighted.Uint64()), nil
}
