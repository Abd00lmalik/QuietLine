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
const rpcUrl = requireValue(rootEnv, "COSTON2_RPC_URL", /^https:\/\//u);
const expectedSigner = getAddress(deployment.teeSigner);
const provider = new JsonRpcProvider(
  rpcUrl,
  { chainId: 114, name: "coston2" },
  { staticNetwork: true },
);
const wallet = new Wallet(privateKey, provider);
const manager = new Contract(
  deployment.infrastructure.flareTeeManager,
  [
    "function getActiveTeeMachines(uint256 extensionId) view returns (address[])",
    "function getTeeMachineOwner(address teeId) view returns (address)",
    "function pause(address teeId)",
  ],
  wallet,
);

const active = (await manager.getActiveTeeMachines(deployment.extensionId)).map(
  getAddress,
);
if (!active.includes(expectedSigner)) {
  throw new Error(
    `Configured signer ${expectedSigner} is not active for extension ${deployment.extensionId}`,
  );
}

for (const teeId of active) {
  if (teeId === expectedSigner) continue;
  const owner = getAddress(await manager.getTeeMachineOwner(teeId));
  if (owner !== wallet.address) {
    throw new Error(
      `Unexpected active TEE ${teeId} is owned by ${owner}; refusing an unsafe cutover`,
    );
  }
  const transaction = await manager.pause(teeId);
  console.log(`Pausing stale TEE ${teeId}: ${transaction.hash}`);
  const receipt = await transaction.wait();
  if (receipt.status !== 1) throw new Error(`Could not pause stale TEE ${teeId}`);
}

const remaining = (
  await manager.getActiveTeeMachines(deployment.extensionId)
).map(getAddress);
if (remaining.length !== 1 || remaining[0] !== expectedSigner) {
  throw new Error(
    `Extension ${deployment.extensionId} must have exactly one active TEE; found ${remaining.join(", ") || "none"}`,
  );
}
console.log(
  `Extension ${deployment.extensionId} has one active TEE: ${expectedSigner}`,
);
