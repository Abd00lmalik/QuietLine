import { ethers } from "hardhat";
import { writeDeployment } from "./shared";

async function main() {
  const [admin, teeSigner] = await ethers.getSigners();
  const Registry = await ethers.getContractFactory("MockTeeExtensionRegistry");
  const registry = await Registry.deploy();
  const Machines = await ethers.getContractFactory("MockTeeMachineRegistry");
  const machines = await Machines.deploy(teeSigner.address);
  const Ftso = await ethers.getContractFactory("MockFtsoV2");
  const ftso = await Ftso.deploy();
  const Token = await ethers.getContractFactory("MockERC20");
  const fxrp = await Token.deploy("FTestXRP", "FXRP", 6);
  const usdt0 = await Token.deploy("Test USDT0", "USDT0", 6);
  const Policy = await ethers.getContractFactory("QuietPolicy");
  const policy = await Policy.deploy();
  const Vault = await ethers.getContractFactory("QuietVault");
  const vault = await Vault.deploy(
    registry,
    machines,
    ftso,
    "0x015852502f55534400000000000000000000000000",
    fxrp,
    usdt0,
    admin.address,
    admin.address,
  );
  await Promise.all([
    registry.waitForDeployment(),
    machines.waitForDeployment(),
    ftso.waitForDeployment(),
    fxrp.waitForDeployment(),
    usdt0.waitForDeployment(),
    policy.waitForDeployment(),
    vault.waitForDeployment(),
  ]);
  const extensionId = 65_536;
  await (await registry.setSender(extensionId, vault)).wait();
  await (await vault.setExtensionId(extensionId)).wait();
  await (await vault.setTeeSigner(teeSigner.address)).wait();
  const block = await ethers.provider.getBlock("latest");
  await (await ftso.setPrice(600_000_000_000_000_000n, block!.timestamp)).wait();

  const path = writeDeployment({
    network: "local",
    chainId: 31_337,
    quietPolicy: await policy.getAddress(),
    quietVault: await vault.getAddress(),
    extensionId,
    teeSigner: teeSigner.address,
    codeHash: ethers.ZeroHash,
    startBlock: block!.number,
    infrastructure: {
      flareTeeManager: await registry.getAddress(),
      ftsoV2: await ftso.getAddress(),
    },
    assets: {
      fxrp: await fxrp.getAddress(),
      usdt0: await usdt0.getAddress(),
    },
  });
  console.log(`Quietline local deployment written to ${path}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
