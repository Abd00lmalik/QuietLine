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
- C2FLR from the official Coston2 faucet;
- certified FXRP and testUSDT0 for borrower, lenders, and backstop;
- GCP Confidential Space access;
- a reachable Coston2 indexer database for tee-proxy;
- FCC extension and TEE-machine registration authority;
- DNS/TLS and hosting credentials.

## Deployment Order

1. Install dependencies and run the full test suite.
2. Fund deployer and relayer wallets with C2FLR.
3. Set root contract environment values from `.env.example`.
4. Deploy QuietPolicy and QuietVault:

   ```powershell
   corepack pnpm --filter @quietline/contracts deploy:coston2
   ```

   This writes `deployments/coston2.json` with extension ID and TEE signer unset.

5. Register the deployed QuietVault as the FCC instruction sender. Record the
   resulting public extension ID.
6. Build the extension image reproducibly. Use the commit timestamp for
   `SOURCE_DATE_EPOCH`.
7. Deploy the image on real GCP Confidential Space with `MODE=0` and
   `SIMULATED_TEE=false`.
8. Obtain the measured non-zero code hash, set the FCC environment values, and
   render the tee-proxy config:

   ```powershell
   corepack pnpm fcc:render-config
   docker compose -f fcc/docker-compose.coston2.yaml config --quiet
   ```

9. Launch tee-proxy and the workload. Expose proxy port 6664 through HTTPS.
10. Register and activate the real TEE machine through the official FCC
    registration flow.
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
