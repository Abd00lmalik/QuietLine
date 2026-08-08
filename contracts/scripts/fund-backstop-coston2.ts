import { ethers } from "hardhat";
import { readDeployment } from "./shared";

const FCC_INSTRUCTION_FEE_WEI = 1_000_000_000_000n;
const POLL_INTERVAL_MS = 2_000;

type OperationalJob = {
  externalKey: string;
  status: "queued" | "submitted" | "processing" | "settling" | "confirming" | "confirmed" | "failed";
  error?: string;
  txHash?: string;
};

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function positiveDuration(name: string, fallback: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

async function waitForConfirmation(
  relayerUrl: string,
  operationsApiKey: string,
  externalKey: string,
  timeoutMs: number,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = new URL(
      "operations/job",
      `${relayerUrl.replace(/\/+$/u, "")}/`,
    );
    url.searchParams.set("externalKey", externalKey);
    const response = await fetch(url, {
      headers: { "x-quietline-operations-key": operationsApiKey },
    });
    if (response.status === 404) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      continue;
    }
    if (!response.ok) {
      throw new Error(`relayer returned ${response.status}: ${await response.text()}`);
    }
    const job = (await response.json()) as OperationalJob;
    if (job.status === "failed") {
      throw new Error(`FCC backstop request failed: ${job.error ?? "unknown error"}`);
    }
    if (job.status === "confirmed") return job;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`timed out waiting for ${externalKey} to be confirmed`);
}

async function main() {
  const deployment = readDeployment("coston2-v2");
  const [operator] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 114n) {
    throw new Error(`expected Coston2 chain 114, got ${network.chainId}`);
  }
  if (deployment.extensionId < 65_536) {
    throw new Error("the deployment manifest does not contain a configured public FCC extension");
  }

  const amount = ethers.parseUnits(required("BACKSTOP_AMOUNT_USDT0"), 6);
  if (amount === 0n) throw new Error("BACKSTOP_AMOUNT_USDT0 must be greater than zero");
  const relayerUrl = required("RELAYER_URL");
  const operationsApiKey = required("OPERATIONS_API_KEY");
  const timeoutMs = positiveDuration("BACKSTOP_CONFIRMATION_TIMEOUT_MS", 15 * 60_000);

  const vault = await ethers.getContractAt("QuietVault", deployment.quietVault);
  const operatorRole = await vault.OPERATOR_ROLE();
  if (!(await vault.hasRole(operatorRole, operator.address))) {
    throw new Error(`${operator.address} does not hold QuietVault OPERATOR_ROLE`);
  }

  const usdt0 = await ethers.getContractAt(
    [
      "function balanceOf(address) view returns (uint256)",
      "function allowance(address,address) view returns (uint256)",
      "function approve(address,uint256) returns (bool)",
    ],
    deployment.assets.usdt0,
  );
  const balance = await usdt0.balanceOf(operator.address);
  if (balance < amount) {
    throw new Error(
      `operator has ${ethers.formatUnits(balance, 6)} testUSDT0; ${ethers.formatUnits(amount, 6)} required`,
    );
  }
  if ((await usdt0.allowance(operator.address, deployment.quietVault)) < amount) {
    const approval = await usdt0.approve(deployment.quietVault, amount);
    await approval.wait();
    console.log(`Approved ${ethers.formatUnits(amount, 6)} testUSDT0: ${approval.hash}`);
  }

  const transaction = await vault.fundBackstop(amount, { value: FCC_INSTRUCTION_FEE_WEI });
  const receipt = await transaction.wait();
  const event = receipt?.logs
    .map((log) => {
      try {
        return vault.interface.parseLog(log);
      } catch {
        return null;
      }
    })
    .find((parsed) => parsed?.name === "BackstopFunded");
  if (!event) throw new Error("BackstopFunded event was not found in the receipt");

  const requestId = event.args.requestId as string;
  const externalKey = `chain:${requestId}`;
  console.log(`Backstop funding submitted: ${transaction.hash}`);
  console.log(`Waiting for FCC confirmation of ${requestId}...`);
  const job = await waitForConfirmation(relayerUrl, operationsApiKey, externalKey, timeoutMs);
  console.log(JSON.stringify({
    status: "confirmed",
    amount: ethers.formatUnits(amount, 6),
    asset: "testUSDT0",
    requestId,
    fundingTransaction: transaction.hash,
    settlementTransaction: job.txHash,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
