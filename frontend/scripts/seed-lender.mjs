import { secp256k1 } from "@noble/curves/secp256k1";
import {
  bytesToHex,
  concat,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  hexToBytes,
  http,
  keccak256,
  parseAbi,
  parseUnits,
  stringToBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

const relayerUrl = required("RELAYER_URL").replace(/\/+$/u, "");
const rpcUrl = process.env.COSTON2_RPC_URL?.trim()
  || "https://coston2-api.flare.network/ext/C/rpc";
const instructionFee = BigInt(
  process.env.FCC_INSTRUCTION_FEE_WEI?.trim() || "1000000",
);
const operator = privateKeyToAccount(normalizePrivateKey(required("DEPLOYER_PRIVATE_KEY")));
const borrowerKey = process.env.TEST_WALLET?.trim();
const executeBorrow = process.argv.includes("--borrow");
const executeClose = process.argv.includes("--close");
const headers = relayerUrl.includes(".ngrok-free.dev")
  ? { "ngrok-skip-browser-warning": "quietline" }
  : {};
const chain = {
  id: 114,
  name: "Coston2",
  nativeCurrency: { name: "Coston2 Flare", symbol: "C2FLR", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
};
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({
  account: operator,
  chain,
  transport: http(rpcUrl),
});
const erc20Abi = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const vaultAbi = parseAbi([
  "function deposit(address token, uint256 amount) payable returns (bytes32 depositId, bytes32 requestId)",
  "function requestBorrow(bytes encryptedAcceptance) payable returns (bytes32 requestId)",
  "function requestWithdrawal(address token, uint256 amount, address destination) payable returns (bytes32 requestId)",
  "event DepositSubmitted(bytes32 indexed depositId, address indexed account, address indexed token, uint256 amount, bytes32 requestId)",
  "event ConfidentialRequestSubmitted(bytes32 indexed requestId, bytes32 indexed command, address indexed account)",
]);

const config = await api("/config");
const teeInfo = await api("/attestation");
const teePublicKey = teePublicKeyFromInfo(teeInfo);
const session = await authenticate(operator);

console.log(`Operator lender: ${operator.address}`);

let accountView = await accountOrCreate(operator, session, config, teePublicKey);
const activeMandate = accountView.mandates.find((mandate) => mandate.active);
if (activeMandate) {
  console.log(`Existing active mandate found: ${activeMandate.id}`);
} else {
  const currentPrivate = BigInt(accountView.account.balances.USDT0.available);
  const target = parseUnits("10", config.assets.USDT0.decimals);
  if (currentPrivate < target) {
    const requiredDeposit = target - currentPrivate;
    const walletBalance = await publicClient.readContract({
      address: config.assets.USDT0.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [operator.address],
    });
    if (walletBalance < requiredDeposit) {
      throw new Error(
        `Operator needs ${requiredDeposit} base units of ${config.assets.USDT0.symbol}, but only ${walletBalance} are available`,
      );
    }
    console.log(`Approving ${config.assets.USDT0.symbol} for QuietVault`);
    const approvalHash = await walletClient.writeContract({
      address: config.assets.USDT0.address,
      abi: erc20Abi,
      functionName: "approve",
      args: [config.vault, requiredDeposit],
    });
    await publicClient.waitForTransactionReceipt({ hash: approvalHash });

    console.log(`Depositing ${requiredDeposit} base units into the confidential lender account`);
    const depositHash = await walletClient.writeContract({
      address: config.vault,
      abi: vaultAbi,
      functionName: "deposit",
      args: [config.assets.USDT0.address, requiredDeposit],
      value: instructionFee,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });
    const requestId = eventRequestId(receipt);
    await waitForChainJob(requestId, session.token);
    console.log(`Deposit confirmed: ${depositHash}`);
    accountView = await directAccount(
      operator,
      session.token,
      config,
      teePublicKey,
      accountView.account.nonce,
    );
  }

  const mandateAmount = Number(accountView.account.balances.USDT0.available);
  if (mandateAmount <= 0) {
    throw new Error("Operator confidential account has no lendable USD₮0");
  }
  const mandateId = crypto.randomUUID();
  await direct(
    operator,
    session.token,
    config,
    teePublicKey,
    "SET_MANDATE",
    {
      mandateId,
      amount: mandateAmount,
      minAprBps: 750,
      termMask: 7,
      perBorrowerCap: mandateAmount,
    },
    accountView.account.nonce,
    "mandate",
    "SET_MANDATE",
  );
  accountView = await directAccount(
    operator,
    session.token,
    config,
    teePublicKey,
    accountView.account.nonce + 1,
  );
  const mandate = accountView.mandates.find((candidate) => candidate.id === mandateId);
  if (!mandate?.active) throw new Error("FCC did not activate the bootstrap lender mandate");
  console.log(`Private lender mandate active: ${mandate.id}`);
}

if (borrowerKey) {
  const borrower = privateKeyToAccount(normalizePrivateKey(borrowerKey));
  const borrowerSession = await authenticate(borrower);
  let borrowerView = await accountOrCreate(
    borrower,
    borrowerSession,
    config,
    teePublicKey,
  );
  if (
    executeBorrow
    && BigInt(borrowerView.account.balances.FXRP.available) === 0n
  ) {
    const borrowerWallet = createWalletClient({
      account: borrower,
      chain,
      transport: http(rpcUrl),
    });
    const walletBalance = await publicClient.readContract({
      address: config.assets.FXRP.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [borrower.address],
    });
    const requestedCollateral = BigInt(
      process.env.BORROWER_COLLATERAL_FXRP_BASE_UNITS?.trim()
        || walletBalance.toString(),
    );
    const collateralDeposit = requestedCollateral < walletBalance
      ? requestedCollateral
      : walletBalance;
    if (collateralDeposit === 0n) {
      throw new Error("Borrower wallet has no FXRP available to deposit");
    }
    const approvalHash = await borrowerWallet.writeContract({
      address: config.assets.FXRP.address,
      abi: erc20Abi,
      functionName: "approve",
      args: [config.vault, collateralDeposit],
    });
    await publicClient.waitForTransactionReceipt({ hash: approvalHash });
    const depositHash = await borrowerWallet.writeContract({
      address: config.vault,
      abi: vaultAbi,
      functionName: "deposit",
      args: [config.assets.FXRP.address, collateralDeposit],
      value: instructionFee,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: depositHash });
    await waitForChainJob(eventRequestId(receipt), borrowerSession.token);
    borrowerView = await directAccount(
      borrower,
      borrowerSession.token,
      config,
      teePublicKey,
      borrowerView.account.nonce,
    );
    console.log(`Borrower FXRP collateral confirmed: ${depositHash}`);
  }
  if (executeClose && borrowerView.loan) {
    for (const mandate of borrowerView.mandates.filter((candidate) => candidate.active)) {
      await direct(
        borrower,
        borrowerSession.token,
        config,
        teePublicKey,
        "CANCEL_MANDATE",
        { mandateId: mandate.id },
        borrowerView.account.nonce,
        "mandate",
        "CANCEL_MANDATE",
      );
      borrowerView = await directAccount(
        borrower,
        borrowerSession.token,
        config,
        teePublicKey,
        borrowerView.account.nonce + 1,
      );
      console.log(`Private lender mandate cancelled: ${mandate.id}`);
    }

    const repaymentAmount = Number(borrowerView.account.balances.USDT0.available);
    if (repaymentAmount <= 0) {
      throw new Error("Borrower private account has no USD₮0 available for repayment");
    }
    await direct(
      borrower,
      borrowerSession.token,
      config,
      teePublicKey,
      "APPLY_REPAYMENT",
      {
        amount: repaymentAmount,
        operationId: crypto.randomUUID(),
      },
      borrowerView.account.nonce,
      "repayment",
    );
    borrowerView = await directAccount(
      borrower,
      borrowerSession.token,
      config,
      teePublicKey,
      borrowerView.account.nonce + 1,
    );
    if (borrowerView.loan) {
      throw new Error("Private repayment did not close the active loan");
    }
    console.log("Private loan repaid and collateral released");

    const withdrawalAmount = BigInt(
      process.env.WITHDRAW_FXRP_BASE_UNITS?.trim() || "1000000",
    );
    const privateFxrp = BigInt(borrowerView.account.balances.FXRP.available);
    const amount = withdrawalAmount < privateFxrp ? withdrawalAmount : privateFxrp;
    if (amount <= 0n) {
      throw new Error("No released FXRP is available for withdrawal verification");
    }
    const borrowerWallet = createWalletClient({
      account: borrower,
      chain,
      transport: http(rpcUrl),
    });
    const walletBefore = await publicClient.readContract({
      address: config.assets.FXRP.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [borrower.address],
    });
    const withdrawalHash = await borrowerWallet.writeContract({
      address: config.vault,
      abi: vaultAbi,
      functionName: "requestWithdrawal",
      args: [config.assets.FXRP.address, amount, borrower.address],
      value: instructionFee,
    });
    const withdrawalReceipt = await publicClient.waitForTransactionReceipt({
      hash: withdrawalHash,
    });
    await waitForChainJob(
      eventRequestId(withdrawalReceipt, "ConfidentialRequestSubmitted"),
      borrowerSession.token,
    );
    const withdrawnView = await directAccount(
      borrower,
      borrowerSession.token,
      config,
      teePublicKey,
      borrowerView.account.nonce + 1,
    );
    const walletAfter = await publicClient.readContract({
      address: config.assets.FXRP.address,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [borrower.address],
    });
    if (
      walletAfter - walletBefore !== amount
      || privateFxrp - BigInt(withdrawnView.account.balances.FXRP.available) !== amount
    ) {
      throw new Error("FXRP withdrawal did not settle exact public and private balances");
    }
    console.log(`Released FXRP withdrawal confirmed: ${withdrawalHash}`);
  } else {
    const collateral = Math.min(
    Number(borrowerView.account.balances.FXRP.available),
    10_000_000,
    );
    if (collateral <= 0) {
      throw new Error("Borrower confidential account has no FXRP available for quote verification");
    }
    const collateralValue = (
      BigInt(collateral) * BigInt(borrowerView.price.xrpUsdE6)
    ) / 1_000_000n;
    const maximumAtInitialLtv = collateralValue / 2n;
    const safeBorrowCapacity = (maximumAtInitialLtv * 9n) / 10n;
    const requestedBorrow = BigInt(
      process.env.BORROW_AMOUNT_USDT0_BASE_UNITS?.trim() || "3000000",
    );
    const borrowAmount = requestedBorrow < safeBorrowCapacity
      ? requestedBorrow
      : safeBorrowCapacity;
    if (borrowAmount <= 0n) {
      throw new Error("Borrower collateral has no positive capacity at the 50% initial LTV");
    }
    console.log(
      `Borrow quote input: ${borrowAmount} USD₮0 base units against ${collateral} FXRP base units`,
    );
    const quote = await direct(
      borrower,
      borrowerSession.token,
      config,
      teePublicKey,
      "QUOTE_REQUEST",
      {
        id: crypto.randomUUID(),
        borrower: borrower.address,
        amount: Number(borrowAmount),
        termDays: 14,
        maxAprBps: 1_200,
        collateralFxrp: collateral,
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      },
      borrowerView.account.nonce,
      "quote",
    );
    console.log(
      `Borrower quote verified: ${quote.amount} base units across ${quote.tranches.length} mandate(s)`,
    );
    if (executeBorrow) {
      if (borrowerView.loan) {
        console.log(`Borrower already has active loan ${borrowerView.loan.id}; skipping settlement`);
      } else {
        const borrowerWallet = createWalletClient({
          account: borrower,
          chain,
          transport: http(rpcUrl),
        });
        const payoutBefore = await publicClient.readContract({
          address: config.assets.USDT0.address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [borrower.address],
        });
        const acceptance = createActionDraft({
          sender: borrower.address,
          nonce: borrowerView.account.nonce,
          action: "BORROW_ACCEPT",
          payload: { quote, loanId: crypto.randomUUID() },
          chainId: config.network.id,
          vault: config.vault,
        });
        const acceptanceSignature = await borrower.signTypedData(acceptance.typedData);
        const encryptedAcceptance = await sealSignedAction(
          acceptance,
          acceptanceSignature,
          teePublicKey,
        );
        const borrowHash = await borrowerWallet.writeContract({
          address: config.vault,
          abi: vaultAbi,
          functionName: "requestBorrow",
          args: [encryptedAcceptance],
          value: instructionFee,
        });
        const borrowReceipt = await publicClient.waitForTransactionReceipt({
          hash: borrowHash,
        });
        const borrowRequestId = eventRequestId(
          borrowReceipt,
          "ConfidentialRequestSubmitted",
        );
        await waitForChainJob(borrowRequestId, borrowerSession.token);
        const settledView = await directAccount(
          borrower,
          borrowerSession.token,
          config,
          teePublicKey,
          borrowerView.account.nonce + 1,
        );
        const payoutAfter = await publicClient.readContract({
          address: config.assets.USDT0.address,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [borrower.address],
        });
        if (!settledView.loan || payoutAfter - payoutBefore !== BigInt(quote.amount)) {
          throw new Error("Borrow settlement did not create the private loan and exact public payout");
        }
        console.log(`Borrow settlement confirmed: ${borrowHash}`);
        console.log(`Private loan active: ${settledView.loan.id}`);
      }
    }
  }
}

console.log("Real Coston2 lender liquidity is ready");

async function accountOrCreate(account, auth, protocol, teeKey) {
  try {
    return await directAccount(account, auth.token, protocol, teeKey, 0);
  } catch (error) {
    if (!String(error).includes("private account does not exist")) throw error;
  }
  await direct(
    account,
    auth.token,
    protocol,
    teeKey,
    "OPEN_ACCOUNT",
    { operationId: crypto.randomUUID() },
    0,
    "open-account",
  );
  return directAccount(account, auth.token, protocol, teeKey, 1);
}

function directAccount(account, token, protocol, teeKey, nonce) {
  return direct(
    account,
    token,
    protocol,
    teeKey,
    "ACCOUNT_QUERY",
    {},
    nonce,
    "account",
  );
}

async function direct(
  account,
  token,
  protocol,
  teeKey,
  action,
  payload,
  nonce,
  route,
  command,
) {
  const draft = createActionDraft({
    sender: account.address,
    nonce,
    action,
    payload,
    chainId: protocol.network.id,
    vault: protocol.vault,
  });
  const signature = await account.signTypedData(draft.typedData);
  const ciphertext = await sealSignedAction(draft, signature, teeKey);
  const job = await api(`/direct/${route}`, {
    method: "POST",
    token,
    body: JSON.stringify({
      account: account.address,
      ciphertext,
      ...(command ? { command } : {}),
    }),
  });
  const completed = await waitForJob(job.id, token);
  if (!completed.response?.ciphertext) return undefined;
  return decryptPrivateResponse(
    completed.response.ciphertext,
    draft.responsePrivateKey,
  );
}

async function authenticate(account) {
  const challenge = await api("/auth/challenge", {
    method: "POST",
    body: JSON.stringify({ address: account.address }),
  });
  const signature = await account.signTypedData({
    domain: challenge.typedData.domain,
    types: challenge.typedData.types,
    primaryType: challenge.typedData.primaryType,
    message: {
      ...challenge.typedData.message,
      issuedAt: BigInt(challenge.issuedAt),
      expiresAt: BigInt(challenge.expiresAt),
    },
  });
  return api("/auth/verify", {
    method: "POST",
    body: JSON.stringify({
      address: account.address,
      nonce: challenge.nonce,
      issuedAt: challenge.issuedAt,
      expiresAt: challenge.expiresAt,
      signature,
    }),
  });
}

async function waitForChainJob(requestId, token, timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const jobs = await api("/jobs", { token });
    const job = jobs.find((candidate) => candidate.externalKey === `chain:${requestId}`);
    if (job) return waitForJob(job.id, token, timeoutMs - (Date.now() - started));
    await sleep(1_000);
  }
  throw new Error(`Timed out waiting for chain request ${requestId}`);
}

async function waitForJob(id, token, timeoutMs = 90_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const job = await api(`/jobs/${id}`, { token });
    if (job.status === "confirmed") return job;
    if (job.status === "failed") throw new Error(job.error || "FCC action failed");
    await sleep(750);
  }
  throw new Error(`Timed out waiting for FCC job ${id}`);
}

function eventRequestId(receipt, eventName = "DepositSubmitted") {
  for (const log of receipt.logs) {
    try {
      const event = decodeEventLog({
        abi: vaultAbi,
        eventName,
        data: log.data,
        topics: log.topics,
      });
      if (event.args.requestId) return event.args.requestId;
    } catch {
      // Ignore unrelated receipt logs.
    }
  }
  throw new Error(`${eventName} receipt did not contain a QuietVault request id`);
}

async function api(path, init = {}) {
  const { token, retry, ...requestInit } = init;
  const method = requestInit.method?.toUpperCase() || "GET";
  const retryable = retry ?? (method === "GET" || path.startsWith("/auth/"));
  const attempts = retryable ? 4 : 1;
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(`${relayerUrl}${path}`, {
        ...requestInit,
        headers: {
          "content-type": "application/json",
          ...headers,
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...requestInit.headers,
        },
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) return body;
      const error = new Error(body.message || `Quietline API returned ${response.status}`);
      if (![429, 502, 503, 504].includes(response.status) || attempt === attempts) {
        throw error;
      }
      lastError = error;
    } catch (error) {
      lastError = error;
      if (!retryable || attempt === attempts) throw error;
    }
    await sleep(500 * attempt);
  }

  throw lastError;
}

function createActionDraft(input) {
  const responsePrivateKey = secp256k1.utils.randomPrivateKey();
  const responsePublicKey = bytesToHex(
    secp256k1.getPublicKey(responsePrivateKey, false),
  );
  const deadline = Math.floor(Date.now() / 1000) + 300;
  const payloadBytes = new TextEncoder().encode(JSON.stringify(input.payload));
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
      types: {
        QuietlineAction: [
          { name: "sender", type: "address" },
          { name: "nonce", type: "uint64" },
          { name: "deadline", type: "uint64" },
          { name: "actionHash", type: "bytes32" },
          { name: "payloadHash", type: "bytes32" },
          { name: "responseKeyHash", type: "bytes32" },
        ],
      },
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

async function sealSignedAction(draft, signature, teePublicKey) {
  const serialized = JSON.stringify({ ...draft.signedAction, signature });
  return eciesEncrypt(padJson(serialized), teePublicKey);
}

async function decryptPrivateResponse(ciphertext, responsePrivateKey) {
  const plaintext = await eciesDecrypt(ciphertext, responsePrivateKey);
  return JSON.parse(new TextDecoder().decode(plaintext).trimEnd());
}

function teePublicKeyFromInfo(info) {
  const key = info.machineData?.publicKey || info.teeInfo?.publicKey;
  if (!key?.x || !key.y) throw new Error("FCC attestation did not include a public key");
  return concat(["0x04", key.x, key.y]);
}

async function eciesEncrypt(plaintext, publicKey) {
  const ephemeralPrivate = secp256k1.utils.randomPrivateKey();
  const ephemeralPublic = secp256k1.getPublicKey(ephemeralPrivate, false);
  const shared = secp256k1.getSharedSecret(
    ephemeralPrivate,
    hexToBytes(publicKey),
    false,
  );
  const keyMaterial = await concatKdf(shared.slice(1, 33), 32);
  const encryptionKey = keyMaterial.slice(0, 16);
  const macKey = new Uint8Array(
    await crypto.subtle.digest("SHA-256", arrayBuffer(keyMaterial.slice(16))),
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

async function eciesDecrypt(ciphertext, privateKey) {
  const bytes = hexToBytes(ciphertext);
  const ephemeralPublic = bytes.slice(0, 65);
  const encryptedMessage = bytes.slice(65, -32);
  const receivedTag = bytes.slice(-32);
  const shared = secp256k1.getSharedSecret(privateKey, ephemeralPublic, false);
  const keyMaterial = await concatKdf(shared.slice(1, 33), 32);
  const encryptionKey = keyMaterial.slice(0, 16);
  const macKey = new Uint8Array(
    await crypto.subtle.digest("SHA-256", arrayBuffer(keyMaterial.slice(16))),
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
      {
        name: "AES-CTR",
        counter: encryptedMessage.slice(0, 16),
        length: 128,
      },
      aesKey,
      arrayBuffer(encryptedMessage.slice(16)),
    ),
  );
}

async function concatKdf(z, length) {
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

async function hmacSha256(key, message) {
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

function padJson(value) {
  const bytes = new TextEncoder().encode(value);
  const bucket = [512, 1024, 2048, 4096].find((size) => bytes.length <= size);
  if (!bucket) throw new Error("Encrypted request exceeds the FCC privacy bucket");
  const padded = new Uint8Array(bucket);
  padded.fill(32);
  padded.set(bytes);
  return padded;
}

function concatBytes(...parts) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

function arrayBuffer(value) {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

function normalizePrivateKey(value) {
  return value.startsWith("0x") ? value : `0x${value}`;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
