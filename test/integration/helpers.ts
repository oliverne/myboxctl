import {
  defaultRateLimitStatePath,
  fallbackRateLimitDelayMs,
  parseRetryAfterMs,
  SharedRateLimiter,
} from "../../src/mybox/rate-limit.ts";

export const DEFAULT_BASE_URL = "https://open-api.mybox.naver.com";

export type JsonRecord = Record<string, unknown>;

export type ApiResponse = {
  status: number;
  headers: Headers;
  body: unknown;
};

const OBSERVABILITY_EVENT_DATA_KEYS: Record<string, ReadonlySet<string>> = {
  "rate-limit.wait-started": new Set(["operation", "waitMs", "reason"]),
  "rate-limit.wait-completed": new Set(["operation", "waitMs", "reason"]),
  "http.retry-scheduled": new Set(["operation", "attempt", "waitMs", "delaySource", "status"]),
  "http.retry-completed": new Set(["operation", "attempt", "waitMs", "delaySource", "status"]),
  "upload.stage-started": new Set(["stage", "elapsedMs"]),
  "upload.stage-completed": new Set(["stage", "elapsedMs"]),
  "upload.transfer-started": new Set([
    "transferredBytes",
    "totalBytes",
    "percent",
    "offset",
    "elapsedMs",
  ]),
  "upload.transfer-progress": new Set([
    "transferredBytes",
    "totalBytes",
    "percent",
    "offset",
    "elapsedMs",
  ]),
  "upload.transfer-completed": new Set([
    "transferredBytes",
    "totalBytes",
    "percent",
    "offset",
    "elapsedMs",
  ]),
  "upload.resume": new Set(["offset", "totalBytes"]),
  "download.transfer-started": new Set([
    "transferredBytes",
    "totalBytes",
    "percent",
    "elapsedMs",
    "relativePath",
    "filesCompleted",
    "totalFiles",
  ]),
  "download.transfer-progress": new Set([
    "transferredBytes",
    "totalBytes",
    "percent",
    "elapsedMs",
    "relativePath",
    "filesCompleted",
    "totalFiles",
  ]),
  "download.transfer-completed": new Set([
    "transferredBytes",
    "totalBytes",
    "percent",
    "elapsedMs",
    "relativePath",
    "filesCompleted",
    "totalFiles",
  ]),
  "download.quota-advisory": new Set(["plan", "isDefault", "expectedDownloads", "dailyLimit"]),
};

const OBSERVABILITY_EVENT_KEYS = new Set(["type", "level", "event", "command", "data"]);

const UNSAFE_EVENT_TEXT =
  /authorization|bearer\s+|uploadurl|downloadurl|[?&](?:signature|token|key)=/i;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseSafeCliEvents(stderr: string, command: string): JsonRecord[] {
  const events = stderr
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as unknown);

  for (const event of events) {
    if (!isRecord(event)) {
      throw new Error(`${command} CLI emitted a non-object stderr event`);
    }
    if (
      event.type !== "event" ||
      event.command !== command ||
      (event.level !== "info" && event.level !== "warning") ||
      typeof event.event !== "string" ||
      OBSERVABILITY_EVENT_DATA_KEYS[event.event] === undefined ||
      !isRecord(event.data)
    ) {
      throw new Error(`${command} CLI emitted an invalid stderr event`);
    }
    const allowedDataKeys = OBSERVABILITY_EVENT_DATA_KEYS[event.event];
    if (
      Object.keys(event).some((key) => !OBSERVABILITY_EVENT_KEYS.has(key)) ||
      Object.keys(event.data).some((key) => !allowedDataKeys?.has(key))
    ) {
      throw new Error(`${command} CLI emitted a non-allowlisted stderr event field`);
    }
    const serialized = JSON.stringify(event);
    if (
      UNSAFE_EVENT_TEXT.test(serialized) ||
      (process.env.MYBOX_PAT !== undefined && serialized.includes(process.env.MYBOX_PAT))
    ) {
      throw new Error(`${command} CLI emitted unsafe stderr event data`);
    }
  }

  return events as JsonRecord[];
}

export function asString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`MYBOX response field ${field} is missing or invalid`);
  }

  return value;
}

export function asNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`MYBOX response field ${field} is missing or invalid`);
  }

  return value;
}

export function asArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`MYBOX response field ${field} is missing or invalid`);
  }

  return value;
}

export function pathWithTrailingSlash(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

export function joinRemotePath(parent: string, child: string): string {
  return `${pathWithTrailingSlash(parent)}${child}`;
}

const integrationRateLimiter = new SharedRateLimiter({
  statePath: defaultRateLimitStatePath(),
});

function parseBody(text: string): unknown {
  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return "<non-json-body>";
  }
}

function responseError(response: ApiResponse, operation: string): Error {
  const body = isRecord(response.body) ? response.body : {};
  const code = typeof body.code === "string" ? body.code : "unknown-code";
  const requestId = typeof body.requestId === "string" ? body.requestId : "unknown-request";

  return new Error(
    `${operation} failed with HTTP ${response.status} (${code}, request ${requestId})`,
  );
}

export async function apiRequest(
  path: string,
  options: {
    method?: string;
    query?: Record<string, string | undefined>;
    body?: JsonRecord;
    pat?: string;
    baseUrl?: string;
  } = {},
): Promise<ApiResponse> {
  const pat = options.pat ?? process.env.MYBOX_PAT;
  if (!pat) {
    throw new Error("MYBOX_PAT is required for integration tests");
  }

  const url = new URL(path, options.baseUrl ?? process.env.MYBOX_BASE_URL ?? DEFAULT_BASE_URL);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }

  const headers = new Headers({ Authorization: `Bearer ${pat}` });
  if (options.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const method = options.method ?? "GET";
  const request = { method, url };
  await integrationRateLimiter.beforeRequest(request);
  const response = await fetch(url, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(Number(process.env.MYBOX_TIMEOUT_MS ?? 30_000)),
  });
  await integrationRateLimiter.recordResponse(request, response);

  return {
    status: response.status,
    headers: response.headers,
    body: parseBody(await response.text()),
  };
}

function retryDelayMs(status: number, headers: Headers, attempt: number): number {
  if (status === 429) {
    return parseRetryAfterMs(headers) ?? fallbackRateLimitDelayMs(() => Math.random());
  }

  return [2_000, 4_000, 8_000][attempt] ?? 8_000;
}

export async function readRequest(
  path: string,
  options: {
    query?: Record<string, string | undefined>;
    pat?: string;
    baseUrl?: string;
  } = {},
): Promise<ApiResponse> {
  let rateLimitRetries = 0;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await apiRequest(path, options);
      if (![429, 500, 502, 503].includes(response.status) || attempt === 3) {
        return response;
      }

      if (response.status === 429) {
        if (rateLimitRetries >= 1) {
          return response;
        }
        rateLimitRetries += 1;
      }

      await Bun.sleep(retryDelayMs(response.status, response.headers, attempt));
    } catch (error) {
      if (attempt === 3) {
        throw error;
      }

      await Bun.sleep([2_000, 4_000, 8_000][attempt] ?? 8_000);
    }
  }

  throw new Error(`read ${path} exhausted its retry attempts`);
}

export async function uploadBytes(
  uploadUrl: string,
  fileName: string,
  bytes: Uint8Array,
  options: { contentRange?: string } = {},
): Promise<{ status: number; headers: Headers; body: unknown }> {
  const boundary = `----myboxctl-${crypto.randomUUID()}`;
  const encoder = new TextEncoder();
  const escapedFileName = fileName.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const header = encoder.encode(
    `--${boundary}\r\nContent-Disposition: form-data; name="Filedata"; filename="${escapedFileName}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const footer = encoder.encode(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(header.byteLength + bytes.byteLength + footer.byteLength);
  body.set(header, 0);
  body.set(bytes, header.byteLength);
  body.set(footer, header.byteLength + bytes.byteLength);

  const headers = new Headers({
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
    "Content-Length": String(body.byteLength),
  });
  if (options.contentRange !== undefined) {
    headers.set("Content-Range", options.contentRange);
  }

  const response = await fetch(uploadUrl, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(Number(process.env.MYBOX_TIMEOUT_MS ?? 30_000)),
  });

  return {
    status: response.status,
    headers: response.headers,
    body: parseBody(await response.text()),
  };
}

export function assertStatus(
  response: ApiResponse,
  expected: number | number[],
  operation: string,
): void {
  const expectedStatuses = Array.isArray(expected) ? expected : [expected];
  if (!expectedStatuses.includes(response.status)) {
    throw responseError(response, operation);
  }
}

export function assertOkStatus(status: number, operation: string): void {
  if (status < 200 || status >= 300) {
    throw new Error(`${operation} failed with HTTP ${status}`);
  }
}

export function resourceId(resource: unknown, context: string): string {
  if (!isRecord(resource)) {
    throw new Error(`${context} is not an object`);
  }

  return asString(resource.resourceId, `${context}.resourceId`);
}

export async function listPages(
  path: string,
  query: Record<string, string>,
): Promise<{ pages: JsonRecord[]; resources: unknown[] }> {
  const pages: JsonRecord[] = [];
  const resources: unknown[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;

  for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
    const response = await readRequest(path, {
      query: { ...query, cursor },
    });
    assertStatus(response, 200, `list ${path}`);
    if (!isRecord(response.body)) {
      throw new Error(`list ${path} returned a non-object response`);
    }

    pages.push(response.body);
    const pageResources = asArray(response.body.resources, `${path}.resources`);
    resources.push(...pageResources);

    const metadata = response.body.responseMetaData;
    if (
      !isRecord(metadata) ||
      typeof metadata.nextCursor !== "string" ||
      metadata.nextCursor.length === 0
    ) {
      break;
    }

    if (cursors.has(metadata.nextCursor)) {
      throw new Error(`list ${path} returned a repeated cursor`);
    }

    cursors.add(metadata.nextCursor);
    cursor = metadata.nextCursor;
  }

  if (pages.length === 100) {
    throw new Error(`list ${path} exceeded the pagination safety limit`);
  }

  return { pages, resources };
}

export function exactPathResource(resources: unknown[], path: string): JsonRecord | undefined {
  return resources.find((resource): resource is JsonRecord => {
    if (!isRecord(resource)) {
      return false;
    }

    return resource.path === path || resource.path === pathWithTrailingSlash(path);
  });
}

export function safeHeaderNames(headers: Headers): string[] {
  return [...headers.keys()].sort();
}

export function timestampPrecision(value: string): string {
  const match = value.match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/);
  if (match?.[1] !== undefined) {
    return `${match[1].length}-fraction-digits`;
  }

  return /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? "second-precision" : "unknown";
}
