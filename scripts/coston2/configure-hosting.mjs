import { resolve } from "node:path";
import {
  parseEnv,
  requireValue,
  root,
  writeEnv,
} from "./lib.mjs";

const fccProxyUrl = requireValue(
  process.env,
  "FCC_PROXY_URL",
  /^https:\/\/[^/]+(?:\/.*)?$/u,
).replace(/\/+$/u, "");
const relayerUrl = requireValue(
  process.env,
  "RELAYER_URL",
  /^https:\/\/[^/]+(?:\/.*)?$/u,
).replace(/\/+$/u, "");

const rootPath = resolve(root, ".env");
const relayerPath = resolve(root, "relayer", ".env");
const frontendPath = resolve(root, "frontend", ".env.production");
const fccPath = resolve(root, "fcc", ".env.coston2");

writeEnv(rootPath, {
  ...parseEnv(rootPath),
  FCC_PROXY_URL: fccProxyUrl,
  RELAYER_URL: relayerUrl,
}, "Quietline Coston2 contract deployment");
writeEnv(relayerPath, {
  ...parseEnv(relayerPath),
  FCC_PROXY_URL: fccProxyUrl,
}, "Quietline Coston2 relayer");
writeEnv(frontendPath, {
  ...parseEnv(frontendPath),
  VITE_RELAYER_URL: relayerUrl,
}, "Quietline Coston2 frontend");
writeEnv(fccPath, {
  ...parseEnv(fccPath),
  EXT_PROXY_URL: fccProxyUrl,
}, "Quietline real FCC deployment");

console.log("Synchronized the public FCC proxy and relayer URLs across private environment files");
