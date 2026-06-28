import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, relative, sep } from "node:path";
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

function sanitizeOptions(options) {
  const { apiKey: _apiKey, ...safeOptions } = options;
  return safeOptions;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function htmlJson(value) {
  return escapeHtml(JSON.stringify(value, null, 2));
}

function mediaSrc(options, result, mediaIndex, fallbackUrl) {
  const path = result.downloads?.[mediaIndex];
  if (path?.startsWith(options.outDir)) return relative(options.outDir, path).split(sep).join("/");
  return fallbackUrl;
}

function renderImage(label, url) {
  return `<figure><img src="${escapeHtml(url)}" alt="${escapeHtml(label)}"><figcaption>${escapeHtml(label)}</figcaption></figure>`;
}

function renderVideo(label, url) {
  return `<figure><video src="${escapeHtml(url)}" controls muted loop playsinline></video><figcaption>${escapeHtml(label)}</figcaption></figure>`;
}

function renderOutputMedia(options, result) {
  if (!("output" in result)) return "<p>No output media.</p>";
  let mediaIndex = 0;
  return result.output
    .filter((block) => block.type === "image" || block.type === "video")
    .map((block) => {
      const fallbackUrl = block.source.type === "url" ? block.source.url : "";
      const src = mediaSrc(options, result, mediaIndex, fallbackUrl);
      mediaIndex += 1;
      const label = `output ${mediaIndex}: ${block.type}${block.meta?.role ? ` (${block.meta.role})` : ""}`;
      return block.type === "video" ? renderVideo(label, src) : renderImage(label, src);
    })
    .join("\n");
}

function visualExpectations(task) {
  if (task === "text") {
    return [
      "Generated video should match the pure prompt without requiring any media input.",
      "Expected visible cue: a red origami crane/object in a clean white tabletop studio scene.",
    ];
  }

  if (task === "frames") {
    return [
      "The first generated frame should visibly match the red FIRST FRAME input.",
      "The final generated frame should visibly match the blue LAST FRAME input.",
      "The middle should transition between those two anchors, not ignore either role.",
    ];
  }

  return [
    "Generated video should preserve visual identity from every reference_image input.",
    "Generated motion should be judged against the reference_video, but reference_video is a style/motion cue rather than a hard frame lock.",
    "Do not mark this task as visually passed only because the API request succeeded.",
  ];
}

function renderInputs(options, task) {
  if (task === "text") return "<p>No input media for this task.</p>";
  if (task === "frames") {
    return [
      renderImage("first_frame input", options.firstFrameUrl),
      renderImage("last_frame input", options.lastFrameUrl),
    ].join("\n");
  }
  return [
    ...options.referenceImageUrls.map((url, index) => renderImage(`reference_image input ${index + 1}`, url)),
    renderVideo("reference_video input", options.referenceVideoUrl),
  ].join("\n");
}

async function writeVisualReviewReport(options, results) {
  const sections = results
    .map(
      (result) => `<section>
        <h2>${escapeHtml(result.task)}: ${result.ok ? "transport ok" : "transport failed"}</h2>
        <div class="expectations">
          <strong>Visual pass criteria</strong>
          <ul>${visualExpectations(result.task)
            .map((item) => `<li>${escapeHtml(item)}</li>`)
            .join("")}</ul>
        </div>
        <h3>Input media</h3>
        <div class="media-grid">${renderInputs(options, result.task)}</div>
        <h3>Output media</h3>
        <div class="media-grid">${renderOutputMedia(options, result)}</div>
        <details>
          <summary>SDK request summary</summary>
          <pre>${htmlJson(result.request)}</pre>
        </details>
      </section>`,
    )
    .join("\n");

  const reportPath = join(options.outDir, "visual-review.html");
  await writeFile(
    reportPath,
    `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Seedance live visual review</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 24px; color: #161616; background: #f7f7f7; }
    h1, h2, h3 { margin: 0 0 12px; }
    section { margin: 24px 0; padding: 16px; background: white; border: 1px solid #ddd; border-radius: 8px; }
    .media-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; align-items: start; }
    figure { margin: 0; border: 1px solid #ddd; border-radius: 6px; overflow: hidden; background: #fff; }
    img, video { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: contain; background: #111; }
    figcaption { padding: 8px 10px; font-size: 13px; color: #333; }
    .expectations { margin: 0 0 12px; padding: 10px 12px; background: #f0f4ff; border: 1px solid #c9d6ff; border-radius: 6px; }
    pre { overflow: auto; padding: 12px; background: #111; color: #f2f2f2; border-radius: 6px; }
  </style>
</head>
<body>
  <h1>Seedance live visual review</h1>
  <p>Generated from the real SDK live smoke script. Transport success is not enough; use the criteria in each section to judge whether roles had visible effect.</p>
  ${sections}
</body>
</html>
`,
    "utf8",
  );
  return reportPath;
}

async function loadExistingRun(options, selectedTasks) {
  const summaryPath = join(options.outDir, "summary.json");
  const summaryFile = JSON.parse(await readFile(summaryPath, "utf8"));
  const storedOptions = sanitizeOptions(summaryFile.options ?? {});
  const mergedOptions = { ...options, ...storedOptions };
  const tasks =
    selectedTasks.length > 0 ? selectedTasks : (summaryFile.summary?.map((item) => item.task).filter(Boolean) ?? TASKS);
  const results = await Promise.all(
    tasks.map(async (task) => JSON.parse(await readFile(join(options.outDir, task, "result.json"), "utf8"))),
  );
  return { options: mergedOptions, results, summaryPath };
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
  const tasksArg = getArg("tasks");
  const selectedTasks = (tasksArg === undefined ? TASKS : tasksArg.split(",").filter(Boolean)).map((task) =>
    task.trim(),
  );
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
  if (hasFlag("report-only")) {
    const existing = await loadExistingRun(options, tasksArg === undefined ? [] : selectedTasks);
    const visualReviewPath = await writeVisualReviewReport(existing.options, existing.results);
    console.log(
      JSON.stringify(
        {
          summary_path: existing.summaryPath,
          visual_review_file: visualReviewPath,
          tasks: existing.results.map((r) => r.task),
        },
        null,
        2,
      ),
    );
    return;
  }

  const apiKey = await readApiKey();
  const summary = [];
  const results = [];
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
    results.push(result);
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

  const visualReviewPath = await writeVisualReviewReport(options, results);
  const summaryPath = join(options.outDir, "summary.json");
  await writeFile(
    summaryPath,
    JSON.stringify({ options: sanitizeOptions(options), summary, visual_review_file: visualReviewPath }, null, 2),
  );
  console.log(JSON.stringify({ summary_path: summaryPath, visual_review_file: visualReviewPath, summary }, null, 2));
  if (summary.some((item) => !item.ok)) process.exitCode = 1;
}

await main();
