import "@nomicfoundation/hardhat-ethers";
import "@nomicfoundation/hardhat-chai-matchers";
import { config as loadEnv } from "dotenv";
import { HardhatUserConfig } from "hardhat/config";
import { resolve } from "node:path";

loadEnv({ path: resolve(__dirname, "..", ".env"), quiet: true });

const deployerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
const coston2Accounts =
  deployerPrivateKey && /^0x[0-9a-fA-F]{64}$/u.test(deployerPrivateKey)
    ? [deployerPrivateKey]
    : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: { optimizer: { enabled: true, runs: 500 }, viaIR: true },
  },
  networks: {
    localhost: {
      url: process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545",
      chainId: 31337,
    },
    coston2: {
      url: process.env.COSTON2_RPC_URL ?? "https://coston2-api.flare.network/ext/C/rpc",
      chainId: 114,
      accounts: coston2Accounts,
    },
  },
};

export default config;
