import type { GenerationResultMeta, GenerationRouterCostHeaders, GenerationRouterNewApiMetadata } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArrayValue(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function headerString(headers: Headers, name: string): string | undefined {
  return headers.get(name) ?? undefined;
}

function hasKeys(value: object): boolean {
  return Object.keys(value).length > 0;
}

export function extractRouterNewApiMetadata(value: unknown): GenerationRouterNewApiMetadata | undefined {
  if (!isRecord(value) || !isRecord(value.new_api)) return undefined;
  const raw = value.new_api;
  const metadata: GenerationRouterNewApiMetadata = {};
  const requestId = stringValue(raw.request_id);
  const requestIds = stringArrayValue(raw.request_ids);
  const upstreamRequestId = stringValue(raw.upstream_request_id);
  const upstreamRequestIds = stringArrayValue(raw.upstream_request_ids);
  const taskId = stringValue(raw.task_id);
  const failureCategory = stringValue(raw.failure_category);
  const cost = numberValue(raw.cost);
  const costOrigin = numberValue(raw.cost_origin);
  if (requestId) metadata.requestId = requestId;
  if (requestIds) metadata.requestIds = requestIds;
  if (upstreamRequestId) metadata.upstreamRequestId = upstreamRequestId;
  if (upstreamRequestIds) metadata.upstreamRequestIds = upstreamRequestIds;
  if (taskId) metadata.taskId = taskId;
  if (failureCategory) metadata.failureCategory = failureCategory;
  if (cost !== undefined) metadata.cost = cost;
  if (costOrigin !== undefined) metadata.costOrigin = costOrigin;
  return hasKeys(metadata) ? metadata : undefined;
}

export function extractRouterCostHeaders(headers: Headers): GenerationRouterCostHeaders {
  const cost: GenerationRouterCostHeaders = {};
  const status = headerString(headers, "x-cost-status");
  if (status) cost.status = status;
  return cost;
}

export function extractRouterResultMeta(raw: unknown, headers?: Headers): GenerationResultMeta | undefined {
  const newApi = extractRouterNewApiMetadata(raw);
  const router = headers ? buildRouterHeaderMeta(headers) : undefined;
  const meta: GenerationResultMeta = {};
  if (newApi) meta.newApi = newApi;
  if (newApi?.cost !== undefined) meta.cost = newApi.cost;
  if (newApi?.costOrigin !== undefined) meta.costOrigin = newApi.costOrigin;
  if (router) meta.router = router;
  return hasKeys(meta) ? meta : undefined;
}

export function mergeGenerationResultMeta(
  first: GenerationResultMeta | undefined,
  second: GenerationResultMeta | undefined,
): GenerationResultMeta | undefined {
  if (!first) return second;
  if (!second) return first;
  const meta: GenerationResultMeta = { ...first, ...second };
  const newApi = { ...(first.newApi ?? {}), ...(second.newApi ?? {}) };
  const router = {
    ...(first.router?.requestId ? { requestId: first.router.requestId } : {}),
    ...(second.router?.requestId ? { requestId: second.router.requestId } : {}),
    ...(first.router?.taskId ? { taskId: first.router.taskId } : {}),
    ...(second.router?.taskId ? { taskId: second.router.taskId } : {}),
  };
  const routerCost = { ...(first.router?.cost ?? {}), ...(second.router?.cost ?? {}) };
  if (hasKeys(newApi)) meta.newApi = newApi;
  const cost = second.cost ?? first.cost;
  const costOrigin = second.costOrigin ?? first.costOrigin;
  if (cost !== undefined) meta.cost = cost;
  if (costOrigin !== undefined) meta.costOrigin = costOrigin;
  if (hasKeys(routerCost)) meta.router = { ...router, cost: routerCost };
  else if (hasKeys(router)) meta.router = router;
  return hasKeys(meta) ? meta : undefined;
}

function buildRouterHeaderMeta(headers: Headers): GenerationResultMeta["router"] | undefined {
  const requestId = headerString(headers, "x-request-id");
  const taskId = headerString(headers, "x-task-id");
  const cost = extractRouterCostHeaders(headers);
  if (!requestId && !taskId && !hasKeys(cost)) return undefined;
  return {
    ...(requestId ? { requestId } : {}),
    ...(taskId ? { taskId } : {}),
    ...(hasKeys(cost) ? { cost } : {}),
  };
}
