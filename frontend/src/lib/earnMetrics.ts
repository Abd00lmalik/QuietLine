import type { PrivateMandate } from "./privateTypes";

// FCC mandate fields arrive in base units (1 USD₮0 = 1_000_000 base units)
// while the store's account balances are pre-scaled to USD₮0. This helper is
// the single place that converts mandate liquidity into USD₮0 for the Earn
// page, so the UI can never mix raw base units with scaled balances again.
export const USDT0_SCALE = 1_000_000;

export type EarnMetrics = {
  totalSupplied: number;
  availableToLend: number;
  committedToLoans: number;
  withdrawable: number;
  weightedAprPercent: number | null;
};

export function earnMetrics(
  mandates: PrivateMandate[],
  privateUsdt0: number,
): EarnMetrics {
  const totalBase = mandates.reduce(
    (total, mandate) => total + mandate.available + mandate.allocatedPrincipal,
    0,
  );
  const availableBase = mandates.reduce(
    (total, mandate) => total + mandate.available,
    0,
  );
  const committedBase = mandates.reduce(
    (total, mandate) => total + mandate.allocatedPrincipal,
    0,
  );
  const active = mandates.filter((mandate) => mandate.active);
  const weightedAmount = active.reduce(
    (total, mandate) => total + mandate.available + mandate.allocatedPrincipal,
    0,
  );
  const weightedAprBase = active.reduce(
    (total, mandate) =>
      total + mandate.minAprBps * (mandate.available + mandate.allocatedPrincipal),
    0,
  );
  return {
    totalSupplied: totalBase / USDT0_SCALE,
    availableToLend: availableBase / USDT0_SCALE,
    committedToLoans: committedBase / USDT0_SCALE,
    // privateUsdt0 is already scaled (USD₮0); availableToLend is converted above.
    withdrawable: privateUsdt0 + availableBase / USDT0_SCALE,
    weightedAprPercent:
      weightedAmount > 0 ? weightedAprBase / weightedAmount / 100 : null,
  };
}
