# Quietline

**Private credit, settled on Flare.**

Quietline is a live-only Coston2 confidential credit market. Borrowers deposit
certified FXRP and borrow certified USD₮0 against lender mandates evaluated
inside Flare Confidential Compute. Debt, terms, lender allocation, health, and
liquidation remain in the confidential ledger. Deposits, payouts, withdrawals,
addresses, and timing remain public.

There is no mock action path, mock token path, or fake market data in the
deployed application. The FCC workload uses Flare's official Coston2
`SIMULATED_TEE=true`, `MODE=1` judging configuration; contracts, assets,
instructions, registrations, settlements, and oracle reads are real Coston2
integrations.

## Repository

- `contracts`: QuietVault custody, policy, FCC instructions, and settlements.
- `extension`: Go confidential ledger and deterministic credit engine.
- `relayer`: authenticated API, durable job orchestration, indexer, and keeper.
- `frontend`: landing page and lending application.
- `packages/protocol`: shared Coston2 constants and schemas.
- `fcc`: Coston2 FCC extension, tee-proxy, Redis, gateway, and host package.
- `docs`: architecture, security, operations, deployment, and judge runbooks.

## Fixed Coston2 Assets

- FXRP: `0x0b6A3645c240605887a5532109323A3E12273dc7`
- USD₮0: `0xC1A5B41512496B80903D1f32d6dEa3a73212E71F`
- FTSOv2: `0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d`
- FlareTeeManager: `0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE`

## Development Checks

```powershell
corepack pnpm install
corepack pnpm typecheck
corepack pnpm test
cd extension
go test ./...
go vet ./...
```

Local contract mocks exist only as isolated unit-test fixtures. They are not
used by the frontend, relayer, FCC release image, or Coston2 deployment scripts.

## Deployment

Start with [Coston2 deployment](docs/DEPLOYMENT_COSTON2.md). A real deployment
requires funded wallets, the public Coston2 FCC manager, the Coston2 indexer
database, and a persistent x86-64 Docker host. The hackathon deployment uses
the official simulated-TEE judging mode and stops rather than falling back to
placeholder addresses, fake tokens, or a mock confidential service.

### Vercel Frontend

The repository includes a root `vercel.json` for the pnpm monorepo. Import the
repository into Vercel with the **Root Directory set to the repository root**,
not `frontend`. The configuration builds only `@quietline/frontend`, publishes
its shared `@quietline/protocol` dependency first, publishes `frontend/dist`,
and sends browser routes such as `/app/borrow` to the Vite entry point.

Set these Vercel environment variables for Production, Preview, and
Development:

```text
VITE_RELAYER_URL=https://YOUR-PUBLIC-RELAYER
VITE_FCC_INSTRUCTION_FEE_WEI=1000000
```

`VITE_RELAYER_URL` must be the public HTTPS origin of the separately hosted
Quietline relayer. Do not add a trailing slash. The relayer must set
`FRONTEND_ORIGIN` to the production Vercel origin so browser requests pass its
CORS policy.

Vercel hosts the static React frontend only. The persistent Fastify relayer,
SQLite job store, chain indexer, risk keeper, FCC proxy, and Confidential Space
workload must run on long-lived infrastructure.

The live hackathon deployment uses:

- frontend: `https://quietline.vercel.app`;
- V2 FCC and relayer gateway: `https://v2.43-157-63-199.sslip.io`;
- QuietVault V2: `0x1C53d0188bA554A23242A2822daBaB802698D511`;
- FCC extension V2: `66008`.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Security and privacy](docs/SECURITY_AND_PRIVACY.md)
- [Operations](docs/OPERATIONS.md)
- [Coston2 deployment](docs/DEPLOYMENT_COSTON2.md)
- [Live testnet runbook](docs/LIVE_TESTNET_RUNBOOK.md)
- [Judge guide](docs/JUDGE_GUIDE.md)
- [Known limitations](docs/KNOWN_LIMITATIONS.md)

Quietline is a testnet hackathon application and has not been audited for
production funds.
