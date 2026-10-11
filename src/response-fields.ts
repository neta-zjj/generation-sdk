import type { GenerationRequestIds } from "./errors.js";
import type { GenerationResult } from "./types.js";

export type GenerationResultFields = Omit<GenerationResult, "content">;

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export type GenerationResultHeaderFields = {
  requestId?: string;
  oneApiRequestId?: string;
};

export function extractGenerationResultHeaderFields(headers: Headers): GenerationResultHeaderFields | undefined {
  const requestId = headers.get("x-request-id")?.trim() || undefined;
  const oneApiRequestId = headers.get("x-oneapi-request-id")?.trim() || undefined;
  return requestId || oneApiRequestId
    ? { ...(requestId ? { requestId } : {}), ...(oneApiRequestId ? { oneApiRequestId } : {}) }
    : undefined;
}

export function extractGenerationResultFields(raw: unknown): GenerationResultFields | undefined {
  if (!isRecord(raw)) return undefined;
  const usage = isRecord(raw.usage) ? raw.usage : undefined;
  const fields: GenerationResultFields = {};
  const requestId = stringValue(raw.request_id);
  const cost = usage ? numberValue(usage.cost) : undefined;
  if (requestId !== undefined) fields.requestId = requestId;
  if (cost !== undefined) fields.cost = cost;
  return Object.keys(fields).length > 0 ? fields : undefined;
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((item) => stringValue(item) ?? []) : [];
}

/**
 * Router id from `new_api.request_id` / `X-Request-Id`; new-api ids from `new_api.upstream_request_id(s)`,
 * or from `X-Oneapi-Request-Id` when the client talks to new-api directly.
 */
export function extractGenerationRequestIds(headers: Headers, raw: unknown): GenerationRequestIds | undefined {
  const newApi = isRecord(raw) && isRecord(raw.new_api) ? raw.new_api : undefined;
  const requestId = stringValue(newApi?.request_id) ?? (headers.get("x-request-id")?.trim() || undefined);
  const upstreamRequestIds = [
    ...new Set([
      ...stringValues([newApi?.upstream_request_id]),
      ...stringValues(newApi?.upstream_request_ids),
      ...stringValues([headers.get("x-oneapi-request-id")?.trim()]),
    ]),
  ];
  if (!requestId && upstreamRequestIds.length === 0) return undefined;
  return { ...(requestId ? { requestId } : {}), upstreamRequestIds };
}
