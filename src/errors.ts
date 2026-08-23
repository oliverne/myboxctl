export const ERROR_KINDS = [
  "invalid-arguments",
  "authentication",
  "not-found",
  "conflict",
  "rate-limit",
  "api-unavailable",
  "invalid-remote-path",
  "local-file",
  "local-file-changed",
  "unexpected",
] as const;

export type ErrorKind = (typeof ERROR_KINDS)[number];

export const EXIT_CODES: Record<ErrorKind, number> = {
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
};

const REDACTED = "[REDACTED]";
const REDACTED_URL = "[REDACTED_URL]";

export function redactSensitiveText(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"'<>]+/gi, REDACTED_URL)
    .replace(/(authorization\s*:\s*(?:bearer\s+)?)[^\s,;]+/gi, `$1${REDACTED}`)
    .replace(/\bbearer\s+[^\s,;]+/gi, `Bearer ${REDACTED}`)
    .replace(/\bmbx_pat_[^\s"'&,;]+/gi, REDACTED)
    .replace(/(stoken\s*[=:]\s*)[^\s"'&,;]+/gi, `$1${REDACTED}`);
}

export const redactSecrets = redactSensitiveText;

export type DomainErrorOptions = {
  code?: string;
  requestId?: string;
  retryable?: boolean;
  status?: number;
  retryAfterMs?: number;
  cause?: unknown;
};

export class DomainError extends Error {
  readonly kind: ErrorKind;
  readonly retryable: boolean;
  readonly code?: string;
  readonly requestId?: string;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(kind: ErrorKind, message: string, options: DomainErrorOptions = {}) {
    super(redactSensitiveText(message), { cause: options.cause });
    this.name = "DomainError";
    this.kind = kind;
    this.retryable = options.retryable ?? false;
    if (options.code !== undefined) {
      this.code = options.code;
    }
    if (options.requestId !== undefined) {
      this.requestId = options.requestId;
    }
    if (options.status !== undefined) {
      this.status = options.status;
    }
    if (options.retryAfterMs !== undefined) {
      this.retryAfterMs = options.retryAfterMs;
    }
  }

  toJSON(): {
    kind: ErrorKind;
    message: string;
    retryable: boolean;
    code?: string;
    requestId?: string;
    retryAfterMs?: number;
  } {
    const result: {
      kind: ErrorKind;
      message: string;
      retryable: boolean;
      code?: string;
      requestId?: string;
      retryAfterMs?: number;
    } = {
      kind: this.kind,
      message: this.message,
      retryable: this.retryable,
    };
    if (this.code !== undefined) {
      result.code = redactSensitiveText(this.code);
    }
    if (this.requestId !== undefined) {
      result.requestId = redactSensitiveText(this.requestId);
    }
    if (this.retryAfterMs !== undefined) {
      result.retryAfterMs = this.retryAfterMs;
    }
    return result;
  }
}

export function exitCodeForKind(kind: ErrorKind): number {
  return EXIT_CODES[kind];
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}

function apiErrorMessage(status: number): string {
  switch (status) {
    case 400:
    case 422:
      return "MYBOX rejected the request arguments.";
    case 401:
    case 403:
      return "MYBOX authentication or permission was rejected.";
    case 404:
      return "The remote resource was not found.";
    case 409:
      return "The remote resource conflicts with the requested operation.";
    case 429:
      return "MYBOX rate limit was exceeded.";
    case 423:
      return "The remote resource is temporarily locked.";
    case 507:
      return "MYBOX does not have enough available storage.";
    default:
      return "MYBOX is temporarily unavailable.";
  }
}

export function domainErrorForHttp(
  status: number,
  options: {
    code?: string;
    requestId?: string;
    retryable?: boolean;
    retryAfterMs?: number;
    cause?: unknown;
  } = {},
): DomainError {
  let kind: ErrorKind;
  switch (status) {
    case 400:
    case 422:
      kind = "invalid-arguments";
      break;
    case 401:
    case 403:
      kind = "authentication";
      break;
    case 404:
      kind = "not-found";
      break;
    case 409:
      kind = "conflict";
      break;
    case 429:
      kind = "rate-limit";
      break;
    case 507:
      kind = "conflict";
      break;
    default:
      kind = "api-unavailable";
      break;
  }

  const retryable = options.retryable ?? [429, 500, 502, 503].includes(status);
  const errorOptions: DomainErrorOptions = {
    retryable,
    status,
  };
  if (options.code !== undefined) {
    errorOptions.code = options.code;
  }
  if (options.requestId !== undefined) {
    errorOptions.requestId = options.requestId;
  }
  if (options.cause !== undefined) {
    errorOptions.cause = options.cause;
  }
  if (options.retryAfterMs !== undefined) {
    errorOptions.retryAfterMs = options.retryAfterMs;
  }
  return new DomainError(kind, apiErrorMessage(status), errorOptions);
}

export function apiResponseError(message = "MYBOX returned an invalid response."): DomainError {
  return new DomainError("api-unavailable", message, {
    code: "API_RESPONSE_INVALID",
    retryable: false,
  });
}

export function unexpectedError(cause?: unknown): DomainError {
  return new DomainError("unexpected", "An unexpected internal error occurred.", {
    cause,
    retryable: false,
  });
}

export function normalizeError(value: unknown): DomainError {
  if (value instanceof DomainError) {
    return value;
  }

  if (value instanceof Error) {
    const possibleKind = (value as { kind?: unknown }).kind;
    if (typeof possibleKind === "string" && ERROR_KINDS.includes(possibleKind as ErrorKind)) {
      return new DomainError(possibleKind as ErrorKind, value.message, {
        cause: value,
      });
    }

    if (value.name === "AbortError" || value.name === "TimeoutError") {
      return new DomainError("api-unavailable", "The MYBOX request timed out.", {
        retryable: true,
        cause: value,
      });
    }

    if (value instanceof TypeError) {
      return new DomainError("api-unavailable", "The MYBOX service could not be reached.", {
        retryable: true,
        cause: value,
      });
    }
  }

  return unexpectedError(value);
}
