# Quietline Five-Minute Demo Script

## Before Recording

1. Use a separate funded Coston2 borrower wallet, not the deployer.
2. Confirm the borrower has C2FLR, FXRP, and enough USD₮0 for repayment.
3. Confirm two lender mandates are active.
4. Open:
   - `https://quietline.vercel.app`;
   - `https://v2.43-157-63-199.sslip.io/api/health`;
   - `https://v2.43-157-63-199.sslip.io/info`;
   - the V2 QuietVault in Coston2 Explorer.
5. Confirm `/api/health` is `ok`, active TEE count is `1`, and the signer is
   `0x2e1e5a0e2d4cEC0690790B008673Ed99e05455dC`.

## 0:00-0:35 - The Product

Open the landing page.

Say:

> Quietline is a confidential FXRP-backed USD₮0 credit market built natively
> for Flare Confidential Compute. Lenders privately choose their rate, terms,
> allocation, and borrower cap. Borrowers receive a private quote without
> publishing their debt, APR, health, or lender allocation.

Point to Liquidity-based credit, 7/14/30-day terms, and FTSOv2.

## 0:35-1:00 - The Honest Privacy Boundary

Scroll to the private/public section.

Say:

> Token custody remains verifiable on Coston2, so deposits, payouts,
> withdrawals, addresses, amounts, and timing are public. Internal balances,
> lender mandates, matching, debt, interest, health, and liquidation state are
> held in the encrypted FCC ledger. The TEE sees plaintext while computing;
> Quietline does not claim FHE.

## 1:00-1:35 - Connect And Deposit Collateral

Open the application and connect the borrower wallet.

Explain each wallet prompt:

- account connection selects the address;
- network switch selects Coston2;
- session signature authenticates the wallet for 30 minutes;
- private account signatures authorize encrypted account queries or creation.

Deposit FXRP:

1. Click Deposit.
2. Select FXRP.
3. Enter the planned collateral amount.
4. Approve FXRP.
5. Confirm the QuietVault deposit.
6. Wait for FCC processing and the automatic private-balance refresh.

Open the explorer transaction and show that the deposit is public but no loan
terms exist yet.

## 1:35-2:30 - Private Multi-Lender Quote

Open Borrow.

1. Select 7, 14, or 30 days.
2. Enter a maximum APR compatible with both demo mandates.
3. Enter a request above either lender's individual borrower cap but below
   their combined eligible capacity and the 50% initial LTV limit.
4. Click Get private quote.
5. Sign the encrypted quote request.

Say:

> FCC reads the fresh FTSOv2 price, evaluates private mandates, and combines
> lender tranches. Neither the relayer nor the public contract receives the
> plaintext quote request.

Point to the matched amount, lender count, APR, LTV, collateral, and expiry.

Optional partial-fill moment:

Request slightly more than combined eligible capacity. Show Requested amount
versus Privately matched, then request a fully fundable amount for settlement.

## 2:30-3:20 - Accept And Settle

1. Click Accept and borrow.
2. Sign the encrypted acceptance.
3. Confirm the QuietVault request transaction.
4. Keep the settlement progress visible.

Say:

> FCC revalidates quote expiry, price, collateral, lender capacity, and the
> exact tranche snapshot. It updates the encrypted ledger, anchors the next
> state root, and signs only the required USD₮0 payout. QuietVault enforces
> signer authority, sequence, replay protection, supported assets, and actual
> vault liquidity.

Show the wallet's exact USD₮0 increase and the active private position.

## 3:20-4:05 - Private Risk

Open Position.

Show:

- principal and accrued interest;
- borrower APR and maturity;
- private LTV and health factor;
- warning and liquidation prices;
- lender-tranche count.

Move the stress slider and run a private stress check.

Say:

> This scenario is computed against the private position without creating a
> public transaction or revealing the user's debt.

## 4:05-4:35 - Repay And Release

1. Ensure the private USD₮0 balance covers total debt.
2. Click Repay or Close position.
3. Sign the private repayment.
4. Show that the loan disappears and FXRP becomes privately available.
5. Withdraw a small FXRP amount and confirm the public payout.

Say:

> Principal and interest are allocated privately back to lender accounts. Only
> the final asset movement and state commitment become public.

## 4:35-5:00 - Prove The FCC Integration

Open `/api/health`, `/info`, and the active manifest.

Point out:

- extension `66008`;
- one active signer;
- signer `0x2e1e...55dC`;
- code hash;
- Coston2 chain ID `114`;
- QuietVault `0x1C53...D511`;
- live FTSOv2 market data;
- V1 retained separately and unused by the public application.

Close with:

> Quietline uses FCC for the part that cannot be done honestly in normal
> Solidity: private lender discovery, private credit accounting, and private
> risk decisions that produce constrained, verifiable public settlement.

