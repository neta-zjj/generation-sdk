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

function headerNumber(headers: Headers, name: string): number | undefined {
  const value = headers.get(name);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

export function extractRouterCostHeaders(headers: Headers): GenerationRouterCostHeaders {
  const cost: GenerationRouterCostHeaders = {};
  const status = headerString(headers, "x-cost-status");
  const quota = headerNumber(headers, "x-cost-quota");
  const promptTokens = headerNumber(headers, "x-cost-prompt-tokens");
  const completionTokens = headerNumber(headers, "x-cost-completion-tokens");
  const totalTokens = headerNumber(headers, "x-cost-total-tokens");
  const originUpstreamModel = headerString(headers, "x-cost-origin-upstream-model");
  if (status) cost.status = status;
  if (quota !== undefined) cost.quota = quota;
  if (promptTokens !== undefined) cost.promptTokens = promptTokens;
  if (completionTokens !== undefined) cost.completionTokens = completionTokens;
  if (totalTokens !== undefined) cost.totalTokens = totalTokens;
  if (originUpstreamModel) cost.originUpstreamModel = originUpstreamModel;
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
  return Object.keys(meta).length > 0 ? meta : undefined;
}

export function mergeGenerationResultMeta(
  first: GenerationResultMeta | undefined,
  second: GenerationResultMeta | undefined,
): GenerationResultMeta | undefined {
  if (!first) return second;
  if (!second) return first;
  const meta: GenerationResultMeta = { ...first, ...second };
  const newApi = { ...(first.newApi ?? {}), ...(second.newApi ?? {}) };
  const routerCost = { ...(first.router?.cost ?? {}), ...(second.router?.cost ?? {}) };
  if (Object.keys(newApi).length > 0) meta.newApi = newApi;
  const cost = second.cost ?? first.cost;
  const costOrigin = second.costOrigin ?? first.costOrigin;
  if (cost !== undefined) meta.cost = cost;
  if (costOrigin !== undefined) meta.costOrigin = costOrigin;
  if (Object.keys(routerCost).length > 0) {
    meta.router = {
      ...(first.router?.requestId ? { requestId: first.router.requestId } : {}),
      ...(second.router?.requestId ? { requestId: second.router.requestId } : {}),
      ...(first.router?.taskId ? { taskId: first.router.taskId } : {}),
      ...(second.router?.taskId ? { taskId: second.router.taskId } : {}),
      cost: routerCost,
    };
  }
  return Object.keys(meta).length > 0 ? meta : undefined;
}

function buildRouterHeaderMeta(headers: Headers): GenerationResultMeta["router"] | undefined {
  const requestId = headerString(headers, "x-request-id");
  const taskId = headerString(headers, "x-task-id");
  const cost = extractRouterCostHeaders(headers);
  if (!requestId && !taskId && Object.keys(cost).length === 0) return undefined;
  return {
    ...(requestId ? { requestId } : {}),
    ...(taskId ? { taskId } : {}),
    cost,
  };
}
