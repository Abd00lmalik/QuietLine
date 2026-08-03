# Judge Guide

## What Quietline Demonstrates

Quietline is not a simulated privacy dashboard. The submitted application uses:

- certified Coston2 FXRP and testUSDT0;
- real QuietVault transactions and token custody;
- real FTSOv2 XRP/USD observations;
- real FCC direct and chain instruction paths;
- ECIES-encrypted requests and responses;
- an encrypted private lending ledger;
- TEE-signed sequential Coston2 settlements;
- deterministic private backstop liquidation.

## Five-Minute Demo

**0:00-0:45** - Open the landing page and state the boundary: deposits and
payouts are public; terms, debt, lender mandates, and risk remain private.

**0:45-1:30** - Connect a funded lender wallet, deposit testUSDT0, and show a
private mandate. Open the Coston2 transaction and point out that APR and terms
are absent.

**1:30-2:30** - Connect the borrower wallet, deposit FXRP, request a quote, and
show the live confidential match and expiry.

**2:30-3:45** - Accept. Show the public request transaction, durable relayer
stages, TEE-signed settlement, and testUSDT0 arrival.

**3:45-4:30** - Show private health, liquidation price, interest split, and run
a private stress query without changing chain state.

**4:30-5:00** - Open FCC information and the Coston2 manifest. Explain that the
contract signer is derived from and permanently bound to the attested machine
key.

## What Is Not Claimed

- This is not FHE; FCC sees plaintext during execution.
- Deposit and payout amounts are not hidden.
- The hackathon release has one TEE and one relayer.
- The code has not received a production audit.
- Backstop assets cannot be withdrawn in this release.
- Full repayment is required; partial repayment is not implemented.

## Verification

Judges can independently check:

- contract addresses and events in Coston2 Explorer;
- token bytecode and balances;
- FTSOv2 price and timestamp through QuietVault;
- FCC `/info` extension ID, code hash, platform, and public key;
- QuietVault `activeTeeSigner`, root, and sequence;
- the absence of debt, APR, health, and lender mandate fields in contract
  storage and events.
