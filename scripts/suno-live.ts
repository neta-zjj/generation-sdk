import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { createGenerationClient, type GenerationContentBlock, type GenerationDebugEvent } from "../src/index.js";
import { buildSunoLiveRequest, type SunoLiveTask, sunoLiveTasks } from "./suno-live-data.js";

const DEFAULT_BASE_URL = "https://dev.router.neta.art";
const RESULT_DIR = "/tmp/neta-generation-live/tasks";
const SUMMARY_PATH = "/tmp/neta-generation-live/live-summary.json";
const KEY_FILE = "/tmp/neta-router-key";

function resultFileName(task: string): string {
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

async function runTask(task: SunoLiveTask, apiKey: string, baseUrl: string) {
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
  const request = buildSunoLiveRequest(task);
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
  const selected = getArg("tasks")?.split(",").filter(Boolean) as (typeof sunoLiveTasks)[number][] | undefined;
  const tasks = selected?.length ? selected : sunoLiveTasks;

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
