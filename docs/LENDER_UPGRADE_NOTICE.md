# Lender upgrade notice — Quietline liquidity upgrade

**Network:** Flare Coston2 testnet (chain 114) · App: https://quietline.vercel.app

This notice describes changes to how lender liquidity behaves after the next
Quietline upgrade. It is a testnet announcement for users who provide USD₮0
liquidity through the **Earn** section. No action is required from you — your
balances, mandates, and committed loans are all preserved.

---

## What changes

### 1. Repaid principal automatically becomes lendable again

Previously, when a borrower repaid a loan, your repaid principal returned to
your private balance but your mandate went inactive, so the funds sat idle
until you re-activated it.

**After the upgrade:** when a borrower repays (or a loan is liquidated), the
repaid principal is returned to your **existing active mandate** and is
immediately available to lend again. You do not need to re-activate anything.

- Your principal is never double-credited and never lost.
- Interest you earned is still credited to your withdrawable balance, exactly
  as before.

### 2. Unallocated liquidity is withdrawable from Earn

Each active mandate now has a **Withdraw** action. You can withdraw the
mandate's *unallocated* amount — liquidity that is not currently committed to
any loan — plus your ordinary private balance, at any time. The funds settle
to your wallet as a public payout after the confidential settlement completes.

### 3. Committed principal stays reserved

Principal that is currently funding an active loan **cannot** be withdrawn and
is never presented as withdrawable. It becomes withdrawable only after the
loan repays and the principal returns to your mandate's available amount.

### 4. Clearer liquidity metrics on Earn

The Earn page now separates:

- **Total supplied** — everything you have mandated (available + committed).
- **Available to lend** — what FCC can match to new borrowers right now.
- **Committed to loans** — principal currently backing active loans.
- **Withdrawable balance** — your private balance plus unallocated mandate
  liquidity.
- **Interest earned** — cumulative lifetime interest.

These figures come directly from the confidential FCC state. Lender balances
and identities remain private; nothing new is exposed on-chain.

---

## Example

You supply 10 USD₮0 in Earn. A borrower takes a 4 USD₮0 loan from you:

- Available to lend: **6** (withdrawable now)
- Committed to loans: **4** (reserved until repayment)

When the borrower repays in full:

- Available to lend: **10** again (the 4 automatically returned to your
  mandate and is lendable to the next borrower)
- Interest earned: increased by your share of the loan interest
- Committed to loans: **0**

---

## What does not change

- Borrower quoting and matching rules (eligibility, per-borrower caps, terms,
  APR) are unchanged.
- Lender per-borrower caps and mandate terms are unchanged.
- No contract, relayer, or FCC state-schema changes accompany this upgrade.
- On-chain settlement, anchoring, and replay protections are unchanged.

---

## Questions

This is a testnet change; all amounts are test assets. If you observe any
discrepancy between the Earn page and your transactions, capture the error
message and report it with your account address (your balances stay
confidential inside FCC).
