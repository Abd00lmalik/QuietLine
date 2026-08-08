import { describe, expect, it } from "vitest";
import type { RelayerJob } from "./api";
import {
  accountContainsQuoteLoan,
  findConfirmedBorrowForQuote,
  isAlreadyProcessedError,
} from "./borrowSettlement";
import type { PrivateAccountView, PrivateQuote } from "./privateTypes";

const quote: PrivateQuote = {
  requestId: "quote-1",
  borrower: "0xBD3937BA7E39F280D78923b517e5F454F1C7A883",
  amount: 10_000_000,
  termDays: 7,
  collateralFxrp: 20_000_000,
  lenderAprBps: 700,
  borrowerAprBps: 710,
  maxAprBps: 1_200,
  tranches: [],
  expiresAt: 1_786_191_441,
  priceE6: 1_036_500,
};

function job(patch: Partial<RelayerJob>): RelayerJob {
  return {
    id: "job-1",
    type: "BORROW_ACCEPT",
    status: "confirmed",
    account: quote.borrower,
    attempts: 1,
    createdAt: quote.expiresAt * 1_000 - 200_000,
    updatedAt: quote.expiresAt * 1_000 - 190_000,
    ...patch,
  };
}

describe("borrow settlement recovery", () => {
  it("finds a confirmed settlement created during the quote window", () => {
    const confirmed = job({ txHash: "0x123" });
    expect(
      findConfirmedBorrowForQuote(
        [
          job({ id: "failed", status: "failed" }),
          confirmed,
          job({
            id: "old",
            createdAt: quote.expiresAt * 1_000 - 600_000,
          }),
        ],
        quote,
      ),
    ).toBe(confirmed);
  });

  it("matches the confidential account loan to the accepted quote", () => {
    const view = {
      account: {
        owner: quote.borrower,
        nonce: 2,
        balances: {
          FXRP: { available: 0, reserved: quote.collateralFxrp },
          USDT0: { available: 0, reserved: 0 },
        },
      },
      loan: {
        id: "loan-1",
        borrower: quote.borrower,
        principal: quote.amount,
        interestPaid: 0,
        collateralFxrp: quote.collateralFxrp,
        borrowerAprBps: quote.borrowerAprBps,
        termDays: quote.termDays,
        startedAt: 1,
        maturesAt: 2,
        lastAccruedAt: 1,
        accruedInterestRay: 0,
        tranches: [],
        status: "healthy",
        lastHealthFactorBps: 10_000,
        liquidationPriceE6: 769_200,
      },
      mandates: [],
      activities: [],
      price: { xrpUsdE6: quote.priceE6, updatedAt: 1 },
    } satisfies PrivateAccountView;
    expect(accountContainsQuoteLoan(view, quote)).toBe(true);
    expect(
      accountContainsQuoteLoan(
        { ...view, loan: { ...view.loan, principal: quote.amount + 1 } },
        quote,
      ),
    ).toBe(false);
  });

  it("recognizes FCC duplicate processing errors", () => {
    expect(isAlreadyProcessedError(new Error("error: operation already processed"))).toBe(true);
    expect(isAlreadyProcessedError(new Error("liquidity changed"))).toBe(false);
  });
});
