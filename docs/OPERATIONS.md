# Operations

## Services

Production requires:

- a registered FCC extension workload;
- tee-proxy v0.0.21, Redis, and a reachable Coston2 indexer database;
- the Fastify relayer/indexer with persistent SQLite storage;
- the static frontend;
- deployed and configured Coston2 contracts.

## Always-On Coston2 Host

The hackathon deployment uses one Tencent Cloud Lighthouse VM in Frankfurt:

- public IP: `43.157.63.199`;
- machine: 2 vCPU, 4 GB RAM, and 2 GB swap;
- boot disk: 60 GB SSD;
- operating system: Ubuntu 24.04 x86-64 with Docker;
- public endpoint: the reserved ngrok domain already registered on-chain.

Provision and deploy:

The production FCC stack runs on a persistent x86-64 Ubuntu Docker host. For a
provider-neutral SSH deployment:

```powershell
corepack pnpm hosting:ssh:provision -- -HostName <server-ip>
corepack pnpm hosting:ssh:deploy -- -HostName <server-ip>
corepack pnpm hosting:ssh:cutover -- -HostName <server-ip>
```

The SSH cutover exports the confidential TEE state and relayer database, starts
the remote proxy and TEE behind the reserved ngrok domain, registers a fresh
machine, verifies it, pauses the previous machine, and only then starts the
remote relayer. If cutover fails before completion, the local stack is
restarted automatically.

The Coston2 deployment uses a 30-minute background risk-tick interval. Borrow
and quote actions still read the current FTSO price directly. Keep at least
`2 C2FLR` in the relayer wallet; the preflight check reports `waiting` below
that operational floor.

The deploy command transfers the three ignored environment files directly to
the VM and builds the pinned images while the local stack remains live. The
cutover command freezes local writes, transfers the real encrypted ledger and
relayer database volumes, starts the remote stack, registers its fresh TEE,
retires the previous machine, and requires the public `/api/health` endpoint
to return `ok`. Secret environment files are installed with mode `0600`; the
proxy config is mode `0640` for its non-root container group. None are added
to the deployment archive.

Redis uses append-only persistence, the extension uses
`quietline-private-state-v2`, and the relayer uses
`quietline-relayer-data`. Do not delete these Docker volumes.

Moving the extension workload to a new host creates a fresh simulated TEE
identity. The cutover command handles registration, QuietVault verification,
and stale-machine retirement in that order.

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

The code default is 60 seconds, while the live Coston2 deployment uses
30 minutes because a measured tick costs roughly `0.141 C2FLR` at the current
testnet gas price. The keeper runs once immediately after startup and prevents
overlapping ticks in one process. Run only one keeper-enabled relayer instance.
Each tick consumes C2FLR gas and the FCC instruction fee.

## Backstop

The protocol operator funds the real private backstop with certified USD₮0:

```powershell
corepack pnpm --filter @quietline/contracts fund-backstop:coston2
```

The script checks operator role and balance, approves the exact amount, submits
the Coston2 transaction, captures its request ID, and waits for that exact
relayer job to reach `confirmed`.

Backstop assets are locked in the hackathon release. There is no operator
withdrawal path. This deliberately prevents an operator from removing
liquidation coverage after users borrow.
