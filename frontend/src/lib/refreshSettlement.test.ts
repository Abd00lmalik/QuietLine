import { describe, expect, it, vi } from "vitest";
import type { PrivateAccountView } from "./privateTypes";
import { refreshSettlementView } from "./refreshSettlement";

const view: PrivateAccountView = {
  account: {
    owner: "0x1111111111111111111111111111111111111111",
    nonce: 3,
    balances: {
      FXRP: { available: 0, reserved: 0 },
      USDT0: { available: 0, reserved: 5_000_000 },
    },
  },
  mandates: [
    {
      id: "m1",
      lender: "0x1111111111111111111111111111111111111111",
      available: 5_000_000,
      minAprBps: 750,
      termMask: 7,
      perBorrowerCap: 5_000_000,
      active: true,
      createdAt: 1,
      allocatedPrincipal: 0,
      interestEarned: 0,
    },
  ],
  activities: [],
  price: { xrpUsdE6: 600_000, updatedAt: 1_785_528_000 },
};

describe("refreshSettlementView", () => {
  it("returns the authoritative view and does not raise the flag on success", async () => {
    const mark = vi.fn();
    const result = await refreshSettlementView(async () => view, mark);

    expect(result).toBe(view);
    expect(mark).not.toHaveBeenCalled();
  });

  it("raises the recovery flag instead of rejecting when the refresh fails", async () => {
    const mark = vi.fn();
    const result = await refreshSettlementView(
      async () => {
        throw new Error("signature rejected");
      },
      mark,
    );

    expect(result).toBeUndefined();
    expect(mark).toHaveBeenCalledTimes(1);
  });

  it("returns undefined when the refresh is declined and keeps the flag raised", async () => {
    const mark = vi.fn();
    const result = await refreshSettlementView(
      async () => {
        throw new Error("user rejected the request");
      },
      mark,
    );

    expect(result).toBeUndefined();
    expect(mark).toHaveBeenCalledTimes(1);
  });
});
