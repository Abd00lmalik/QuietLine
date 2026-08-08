import { root, run } from "./lib.mjs";

const sourceDateEpoch = run(
  "git",
  ["log", "-1", "--format=%ct"],
  { capture: true },
).trim();
const target = process.argv[2] ?? "all";

if (!["all", "extension", "relayer"].includes(target)) {
  throw new Error("image target must be all, extension, or relayer");
}
if (target !== "relayer") {
  run("docker", [
    "build",
    "--build-arg",
    `SOURCE_DATE_EPOCH=${sourceDateEpoch}`,
    "-t",
    "quietline-extension:v0.1.1",
    "extension",
  ]);
}
if (target !== "extension") {
  run("docker", [
    "build",
    "-f",
    "relayer/Dockerfile",
    "-t",
    "quietline-relayer:v0.1.1",
    ".",
  ], { cwd: root });
}
