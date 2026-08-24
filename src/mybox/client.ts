import type { z } from "zod";
import { apiResponseError, DomainError, domainErrorForHttp } from "../errors.ts";
import {
  type CreateFolderResponse,
  type CreateUploadResponse,
  createFolderResponseSchema,
  createUploadResponseSchema,
  myboxErrorSchema,
  type ResourceDetail,
  type ResourceItem,
  type ResourceListResponse,
  resourceDetailSchema,
  resourceListResponseSchema,
  type SearchResourceItem,
  type SearchResourceListResponse,
  searchResourceListResponseSchema,
} from "./contract.ts";
import {
  fallbackRateLimitDelayMs,
  noOpRateLimiter,
  parseRetryAfterMs,
  type RequestRateLimiter,
  SEARCH_WINDOW_MS,
} from "./rate-limit.ts";

export const MAX_PAGE_COUNT = 1_000;
export const MAX_ATTEMPTS = 4;

export type ClientConfig = {
  pat: string;
  baseUrl: string;
  timeoutMs: number;
};

export type ClientDependencies = {
  fetch: typeof globalThis.fetch;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  rateLimiter: RequestRateLimiter;
};

type RequestOptions<T> = {
  query?: Record<string, string | number | undefined>;
  body?: Record<string, unknown>;
  schema?: z.ZodType<T>;
};

type ListOptions = {
  count?: number;
  cursor?: string;
};

type FolderListOptions = ListOptions & {
  sort?: string;
};

type BaseSearchOptions = ListOptions & {
  q?: string;
  parentPath?: string;
};

export type FileSearchOptions = BaseSearchOptions;

export type FolderSearchOptions = BaseSearchOptions & {
  path?: string;
};

export type CreateFolderInput = {
  folderName: string;
  parentId?: string;
};

type BaseCreateUploadInput = {
  fileName: string;
  fileSize: number;
  parentId?: string;
  isOverwrite?: boolean;
};

export type CreateUploadInput = BaseCreateUploadInput &
  ({ resume: true; modifiedTime: string } | { resume?: false; modifiedTime?: never });

const defaultDependencies: ClientDependencies = {
  fetch: globalThis.fetch,
  sleep: (ms) => Bun.sleep(ms),
  random: () => Math.random(),
  rateLimiter: noOpRateLimiter,
};

function isRetryableServiceStatus(status: number): boolean {
  return [500, 502, 503].includes(status);
}

function retryBackoffMs(attempt: number, random: () => number): number {
  const base = [500, 1_000, 2_000][attempt] ?? 2_000;
  const randomValue = Math.min(Math.max(random(), 0), 1);
  return base + Math.floor(base * 0.2 * randomValue);
}

async function bodyFromResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return undefined;
  }

  const contentType = response.headers.get("Content-Type")?.toLowerCase() ?? "";
  if (contentType.length > 0 && !contentType.includes("json")) {
    return text;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function networkError(cause: unknown): DomainError {
  return new DomainError("api-unavailable", "The MYBOX service could not be reached.", {
    retryable: true,
    cause,
  });
}

export class MyboxClient {
  readonly config: Omit<ClientConfig, "pat">;
  readonly dependencies: ClientDependencies;
  #pat: string;

  constructor(config: ClientConfig, dependencies: Partial<ClientDependencies> = {}) {
    this.#pat = config.pat;
    this.config = {
      baseUrl: config.baseUrl,
      timeoutMs: config.timeoutMs,
    };
    this.dependencies = {
      ...defaultDependencies,
      ...dependencies,
    };
  }

  private url(path: string, query?: RequestOptions<unknown>["query"]): URL {
    const url = new URL(path, this.config.baseUrl);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
    return url;
  }

  private async requestOnce<T>(
    method: string,
    path: string,
    options: RequestOptions<T>,
  ): Promise<{ response: Response; body: unknown }> {
    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${this.#pat}`,
    });
    let body: string | undefined;
    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
      body = JSON.stringify(options.body);
    }

    const request = { method, url: this.url(path, options.query) };
    await this.dependencies.rateLimiter.beforeRequest(request);
    const response = await this.dependencies.fetch(request.url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(this.config.timeoutMs),
    });
    await this.dependencies.rateLimiter.recordResponse(request, response);
    return { response, body: await bodyFromResponse(response) };
  }

  private parseError(response: Response, body: unknown): DomainError {
    const parsed = myboxErrorSchema.safeParse(body);
    const options: {
      code?: string;
      requestId?: string;
      retryAfterMs?: number;
      cause?: unknown;
    } = {};
    if (parsed.success) {
      options.code = parsed.data.code;
      if (parsed.data.requestId !== undefined) {
        options.requestId = parsed.data.requestId;
      }
    }
    if (response.status === 429) {
      options.retryAfterMs =
        parseRetryAfterMs(response.headers) ?? fallbackRateLimitDelayMs(this.dependencies.random);
    }
    return domainErrorForHttp(response.status, options);
  }

  async requestJson<T>(method: string, path: string, options: RequestOptions<T> = {}): Promise<T> {
    const isGet = method.toUpperCase() === "GET";
    let rateLimitRetries = 0;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      let result: { response: Response; body: unknown };
      try {
        result = await this.requestOnce(method, path, options);
      } catch (error) {
        if (error instanceof DomainError) {
          throw error;
        }
        if (isGet && attempt < MAX_ATTEMPTS - 1) {
          await this.dependencies.sleep(retryBackoffMs(attempt, this.dependencies.random));
          continue;
        }

        throw networkError(error);
      }

      if (result.response.status < 200 || result.response.status >= 300) {
        const mapped = this.parseError(result.response, result.body);
        if (isGet && result.response.status === 429 && rateLimitRetries < 1) {
          rateLimitRetries += 1;
          await this.dependencies.sleep(mapped.retryAfterMs ?? SEARCH_WINDOW_MS);
          continue;
        }
        if (
          isGet &&
          isRetryableServiceStatus(result.response.status) &&
          attempt < MAX_ATTEMPTS - 1
        ) {
          await this.dependencies.sleep(retryBackoffMs(attempt, this.dependencies.random));
          continue;
        }
        throw mapped;
      }

      if (options.schema === undefined) {
        return result.body as T;
      }

      const parsed = options.schema.safeParse(result.body);
      if (!parsed.success) {
        throw apiResponseError();
      }
      return parsed.data;
    }

    throw apiResponseError("MYBOX request retry limit was exceeded.");
  }

  async getResource(resourceId: string): Promise<ResourceDetail> {
    return this.requestJson("GET", `/v1/drive/resources/${encodeURIComponent(resourceId)}`, {
      schema: resourceDetailSchema,
    });
  }

  async listRootPage(options: ListOptions = {}): Promise<ResourceListResponse> {
    const query: Record<string, string | number | undefined> = {
      count: options.count ?? 1_000,
    };
    if (options.cursor !== undefined) {
      query.cursor = options.cursor;
    }
    return this.requestJson("GET", "/v1/drive/resources", {
      query,
      schema: resourceListResponseSchema,
    });
  }

  async listFolderPage(
    folderId: string,
    options: FolderListOptions = {},
  ): Promise<ResourceListResponse> {
    const query: Record<string, string | number | undefined> = {
      count: options.count ?? 1_000,
    };
    if (options.cursor !== undefined) {
      query.cursor = options.cursor;
    }
    if (options.sort !== undefined) {
      query.sort = options.sort;
    }
    return this.requestJson("GET", `/v1/drive/folders/${encodeURIComponent(folderId)}/resources`, {
      query,
      schema: resourceListResponseSchema,
    });
  }

  async searchFoldersPage(options: FolderSearchOptions = {}): Promise<SearchResourceListResponse> {
    const query: Record<string, string | number | undefined> = {
      count: options.count ?? 200,
    };
    for (const key of ["path", "q", "parentPath"] as const) {
      const value = options[key];
      if (value !== undefined) {
        query[key] = value;
      }
    }
    if (options.cursor !== undefined) {
      query.cursor = options.cursor;
    }
    return this.requestJson("GET", "/v1/search/resources/folders", {
      query,
      schema: searchResourceListResponseSchema,
    });
  }

  async searchFilesPage(options: FileSearchOptions = {}): Promise<SearchResourceListResponse> {
    const query: Record<string, string | number | undefined> = {
      count: options.count ?? 200,
    };
    for (const key of ["q", "parentPath"] as const) {
      const value = options[key];
      if (value !== undefined) {
        query[key] = value;
      }
    }
    if (options.cursor !== undefined) {
      query.cursor = options.cursor;
    }
    return this.requestJson("GET", "/v1/search/resources/files", {
      query,
      schema: searchResourceListResponseSchema,
    });
  }

  async listRoot(options: Omit<ListOptions, "cursor"> = {}): Promise<ResourceItem[]> {
    const resources: ResourceItem[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;

    for (let page = 0; page < MAX_PAGE_COUNT; page += 1) {
      const response = await this.listRootPage({ ...options, ...(cursor ? { cursor } : {}) });
      resources.push(...response.resources);
      const nextCursor = response.responseMetaData.nextCursor;
      if (nextCursor === undefined || nextCursor === null || nextCursor.length === 0) {
        return resources;
      }
      if (cursors.has(nextCursor)) {
        throw apiResponseError("MYBOX returned a repeated pagination cursor.");
      }
      cursors.add(nextCursor);
      cursor = nextCursor;
    }

    throw apiResponseError("MYBOX returned too many pagination pages.");
  }

  async listFolder(
    folderId: string,
    options: Omit<FolderListOptions, "cursor"> = {},
  ): Promise<ResourceItem[]> {
    const resources: ResourceItem[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;

    for (let page = 0; page < MAX_PAGE_COUNT; page += 1) {
      const response = await this.listFolderPage(folderId, {
        ...options,
        ...(cursor ? { cursor } : {}),
      });
      resources.push(...response.resources);
      const nextCursor = response.responseMetaData.nextCursor;
      if (nextCursor === undefined || nextCursor === null || nextCursor.length === 0) {
        return resources;
      }
      if (cursors.has(nextCursor)) {
        throw apiResponseError("MYBOX returned a repeated pagination cursor.");
      }
      cursors.add(nextCursor);
      cursor = nextCursor;
    }

    throw apiResponseError("MYBOX returned too many pagination pages.");
  }

  async searchFolders(options: Omit<FolderSearchOptions, "cursor"> = {}): Promise<SearchResourceItem[]> {
    return this.searchAll((pageOptions) => this.searchFoldersPage(pageOptions), options);
  }

  async searchFiles(options: Omit<FileSearchOptions, "cursor"> = {}): Promise<SearchResourceItem[]> {
    return this.searchAll((pageOptions) => this.searchFilesPage(pageOptions), options);
  }

  private async searchAll<T extends ListOptions>(
    loadPage: (options: T) => Promise<SearchResourceListResponse>,
    options: Omit<T, "cursor">,
  ): Promise<SearchResourceItem[]> {
    const resources: SearchResourceItem[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;

    for (let page = 0; page < MAX_PAGE_COUNT; page += 1) {
      const response = await loadPage({
        ...options,
        ...(cursor ? { cursor } : {}),
      } as T);
      resources.push(...response.resources);
      const nextCursor = response.responseMetaData.nextCursor;
      if (nextCursor === undefined || nextCursor === null || nextCursor.length === 0) {
        return resources;
      }
      if (cursors.has(nextCursor)) {
        throw apiResponseError("MYBOX returned a repeated pagination cursor.");
      }
      cursors.add(nextCursor);
      cursor = nextCursor;
    }

    throw apiResponseError("MYBOX returned too many pagination pages.");
  }

  async createFolder(input: CreateFolderInput): Promise<CreateFolderResponse> {
    const body: Record<string, unknown> = { folderName: input.folderName };
    if (input.parentId !== undefined) {
      body.parentId = input.parentId;
    }
    return this.requestJson("POST", "/v1/drive/folders", {
      body,
      schema: createFolderResponseSchema,
    });
  }

  async createUpload(input: CreateUploadInput): Promise<CreateUploadResponse> {
    const body: Record<string, unknown> = {
      fileName: input.fileName,
      fileSize: input.fileSize,
    };
    if (input.parentId !== undefined) {
      body.parentId = input.parentId;
    }
    if (input.isOverwrite !== undefined) {
      body.isOverwrite = input.isOverwrite;
    }
    if (input.resume !== undefined) {
      body.resume = input.resume;
    }
    if (input.modifiedTime !== undefined) {
      body.modifiedTime = input.modifiedTime;
    }
    return this.requestJson("POST", "/v1/drive/files", {
      body,
      schema: createUploadResponseSchema,
    });
  }

  async deleteResource(resourceId: string): Promise<void> {
    let result: { response: Response; body: unknown };
    try {
      result = await this.requestOnce(
        "DELETE",
        `/v1/drive/resources/${encodeURIComponent(resourceId)}`,
        {},
      );
    } catch (error) {
      if (error instanceof DomainError) {
        throw error;
      }
      throw networkError(error);
    }

    if (result.response.status === 204) {
      return;
    }
    if (result.response.status >= 200 && result.response.status < 300) {
      throw apiResponseError("MYBOX returned an unexpected delete success status.");
    }
    throw this.parseError(result.response, result.body);
  }

  /** Useful for tests and future commands that need a non-JSON 204 response. */
  async request<T>(method: string, path: string, options: RequestOptions<T> = {}): Promise<T> {
    return this.requestJson(method, path, options);
  }
}
