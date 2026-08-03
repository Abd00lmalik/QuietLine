import { ethers } from "hardhat";
import { readDeployment } from "./shared";

async function main() {
  const deployment = readDeployment("local");
  const [admin, borrower, lenderA, lenderB] = await ethers.getSigners();
  const fxrp = await ethers.getContractAt("MockERC20", deployment.assets.fxrp);
  const usdt0 = await ethers.getContractAt("MockERC20", deployment.assets.usdt0);
  const vault = await ethers.getContractAt("QuietVault", deployment.quietVault);
  await Promise.all([
    (await fxrp.mint(borrower.address, 25_000_000n)).wait(),
    (await usdt0.mint(lenderA.address, 10_000_000n)).wait(),
    (await usdt0.mint(lenderB.address, 10_000_000n)).wait(),
    (await usdt0.mint(await vault.getAddress(), 20_000_000n)).wait(),
  ]);
  console.log(JSON.stringify({
    admin: admin.address,
    borrower: borrower.address,
    lenderA: lenderA.address,
    lenderB: lenderB.address,
    vault: await vault.getAddress(),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
