# Coston2 Deployment

This process is live-only. Do not substitute local registries, mock tokens,
simulated attestation, or zero addresses.

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
- GCP Confidential Space access;
- a reachable Coston2 indexer database for tee-proxy;
- FCC extension and TEE-machine registration authority;
- DNS/TLS and hosting credentials.

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

Never commit either file. The deployer becomes the initial administrator,
operator, extension owner, and one-of-one governance signer for the hackathon
deployment. The relayer wallet is a separate least-privilege transaction
sender and must hold only enough C2FLR for settlement gas.

Run the machine-readable readiness check at any time:

```powershell
corepack pnpm coston2:preflight
```

## Deployment Order

1. Install dependencies, build production images, and run the full test suite:

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

6. Build the extension image reproducibly. Use the commit timestamp for
   `SOURCE_DATE_EPOCH`.
7. Deploy the image on real GCP Confidential Space with `MODE=0` and
   `SIMULATED_TEE=false`.
8. Obtain the measured non-zero code hash and Coston2 indexer database
   credentials from Flare. Set `FCC_CODE_HASH` and every `INDEXER_DB_*` value
   in `fcc/.env.coston2`, then render and validate the tee-proxy configuration:

   ```powershell
   corepack pnpm fcc:render-config
   corepack pnpm fcc:validate-compose
   ```

9. Launch tee-proxy and the workload. Expose proxy port 6664 through HTTPS.
   Once the public FCC proxy and relayer URLs exist, synchronize all private
   configuration files:

   ```powershell
   $env:FCC_PROXY_URL="https://fcc.example.org"
   $env:RELAYER_URL="https://relayer.example.org"
   corepack pnpm coston2:configure-hosting
   ```

10. Register and activate the real TEE machine with the pinned official Flare
    tooling:

    ```powershell
    corepack pnpm coston2:register-machine
    ```

    The script runs `allow-tee-version`, `set-governance`, and `register-tee`
    with real-attestation mode and then verifies the on-chain configuration.
11. Configure QuietVault from live attestation:

    ```powershell
    corepack pnpm --filter @quietline/contracts configure:coston2
    ```

    The script reads `FCC_PROXY_URL/info`, verifies chain and extension IDs,
    derives the EVM signer address from the attested secp256k1 key, binds it
    once, and writes the measured code hash into the manifest.

12. Verify bytecode and configuration:

    ```powershell
    corepack pnpm --filter @quietline/contracts verify:coston2
    ```

13. Configure and start the relayer using `relayer/.env.example`.
14. Fund the private liquidation backstop.
15. Configure and deploy the frontend using `frontend/.env.example`.
16. Execute the live testnet runbook.

## Infrastructure Boundary

The public FCC guide exposes a simulated-TEE path, but this deployment forbids
it. A real deployment requires GCP Confidential Space, a measured
`GCP_AMD_SEV` workload with debug disabled, and Coston2 indexer database
credentials issued through Flare support. These are account-controlled
resources: they cannot be derived from RPC, faucet, source code, or the public
FTDC proxy. Do not set `allow_magic_pass`, `MODE=1`, or
`SIMULATED_TEE=true` to bypass this boundary.

## Deployment Gates

Do not open the app to judges unless:

- `deployments/coston2.json` contains non-zero contract, signer, code-hash, and
  public extension values;
- `/info` reports chain 114, the same extension ID and key, a real platform, and
  a non-simulated code hash;
- QuietVault `activeTeeSigner`, `extensionId`, FXRP, and testUSDT0 match the
  manifest;
- relayer `/health` is `ok`;
- FTSOv2 price is fresh;
- backstop funding is confirmed;
- one real deposit, private account query, and withdrawal have completed.
