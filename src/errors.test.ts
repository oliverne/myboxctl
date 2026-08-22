import { describe, expect, test } from "bun:test";

import {
  DomainError,
  domainErrorForHttp,
  ERROR_KINDS,
  EXIT_CODES,
  normalizeError,
} from "./errors.ts";

describe("domain errors", () => {
  test("maps every public kind to the documented exit code", () => {
    expect(ERROR_KINDS).toHaveLength(10);
    expect(EXIT_CODES).toEqual({
      "invalid-arguments": 2,
      authentication: 3,
      "not-found": 4,
      conflict: 5,
      "rate-limit": 8,
      "api-unavailable": 6,
      "invalid-remote-path": 2,
      "local-file": 7,
      "local-file-changed": 7,
      unexpected: 70,
    });
  });

  test("maps HTTP status without exposing the API message", () => {
    const error = domainErrorForHttp(401, {
      code: "PLAT-401",
      requestId: "request-123",
    });

    expect(error).toBeInstanceOf(DomainError);
    expect(error.kind).toBe("authentication");
    expect(error.retryable).toBe(false);
    expect(error.toJSON()).toEqual({
      kind: "authentication",
      message: "MYBOX authentication or permission was rejected.",
      retryable: false,
      code: "PLAT-401",
      requestId: "request-123",
    });
    expect(error.toJSON()).not.toHaveProperty("cause");
  });

  test("marks rate limits and transient API statuses retryable", () => {
    expect(domainErrorForHttp(429).kind).toBe("rate-limit");
    expect(domainErrorForHttp(429).retryable).toBe(true);
    expect(domainErrorForHttp(503).kind).toBe("api-unavailable");
    expect(domainErrorForHttp(503).retryable).toBe(true);
    expect(domainErrorForHttp(409).retryable).toBe(false);
  });

  test("normalizes unknown failures to the stable unexpected error", () => {
    const error = normalizeError(new Error("PAT mbx_pat_should-not-appear"));
    expect(error.kind).toBe("unexpected");
    expect(error.message).toBe("An unexpected internal error occurred.");
    expect(JSON.stringify(error.toJSON())).not.toContain("mbx_pat_should-not-appear");
  });

  test("redacts secrets from serialized domain errors", () => {
    const error = new DomainError(
      "api-unavailable",
      "Authorization: Bearer mbx_pat_hidden https://upload.test/?stoken=hidden",
      { code: "https://api.test/?token=hidden", requestId: "request-1" },
    );
    const serialized = JSON.stringify(error);
    expect(serialized).not.toContain("mbx_pat_hidden");
    expect(serialized).not.toContain("stoken=hidden");
    expect(serialized).not.toContain("https://api.test");
  });
});
