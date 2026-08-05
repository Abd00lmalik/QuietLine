import { resolve } from "node:path";
import { Contract, JsonRpcProvider, Wallet, getAddress } from "ethers";
import {
  parseEnv,
  readJson,
  requireValue,
  root,
} from "./lib.mjs";

const rootEnv = parseEnv(resolve(root, ".env"));
const deployment = readJson(resolve(root, "deployments", "coston2.json"));
const privateKey = requireValue(
  rootEnv,
  "DEPLOYER_PRIVATE_KEY",
  /^0x[0-9a-fA-F]{64}$/u,
);
const rpcUrl = requireValue(
  rootEnv,
  "COSTON2_RPC_URL",
  /^https:\/\//u,
);
const staleTeeId = getAddress(
  requireValue(process.env, "STALE_TEE_ID", /^0x[0-9a-fA-F]{40}$/u),
);
const currentTeeId = getAddress(deployment.teeSigner);

if (staleTeeId === currentTeeId) {
  throw new Error("Refusing to pause the currently configured TEE signer");
}

const provider = new JsonRpcProvider(
  rpcUrl,
  { chainId: 114, name: "coston2" },
  { staticNetwork: true },
);
const wallet = new Wallet(privateKey, provider);
const manager = new Contract(
  deployment.infrastructure.flareTeeManager,
  [
    "function getTeeMachineOwner(address teeId) view returns (address)",
    "function getTeeMachineStatus(address teeId) view returns (uint8)",
    "function pause(address teeId)",
  ],
  wallet,
);
const owner = getAddress(await manager.getTeeMachineOwner(staleTeeId));

if (owner !== wallet.address) {
  throw new Error(`TEE ${staleTeeId} is owned by ${owner}, not the deployer`);
}

const status = Number(await manager.getTeeMachineStatus(staleTeeId));
if (status !== 2) {
  console.log(`TEE ${staleTeeId} is already inactive with status ${status}`);
  process.exit(0);
}

const transaction = await manager.pause(staleTeeId);
console.log(`Pause submitted: ${transaction.hash}`);
const receipt = await transaction.wait();
if (receipt.status !== 1) throw new Error("TEE pause transaction reverted");

const finalStatus = Number(await manager.getTeeMachineStatus(staleTeeId));
if (finalStatus === 2) throw new Error("TEE remains active after pause confirmation");
console.log(`TEE ${staleTeeId} paused in block ${receipt.blockNumber}`);
