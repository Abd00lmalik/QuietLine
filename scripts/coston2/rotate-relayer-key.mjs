import { resolve } from "node:path";
import { Wallet } from "ethers";
import { parseEnv, root, writeEnv } from "./lib.mjs";

const path = resolve(root, "relayer", ".env");
const current = parseEnv(path);
const wallet = Wallet.createRandom();

writeEnv(path, {
  ...current,
  RELAYER_PRIVATE_KEY: wallet.privateKey,
}, "Quietline Coston2 relayer");

console.log(`Generated a separate unfunded relayer wallet: ${wallet.address}`);
