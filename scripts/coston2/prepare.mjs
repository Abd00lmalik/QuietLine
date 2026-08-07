import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { computeAddress } from "ethers";
import { isPlaceholder, parseEnv, root, secret, writeEnv } from "./lib.mjs";

const rpc = "https://coston2-api.flare.network/ext/C/rpc";
const frontendOrigin = "https://quietline.vercel.app";
const normalProxy = "https://tee-proxy-coston2-1.flare.rocks";
const simulatedCodeHash =
  "0x194844cf417dde867073e5ab7199fa4d21fd82b5dbe2bdea8b3d7fc18d10fdc2";
const sourceDateEpoch = execFileSync("git", ["log", "-1", "--format=%ct"], {
  cwd: root,
  encoding: "utf8",
}).trim();

const rootPath = resolve(root, ".env");
const relayerPath = resolve(root, "relayer", ".env");
const frontendPath = resolve(root, "frontend", ".env.production");
const fccPath = resolve(root, "fcc", ".env.coston2");
const existingRoot = parseEnv(rootPath);
const existingRelayer = parseEnv(relayerPath);
const existingFrontend = parseEnv(frontendPath);
const existingFcc = parseEnv(fccPath);
const privateKeyPattern = /^0x[0-9a-fA-F]{64}$/u;
const relayerAddress = privateKeyPattern.test(existingRelayer.RELAYER_PRIVATE_KEY ?? "")
  ? computeAddress(existingRelayer.RELAYER_PRIVATE_KEY)
  : "";

const operationsKey =
  existingRoot.OPERATIONS_API_KEY ??
  existingRelayer.OPERATIONS_API_KEY ??
  secret();
const directApiKey =
  existingRelayer.DIRECT_API_KEY ??
  existingFcc.DIRECT_API_KEY ??
  secret();

writeEnv(rootPath, {
  COSTON2_RPC_URL: rpc,
  DEPLOYER_PRIVATE_KEY:
    existingRoot.DEPLOYER_PRIVATE_KEY ?? "REPLACE_WITH_0X_64_HEX_PRIVATE_KEY",
  OPERATOR_ADDRESS:
    relayerAddress ||
    (/^0x[0-9a-fA-F]{40}$/u.test(existingRoot.OPERATOR_ADDRESS ?? "")
      ? existingRoot.OPERATOR_ADDRESS
      : ""),
  FCC_PROXY_URL:
    existingRoot.FCC_PROXY_URL ?? "REPLACE_WITH_STABLE_PUBLIC_FCC_PROXY_URL",
  RELAYER_URL:
    existingRoot.RELAYER_URL ?? "REPLACE_WITH_PUBLIC_RELAYER_URL",
  OPERATIONS_API_KEY: operationsKey,
  BACKSTOP_AMOUNT_USDT0: existingRoot.BACKSTOP_AMOUNT_USDT0 ?? "10",
  BACKSTOP_CONFIRMATION_TIMEOUT_MS:
    existingRoot.BACKSTOP_CONFIRMATION_TIMEOUT_MS ?? "900000",
}, "Quietline Coston2 contract deployment");

writeEnv(relayerPath, {
  PORT: existingRelayer.PORT ?? "8787",
  HOST: existingRelayer.HOST ?? "0.0.0.0",
  DATABASE_PATH: existingRelayer.DATABASE_PATH ?? "/data/relayer.db",
  SESSION_SECRET: existingRelayer.SESSION_SECRET ?? secret(),
  OPERATIONS_API_KEY: operationsKey,
  FCC_PROXY_URL:
    existingRelayer.FCC_PROXY_URL ?? "REPLACE_WITH_STABLE_PUBLIC_FCC_PROXY_URL",
  DIRECT_API_KEY: directApiKey,
  COSTON2_RPC_URL: rpc,
  QUIET_VAULT:
    existingRelayer.QUIET_VAULT ?? "PENDING_CONTRACT_DEPLOYMENT",
  TEE_MANAGER:
    existingRelayer.TEE_MANAGER ??
    "0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE",
  EXTENSION_ID:
    existingRelayer.EXTENSION_ID ?? "PENDING_EXTENSION_REGISTRATION",
  RELAYER_PRIVATE_KEY:
    existingRelayer.RELAYER_PRIVATE_KEY ?? "REPLACE_WITH_0X_64_HEX_PRIVATE_KEY",
  START_BLOCK: existingRelayer.START_BLOCK ?? "PENDING_CONTRACT_DEPLOYMENT",
  POLL_INTERVAL_MS: existingRelayer.POLL_INTERVAL_MS ?? "2000",
  RISK_TICK_INTERVAL_MS: existingRelayer.RISK_TICK_INTERVAL_MS ?? "60000",
  FCC_INSTRUCTION_FEE_WEI: existingRelayer.FCC_INSTRUCTION_FEE_WEI ?? "1000000",
  FRONTEND_ORIGIN: frontendOrigin,
  LOG_LEVEL: existingRelayer.LOG_LEVEL ?? "info",
}, "Quietline Coston2 relayer");

writeEnv(frontendPath, {
  VITE_RELAYER_URL:
    existingFrontend.VITE_RELAYER_URL ?? "REPLACE_WITH_PUBLIC_RELAYER_URL",
  VITE_FCC_INSTRUCTION_FEE_WEI:
    existingFrontend.VITE_FCC_INSTRUCTION_FEE_WEI ?? "1000000",
}, "Quietline Coston2 frontend");

writeEnv(fccPath, {
  CHAIN_URL: rpc,
  SOURCE_DATE_EPOCH: sourceDateEpoch,
  EXTENSION_ID: existingFcc.EXTENSION_ID ?? "PENDING_EXTENSION_REGISTRATION",
  INITIAL_OWNER: existingFcc.INITIAL_OWNER ?? "DERIVED_AFTER_DEPLOYER_KEY_IS_SET",
  GOVERNANCE_SIGNERS:
    existingFcc.GOVERNANCE_SIGNERS ?? "DERIVED_AFTER_DEPLOYER_KEY_IS_SET",
  GOVERNANCE_THRESHOLD: existingFcc.GOVERNANCE_THRESHOLD ?? "1",
  QUIET_VAULT: existingFcc.QUIET_VAULT ?? "PENDING_CONTRACT_DEPLOYMENT",
  STATE_ENCRYPTION_KEY: existingFcc.STATE_ENCRYPTION_KEY ?? secret(),
  PROXY_PRIVATE_KEY: existingFcc.PROXY_PRIVATE_KEY ?? secret(),
  DIRECT_API_KEY: directApiKey,
  FCC_CODE_HASH:
    isPlaceholder(existingFcc.FCC_CODE_HASH)
      ? simulatedCodeHash
      : existingFcc.FCC_CODE_HASH,
  INDEXER_DB_HOST:
    isPlaceholder(existingFcc.INDEXER_DB_HOST)
      ? "34.38.42.208"
      : existingFcc.INDEXER_DB_HOST,
  INDEXER_DB_PORT: existingFcc.INDEXER_DB_PORT ?? "3306",
  INDEXER_DB_NAME:
    isPlaceholder(existingFcc.INDEXER_DB_NAME)
      ? "indexer"
      : existingFcc.INDEXER_DB_NAME,
  INDEXER_DB_USER: existingFcc.INDEXER_DB_USER ?? "PENDING_FLARE_INDEXER_ACCESS",
  INDEXER_DB_PASSWORD:
    existingFcc.INDEXER_DB_PASSWORD ?? "PENDING_FLARE_INDEXER_ACCESS",
  NORMAL_PROXY_URL: normalProxy,
  EXT_PROXY_URL:
    existingFcc.EXT_PROXY_URL ?? "REPLACE_WITH_STABLE_PUBLIC_FCC_PROXY_URL",
  MODE: "1",
  SIMULATED_TEE: "true",
}, "Quietline Coston2 simulated judging deployment");

console.log("Prepared .env, relayer/.env, frontend/.env.production, and fcc/.env.coston2");
