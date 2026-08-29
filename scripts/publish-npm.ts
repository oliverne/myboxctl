import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "release/npm");
const directories = (await readdir(root, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && entry.name !== "oliverne-myboxctl")
  .map((entry) => join(root, entry.name))
  .toSorted();
directories.push(join(root, "oliverne-myboxctl"));

for (const directory of directories) {
  const child = Bun.spawn(["bun", "publish", "--access", "public"], {
    cwd: directory,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`npm publish failed for ${directory}.`);
  }
}
