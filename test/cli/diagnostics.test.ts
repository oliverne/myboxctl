import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporaryDirectories: string[] = [];
afterEach(async () =>
  Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  ),
);

async function run(args: string[]) {
  const child = Bun.spawn(["bun", "run", "src/cli.ts", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, MYBOX_PAT: "mbx_pat_must-not-appear" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe("diagnostic CLI contract", () => {
  test("records a parse failure and exit code without secret-shaped values", async () => {
    const directory = await mkdtemp(join(tmpdir(), "myboxctl-cli-diagnostic-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "공백 log.jsonl");
    const result = await run(["info", "--json", "--diagnostic-log", path]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toBe("");
    const records = (await readFile(path, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(records.map((record) => record.type)).toEqual(["run-started", "run-completed"]);
    expect(records[1]).toMatchObject({ exitCode: 2, result: { ok: false, command: "info" } });
    expect(JSON.stringify(records)).not.toContain("mbx_pat_must-not-appear");
  });

  test("does not create a log for help and never overwrites an existing file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "myboxctl-cli-diagnostic-"));
    temporaryDirectories.push(directory);
    const helpPath = join(directory, "help.jsonl");
    expect((await run(["--diagnostic-log", helpPath, "--help"])).exitCode).toBe(0);
    await expect(stat(helpPath)).rejects.toMatchObject({ code: "ENOENT" });

    const existingPath = join(directory, "existing.jsonl");
    await writeFile(existingPath, "keep\n");
    const conflict = await run(["info", "/", "--json", "--diagnostic-log", existingPath]);
    expect(conflict.exitCode).toBe(7);
    expect(await readFile(existingPath, "utf8")).toBe("keep\n");
  });
});
