import { ethers } from "hardhat";
import { readDeployment, writeDeployment } from "./shared";

type PublicKey = { x?: string; y?: string };
type TeeInfo = {
  chainId?: string | number;
  publicKey?: PublicKey;
};
type MachineData = {
  extensionId?: string | number;
  codeHash?: string;
  publicKey?: PublicKey;
};
type SignedTeeInfo = {
  teeInfo?: TeeInfo;
  machineData?: MachineData;
  attestation?: string;
};

function requiredUrl(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return new URL(value);
}

function machineInfo(
  value: unknown,
  allowSimulated: boolean,
): Required<Pick<SignedTeeInfo, "teeInfo" | "machineData" | "attestation">> {
  if (!value || typeof value !== "object") throw new Error("FCC /info returned an invalid payload");
  const root = value as SignedTeeInfo;
  if (!root.teeInfo || !root.machineData) {
    throw new Error("FCC /info did not include both teeInfo and machineData");
  }
  if (!root.attestation) {
    throw new Error("FCC /info did not include an attestation value");
  }
  if (root.attestation === "magic_pass" && !allowSimulated) {
    throw new Error("FCC /info uses simulated attestation but SIMULATED_TEE is not enabled");
  }
  return {
    teeInfo: root.teeInfo,
    machineData: root.machineData,
    attestation: root.attestation,
  };
}

function uint(value: string | number | undefined, name: string) {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`FCC /info ${name} is invalid`);
  return parsed;
}

function signerFromPublicKey(key: PublicKey | undefined) {
  if (!key?.x || !key.y || !/^0x[0-9a-fA-F]{64}$/u.test(key.x) || !/^0x[0-9a-fA-F]{64}$/u.test(key.y)) {
    throw new Error("FCC /info did not include a valid secp256k1 public key");
  }
  return ethers.computeAddress(`0x04${key.x.slice(2)}${key.y.slice(2)}`);
}

async function main() {
  const deployment = readDeployment("coston2-v2");
  const vault = await ethers.getContractAt("QuietVault", deployment.quietVault);
  const infoUrl = new URL("/info", requiredUrl("FCC_PROXY_URL"));
  const response = await fetch(infoUrl);
  if (!response.ok) throw new Error(`FCC /info returned ${response.status}`);
  const allowSimulated = process.env.SIMULATED_TEE === "true";
  const info = machineInfo(await response.json(), allowSimulated);
  const chainId = uint(info.teeInfo.chainId, "teeInfo.chainId");
  if (chainId !== 114) throw new Error(`FCC machine is on chain ${chainId}, expected 114`);
  const machineExtensionId = uint(
    info.machineData.extensionId,
    "machineData.extensionId",
  );
  if (machineExtensionId < 65_536) {
    throw new Error("FCC machine is not configured for a public extension");
  }

  const current = await vault.extensionId();
  if (current === 0n) {
    await (await vault.setExtensionId(machineExtensionId)).wait();
  }
  const extensionId = Number(await vault.extensionId());
  if (machineExtensionId !== extensionId) {
    throw new Error(`FCC machine extension ID does not match QuietVault extension ${extensionId}`);
  }
  const teeSigner = signerFromPublicKey(info.teeInfo.publicKey);
  const configuredSigner = await vault.activeTeeSigner();
  if (configuredSigner.toLowerCase() !== teeSigner.toLowerCase()) {
    await (await vault.setTeeSigner(teeSigner)).wait();
  }
  const codeHash = info.machineData.codeHash;
  if (!codeHash || !/^0x[0-9a-fA-F]{64}$/u.test(codeHash) || codeHash === ethers.ZeroHash) {
    throw new Error("FCC /info did not include a non-zero measured code hash");
  }
  const simulatedCodeHash =
    "0x194844cf417dde867073e5ab7199fa4d21fd82b5dbe2bdea8b3d7fc18d10fdc2";
  if (allowSimulated && codeHash.toLowerCase() !== simulatedCodeHash) {
    throw new Error("simulated FCC /info returned an unexpected code hash");
  }
  const path = writeDeployment({ ...deployment, extensionId, teeSigner, codeHash }, "coston2-v2");
  console.log(`QuietVault configured for FCC extension ${extensionId} and TEE signer ${teeSigner}`);
  console.log(`Updated ${path}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
