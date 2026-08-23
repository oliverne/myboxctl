export const PUT_MTIME_TOLERANCE_MS = 2_000;

export type PutReason =
  | "remote-absent"
  | "size-different"
  | "local-newer"
  | "forced"
  | "remote-is-current"
  | "remote-newer"
  | "remote-type-conflict";

export type PutDecision =
  | { action: "upload"; reason: "remote-absent" | "forced" }
  | { action: "overwrite"; reason: "size-different" | "local-newer" | "forced" }
  | { action: "skip"; reason: "remote-is-current" }
  | { action: "conflict"; reason: "remote-newer" | "remote-type-conflict" };

export type PutDecisionInput = {
  force: boolean;
  local: { size: number; modifiedAtMs: number };
  remote:
    | { kind: "absent" }
    | { kind: "folder" }
    | { kind: "file"; size: number; modifiedAtMs: number };
  toleranceMs?: number;
};

export function decidePut(input: PutDecisionInput): PutDecision {
  if (input.remote.kind === "folder") {
    return { action: "conflict", reason: "remote-type-conflict" };
  }

  if (input.force) {
    return input.remote.kind === "absent"
      ? { action: "upload", reason: "forced" }
      : { action: "overwrite", reason: "forced" };
  }

  if (input.remote.kind === "absent") {
    return { action: "upload", reason: "remote-absent" };
  }

  const toleranceMs = input.toleranceMs ?? PUT_MTIME_TOLERANCE_MS;
  if (input.remote.modifiedAtMs - input.local.modifiedAtMs > toleranceMs) {
    return { action: "conflict", reason: "remote-newer" };
  }
  if (input.remote.size !== input.local.size) {
    return { action: "overwrite", reason: "size-different" };
  }
  if (input.local.modifiedAtMs - input.remote.modifiedAtMs > toleranceMs) {
    return { action: "overwrite", reason: "local-newer" };
  }
  return { action: "skip", reason: "remote-is-current" };
}
