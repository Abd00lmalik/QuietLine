import { ethers } from "hardhat";
import { readDeployment, requireCode } from "./shared";

async function main() {
  const deployment = readDeployment("coston2-v2");
  await Promise.all([
    requireCode("QuietPolicy", deployment.quietPolicy),
    requireCode("QuietVault", deployment.quietVault),
    requireCode("FlareTeeManager", deployment.infrastructure.flareTeeManager),
    requireCode("FTSOv2", deployment.infrastructure.ftsoV2),
    requireCode("FXRP", deployment.assets.fxrp),
    requireCode("USDT0", deployment.assets.usdt0),
  ]);
  const vault = await ethers.getContractAt("QuietVault", deployment.quietVault);
  const checks = {
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    extensionId: Number(await vault.extensionId()),
    teeSigner: await vault.activeTeeSigner(),
    fxrp: await vault.fxrp(),
    usdt0: await vault.usdt0(),
    stateSequence: Number(await vault.stateSequence()),
    stateRoot: await vault.stateRoot(),
  };
  if (checks.chainId !== 114) throw new Error("deployment is not on Coston2");
  if (checks.extensionId !== deployment.extensionId || checks.extensionId < 65_536) {
    throw new Error("manifest extension ID does not match the configured vault");
  }
  if (checks.teeSigner.toLowerCase() !== deployment.teeSigner.toLowerCase()) {
    throw new Error("manifest TEE signer does not match the vault");
  }
  console.log(JSON.stringify({ status: "ok", ...checks }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
