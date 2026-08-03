# Operations

## Services

Production requires:

- a real Confidential Space extension workload;
- tee-proxy v0.0.21, Redis, and a reachable Coston2 indexer database;
- the Fastify relayer/indexer with persistent SQLite storage;
- the static frontend;
- deployed and configured Coston2 contracts.

## Relayer Lifecycle

Build and start:

```powershell
corepack pnpm --filter @quietline/relayer build
corepack pnpm --filter @quietline/relayer start
```

The relayer refuses to start without all security-sensitive configuration.
Persist `DATABASE_PATH` on durable storage. Do not delete the SQLite database
while live instructions exist.

Health endpoints:

- `GET /health`: API, database, and FCC reachability.
- `GET /market`: real QuietVault testUSDT0 holdings and FTSOv2 XRP/USD.
- `GET /attestation`: FCC proxy information.
- `GET /operations/job?externalKey=chain:<requestId>`: protected exact job
  status for deployment automation.

## Monitoring

Alert on:

- `/health` degraded for more than two polling intervals;
- any durable job in `failed`;
- no root sequence advance after a known mutation;
- FTSOv2 age approaching 300 seconds;
- relayer wallet C2FLR below the operator threshold;
- tee-proxy `/info` code hash, extension ID, chain ID, or public key change;
- encrypted state volume errors;
- keeper transaction failures.

## Failure Recovery

Relayer restart:

1. keep the same SQLite volume and private key;
2. restart the process;
3. verify the cursor and unfinished jobs resume;
4. inspect failed jobs before retrying.

FCC restart:

1. mount the same encrypted state volume;
2. supply the same `STATE_ENCRYPTION_KEY`;
3. verify `/info` still exposes the signer bound in QuietVault;
4. confirm the private sequence and on-chain sequence agree;
5. resume the relayer.

Pending anchor:

The extension rejects new mutations until the pending anchor is settled and
confirmed. Restore the relayer first. Do not alter the private database.

TEE key loss:

The signer is immutable. Pause borrow payouts, preserve withdrawal evidence,
and deploy a new vault/extension. This is a known hackathon limitation.

## Keeper

The keeper submits `requestRiskTick()` every 60 seconds by default. It prevents
overlapping ticks in one process. Run only one keeper-enabled relayer instance
for the hackathon release. Each tick consumes C2FLR gas and the FCC instruction
fee.

## Backstop

The protocol operator funds the real private backstop with certified
testUSDT0:

```powershell
corepack pnpm --filter @quietline/contracts fund-backstop:coston2
```

The script checks operator role and balance, approves the exact amount, submits
the Coston2 transaction, captures its request ID, and waits for that exact
relayer job to reach `confirmed`.

Backstop assets are locked in the hackathon release. There is no operator
withdrawal path. This deliberately prevents an operator from removing
liquidation coverage after users borrow.
