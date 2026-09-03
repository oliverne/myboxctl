import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}

const dir = resolve(option("--dir") ?? "release/npm");
const result = spawnSync("npm", ["publish", "--access", "public", dir], { stdio: "inherit" });
if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
