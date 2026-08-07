import { computeAddress } from "ethers";
import { execFileSync } from "node:child_process";
import {
  coston2DeploymentPath,
  parseEnv,
  readJson,
  root,
  secret,
  writeEnv,
} from "./lib.mjs";
import { resolve } from "node:path";

const rpc = "https://coston2-api.flare.network/ext/C/rpc";
const publicDomain =
  process.env.V2_PUBLIC_DOMAIN ?? "v2.43-157-63-199.sslip.io";
const publicUrl = `https://${publicDomain}`;
const sourceDateEpoch = execFileSync("git", ["log", "-1", "--format=%ct"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const deployment = readJson(coston2DeploymentPath());
if (deployment.protocolVersion !== 2 || !deployment.quietVault) {
  throw new Error("deployments/coston2-v2.json is not a deployed V2 manifest");
}

const currentRoot = parseEnv(resolve(root, ".env"));
const currentRelayer = parseEnv(resolve(root, "relayer", ".env"));
const currentFcc = parseEnv(resolve(root, "fcc", ".env.coston2"));
const deployerKey = currentRoot.DEPLOYER_PRIVATE_KEY;
const relayerKey = currentRelayer.RELAYER_PRIVATE_KEY;
if (!/^0x[0-9a-fA-F]{64}$/u.test(deployerKey ?? "")) {
  throw new Error("The current root .env does not contain DEPLOYER_PRIVATE_KEY");
}
if (!/^0x[0-9a-fA-F]{64}$/u.test(relayerKey ?? "")) {
  throw new Error("The current relayer .env does not contain RELAYER_PRIVATE_KEY");
}

const deployer = computeAddress(deployerKey);
const relayer = computeAddress(relayerKey);
const operationsKey = secret();
const directApiKey = secret();

writeEnv(resolve(root, ".env.v2"), {
  COSTON2_RPC_URL: rpc,
  DEPLOYER_PRIVATE_KEY: deployerKey,
  OPERATOR_ADDRESS: relayer,
  FCC_PROXY_URL: publicUrl,
  RELAYER_URL: `${publicUrl}/api`,
  OPERATIONS_API_KEY: operationsKey,
  V2_PUBLIC_DOMAIN: publicDomain,
  V2_PUBLIC_URL: publicUrl,
  BACKSTOP_AMOUNT_USDT0: "10",
  BACKSTOP_CONFIRMATION_TIMEOUT_MS: "900000",
}, "Quietline Coston2 V2 contract deployment");

writeEnv(resolve(root, "fcc", ".env.coston2-v2"), {
  CHAIN_URL: rpc,
  SOURCE_DATE_EPOCH: sourceDateEpoch,
  EXTENSION_ID: String(deployment.extensionId ?? 0),
  INITIAL_OWNER: deployer,
  GOVERNANCE_SIGNERS: deployer,
  GOVERNANCE_THRESHOLD: "1",
  QUIET_VAULT: deployment.quietVault,
  STATE_ENCRYPTION_KEY: secret(),
  PROXY_PRIVATE_KEY: secret(),
  DIRECT_API_KEY: directApiKey,
  FCC_CODE_HASH:
    "0x194844cf417dde867073e5ab7199fa4d21fd82b5dbe2bdea8b3d7fc18d10fdc2",
  INDEXER_DB_HOST: currentFcc.INDEXER_DB_HOST,
  INDEXER_DB_PORT: currentFcc.INDEXER_DB_PORT,
  INDEXER_DB_NAME: currentFcc.INDEXER_DB_NAME,
  INDEXER_DB_USER: currentFcc.INDEXER_DB_USER,
  INDEXER_DB_PASSWORD: currentFcc.INDEXER_DB_PASSWORD,
  NORMAL_PROXY_URL: "https://tee-proxy-coston2-1.flare.rocks",
  EXT_PROXY_URL: publicUrl,
  MODE: "1",
  SIMULATED_TEE: "true",
  V2_PUBLIC_DOMAIN: publicDomain,
}, "Quietline Coston2 V2 simulated FCC deployment");

writeEnv(resolve(root, "relayer", ".env.v2"), {
  PORT: "8787",
  HOST: "0.0.0.0",
  DATABASE_PATH: "/data/relayer-v2.db",
  SESSION_SECRET: secret(),
  OPERATIONS_API_KEY: operationsKey,
  FCC_PROXY_URL: "http://tee-proxy:6664",
  DIRECT_API_KEY: directApiKey,
  COSTON2_RPC_URL: rpc,
  QUIET_VAULT: deployment.quietVault,
  TEE_MANAGER:
    "0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE",
  EXTENSION_ID: String(deployment.extensionId ?? 0),
  RELAYER_PRIVATE_KEY: relayerKey,
  START_BLOCK: String(deployment.startBlock),
  POLL_INTERVAL_MS: "2000",
  RISK_TICK_INTERVAL_MS: "60000",
  FCC_INSTRUCTION_FEE_WEI: "1000000",
  FRONTEND_ORIGIN: "https://quietline.vercel.app",
  LOG_LEVEL: "info",
}, "Quietline Coston2 V2 relayer");

console.log(`Prepared isolated V2 profiles for ${publicUrl}`);
