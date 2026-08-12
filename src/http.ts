import {
  GenerationTimeoutError,
  GenerationTransportError,
  type GenerationTransportErrorDetails,
  type GenerationTransportStage,
} from "./errors.js";
import type { GenerationDebugConfig, GenerationDebugEvent } from "./types.js";

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
    try {
      const response = await fetchFn(input, init);
      await emitDebugResponse(debug, url, response, startedAt);
      return response;
    } catch (error) {
      const transportError = error instanceof GenerationTransportError ? error.cause : error;
      debug.logger({
        type: "transport_error",
        url,
        method: requestInit.method ?? "GET",
        elapsedMs: Date.now() - startedAt,
        error: transportErrorSummary(transportError) as GenerationDebugTransportError,
      });
      throw error;
    }
  }) as typeof fetch;
}

export type FetchWithTimeoutOptions = {
  stage?: GenerationTransportStage;
};

export async function fetchWithTimeout(
  fetchFn: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  options: FetchWithTimeoutOptions = {},
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    return await fetchFn(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new GenerationTimeoutError();
    throw new GenerationTransportError(
      transportErrorDetails(url, init, options.stage ?? "request", startedAt, error),
      error,
    );
  } finally {
    clearTimeout(timeout);
  }
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function transportErrorDetails(
  rawUrl: string,
  init: RequestInit,
  stage: GenerationTransportStage,
  startedAt: number,
  error: unknown,
): GenerationTransportErrorDetails {
  const url = new URL(rawUrl);
  const summary = transportErrorSummary(error);
  return dropUndefined({
    stage,
    method: (init.method ?? "GET").toUpperCase(),
    host: url.host,
    path: `${url.pathname}${url.search}`,
    elapsedMs: Date.now() - startedAt,
    responseReceived: false,
    causeName: summary.causeName ?? summary.name,
    causeCode: summary.causeCode,
    causeMessage: summary.causeMessage ?? summary.message,
    causeSyscall: summary.causeSyscall,
    causeAddress: summary.causeAddress,
    causePort: summary.causePort,
  }) as GenerationTransportErrorDetails;
}

function transportErrorSummary(error: unknown) {
  const outer = error instanceof Error ? error : new Error(String(error));
  const cause = outer.cause instanceof Error || isRecord(outer.cause) ? outer.cause : undefined;
  return dropUndefined({
    name: outer.name,
    message: outer.message,
    causeName: stringProperty(cause, "name"),
    causeCode: stringProperty(cause, "code"),
    causeMessage: stringProperty(cause, "message"),
    causeSyscall: stringProperty(cause, "syscall"),
    causeAddress: stringProperty(cause, "address"),
    causePort: stringOrNumberProperty(cause, "port"),
  });
}

type GenerationDebugTransportError = Extract<GenerationDebugEvent, { type: "transport_error" }>["error"];

function stringProperty(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return typeof item === "string" && item.trim() ? item.trim() : undefined;
}

function stringOrNumberProperty(value: unknown, key: string): string | number | undefined {
  if (!isRecord(value)) return undefined;
  const item = value[key];
  return typeof item === "string" || typeof item === "number" ? item : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function dropUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}
