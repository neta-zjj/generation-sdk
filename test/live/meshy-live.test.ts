import { expect, it } from "vitest";
import { createGenerationClient, type GenerationContentBlock, type GenerationResult } from "../../src/index.js";

// 真实调用会消耗 Meshy 积分和一次图片生成的费用；NETA_ROUTER_API_KEY 需要能使用 meshy-3d 和 gemini-3.1-flash-lite-image 模型。
function createLiveClient() {
  const apiKey = process.env.NETA_ROUTER_API_KEY;
  if (!apiKey) throw new Error("NETA_ROUTER_API_KEY is required");
  return createGenerationClient({
    apiKey,
    ...(process.env.NETA_ROUTER_BASE_URL ? { baseUrl: process.env.NETA_ROUTER_BASE_URL } : {}),
  });
}

function firstBlock(result: GenerationResult): GenerationContentBlock {
  const [block] = result.content;
  if (!block) throw new Error("No output block");
  return block;
}

function blockWithField(result: GenerationResult, field: string): GenerationContentBlock {
  const block = result.content.find((item) => item.meta?.field === field);
  if (!block) throw new Error(`No output block for ${field}`);
  return block;
}

function blockUrl(block: GenerationContentBlock): string {
  if (block.type === "text" || block.source.type !== "url") throw new Error("Expected a URL block");
  return block.source.url;
}

async function expectGlb(block: GenerationContentBlock): Promise<void> {
  expect(block).toMatchObject({ type: "3d", meta: { format: "glb" } });
  const response = await fetch(blockUrl(block), { headers: { Range: "bytes=0-3" } });
  expect(response.ok).toBe(true);
  const head = Buffer.from(await response.arrayBuffer()).subarray(0, 4);
  expect(head.toString("ascii")).toBe("glTF");
}

function expectTask(result: GenerationResult, taskType: string): void {
  expect(result.content.length).toBeGreaterThan(0);
  for (const block of result.content) expect(block.meta).toMatchObject({ task_type: taskType });
  expect(result.cost).toBeGreaterThan(0);
}

it("generates, rigs, and animates a character from a text prompt", async () => {
  const client = createLiveClient();
  // 输入图片由图片模型生成，neta-router 返回它归档的图片链接。
  const images = await client.generate({
    model: "gemini-3.1-flash-lite-image",
    content: [{ type: "text", text: "a cartoon knight standing in an A pose, full body, plain white background" }],
  });
  const knight = images.find((block) => block.type === "image");
  if (!knight) throw new Error("No image block");
  expect(blockUrl(knight)).toMatch(/^https:\/\//);

  const model = await client.generateResult({
    model: "meshy",
    content: [knight],
    parameters: {
      operation: "image-to-3d",
      ai_model: "meshy-6-lite",
      pose_mode: "a-pose",
      target_formats: ["glb", "obj"],
    },
  });
  expectTask(model, "image-to-3d");
  await expectGlb(firstBlock(model));
  expect(blockWithField(model, "model_urls.obj").meta?.mtl_url).toEqual(expect.any(String));
  expect(blockWithField(model, "texture_urls[0].base_color").type).toBe("image");

  const rigged = await client.generateResult({
    model: "meshy",
    content: [firstBlock(model)],
    parameters: { operation: "rigging" },
  });
  expectTask(rigged, "rig");
  expect(firstBlock(rigged).meta?.field).toBe("result.rigged_character_glb_url");
  await expectGlb(firstBlock(rigged));

  const motion = await client.generateResult({
    model: "meshy",
    content: [{ type: "text", text: "a person waves with the right hand" }],
    parameters: { operation: "text-to-motion", duration: 2, mode: "swift" },
  });
  expectTask(motion, "text-to-motion");
  const clip = blockWithField(motion, "result.motion_url");
  expect(clip.meta).toMatchObject({ format: "bvh", duration_ms: expect.any(Number) });

  const animated = await client.generateResult({
    model: "meshy",
    content: [firstBlock(rigged), { ...clip, meta: { ...clip.meta, role: "motion" } }],
    parameters: { operation: "animation" },
  });
  expectTask(animated, "animate");
  await expectGlb(blockWithField(animated, "result.animation_glb_url"));
}, 3_600_000);

it("refines a preview and remeshes the refined model from its URL", async () => {
  const client = createLiveClient();
  const preview = await client.generateResult({
    model: "meshy",
    content: [{ type: "text", text: "a small wooden treasure chest with iron bands" }],
    parameters: { operation: "text-to-3d", ai_model: "meshy-6-lite", target_formats: ["glb"] },
  });
  expectTask(preview, "text-to-3d-preview");
  await expectGlb(firstBlock(preview));

  const refined = await client.generateResult({
    model: "meshy",
    content: [firstBlock(preview), { type: "text", text: "weathered oak and dark iron" }],
    parameters: { operation: "text-to-3d-refine", target_formats: ["glb", "obj"] },
  });
  expectTask(refined, "text-to-3d-refine");
  await expectGlb(firstBlock(refined));
  expect(blockWithField(refined, "texture_urls[0].base_color").type).toBe("image");

  const remeshed = await client.generateResult({
    model: "meshy",
    content: [{ ...firstBlock(refined), meta: { format: "glb" } }],
    parameters: { operation: "remesh", topology: "quad", target_polycount: 5000, target_formats: ["glb", "fbx"] },
  });
  expectTask(remeshed, "remesh");
  await expectGlb(firstBlock(remeshed));
  expect(remeshed.content[1]?.meta).toMatchObject({ field: "model_urls.fbx", format: "fbx" });
}, 3_600_000);
