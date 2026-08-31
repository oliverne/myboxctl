import { describe, expect, setDefaultTimeout, test } from "bun:test";

const enabled = process.env.MYBOX_PHASE13_PROBE === "1" && Boolean(process.env.MYBOX_PAT);
const describeProbe = enabled ? describe : describe.skip;
if (enabled) {
  setDefaultTimeout(180_000);
}

describeProbe("MYBOX Phase 13 observability probe", () => {
  test("keeps stdout stable and reports only parseable safe JSONL events", async () => {
    const startedAt = Date.now();
    const subprocess = Bun.spawn(
      [
        "bun",
        "run",
        "src/cli.ts",
        "ensure-dir",
        "/myboxctl-integration-test/",
        "--json",
        "--verbose",
      ],
      {
        cwd: process.cwd(),
        env: process.env,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(subprocess.stdout).text(),
      new Response(subprocess.stderr).text(),
      subprocess.exited,
    ]);

    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, command: "ensure-dir" });
    const events = stderr
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    for (const event of events) {
      expect(event).toMatchObject({ type: "event", command: "ensure-dir" });
    }
    const combined = `${stdout}\n${stderr}`.toLowerCase();
    expect(combined).not.toContain("authorization");
    expect(combined).not.toContain("uploadurl");
    expect(combined).not.toContain("downloadurl");
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(0);
  });
});
