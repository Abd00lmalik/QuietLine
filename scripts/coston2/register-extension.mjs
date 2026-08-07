import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { computeAddress } from "ethers";
import {
  parseEnv,
  readJson,
  requireValue,
  root,
  run,
  writeEnv,
  writeJson,
} from "./lib.mjs";

run("node", [resolve(root, "scripts", "coston2", "sync-fcc-tooling.mjs")]);

const rootEnv = parseEnv(resolve(root, ".env"));
const fccEnvPath = resolve(root, "fcc", ".env.coston2");
const fccEnv = parseEnv(fccEnvPath);
const relayerEnvPath = resolve(root, "relayer", ".env");
const relayerEnv = parseEnv(relayerEnvPath);
const privateKey = requireValue(
  rootEnv,
  "DEPLOYER_PRIVATE_KEY",
  /^0x[0-9a-fA-F]{64}$/u,
);
const deploymentPath = resolve(root, "deployments", "coston2.json");
const deployment = readJson(deploymentPath);
const vault = requireValue(
  { QUIET_VAULT: deployment.quietVault },
  "QUIET_VAULT",
  /^0x[0-9a-fA-F]{40}$/u,
);
const owner = computeAddress(privateKey);
const tooling = resolve(root, ".cache", "fce-extension-scaffold", "tools");
const addresses = resolve(root, "fcc", "coston2-addresses.json");
const output = run(
  "go",
  [
    "run",
    "./cmd/register-extension",
    "-a",
    addresses,
    "-c",
    rootEnv.COSTON2_RPC_URL,
    "--instructionSender",
    vault,
  ],
  {
    cwd: tooling,
    capture: true,
    env: { DEPLOYMENT_PRIVATE_KEY: privateKey.slice(2) },
  },
);
process.stdout.write(output);
const matches = output.match(/0x[0-9a-fA-F]{64}/gu);
if (!matches?.length) throw new Error("official FCC tooling did not return an extension ID");
const extensionBigInt = BigInt(matches.at(-1));
if (extensionBigInt > BigInt(Number.MAX_SAFE_INTEGER)) {
  throw new Error("FCC extension ID exceeds JavaScript's safe integer range");
}
deployment.extensionId = Number(extensionBigInt);
const extensionIdHex = `0x${extensionBigInt.toString(16).padStart(64, "0")}`;
writeJson(deploymentPath, deployment);

writeEnv(fccEnvPath, {
  ...fccEnv,
  EXTENSION_ID: extensionIdHex,
  INITIAL_OWNER: owner,
  GOVERNANCE_SIGNERS: owner,
  QUIET_VAULT: vault,
}, "Quietline real FCC deployment");
writeEnv(relayerEnvPath, {
  ...relayerEnv,
  QUIET_VAULT: vault,
  TEE_MANAGER: deployment.infrastructure.flareTeeManager,
  EXTENSION_ID: String(deployment.extensionId),
  START_BLOCK: String(deployment.startBlock),
}, "Quietline Coston2 relayer");
run("corepack", ["pnpm", "--filter", "@quietline/contracts", "set-extension:coston2"]);
console.log(`Registered and bound FCC extension ${deployment.extensionId}`);
