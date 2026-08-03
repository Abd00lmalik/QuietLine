import { ethers } from "hardhat";
import { readDeployment } from "./shared";

async function main() {
  const deployment = readDeployment("coston2");
  if (deployment.extensionId < 65_536) {
    throw new Error("deployments/coston2.json does not contain a public FCC extension ID");
  }
  const vault = await ethers.getContractAt("QuietVault", deployment.quietVault);
  const current = await vault.extensionId();
  if (current === BigInt(deployment.extensionId)) {
    console.log(`QuietVault already uses FCC extension ${deployment.extensionId}`);
    return;
  }
  if (current !== 0n) {
    throw new Error(
      `QuietVault already uses FCC extension ${current}; expected ${deployment.extensionId}`,
    );
  }
  const transaction = await vault.setExtensionId(deployment.extensionId);
  await transaction.wait();
  console.log(`QuietVault configured for FCC extension ${deployment.extensionId}: ${transaction.hash}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
