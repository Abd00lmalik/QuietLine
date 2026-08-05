// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import type { PrivateAccountView } from "../lib/privateTypes";
import { useQuietline } from "./useQuietline";

const address = "0x1111111111111111111111111111111111111111";

beforeEach(() => {
  sessionStorage.clear();
  useQuietline.setState({
    hasHydrated: true,
    mode: "live",
    address,
    accountNonce: 0,
    privateFxrp: 0,
    privateUsdt0: 0,
    lenderAllocated: 0,
    lenderEarned: 0,
    marketStatus: "loading",
    marketPriceE6: undefined,
    marketUpdatedAt: undefined,
    vaultUsdt0Balance: undefined,
    position: undefined,
    activities: [],
  });
});

describe("Quietline private account hydration", () => {
  it("persists an active private session across a same-tab refresh", async () => {
    const expiresAt = Date.now() + 15 * 60_000;
    useQuietline.getState().connectLive(address, "signed-session", expiresAt);
    useQuietline.setState({
      privateFxrp: 8.5,
      privateUsdt0: 2,
      accountNonce: 3,
    });

    const persisted = sessionStorage.getItem("quietline.private-session");
    expect(persisted).toContain("signed-session");

    useQuietline.setState({
      mode: "disconnected",
      address: undefined,
      sessionToken: undefined,
      privateFxrp: 0,
      privateUsdt0: 0,
      accountNonce: 0,
    });
    sessionStorage.setItem("quietline.private-session", persisted!);
    await useQuietline.persist.rehydrate();

    expect(useQuietline.getState()).toMatchObject({
      mode: "live",
      address,
      sessionToken: "signed-session",
      sessionExpiresAt: expiresAt,
      privateFxrp: 8.5,
      privateUsdt0: 2,
      accountNonce: 3,
    });
  });

  it("maps the FCC fixed-point ledger into the browser view", () => {
    const view: PrivateAccountView = {
      account: {
        owner: address,
        nonce: 4,
        balances: {
          FXRP: { available: 2_000_000, reserved: 10_000_000 },
          USDT0: { available: 4_250_000, reserved: 3_000_000 },
        },
        loanId: "loan-1",
      },
      loan: {
        id: "loan-1",
        borrower: address,
        principal: 3_000_000,
        interestPaid: 0,
        collateralFxrp: 10_000_000,
        borrowerAprBps: 850,
        termDays: 14,
        startedAt: 1_785_528_000,
        maturesAt: 1_786_737_600,
        lastAccruedAt: 1_785_528_000,
        accruedInterestRay: 4_200_000_000,
        tranches: [],
        status: "healthy",
        lastHealthFactorBps: 13_000,
        liquidationPriceE6: 461_538,
      },
      mandates: [],
      activities: [
        {
          id: "deposit-1",
          account: address,
          kind: "deposit",
          amount: 10_000_000,
          asset: "FXRP",
          createdAt: 1_785_528_000,
        },
      ],
      price: { xrpUsdE6: 600_000, updatedAt: 1_785_528_000 },
    };

    useQuietline.getState().hydratePrivateAccount(view);
    const state = useQuietline.getState();

    expect(state.accountNonce).toBe(4);
    expect(state.privateFxrp).toBe(2);
    expect(state.privateUsdt0).toBe(4.25);
    expect(state.lenderAllocated).toBe(3);
    expect(state.position).toMatchObject({
      principal: 3,
      accruedInterest: 0.0042,
      collateral: 10,
      apr: 8.5,
      termDays: 14,
      healthFactor: 1.3,
      status: "healthy",
    });
    expect(state.privateUpdatedAt).toEqual(expect.any(Number));
    expect(state.activities[0]).toMatchObject({
      scope: "private",
      label: "Deposit credited privately",
    });
  });

  it.each(["warning", "restricted", "liquidatable"] as const)(
    "preserves the private loan %s status",
    (status) => {
      useQuietline.getState().hydratePrivateAccount({
        account: {
          owner: address,
          nonce: 2,
          balances: {
            FXRP: { available: 0, reserved: 10_000_000 },
            USDT0: { available: 0, reserved: 0 },
          },
          loanId: "loan-risk",
        },
        loan: {
          id: "loan-risk",
          borrower: address,
          principal: 3_000_000,
          interestPaid: 0,
          collateralFxrp: 10_000_000,
          borrowerAprBps: 850,
          termDays: 14,
          startedAt: 1_785_528_000,
          maturesAt: 1_786_737_600,
          lastAccruedAt: 1_785_528_000,
          accruedInterestRay: 0,
          tranches: [],
          status,
          lastHealthFactorBps: 10_500,
          liquidationPriceE6: 461_538,
        },
        mandates: [],
        activities: [],
        price: { xrpUsdE6: 500_000, updatedAt: 1_785_528_000 },
      });

      expect(useQuietline.getState().position?.status).toBe(status);
    },
  );

  it("preserves public settlement rows while replacing decrypted activity", () => {
    useQuietline.getState().addPublicActivity({
      label: "USDT0 payout",
      detail: "3.00 USDT0",
      status: "complete",
    });
    useQuietline.getState().hydratePrivateAccount({
      account: {
        owner: address,
        nonce: 1,
        balances: {
          FXRP: { available: 0, reserved: 0 },
          USDT0: { available: 0, reserved: 0 },
        },
      },
      mandates: [],
      activities: [],
      price: { xrpUsdE6: 600_000, updatedAt: 1_785_528_000 },
    });

    expect(useQuietline.getState().activities).toHaveLength(1);
    expect(useQuietline.getState().activities[0]?.scope).toBe("public");
  });

  it("clears decrypted state and its refresh timestamp when locked", () => {
    useQuietline.getState().hydratePrivateAccount({
      account: {
        owner: address,
        nonce: 1,
        balances: {
          FXRP: { available: 1_000_000, reserved: 0 },
          USDT0: { available: 2_000_000, reserved: 0 },
        },
      },
      mandates: [],
      activities: [],
      price: { xrpUsdE6: 600_000, updatedAt: 1_785_528_000 },
    });
    expect(useQuietline.getState().privateUpdatedAt).toBeDefined();

    useQuietline.getState().lock();

    expect(useQuietline.getState()).toMatchObject({
      mode: "disconnected",
      privateUpdatedAt: undefined,
      privateFxrp: 0,
      privateUsdt0: 0,
      position: undefined,
    });
  });

  it("maps public vault holdings without presenting them as private liquidity", () => {
    useQuietline.getState().hydrateMarket({
      xrpUsdE6: 612_345,
      updatedAt: 1_785_528_000,
      vaultUsdt0Balance: "12500000",
    });

    expect(useQuietline.getState()).toMatchObject({
      marketPriceE6: 612_345,
      marketUpdatedAt: 1_785_528_000,
      vaultUsdt0Balance: 12.5,
      marketStatus: "ready",
    });
  });

  it("clears stale public market data when the live relayer is unavailable", () => {
    useQuietline.getState().hydrateMarket({
      xrpUsdE6: 612_345,
      updatedAt: 1_785_528_000,
      vaultUsdt0Balance: "12500000",
    });

    useQuietline.getState().markMarketUnavailable();

    expect(useQuietline.getState()).toMatchObject({
      marketStatus: "unavailable",
      marketPriceE6: undefined,
      marketUpdatedAt: undefined,
      vaultUsdt0Balance: undefined,
    });
  });
});
