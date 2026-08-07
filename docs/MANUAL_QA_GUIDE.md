# Quietline Manual End-to-End QA Guide

Last verified: August 7, 2026

This guide is the V2 acceptance suite for `https://quietline.vercel.app`. Do not
run it against the public URL until the V2 parallel deployment has passed the
gates in `docs/V2_DEPLOYMENT_RUNBOOK.md`. Use a separate test wallet. Do not use
production assets.

## Live deployment

- Network: Coston2, chain ID `114`
- QuietVault: verify against the accepted `deployments/coston2-v2.json`
- FXRP: `0x0b6A3645c240605887a5532109323A3E12273dc7`
- USD₮0: `0xC1A5B41512496B80903D1f32d6dEa3a73212E71F`
- FCC extension: verify against the accepted V2 manifest
- Active TEE signer: verify against the accepted V2 manifest and `/info`
- Faucet: `https://faucet.flare.network/coston2`
- Explorer: `https://coston2-explorer.flare.network`

## 1. Prepare the wallet

1. Open the Coston2 faucet.
2. Enter the wallet address.
3. Request C2FLR for gas, FXRP for collateral, and USD₮0 for lending or repayment.
4. Add Coston2 to MetaMask if it is not already present.
5. Confirm MetaMask shows the real symbols `C2FLR`, `FXRP`, and `USD₮0`.
6. Keep at least `1 C2FLR` for transactions.

Expected result: the wallet has gas and at least one supported test token.

## 2. Test the landing page

1. Open `https://quietline.vercel.app`.
2. Verify the hero explains FXRP-backed, fixed-term USD₮0 credit.
3. Verify the facts show liquidity-based credit, `7 / 14 / 30` day terms, and FTSOv2.
4. Read the private/public boundary.
5. Open and close every FAQ item.
6. Click Product, Privacy, How it works, and FAQ in the header.
7. Click `Enter Quietline`.

Expected result: navigation works, assets use the correct names, and nothing overlaps
at normal zoom or 200% browser zoom.

## 3. Connect the wallet

1. Click `Connect Coston2 wallet`.
2. Approve the wallet account connection when MetaMask asks.
3. Approve the Coston2 network switch if requested.
4. Sign the 30-minute Quietline session challenge.
5. Sign the private account query.
6. A brand-new wallet may additionally sign `Create private account`, followed by
   one final query signature.

The signatures do not move tokens and do not spend gas. Their purposes are:

- Wallet connection: lets the site read the selected address.
- Network switch: selects Coston2.
- Session challenge: authenticates the wallet to the relayer for 30 minutes.
- Account query: authorizes an encrypted private-account response.
- Open account: creates the wallet's confidential ledger record when it does not exist.

Expected result: the header shows the shortened wallet address and `FCC Online`.

## 4. Test session persistence

1. Refresh the page after connecting.
2. Wait up to two seconds for wallet reconnection.
3. Navigate between Overview, Borrow, Earn, Activity, and Settings.
4. Open a second route and return with the browser Back button.

Expected result: the wallet and unexpired private session remain connected. A fresh
signature is required only after the 30-minute session expires, the account changes,
or `Lock private data` is clicked.

## 5. Test Overview

1. Verify the private FXRP and USD₮0 balances are shown.
2. Verify public vault holdings and XRP/USD are shown.
3. Click the refresh icon.
4. Open and close the wallet menu.
5. Test Copy address and Open in explorer.
6. Do not click Disconnect until the end of the full test.

Expected result: refreshing asks for an account-query signature and updates the
decrypted account without reloading the page.

## 6. Deposit FXRP

1. Click `Deposit`.
2. Select `Deposit` and `FXRP`.
3. Enter a small amount such as `1`.
4. Test the `25%`, `50%`, and `Max` controls without submitting.
5. Enter the intended amount again.
6. Click `Approve and deposit FXRP`.
7. Confirm the FXRP approval transaction in MetaMask.
8. Confirm the QuietVault deposit transaction.
9. Wait while the button reads `Vault confirmed; waiting for FCC`.

Expected result:

- The wallet FXRP balance decreases.
- The private FXRP balance increases automatically.
- Activity shows both the public vault instruction and private deposit credit.
- No manual refresh is required.

If the token transaction confirms but FCC fails, Quietline must explicitly say the
funds are in QuietVault and instruct the user not to submit the deposit again.

## 7. Deposit USD₮0

Repeat the FXRP deposit flow with a small USD₮0 amount.

Expected result: the wallet USD₮0 balance decreases and the private USD₮0 balance
increases after FCC confirms the confidential credit.

## 8. Withdraw a private balance

1. Open the Deposit modal.
2. Select `Withdraw`.
3. Select FXRP or USD₮0.
4. Enter an amount smaller than the displayed private balance.
5. Click `Withdraw`.
6. Confirm the public Coston2 request transaction.

Expected result: FCC authorizes the withdrawal, QuietVault pays the connected address,
the private balance decreases, and the wallet token balance increases.

## 9. Create a private lender mandate

1. Open Earn.
2. Click `Provide liquidity`.
3. Confirm Amount and Maximum per borrower initially equal the full private
   USD₮0 balance, then enter the amount you want to lend.
4. Enter a minimum APR between `6%` and `20%`.
5. Select one or more of `7`, `14`, and `30` days.
6. Leave Maximum per borrower at the full mandate amount or lower it.
7. Click `Activate private mandate`.
8. Sign the typed private action.

Expected result: no token transfer occurs. The private USD₮0 balance is reserved,
the mandate appears as Active, and its confidential state root is anchored.

## 10. Request a private borrow quote

1. Open Borrow.
2. Enter available private FXRP collateral.
3. Click Continue.
4. Enter any positive borrow amount supported by your collateral.
5. Enter a maximum borrower APR compatible with the lender mandate.
6. Select a term supported by the mandate.
7. Ensure the displayed starting LTV is no greater than `50%`.
8. Click `Get private quote`.
9. Sign the encrypted quote request.

Expected result: a quote appears with amount, APR, term, collateral, LTV,
estimated interest, liquidation price, lender count, and a five-minute
countdown. There is no 1, 5, or 8 USD₮0 protocol cap.

## 10A. Test private partial funding

1. Note the total eligible lender amount.
2. Request more USD₮0 than eligible mandates can fund while remaining below 50%
   initial LTV.
3. Click `Get private quote` and sign the request.
4. Verify the quote separately shows Requested amount and Privately matched.
5. Accept the quote.

Expected result: the request does not fail merely because full liquidity is
unavailable. Quietline settles the privately matched amount and reserves only
the proportionate FXRP collateral shown in the quote.

## 11. Accept and settle the loan

1. Click `Accept and borrow` before the quote expires.
2. Sign the borrow acceptance.
3. Confirm the public QuietVault request transaction.
4. Watch all settlement steps complete.
5. Click `View position`.

Expected result:

- The wallet receives the exact quoted USD₮0 payout.
- One private loan appears.
- The allocated FXRP becomes private collateral.
- Debt, APR, lender tranches, and risk state remain off-chain.

## 12. Test the Position page

1. Verify Total debt, Borrower APR, Maturity, Collateral value, LTV, and Health factor.
2. Verify the FTSOv2 chart and private warning/liquidation reference lines.
3. Expand `View accessible price table`.
4. Review Principal, lender interest, protocol interest, daily interest, and projected debt.
5. Click the refresh icon and sign the account query.

Expected result: every value refreshes without a page reload.

## 13. Test private stress analysis

1. Move the Price decline slider through `5%`, `20%`, and `40%`.
2. Click `Run private stress check`.
3. Sign the private query.

Expected result: projected LTV and status appear. No token moves, the FTSO price is
unchanged, and no ledger mutation is created.

## 14. Add collateral

1. Click `Add collateral`.
2. Deposit additional FXRP using the normal public deposit flow.
3. Wait for FCC credit and refresh the position.

Expected result: private collateral increases and LTV/health improve.

## 15. Export a statement

1. Click `Export statement`.
2. Open the downloaded file locally.

Expected result: the export contains the currently decrypted private account snapshot.
The export is generated in the browser and is not uploaded by Quietline.

## 16. Repay and close

1. Ensure the private USD₮0 balance covers total debt.
2. If needed, deposit additional USD₮0 first.
3. Click `Repay` or `Close position`.
4. Review the full-close disclosure.
5. Click `Apply repayment` or `Close private position`.
6. Sign the repayment action.

Expected result: the full debt is cleared, all FXRP collateral becomes privately
available, the loan disappears, and the new root is anchored. Partial repayment is
not supported in this release.

## 17. Test Activity

1. Open Activity.
2. Switch between All, Public, and Private tabs.
3. Open explorer links for public transactions.

Expected result: deposits, withdrawals, borrow settlement, and root anchors appear as
public events; confidential ledger actions appear as private events.

## 18. Test Settings

1. Verify network, contract, asset, privacy, attestation, and service information.
2. Toggle every notification setting.
3. Lock private data from the wallet menu.
4. Reopen a private session.
5. Finally click Disconnect.

Expected result: notification preferences persist, Lock clears decrypted values without
disconnecting MetaMask, and Disconnect clears both wallet and Quietline state.

## 19. Failure checks

Verify these inputs are rejected before funds move:

- Deposit amount is zero, negative, or above wallet balance.
- Withdrawal exceeds the private balance.
- Borrow is below `1` or above `5 USD₮0`.
- Starting LTV exceeds `50%`.
- Quote is accepted after expiry.
- Mandate APR is outside `6–20%`.
- Mandate borrower cap exceeds mandate amount.
- Repayment balance is below total debt.
- FCC health is degraded or more than one production TEE is active.

## 20. Responsive checks

Repeat the landing page and disconnected app at:

- Desktop: `1440 × 900`
- Compact desktop: `1024 × 768`
- Mobile: `390 × 844`
- Browser zoom: `125%`, `150%`, and `200%`

Expected result: no horizontal scrolling, clipped labels, overlapping cards, hidden
buttons, or inaccessible navigation.
