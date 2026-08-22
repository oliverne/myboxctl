export type RecordedRequest = {
  method: string;
  url: string;
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body: Uint8Array;
  bodyText: string;
};

export type ScriptedResponse = {
  status?: number;
  headers?: Headers | Record<string, string>;
  body?: unknown;
  rawBody?: string | Uint8Array;
};

export type FakeResponseHandler = (
  request: RecordedRequest,
  requestIndex: number,
) => ScriptedResponse | Response | Promise<ScriptedResponse | Response>;

export type FakeHttpServerOptions = {
  responses?: ScriptedResponse[];
  handler?: FakeResponseHandler;
  defaultResponse?: ScriptedResponse;
};

export type FakeHttpServer = {
  readonly baseUrl: string;
  readonly url: string;
  readonly requests: RecordedRequest[];
  close(): void;
  stop(): void;
};

function responseFromScript(script: ScriptedResponse): Response {
  const headers = new Headers(script.headers);
  let body: string | Uint8Array | null = null;

  if (script.rawBody !== undefined) {
    body = typeof script.rawBody === "string" ? script.rawBody : script.rawBody;
  } else if (script.body !== undefined) {
    body = JSON.stringify(script.body);
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
  }

  return new Response(body, {
    status: script.status ?? 200,
    headers,
  });
}

export async function createFakeHttpServer(
  input: FakeHttpServerOptions | ScriptedResponse[] = {},
): Promise<FakeHttpServer> {
  const options: FakeHttpServerOptions = Array.isArray(input) ? { responses: input } : input;
  const scriptedResponses = options.responses ?? [];
  const requests: RecordedRequest[] = [];
  const defaultResponse = options.defaultResponse ?? {
    status: 500,
    body: { code: "FAKE_UNSCRIPTED", message: "No scripted fake response." },
  };
  let requestIndex = 0;

  const server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      const bytes = new Uint8Array(await request.arrayBuffer());
      const url = new URL(request.url);
      const recorded: RecordedRequest = {
        method: request.method,
        url: request.url,
        path: url.pathname,
        query: url.searchParams,
        headers: Object.fromEntries(request.headers.entries()),
        body: bytes,
        bodyText: new TextDecoder().decode(bytes),
      };
      requests.push(recorded);

      const responseScript = options.handler
        ? await options.handler(recorded, requestIndex)
        : (scriptedResponses[requestIndex] ?? defaultResponse);
      requestIndex += 1;

      return responseScript instanceof Response
        ? responseScript
        : responseFromScript(responseScript);
    },
  });

  const baseUrl = server.url.toString().replace(/\/$/, "");
  return {
    baseUrl,
    url: baseUrl,
    requests,
    close: () => server.stop(true),
    stop: () => server.stop(true),
  };
}
