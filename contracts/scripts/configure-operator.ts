import { config as loadEnv } from "dotenv";
import { Wallet } from "ethers";
import { ethers } from "hardhat";
import { resolve } from "node:path";
import { readDeployment } from "./shared";

loadEnv({ path: resolve(__dirname, "..", "..", "relayer", ".env"), quiet: true });

async function main() {
  const privateKey = process.env.RELAYER_PRIVATE_KEY;
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/u.test(privateKey)) {
    throw new Error("RELAYER_PRIVATE_KEY is required in relayer/.env");
  }

  const deployment = readDeployment("coston2");
  const vault = await ethers.getContractAt("QuietVault", deployment.quietVault);
  const relayer = new Wallet(privateKey).address;
  const operatorRole = await vault.OPERATOR_ROLE();

  if (await vault.hasRole(operatorRole, relayer)) {
    console.log(`Relayer ${relayer} already has QuietVault OPERATOR_ROLE`);
    return;
  }

  const transaction = await vault.grantRole(operatorRole, relayer);
  await transaction.wait();
  console.log(`Granted QuietVault OPERATOR_ROLE to relayer ${relayer}: ${transaction.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
