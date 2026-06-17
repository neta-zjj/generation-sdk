import { describe, expect, it } from "vitest";
import { createGenerationClient } from "../../src/index.js";

describe("nieta-app adapter", () => {
  it("submits Qwen image edit as a dramatiq ComfyUI payload", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify("task_qwen"), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    const output = await client.generate({
      model: "qwen-image-edit",
      content: [
        { type: "text", text: "change the hair color to red" },
        { type: "image", source: { type: "url", url: "https://example.com/ref.png" } },
      ],
      parameters: { max_side: 2048, negative_prompt: "", seed: 123, wait: false },
    });

    expect(client.getModel("qwen-image-edit")?.adapter.type).toBe("nieta-app");
    expect(calls[0]?.url).toBe("https://router.neta.art/internal/task/custom_background_tasks");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      actor_name: "comfyui",
      queue_name: "qwen_image_edit",
      params: {
        task_name: "make_image_with_comfy_common",
        timeout: 300,
        need_image_moderation: false,
        api_payload: {
          workflow_name: "7_qwen_edit/gpu_qwen_image_edit.json",
          image_url: "https://example.com/ref.png",
          positive_prompt: "change the hair color to red",
          negative_prompt: "",
          max_side: 2048,
          seed: 123,
        },
      },
    });
    expect(output[0]).toMatchObject({ type: "text", text: "task_qwen", meta: { role: "task_id" } });
  });

  it("polls Qwen image edit artifact output when wait is enabled", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (calls.length === 1) {
        return new Response(JSON.stringify("task_done"), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          task_uuid: "task_done",
          task_status: "SUCCESS",
          artifacts: [
            {
              uuid: "artifact_1",
              status: "SUCCESS",
              modality: "picture",
              url: "https://example.com/out.png",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    const output = await client.generate({
      model: "qwen-image-edit",
      content: [
        { type: "text", text: "change the hair color to red" },
        { type: "image", source: { type: "url", url: "https://example.com/ref.png" } },
      ],
    });

    expect(calls[1]?.url).toBe("https://router.neta.art/v1/artifact/task/task_done");
    expect(output[0]).toEqual({
      type: "image",
      source: { type: "url", url: "https://example.com/out.png" },
      meta: {
        task_id: "task_done",
        artifact_id: "artifact_1",
        status: "SUCCESS",
        modality: "picture",
      },
    });
  });
});
