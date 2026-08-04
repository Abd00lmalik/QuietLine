import { resolve } from "node:path";
import {
  parseEnv,
  requireValue,
  root,
  writeEnv,
} from "./lib.mjs";

const path = resolve(root, "fcc", ".env.coston2");
const current = parseEnv(path);
const user = requireValue(process.env, "INDEXER_DB_USER");
const password = requireValue(process.env, "INDEXER_DB_PASSWORD");

writeEnv(path, {
  ...current,
  INDEXER_DB_HOST: process.env.INDEXER_DB_HOST ?? "34.38.42.208",
  INDEXER_DB_PORT: process.env.INDEXER_DB_PORT ?? "3306",
  INDEXER_DB_NAME: process.env.INDEXER_DB_NAME ?? "indexer",
  INDEXER_DB_USER: user,
  INDEXER_DB_PASSWORD: password,
}, "Quietline Coston2 simulated judging deployment");

console.log("Configured the private Coston2 indexer connection");
