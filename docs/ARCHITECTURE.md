# Quietline Architecture

Quietline is an omnibus-vault credit market on Coston2. Public contracts hold
certified FXRP and USD₮0. Flare Confidential Compute (FCC) maintains the
private ledger, matches lender mandates, calculates debt and risk, and signs
sequential state settlements.

## System Map

```text
Browser wallet
    |
    | EIP-712 authorization + ECIES ciphertext
    v
React application ---> Fastify relayer/indexer ---> FCC tee-proxy
    |                         |                         |
    | ERC-20 approval         | durable SQLite jobs    | attested TEE
    | QuietVault calls        | settlement relay       | encrypted BoltDB
    v                         v                         |
Coston2 QuietVault <---- TEE-signed settlement <-------+
    |
    +--> certified FXRP / USD₮0 custody
    +--> FTSOv2 XRP/USD observation
    +--> FCC instruction dispatch through FlareTeeManager
```

## Components

### QuietVault

`QuietVault` is the custody and settlement boundary. It:

- accepts exact-transfer FXRP and USD₮0 deposits;
- emits FCC instructions for deposits, borrowing, withdrawals, risk ticks, and
  backstop funding;
- reads the XRP/USD FTSOv2 feed and rejects observations older than five minutes;
- executes only sequential settlements signed by the bound TEE key;
- rejects payouts above actual vault liquidity and applies the confidential
  collateral, lender-mandate, and protocol-risk checks before settlement;
- permits user withdrawals while borrow payouts are paused;
- binds its FCC extension ID and TEE signer only once.

The contract does not store user debt, lender mandates, health factors, loan
terms, or liquidation status.

### FCC Extension

The Go extension receives both chain instructions and authenticated direct
actions. It owns the authoritative private state:

- internal FXRP and USD₮0 balances;
- lender mandates and allocations;
- loan principal, accrued interest, tranches, maturity, health, and status;
- protocol reserve and liquidation backstop accounting;
- processed-operation identifiers;
- sequential state root and pending anchor.

State is serialized into BoltDB and encrypted using a 32-byte operator-provided
key. A mutation creates one pending anchor. No second mutation is accepted until
the previous root is settled on Coston2 and confirmed back to the extension.

### Relayer And Indexer

The relayer has three jobs:

1. authenticate browser sessions using EIP-712 challenges;
2. index exact `requestId` values from QuietVault events and submit them to FCC;
3. execute TEE-signed settlements and confirm the resulting root back to FCC.

SQLite stores jobs, attempts, responses, transaction hashes, and the Coston2
cursor. Restarting the process resumes unfinished jobs. A keeper submits a real
FTSO-backed risk tick every configured interval and never overlaps its own tick.

### Frontend

The React application never receives an FCC private key. It:

- creates an ephemeral response key for each private request;
- signs the request using the connected wallet;
- encrypts the signed request to the public key returned by FCC `/info`;
- decrypts the private response in browser memory;
- clears decrypted state when the session locks, expires, disconnects, or the
  connected wallet account changes.

## Transaction Flows

### Deposit

```text
User -> token.approve(QuietVault)
User -> QuietVault.deposit(token, amount, FCC fee)
QuietVault -> FlareTeeManager instruction(requestId)
Indexer -> FCC threshold result(requestId)
FCC -> private balance credit + pending state root
Relayer -> QuietVault.executeSettlement(checkpoint)
Relayer -> FCC ANCHOR_CONFIRMED
Browser -> encrypted ACCOUNT_QUERY
```

The deposit address, token, amount, and timing are public. Subsequent internal
use of the credited balance is private.

### Borrow

The quote request is a direct encrypted FCC action. FCC obtains a fresh FTSOv2
price from QuietVault, matches eligible private mandates, and returns an
encrypted quote. Acceptance is encrypted again and sent through
`QuietVault.requestBorrow`. FCC rechecks price, collateral, nonce, quote expiry,
and mandate availability before signing the USD₮0 payout.

### Repay

Repayment uses USD₮0 already deposited into QuietVault. FCC allocates
principal and lender interest privately, credits the protocol spread, releases
FXRP collateral, and anchors a zero-value checkpoint. The current hackathon
release supports full close only.

### Liquidation

The keeper requests a fresh FTSOv2 observation. FCC accrues interest and updates
all active loans. A liquidatable loan closes automatically when the private
backstop has enough USD₮0. Lenders receive principal and earned interest,
the protocol receives its spread, collateral is seized at the configured
discount, and the remaining collateral returns to the borrower. No liquidation
event identifies the borrower.

## Invariants

- One private mutation may be pending at a time.
- Every accepted operation identifier is processed at most once.
- Every settlement advances the root by exactly one sequence.
- Quotes reserve no liquidity and are revalidated at acceptance.
- Lender principal and interest are conserved on repayment and liquidation.
- On-chain payouts cannot exceed actual QuietVault liquidity.
- Borrowing is limited by collateral value, eligible private lender mandates,
  available liquidity, and protocol risk rules rather than a fixed amount cap.
- A quote may combine multiple lender tranches or return a smaller private
  partial fill when the full requested amount is unavailable.
- Only certified Coston2 FXRP and USD₮0 are supported.
