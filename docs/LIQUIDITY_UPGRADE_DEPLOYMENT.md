# Liquidity Upgrade — Staged Coston2 Deployment Runbook

Staged deployment of the uncommitted liquidity upgrade: Earn withdrawals of
unallocated mandate liquidity, automatic re-lending of repaid principal,
split Earn liquidity metrics, borrower partial-quote messaging, and the
FCC-side vault-liquidity pre-check that closes the UserWithdrawal
stranded-anchor risk.

This runbook is the **plan**. Nothing here has been executed. Every step that
touches production (host rebuild, Vercel, on-chain actions) requires operator
confirmation and is written to be reviewed before it runs.

---

## 0. What ships in this upgrade

| Change | Area | Files |
|---|---|---|
| Earn withdrawal of unallocated mandate liquidity | FCC ledger | `extension/internal/ledger/engine.go` (`Withdraw`, `mandatesByCreatedAt`) |
| Auto re-lend of repaid principal for active mandates | FCC ledger | `extension/internal/ledger/engine.go` (`distributeRepayment`) |
| Vault-liquidity pre-check for withdrawals (fail-closed, cached) | FCC extension | `extension/internal/extension/liquidity.go` (new), `handlers.go`, `extension.go` |
| Split Earn metrics (total / available / committed / withdrawable / interest) | Frontend | `frontend/src/pages/EarnPage.tsx`, `styles.css` |
| Partial-quote eligibility messaging | Frontend | `frontend/src/pages/BorrowPage.tsx` |
| Adversarial accounting tests (7) + withdrawable-bound test | Tests | `extension/internal/ledger/engine_test.go` |
| Liquidity cache + handler tests (6) | Tests | `extension/internal/extension/liquidity_test.go` (new) |

**No contract, relayer, deployment-config, matching-algorithm, or FCC
state-schema changes are part of this upgrade.** The relayer binary is rebuilt
only because the host stack is rebuilt as one compose project; its code is
unchanged.

---

## 1. Non-negotiable prerequisites

1. **Commit the working tree first.** `scripts/hosting/ssh-deploy.ps1` ships
   `git archive HEAD` — **uncommitted changes are NOT deployed**. The current
   diff (9 files: 5 FCC/frontend changes, 2 new extension files, 2 test files)
   must be committed and pushed before any deploy step runs.
2. **Do not change `TEE_SIGNING_KEY`, `STATE_ENCRYPTION_KEY`, the state
   volume, or the relayer SQLite volume.** The signer is derived from
   `TEE_SIGNING_KEY` (`extension/third_party/tee-node/internal/node/node.go`)
   and is bound immutably in QuietVault (`isAuthorizedTeeSigner`). A fresh
   signing key or a fresh host (new machine registration) rotates the signer
   and **breaks every settlement**. This is an in-place upgrade: same host,
   same env, same volumes.
3. **Confirm which compose profile is live before touching anything.** The
   repo contains two host profiles:
   - **ngrok profile** — project `fcc`, `/opt/quietline`, compose
     `docker-compose.coston2.yaml + docker-compose.ngrok.yaml +
     docker-compose.host.yaml`, env `fcc/.env.coston2` + `relayer/.env`,
     public ngrok domain (cutover script polls
     `https://speculate-ipod-harmful.ngrok-free.dev`).
   - **Caddy V2 profile** — project `quietline-v2`, `/opt/quietline-v2`,
     compose `docker-compose.coston2.yaml + docker-compose.v2-host.yaml`,
     env `fcc/.env.coston2-v2` + `.env.v2` + `relayer/.env.v2`, public
     `https://v2.43-157-63-199.sslip.io` (per `docs/OPERATIONS.md`).
   - The `hosting:ssh:*` scripts target the ngrok profile; OPERATIONS.md
     describes the Caddy profile. **Resolve this on the VM**
     (`docker compose ls`, `curl /api/health`, `/info`) before running any
     command in this runbook. All commands below use the profile you confirm.
4. **Recommended: bump the release version so the new binary is
   identifiable.** `config.Version` in `extension/internal/config/config.go`
   is `"0.1.1"` and the image tag in `scripts/coston2/build-images.mjs` is
   `quietline-extension:v0.1.1`. Bump both to `0.1.2` (a code change —
   `State.Version` stays `2`, so the state root and schema are untouched).
5. **Run the full local verification first** (Section 2) and re-run after any
   commit-triggered change.

---

## 2. Local verification (pre-flight)

```bash
# backend
cd extension
go test ./...
go vet ./...
# (recommended, needs a cgo-enabled host) go test -race ./...

# frontend + workspace
cd ..
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build:frontend

# compose validation (both profiles, on a host with a running Docker daemon)
corepack pnpm fcc:validate-compose-v2
docker compose --env-file .env --env-file fcc/.env.coston2 \
  -f fcc/docker-compose.coston2.yaml \
  -f fcc/docker-compose.ngrok.yaml \
  -f fcc/docker-compose.host.yaml config --quiet
```

Expected: all Go and frontend suites green (36 ledger tests incl. the 7
adversarial tests, 6 extension tests incl. the new liquidity/handler tests,
30 vitest tests), `go vet` clean, both compose files validate.

Note: the local Docker daemon was not running at the time of writing, so the
image build could not be executed here; it must be run by the operator on a
host with Docker available (or after starting Docker Desktop).

---

## 3. Commit and release prep

1. Commit the upgrade (all 8 changed/new files) with a clear message, e.g.
   `feat: withdraw unallocated Earn liquidity, auto re-lend repaid principal, harden withdrawal settlement`. Push to `main`.
2. Apply the version bump from prerequisite 4 in a **separate commit** so the
   release commit is easily identifiable:
   `chore(extension): version 0.1.2 for liquidity upgrade`.
3. Confirm `git log -1 --format=%ct` reflects the new commit (this feeds
   `SOURCE_DATE_EPOCH` for reproducible image builds in `prepare.mjs` /
   `build-images.mjs`).

---

## 4. Local image build (no production impact)

```bash
corepack pnpm image:extension   # quietline-extension:v0.1.2
corepack pnpm image:relayer     # quietline-relayer:v0.1.2
```

These only build local Docker images. The host builds its own images from the
archive during `hosting:ssh:deploy`, so this step is verification, not
transport. If the host build is used instead, ensure the compose
`image:`/tag references are updated to the new tags in the profile you
confirmed live (the ngrok profile pins `quietline-relayer:v0.1.0` in
`docker-compose.ngrok.yaml`; the V2 profile pins `quietline-relayer:v2`).

---

## 5. Host deploy (in-place, same host / same volumes)

For the profile you confirmed in prerequisite 3.

### 5a. ngrok profile (as wired to `hosting:ssh:*`)

```powershell
corepack pnpm hosting:ssh:deploy -- -HostName 43.157.63.199
```

This archives `HEAD`, uploads env files + proxy config, and rebuilds images on
the VM without stopping the running stack.

### 5b. Caddy V2 profile

If the Caddy profile is live, replicate the same archive + rebuild steps
against `/opt/quietline-v2` (or run the deploy with the V2 env files):
the mechanism is identical — upload `HEAD`, install env files with mode
`0600`, `docker compose ... config --quiet`, then `docker compose ... build`.

### 5c. Restart the extension (the actual cutover)

Only the extension workload must restart for this upgrade; the relayer restart
is incidental. On the VM, for the live profile:

```bash
cd /opt/quietline            # or /opt/quietline-v2
sudo docker compose <profile files and env files> up -d extension-tee relayer
```

**Critical constraints:**
- Same `TEE_SIGNING_KEY`, `STATE_ENCRYPTION_KEY`, and state volume
  (`fcc_quietline-private-state-v2` or `quietline-v2-private-state`). Never
  recreate/delete these volumes.
- Do **not** run `coston2:register-machine` / `coston2:retire-stale-machines`.
  Those are for host moves. The signer is derived from `TEE_SIGNING_KEY` and
  stays identical across the container recreation (verified in
  `tee-node/internal/node/node.go:Initialize`).
- Expect a brief pause in new mutations while the pending anchor settles and
  the extension restarts; `ErrAnchorPending` on the client is transient.

---

## 6. Verification gates (after restart)

| Gate | Check | Expected |
|---|---|---|
| Proxy reachable | `GET /info` on the public endpoint | HTTP 200; chain 114; extension 66008; **code hash/signature reflects new build**; signer unchanged from `deployments/coston2.json` `teeSigner` |
| Health | `GET /api/health` | `status: ok`; live signer == vault signer |
| Market | `GET /api/market` | vault USDT0 holdings and fresh FTSO price |
| Sequence | state endpoint / `/state` | root sequence advances after a test mutation |
| On-chain | relayer job logs | no `failed` jobs; anchors settle and confirm |
| Withdrawal | Earn UI → Withdraw on an unallocated mandate | success; payout settles; no stranded anchor |
| Re-lend | repay a borrower loan | lender mandate `Available` regains principal; next quote uses it |
| Committed guard | attempt to withdraw a committed mandate | refused with insufficient-balance/insufficient-liquidity error |

Then run the manual QA flows against the live frontend (deposit → mandate →
borrow → repay → withdrawal, plus a partial quote with the new eligibility
note), covering the Section 6 gates end-to-end.

---

## 7. Frontend redeploy (Vercel)

The frontend is a static Vite build served at `https://quietline.vercel.app`
(`vercel.json` builds with `pnpm build:frontend`).

- Mechanism A (Vercel git integration): pushing the release commit to the
  connected repo triggers the production build automatically. Verify the
  build succeeds and the deploy URL is promoted.
- Mechanism B (CLI): `vercel --prod` from the repo root (or `frontend/`)
  after `corepack pnpm build:frontend`.

`frontend/.env.production` (`VITE_RELAYER_URL`,
`VITE_FCC_INSTRUCTION_FEE_WEI`) is **unchanged** — the relayer URL does not
move in an in-place upgrade. Confirm the deployed bundle contains the new
Earn metrics band (Total supplied / Available to lend / Committed to loans /
Withdrawable balance) before announcing.

---

## 8. Announce the behavior change

Publish `docs/LENDER_UPGRADE_NOTICE.md` (testnet users). At minimum:

- Repaid principal now automatically returns to the lender's mandate and is
  lendable again — it no longer sits idle or requires re-activation.
- Unallocated mandate liquidity is withdrawable from Earn.
- Principal committed to active loans remains reserved and is never
  withdrawable until the loan repays.
- UI metrics now distinguish total supplied / available to lend / committed
  to loans / withdrawable / interest earned.

---

## 9. Rollback

An in-place code upgrade rolls back by redeploying the previous commit the
same way (archive + rebuild + restart), keeping env and volumes intact:

```bash
git checkout <previous-release-commit>
corepack pnpm hosting:ssh:deploy -- -HostName 43.157.63.199   # or V2 equivalent
sudo docker compose <profile files> up -d extension-tee relayer
```

- Rollback does not touch on-chain state; `stateRoot`/`stateSequence` keep
  advancing with the new code until the old image is back, which is fine —
  both binaries speak the same `State.Version 2` schema and the same anchor
  format.
- Frontend rollback = redeploy the previous frontend build on Vercel.
- If a withdrawal settlement ever reverts on-chain (only possible under
  external vault drain — the new pre-check makes FCC refuse upfront), the
  FCC anchor stalls by design and requires operator intervention; do not
  checkpoint-recover `WITHDRAW_REQUEST` anchors (that would finalize an
  unpaid debit).

---

## 10. Deployment checklist

- [ ] Full local verification green (Section 2) after final commits
- [ ] Working tree committed and pushed (deploy ships `git HEAD`)
- [ ] Version bump `config.Version` + image tag → `0.1.2`
- [ ] Live compose profile confirmed (ngrok `fcc` vs Caddy `quietline-v2`)
- [ ] `TEE_SIGNING_KEY` / `STATE_ENCRYPTION_KEY` / volumes confirmed unchanged
- [ ] Local image build (`image:extension`, `image:relayer`) succeeds
- [ ] Host archive + rebuild completes; `config --quiet` passes on the VM
- [ ] `up -d extension-tee relayer` without machine registration/retirement
- [ ] All Section 6 gates pass (signer unchanged, health ok, sequence advances)
- [ ] Manual QA (Section 6 gates end-to-end) passes on `quietline.vercel.app`
- [ ] Frontend redeployed and new Earn metrics visible
- [ ] `docs/LENDER_UPGRADE_NOTICE.md` published
