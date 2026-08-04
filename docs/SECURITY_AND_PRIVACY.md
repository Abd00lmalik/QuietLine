# Security And Privacy

## Privacy Boundary

Private inside FCC:

- internal user balances and available collateral;
- requested amount, maximum APR, quote, lender match, and lender identities;
- principal, interest, maturity, health factor, LTV, and liquidation price;
- lender mandate limits and allocation;
- repayment allocation and liquidation result.

Public on Coston2:

- wallet addresses calling QuietVault;
- token deposits, amounts, and timestamps;
- borrow payouts, withdrawal destinations, amounts, and timestamps;
- FCC instruction identifiers and state roots;
- QuietVault token holdings;
- keeper risk-tick transactions.

The TEE sees plaintext while processing. Quietline does not provide privacy
against the active confidential workload itself, its code, or a compromised
operator with access to workload secrets.

## Cryptographic Controls

- Wallet authorization: EIP-712 over chain ID 114, QuietVault, action, payload
  hash, nonce, deadline, and response public-key hash.
- Request confidentiality: secp256k1 ECIES compatible with Flare tee-node.
- Response confidentiality: one ephemeral browser response key per request.
- Settlement authorization: secp256k1 signature from the attested TEE node key.
- State at rest: encrypted BoltDB using AES-GCM with a 32-byte deployment key.
- State commitment: deterministic root anchored sequentially in QuietVault.

## Trust Model

The Summer Signal judging deployment trusts:

- one explicitly simulated FCC workload using the official Coston2 judging path;
- one tee-proxy deployment and its Coston2 indexer database connection;
- one relayer process and hot settlement/keeper wallet;
- one deployment administrator during initial extension and signer binding;
- FlareTeeManager, FTSOv2, Coston2 consensus, and certified test tokens.

The TEE signer becomes immutable after configuration. The admin cannot rotate it
without deploying a new QuietVault. This limits post-deployment signer
substitution but makes TEE loss a redeployment event.

## Contract Defenses

- SafeERC20 and exact balance-delta checks reject fee-on-transfer assets.
- Reentrancy guards cover custody and settlement paths.
- Unsupported tokens, zero amounts, stale oracle prices, sequence gaps,
  duplicate settlements, expired settlements, and wrong signatures revert.
- Borrow payouts stop while paused; user withdrawals remain available.
- The FCC extension ID and signer can each be configured only once.
- Borrow payout and daily outflow caps limit a compromised TEE.

## Known Risks

1. **Single TEE availability.** Loss of the TEE key or encrypted state requires
   recovery infrastructure or a new deployment.
2. **Single relayer availability.** Users cannot complete settlements while it
   is offline, although jobs persist and resume after restart.
3. **Hot relayer key.** The key pays gas and can submit risk ticks and valid
   signed settlements. It cannot forge a TEE signature.
4. **Admin setup trust.** Before signer binding, the admin could bind an
   incorrect key. The configure script derives the key from live `/info` to
   reduce this operational risk.
5. **Cross-tab nonce races.** Browser mutation serialization is tab-local.
6. **Public flow correlation.** Deposits and payouts can be correlated by timing
   and amount even though the private ledger does not expose the loan.
7. **No audit.** Contracts and confidential code are not production audited.

## Operational Security Requirements

- The hackathon deployment must use `MODE=1`, `SIMULATED_TEE=true`, and
  `allow_magic_pass=true`. These settings are accepted for Coston2 judging but
  provide no hardware-backed attestation.
- Never reuse this simulated configuration for production or real user funds.
- Keep `STATE_ENCRYPTION_KEY`, proxy key, direct API key, relayer key, session
  secret, and operations key in a secret manager.
- Use different values for every secret and environment.
- Restrict tee-proxy internal port 6663 to the workload network.
- Terminate public HTTPS before port 6664.
- Back up encrypted state and test recovery before accepting funds.
- Monitor relayer C2FLR balance, job failures, oracle age, root sequence, and
  FCC `/info` code hash.
