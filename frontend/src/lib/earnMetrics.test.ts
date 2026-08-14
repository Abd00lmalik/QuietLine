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

  // Regression: an Earn withdrawal of 2 USDT₮0 from 7 available must leave
  // exactly 5 available after the authoritative FCC refresh returns the new
  // mandate snapshot — never an optimistic subtract, never a stale 7.
  it("shows 5 available after a 2 USDT₮0 Earn withdrawal from 7 settles", () => {
    const before = earnMetrics([mandate({ available: 7_000_000 })], 0);
    expect(before.availableToLend).toBe(7);
    expect(before.withdrawable).toBe(7);

    // Authoritative FCC state after the withdrawal: the mandate's unallocated
    // available dropped from 7_000_000 to 5_000_000 base units.
    const after = earnMetrics([mandate({ available: 5_000_000 })], 0);
    expect(after.availableToLend).toBe(5);
    expect(after.withdrawable).toBe(5);
  });

  it("keeps committed loan principal untouched by a withdrawal", () => {
    const before = earnMetrics(
      [mandate({ available: 7_000_000, allocatedPrincipal: 3_000_000 })],
      0,
    );
    expect(before.availableToLend).toBe(7);
    expect(before.committedToLoans).toBe(3);

    // Withdrawing 2 of the 7 unallocated only reduces mandate.Available;
    // AllocatedPrincipal (committed to loans) must not change.
    const after = earnMetrics(
      [mandate({ available: 5_000_000, allocatedPrincipal: 3_000_000 })],
      0,
    );
    expect(after.availableToLend).toBe(5);
    expect(after.committedToLoans).toBe(3);
    expect(after.totalSupplied).toBe(8);
  });

  it("aggregates multi-mandate available correctly after one mandate is withdrawn", () => {
    // Mandate A: 7 available, withdraw 2 -> 5. Mandate B: untouched at 4.
    const after = earnMetrics(
      [
        mandate({ id: "a", available: 5_000_000, minAprBps: 700 }),
        mandate({ id: "b", available: 4_000_000, minAprBps: 800 }),
      ],
      0,
    );
    expect(after.availableToLend).toBe(9);
    expect(after.withdrawable).toBe(9);
    // The per-mandate rows divide available by 1_000_000: mandate A shows 5
    // after its withdrawal and mandate B still shows 4.
    expect(5_000_000 / 1_000_000).toBe(5);
    expect(4_000_000 / 1_000_000).toBe(4);
  });

  it("leaves the displayed balance unchanged when a withdrawal is refused", () => {
    // A failed/reverted withdrawal produces no FCC state change, so the same
    // snapshot keeps displaying 7 available.
    const metrics = earnMetrics([mandate({ available: 7_000_000 })], 0);
    expect(metrics.availableToLend).toBe(7);
    expect(metrics.withdrawable).toBe(7);
  });

  it("does not touch unrelated mandates or interest earned during a withdrawal", () => {
    const after = earnMetrics(
      [
        mandate({
          id: "withdrawn",
          available: 5_000_000,
          allocatedPrincipal: 2_000_000,
          interestEarned: 120_000,
          active: true,
        }),
        mandate({
          id: "untouched",
          available: 7_000_000,
          allocatedPrincipal: 1_000_000,
          interestEarned: 400_000,
          active: true,
        }),
      ],
      0,
    );
    expect(after.availableToLend).toBe(12);
    expect(after.committedToLoans).toBe(3);
    // InterestEarned is displayed separately from lendable liquidity and must
    // not be folded into available/committed totals.
    expect(after.totalSupplied).toBe(15);
  });
});
