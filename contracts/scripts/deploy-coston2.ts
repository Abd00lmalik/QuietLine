import { ethers } from "hardhat";
import {
  COSTON2_ADDRESSES,
  requireCode,
  requiredAddress,
  writeDeployment,
} from "./shared";

async function main() {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error(
      "DEPLOYER_PRIVATE_KEY is required and must belong to a funded Coston2 wallet",
    );
  }
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 114n) {
    throw new Error(`expected Coston2 chain 114, got ${network.chainId}`);
  }
  const operator = process.env.OPERATOR_ADDRESS
    ? requiredAddress("OPERATOR_ADDRESS")
    : deployer.address;

  await Promise.all([
    requireCode("FlareTeeManager", COSTON2_ADDRESSES.flareTeeManager),
    requireCode("FTSOv2", COSTON2_ADDRESSES.ftsoV2),
    requireCode("FXRP", COSTON2_ADDRESSES.fxrp),
    requireCode("USDT0", COSTON2_ADDRESSES.usdt0),
  ]);

  const Policy = await ethers.getContractFactory("QuietPolicy");
  const policy = await Policy.deploy();
  await policy.waitForDeployment();
  const Vault = await ethers.getContractFactory("QuietVault");
  const vault = await Vault.deploy(
    COSTON2_ADDRESSES.flareTeeManager,
    COSTON2_ADDRESSES.flareTeeManager,
    COSTON2_ADDRESSES.ftsoV2,
    COSTON2_ADDRESSES.xrpUsdFeedId,
    COSTON2_ADDRESSES.fxrp,
    COSTON2_ADDRESSES.usdt0,
    deployer.address,
    operator,
  );
  const receipt = await vault.deploymentTransaction()!.wait();

  const path = writeDeployment({
    network: "coston2",
    chainId: 114,
    protocolVersion: 2,
    quietPolicy: await policy.getAddress(),
    quietVault: await vault.getAddress(),
    extensionId: 0,
    teeSigner: ethers.ZeroAddress,
    codeHash: process.env.FCC_CODE_HASH ?? ethers.ZeroHash,
    startBlock: receipt!.blockNumber,
    infrastructure: {
      flareTeeManager: COSTON2_ADDRESSES.flareTeeManager,
      ftsoV2: COSTON2_ADDRESSES.ftsoV2,
    },
    assets: {
      fxrp: COSTON2_ADDRESSES.fxrp,
      usdt0: COSTON2_ADDRESSES.usdt0,
    },
  }, "coston2-v2");
  console.log(`QuietVault deployed at ${await vault.getAddress()}`);
  console.log("Register that address as the FCC instruction sender, launch the real FCC machine, then run configure:coston2 with FCC_PROXY_URL.");
  console.log(`Parallel V2 deployment manifest written to ${path}; deployments/coston2.json remains the live V1 manifest.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
