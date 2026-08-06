# Live Testnet Runbook

## Required Wallets

- borrower: C2FLR and certified FTestXRP;
- lender: C2FLR and certified USD₮0;
- protocol operator: C2FLR and certified USD₮0 for the backstop;
- relayer: C2FLR only.

Never use the deployer wallet in the public judge flow.

## Setup

1. Confirm Coston2 chain ID 114 in the wallet.
2. Confirm contract addresses against `deployments/coston2.json`.
3. Confirm relayer `/health` and FCC `/info`.
4. Confirm FTSOv2 price age is below five minutes.
5. Confirm the private backstop funding job is `confirmed`.

## Lender Flow

1. Open Quietline and connect the lender wallet.
2. Sign the session challenge.
3. Deposit certified USD₮0 into QuietVault.
4. Wait for the exact chain request to confirm.
5. Open Earn and activate a mandate:
   - amount: 5 USD₮0;
   - minimum APR: 8%;
   - terms: 7, 14, and 30 days;
   - per-borrower cap: 5 USD₮0.
6. Confirm the decrypted mandate is visible and no public event exposes its APR
   or allocation.

## Borrower Flow

1. Connect the borrower wallet and sign the session challenge.
2. Deposit 10 FTestXRP.
3. Request 3 USD₮0 for 14 days with a 12% maximum APR.
4. Show the live quote countdown and private lender match.
5. Accept the quote and sign the encrypted acceptance.
6. Wait for the real Coston2 request, FCC computation, TEE-signed settlement,
   and USD₮0 payout.
7. Open Position and show private debt, APR, maturity, health, warning price,
   liquidation price, lender-tranche count, and private stress calculation.

## Repayment Flow

1. Deposit enough USD₮0 to cover current debt.
2. Open Position and choose Repay.
3. Confirm the full-close transaction.
4. Verify lender principal and interest return privately.
5. Verify borrower FTestXRP becomes privately available.
6. Withdraw a small FTestXRP amount and show the public Coston2 payout.

## Failure Checks

- Wrong chain: the wallet is prompted to switch to Coston2.
- Expired quote: acceptance is disabled.
- Stale oracle: borrow and risk tick revert.
- Insufficient private balance: request is rejected before mutation.
- Session expiration: decrypted state is cleared.
- Wallet account change: the private session is cleared.
- FCC unavailable: health changes to degraded and actions report a direct error.
