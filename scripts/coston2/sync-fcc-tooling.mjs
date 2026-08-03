import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { root, run } from "./lib.mjs";

const metadata = JSON.parse(
  readFileSync(resolve(root, "fcc", "upstream-tooling.json"), "utf8"),
);
const target = resolve(root, ".cache", "fce-extension-scaffold");

if (!existsSync(resolve(target, ".git"))) {
  rmSync(target, { recursive: true, force: true });
  run("git", ["clone", "--filter=blob:none", metadata.repository, target]);
}
run("git", ["fetch", "--depth", "1", "origin", metadata.commit], { cwd: target });
run("git", ["checkout", "--detach", metadata.commit], { cwd: target });
const actual = run("git", ["rev-parse", "HEAD"], { cwd: target, capture: true }).trim();
if (actual !== metadata.commit) {
  throw new Error(`FCC tooling commit mismatch: expected ${metadata.commit}, got ${actual}`);
}
console.log(target);
