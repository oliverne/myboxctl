import { describe, expect, test } from "bun:test";

import { decidePut, PUT_MTIME_TOLERANCE_MS, type PutDecisionInput } from "./decision.ts";

const LOCAL = { size: 10, modifiedAtMs: 10_000 } as const;

describe("put decision", () => {
  const cases: Array<{
    name: string;
    input: PutDecisionInput;
    expected: ReturnType<typeof decidePut>;
  }> = [
    {
      name: "force uploads an absent target",
      input: { force: true, local: LOCAL, remote: { kind: "absent" } },
      expected: { action: "upload", reason: "forced" },
    },
    {
      name: "force overwrites a file",
      input: {
        force: true,
        local: LOCAL,
        remote: { kind: "file", size: 10, modifiedAtMs: 99_000 },
      },
      expected: { action: "overwrite", reason: "forced" },
    },
    {
      name: "force never replaces a folder",
      input: { force: true, local: LOCAL, remote: { kind: "folder" } },
      expected: { action: "conflict", reason: "remote-type-conflict" },
    },
    {
      name: "uploads an absent target",
      input: { force: false, local: LOCAL, remote: { kind: "absent" } },
      expected: { action: "upload", reason: "remote-absent" },
    },
    {
      name: "never replaces a folder",
      input: { force: false, local: LOCAL, remote: { kind: "folder" } },
      expected: { action: "conflict", reason: "remote-type-conflict" },
    },
    {
      name: "remote newer wins over a size difference",
      input: {
        force: false,
        local: LOCAL,
        remote: {
          kind: "file",
          size: 20,
          modifiedAtMs: LOCAL.modifiedAtMs + PUT_MTIME_TOLERANCE_MS + 1,
        },
      },
      expected: { action: "conflict", reason: "remote-newer" },
    },
    {
      name: "overwrites a different size",
      input: {
        force: false,
        local: LOCAL,
        remote: { kind: "file", size: 20, modifiedAtMs: LOCAL.modifiedAtMs },
      },
      expected: { action: "overwrite", reason: "size-different" },
    },
    {
      name: "overwrites when local is newer outside tolerance",
      input: {
        force: false,
        local: LOCAL,
        remote: {
          kind: "file",
          size: 10,
          modifiedAtMs: LOCAL.modifiedAtMs - PUT_MTIME_TOLERANCE_MS - 1,
        },
      },
      expected: { action: "overwrite", reason: "local-newer" },
    },
    {
      name: "skips identical metadata",
      input: {
        force: false,
        local: LOCAL,
        remote: { kind: "file", size: 10, modifiedAtMs: LOCAL.modifiedAtMs },
      },
      expected: { action: "skip", reason: "remote-is-current" },
    },
    {
      name: "skips at the remote-newer tolerance boundary",
      input: {
        force: false,
        local: LOCAL,
        remote: {
          kind: "file",
          size: 10,
          modifiedAtMs: LOCAL.modifiedAtMs + PUT_MTIME_TOLERANCE_MS,
        },
      },
      expected: { action: "skip", reason: "remote-is-current" },
    },
    {
      name: "skips at the local-newer tolerance boundary",
      input: {
        force: false,
        local: LOCAL,
        remote: {
          kind: "file",
          size: 10,
          modifiedAtMs: LOCAL.modifiedAtMs - PUT_MTIME_TOLERANCE_MS,
        },
      },
      expected: { action: "skip", reason: "remote-is-current" },
    },
    {
      name: "skips one millisecond inside the boundary",
      input: {
        force: false,
        local: LOCAL,
        remote: {
          kind: "file",
          size: 10,
          modifiedAtMs: LOCAL.modifiedAtMs + PUT_MTIME_TOLERANCE_MS - 1,
        },
      },
      expected: { action: "skip", reason: "remote-is-current" },
    },
  ];

  for (const fixture of cases) {
    test(fixture.name, () => {
      expect(decidePut(fixture.input)).toEqual(fixture.expected);
    });
  }
});
