import { resolve } from "node:path";
import { Contract, JsonRpcProvider, computeAddress, concat } from "ethers";
import {
  coston2DeploymentPath,
  deploymentProfilePaths,
  parseEnv,
  readJson,
  requireValue,
  root,
  run,
  writeEnv,
} from "./lib.mjs";

run("node", [resolve(root, "scripts", "coston2", "sync-fcc-tooling.mjs")]);
const profilePaths = deploymentProfilePaths();
const rootEnv = parseEnv(profilePaths.rootEnv);
const fccEnv = parseEnv(profilePaths.fccEnv);
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

async function machineIdentity() {
  const response = await fetch(`${proxyUrl}/info`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`proxy returned ${response.status}`);
  const info = await response.json();
  const publicKey = info.machineData?.publicKey ?? info.teeInfo?.publicKey;
  if (!publicKey?.x || !publicKey?.y) {
    throw new Error("FCC proxy info does not contain the TEE public key");
  }
  return computeAddress(concat(["0x04", publicKey.x, publicKey.y]));
}

async function machineIsProduction() {
  const teeId = await machineIdentity();
  const provider = new JsonRpcProvider(
    rootEnv.COSTON2_RPC_URL,
    { chainId: 114, name: "coston2" },
    { staticNetwork: true },
  );
  const manager = new Contract(
    readJson(addresses).FlareTeeManager,
    ["function getTeeMachineStatus(address teeId) view returns (uint8)"],
    provider,
  );
  let status;
  try {
    status = Number(await manager.getTeeMachineStatus(teeId));
  } catch (error) {
    if (error?.code !== "CALL_EXCEPTION") throw error;
    status = 0;
  }
  return {
    teeId,
    production: status === 2,
  };
}

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
const existingMachine = await machineIsProduction();
if (existingMachine.production) {
  console.log(`TEE ${existingMachine.teeId} is already in production; skipping registration.`);
} else {
  try {
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
  } catch (error) {
    const finalMachine = await machineIsProduction();
    if (!finalMachine.production) throw error;
    console.warn(
      `Registration command reported an error after ${finalMachine.teeId} reached production; continuing.`,
    );
  }
}
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
const relayerEnvPath = profilePaths.relayerEnv;
writeEnv(relayerEnvPath, {
  ...parseEnv(relayerEnvPath),
  TEE_MANAGER: deployment.infrastructure.flareTeeManager,
  EXTENSION_ID: String(deployment.extensionId),
}, "Quietline Coston2 relayer");
run("node", [
  resolve(root, "scripts", "coston2", "retire-stale-machines.mjs"),
]);
