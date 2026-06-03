import { GenerationProviderError, GenerationTimeoutError, GenerationValidationError } from "../errors.js";
import { fetchWithTimeout, joinUrl } from "../http.js";
import type { GenerationAdapterInput, GenerationContentBlock, GenerationSource } from "../types.js";
import { compactObject } from "../utils.js";
import { mergeTextBlocks } from "../validation.js";

const REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_INTERVAL_SEC = 5;
const DEFAULT_MAX_WAIT_SEC = 600;

const OPERATION_PATHS: Record<string, string> = {
  music: "/suno/submit/music",
  concat: "/suno/submit/concat",
  persona: "/suno/submit/persona",
  lyrics: "/suno/submit/lyrics",
  upsample_tags: "/suno/submit/upsample-tags",
  upload_audio: "/suno/uploads/audio",
  sound: "/suno/submit/music",
};

const MUSIC_TASKS = new Set([
  "extend",
  "upload_extend",
  "infill",
  "fixed_infill",
  "infill_intro",
  "infill_outro",
  "cover_infill",
  "cover_extend",
  "artist_infill",
  "artist_consistency",
  "cover",
  "image_to_song",
  "video_to_song",
  "concat",
  "sound",
  "underpainting",
  "remaster",
  "vox",
  "mashup_condition",
]);

const INTERNAL_PARAMETERS = new Set(["operation", "poll_interval", "max_wait"]);
const FINAL_SUCCESS_STATUSES = new Set(["success", "succeeded", "completed"]);
const FINAL_FAILURE_STATUSES = new Set(["failure", "failed", "error", "cancelled", "canceled", "expired"]);

type TaskResponse<T = unknown> = {
  code?: unknown;
  message?: unknown;
  data?: T;
};

type SunoTaskDto = {
  task_id?: unknown;
  action?: unknown;
  status?: unknown;
  fail_reason?: unknown;
  result_url?: unknown;
  progress?: unknown;
  submit_time?: unknown;
  start_time?: unknown;
  finish_time?: unknown;
  data?: unknown;
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

function successCode(value: unknown): boolean {
  const code = String(value ?? "")
    .trim()
    .toLowerCase();
  return code === "success" || code === "200" || code === "0";
}

function requireSuccess<T>(response: TaskResponse<T>, fallbackMessage: string): T {
  if (!successCode(response.code)) {
    throw new GenerationProviderError(fallbackMessage, {
      details: {
        code: response.code,
        message: response.message,
        data: response.data,
      },
    });
  }
  return response.data as T;
}

function extractTaskId(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (!isRecord(value)) return undefined;
  for (const key of ["task_id", "id", "taskBatchId"]) {
    const taskId = asString(value[key]);
    if (taskId) return taskId;
  }
  return undefined;
}

function normalizeStatus(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function normalizeTask(operation: string, data: unknown): SunoTaskDto | null {
  if (!isRecord(data)) return null;
  if ("status" in data || "task_id" in data || "data" in data) return data as SunoTaskDto;
  if (Array.isArray(data.data)) return normalizeTask(operation, data.data[0]);
  return { action: operation, status: "SUCCESS", data };
}

function getOperation(input: GenerationAdapterInput): string {
  const operation = asString(input.parameters.operation) ?? "music";
  if (!OPERATION_PATHS[operation]) throw new GenerationValidationError(`Unsupported Suno operation: ${operation}`);
  return operation;
}

async function buildPayload(input: GenerationAdapterInput, operation: string): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = { ...(input.request.metadata ?? {}) };
  for (const [key, value] of Object.entries(input.parameters)) {
    if (!INTERNAL_PARAMETERS.has(key) && value !== undefined) payload[key] = value;
  }

  const prompt = mergeTextBlocks(input.declaration, input.request.content);
  if (prompt && payload.prompt === undefined) payload.prompt = prompt;

  const audioBlock = input.request.content.find(
    (block): block is Extract<GenerationContentBlock, { type: "audio" }> => block.type === "audio",
  );
  if (audioBlock && payload.url === undefined) payload.url = await input.context.resolveSource(audioBlock.source);

  const imageBlock = input.request.content.find(
    (block): block is Extract<GenerationContentBlock, { type: "image" }> => block.type === "image",
  );
  if (imageBlock && payload.image_url === undefined)
    payload.image_url = await input.context.resolveSource(imageBlock.source);

  const videoBlock = input.request.content.find(
    (block): block is Extract<GenerationContentBlock, { type: "video" }> => block.type === "video",
  );
  if (videoBlock && payload.video_url === undefined)
    payload.video_url = await input.context.resolveSource(videoBlock.source);

  if (operation === "sound") payload.task = "sound";
  validateSunoPayload(operation, payload);
  return payload;
}

function validateSunoPayload(operation: string, payload: Record<string, unknown>): void {
  const task = asString(payload.task);
  if (operation === "music" && task) {
    if (!MUSIC_TASKS.has(task)) throw new GenerationValidationError(`Unsupported Suno music task: ${task}`);
    if (task === "lyrics") throw new GenerationValidationError("Use operation=lyrics instead of task=lyrics");
  }
  if ((operation === "music" || operation === "lyrics") && !asString(payload.prompt)) {
    throw new GenerationValidationError("Prompt text is required");
  }
  if (operation === "upload_audio" && !asString(payload.url)) {
    throw new GenerationValidationError("Audio URL is required for Suno upload_audio");
  }
}

async function requestJson(input: GenerationAdapterInput, path: string, init: RequestInit): Promise<TaskResponse> {
  const response = await fetchWithTimeout(
    input.context.fetch,
    joinUrl(input.context.baseUrl, path),
    {
      ...init,
      headers: {
        Authorization: `Bearer ${input.context.apiKey}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    },
    REQUEST_TIMEOUT_MS,
  );
  const body = await response.text();
  let parsed: TaskResponse;
  try {
    parsed = body ? (JSON.parse(body) as TaskResponse) : {};
  } catch {
    throw new GenerationProviderError("Suno provider returned invalid JSON", { status: response.status, body });
  }
  if (!response.ok) {
    throw new GenerationProviderError("Suno provider request failed", {
      status: response.status,
      details: { body: parsed },
    });
  }
  return parsed;
}

function appendUrlBlock(
  output: GenerationContentBlock[],
  type: "audio" | "video" | "image",
  url: unknown,
  meta: Record<string, unknown>,
): void {
  const value = asString(url);
  if (!value) return;
  output.push({ type, source: { type: "url", url: value } as GenerationSource, meta: compactObject(meta) });
}

function appendSunoContent(output: GenerationContentBlock[], value: unknown, meta: Record<string, unknown> = {}): void {
  if (Array.isArray(value)) {
    for (const item of value) appendSunoContent(output, item, meta);
    return;
  }
  if (!isRecord(value)) return;

  if (isRecord(value.clips)) {
    for (const clip of Object.values(value.clips)) appendSunoContent(output, clip, meta);
  }

  const itemMeta = compactObject({
    ...meta,
    id: value.id,
    title: value.title,
    status: value.status ?? meta.status,
    model: value.model_name ?? value.modelName,
    duration: isRecord(value.metadata) ? value.metadata.duration : undefined,
    tags: isRecord(value.metadata) ? value.metadata.tags : undefined,
    prompt: isRecord(value.metadata) ? value.metadata.prompt : undefined,
  });

  appendUrlBlock(output, "audio", value.audio_url ?? value.audioUrl, itemMeta);
  appendUrlBlock(output, "video", value.video_url ?? value.videoUrl, itemMeta);
  appendUrlBlock(output, "image", value.image_large_url ?? value.image_url ?? value.imageUrl, itemMeta);

  const text = asString(value.upsampled_tags) ?? asString(value.text);
  if (text) output.push({ type: "text", text, meta: itemMeta });

  if (isRecord(value.data)) appendSunoContent(output, value.data, itemMeta);
}

function buildResult(operation: string, task: SunoTaskDto, raw: unknown): GenerationContentBlock[] {
  const output: GenerationContentBlock[] = [];
  const metadata = compactObject({
    operation,
    task_id: task.task_id,
    action: task.action,
    status: task.status,
    fail_reason: task.fail_reason,
    progress: task.progress,
    submit_time: task.submit_time,
    start_time: task.start_time,
    finish_time: task.finish_time,
    raw,
  });
  appendSunoContent(output, task.data, metadata);
  appendUrlBlock(output, "audio", task.result_url, metadata);
  return output;
}

async function pollSunoTask(
  input: GenerationAdapterInput,
  operation: string,
  taskId: string,
  pollIntervalSec: number,
  maxWaitSec: number,
): Promise<GenerationContentBlock[]> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= maxWaitSec * 1000) {
    await sleep(pollIntervalSec * 1000);
    const raw = await requestJson(input, `/suno/fetch/${encodeURIComponent(taskId)}`, { method: "GET" });
    const data = requireSuccess(raw, "Suno task fetch failed");
    const task = normalizeTask(operation, data);
    if (!task) throw new GenerationProviderError("Suno task fetch returned invalid task data", { details: { data } });

    const status = normalizeStatus(task.status);
    if (FINAL_SUCCESS_STATUSES.has(status)) return buildResult(operation, task, data);
    if (FINAL_FAILURE_STATUSES.has(status)) {
      throw new GenerationProviderError("Suno task failed", {
        details: {
          task_id: taskId,
          status: task.status,
          fail_reason: task.fail_reason,
        },
      });
    }
  }
  throw new GenerationTimeoutError("Timed out waiting for Suno task", { task_id: taskId, operation });
}

export async function sunoTasksAdapter(input: GenerationAdapterInput): Promise<GenerationContentBlock[]> {
  const operation = getOperation(input);
  const payload = await buildPayload(input, operation);
  const path = OPERATION_PATHS[operation];
  if (!path) throw new GenerationValidationError(`Unsupported Suno operation: ${operation}`);
  const raw = await requestJson(input, path, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  const data = requireSuccess(raw, "Suno task submit failed");
  const immediateTask = normalizeTask(operation, data);
  if (operation === "upsample_tags" && immediateTask) return buildResult(operation, immediateTask, data);

  const taskId = extractTaskId(data);
  if (!taskId) throw new GenerationProviderError("Suno task submit returned no task id", { details: { data } });

  const pollIntervalSec = asInteger(input.parameters.poll_interval, DEFAULT_POLL_INTERVAL_SEC);
  const maxWaitSec = asInteger(input.parameters.max_wait, DEFAULT_MAX_WAIT_SEC);
  return pollSunoTask(input, operation, taskId, pollIntervalSec, maxWaitSec);
}
