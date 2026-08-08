# Quietline Summer Signal Submission

## One-Line Pitch

Quietline is a confidential FXRP-backed USD₮0 credit market where Flare
Confidential Compute privately matches lender mandates, calculates debt and
risk, and authorizes exact public Coston2 settlement.

## What Users Can Do

- Deposit FXRP and request a private, fixed-term USD₮0 credit quote.
- Deposit USD₮0 and create a private lending mandate with a minimum APR,
  supported terms, total allocation, and per-borrower cap.
- Combine multiple private lender mandates into one borrower quote.
- Receive a private partial quote when eligible liquidity cannot fill the full
  request.
- Inspect private debt, interest, health, liquidation price, lender-tranche
  count, activity, and stress scenarios.
- Repay the full position, release collateral, and withdraw available assets.

There is no protocol-imposed 1, 5, or 8 USD₮0 amount cap. Credit is constrained
by FXRP collateral value, the 50% initial LTV rule, eligible lender mandates,
available QuietVault liquidity, and protocol risk checks.

## Why FCC Is Essential

The public EVM contract cannot evaluate hidden lender offers or store private
loan state without revealing it. Quietline uses FCC as the authoritative
confidential credit engine. The registered workload:

1. decrypts wallet-authorized requests;
2. maintains encrypted private balances and mandates;
3. matches one or more lenders;
4. calculates interest, health, and liquidation state;
5. creates a sequential private-state commitment;
6. signs the minimum public token settlement required by QuietVault.

The chain verifies custody, prices, signer authority, state sequence, replay
protection, supported assets, and real vault liquidity. FCC sees plaintext
during computation; this is confidential execution, not FHE.

## Privacy Boundary

Private:

- internal FXRP and USD₮0 balances;
- lender mandate terms and remaining allocation;
- requested and matched credit details;
- debt, APR, accrued interest, health, and liquidation price;
- lender allocations, private activity, and stress results.

Public:

- wallet addresses and transaction timing;
- token approvals, deposits, payouts, and withdrawals;
- token amounts moved by those transactions;
- FTSOv2 observations used by the public vault;
- state roots, sequence numbers, and TEE-signed settlement data.

## Live Deployment

- Application: `https://quietline.vercel.app`
- Network: Coston2, chain ID `114`
- QuietPolicy V2: `0x28E7965D7b1c4d1f7CB5837dAd691123dec72694`
- QuietVault V2: `0x1C53d0188bA554A23242A2822daBaB802698D511`
- FCC extension: `66008`
- Active signer: `0x2e1e5a0e2d4cEC0690790B008673Ed99e05455dC`
- FCC/relayer endpoint: `https://v2.43-157-63-199.sslip.io`
- FXRP: `0x0b6A3645c240605887a5532109323A3E12273dc7`
- USD₮0: `0xC1A5B41512496B80903D1f32d6dEa3a73212E71F`
- FlareTeeManager: `0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE`
- FTSOv2: `0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d`

The V1 contracts remain deployed only as immutable testnet history. The public
application and always-on services use V2.

## Technical Evidence

Live Coston2 regression proved:

- real USD₮0 lender deposits and private mandates;
- real FXRP collateral deposits;
- a `1.805038 USD₮0` request returning a `1.5 USD₮0` two-lender partial quote;
- a `1.805899 USD₮0` request fully funded across two lenders;
- public USD₮0 payout after private acceptance checks;
- full private repayment, collateral release, and FXRP withdrawal;
- exactly one active production signer for extension `66008`;
- Vercel CORS, wallet-session persistence logic, and post-transaction refresh;
- responsive layouts at desktop, compact, high-zoom, and mobile sizes.

Automated coverage includes contract settlement invariants, removed legacy
amount caps, actual-liquidity enforcement, quote and orchestrator behavior,
wallet state, ECIES interoperability with the Go FCC implementation, encrypted
ledger behavior, and large arithmetic boundaries.

## Honest Limitations

- Official Coston2 `SIMULATED_TEE=true`, `MODE=1` judging mode is used.
- One active TEE, relayer, and keeper serve this hackathon deployment.
- Deposit, payout, and withdrawal amounts are public.
- One active loan per private account and full repayment only.
- Fixed 7, 14, and 30 day terms.
- FXRP collateral and USD₮0 debt only.
- No production audit or mainnet deployment.

## Repository

`https://github.com/Abd00lmalik/QuietLine`

Start with:

- `docs/JUDGE_GUIDE.md`
- `docs/DEMO_SCRIPT.md`
- `docs/ARCHITECTURE.md`
- `docs/SECURITY_AND_PRIVACY.md`
- `docs/MANUAL_QA_GUIDE.md`

