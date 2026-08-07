# Quietline V1 Regression Baseline

This document freezes the known-good Coston2 behavior that Quietline V2 must
preserve. The live V1 contracts and FCC extension remain deployed and must not
be modified during V2 development.

## Frozen deployment

- Source commit: `d5d34fd`
- Manifest: `deployments/coston2-legacy-v1.json`
- QuietPolicy: `0x90dC7172b5a771A51AfA6dF0De09022Df674Ab5d`
- QuietVault: `0x0A7fF224174896A743B41491f0Ef8036B32Fc5E4`
- FCC extension: `65951`
- FCC signer: `0x3dB7259F8205B6655a809fCD7844e6D24524A43E`
- Frontend: `https://quietline.vercel.app`

## Required V2 regressions

V2 must preserve these behaviors before the frontend or relayer is switched:

1. Wallet connection persists across refreshes and account changes.
2. A wallet can create and query its private account.
3. FXRP and USDt0 deposits are credited after FCC processing and anchoring.
4. Available and reserved private balances remain hidden from public chain state.
5. A user can withdraw available FXRP or USDt0.
6. A lender can create and cancel a private mandate.
7. Matching can combine multiple eligible lender mandates.
8. A borrower can request, review, and accept a private quote.
9. Quote acceptance pays USDt0 publicly and reserves FXRP privately.
10. One active loan is allowed per borrower.
11. Interest accrues by elapsed time and the accepted APR.
12. Full repayment closes a loan, releases collateral, and returns principal and
    lender interest.
13. FTSOv2 observations drive private risk ticks.
14. Health, warning, restricted, and liquidation states remain queryable by the
    position owner.
15. The funded backstop can liquidate an eligible position.
16. Private and public activity histories remain available.
17. Users can export their private statement.
18. Relayer jobs survive restarts and resume safely.
19. Every confidential mutation is durably persisted before its new root is
    anchored on-chain.
20. Startup and deployment checks reject an unsafe FCC machine configuration.
21. Existing responsive layouts, asset names, token symbols, and current brand
    behavior remain intact.

## V2 acceptance additions

V2 additionally requires:

- No protocol-imposed 1, 5, or 8 USDt0 amount cap.
- Any positive request that fits `uint64`, collateral, liquidity, and policy rules.
- A 50% maximum initial LTV.
- Deterministic multi-lender matching.
- A private partial quote when some, but not all, requested liquidity is eligible.
- Exact requested and funded amounts shown separately.
- Overflow-safe arithmetic for large valid positions.
- Clear rejection when no eligible liquidity exists.

The live application may switch to V2 only after all baseline and V2 acceptance
checks pass against the parallel V2 deployment.
