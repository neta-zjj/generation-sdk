import { GenerationTimeoutError } from "./errors.js";
import type { GenerationDebugConfig } from "./types.js";

function headersToRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const output: Record<string, string> = {};
    headers.forEach((value, key) => {
      output[key] = value;
    });
    return output;
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers.map(([key, value]) => [key, value]));
  return { ...headers };
}

function parseJsonBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function parseDebugBody(body: BodyInit | null | undefined): unknown {
  if (typeof body !== "string") return body ? "[non-string body]" : undefined;
  return parseJsonBody(body);
}

const TRACE_HEADER_PATTERN =
  /(^|[-_])(request|trace|span|correlation|cf-ray|x-tt-logid)([-_]|$)|^(x-request-id|x-trace-id|x-correlation-id|traceparent|tracestate|cf-ray|server-timing)$/i;

function pickTraceHeaders(headers: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (TRACE_HEADER_PATTERN.test(key)) output[key] = value;
  }
  return output;
}

function emitDebugRequest(debug: GenerationDebugConfig, url: string, init: RequestInit): number {
  debug.logger({
    type: "request",
    url,
    method: init.method ?? "GET",
    headers: headersToRecord(init.headers),
    body: parseDebugBody(init.body),
  });
  return Date.now();
}

async function readDebugResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json") || contentType.includes("+json")) {
    return parseJsonBody(await response.clone().text());
  }
  if (contentType.startsWith("text/")) return response.clone().text();
  return "[non-text body]";
}

async function emitDebugResponse(
  debug: GenerationDebugConfig,
  url: string,
  response: Response,
  startedAt: number,
): Promise<void> {
  const headers = headersToRecord(response.headers);
  debug.logger({
    type: "response",
    url,
    status: response.status,
    statusText: response.statusText,
    headers,
    trace: pickTraceHeaders(headers),
    elapsedMs: Date.now() - startedAt,
    ...(debug.includeResponseBody ? { body: await readDebugResponseBody(response) } : {}),
  });
}

export function createDebugFetch(fetchFn: typeof fetch, debug: GenerationDebugConfig): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const requestInit = init ?? (input instanceof Request ? input : {});
    const startedAt = emitDebugRequest(debug, url, requestInit);
    const response = await fetchFn(input, init);
    await emitDebugResponse(debug, url, response, startedAt);
    return response;
  }) as typeof fetch;
}

export async function fetchWithTimeout(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new GenerationTimeoutError();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}
