import { once } from "node:events";
import { createServer, type IncomingHttpHeaders, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createGenerationClient,
  type GenerationContentBlock,
  GenerationProviderError,
  GenerationTimeoutError,
  GenerationTransportError,
} from "../../src/index.js";

type Received = { method: string; path: string; headers: IncomingHttpHeaders; body: unknown };
// cut 为 true 时只写出响应头和一半响应体，然后断开连接。
type Reply = { status: number; body: unknown; cut?: true };

const SUBMIT_COST = 0.4;
const SETTLED_COST = 0.3;

function sendJson(response: ServerResponse, reply: Reply): void {
  const text = JSON.stringify(reply.body);
  response.writeHead(reply.status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  if (reply.cut) {
    response.write(text.slice(0, text.length / 2), () => response.destroy());
    return;
  }
  response.end(text);
}

// 本地 HTTP 网关：按顺序记录请求，并按测试给出的处理函数回复。
async function withGateway(
  respond: (received: Received, history: Received[]) => Reply,
  run: (baseUrl: string, received: Received[]) => Promise<void>,
): Promise<void> {
  const received: Received[] = [];
  const server = createServer((incoming, response) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const entry: Received = {
        method: incoming.method ?? "",
        path: incoming.url ?? "",
        headers: incoming.headers,
        body: text ? (JSON.parse(text) as unknown) : undefined,
      };
      received.push(entry);
      sendJson(response, respond(entry, received));
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HTTP listener has no address");
  try {
    await run(`http://127.0.0.1:${address.port}`, received);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
}

// 提交返回 New API 的任务 ID 和预扣的 usage.cost；查询返回 tasks 中对应的任务对象，任务成功之前 usage.cost 是预扣的费用，成功之后是结算的费用。
function taskGateway(taskId: string, tasks: Array<Record<string, unknown>>) {
  let polls = 0;
  return (received: Received): Reply => {
    if (received.method === "POST") return { status: 200, body: { result: taskId, usage: { cost: SUBMIT_COST } } };
    const task = tasks[Math.min(polls, tasks.length - 1)];
    polls += 1;
    const cost = task?.status === "SUCCEEDED" ? SETTLED_COST : SUBMIT_COST;
    return { status: 200, body: { ...task, usage: { cost } } };
  };
}

function asset(taskId: string, file: string): string {
  return `https://assets.meshy.ai/owner/tasks/${taskId}/output/${file}?Expires=1&Key-Pair-Id=k&Signature=s`;
}

function textBlock(text: string): GenerationContentBlock {
  return { type: "text", text };
}

function imageBlock(url: string, meta?: Record<string, unknown>): GenerationContentBlock {
  return { type: "image", source: { type: "url", url }, ...(meta ? { meta } : {}) };
}

function modelBlock(url: string, meta?: Record<string, unknown>): GenerationContentBlock {
  return { type: "3d", source: { type: "url", url }, ...(meta ? { meta } : {}) };
}

function client(baseUrl: string) {
  return createGenerationClient({ apiKey: "sk-test", baseUrl });
}

function submitted(received: Received[]): Received {
  const submit = received.find((entry) => entry.method === "POST");
  if (!submit) throw new Error("No submit request");
  return submit;
}

const previewTask = {
  id: "task_preview",
  type: "text-to-3d-preview",
  status: "SUCCEEDED",
  progress: 100,
  prompt: "a wooden chest",
  model_urls: {
    usdz: asset("p", "model.usdz"),
    obj: asset("p", "model.obj"),
    glb: asset("p", "model.glb"),
    mtl: asset("p", "model.mtl"),
    fbx: asset("p", "model.fbx"),
    stl: asset("p", "model.stl"),
  },
  thumbnail_url: asset("p", "preview.png"),
  texture_urls: [],
  texture_image_url: "",
  task_error: { message: "" },
};

function meshyOutput(
  taskId: string,
  taskType: string,
  type: "3d" | "image" | "video",
  url: string,
  meta: Record<string, unknown> = {},
): GenerationContentBlock {
  return { type, source: { type: "url", url }, meta: { task_id: taskId, task_type: taskType, ...meta } };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("meshy.tasks adapter", () => {
  it("declares one meshy model whose operation parameter selects each Meshy action", () => {
    const models = createGenerationClient()
      .listModels()
      .filter((model) => model.adapter.type === "meshy.tasks");
    expect(models.map((model) => [model.model, model.category, model.adapter])).toEqual([
      ["meshy", "3d", { type: "meshy.tasks" }],
    ]);
    const [meshy] = models;
    const operations = [
      "text-to-image",
      "image-to-image",
      "text-to-3d",
      "text-to-3d-refine",
      "image-to-3d",
      "multi-image-to-3d",
      "retexture",
      "remesh",
      "rigging",
      "text-to-motion",
      "animation",
    ];
    expect(Object.keys(meshy?.operations ?? {})).toEqual(operations);
    expect(meshy?.parameters?.operation).toMatchObject({ type: "string", enum: operations });
    expect(meshy?.parameters?.operation).not.toHaveProperty("optional");
    expect(Object.keys(meshy?.parameters ?? {})).toEqual(["operation", "poll_interval", "max_wait"]);
    expect(meshy?.content.input).toEqual([]);
  });

  it("submits a preview, polls until it succeeds, and returns the model formats before the images and the settled cost", async () => {
    const pending = { id: "task_preview", type: "text-to-3d-preview", status: "PENDING", progress: 0 };
    await withGateway(taskGateway("task_preview", [pending, previewTask]), async (baseUrl, received) => {
      const result = await client(baseUrl).generateResult({
        model: "meshy",
        content: [textBlock("a wooden chest"), textBlock("with iron bands")],
        parameters: { operation: "text-to-3d", target_formats: ["glb", "obj"], ai_model: "latest", poll_interval: 1 },
        meta: { cohub: { user: "u" }, name: "not sent" },
      });

      expect(received.map((entry) => `${entry.method} ${entry.path}`)).toEqual([
        "POST /meshy/openapi/v2/text-to-3d",
        "GET /meshy/openapi/v2/text-to-3d/task_preview",
        "GET /meshy/openapi/v2/text-to-3d/task_preview",
      ]);
      expect(submitted(received).headers.authorization).toBe("Bearer sk-test");
      expect(submitted(received).body).toEqual({
        mode: "preview",
        prompt: "a wooden chest\nwith iron bands",
        target_formats: ["glb", "obj"],
        ai_model: "latest",
      });
      expect(result.cost).toBe(SETTLED_COST);
      expect(result.content).toEqual([
        meshyOutput("task_preview", "text-to-3d-preview", "3d", previewTask.model_urls.glb, {
          field: "model_urls.glb",
          format: "glb",
        }),
        meshyOutput("task_preview", "text-to-3d-preview", "3d", previewTask.model_urls.fbx, {
          field: "model_urls.fbx",
          format: "fbx",
        }),
        meshyOutput("task_preview", "text-to-3d-preview", "3d", previewTask.model_urls.obj, {
          field: "model_urls.obj",
          format: "obj",
          mtl_url: previewTask.model_urls.mtl,
        }),
        meshyOutput("task_preview", "text-to-3d-preview", "3d", previewTask.model_urls.usdz, {
          field: "model_urls.usdz",
          format: "usdz",
        }),
        meshyOutput("task_preview", "text-to-3d-preview", "3d", previewTask.model_urls.stl, {
          field: "model_urls.stl",
          format: "stl",
        }),
        meshyOutput("task_preview", "text-to-3d-preview", "image", previewTask.thumbnail_url, {
          field: "thumbnail_url",
        }),
      ]);
    });
  });

  it("refines a preview output block by its task ID and returns the texture maps", async () => {
    const refineTask = {
      id: "task_refine",
      type: "text-to-3d-refine",
      status: "SUCCEEDED",
      model_urls: { glb: asset("r", "model.glb") },
      thumbnail_url: asset("r", "preview.png"),
      texture_urls: [{ normal: asset("r", "texture_0_normal.png"), base_color: asset("r", "texture_0.png") }],
      texture_image_url: asset("r", "input-echo.png"),
    };
    await withGateway(taskGateway("task_refine", [refineTask]), async (baseUrl, received) => {
      const preview = meshyOutput("task_preview", "text-to-3d-preview", "3d", previewTask.model_urls.glb, {
        field: "model_urls.glb",
        format: "glb",
      });
      const content = await client(baseUrl).generate({
        model: "meshy",
        content: [preview, textBlock("weathered oak")],
        parameters: { operation: "text-to-3d-refine", enable_pbr: true },
      });

      expect(submitted(received).body).toEqual({
        mode: "refine",
        preview_task_id: "task_preview",
        texture_prompt: "weathered oak",
        enable_pbr: true,
      });
      expect(content.map((block) => [block.type, block.meta?.field])).toEqual([
        ["3d", "model_urls.glb"],
        ["image", "thumbnail_url"],
        ["image", "texture_urls[0].base_color"],
        ["image", "texture_urls[0].normal"],
      ]);
      expect(content.every((block) => block.meta?.role === undefined)).toBe(true);
    });
  });

  it("sends image URLs, separates texture images by role, and returns only generated files", async () => {
    const imageTask = {
      id: "task_image",
      type: "multi-image-to-3d",
      status: "SUCCEEDED",
      model_urls: { glb: asset("i", "m.glb") },
      image_urls: [asset("i", "input-0.png")],
      texture_image_urls: [asset("i", "texture-input-0.png")],
    };
    await withGateway(taskGateway("task_image", [imageTask]), async (baseUrl, received) => {
      const generation = client(baseUrl);
      await generation.generate({
        model: "meshy",
        content: [
          imageBlock("https://example.com/character.png"),
          imageBlock("https://example.com/texture.png", { role: "texture" }),
        ],
        parameters: { operation: "image-to-3d" },
      });
      const output = await generation.generate({
        model: "meshy",
        content: [
          imageBlock("https://example.com/front.png"),
          imageBlock("https://example.com/back.png"),
          imageBlock("https://example.com/texture-front.png", { role: "texture" }),
          imageBlock("https://example.com/texture-back.png", { role: "texture" }),
        ],
        parameters: { operation: "multi-image-to-3d" },
      });
      await generation.generate({
        model: "meshy",
        content: [
          imageBlock("https://example.com/front.png"),
          imageBlock("https://example.com/texture-front.png", { role: "texture" }),
        ],
        parameters: { operation: "multi-image-to-3d" },
      });

      const bodies = received.filter((entry) => entry.method === "POST").map((entry) => entry.body);
      expect(bodies).toEqual([
        { image_url: "https://example.com/character.png", texture_image_url: "https://example.com/texture.png" },
        {
          image_urls: ["https://example.com/front.png", "https://example.com/back.png"],
          texture_image_urls: ["https://example.com/texture-front.png", "https://example.com/texture-back.png"],
        },
        { image_urls: ["https://example.com/front.png"], texture_image_url: "https://example.com/texture-front.png" },
      ]);
      expect(output.map((block) => block.meta?.field)).toEqual(["model_urls.glb"]);
    });
  });

  it("references the main model of live source tasks that Meshy accepts and sends the file URL otherwise", async () => {
    const task = {
      id: "task_next",
      type: "retexture",
      status: "SUCCEEDED",
      expires_at: 1747291618417,
      model_urls: { glb: asset("n", "model.glb") },
    };
    await withGateway(taskGateway("task_next", [task]), async (baseUrl, received) => {
      const generation = client(baseUrl);
      const fromImage = modelBlock("https://cdn.example.com/a.glb", { task_id: "task_a", task_type: "image-to-3d" });
      const fromMultiImage = modelBlock("https://cdn.example.com/b.glb", {
        task_id: "task_b",
        task_type: "multi-image-to-3d",
      });
      const fromRetexture = modelBlock("https://cdn.example.com/c.glb", { task_id: "task_c", task_type: "retexture" });
      const fromRemesh = modelBlock("https://cdn.example.com/d.glb", { task_id: "task_d", task_type: "remesh" });
      const imageTask = { task_id: "task_e", task_type: "image-to-3d" };
      const mainFbx = modelBlock("https://cdn.example.com/e.fbx", { ...imageTask, field: "model_urls.fbx" });
      const preRemeshed = modelBlock("https://cdn.example.com/e-pre.glb", {
        ...imageTask,
        field: "model_urls.pre_remeshed_glb",
      });
      const expired = modelBlock("https://cdn.example.com/f.glb", {
        task_id: "task_f",
        task_type: "image-to-3d",
        field: "model_urls.glb",
        task_expires_at: "2025-05-15T06:46:58.417Z",
      });

      const output = await generation.generate({
        model: "meshy",
        content: [fromImage, textBlock("polished marble")],
        parameters: { operation: "retexture" },
      });
      await generation.generate({
        model: "meshy",
        content: [fromMultiImage, imageBlock("https://example.com/style.png")],
        parameters: { operation: "retexture" },
      });
      await generation.generate({
        model: "meshy",
        content: [
          modelBlock("https://example.com/upload.glb"),
          imageBlock("https://example.com/front.png"),
          imageBlock("https://example.com/back.png"),
        ],
        parameters: { operation: "retexture", ai_model: "meshy-7" },
      });
      const remesh = (block: GenerationContentBlock, parameters: Record<string, unknown> = {}) =>
        generation.generate({ model: "meshy", content: [block], parameters: { operation: "remesh", ...parameters } });
      await remesh(fromRetexture, { topology: "quad" });
      await remesh(fromRemesh);
      await remesh(mainFbx);
      await remesh(preRemeshed);
      await generation.generate({ model: "meshy", content: [expired], parameters: { operation: "rigging" } });
      await generation.generate({
        model: "meshy",
        content: [fromMultiImage, imageBlock("https://example.com/base-color.png")],
        parameters: { operation: "rigging", height_meters: 1.8 },
      });

      expect(received.filter((entry) => entry.method === "POST").map((entry) => [entry.path, entry.body])).toEqual([
        ["/meshy/openapi/v1/retexture", { input_task_id: "task_a", text_style_prompt: "polished marble" }],
        [
          "/meshy/openapi/v1/retexture",
          { model_url: "https://cdn.example.com/b.glb", image_style_url: "https://example.com/style.png" },
        ],
        [
          "/meshy/openapi/v1/retexture",
          {
            ai_model: "meshy-7",
            model_url: "https://example.com/upload.glb",
            multiview_image_urls: ["https://example.com/front.png", "https://example.com/back.png"],
          },
        ],
        ["/meshy/openapi/v1/remesh", { topology: "quad", input_task_id: "task_c" }],
        ["/meshy/openapi/v1/remesh", { model_url: "https://cdn.example.com/d.glb" }],
        ["/meshy/openapi/v1/remesh", { input_task_id: "task_e" }],
        ["/meshy/openapi/v1/remesh", { model_url: "https://cdn.example.com/e-pre.glb" }],
        ["/meshy/openapi/v1/rigging", { model_url: "https://cdn.example.com/f.glb" }],
        [
          "/meshy/openapi/v1/rigging",
          { height_meters: 1.8, input_task_id: "task_b", texture_image_url: "https://example.com/base-color.png" },
        ],
      ]);
      expect(output).toEqual([
        meshyOutput("task_next", "retexture", "3d", task.model_urls.glb, {
          field: "model_urls.glb",
          format: "glb",
          task_expires_at: "2025-05-15T06:46:58.417Z",
        }),
      ]);
    });
  });

  it("returns rigged characters and animations from the task result", async () => {
    const rigTask = {
      id: "task_rig",
      type: "rig",
      status: "SUCCEEDED",
      result: {
        rigged_character_fbx_url: asset("g", "Character_output.fbx"),
        rigged_character_glb_url: asset("g", "Character_output.glb"),
        basic_animations: {
          walking_glb_url: asset("g", "Animation_Walking_withSkin.glb"),
          walking_fbx_url: asset("g", "Animation_Walking_withSkin.fbx"),
          running_armature_glb_url: asset("g", "Animation_Running_withSkin_armature.glb"),
        },
      },
    };
    const animateTask = {
      id: "task_animate",
      type: "animate",
      status: "SUCCEEDED",
      result: {
        processed_usdz_url: asset("a", "processed.usdz"),
        animation_fbx_url: asset("a", "Animation_output.fbx"),
        animation_glb_url: asset("a", "Animation_output.glb"),
      },
    };
    const tasks: Record<string, unknown> = { task_rig: rigTask, task_animate: animateTask };
    const respond = (entry: Received): Reply => {
      if (entry.method === "POST") {
        const taskId = entry.path.endsWith("/rigging") ? "task_rig" : "task_animate";
        return { status: 200, body: { result: taskId } };
      }
      return { status: 200, body: tasks[entry.path.split("/").pop() ?? ""] };
    };
    await withGateway(respond, async (baseUrl, received) => {
      const generation = client(baseUrl);
      const rigged = await generation.generate({
        model: "meshy",
        content: [modelBlock("https://example.com/character.glb")],
        parameters: { operation: "rigging" },
      });
      const [character] = rigged;
      if (!character) throw new Error("No rigged character");
      await generation.generate({
        model: "meshy",
        content: [character],
        parameters: { operation: "animation", action_ids: [10, 25], post_process: "change_fps", fps: 60 },
      });
      const animated = await generation.generate({
        model: "meshy",
        content: [character, modelBlock("https://example.com/clip.fbx", { task_id: "task_motion", role: "motion" })],
        parameters: { operation: "animation" },
      });

      expect(rigged.map((block) => [block.type, block.meta?.field, block.meta?.format])).toEqual([
        ["3d", "result.rigged_character_glb_url", "glb"],
        ["3d", "result.rigged_character_fbx_url", "fbx"],
        ["3d", "result.basic_animations.walking_glb_url", "glb"],
        ["3d", "result.basic_animations.walking_fbx_url", "fbx"],
        ["3d", "result.basic_animations.running_armature_glb_url", "glb"],
      ]);
      expect(received.filter((entry) => entry.method === "POST").map((entry) => [entry.path, entry.body])).toEqual([
        ["/meshy/openapi/v1/rigging", { model_url: "https://example.com/character.glb" }],
        [
          "/meshy/openapi/v1/animations",
          { rig_task_id: "task_rig", action_ids: [10, 25], post_process: { operation_type: "change_fps", fps: 60 } },
        ],
        ["/meshy/openapi/v1/animations", { rig_task_id: "task_rig", motion_task_id: "task_motion" }],
      ]);
      expect(animated.map((block) => [block.meta?.field, block.meta?.format])).toEqual([
        ["result.animation_glb_url", "glb"],
        ["result.animation_fbx_url", "fbx"],
        ["result.processed_usdz_url", "usdz"],
      ]);
    });
  });

  it("generates motion clips and images", async () => {
    const tasks: Record<string, unknown> = {
      "text-to-motion": {
        id: "task_motion",
        type: "text-to-motion",
        status: "SUCCEEDED",
        expires_at: 1787573705881,
        result: { motion_url: asset("m", "clip.bvh"), motion_format: "bvh", duration_ms: 2500, mode: "swift" },
      },
      "text-to-image": {
        id: "task_t2i",
        type: "text-to-image",
        status: "SUCCEEDED",
        image_urls: [asset("t", "image_0.png"), asset("t", "image_1.png")],
      },
      "image-to-image": {
        id: "task_i2i",
        type: "image-to-image",
        status: "SUCCEEDED",
        image_urls: [asset("e", "image_0.png")],
      },
    };
    const respond = (entry: Received): Reply => {
      const action = entry.path.split("/")[4] ?? "";
      if (entry.method === "POST") return { status: 200, body: { result: `task_${action}` } };
      return { status: 200, body: tasks[action] };
    };
    await withGateway(respond, async (baseUrl, received) => {
      const generation = client(baseUrl);
      const motion = await generation.generate({
        model: "meshy",
        content: [textBlock("a person jumps forward")],
        parameters: { operation: "text-to-motion", duration: 2.5, mode: "swift" },
      });
      const images = await generation.generate({
        model: "meshy",
        content: [textBlock("a cartoon knight")],
        parameters: { operation: "text-to-image", ai_model: "nano-banana-2", generate_multi_view: true },
      });
      await generation.generate({
        model: "meshy",
        content: [textBlock("silver armor"), imageBlock("https://example.com/knight.png")],
        parameters: { operation: "image-to-image", ai_model: "gpt-image-2", aspect_ratio: "3:2" },
      });

      expect(received.filter((entry) => entry.method === "POST").map((entry) => [entry.path, entry.body])).toEqual([
        ["/meshy/openapi/v1/text-to-motion", { prompt: "a person jumps forward", duration: 2.5, mode: "swift" }],
        [
          "/meshy/openapi/v1/text-to-image",
          { prompt: "a cartoon knight", ai_model: "nano-banana-2", generate_multi_view: true },
        ],
        [
          "/meshy/openapi/v1/image-to-image",
          {
            prompt: "silver armor",
            reference_image_urls: ["https://example.com/knight.png"],
            ai_model: "gpt-image-2",
            aspect_ratio: "3:2",
          },
        ],
      ]);
      expect(motion).toEqual([
        meshyOutput("task_text-to-motion", "text-to-motion", "3d", asset("m", "clip.bvh"), {
          field: "result.motion_url",
          format: "bvh",
          duration_ms: 2500,
          task_expires_at: "2026-08-24T12:15:05.881Z",
        }),
      ]);
      expect(images.map((block) => [block.type, block.meta?.field])).toEqual([
        ["image", "image_urls[0]"],
        ["image", "image_urls[1]"],
      ]);
    });
  });

  it("validates the operation, content, and parameters before any request", () => {
    const generation = createGenerationClient({ apiKey: "sk-test" });
    const rigged = modelBlock("https://example.com/rigged.glb", { task_id: "task_rig" });
    const base64Model: GenerationContentBlock = {
      type: "3d",
      source: { type: "base64", mediaType: "model/gltf-binary", data: "Z2xURg==" },
    };
    const base64Image: GenerationContentBlock = {
      type: "image",
      source: { type: "base64", mediaType: "image/png", data: "iVBORw0KGgo=" },
    };
    const cases: Array<[unknown, GenerationContentBlock[], Record<string, unknown>, string]> = [
      [undefined, [textBlock("chest")], {}, "Missing required parameter: operation"],
      [3, [textBlock("chest")], {}, "Parameter operation must be a string"],
      [
        "text-to-3d-preview",
        [textBlock("chest")],
        {},
        "Parameter operation must be one of: text-to-image, image-to-image, text-to-3d, text-to-3d-refine,",
      ],
      ["remesh", [modelBlock("https://example.com/m.glb")], { duration: 3 }, "Unknown parameter: duration"],
      [
        "text-to-motion",
        [textBlock("jump"), imageBlock("https://example.com/a.png")],
        { duration: 3 },
        "Content block type is not supported by meshy: image",
      ],
      [
        "text-to-3d-refine",
        [modelBlock("https://example.com/preview.glb")],
        {},
        "Meshy preview_task_id requires a 3d block with meta.task_id from a text-to-3d-preview task",
      ],
      [
        "text-to-3d-refine",
        [modelBlock("https://example.com/a.glb", { task_id: "task_a", task_type: "image-to-3d" })],
        {},
        "Meshy preview_task_id requires a text-to-3d-preview task, got image-to-3d",
      ],
      [
        "text-to-3d-refine",
        [
          modelBlock("https://example.com/preview.glb", {
            task_id: "task_old",
            task_type: "text-to-3d-preview",
            task_expires_at: "2025-05-15T06:46:58.417Z",
          }),
        ],
        {},
        "Meshy preview_task_id references task task_old, which expired at 2025-05-15T06:46:58.417Z",
      ],
      [
        "text-to-3d-refine",
        [
          modelBlock("https://example.com/preview.glb", { task_id: "task_preview" }),
          textBlock("oak"),
          imageBlock("https://example.com/oak.png"),
        ],
        {},
        "Meshy accepts a texture text or texture images, not both",
      ],
      [
        "image-to-3d",
        [imageBlock("https://example.com/a.png"), imageBlock("https://example.com/b.png")],
        {},
        "Meshy expects 1 input image block(s), got 2",
      ],
      ["retexture", [modelBlock("https://example.com/m.glb")], {}, "requires a style text"],
      [
        "retexture",
        [
          modelBlock("https://example.com/m.glb"),
          imageBlock("https://example.com/front.png"),
          imageBlock("https://example.com/back.png"),
        ],
        {},
        "Several style images require parameters.ai_model meshy-7",
      ],
      [
        "multi-image-to-3d",
        [
          imageBlock("https://example.com/front.png"),
          imageBlock("https://example.com/texture-front.png", { role: "texture" }),
          imageBlock("https://example.com/texture-back.png", { role: "texture" }),
        ],
        { ai_model: "meshy-6" },
        "Several texture images require parameters.ai_model latest or meshy-7.1",
      ],
      ["animation", [rigged], {}, "exactly one of parameters.action_id"],
      [
        "animation",
        [modelBlock("https://example.com/a.glb", { task_id: "task_a", task_type: "image-to-3d" })],
        { action_id: 92 },
        "Meshy rig_task_id requires a rig task, got image-to-3d",
      ],
      [
        "animation",
        [rigged, modelBlock("https://example.com/b.glb", { task_id: "task_b", task_type: "rig", role: "motion" })],
        {},
        "Meshy motion_task_id requires a text-to-motion task, got rig",
      ],
      [
        "animation",
        [rigged],
        { action_id: 92, post_process: "change_fps", fps: 26 },
        "Parameter fps must be one of: 24, 25, 30, 60",
      ],
      [
        "animation",
        [rigged, modelBlock("https://example.com/clip.fbx", { task_id: "task_motion", role: "motion" })],
        { action_id: 92 },
        "exactly one of parameters.action_id",
      ],
      ["animation", [rigged], { action_id: 92, fps: 60 }, "Parameter fps requires post_process change_fps"],
      [
        "animation",
        [rigged, modelBlock("https://example.com/a.glb", { role: "texture" })],
        {},
        "3d role is not supported by meshy: texture",
      ],
      [
        "animation",
        [rigged],
        { action_ids: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
        "Parameter action_ids must contain at most 10 item(s)",
      ],
      ["animation", [rigged], { action_ids: [1, 1] }, "Parameter action_ids must not contain duplicate items"],
      [
        "text-to-3d",
        [textBlock("chest")],
        { target_formats: [] },
        "Parameter target_formats must contain at least 1 item(s)",
      ],
      [
        "text-to-3d",
        [textBlock("chest")],
        { target_formats: ["blend"] },
        "Parameter target_formats[0] must be one of: glb, obj, fbx, stl, usdz, 3mf",
      ],
      ["text-to-motion", [textBlock("jump")], {}, "Missing required parameter: duration"],
      ["text-to-motion", [textBlock("jump")], { duration: 2.3 }, "Parameter duration must be a multiple of 0.5"],
      ["text-to-image", [textBlock("knight")], {}, "Missing required parameter: ai_model"],
      ["remesh", [base64Model], {}, "3d source is not supported by meshy: base64"],
      ["image-to-3d", [base64Image], {}, "image source is not supported by meshy: base64"],
    ];
    for (const [operation, content, parameters, message] of cases) {
      const request = { model: "meshy", content, parameters: { operation, ...parameters } };
      expect(() => generation.validate(request), `${String(operation)}: ${message}`).toThrow(message);
    }
  });

  it("reports failed tasks and stops on status errors that retrying cannot fix, with the task ID", async () => {
    const failed = {
      id: "task_failed",
      status: "FAILED",
      task_error: { message: "The image does not contain a recognizable object" },
    };
    await withGateway(taskGateway("task_failed", [failed]), async (baseUrl) => {
      const error = await client(baseUrl)
        .generate({
          model: "meshy",
          content: [imageBlock("https://example.com/blank.png")],
          parameters: { operation: "image-to-3d" },
        })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(GenerationProviderError);
      expect(error).toMatchObject({
        message: "Meshy task failed: The image does not contain a recognizable object",
        details: { task_id: "task_failed", status: "FAILED" },
      });
    });

    const notFound = (entry: Received): Reply =>
      entry.method === "POST"
        ? { status: 200, body: { result: "task_missing" } }
        : { status: 404, body: { error: { message: "task_not_exist" } } };
    await withGateway(notFound, async (baseUrl, received) => {
      const error = await client(baseUrl)
        .generate({ model: "meshy", content: [textBlock("chest")], parameters: { operation: "text-to-3d" } })
        .catch((caught: unknown) => caught);
      expect(error).toMatchObject({
        message: "Meshy task task_missing status check failed: Meshy request failed (404): task_not_exist",
        status: 404,
        details: { task_id: "task_missing" },
      });
      expect(received.filter((entry) => entry.method === "GET")).toHaveLength(1);
    });

    const rejected = (): Reply => ({ status: 400, body: { message: "Invalid ai_model for smart-topology" } });
    await withGateway(rejected, async (baseUrl, received) => {
      await expect(
        client(baseUrl).generate({
          model: "meshy",
          content: [textBlock("chest")],
          parameters: { operation: "text-to-3d", model_type: "smart-topology", ai_model: "meshy-6" },
        }),
      ).rejects.toMatchObject({
        message: "Meshy request failed (400): Invalid ai_model for smart-topology",
        status: 400,
      });
      expect(received).toHaveLength(1);
    });
  });

  it("retries status checks that fail with 429 or 5xx or break off while the body is read, also in debug mode", async () => {
    const replies: Reply[] = [
      { status: 503, body: { error: { message: "upstream unavailable" } } },
      { status: 429, body: { error: { message: "rate limited" } } },
      { status: 200, body: { ...previewTask, id: "task_retry" }, cut: true },
      { status: 200, body: { ...previewTask, id: "task_retry" } },
    ];
    const respond = (entry: Received, history: Received[]): Reply => {
      if (entry.method === "POST") return { status: 200, body: { result: "task_retry" } };
      const polls = history.filter((item) => item.method === "GET").length;
      return replies[polls - 1] ?? { status: 500, body: {} };
    };
    const debugEvents: unknown[] = [];
    const clients = [
      (baseUrl: string) => client(baseUrl),
      (baseUrl: string) =>
        createGenerationClient({
          apiKey: "sk-test",
          baseUrl,
          debug: { enabled: true, includeResponseBody: true, logger: (event) => debugEvents.push(event) },
        }),
    ];
    await Promise.all(
      clients.map((create) =>
        withGateway(respond, async (baseUrl, received) => {
          const content = await create(baseUrl).generate({
            model: "meshy",
            content: [textBlock("chest")],
            parameters: { operation: "text-to-3d", poll_interval: 1 },
          });
          expect(received.filter((entry) => entry.method === "GET")).toHaveLength(4);
          expect(content[0]?.meta?.task_id).toBe("task_retry");
        }),
      ),
    );
    expect(debugEvents.length).toBeGreaterThan(0);
  });

  it("reports a succeeded result that cannot be read with the task ID", async () => {
    const results: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
      [
        "task_bad_url",
        { model_urls: { glb: "https://[broken/model.glb" } },
        {
          message: "Meshy task task_bad_url returned a result that cannot be read: model_urls.glb is not a valid URL",
          cause: expect.any(Error),
        },
      ],
      [
        "task_bad_time",
        { model_urls: { glb: asset("t", "model.glb") }, expires_at: 1e20 },
        {
          message: "Meshy task task_bad_time returned a result that cannot be read: Invalid time value",
          cause: expect.any(RangeError),
        },
      ],
      [
        "task_no_files",
        { model_urls: { glb: "" }, thumbnail_url: "" },
        { message: "Meshy task succeeded but returned no files" },
      ],
    ];
    for (const [taskId, fields, expected] of results) {
      const task = { id: taskId, type: "text-to-3d-preview", status: "SUCCEEDED", ...fields };
      await withGateway(taskGateway(taskId, [task]), async (baseUrl) => {
        const error = await client(baseUrl)
          .generate({ model: "meshy", content: [textBlock("chest")], parameters: { operation: "text-to-3d" } })
          .catch((caught: unknown) => caught);
        expect(error).toBeInstanceOf(GenerationProviderError);
        expect(error).toMatchObject({ ...expected, details: { task_id: taskId } });
      });
    }
  });

  it("gives up after repeated status check failures and when the wait runs out", async () => {
    vi.useFakeTimers();
    let polls = 0;
    const failing = async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(JSON.stringify({ result: "task_down" }), { status: 200 });
      polls += 1;
      return new Response(JSON.stringify({ message: "bad gateway" }), { status: 502 });
    };
    const down = createGenerationClient({ apiKey: "sk-test", fetch: failing as typeof fetch }).generate({
      model: "meshy",
      content: [textBlock("chest")],
      parameters: { operation: "text-to-3d", poll_interval: 1 },
    });
    const downError = down.catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await downError).toMatchObject({
      message: "Meshy task task_down status check failed: Meshy request failed (502): bad gateway",
      details: { task_id: "task_down" },
    });
    expect(polls).toBe(10);

    let brokenPolls = 0;
    const broken = async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "POST") return new Response(JSON.stringify({ result: "task_cut" }), { status: 200 });
      brokenPolls += 1;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new TypeError("terminated"));
        },
      });
      return new Response(body, { status: 200 });
    };
    const cut = createGenerationClient({ apiKey: "sk-test", fetch: broken as typeof fetch }).generate({
      model: "meshy",
      content: [textBlock("chest")],
      parameters: { operation: "text-to-3d", poll_interval: 1 },
    });
    const cutError = cut.catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await cutError).toMatchObject({
      message: expect.stringMatching(
        /^Meshy task task_cut status check failed: Generation transport failed method=GET /,
      ),
      details: { task_id: "task_cut" },
      cause: expect.any(GenerationTransportError),
    });
    expect(brokenPolls).toBe(10);

    const pending = async (_url: string | URL | Request, init?: RequestInit) =>
      new Response(JSON.stringify(init?.method === "POST" ? { result: "task_slow" } : { status: "IN_PROGRESS" }), {
        status: 200,
      });
    const slow = createGenerationClient({ apiKey: "sk-test", fetch: pending as typeof fetch }).generate({
      model: "meshy",
      content: [textBlock("chest")],
      parameters: { operation: "text-to-3d", poll_interval: 30, max_wait: 60 },
    });
    const slowError = slow.catch((caught: unknown) => caught);
    await vi.advanceTimersByTimeAsync(120_000);
    const timeout = await slowError;
    expect(timeout).toBeInstanceOf(GenerationTimeoutError);
    expect(timeout).toMatchObject({ details: { task_id: "task_slow", path: "/meshy/openapi/v2/text-to-3d" } });
  });
});
