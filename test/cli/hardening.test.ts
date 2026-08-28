import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createFakeHttpServer, type FakeHttpServer } from "../http/server.ts";

const servers: FakeHttpServer[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.close();
  }
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function runCli(args: string[], baseUrl: string) {
  const subprocess = Bun.spawn(["bun", "run", "src/cli.ts", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      MYBOX_PAT: "mbx_pat_TEST_ONLY_SECRET",
      MYBOX_BASE_URL: baseUrl,
      MYBOX_TIMEOUT_MS: "5000",
      MYBOX_RATE_LIMIT_STATE_PATH: join(
        tmpdir(),
        `myboxctl-hardening-rate-limit-${crypto.randomUUID()}.json`,
      ),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited,
  ]);
  return { exitCode, stdout, stderr };
}

describe("cross-command CLI hardening", () => {
  test("every command preserves final 429 JSON, exit code, and redaction", async () => {
    const directory = await mkdtemp(join(tmpdir(), "myboxctl-hardening-"));
    directories.push(directory);
    const localPath = join(directory, "한글 # + report.txt");
    await writeFile(localPath, "content");

    const server = await createFakeHttpServer({
      handler: () => ({
        status: 429,
        headers: { "Retry-After": "0" },
        body: {
          code: "mbx_pat_RESPONSE_SECRET",
          message: "https://signed.example.test/upload?stoken=response-secret",
          requestId: "request-429",
        },
      }),
    });
    servers.push(server);

    const cases = [
      { command: "stat", args: ["stat", "/한글 # +.txt", "--json"] },
      { command: "ls", args: ["ls", "/", "--json"] },
      { command: "ensure-dir", args: ["ensure-dir", "/한글 # +", "--json"] },
      { command: "upload", args: ["upload", localPath, "/한글 # +.txt", "--json"] },
      { command: "put", args: ["put", localPath, "/한글 # +.txt", "--json"] },
      {
        command: "download",
        args: ["download", "/한글 # +.txt", join(directory, "download.txt"), "--json"],
      },
      { command: "delete", args: ["delete", "/한글 # +.txt", "--json"] },
    ];

    for (const testCase of cases) {
      const result = await runCli(testCase.args, server.baseUrl);
      expect(result.exitCode).toBe(8);
      expect(result.stderr).toBe("");
      expect(result.stdout.trim().split("\n")).toHaveLength(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: false,
        command: testCase.command,
        error: {
          kind: "rate-limit",
          retryable: true,
          code: "[REDACTED]",
          requestId: "request-429",
          retryAfterMs: 0,
        },
      });
      expect(result.stdout).not.toContain("TEST_ONLY_SECRET");
      expect(result.stdout).not.toContain("RESPONSE_SECRET");
      expect(result.stdout).not.toContain("signed.example.test");
      expect(result.stdout).not.toContain("response-secret");
    }
  });
});
