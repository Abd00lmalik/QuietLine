# Quietline V2 Parallel Deployment Runbook

V2 is deployed beside the live V1 protocol. No V1 contract, FCC extension,
state volume, relayer database, or frontend setting is modified until the V2
acceptance gate passes.

## Deployment files

- Live V1 archive: `deployments/coston2-legacy-v1.json`
- Current public application manifest: `deployments/coston2.json` (V2)
- Parallel V2 manifest: `deployments/coston2-v2.json`

All Coston2 contract administration scripts now target
`deployments/coston2-v2.json`. The Node deployment helpers also target that
manifest by default. Set `QUIETLINE_DEPLOYMENT_FILE=coston2.json` only for an
explicit legacy investigation; never use it during V2 deployment.

## Isolation requirements

V2 must have:

1. A newly deployed QuietPolicy and QuietVault.
2. A new public FCC extension ID bound to the V2 vault.
3. A new production FCC machine and signer.
4. A fresh encrypted ledger volume.
5. A fresh Redis namespace or instance.
6. A fresh relayer database and V2 vault start block.
7. A stable public HTTPS FCC endpoint that does not interrupt V1.
8. Separately funded V2 vault liquidity and backstop.

V1 confidential balances were not migrated. Test users deposit new testnet
assets into V2. The V1 contracts and extension remain retained as immutable
testnet history in `deployments/coston2-legacy-v1.json`.

## Acceptance record

The V2 gate passed on August 8, 2026. Live Coston2 regression covered real
USD₮0 lender deposits, lender mandate creation and cancellation, FXRP
collateral, private quoting, multi-lender settlement, partial fills, repayment,
collateral release, and withdrawal. A live request for `1.805038 USD₮0` returned
a `1.5 USD₮0` two-lender partial quote; after increasing both per-borrower caps,
a `1.805899 USD₮0` request filled completely across two lenders and completed
the full repayment and collateral-withdrawal lifecycle. Contract unit tests
separately cover payouts above the removed V1 amount caps and large integer
boundaries. The V2 FCC host reported one active signer and healthy API,
database, and FCC services before cutover.

## Acceptance gate

Do not copy `coston2-v2.json` to `coston2.json`, update the production relayer,
or change Vercel until all checks pass:

1. Contract, protocol, relayer, frontend, and Go test suites pass.
2. The V2 FCC machine is the only production machine for the V2 extension.
3. `/info` reports the V2 chain, extension, code hash, and signer.
4. `/api/health` reports matching live and vault signers.
5. FXRP and USD₮0 deposits credit private balances.
6. A single lender funds a quote up to its private mandate and borrower cap.
7. Multiple lenders jointly fund a quote above either lender's individual cap.
8. A request larger than eligible liquidity returns a private partial quote.
9. A payout above the legacy 5 USD₮0 limit settles.
10. Multiple payouts above the legacy 8 USD₮0 daily limit settle.
11. A request above 50% initial LTV is rejected.
12. Repayment, collateral release, withdrawal, risk tick, stress view,
    liquidation logic, history, and statement export pass through live or
    automated regression as applicable.
13. Wallet persistence and post-transaction state refresh pass.
14. Desktop, high-zoom, and mobile layouts remain usable.

## Cutover

After acceptance:

1. Save a dated copy of the current `deployments/coston2.json`.
2. Copy the accepted V2 manifest to `deployments/coston2.json`.
3. Point the production relayer and FCC configuration to the V2 vault,
   extension, signer, start block, and fresh data volumes.
4. Verify production health before changing the frontend.
5. update Vercel to the accepted V2 relayer URL.
6. Run the complete manual QA guide against `quietline.vercel.app`.
7. Keep V1 contracts and `coston2-legacy-v1.json` available for audit history.

Rollback means restoring the previous frontend and relayer configuration. It
does not mutate either protocol's on-chain state.
