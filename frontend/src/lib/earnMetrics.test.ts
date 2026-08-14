import { describe, expect, it } from "vitest";
import { earnMetrics } from "./earnMetrics";
import type { PrivateMandate } from "./privateTypes";

const mandate = (overrides: Partial<PrivateMandate> = {}): PrivateMandate => ({
  id: "m1",
  lender: "0x0000000000000000000000000000000000000001",
  available: 7_000_000,
  minAprBps: 750,
  termMask: 7,
  perBorrowerCap: 10_000_000,
  active: true,
  createdAt: 1,
  allocatedPrincipal: 0,
  interestEarned: 0,
  ...overrides,
});

describe("earnMetrics", () => {
  it("displays mandate liquidity in USD₮0, not raw base units", () => {
    const metrics = earnMetrics([mandate({ available: 7_000_000 })], 0);
    expect(metrics.totalSupplied).toBe(7);
    expect(metrics.availableToLend).toBe(7);
    expect(metrics.committedToLoans).toBe(0);
  });

  it("never mixes raw base units with the scaled private balance", () => {
    // The historical bug produced 7_000_001 when it should have been 8:
    // privateUsdt0 (scaled, 1) was added to availableToLend (raw, 7_000_000).
    const metrics = earnMetrics([mandate({ available: 7_000_000 })], 1);
    expect(metrics.withdrawable).toBe(8);
  });

  it("separates committed principal from available liquidity", () => {
    const metrics = earnMetrics(
      [mandate({ available: 6_000_000, allocatedPrincipal: 4_000_000 })],
      1,
    );
    expect(metrics.availableToLend).toBe(6);
    expect(metrics.committedToLoans).toBe(4);
    expect(metrics.totalSupplied).toBe(10);
    // Committed principal (4) is NOT withdrawable; only private + unallocated.
    expect(metrics.withdrawable).toBe(7);
  });

  it("includes cancelled mandates in supplied but excludes them from APR weighting", () => {
    const metrics = earnMetrics(
      [
        mandate({
          id: "active",
          available: 7_000_000,
          allocatedPrincipal: 3_000_000,
          minAprBps: 800,
          active: true,
        }),
        mandate({
          id: "cancelled",
          available: 0,
          allocatedPrincipal: 2_000_000,
          minAprBps: 900,
          active: false,
        }),
      ],
      0,
    );
    expect(metrics.totalSupplied).toBe(12);
    expect(metrics.committedToLoans).toBe(5);
    // Only the active mandate weighs in: 800 bps.
    expect(metrics.weightedAprPercent).toBe(8);
  });

  it("returns a null APR when no active mandate has liquidity", () => {
    const metrics = earnMetrics(
      [mandate({ available: 0, allocatedPrincipal: 0, active: false })],
      0,
    );
    expect(metrics.weightedAprPercent).toBeNull();
  });

  it("aggregates multiple mandates with exact base-unit totals", () => {
    const metrics = earnMetrics(
      [
        mandate({ id: "a", available: 3_250_000 }),
        mandate({ id: "b", available: 1_750_000, allocatedPrincipal: 5_000_000 }),
      ],
      250_000 / 1_000_000,
    );
    expect(metrics.totalSupplied).toBe(10);
    expect(metrics.availableToLend).toBe(5);
    expect(metrics.committedToLoans).toBe(5);
    expect(metrics.withdrawable).toBe(5.25);
  });
});
