import { expect } from "chai";
import { ethers } from "hardhat";

describe("QuietVault", function () {
  async function fixture() {
    const [admin, user, destination, tee, other] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("MockTeeExtensionRegistry");
    const registry = await Registry.deploy();
    const Machines = await ethers.getContractFactory("MockTeeMachineRegistry");
    const machines = await Machines.deploy(tee.address);
    const Ftso = await ethers.getContractFactory("MockFtsoV2");
    const ftso = await Ftso.deploy();
    const Token = await ethers.getContractFactory("MockERC20");
    const fxrp = await Token.deploy("FTestXRP", "FXRP", 6);
    const usdt0 = await Token.deploy("Test USDT0", "USDT0", 6);
    const unsupported = await Token.deploy("Other", "OTHER", 6);
    const Vault = await ethers.getContractFactory("QuietVault");
    const feedId = "0x015852502f55534400000000000000000000000000";
    const vault = await Vault.deploy(registry, machines, ftso, feedId, fxrp, usdt0, admin, admin);
    const extensionId = 65_536;
    await registry.setSender(extensionId, vault);
    await vault.setExtensionId(extensionId);
    await vault.setTeeSigner(tee.address);
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    await ftso.setPrice(600_000_000_000_000_000n, now);
    await fxrp.mint(user.address, 20_000_000n);
    await usdt0.mint(admin.address, 20_000_000n);
    await usdt0.mint(await vault.getAddress(), 30_000_000n);
    return { admin, user, destination, tee, other, registry, machines, ftso, fxrp, usdt0, unsupported, vault, extensionId };
  }

  async function settlement(ctx: Awaited<ReturnType<typeof fixture>>, overrides: Record<string, unknown> = {}) {
    const now = (await ethers.provider.getBlock("latest"))!.timestamp;
    return {
      protocolVersion: 1,
      settlementType: 0,
      account: ctx.user.address,
      token: await ctx.usdt0.getAddress(),
      amount: 3_000_000n,
      destination: ctx.destination.address,
      requestId: ethers.keccak256(ethers.toUtf8Bytes("request")),
      settlementId: ethers.keccak256(ethers.toUtf8Bytes(`settlement-${String(overrides.salt ?? "a")}`)),
      previousSequence: 0,
      nextSequence: 1,
      previousRoot: ethers.ZeroHash,
      nextRoot: ethers.keccak256(ethers.toUtf8Bytes("root-1")),
      deadline: now + 600,
      ...overrides,
    };
  }

  async function sign(ctx: Awaited<ReturnType<typeof fixture>>, value: Awaited<ReturnType<typeof settlement>>) {
    return ctx.tee.signMessage(ethers.getBytes(await ctx.vault.settlementHash(value)));
  }

  it("accepts exact supported deposits and emits an FCC request", async function () {
    const ctx = await fixture();
    await ctx.fxrp.connect(ctx.user).approve(ctx.vault, 10_000_000n);
    await expect(ctx.vault.connect(ctx.user).deposit(ctx.fxrp, 10_000_000n))
      .to.emit(ctx.vault, "DepositSubmitted");
    expect(await ctx.fxrp.balanceOf(ctx.vault)).to.equal(10_000_000n);
    expect(await ctx.registry.nonce()).to.equal(1n);
  });

  it("rejects unsupported assets and zero deposits", async function () {
    const ctx = await fixture();
    await expect(ctx.vault.connect(ctx.user).deposit(ctx.unsupported, 1)).to.be.revertedWithCustomError(ctx.vault, "UnsupportedAsset");
    await expect(ctx.vault.connect(ctx.user).deposit(ctx.fxrp, 0)).to.be.revertedWithCustomError(ctx.vault, "InvalidAmount");
    await expect(ctx.vault.connect(ctx.user).deposit(ctx.fxrp, 1n << 64n)).to.be.revertedWithCustomError(ctx.vault, "InvalidAmount");
    await expect(ctx.vault.connect(ctx.user).requestWithdrawal(ctx.fxrp, 1n << 64n, ctx.user))
      .to.be.revertedWithCustomError(ctx.vault, "InvalidAmount");
  });

  it("binds only the explicitly registered public extension", async function () {
    const ctx = await fixture();
    await expect(ctx.vault.setExtensionId(ctx.extensionId)).to.be.revertedWithCustomError(
      ctx.vault,
      "InvalidSettlement",
    );
  });

  it("binds borrow and risk instructions to a fresh FTSOv2 observation", async function () {
    const ctx = await fixture();
    await expect(ctx.vault.connect(ctx.user).requestBorrow("0x1234")).to.emit(ctx.vault, "ConfidentialRequestSubmitted");
    await expect(ctx.vault.requestRiskTick()).to.emit(ctx.vault, "ConfidentialRequestSubmitted");
    await ctx.ftso.setPrice(600_000_000_000_000_000n, 1);
    await expect(ctx.vault.requestRiskTick()).to.be.revertedWithCustomError(ctx.vault, "StaleOraclePrice");
  });

  it("binds the settlement signer only once", async function () {
    const ctx = await fixture();
    await expect(ctx.vault.setTeeSigner(ctx.other.address))
      .to.be.revertedWithCustomError(ctx.vault, "InvalidSettlement");
  });

  it("funds the private liquidation backstop through an operator-only FCC instruction", async function () {
    const ctx = await fixture();
    await expect(ctx.vault.fundBackstop(1n << 64n)).to.be.revertedWithCustomError(
      ctx.vault,
      "InvalidAmount",
    );
    await ctx.usdt0.approve(ctx.vault, 10_000_000n);
    await expect(ctx.vault.fundBackstop(10_000_000n))
      .to.emit(ctx.vault, "BackstopFunded")
      .and.to.emit(ctx.vault, "ConfidentialRequestSubmitted");
    expect(await ctx.usdt0.balanceOf(ctx.vault)).to.equal(40_000_000n);
    expect(await ctx.registry.nonce()).to.equal(1n);
    await expect(ctx.vault.connect(ctx.user).fundBackstop(1n))
      .to.be.revertedWithCustomError(ctx.vault, "AccessControlUnauthorizedAccount");
  });

  it("executes a valid TEE-signed payout exactly once", async function () {
    const ctx = await fixture();
    const value = await settlement(ctx);
    const signature = await sign(ctx, value);
    await expect(ctx.vault.executeSettlement(value, signature)).to.emit(ctx.vault, "SettlementExecuted");
    expect(await ctx.usdt0.balanceOf(ctx.destination)).to.equal(3_000_000n);
    expect(await ctx.vault.stateSequence()).to.equal(1n);
    await expect(ctx.vault.executeSettlement(value, signature)).to.be.revertedWithCustomError(ctx.vault, "SettlementAlreadyUsed");
  });

  it("rejects a wrong signer, stale root, and sequence gaps", async function () {
    const ctx = await fixture();
    const base = await settlement(ctx);
    const wrongSignature = await ctx.other.signMessage(ethers.getBytes(await ctx.vault.settlementHash(base)));
    await expect(ctx.vault.executeSettlement(base, wrongSignature)).to.be.revertedWithCustomError(ctx.vault, "InvalidTeeSignature");

    const stale = await settlement(ctx, { previousRoot: ethers.keccak256(ethers.toUtf8Bytes("wrong")), salt: "b" });
    await expect(ctx.vault.executeSettlement(stale, await sign(ctx, stale))).to.be.revertedWithCustomError(ctx.vault, "InvalidStateTransition");

    const gap = await settlement(ctx, { nextSequence: 2, salt: "c" });
    await expect(ctx.vault.executeSettlement(gap, await sign(ctx, gap))).to.be.revertedWithCustomError(ctx.vault, "InvalidStateTransition");
  });

  it("enforces per-payout and daily caps", async function () {
    const ctx = await fixture();
    const tooLarge = await settlement(ctx, { amount: 5_000_001n, salt: "large" });
    await expect(ctx.vault.executeSettlement(tooLarge, await sign(ctx, tooLarge))).to.be.revertedWithCustomError(ctx.vault, "BorrowCapExceeded");

    const first = await settlement(ctx, { amount: 5_000_000n, salt: "first" });
    await ctx.vault.executeSettlement(first, await sign(ctx, first));
    const second = await settlement(ctx, {
      amount: 3_000_001n,
      previousSequence: 1,
      nextSequence: 2,
      previousRoot: first.nextRoot,
      nextRoot: ethers.keccak256(ethers.toUtf8Bytes("root-2")),
      salt: "second",
    });
    await expect(ctx.vault.executeSettlement(second, await sign(ctx, second))).to.be.revertedWithCustomError(ctx.vault, "BorrowCapExceeded");
  });

  it("allows withdrawals while paused but blocks borrow payouts", async function () {
    const ctx = await fixture();
    await ctx.vault.pause();
    const borrow = await settlement(ctx, { salt: "paused-borrow" });
    await expect(ctx.vault.executeSettlement(borrow, await sign(ctx, borrow))).to.be.revertedWithCustomError(ctx.vault, "EnforcedPause");

    const withdrawal = await settlement(ctx, { settlementType: 1, salt: "withdrawal" });
    await expect(ctx.vault.executeSettlement(withdrawal, await sign(ctx, withdrawal))).to.emit(ctx.vault, "SettlementExecuted");
  });

  it("advances a zero-value checkpoint", async function () {
    const ctx = await fixture();
    const checkpoint = await settlement(ctx, {
      settlementType: 2,
      token: ethers.ZeroAddress,
      amount: 0,
      destination: ethers.ZeroAddress,
      salt: "checkpoint",
    });
    await ctx.vault.executeSettlement(checkpoint, await sign(ctx, checkpoint));
    expect(await ctx.vault.stateRoot()).to.equal(checkpoint.nextRoot);
  });
});
