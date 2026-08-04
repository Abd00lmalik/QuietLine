import { resolve } from "node:path";
import { computeAddress } from "ethers";
import {
  isPlaceholder,
  parseEnv,
  root,
  run,
} from "./lib.mjs";

const rootEnv = parseEnv(resolve(root, ".env"));
const relayerEnv = parseEnv(resolve(root, "relayer", ".env"));
const fccEnv = parseEnv(resolve(root, "fcc", ".env.coston2"));
const checks = [];

async function rpc(method, params = []) {
  const response = await fetch(rootEnv.COSTON2_RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}

checks.push({
  name: "Coston2 RPC",
  status: (await rpc("eth_chainId")) === "0x72" ? "ready" : "failed",
});
for (const [name, address] of Object.entries({
  FlareTeeManager: "0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE",
  FTSOv2: "0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d",
  FXRP: "0x0b6A3645c240605887a5532109323A3E12273dc7",
  USDT0: "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F",
})) {
  checks.push({
    name,
    status: (await rpc("eth_getCode", [address, "latest"])) !== "0x" ? "ready" : "failed",
  });
}
const normalProxy = await fetch(`${fccEnv.NORMAL_PROXY_URL}/info`);
checks.push({ name: "Official FTDC proxy", status: normalProxy.ok ? "ready" : "failed" });

for (const [name, value] of [
  ["DEPLOYER_PRIVATE_KEY", rootEnv.DEPLOYER_PRIVATE_KEY],
  ["RELAYER_PRIVATE_KEY", relayerEnv.RELAYER_PRIVATE_KEY],
  ["FCC_PROXY_URL", fccEnv.EXT_PROXY_URL],
  ["FCC_CODE_HASH", fccEnv.FCC_CODE_HASH],
  ["INDEXER_DB_HOST", fccEnv.INDEXER_DB_HOST],
  ["INDEXER_DB_NAME", fccEnv.INDEXER_DB_NAME],
  ["INDEXER_DB_USER", fccEnv.INDEXER_DB_USER],
  ["INDEXER_DB_PASSWORD", fccEnv.INDEXER_DB_PASSWORD],
]) {
  checks.push({ name, status: isPlaceholder(value) ? "waiting" : "ready" });
}
const privateKeyPattern = /^0x[0-9a-fA-F]{64}$/u;
if (
  privateKeyPattern.test(rootEnv.DEPLOYER_PRIVATE_KEY ?? "") &&
  privateKeyPattern.test(relayerEnv.RELAYER_PRIVATE_KEY ?? "")
) {
  const deployer = computeAddress(rootEnv.DEPLOYER_PRIVATE_KEY);
  const relayer = computeAddress(relayerEnv.RELAYER_PRIVATE_KEY);
  checks.push({
    name: "Separate wallet roles",
    status: deployer.toLowerCase() !== relayer.toLowerCase() ? "ready" : "failed",
  });
  for (const [name, address] of [
    ["Deployer C2FLR", deployer],
    ["Relayer C2FLR", relayer],
  ]) {
    checks.push({
      name,
      status:
        BigInt(await rpc("eth_getBalance", [address, "latest"])) > 0n
          ? "ready"
          : "waiting",
    });
  }
}
checks.push({
  name: "Simulated judging mode",
  status:
    fccEnv.MODE === "1" && fccEnv.SIMULATED_TEE === "true"
      ? "ready"
      : "failed",
});
try {
  run("docker", ["info"], { capture: true });
  checks.push({ name: "Docker engine", status: "ready" });
} catch {
  checks.push({ name: "Docker engine", status: "waiting" });
}

console.table(checks);
if (checks.some((check) => check.status === "failed")) process.exitCode = 1;
