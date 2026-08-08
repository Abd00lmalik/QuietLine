import type { RelayerJob } from "./api";
import type { PrivateAccountView, PrivateQuote } from "./privateTypes";

const QUOTE_VALIDITY_MS = 300_000;
const SETTLEMENT_GRACE_MS = 60_000;

export function findConfirmedBorrowForQuote(
  jobs: RelayerJob[],
  quote: PrivateQuote,
) {
  const issuedAt = quote.expiresAt * 1_000 - QUOTE_VALIDITY_MS;
  const latestRelevantTime = quote.expiresAt * 1_000 + SETTLEMENT_GRACE_MS;
  return jobs.find(
    (job) =>
      job.type === "BORROW_ACCEPT" &&
      job.status === "confirmed" &&
      job.createdAt >= issuedAt &&
      job.createdAt <= latestRelevantTime,
  );
}

export function accountContainsQuoteLoan(
  view: PrivateAccountView,
  quote: PrivateQuote,
) {
  const loan = view.loan;
  if (!loan) return false;
  return (
    loan.borrower.toLowerCase() === quote.borrower.toLowerCase() &&
    loan.principal === quote.amount &&
    loan.collateralFxrp === quote.collateralFxrp &&
    loan.borrowerAprBps === quote.borrowerAprBps &&
    loan.termDays === quote.termDays
  );
}

export function isAlreadyProcessedError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.toLowerCase().includes("operation already processed");
}
