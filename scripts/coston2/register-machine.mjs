import { resolve } from "node:path";
import {
  coston2DeploymentPath,
  parseEnv,
  readJson,
  requireValue,
  root,
  run,
  writeEnv,
} from "./lib.mjs";

run("node", [resolve(root, "scripts", "coston2", "sync-fcc-tooling.mjs")]);
const rootEnv = parseEnv(resolve(root, ".env"));
const fccEnv = parseEnv(resolve(root, "fcc", ".env.coston2"));
const privateKey = requireValue(
  rootEnv,
  "DEPLOYER_PRIVATE_KEY",
  /^0x[0-9a-fA-F]{64}$/u,
);
const proxyUrl = requireValue(fccEnv, "EXT_PROXY_URL", /^https:\/\//u);
const owner = requireValue(fccEnv, "INITIAL_OWNER", /^0x[0-9a-fA-F]{40}$/u);
requireValue(fccEnv, "EXTENSION_ID", /^0x[0-9a-fA-F]{64}$/u);
if (fccEnv.SIMULATED_TEE !== "true" || fccEnv.MODE !== "1") {
  throw new Error("Coston2 judging registration requires SIMULATED_TEE=true and MODE=1");
}

const tooling = resolve(root, ".cache", "fce-extension-scaffold", "tools");
const addresses = resolve(root, "fcc", "coston2-addresses.json");
const common = {
  cwd: tooling,
  env: {
    DEPLOYMENT_PRIVATE_KEY: privateKey.slice(2),
    EXTENSION_OWNER_KEY: privateKey.slice(2),
    INITIAL_OWNER: owner,
    GOVERNANCE_SIGNERS: fccEnv.GOVERNANCE_SIGNERS,
    GOVERNANCE_THRESHOLD: fccEnv.GOVERNANCE_THRESHOLD,
    SIMULATED_TEE: "true",
  },
};

const sleep = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

async function waitForStableProxy() {
  let consecutiveSuccesses = 0;
  let lastError;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await fetch(`${proxyUrl}/info`, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`proxy returned ${response.status}`);
      await response.arrayBuffer();
      consecutiveSuccesses += 1;
      if (consecutiveSuccesses >= 3) return;
    } catch (error) {
      consecutiveSuccesses = 0;
      lastError = error;
    }
    await sleep(2_000);
  }
  throw new Error(`FCC proxy did not stabilize: ${lastError}`);
}

async function runWithRetry(label, command, args, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return run(command, args, options);
    } catch (error) {
      lastError = error;
      if (attempt === 4) break;
      console.warn(`${label} failed on attempt ${attempt}; retrying in 10 seconds.`);
      await sleep(10_000);
      await waitForStableProxy();
    }
  }
  throw lastError;
}

await waitForStableProxy();
await runWithRetry("allow TEE version", "go", [
  "run", "./cmd/allow-tee-version",
  "-a", addresses,
  "-c", rootEnv.COSTON2_RPC_URL,
  "-p", proxyUrl,
  "-version", "quietline-v0.1.0",
], common);
await runWithRetry("set governance", "go", [
  "run", "./cmd/set-governance",
  "-a", addresses,
  "-c", rootEnv.COSTON2_RPC_URL,
  "-p", proxyUrl,
], common);
await runWithRetry("register TEE", "go", [
  "run", "./cmd/register-tee",
  "-a", addresses,
  "-c", rootEnv.COSTON2_RPC_URL,
  "-p", proxyUrl,
  "-h", proxyUrl,
  "-ep", fccEnv.NORMAL_PROXY_URL,
  "-state", resolve(root, ".cache", "register-tee.state"),
  "-command", "rRap",
], common);
await runWithRetry(
  "configure QuietVault",
  "corepack",
  ["pnpm", "--filter", "@quietline/contracts", "configure:coston2"],
  {
  env: { FCC_PROXY_URL: proxyUrl, SIMULATED_TEE: "true" },
  },
);
await runWithRetry(
  "verify QuietVault",
  "corepack",
  ["pnpm", "--filter", "@quietline/contracts", "verify:coston2"],
);
const deployment = readJson(coston2DeploymentPath());
const relayerEnvPath = resolve(root, "relayer", ".env");
writeEnv(relayerEnvPath, {
  ...parseEnv(relayerEnvPath),
  TEE_MANAGER: deployment.infrastructure.flareTeeManager,
  EXTENSION_ID: String(deployment.extensionId),
}, "Quietline Coston2 relayer");
run("node", [
  resolve(root, "scripts", "coston2", "retire-stale-machines.mjs"),
]);
