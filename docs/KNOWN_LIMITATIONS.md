# Known Limitations

The August 2, 2026 hackathon release intentionally has these limits:

- one officially registered Coston2 simulated TEE;
- one relayer and one keeper process;
- one active loan per private account;
- full repayment only;
- fixed 7, 14, and 30 day terms;
- FTestXRP collateral and USD₮0 debt only;
- deterministic protocol backstop instead of an auction;
- immutable TEE settlement signer;
- no backstop withdrawal;
- browser-local mutation serialization, with cross-tab nonce races possible;
- no email, push, or mobile notification service;
- no contract or confidential-code production audit;
- no production mainnet deployment.

Privacy limitations:

- transfers, addresses, amounts, and timing are public;
- traffic and timing correlation remain possible;
- the active TEE sees plaintext;
- quote recipients can see lender addresses and rates included in their
  decrypted quote;
- public vault holdings include user deposits, backstop funds, repayments, and
  reserves and must not be interpreted as lendable liquidity.

Operational limitations:

- losing the TEE key requires a new vault deployment;
- losing the state-encryption key makes private state unrecoverable;
- relayer downtime pauses settlement completion;
- only one keeper-enabled relayer instance should run;
- the official Coston2 simulated-TEE mode does not provide hardware-backed
  production confidentiality;
- the reserved ngrok domain remains an external availability dependency.
