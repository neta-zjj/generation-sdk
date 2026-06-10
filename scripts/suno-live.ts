import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  createGenerationClient,
  type GenerateRequest,
  type GenerationContentBlock,
  type GenerationDebugEvent,
} from "../src/index.js";

const DEFAULT_BASE_URL = "https://dev.router.neta.art";
const RESULT_DIR = "/tmp/neta-generation-live/tasks";
const SUMMARY_PATH = "/tmp/neta-generation-live/live-summary.json";
const KEY_FILE = "/tmp/neta-router-key";
const DEFAULT_MAX_WAIT = 900;
const DEFAULT_POLL_INTERVAL = 5;

type TaskName =
  | "music"
  | "sound"
  | "infill"
  | "cover"
  | "image_to_song"
  | "video_to_song"
  | "vox"
  | "upsample_tags"
  | "upload_audio";

const taskNames: TaskName[] = [
  "music",
  "sound",
  "infill",
  "cover",
  "image_to_song",
  "video_to_song",
  "vox",
  "upsample_tags",
  "upload_audio",
];

const seed = {
  taskId: "task_x2y4RHi6zGYLhuGd0yNGl6UY01OD6hPJ",
  clipId: "18422034-4d82-4205-ad53-26e66708982c",
  acapellaAudioUrl: "http://cdnimg.exbapp.com/ai/2024-06-18/d416d9c3c34eb22c7d8c094831d8dbd0.mp3",
  imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Hopetoun_falls.jpg/640px-Hopetoun_falls.jpg",
  videoUrl: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
};

function resultFileName(task: TaskName): string {
  return task;
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

function taskModelRequest(
  model: string,
  meta: Record<string, unknown>,
  content: GenerateRequest["content"],
): GenerateRequest {
  return {
    model,
    content,
    parameters: { poll_interval: DEFAULT_POLL_INTERVAL, max_wait: DEFAULT_MAX_WAIT },
    meta,
  };
}

function requestFor(task: TaskName): GenerateRequest {
  const basePrompt = "short original hopeful instrumental pop, warm piano, clear chorus";
  switch (task) {
    case "music":
      return taskModelRequest(
        "suno_music_chirp_fenix",
        {
          title: title(task),
          tags: "hopeful pop, warm piano",
          make_instrumental: true,
        },
        [{ type: "text", text: basePrompt }],
      );
    case "sound":
      return taskModelRequest(
        "suno_sound_chirp_v5",
        {
          title: title(task),
          tags: "ambient, rain, cinematic",
          make_instrumental: true,
          metadata_params: { sound: "gentle rain ambience with distant thunder" },
        },
        [{ type: "text", text: "gentle rain ambience with distant thunder" }],
      );
    case "infill":
      return taskModelRequest(
        "suno_infill_chirp_v5",
        {
          title: title(task),
          tags: "hopeful pop, warm piano",
          make_instrumental: true,
          task_id: seed.taskId,
          clip_id: seed.clipId,
          continue_clip_id: seed.clipId,
          continue_at: 20,
          metadata_params: {
            continue_clip_id: seed.clipId,
            continued_aligned_prompt: "replace this section with a brighter warm piano phrase",
            infill_start_s: 8,
            infill_end_s: 14,
            infill_context_start_s: 0,
            infill_context_end_s: 32,
            metadata: { infill_lyrics: "brighter warm piano phrase" },
          },
        },
        [{ type: "text", text: basePrompt }],
      );
    case "cover":
      return taskModelRequest(
        "suno_cover_chirp_v5",
        {
          title: title(task),
          tags: "hopeful pop, warm piano",
          make_instrumental: false,
          task_id: seed.taskId,
          cover_clip_id: seed.clipId,
          continue_clip_id: seed.clipId,
          continue_at: 20,
        },
        [
          {
            type: "text",
            text: "[Verse]\nnew hopeful lyrics over warm piano\n[Chorus]\ncarry us home in morning light",
          },
        ],
      );
    case "vox":
      return taskModelRequest(
        "suno_vox_chirp_v5",
        {
          title: title(task),
          tags: "pop,female voice",
          make_instrumental: false,
          artist_clip_id: seed.clipId,
        },
        [{ type: "text", text: "[Verse]\nnew hopeful lyrics\n[Chorus]\nwarm piano carries us home" }],
      );
    case "image_to_song": {
      const prompt = "short original instrumental inspired by a quiet waterfall, warm piano";
      const metadataParams = {
        prompt,
        tags: "ambient instrumental, warm piano",
        image_url: seed.imageUrl,
      };
      return taskModelRequest(
        "suno_image_to_song_chirp_v5",
        {
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
    case "video_to_song": {
      const prompt = "short original instrumental inspired by a slow flower video, warm piano";
      const metadataParams = {
        prompt,
        tags: "cinematic instrumental, warm piano",
        video_url: seed.videoUrl,
      };
      return taskModelRequest(
        "suno_video_to_song_chirp_v5",
        {
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
    case "upsample_tags":
      return {
        model: "suno_style_tags",
        content: [{ type: "text", text: "hopeful pop, warm piano, clear chorus" }],
      };
    case "upload_audio":
      return {
        model: "suno_upload_audio",
        content: [{ type: "audio", source: { type: "url", url: seed.acapellaAudioUrl } }],
        parameters: { poll_interval: DEFAULT_POLL_INTERVAL, max_wait: DEFAULT_MAX_WAIT },
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
