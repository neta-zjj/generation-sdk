import { GenerationProviderError, GenerationTimeoutError, GenerationValidationError } from "../errors.js";
import { fetchWithTimeout, joinUrl } from "../http.js";
import type { GenerationAdapterInput, GenerationContentBlock } from "../types.js";
import { compactArray, compactObject } from "../utils.js";
import { mergeTextBlocks } from "../validation.js";

const REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_SUBMIT_PATH = "/internal/task/custom_background_tasks";
const DEFAULT_POLL_PATH = "/v1/artifact/task/{taskId}";
const DEFAULT_TASK_NAME = "make_image_with_comfy_common";
const DEFAULT_ACTOR_NAME = "comfyui";
const DEFAULT_QUEUE_NAME = "d_noob_base";
const DEFAULT_POLL_INTERVAL_SEC = 2;
const DEFAULT_MAX_WAIT_SEC = 300;

type NetaAppResponse = {
  task_uuid?: unknown;
  task_status?: unknown;
  artifacts?: Array<{
    uuid?: unknown;
    status?: unknown;
    url?: unknown;
    modality?: unknown;
    detail_url?: unknown;
    text?: unknown;
  }>;
  detail?: unknown;
  err_msg?: unknown;
};

type NetaAppTaskPayload = {
  actor_name: string;
  queue_name: string;
  params: {
    task_name: string;
    timeout: number;
    need_image_moderation: boolean;
    api_payload: Record<string, unknown>;
  };
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function adapterString(input: GenerationAdapterInput, key: string): string | undefined {
  return asString(input.declaration.adapter[key]);
}

function contentImages(input: GenerationAdapterInput): Array<Extract<GenerationContentBlock, { type: "image" }>> {
  return input.request.content.filter(
    (block): block is Extract<GenerationContentBlock, { type: "image" }> => block.type === "image",
  );
}

async function resolveImageUrls(input: GenerationAdapterInput): Promise<string[]> {
  return Promise.all(contentImages(input).map((block) => input.context.resolveSource(block.source)));
}

function buildQwenImageEditPayload(
  input: GenerationAdapterInput,
  workflowName: string,
  prompt: string,
  images: string[],
): Record<string, unknown> {
  return compactObject({
    workflow_name: workflowName,
    image_url: images.join("\n"),
    positive_prompt: prompt,
    negative_prompt: input.parameters.negative_prompt ?? "",
    max_side: input.parameters.max_side,
    seed: input.parameters.seed,
  });
}

function buildApiPayload(
  input: GenerationAdapterInput,
  workflowName: string,
  prompt: string,
  images: string[],
): Record<string, unknown> {
  const payloadType = adapterString(input, "payloadType") ?? input.declaration.model;
  switch (payloadType) {
    case "qwen-image-edit":
      return buildQwenImageEditPayload(input, workflowName, prompt, images);
    default:
      throw new GenerationValidationError(`Unsupported Neta app payload type: ${payloadType}`);
  }
}

async function buildPayload(input: GenerationAdapterInput): Promise<NetaAppTaskPayload> {
  const workflowName = adapterString(input, "workflowName");
  if (!workflowName) throw new GenerationValidationError(`${input.declaration.model} is missing adapter.workflowName`);

  const prompt = mergeTextBlocks(input.declaration, input.request.content);
  const images = await resolveImageUrls(input);

  return {
    actor_name: adapterString(input, "actorName") ?? DEFAULT_ACTOR_NAME,
    queue_name: adapterString(input, "queueName") ?? DEFAULT_QUEUE_NAME,
    params: {
      task_name: adapterString(input, "taskName") ?? DEFAULT_TASK_NAME,
      timeout: asInteger(input.parameters.timeout, DEFAULT_MAX_WAIT_SEC),
      need_image_moderation: asBoolean(input.declaration.adapter.needImageModeration, false),
      api_payload: buildApiPayload(input, workflowName, prompt, images),
    },
  };
}

async function requestJson(input: GenerationAdapterInput, path: string, init: RequestInit): Promise<unknown> {
  const response = await fetchWithTimeout(
    input.context.fetch,
    joinUrl(input.context.baseUrl, path),
    {
      ...init,
      headers: {
        Authorization: `Bearer ${input.context.apiKey}`,
        "x-token": input.context.apiKey,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    },
    REQUEST_TIMEOUT_MS,
  );
  if (!response.ok) {
    const body = await response.text().catch(() => response.statusText);
    throw new GenerationProviderError("Neta app provider request failed", { status: response.status, body });
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

function extractTaskId(raw: unknown): string | undefined {
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (!isRecord(raw)) return undefined;
  return asString(raw.task_id) ?? asString(raw.taskId) ?? asString(raw.task_uuid) ?? asString(raw.uuid);
}

function isSuccessStatus(value: unknown): boolean {
  const status = String(value ?? "")
    .trim()
    .toUpperCase();
  return status === "SUCCESS" || status === "SUCCEEDED" || status === "COMPLETED";
}

function isFailureStatus(value: unknown): boolean {
  const status = String(value ?? "")
    .trim()
    .toUpperCase();
  return status === "FAILURE" || status === "FAILED" || status === "ERROR" || status === "ILLEGAL";
}

function buildOutput(raw: NetaAppResponse): GenerationContentBlock[] {
  const output: GenerationContentBlock[] = [];
  for (const artifact of raw.artifacts ?? []) {
    const meta = compactObject({
      task_id: raw.task_uuid,
      artifact_id: artifact.uuid,
      status: artifact.status,
      modality: artifact.modality,
    });
    const modality = String(artifact.modality ?? "").toLowerCase();
    const url = asString(artifact.url) ?? asString(artifact.detail_url);
    if (url && modality.includes("video")) output.push({ type: "video", source: { type: "url", url }, meta });
    else if (url && modality.includes("audio")) output.push({ type: "audio", source: { type: "url", url }, meta });
    else if (url) output.push({ type: "image", source: { type: "url", url }, meta });
    const text = asString(artifact.text);
    if (text) output.push({ type: "text", text, meta });
  }
  return output;
}

async function pollTask(input: GenerationAdapterInput, taskId: string): Promise<GenerationContentBlock[]> {
  const pollPath = adapterString(input, "pollPath") ?? DEFAULT_POLL_PATH;
  const pollIntervalSec = asInteger(input.parameters.poll_interval, DEFAULT_POLL_INTERVAL_SEC);
  const maxWaitSec = asInteger(input.parameters.max_wait, DEFAULT_MAX_WAIT_SEC);
  const deadline = Date.now() + maxWaitSec * 1000;

  while (Date.now() < deadline) {
    const raw = (await requestJson(input, pollPath.replace("{taskId}", encodeURIComponent(taskId)), {
      method: "GET",
    })) as NetaAppResponse;
    if (isSuccessStatus(raw.task_status)) {
      const output = buildOutput(raw);
      if (output.length > 0) return output;
      throw new GenerationProviderError("Neta app task succeeded but returned no output", { details: raw });
    }
    if (isFailureStatus(raw.task_status)) {
      throw new GenerationProviderError("Neta app task failed", {
        details: compactObject({ task_id: taskId, status: raw.task_status, err_msg: raw.err_msg, raw }),
      });
    }
    await sleep(pollIntervalSec * 1000);
  }

  throw new GenerationTimeoutError("Timed out waiting for Neta app task", { task_id: taskId });
}

export async function nietaAppAdapter(input: GenerationAdapterInput): Promise<GenerationContentBlock[]> {
  const payload = await buildPayload(input);
  const raw = await requestJson(input, adapterString(input, "submitPath") ?? DEFAULT_SUBMIT_PATH, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const taskId = extractTaskId(raw);
  if (!taskId) {
    throw new GenerationProviderError("Neta app submit response did not include a task id", {
      details: { response: raw, payload: compactObject({ ...payload, params: payload.params }) },
    });
  }
  if (input.parameters.wait === false) {
    return [
      {
        type: "text",
        text: taskId,
        meta: compactObject({
          role: "task_id",
          task_id: taskId,
          submit_response: raw,
          request: compactArray([payload.actor_name, payload.queue_name, payload.params.task_name]),
        }),
      },
    ];
  }
  return pollTask(input, taskId);
}
