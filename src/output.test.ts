import { describe, expect, test } from "bun:test";
import { ConfigError } from "./config.ts";
import { DomainError } from "./errors.ts";
import {
  failure,
  renderFailure,
  renderJson,
  renderSuccess,
  sanitizeForOutput,
  success,
} from "./output.ts";

describe("JSON output", () => {
  test("creates stable success and failure envelopes", () => {
    expect(success("info", "found", { resource: null })).toEqual({
      schemaVersion: 1,
      ok: true,
      command: "info",
      action: "found",
      data: { resource: null },
    });

    const error = new DomainError("not-found", "The remote resource was not found.", {
      code: "PLAT-404",
      requestId: "request-1",
      retryable: false,
    });
    expect(failure("info", error)).toEqual({
      schemaVersion: 1,
      ok: false,
      command: "info",
      error: {
        kind: "not-found",
        message: "The remote resource was not found.",
        retryable: false,
        code: "PLAT-404",
        requestId: "request-1",
        retryAfterMs: null,
      },
    });
  });

  test("renders exactly one trailing newline", () => {
    const output = renderSuccess("info", "found", { resource: null });
    expect(output.endsWith("\n")).toBe(true);
    expect(output.slice(0, -1).endsWith("\n")).toBe(false);
    expect(JSON.parse(output)).toMatchObject({ ok: true, action: "found" });
  });

  test("redacts PATs, authorization, signed URLs, and secret-shaped fields", () => {
    const output = renderJson({
      message:
        "Authorization: Bearer mbx_pat_abc123 and https://upload.example.test/file?stoken=signed-secret",
      authorization: "Bearer another-secret",
      uploadUrl: "https://upload.example.test/?token=secret",
      nested: { token: "secret-token" },
    });

    expect(output).not.toContain("mbx_pat_abc123");
    expect(output).not.toContain("signed-secret");
    expect(output).not.toContain("another-secret");
    expect(output).not.toContain("secret-token");
    expect(output).toContain("[REDACTED_URL]");
  });

  test("sanitizes repeated values without changing the envelope shape", () => {
    const value = { url: "https://example.test", path: "/agents/report.md", value: "plain" };
    expect(sanitizeForOutput(value)).toEqual({
      url: "[REDACTED_URL]",
      path: "/agents/report.md",
      value: "plain",
    });
    expect(renderFailure("unknown", new Error("internal details"))).toContain(
      '"kind":"unexpected"',
    );
  });

  test("keeps config failures in the argument error category", () => {
    const output = JSON.parse(renderFailure("config", new ConfigError("bad config")));
    expect(output).toMatchObject({
      ok: false,
      command: "config",
      error: { kind: "invalid-arguments" },
    });
  });

  test("exposes a safe retry delay for rate-limit callers", () => {
    const output = JSON.parse(
      renderFailure(
        "info",
        new DomainError("rate-limit", "MYBOX rate limit was exceeded.", {
          retryable: true,
          retryAfterMs: 60_000,
        }),
      ),
    );
    expect(output.error).toMatchObject({
      kind: "rate-limit",
      retryable: true,
      retryAfterMs: 60_000,
    });
  });
});
