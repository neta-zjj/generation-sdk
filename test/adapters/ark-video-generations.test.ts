import { describe, expect, it, vi } from "vitest";
import { createGenerationClient, type GenerationProviderError } from "../../src/index.js";

describe("ark.videoGenerations adapter", () => {
  it("creates and polls video tasks", async () => {
    vi.useFakeTimers();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/v1/video/generations")) {
        return new Response(JSON.stringify({ task_id: "task-1" }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: { status: "SUCCESS", result_url: "https://example.com/out.mp4" } }), {
        status: 200,
      });
    };

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    const promise = client.generate({
      model: "seedance-2-0-fast",
      content: [{ type: "text", text: "hello" }],
      parameters: { poll_interval: 1, max_wait: 30 },
    });
    await vi.advanceTimersByTimeAsync(1000);
    const response = await promise;
    vi.useRealTimers();

    expect(calls[0]?.url).toBe("https://router.neta.art/v1/video/generations");
    expect(calls[1]?.url).toBe("https://router.neta.art/v1/video/generations/task-1");
    expect(response).toMatchObject({ model: "seedance-2-0-fast" });
    expect(response.content[0]).toEqual({
      type: "video",
      source: { type: "url", url: "https://example.com/out.mp4" },
      meta: { task_id: "task-1", status: "succeeded" },
    });
  });

  it("includes the create-task response when no task id is returned", async () => {
    const fetchMock = async () =>
      new Response(JSON.stringify({ status: "queued", message: "missing id" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    await expect(
      client.generate({
        model: "seedance-2-0-fast",
        content: [{ type: "text", text: "hello" }],
      }),
    ).rejects.toMatchObject({
      name: "GenerationProviderError",
      message: "Video generation provider did not return a task id",
      details: { response: { status: "queued", message: "missing id" } },
    } satisfies Partial<GenerationProviderError>);
  });

  it("parses wrapped router task status responses", async () => {
    vi.useFakeTimers();
    const fetchMock = async (url: string | URL | Request) => {
      if (String(url).endsWith("/v1/video/generations")) {
        return new Response(JSON.stringify({ task_id: "task-1" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          data: {
            status: "SUCCESS",
            result_url: "https://example.com/out.mp4",
            first_frame: "https://example.com/first.webp",
            progress: "100%",
            data: { status: "succeeded", seed: 123 },
          },
        }),
        { status: 200 },
      );
    };

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    const promise = client.generate({
      model: "seedance-2-0-fast",
      content: [{ type: "text", text: "hello" }],
      parameters: { poll_interval: 1, max_wait: 30 },
    });
    await vi.advanceTimersByTimeAsync(1000);
    const response = await promise;
    vi.useRealTimers();

    expect(response).toEqual({
      model: "seedance-2-0-fast",
      content: [
        {
          type: "video",
          source: { type: "url", url: "https://example.com/out.mp4" },
          meta: { task_id: "task-1", status: "succeeded", progress: "100%", seed: 123 },
        },
        {
          type: "image",
          source: { type: "url", url: "https://example.com/first.webp" },
          meta: { role: "last_frame", task_id: "task-1" },
        },
      ],
    });
  });

  it("includes poll diagnostics when a succeeded task has no video URL", async () => {
    vi.useFakeTimers();
    const fetchMock = async (url: string | URL | Request) => {
      if (String(url).endsWith("/v1/video/generations")) {
        return new Response(JSON.stringify({ task_id: "task-1" }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: { status: "succeeded", progress: 100, data: { seed: 123 } } }), {
        status: 200,
      });
    };

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    const promise = expect(
      client.generate({
        model: "seedance-2-0-fast",
        content: [{ type: "text", text: "hello" }],
        parameters: { poll_interval: 1, max_wait: 30 },
      }),
    ).rejects.toMatchObject({
      name: "GenerationProviderError",
      message: "Video generation succeeded but returned no video URL",
      details: {
        taskId: "task-1",
        rawStatus: { data: { status: "succeeded", progress: 100, data: { seed: 123 } } },
        metadata: { progress: 100, seed: 123 },
      },
    } satisfies Partial<GenerationProviderError>);

    await vi.advanceTimersByTimeAsync(1000);
    await promise;
    vi.useRealTimers();
  });
});
