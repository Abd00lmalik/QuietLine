# Coston2 Deployment

This process uses the live Coston2 chain and the official FCC simulated-TEE
judging path. It does not claim hardware-backed confidentiality. Do not use
mock tokens, stale FCC contracts, rotating quick-tunnel URLs, or zero addresses.

## Fixed Network Inputs

- Chain ID: `114`
- RPC: `https://coston2-api.flare.network/ext/C/rpc`
- FlareTeeManager: `0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE`
- FTSOv2: `0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d`
- certified FXRP: `0x0b6A3645c240605887a5532109323A3E12273dc7`
- certified testUSDT0: `0x21709E63fC7F264F329e0826Ea82197694B82775`
- XRP/USD feed ID: `0x015852502f55534400000000000000000000000000`

## Manual Prerequisites

These cannot be automated without operator access:

- funded Coston2 deployer and relayer wallets;
- a stable named Cloudflare tunnel or reserved ngrok domain;
- faucet CAPTCHA completion.

## Official Test Assets

Use only the official Flare faucet:

`https://faucet.flare.network/coston2`

The faucet currently offers each address, once per 24 hours:

- `100 C2FLR` for transaction fees;
- `10 FXRP` at the certified FXRP address listed above;
- `10 USDT0` at the certified testUSDT0 address listed above.

Fund the deployer and relayer addresses with C2FLR. Fund the demo borrower with
C2FLR and FXRP. Fund the lender/backstop operator with C2FLR and USDT0. The
faucet submission requires its reCAPTCHA, so an operator must paste each
address, select the required assets, complete the challenge, and submit it.
No bridge or local mint is used.

## Private Configuration

Generate all non-wallet secrets and private environment files:

```powershell
corepack pnpm coston2:prepare
```

Place the deployer key in root `.env`:

```text
DEPLOYER_PRIVATE_KEY=0x<64 hexadecimal characters>
```

Place the relayer key in `relayer/.env`:

```text
RELAYER_PRIVATE_KEY=0x<64 hexadecimal characters>
```

The relayer must not reuse the deployer key. If both private files currently
contain the same unfunded key, generate a separate relayer wallet:

```powershell
corepack pnpm coston2:rotate-relayer-key
```

Never commit either file. The deployer becomes the initial administrator,
operator, extension owner, and one-of-one governance signer for the hackathon
deployment. The relayer wallet is a separate least-privilege transaction
sender and must hold only enough C2FLR for settlement gas.

Configure the private Coston2 indexer credentials:

```powershell
$env:INDEXER_DB_USER="<issued hackathon username>"
$env:INDEXER_DB_PASSWORD="<issued hackathon password>"
corepack pnpm coston2:configure-indexer
```

The script uses the current Coston2 indexer host `34.38.42.208`, port `3306`,
and database `indexer`. It never prints the credentials.

Run the machine-readable readiness check at any time:

```powershell
corepack pnpm coston2:preflight
```

## Deployment Order

1. Install dependencies, build the judging images, and run the full test suite:

   ```powershell
   corepack pnpm install --frozen-lockfile
   corepack pnpm image:all
   corepack pnpm check
   ```

2. Fund deployer and relayer wallets with C2FLR.
3. Set the two private keys in the generated files described above.
4. Deploy QuietPolicy and QuietVault:

   ```powershell
   corepack pnpm --filter @quietline/contracts deploy:coston2
   ```

   This writes `deployments/coston2.json` with extension ID and TEE signer unset.

5. Register the deployed QuietVault as the FCC instruction sender and bind the
   resulting public extension ID:

   ```powershell
   corepack pnpm coston2:register-extension
   ```

6. Render and validate the proxy configuration:

   ```powershell
   corepack pnpm fcc:render-config
   corepack pnpm fcc:validate-compose
   ```

7. Launch Redis, the current `tee-proxy` develop build, and the
   `tee-node v0.0.24` extension workload:

   ```powershell
   docker compose --env-file fcc/.env.coston2 -f fcc/docker-compose.coston2.yaml up -d --build
   ```

8. Expose proxy port `6664` through a stable named tunnel. Do not use a
   `trycloudflare.com` quick tunnel because its hostname changes after restart.
   For an account-bound ngrok domain, put `AUTH_TOKEN` in the ignored root
   `.env`, put the assigned hostname in `NGROK_DOMAIN` inside the ignored
   `fcc/.env.coston2`, and launch the durable tunnel service. The public
   gateway keeps the FCC proxy at the hostname root and exposes the relayer
   under `/api`:

   ```powershell
   corepack pnpm fcc:tunnel:up
   corepack pnpm fcc:tunnel:logs
   ```

   Once the public FCC proxy and relayer URLs exist, synchronize all private
   configuration files:

   ```powershell
   $env:FCC_PROXY_URL="https://fcc.example.org"
   $env:RELAYER_URL="https://relayer.example.org"
   corepack pnpm coston2:configure-hosting
   ```

9. Register and activate the simulated judging TEE machine with the pinned
   official Flare tooling:

    ```powershell
    corepack pnpm coston2:register-machine
    ```

    The script runs `allow-tee-version`, `set-governance`, and `register-tee`
    with `-command rRap`, then verifies the on-chain configuration.
10. Configure QuietVault from the simulated FCC identity:

    ```powershell
    corepack pnpm --filter @quietline/contracts configure:coston2
    ```

    The script reads `FCC_PROXY_URL/info`, verifies chain and extension IDs,
    derives the EVM signer address from the attested secp256k1 key, binds it
    once, and writes the measured code hash into the manifest.

11. Verify bytecode and configuration:

    ```powershell
    corepack pnpm --filter @quietline/contracts verify:coston2
    ```

12. Configure and start the relayer using `relayer/.env`.
13. Fund the private liquidation backstop.
14. Configure and deploy the frontend using `frontend/.env.production`.
15. Execute the live testnet runbook.

## Judging Boundary

The Summer Signal Coston2 judging deployment explicitly uses `MODE=1`,
`SIMULATED_TEE=true`, the simulated code hash, and `magic_pass` attestation.
The current Coston2 data providers still perform the availability check and
promote a correctly registered machine to `PRODUCTION`, but that on-chain
status does not turn simulated attestation into hardware-backed confidentiality.
Production use requires a separately reviewed Confidential Space deployment.

## Deployment Gates

Do not open the app to judges unless:

- `deployments/coston2.json` contains non-zero contract, signer, code-hash, and
  public extension values;
- `/info` reports chain 114, the same extension ID and key, `TEST_PLATFORM`,
  the official simulated code hash, and `magic_pass`;
- QuietVault `activeTeeSigner`, `extensionId`, FXRP, and testUSDT0 match the
  manifest;
- relayer `/health` is `ok`;
- FTSOv2 price is fresh;
- backstop funding is confirmed;
- one real deposit, private account query, and withdrawal have completed.
