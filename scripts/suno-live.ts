import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  createGenerationClient,
  type GenerateRequest,
  type GenerationContentBlock,
  type GenerationDebugEvent,
  type GenerationModelDeclaration,
  getBuiltinGenerationModel,
} from "../src/index.js";

const DEFAULT_BASE_URL = "https://dev.router.neta.art";
const RESULT_DIR = "/tmp/neta-generation-live/tasks";
const SUMMARY_PATH = "/tmp/neta-generation-live/live-summary.json";
const KEY_FILE = "/tmp/neta-router-key";
const DEFAULT_MAX_WAIT = 900;
const DEFAULT_POLL_INTERVAL = 5;
const DEFAULT_MV = "chirp-v5-5";
const LIVE_OPERATIONS = ["music", "lyrics", "concat", "upsample_tags", "upload_audio"];

type TaskName =
  | "sound"
  | "extend"
  | "upload_extend"
  | "infill"
  | "fixed_infill"
  | "infill_intro"
  | "infill_outro"
  | "cover_infill"
  | "cover_extend"
  | "artist_infill"
  | "artist_consistency"
  | "cover"
  | "image_to_song"
  | "video_to_song"
  | "concat"
  | "underpainting"
  | "remaster"
  | "vox"
  | "mashup_condition"
  | "upsample_tags"
  | "upload_audio"
  | "image_to_song_plain"
  | "video_to_song_plain"
  | "underpainting_base"
  | "underpainting_upload_prompt"
  | "remaster_retry";

const taskNames: TaskName[] = [
  "sound",
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
  "underpainting",
  "remaster",
  "vox",
  "mashup_condition",
  "upsample_tags",
  "upload_audio",
];

const seed = {
  taskId: "task_x2y4RHi6zGYLhuGd0yNGl6UY01OD6hPJ",
  clipId: "18422034-4d82-4205-ad53-26e66708982c",
  remasterClipId: "18422034-4d82-4205-ad53-26e66708982c",
  secondClipId: "dcee36ee-aa3d-4607-95fb-f823f9b7a480",
  uploadClipId: "55bd125f-c9d1-43e5-bd4c-9e396f6b0c05",
  acapellaAudioUrl: "http://cdnimg.exbapp.com/ai/2024-06-18/d416d9c3c34eb22c7d8c094831d8dbd0.mp3",
  baseAudioUrl:
    "https://router-files.neta.art/dev/files/a46f0fd3-645b-4edb-beda-5828c76dbcf4/060d5d4d-1089-4d61-9480-305e00d9fd34.mp3",
  uploadAudioUrl:
    "https://router-files.neta.art/dev/files/9ab08199-ac8a-4d04-a8c7-a344dca1895f/6462b050-a758-4219-a935-0ac1fc5eaeb8.mp3",
  imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Hopetoun_falls.jpg/640px-Hopetoun_falls.jpg",
  videoUrl: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
  uploadedImageUrl: "https://cdn2.suno.ai/image_55bd125f-c9d1-43e5-bd4c-9e396f6b0c05.jpeg",
  uploadedVideoUrl: "https://cdn1.suno.ai/55bd125f-c9d1-43e5-bd4c-9e396f6b0c05.mp4",
};

const resultFileNames: Record<string, string> = {
  image_to_song_plain: "image_to_song",
  video_to_song_plain: "video_to_song",
  underpainting_base: "underpainting",
  underpainting_upload_prompt: "underpainting",
  remaster_retry: "remaster",
};

function resultFileName(task: TaskName): string {
  return resultFileNames[task] ?? task;
}

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  if (value) return value.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function readApiKey(): Promise<string> {
  const envKey = process.env.NETA_ROUTER_API_KEY ?? process.env.NETA_API_KEY;
  if (envKey) return envKey.trim();
  return (await readFile(KEY_FILE, "utf8")).trim();
}

function title(task: string): string {
  return `SDK ${task.replaceAll("_", " ")} ${new Date().toISOString().slice(5, 16).replace(/[-:T]/g, "")}`;
}

function musicRequest(
  task: TaskName,
  meta: Record<string, unknown>,
  content: GenerateRequest["content"],
): GenerateRequest {
  return {
    model: "suno_music",
    content,
    parameters: { operation: "music", poll_interval: DEFAULT_POLL_INTERVAL, max_wait: DEFAULT_MAX_WAIT },
    meta: { task, mv: DEFAULT_MV, ...meta },
  };
}

function requestFor(task: TaskName): GenerateRequest {
  const basePrompt = "short original hopeful instrumental pop, warm piano, clear chorus";
  switch (task) {
    case "sound":
      return musicRequest(
        task,
        {
          title: title(task),
          tags: "ambient, rain, cinematic",
          make_instrumental: true,
          metadata_params: { sound: "gentle rain ambience with distant thunder" },
        },
        [{ type: "text", text: "gentle rain ambience with distant thunder" }],
      );
    case "extend":
      return musicRequest(
        task,
        {
          title: title(task),
          tags: "hopeful pop, warm piano",
          make_instrumental: true,
          task_id: seed.taskId,
          clip_id: seed.clipId,
          continue_clip_id: seed.clipId,
          continue_at: 20,
        },
        [{ type: "text", text: "continue with a brighter warm piano chorus" }],
      );
    case "upload_extend":
      return musicRequest(
        task,
        {
          title: title(task),
          tags: "hopeful pop, warm piano",
          make_instrumental: true,
          task_id: seed.taskId,
          clip_id: seed.uploadClipId,
          continue_clip_id: seed.uploadClipId,
          continue_at: 8,
        },
        [{ type: "text", text: "extend the uploaded reference with a short warm piano hook" }],
      );
    case "infill":
    case "fixed_infill":
    case "infill_intro":
    case "infill_outro":
    case "cover_infill":
    case "cover_extend":
    case "artist_infill":
    case "artist_consistency":
    case "cover":
    case "vox":
    case "mashup_condition":
      return musicRequest(
        task,
        {
          title: title(task),
          tags: "hopeful pop, warm piano",
          make_instrumental: true,
          task_id: seed.taskId,
          clip_id: seed.clipId,
          continue_clip_id: seed.clipId,
          continue_at: 20,
        },
        [{ type: "text", text: basePrompt }],
      );
    case "image_to_song":
    case "image_to_song_plain": {
      const prompt = "short original instrumental inspired by a quiet waterfall, warm piano";
      const metadataParams = {
        prompt,
        tags: "ambient instrumental, warm piano",
        image_url: seed.imageUrl,
      };
      return musicRequest(
        "image_to_song",
        {
          mv: "chirp-fenix",
          title: title(task),
          tags: "ambient instrumental, warm piano",
          negative_tags: "",
          generation_type: "TEXT",
          make_instrumental: true,
          prompt,
          gpt_description_prompt: prompt,
          image_url: seed.imageUrl,
          metadata: { create_mode: "custom" },
          metadataParams,
          metadata_params: metadataParams,
        },
        [
          { type: "text", text: prompt },
          { type: "image", source: { type: "url", url: seed.imageUrl } },
        ],
      );
    }
    case "video_to_song":
    case "video_to_song_plain": {
      const prompt = "short original instrumental inspired by a slow flower video, warm piano";
      const metadataParams = {
        prompt,
        tags: "cinematic instrumental, warm piano",
        video_url: seed.videoUrl,
      };
      return musicRequest(
        "video_to_song",
        {
          mv: "chirp-fenix",
          title: title(task),
          tags: "cinematic instrumental, warm piano",
          negative_tags: "",
          generation_type: "TEXT",
          make_instrumental: true,
          prompt,
          gpt_description_prompt: prompt,
          video_url: seed.videoUrl,
          metadata: { create_mode: "custom" },
          metadataParams,
          metadata_params: metadataParams,
        },
        [
          { type: "text", text: prompt },
          { type: "video", source: { type: "url", url: seed.videoUrl } },
        ],
      );
    }
    case "concat":
      return {
        model: "suno_music",
        content: [],
        parameters: { operation: "concat", poll_interval: DEFAULT_POLL_INTERVAL, max_wait: DEFAULT_MAX_WAIT },
        meta: { clip_id: seed.clipId, is_infill: false },
      };
    case "underpainting":
    case "underpainting_base":
    case "underpainting_upload_prompt": {
      const useBaseClip = task === "underpainting_base";
      const prompt = task === "underpainting_upload_prompt" ? "short warm piano bridge" : "";
      const metadataParams = {
        prompt,
        tags: "hopeful pop, warm piano",
        underpainting_clip_id: useBaseClip ? seed.clipId : seed.uploadClipId,
        underpainting_start_s: useBaseClip ? 8 : 1,
        underpainting_end_s: useBaseClip ? 14 : 3,
        override_fields: prompt ? ["prompt", "tags"] : ["tags"],
      };
      return musicRequest(
        "underpainting",
        {
          mv: "chirp-bluejay",
          title: title(task),
          tags: metadataParams.tags,
          negative_tags: "",
          generation_type: "TEXT",
          make_instrumental: true,
          prompt,
          underpainting_clip_id: metadataParams.underpainting_clip_id,
          underpainting_start_s: metadataParams.underpainting_start_s,
          underpainting_end_s: metadataParams.underpainting_end_s,
          override_fields: metadataParams.override_fields,
          metadata: { create_mode: "custom" },
          metadataParams,
          metadata_params: metadataParams,
        },
        prompt ? [{ type: "text", text: prompt }] : [],
      );
    }
    case "remaster":
    case "remaster_retry":
      return musicRequest(
        "remaster",
        {
          task_id: getArg("remaster-task-id"),
          clip_id: getArg("remaster-clip-id") ?? seed.remasterClipId,
          model_name: getArg("remaster-model-name") ?? "chirp-carp",
          variation_category: getArg("remaster-variation") ?? "subtle",
        },
        [{ type: "text", text: "remaster this clip with cleaner mix and warm piano tone" }],
      );
    case "upsample_tags":
      return {
        model: "suno_music",
        content: [{ type: "text", text: "hopeful pop, warm piano, clear chorus" }],
        parameters: { operation: "upsample_tags" },
      };
    case "upload_audio":
      return {
        model: "suno_music",
        content: [{ type: "audio", source: { type: "url", url: seed.acapellaAudioUrl } }],
        parameters: { operation: "upload_audio", poll_interval: DEFAULT_POLL_INTERVAL, max_wait: DEFAULT_MAX_WAIT },
      };
  }
}

function toSerializableOutput(blocks: GenerationContentBlock[]) {
  return blocks.map((block) => {
    if (block.type === "text") return block;
    if (block.source.type === "url") return { type: block.type, url: block.source.url, meta: block.meta };
    return { type: block.type, source: block.source, meta: block.meta };
  });
}

function requestIds(events: GenerationDebugEvent[]): string[] {
  const ids = new Set<string>();
  for (const event of events) {
    if (event.type === "response") {
      const id = event.trace["x-request-id"];
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

function errorJson(error: unknown) {
  if (!error || typeof error !== "object") return { message: String(error) };
  const value = error as Error & { status?: number; details?: unknown };
  return {
    name: value.name,
    message: value.message,
    status: value.status,
    details: value.details,
  };
}

function liveSunoModel(): GenerationModelDeclaration {
  const declaration = getBuiltinGenerationModel("suno_music");
  if (!declaration?.parameters?.operation || declaration.parameters.operation.type !== "string") {
    throw new Error("suno_music declaration is unavailable");
  }
  return {
    ...declaration,
    parameters: {
      ...declaration.parameters,
      operation: {
        ...declaration.parameters.operation,
        enum: LIVE_OPERATIONS,
      },
    },
  };
}

function redactAuth(event: GenerationDebugEvent): GenerationDebugEvent {
  if (event.type !== "request") return event;
  const headers = { ...event.headers };
  if (headers.Authorization) headers.Authorization = "[REDACTED]";
  return {
    ...event,
    headers,
  };
}

async function runTask(task: TaskName, apiKey: string, baseUrl: string) {
  const events: GenerationDebugEvent[] = [];
  const client = createGenerationClient({
    apiKey,
    baseUrl,
    models: [liveSunoModel()],
    debug: {
      enabled: true,
      includeSensitive: true,
      includeResponseBody: true,
      logger: (event) => events.push(redactAuth(event)),
    },
  });
  const request = requestFor(task);
  const fileName = resultFileName(task);
  const started = Date.now();
  try {
    const output = await client.generate(request);
    const result = {
      task,
      ok: output.length > 0,
      elapsed_s: Math.round((Date.now() - started) / 1000),
      output_count: output.length,
      output: toSerializableOutput(output),
      request_meta: request.meta ?? null,
      request_content_types: request.content.map((block) => block.type),
      request_ids: requestIds(events),
      events,
    };
    await writeFile(join(RESULT_DIR, `${fileName}.json`), JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    const result = {
      task,
      ok: false,
      elapsed_s: Math.round((Date.now() - started) / 1000),
      error: errorJson(error),
      request_meta: request.meta ?? null,
      request_content_types: request.content.map((block) => block.type),
      request_ids: requestIds(events),
      events,
    };
    await writeFile(join(RESULT_DIR, `${fileName}.json`), JSON.stringify(result, null, 2));
    return result;
  }
}

async function main() {
  const apiKey = await readApiKey();
  const baseUrl = getArg("base-url") ?? DEFAULT_BASE_URL;
  const selected = getArg("tasks")?.split(",").filter(Boolean) as TaskName[] | undefined;
  const tasks = selected?.length ? selected : taskNames;

  await mkdir(RESULT_DIR, { recursive: true });
  const summary = [];
  for (const task of tasks) {
    console.error(`running ${task}`);
    const result = await runTask(task, apiKey, baseUrl);
    summary.push({
      task,
      ok: result.ok,
      elapsed_s: result.elapsed_s,
      output_count: "output_count" in result ? result.output_count : 0,
      file: join(RESULT_DIR, `${resultFileName(task)}.json`),
    });
    console.error(
      `${task}: ${result.ok ? "ok" : "failed"} (${result.elapsed_s}s) -> ${basename(join(RESULT_DIR, `${resultFileName(task)}.json`))}`,
    );
  }
  await writeFile(SUMMARY_PATH, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  if (summary.some((item) => !item.ok)) process.exitCode = 1;
}

await main();
