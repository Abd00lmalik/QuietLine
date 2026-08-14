import type { PrivateAccountView } from "./privateTypes";

// After a settlement is confirmed on-chain (deposit credited, loan payout,
// withdrawal payout, or repayment applied), this browser must reconcile its
// confidential snapshot against the authoritative FCC account. If that refresh
// fails (declined signature, decrypt or network failure), the settlement has
// already happened, so the caller must NOT report the operation as failed:
// instead raise the recovery flag so the Overview banner prompts a refresh and
// a later ACCOUNT_QUERY hydrate reconciles the stale balance.
export async function refreshSettlementView(
  refresh: () => Promise<PrivateAccountView>,
  markSettlementRefreshPending: () => void,
): Promise<PrivateAccountView | undefined> {
  try {
    return await refresh();
  } catch {
    markSettlementRefreshPending();
    return undefined;
  }
}
