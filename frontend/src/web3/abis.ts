export const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "owner", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const quietVaultAbi = [
  {
    type: "event",
    name: "DepositSubmitted",
    anonymous: false,
    inputs: [
      { indexed: true, name: "depositId", type: "bytes32" },
      { indexed: true, name: "account", type: "address" },
      { indexed: true, name: "token", type: "address" },
      { indexed: false, name: "amount", type: "uint256" },
      { indexed: false, name: "requestId", type: "bytes32" },
    ],
  },
  {
    type: "event",
    name: "ConfidentialRequestSubmitted",
    anonymous: false,
    inputs: [
      { indexed: true, name: "requestId", type: "bytes32" },
      { indexed: true, name: "command", type: "bytes32" },
      { indexed: true, name: "account", type: "address" },
    ],
  },
  {
    type: "function",
    name: "deposit",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [
      { name: "depositId", type: "bytes32" },
      { name: "requestId", type: "bytes32" },
    ],
  },
  {
    type: "function",
    name: "requestBorrow",
    stateMutability: "payable",
    inputs: [{ name: "encryptedAcceptance", type: "bytes" }],
    outputs: [{ name: "requestId", type: "bytes32" }],
  },
  {
    type: "function",
    name: "requestWithdrawal",
    stateMutability: "payable",
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "destination", type: "address" },
    ],
    outputs: [{ name: "requestId", type: "bytes32" }],
  },
] as const;
