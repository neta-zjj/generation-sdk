import { describe, expect, it, vi } from "vitest";
import { createGenerationClient } from "../../src/index.js";

describe("ark.videoGenerations adapter", () => {
  it("creates and polls video tasks", async () => {
    vi.useFakeTimers();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/v1/video/generations")) {
        return new Response(JSON.stringify({ task_id: "task-1" }), { status: 200 });
      }
      return new Response(JSON.stringify({ status: "succeeded", url: "https://example.com/out.mp4" }), { status: 200 });
    };

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    const promise = client.generate({
      model: "seedance-2-0-fast",
      content: [{ type: "text", text: "hello" }],
      parameters: { poll_interval: 1, max_wait: 30 },
    });
    await vi.advanceTimersByTimeAsync(1000);
    const output = await promise;
    vi.useRealTimers();

    expect(calls[0]?.url).toBe("https://router.neta.art/v1/video/generations");
    expect(calls[1]?.url).toBe("https://router.neta.art/v1/video/generations/task-1");
    expect(output[0]).toEqual({
      type: "video",
      source: { type: "url", url: "https://example.com/out.mp4" },
      meta: { task_id: "task-1", status: "succeeded" },
    });
  });
});
