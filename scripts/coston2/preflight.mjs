import { resolve } from "node:path";
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
  USDT0: "0x21709E63fC7F264F329e0826Ea82197694B82775",
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
]) {
  checks.push({ name, status: isPlaceholder(value) ? "waiting" : "ready" });
}
try {
  run("docker", ["info"], { capture: true });
  checks.push({ name: "Docker engine", status: "ready" });
} catch {
  checks.push({ name: "Docker engine", status: "waiting" });
}

console.table(checks);
if (checks.some((check) => check.status === "failed")) process.exitCode = 1;
