import { GenerationProviderError, GenerationTimeoutError, GenerationValidationError } from "../errors.js";
import { fetchWithTimeout, joinUrl } from "../http.js";
import type { GenerationAdapterInput, GenerationContentBlock } from "../types.js";
import { compactObject, getBlockMeta } from "../utils.js";
import { mergeTextBlocks } from "../validation.js";

// Keep per-request timeout comfortably above max_wait so polling controls total wait time.
const REQUEST_TIMEOUT_MS = 1_860_000;
const DEFAULT_POLL_INTERVAL_SEC = 2;
const DEFAULT_MAX_WAIT_SEC = 600;

const RESOLUTION_SHORT_EDGE: Record<string, number> = {
  "480p": 480,
  "720p": 720,
  "1080p": 1080,
  "2K": 1440,
};

const ASPECT_RATIOS: Record<string, [number, number] | null> = {
  "16:9": [16, 9],
  "9:16": [9, 16],
  "1:1": [1, 1],
  "4:3": [4, 3],
  "3:2": [3, 2],
  "2:3": [2, 3],
  "3:4": [3, 4],
  "21:9": [21, 9],
  adaptive: null,
};

type ArkCreateTaskResponse = { id?: unknown; task_id?: unknown; status?: unknown };

type ArkTaskStatusResponse = {
  data?: {
    status?: unknown;
    result_url?: unknown;
    progress?: unknown;
    first_frame?: unknown;
    data?: {
      status?: unknown;
      content?: { video_url?: unknown; first_frame?: unknown };
      resolution?: unknown;
      ratio?: unknown;
      duration?: unknown;
      framespersecond?: unknown;
      seed?: unknown;
      generate_audio?: unknown;
      model?: unknown;
      usage?: unknown;
    };
  };
};

type MediaMode = "image" | "frame" | "reference";
type MediaKind = "image" | "video";
type ResolvedMedia = { kind: MediaKind; url: string; role: string | undefined };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeStatus(value: string): string {
  const status = value.toLowerCase();
  return status === "success" ? "succeeded" : status;
}

function getIntegerParameter(parameters: Record<string, unknown>, key: string, fallback: number): number {
  const value = parameters[key];
  return typeof value === "number" && Number.isInteger(value) ? value : fallback;
}

function resolveSize(resolution: string, aspectRatio: string): { width: number; height: number } | null {
  const ratio = ASPECT_RATIOS[aspectRatio];
  if (!ratio) return null;

  const shortEdge = RESOLUTION_SHORT_EDGE[resolution];
  if (!shortEdge) throw new GenerationValidationError(`Unsupported resolution: ${resolution}`);

  const [wRatio, hRatio] = ratio;
  const width = wRatio >= hRatio ? Math.round((shortEdge * wRatio) / hRatio) : shortEdge;
  const height = wRatio >= hRatio ? shortEdge : Math.round((shortEdge * hRatio) / wRatio);
  return { width: width % 2 === 0 ? width : width + 1, height: height % 2 === 0 ? height : height + 1 };
}

function getMediaRole(block: Extract<GenerationContentBlock, { type: "image" | "video" }>): string | undefined {
  const role = getBlockMeta(block)?.role;
  return typeof role === "string" && role ? role : undefined;
}

function classifyMedia(media: ResolvedMedia[]): MediaMode | null {
  if (media.length === 0) return null;

  for (const item of media) {
    if (
      item.kind === "image" &&
      item.role &&
      item.role !== "first_frame" &&
      item.role !== "last_frame" &&
      item.role !== "reference_image"
    ) {
      throw new GenerationValidationError("Image input must use meta.role first_frame, last_frame, or reference_image");
    }
    if (item.kind === "video" && item.role !== "reference_video") {
      throw new GenerationValidationError("Video input must use meta.role reference_video");
    }
  }

  const hasFrame = media.some(
    (item) => item.kind === "image" && (item.role === "first_frame" || item.role === "last_frame"),
  );
  const hasReference = media.some(
    (item) =>
      (item.kind === "image" && item.role === "reference_image") ||
      (item.kind === "video" && item.role === "reference_video"),
  );
  const hasPlain = media.some((item) => item.kind === "image" && !item.role);
  const modes = [hasPlain, hasFrame, hasReference].filter(Boolean).length;
  if (modes > 1)
    throw new GenerationValidationError(
      "Cannot mix video media modes: use only plain image, first_frame/last_frame, or reference_image/reference_video",
    );
  if (hasReference) return "reference";
  if (hasFrame) return "frame";
  if (hasPlain) return "image";
  return null;
}

function buildMetadataContent(media: ResolvedMedia[], mode: Exclude<MediaMode, "image">) {
  const content: Array<Record<string, unknown>> = [];
  for (const item of media) {
    if (mode === "frame" && (item.kind !== "image" || (item.role !== "first_frame" && item.role !== "last_frame"))) {
      throw new GenerationValidationError("Frame mode images must use meta.role first_frame or last_frame");
    }
    if (
      mode === "reference" &&
      !(
        (item.kind === "image" && item.role === "reference_image") ||
        (item.kind === "video" && item.role === "reference_video")
      )
    ) {
      throw new GenerationValidationError("Reference mode media must use meta.role reference_image or reference_video");
    }
    if (item.kind === "image") {
      content.push({ type: "image_url", image_url: { url: item.url }, role: item.role });
    } else {
      content.push({ type: "video_url", video_url: { url: item.url }, role: item.role });
    }
  }
  return content;
}

function extractTaskId(response: ArkCreateTaskResponse): string {
  const taskId = asString(response.task_id) ?? asString(response.id);
  if (!taskId) {
    throw new GenerationProviderError("Video generation provider did not return a task id", {
      details: { response },
    });
  }
  return taskId;
}

function normalizeTaskStatus(response: ArkTaskStatusResponse) {
  if (response.data) {
    const wrapper = response.data;
    const native = wrapper.data;
    const status = normalizeStatus(asString(native?.status) ?? asString(wrapper.status) ?? "unknown");
    const videoUrl = asString(wrapper.result_url) ?? asString(native?.content?.video_url);
    const lastFrameUrl = asString(wrapper.first_frame) ?? asString(native?.content?.first_frame);
    const metadata: Record<string, unknown> = {
      progress: wrapper.progress,
      resolution: native?.resolution,
      ratio: native?.ratio,
      duration: native?.duration,
      framespersecond: native?.framespersecond,
      seed: native?.seed,
      generate_audio: native?.generate_audio,
      model: native?.model,
      usage: native?.usage,
    };
    for (const key of Object.keys(metadata)) if (metadata[key] === undefined) delete metadata[key];
    return { status, videoUrl, lastFrameUrl, metadata };
  }
  return { status: "unknown", videoUrl: undefined, lastFrameUrl: undefined, metadata: {} };
}

async function requestJson(input: GenerationAdapterInput, path: string, init: RequestInit): Promise<unknown> {
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

  if (!response.ok) {
    const body = await response.text().catch(() => response.statusText);
    throw new GenerationProviderError("Video generation provider request failed", { status: response.status, body });
  }
  return response.json();
}

export async function arkVideoGenerationsAdapter(input: GenerationAdapterInput): Promise<GenerationContentBlock[]> {
  const prompt = mergeTextBlocks(input.declaration, input.request.content);
  if (!prompt) throw new GenerationValidationError("Prompt text is required");

  const mediaBlocks = input.request.content.filter(
    (block): block is Extract<GenerationContentBlock, { type: "image" | "video" }> =>
      block.type === "image" || block.type === "video",
  );
  const media = await Promise.all(
    mediaBlocks.map(async (block) => ({
      kind: block.type,
      url: await input.context.resolveSource(block.source),
      role: getMediaRole(block),
    })),
  );

  const mode = classifyMedia(media);
  const resolution = asString(input.parameters.resolution) ?? "720p";
  const aspectRatio = asString(input.parameters.aspect_ratio) ?? "16:9";
  const duration = getIntegerParameter(input.parameters, "duration", 5);
  const fps = getIntegerParameter(input.parameters, "fps", 30);
  const pollIntervalSec = getIntegerParameter(input.parameters, "poll_interval", DEFAULT_POLL_INTERVAL_SEC);
  const maxWaitSec = getIntegerParameter(input.parameters, "max_wait", DEFAULT_MAX_WAIT_SEC);
  const generateAudio = asBoolean(input.parameters.generate_audio) ?? true;
  const returnLastFrame = asBoolean(input.parameters.return_last_frame) ?? true;
  const cameraFixed = asBoolean(input.parameters.camera_fixed) ?? false;
  const watermark = asBoolean(input.parameters.watermark) ?? false;
  const seed = asNumber(input.parameters.seed);

  const payload: Record<string, unknown> = { model: input.declaration.model, prompt };
  const metadata: Record<string, unknown> = { duration, fps, generate_audio: generateAudio };
  if (seed !== undefined) metadata.seed = seed;
  if (returnLastFrame) metadata.return_last_frame = true;
  if (cameraFixed) metadata.camera_fixed = true;
  if (watermark) metadata.watermark = true;

  if (mode === "frame" || mode === "reference") {
    metadata.content = buildMetadataContent(media, mode);
    metadata.resolution = resolution;
    metadata.ratio = aspectRatio;
  } else {
    const size = resolveSize(resolution, aspectRatio);
    if (size) {
      payload.width = size.width;
      payload.height = size.height;
    }
    const firstImage = media.find((item) => item.kind === "image");
    if (firstImage) payload.image = firstImage.url;
  }
  payload.metadata = metadata;

  const task = (await requestJson(input, "/v1/video/generations", {
    method: "POST",
    body: JSON.stringify(payload),
  })) as ArkCreateTaskResponse;
  const taskId = extractTaskId(task);
  const startedAt = Date.now();

  while (Date.now() - startedAt <= maxWaitSec * 1000) {
    await sleep(pollIntervalSec * 1000);
    const rawStatus = (await requestJson(input, `/v1/video/generations/${encodeURIComponent(taskId)}`, {
      method: "GET",
    })) as ArkTaskStatusResponse;
    const status = normalizeTaskStatus(rawStatus);

    if (status.status === "succeeded") {
      if (!status.videoUrl) {
        throw new GenerationProviderError("Video generation succeeded but returned no video URL", {
          details: compactObject({ taskId, rawStatus, metadata: status.metadata }),
        });
      }
      const output: GenerationContentBlock[] = [
        {
          type: "video",
          source: { type: "url", url: status.videoUrl },
          meta: { task_id: taskId, status: status.status, ...status.metadata },
        },
      ];
      if (status.lastFrameUrl)
        output.push({
          type: "image",
          source: { type: "url", url: status.lastFrameUrl },
          meta: { role: "last_frame", task_id: taskId },
        });
      return output;
    }

    if (["failed", "expired", "cancelled"].includes(status.status)) {
      throw new GenerationProviderError(`Video generation ${status.status}`, { details: { taskId, rawStatus } });
    }
  }

  throw new GenerationTimeoutError("Timed out waiting for video generation", { taskId });
}
