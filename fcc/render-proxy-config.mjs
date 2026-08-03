import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const required = [
  "INDEXER_DB_HOST",
  "INDEXER_DB_PORT",
  "INDEXER_DB_NAME",
  "INDEXER_DB_USER",
  "INDEXER_DB_PASSWORD",
  "GOVERNANCE_SIGNERS",
  "GOVERNANCE_THRESHOLD",
  "FCC_CODE_HASH",
];

for (const name of required) {
  if (!process.env[name]?.trim()) throw new Error(`${name} is required`);
}

const port = Number(process.env.INDEXER_DB_PORT);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("INDEXER_DB_PORT must be an integer from 1 to 65535");
}
const threshold = Number(process.env.GOVERNANCE_THRESHOLD);
if (!Number.isInteger(threshold) || threshold < 1) {
  throw new Error("GOVERNANCE_THRESHOLD must be a positive integer");
}
const signers = process.env.GOVERNANCE_SIGNERS
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
if (signers.length < threshold || signers.some((value) => !/^0x[0-9a-fA-F]{40}$/u.test(value))) {
  throw new Error("GOVERNANCE_SIGNERS must contain enough comma-separated EVM addresses");
}
if (!/^(?:0x|sha256:)?[0-9a-fA-F]{64}$/u.test(process.env.FCC_CODE_HASH)) {
  throw new Error("FCC_CODE_HASH must be a 32-byte hexadecimal hash");
}

const escapeToml = (value) => value.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
const replacements = {
  INDEXER_DB_HOST: escapeToml(process.env.INDEXER_DB_HOST),
  INDEXER_DB_PORT: String(port),
  INDEXER_DB_NAME: escapeToml(process.env.INDEXER_DB_NAME),
  INDEXER_DB_USER: escapeToml(process.env.INDEXER_DB_USER),
  INDEXER_DB_PASSWORD: escapeToml(process.env.INDEXER_DB_PASSWORD),
  GOVERNANCE_SIGNERS_TOML: signers.map((value) => `"${value}"`).join(", "),
  GOVERNANCE_THRESHOLD: String(threshold),
  FCC_CODE_HASH: process.env.FCC_CODE_HASH,
};

let output = readFileSync(resolve(root, "proxy", "config.template.toml"), "utf8");
for (const [name, value] of Object.entries(replacements)) {
  output = output.replaceAll(`{{${name}}}`, value);
}
if (/\{\{[A-Z0-9_]+\}\}/u.test(output)) {
  throw new Error("proxy config contains unresolved template variables");
}

const target = resolve(root, "generated", "proxy.coston2.toml");
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, output, { encoding: "utf8", mode: 0o600 });
console.log(target);
