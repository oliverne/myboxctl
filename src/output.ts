import {
  type DomainError,
  type ErrorKind,
  exitCodeForKind,
  normalizeError,
  redactSensitiveText,
} from "./errors.ts";

export type CommandName =
  | "stat"
  | "ls"
  | "ensure-dir"
  | "upload"
  | "put"
  | "delete"
  | (string & {});

export type SuccessEnvelope<T> = {
  ok: true;
  command: CommandName;
  action: string;
  data: T;
};

export type FailureError = {
  kind: ErrorKind;
  message: string;
  retryable: boolean;
  code?: string;
  requestId?: string;
  retryAfterMs?: number;
};

export type FailureEnvelope = {
  ok: false;
  command: string;
  error: FailureError;
};

export type OutputEnvelope<T> = SuccessEnvelope<T> | FailureEnvelope;

/** Remove credential-shaped values before anything reaches stdout or stderr. */
export const redactSecrets = redactSensitiveText;

const REDACTED = "[REDACTED]";

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === "string") {
    return redactSecrets(value);
  }

  if (typeof value === "bigint") {
    return value.toString();
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return "[CIRCULAR]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    const result = value.map((item) => sanitizeValue(item, seen));
    seen.delete(value);
    return result;
  }

  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (
      /(?:authorization|password|secret|token|credential|uploadurl|downloadurl)/i.test(key) ||
      /^(?:pat)$/i.test(key)
    ) {
      result[key] = REDACTED;
    } else {
      result[key] = sanitizeValue(item, seen);
    }
  }
  seen.delete(value);
  return result;
}

export function sanitizeForOutput<T>(value: T): T {
  return sanitizeValue(value, new WeakSet<object>()) as T;
}

export function success<T>(command: CommandName, action: string, data: T): SuccessEnvelope<T> {
  return { ok: true, command, action, data };
}

export function failure(command: string, error: unknown): FailureEnvelope {
  const normalized = normalizeError(error);
  const serialized = normalized.toJSON();
  return {
    ok: false,
    command,
    error: serialized,
  };
}

export function renderJson(value: unknown): string {
  return `${JSON.stringify(sanitizeForOutput(value)) ?? "null"}\n`;
}

export function renderSuccess<T>(command: CommandName, action: string, data: T): string {
  return renderJson(success(command, action, data));
}

export function renderFailure(command: string, error: unknown): string {
  return renderJson(failure(command, error));
}

export function exitCodeForError(error: unknown): number {
  return exitCodeForKind(normalizeError(error).kind);
}

export function writeJson(value: unknown): void {
  process.stdout.write(renderJson(value));
}

export function writeSuccess<T>(command: CommandName, action: string, data: T): void {
  writeJson(success(command, action, data));
}

export function writeFailure(command: string, error: unknown): number {
  const normalized: DomainError = normalizeError(error);
  writeJson(failure(command, normalized));
  return exitCodeForKind(normalized.kind);
}
