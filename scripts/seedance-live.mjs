import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { createGenerationClient } from "../dist/index.js";

const DEFAULT_BASE_URL = "https://router.neta.art";
const DEFAULT_OUT_DIR = "/tmp/neta-generation-live/seedance";
const KEY_FILE = "/tmp/neta-router-key";
const TASKS = ["text", "frames", "references"];

const DEFAULT_ASSETS = {
  firstFrameUrl: "https://dummyimage.com/768x432/cc2222/ffffff.png?text=FIRST+FRAME",
  lastFrameUrl: "https://dummyimage.com/768x432/2244cc/ffffff.png?text=LAST+FRAME",
  referenceImageUrls: [
    "https://dummyimage.com/768x432/cc2222/ffffff.png?text=REFERENCE+IMAGE+1",
    "https://dummyimage.com/768x432/22aa55/ffffff.png?text=REFERENCE+IMAGE+2",
  ],
  referenceVideoUrl: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
};

function getArg(name) {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  if (value) return value.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function getArgs(name) {
  const prefix = `--${name}=`;
  const values = process.argv.filter((arg) => arg.startsWith(prefix)).map((arg) => arg.slice(prefix.length));
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === `--${name}` && process.argv[index + 1]) values.push(process.argv[index + 1]);
  }
  return values;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function numberArg(name, fallback) {
  const value = getArg(name);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid --${name}: ${value}`);
  return parsed;
}

async function readApiKey() {
  const envKey = (process.env.NETA_ROUTER_API_KEY ?? process.env.NETA_API_KEY)?.trim();
  if (envKey) return envKey;
  return (await readFile(KEY_FILE, "utf8")).trim();
}

function requestIds(events) {
  const ids = new Set();
  for (const event of events) {
    if (event.type === "response") {
      const id = event.trace["x-request-id"];
      if (id) ids.add(id);
    }
  }
  return [...ids];
}

function contentSummary(content) {
  return content.map((block) => {
    if (block.type === "text") return { type: "text", text: block.text };
    return { type: block.type, source: block.source, meta: block.meta };
  });
}

function outputSummary(output) {
  return output.map((block) => {
    if (block.type === "text") return { type: "text", text: block.text, meta: block.meta };
    return {
      type: block.type,
      source:
        block.source.type === "url" ? block.source : { type: block.source.type, mediaType: block.source.mediaType },
      meta: block.meta,
    };
  });
}

function errorJson(error) {
  if (!error || typeof error !== "object") return { message: String(error) };
  return {
    name: error.name,
    message: error.message,
    status: error.status,
    details: error.details,
  };
}

async function probeUrl(url) {
  try {
    let response = await fetch(url, { method: "HEAD" });
    if (!response.ok || response.status === 405) {
      response = await fetch(url, { headers: { Range: "bytes=0-0" } });
    }
    return {
      ok: response.ok,
      status: response.status,
      content_type: response.headers.get("content-type"),
      content_length: response.headers.get("content-length"),
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function extensionFor(block, contentType) {
  if (contentType?.includes("mp4")) return ".mp4";
  if (contentType?.includes("webm")) return ".webm";
  if (contentType?.includes("png")) return ".png";
  if (contentType?.includes("jpeg") || contentType?.includes("jpg")) return ".jpg";
  if (block.source.type === "url") {
    const extension = extname(new URL(block.source.url).pathname);
    if (extension) return extension;
  }
  return block.type === "video" ? ".mp4" : ".bin";
}

async function downloadUrl(block, pathPrefix) {
  if (block.type !== "image" && block.type !== "video") return null;
  if (block.source.type !== "url") return null;
  const response = await fetch(block.source.url);
  if (!response.ok) throw new Error(`download failed ${response.status}: ${block.source.url}`);
  const contentType = response.headers.get("content-type");
  const path = `${pathPrefix}${extensionFor(block, contentType)}`;
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
  return path;
}

function buildRequest(task, options) {
  const parameters = {
    duration: options.duration,
    resolution: options.resolution,
    aspect_ratio: options.aspectRatio,
    generate_audio: false,
    return_last_frame: true,
    poll_interval: options.pollInterval,
    max_wait: options.maxWait,
  };

  if (task === "text") {
    return {
      model: options.model,
      content: [
        {
          type: "text",
          text: "A red origami paper crane slowly flies over a white tabletop, clean studio lighting, smooth camera motion.",
        },
      ],
      parameters,
    };
  }

  if (task === "frames") {
    return {
      model: options.model,
      content: [
        {
          type: "text",
          text: "Create a smooth transition from the red FIRST FRAME placard to the blue LAST FRAME placard. Keep the labels readable and the camera movement gentle.",
        },
        { type: "image", source: { type: "url", url: options.firstFrameUrl }, meta: { role: "first_frame" } },
        { type: "image", source: { type: "url", url: options.lastFrameUrl }, meta: { role: "last_frame" } },
      ],
      parameters,
    };
  }

  if (task === "references") {
    return {
      model: options.model,
      content: [
        {
          type: "text",
          text: "Create a short video using the red and green reference placards as visual identity cues, and borrow gentle organic motion from the flower reference video.",
        },
        ...options.referenceImageUrls.map((url) => ({
          type: "image",
          source: { type: "url", url },
          meta: { role: "reference_image" },
        })),
        { type: "video", source: { type: "url", url: options.referenceVideoUrl }, meta: { role: "reference_video" } },
      ],
      parameters,
    };
  }

  throw new Error(`Unknown task: ${task}`);
}

async function runTask(task, client, options, events) {
  const request = buildRequest(task, options);
  const startedAt = Date.now();
  const taskDir = join(options.outDir, task);
  await mkdir(taskDir, { recursive: true });

  try {
    const output = await client.generate(request);
    const probes = [];
    const downloads = [];
    for (let index = 0; index < output.length; index += 1) {
      const block = output[index];
      if ((block.type === "video" || block.type === "image") && block.source.type === "url") {
        const probe = await probeUrl(block.source.url);
        probes.push({ index, type: block.type, url: block.source.url, ...probe });
        if (options.download && probe.ok) {
          downloads.push(
            await downloadUrl(block, join(taskDir, `${String(index + 1).padStart(2, "0")}-${block.type}`)),
          );
        }
      }
    }

    const videoCount = output.filter((block) => block.type === "video").length;
    const result = {
      task,
      ok: videoCount > 0 && probes.every((probe) => probe.ok),
      elapsed_s: Math.round((Date.now() - startedAt) / 1000),
      request: {
        model: request.model,
        parameters: request.parameters,
        content: contentSummary(request.content),
      },
      output: outputSummary(output),
      probes,
      downloads: downloads.filter(Boolean),
      request_ids: requestIds(events),
      events,
    };
    await writeFile(join(taskDir, "result.json"), JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    const result = {
      task,
      ok: false,
      elapsed_s: Math.round((Date.now() - startedAt) / 1000),
      request: {
        model: request.model,
        parameters: request.parameters,
        content: contentSummary(request.content),
      },
      error: errorJson(error),
      request_ids: requestIds(events),
      events,
    };
    await writeFile(join(taskDir, "result.json"), JSON.stringify(result, null, 2));
    return result;
  }
}

async function main() {
  const apiKey = await readApiKey();
  const selectedTasks = (getArg("tasks")?.split(",").filter(Boolean) ?? TASKS).map((task) => task.trim());
  const referenceImageUrls = getArgs("reference-image-url");
  const options = {
    baseUrl: getArg("base-url") ?? DEFAULT_BASE_URL,
    outDir: getArg("out") ?? DEFAULT_OUT_DIR,
    model: getArg("model") ?? "seedance-2-0-fast",
    duration: numberArg("duration", 4),
    resolution: getArg("resolution") ?? "480p",
    aspectRatio: getArg("aspect-ratio") ?? "16:9",
    pollInterval: numberArg("poll-interval", 5),
    maxWait: numberArg("max-wait", 900),
    download: hasFlag("download"),
    firstFrameUrl: getArg("first-frame-url") ?? DEFAULT_ASSETS.firstFrameUrl,
    lastFrameUrl: getArg("last-frame-url") ?? DEFAULT_ASSETS.lastFrameUrl,
    referenceImageUrls: referenceImageUrls.length > 0 ? referenceImageUrls : DEFAULT_ASSETS.referenceImageUrls,
    referenceVideoUrl: getArg("reference-video-url") ?? DEFAULT_ASSETS.referenceVideoUrl,
  };

  await mkdir(options.outDir, { recursive: true });
  const summary = [];
  for (const task of selectedTasks) {
    const clientEvents = [];
    const taskClient = createGenerationClient({
      apiKey,
      baseUrl: options.baseUrl,
      debug: {
        enabled: true,
        includeSensitive: false,
        includeResponseBody: true,
        logger: (event) => clientEvents.push(event),
      },
    });
    console.error(`running ${task} against ${options.baseUrl} with ${options.model}`);
    const result = await runTask(task, taskClient, options, clientEvents);
    summary.push({
      task,
      ok: result.ok,
      elapsed_s: result.elapsed_s,
      result_file: join(options.outDir, task, "result.json"),
      video_urls:
        "output" in result
          ? result.output.filter((block) => block.type === "video").map((block) => block.source.url)
          : [],
      request_ids: result.request_ids,
    });
    console.error(`${task}: ${result.ok ? "ok" : "failed"} (${result.elapsed_s}s)`);
  }

  const summaryPath = join(options.outDir, "summary.json");
  await writeFile(summaryPath, JSON.stringify({ options: { ...options, apiKey: "[REDACTED]" }, summary }, null, 2));
  console.log(JSON.stringify({ summary_path: summaryPath, summary }, null, 2));
  if (summary.some((item) => !item.ok)) process.exitCode = 1;
}

await main();
