import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes } from "viem";
import { describe, expect, it } from "vitest";
import { eciesDecrypt, eciesEncrypt } from "./crypto";

const privateKey = hexToBytes(
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
);
const publicKey = bytesToHex(secp256k1.getPublicKey(privateKey, false));
const plaintext = new TextEncoder().encode("quietline-fcc-interop");
const extensionDirectory = fileURLToPath(new URL("../../../extension/", import.meta.url));

describe("FCC ECIES interoperability", () => {
  it(
    "produces ciphertext accepted by Flare's Go ECIES implementation",
    async () => {
      const ciphertext = await eciesEncrypt(plaintext, publicKey);
      const decrypted = runGo("decrypt", bytesToHex(privateKey), ciphertext);
      expect(new TextDecoder().decode(hexToBytes(decrypted))).toBe(
        "quietline-fcc-interop",
      );
    },
    300_000,
  );

  it(
    "decrypts ciphertext produced by Flare's Go ECIES implementation",
    async () => {
      const ciphertext = runGo("encrypt", publicKey, bytesToHex(plaintext));
      const decrypted = await eciesDecrypt(ciphertext, privateKey);
      expect(new TextDecoder().decode(decrypted)).toBe("quietline-fcc-interop");
    },
    300_000,
  );
});

function runGo(mode: "encrypt" | "decrypt", key: string, message: string) {
  return execFileSync(
      "go",
      [
        "run",
        "./cmd/eciescheck",
      "-mode",
      mode,
      "-key",
      key,
      "-message",
      message,
    ],
    { cwd: extensionDirectory, encoding: "utf8" },
  ).trim() as `0x${string}`;
}
