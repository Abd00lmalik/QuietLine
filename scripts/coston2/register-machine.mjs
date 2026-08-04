import { resolve } from "node:path";
import {
  parseEnv,
  requireValue,
  root,
  run,
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
requireValue(fccEnv, "EXTENSION_ID", /^\d+$/u);
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
run("go", [
  "run", "./cmd/allow-tee-version",
  "-a", addresses,
  "-c", rootEnv.COSTON2_RPC_URL,
  "-p", proxyUrl,
  "-version", "quietline-v0.1.0",
], common);
run("go", [
  "run", "./cmd/set-governance",
  "-a", addresses,
  "-c", rootEnv.COSTON2_RPC_URL,
  "-p", proxyUrl,
], common);
run("go", [
  "run", "./cmd/register-tee",
  "-a", addresses,
  "-c", rootEnv.COSTON2_RPC_URL,
  "-p", proxyUrl,
  "-h", proxyUrl,
  "-ep", fccEnv.NORMAL_PROXY_URL,
  "-state", resolve(root, ".cache", "register-tee.state"),
  "-command", "rRap",
], common);
run("corepack", ["pnpm", "--filter", "@quietline/contracts", "configure:coston2"], {
  env: { FCC_PROXY_URL: proxyUrl, SIMULATED_TEE: "true" },
});
run("corepack", ["pnpm", "--filter", "@quietline/contracts", "verify:coston2"]);
