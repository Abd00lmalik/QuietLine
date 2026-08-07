import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ethers } from "hardhat";

export const COSTON2_ADDRESSES = {
  flareTeeManager: "0x1a9C4A0f9D76c0b1D91d22E24E573a9b377618aE",
  ftsoV2: "0xC4e9c78EA53db782E28f28Fdf80BaF59336B304d",
  fxrp: "0x0b6A3645c240605887a5532109323A3E12273dc7",
  usdt0: "0xC1A5B41512496B80903D1f32d6dEa3a73212E71F",
  xrpUsdFeedId: "0x015852502f55534400000000000000000000000000",
} as const;

export type Deployment = {
  network: "local" | "coston2";
  chainId: number;
  protocolVersion: number;
  quietPolicy: string;
  quietVault: string;
  extensionId: number;
  teeSigner: string;
  codeHash: string;
  startBlock: number;
  infrastructure: {
    flareTeeManager: string;
    ftsoV2: string;
  };
  assets: {
    fxrp: string;
    usdt0: string;
  };
};

export type DeploymentTarget = "local" | "coston2" | "coston2-v2";

export function deploymentPath(target: DeploymentTarget) {
  return resolve(__dirname, "..", "..", "deployments", `${target}.json`);
}

export function writeDeployment(
  value: Deployment,
  target: DeploymentTarget = value.network,
) {
  const path = deploymentPath(target);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}

export function readDeployment(target: DeploymentTarget) {
  return JSON.parse(readFileSync(deploymentPath(target), "utf8")) as Deployment;
}

export async function requireCode(label: string, address: string) {
  const code = await ethers.provider.getCode(address);
  if (code === "0x") {
    throw new Error(`${label} has no deployed bytecode at ${address}`);
  }
}

export function requiredAddress(name: string) {
  const value = process.env[name];
  if (!value || !ethers.isAddress(value) || value === ethers.ZeroAddress) {
    throw new Error(`${name} must be a non-zero EVM address`);
  }
  return ethers.getAddress(value);
}
