import { describe, expect, it, vi } from "vitest";
import {
  createGenerationClient,
  type GenerationContentBlock,
  type GenerationModelDeclaration,
} from "../../src/index.js";

type FetchCall = { url: string; init: RequestInit };

const declaration = {
  schema: "neta.generation.model.v1",
  model: "video-upscale-native-test",
  category: "video",
  adapter: { type: "video.upscaleNative" },
  content: { input: [{ type: "video", required: true, min: 1, max: 1, sources: ["url"] }] },
} satisfies GenerationModelDeclaration;

function videoBlock(url: string): GenerationContentBlock {
  return { type: "video", source: { type: "url", url } };
}

describe("video.upscaleNative adapter", () => {
  it("submits only model and video_url, then returns the completed video", async () => {
    vi.useFakeTimers();
    const calls: FetchCall[] = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/v1/video/generations")) {
        return new Response(JSON.stringify({ id: "task-1", status: "queued" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({ status: "completed", metadata: { url: "https://example.com/upscaled.mp4" }, progress: 100 }),
        { status: 200 },
      );
    };

    try {
      const client = createGenerationClient({
        apiKey: "key",
        fetch: fetchMock as typeof fetch,
        models: [declaration],
        includeBuiltinModels: false,
      });
      const promise = client.generate({
        model: declaration.model,
        content: [videoBlock("https://example.com/input.mp4")],
      });
      await vi.advanceTimersByTimeAsync(2000);
      await expect(promise).resolves.toEqual([
        {
          type: "video",
          source: { type: "url", url: "https://example.com/upscaled.mp4" },
          meta: { task_id: "task-1", status: "succeeded", progress: 100 },
        },
      ]);
      expect(calls).toHaveLength(2);
      expect(calls[0]?.url).toBe("https://router.neta.art/v1/video/generations");
      expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
        model: declaration.model,
        video_url: "https://example.com/input.mp4",
      });
      expect(calls[1]?.url).toBe("https://router.neta.art/v1/video/generations/task-1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects non-video content before making a request", async () => {
    const client = createGenerationClient({
      apiKey: "key",
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
      models: [declaration],
      includeBuiltinModels: false,
    });

    await expect(
      client.generate({ model: declaration.model, content: [{ type: "text", text: "upscale this" }] }),
    ).rejects.toThrow("Content block type is not supported");
  });

  it("rejects credentials or non-http URLs returned by the source resolver", async () => {
    const client = createGenerationClient({
      apiKey: "key",
      fetch: async () => {
        throw new Error("fetch should not be called");
      },
      sourceResolver: () => "https://user:password@example.com/input.mp4",
      models: [declaration],
      includeBuiltinModels: false,
    });

    await expect(
      client.generate({ model: declaration.model, content: [videoBlock("https://example.com/input.mp4")] }),
    ).rejects.toThrow("absolute http or https video URL");
  });
});
