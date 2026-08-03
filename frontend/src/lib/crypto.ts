import { secp256k1 } from "@noble/curves/secp256k1";
import {
  bytesToHex,
  concat,
  hexToBytes,
  keccak256,
  stringToBytes,
  type Address,
  type Hex,
} from "viem";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type ActionDraft = {
  signedAction: {
    sender: Address;
    nonce: number;
    deadline: number;
    action: string;
    payload: unknown;
    responsePublicKey: Hex;
  };
  responsePrivateKey: Uint8Array;
  typedData: {
    domain: {
      name: "Quietline";
      version: "1";
      chainId: number;
      verifyingContract: Address;
    };
    types: typeof actionTypes;
    primaryType: "QuietlineAction";
    message: {
      sender: Address;
      nonce: bigint;
      deadline: bigint;
      actionHash: Hex;
      payloadHash: Hex;
      responseKeyHash: Hex;
    };
  };
};

const actionTypes = {
  QuietlineAction: [
    { name: "sender", type: "address" },
    { name: "nonce", type: "uint64" },
    { name: "deadline", type: "uint64" },
    { name: "actionHash", type: "bytes32" },
    { name: "payloadHash", type: "bytes32" },
    { name: "responseKeyHash", type: "bytes32" },
  ],
} as const;

export function createActionDraft(input: {
  sender: Address;
  nonce: number;
  action: string;
  payload: unknown;
  chainId: number;
  vault: Address;
  ttlSeconds?: number;
}): ActionDraft {
  const responsePrivateKey = secp256k1.utils.randomPrivateKey();
  const responsePublicKey = bytesToHex(
    secp256k1.getPublicKey(responsePrivateKey, false),
  );
  const deadline =
    Math.floor(Date.now() / 1000) + (input.ttlSeconds === undefined ? 300 : input.ttlSeconds);
  const payloadBytes = textEncoder.encode(JSON.stringify(input.payload));
  return {
    signedAction: {
      sender: input.sender,
      nonce: input.nonce,
      deadline,
      action: input.action,
      payload: input.payload,
      responsePublicKey,
    },
    responsePrivateKey,
    typedData: {
      domain: {
        name: "Quietline",
        version: "1",
        chainId: input.chainId,
        verifyingContract: input.vault,
      },
      types: actionTypes,
      primaryType: "QuietlineAction",
      message: {
        sender: input.sender,
        nonce: BigInt(input.nonce),
        deadline: BigInt(deadline),
        actionHash: keccak256(stringToBytes(input.action)),
        payloadHash: keccak256(payloadBytes),
        responseKeyHash: keccak256(hexToBytes(responsePublicKey)),
      },
    },
  };
}

export async function sealSignedAction(
  draft: ActionDraft,
  signature: Hex,
  teePublicKey: Hex,
): Promise<Hex> {
  const serialized = JSON.stringify({ ...draft.signedAction, signature });
  return eciesEncrypt(padJson(serialized), teePublicKey);
}

export async function decryptPrivateResponse<T>(
  ciphertext: Hex,
  responsePrivateKey: Uint8Array,
): Promise<T> {
  const plaintext = await eciesDecrypt(ciphertext, responsePrivateKey);
  return JSON.parse(textDecoder.decode(plaintext).trimEnd()) as T;
}

export function teePublicKeyFromInfo(info: unknown): Hex {
  const parsed = info as {
    teeInfo?: { publicKey?: { x?: Hex; y?: Hex } };
    machineData?: { publicKey?: { x?: Hex; y?: Hex } };
  };
  const key = parsed.machineData?.publicKey ?? parsed.teeInfo?.publicKey;
  if (!key?.x || !key.y) throw new Error("FCC attestation did not include a public key");
  return concat(["0x04", key.x, key.y]);
}

export async function eciesEncrypt(plaintext: Uint8Array, publicKey: Hex): Promise<Hex> {
  const ephemeralPrivate = secp256k1.utils.randomPrivateKey();
  const ephemeralPublic = secp256k1.getPublicKey(ephemeralPrivate, false);
  const shared = secp256k1.getSharedSecret(ephemeralPrivate, hexToBytes(publicKey), false);
  const z = shared.slice(1, 33);
  const keyMaterial = await concatKdf(z, 32);
  const encryptionKey = keyMaterial.slice(0, 16);
  const macSeed = keyMaterial.slice(16);
  const macKey = new Uint8Array(
    await crypto.subtle.digest("SHA-256", arrayBuffer(macSeed)),
  );
  const iv = crypto.getRandomValues(new Uint8Array(16));
  const aesKey = await crypto.subtle.importKey(
    "raw",
    arrayBuffer(encryptionKey),
    "AES-CTR",
    false,
    ["encrypt"],
  );
  const encrypted = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-CTR", counter: iv, length: 128 },
      aesKey,
      arrayBuffer(plaintext),
    ),
  );
  const encryptedMessage = concatBytes(iv, encrypted);
  const tag = await hmacSha256(macKey, encryptedMessage);
  return bytesToHex(concatBytes(ephemeralPublic, encryptedMessage, tag));
}

export async function eciesDecrypt(
  ciphertext: Hex,
  privateKey: Uint8Array,
): Promise<Uint8Array> {
  const bytes = hexToBytes(ciphertext);
  if (bytes.length < 113 || bytes[0] !== 4) throw new Error("invalid FCC ciphertext");
  const ephemeralPublic = bytes.slice(0, 65);
  const encryptedMessage = bytes.slice(65, -32);
  const receivedTag = bytes.slice(-32);
  const shared = secp256k1.getSharedSecret(privateKey, ephemeralPublic, false);
  const keyMaterial = await concatKdf(shared.slice(1, 33), 32);
  const encryptionKey = keyMaterial.slice(0, 16);
  const macSeed = keyMaterial.slice(16);
  const macKey = new Uint8Array(
    await crypto.subtle.digest("SHA-256", arrayBuffer(macSeed)),
  );
  const expectedTag = await hmacSha256(macKey, encryptedMessage);
  if (!constantTimeEqual(receivedTag, expectedTag)) {
    throw new Error("FCC response authentication failed");
  }
  const aesKey = await crypto.subtle.importKey(
    "raw",
    arrayBuffer(encryptionKey),
    "AES-CTR",
    false,
    ["decrypt"],
  );
  return new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-CTR", counter: encryptedMessage.slice(0, 16), length: 128 },
      aesKey,
      arrayBuffer(encryptedMessage.slice(16)),
    ),
  );
}

async function concatKdf(z: Uint8Array, length: number) {
  const output = new Uint8Array(length);
  let offset = 0;
  let counter = 1;
  while (offset < length) {
    const counterBytes = new Uint8Array(4);
    new DataView(counterBytes.buffer).setUint32(0, counter, false);
    const block = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        arrayBuffer(concatBytes(counterBytes, z)),
      ),
    );
    const take = Math.min(block.length, length - offset);
    output.set(block.slice(0, take), offset);
    offset += take;
    counter++;
  }
  return output;
}

async function hmacSha256(key: Uint8Array, message: Uint8Array) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    arrayBuffer(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, arrayBuffer(message)),
  );
}

function concatBytes(...parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left[index]! ^ right[index]!;
  }
  return difference === 0;
}

function padJson(value: string) {
  const bytes = textEncoder.encode(value);
  const bucket = [512, 1024, 2048, 4096].find((size) => bytes.length <= size);
  if (!bucket) throw new Error("encrypted request exceeds the 4096-byte privacy bucket");
  const padded = new Uint8Array(bucket);
  padded.fill(32);
  padded.set(bytes);
  return padded;
}

function arrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}
