import { describe, expect, it, vi } from "vitest";
import { createGenerationClient } from "../../src/index.js";

describe("suno.tasks adapter", () => {
  it("submits music tasks and polls successful song outputs", async () => {
    vi.useFakeTimers();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/suno/submit/music")) {
        return new Response(JSON.stringify({ code: "success", data: "task_1" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          code: "success",
          data: {
            task_id: "task_1",
            action: "music",
            status: "SUCCESS",
            data: [
              {
                id: "clip_1",
                audio_url: "https://example.com/song.mp3",
                video_url: "https://example.com/song.mp4",
                image_url: "https://example.com/cover.jpg",
                title: "Warm Horizon",
                text: "la la la",
                metadata: { duration: 180, tags: "cinematic pop", prompt: "warm piano" },
              },
            ],
          },
        }),
        { status: 200 },
      );
    };

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    const promise = client.generate({
      model: "suno_music",
      content: [{ type: "text", text: "warm piano" }],
      parameters: { operation: "music", title: "Warm Horizon", poll_interval: 1, max_wait: 30 },
    });
    await vi.advanceTimersByTimeAsync(1000);
    const output = await promise;
    vi.useRealTimers();

    expect(calls[0]?.url).toBe("https://router.neta.art/suno/submit/music");
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      prompt: "warm piano",
      title: "Warm Horizon",
    });
    expect(calls[1]?.url).toBe("https://router.neta.art/suno/fetch/task_1");
    expect(output).toEqual([
      {
        type: "audio",
        source: { type: "url", url: "https://example.com/song.mp3" },
        meta: expect.objectContaining({ id: "clip_1", title: "Warm Horizon", duration: 180 }),
      },
      {
        type: "video",
        source: { type: "url", url: "https://example.com/song.mp4" },
        meta: expect.objectContaining({ id: "clip_1", title: "Warm Horizon", duration: 180 }),
      },
      {
        type: "image",
        source: { type: "url", url: "https://example.com/cover.jpg" },
        meta: expect.objectContaining({ id: "clip_1", title: "Warm Horizon", duration: 180 }),
      },
      {
        type: "text",
        text: "la la la",
        meta: expect.objectContaining({ id: "clip_1", title: "Warm Horizon", duration: 180 }),
      },
    ]);
  });

  it("routes lyrics to the lyrics endpoint", async () => {
    vi.useFakeTimers();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/suno/submit/lyrics")) {
        return new Response(JSON.stringify({ code: 200, data: "task_lyrics" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          code: "success",
          data: {
            task_id: "task_lyrics",
            action: "lyrics",
            status: "SUCCESS",
            data: { text: "chorus", title: "Hook" },
          },
        }),
        { status: 200 },
      );
    };

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    const promise = client.generate({
      model: "suno_music",
      content: [{ type: "text", text: "write a chorus" }],
      parameters: { operation: "lyrics", poll_interval: 1, max_wait: 30 },
    });
    await vi.advanceTimersByTimeAsync(1000);
    const output = await promise;
    vi.useRealTimers();

    expect(calls[0]?.url).toBe("https://router.neta.art/suno/submit/lyrics");
    expect(output).toEqual([
      { type: "text", text: "chorus", meta: expect.objectContaining({ title: "Hook", operation: "lyrics" }) },
    ]);
  });

  it("maps sound operation to /suno/submit/music with task=sound", async () => {
    vi.useFakeTimers();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/suno/submit/music")) {
        return new Response(JSON.stringify({ code: "success", data: "task_sound" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          code: "success",
          data: { task_id: "task_sound", action: "sound", status: "SUCCESS", data: [] },
        }),
        { status: 200 },
      );
    };

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    const promise = client.generate({
      model: "suno_music",
      content: [{ type: "text", text: "rain ambience" }],
      parameters: { operation: "sound", metadata_params: { sound: "rain" }, poll_interval: 1, max_wait: 30 },
    });
    await vi.advanceTimersByTimeAsync(1000);
    await promise;
    vi.useRealTimers();

    expect(calls[0]?.url).toBe("https://router.neta.art/suno/submit/music");
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      task: "sound",
      prompt: "rain ambience",
      metadata_params: { sound: "rain" },
    });
  });

  it("returns upsample tags without polling", async () => {
    const fetchMock = async () =>
      new Response(
        JSON.stringify({
          code: 200,
          data: { taskBatchId: "batch_1", upsampled_tags: "acoustic pop, warm piano" },
        }),
        { status: 200 },
      );

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    const output = await client.generate({
      model: "suno_music",
      content: [],
      parameters: { operation: "upsample_tags", tags: "pop" },
    });

    expect(output).toEqual([
      {
        type: "text",
        text: "acoustic pop, warm piano",
        meta: expect.objectContaining({
          operation: "upsample_tags",
          status: "SUCCESS",
          raw: { taskBatchId: "batch_1", upsampled_tags: "acoustic pop, warm piano" },
        }),
      },
    ]);
  });

  it("maps audio content to upload_audio url", async () => {
    vi.useFakeTimers();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/suno/uploads/audio")) {
        return new Response(JSON.stringify({ code: "success", data: "upload_1" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          code: "success",
          data: { task_id: "upload_1", status: "SUCCESS", data: { id: "upload_1" } },
        }),
        { status: 200 },
      );
    };

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    const promise = client.generate({
      model: "suno_music",
      content: [{ type: "audio", source: { type: "url", url: "https://example.com/ref.mp3" } }],
      parameters: { operation: "upload_audio", poll_interval: 1, max_wait: 30 },
    });
    await vi.advanceTimersByTimeAsync(1000);
    await promise;
    vi.useRealTimers();

    expect(calls[0]?.url).toBe("https://router.neta.art/suno/uploads/audio");
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ url: "https://example.com/ref.mp3" });
  });

  it("rejects unknown integrated music tasks", async () => {
    const fetchMock = async () => new Response("{}");
    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    await expect(
      client.generate({
        model: "suno_music",
        content: [{ type: "text", text: "hello" }],
        parameters: { operation: "music", task: "not_a_yunwu_task" },
      }),
    ).rejects.toThrow("Parameter task must be one of");
  });
});
