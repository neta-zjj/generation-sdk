import { describe, expect, it, vi } from "vitest";
import { createGenerationClient } from "../../src/index.js";

const sunoMusicTasks = [
  "extend",
  "upload_extend",
  "infill",
  "fixed_infill",
  "infill_intro",
  "infill_outro",
  "cover_infill",
  "cover_extend",
  "artist_infill",
  "artist_consistency",
  "cover",
  "image_to_song",
  "video_to_song",
  "concat",
  "sound",
  "underpainting",
  "remaster",
  "vox",
  "mashup_condition",
] as const;

function taskRequestInput(task: (typeof sunoMusicTasks)[number]) {
  const continuationMeta = {
    task_id: "task_origin",
    clip_id: "clip_origin",
    continue_clip_id: "clip_origin",
  };
  switch (task) {
    case "upload_extend":
      return {
        content: [{ type: "text" as const, text: `test ${task}` }],
        meta: { clip_id: "clip_uploaded", continue_clip_id: "clip_uploaded" },
      };
    case "image_to_song":
      return {
        content: [
          { type: "text" as const, text: `test ${task}` },
          { type: "image" as const, source: { type: "url" as const, url: "https://example.com/image.jpg" } },
        ],
        meta: { metadata_params: { image_url: "https://example.com/image.jpg" } },
      };
    case "video_to_song":
      return {
        content: [
          { type: "text" as const, text: `test ${task}` },
          { type: "video" as const, source: { type: "url" as const, url: "https://example.com/video.mp4" } },
        ],
        meta: { metadata_params: { video_url: "https://example.com/video.mp4" } },
      };
    case "sound":
      return {
        content: [{ type: "text" as const, text: `test ${task}` }],
        meta: { metadata_params: { sound: "soft rain" } },
      };
    case "underpainting":
      return {
        content: [{ type: "text" as const, text: `test ${task}` }],
        meta: { metadata_params: { underpainting_clip_id: "clip_origin" } },
      };
    case "remaster":
      return {
        content: [{ type: "text" as const, text: `test ${task}` }],
        meta: { clip_id: "clip_origin", model_name: "chirp-carp", variation_category: "subtle" },
      };
    default:
      return {
        content: [{ type: "text" as const, text: `test ${task}` }],
        meta: continuationMeta,
      };
  }
}

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
      parameters: { operation: "music", poll_interval: 1, max_wait: 30 },
      meta: { title: "Warm Horizon" },
    });
    await vi.advanceTimersByTimeAsync(1000);
    const output = await promise;
    vi.useRealTimers();

    expect(calls[0]?.url).toBe("https://router.neta.art/suno/submit/music");
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      mv: "chirp-v5-5",
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

  it("passes Suno provider fields through request and content meta", async () => {
    vi.useFakeTimers();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/suno/submit/music")) {
        return new Response(JSON.stringify({ code: "success", data: "task_image" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          code: "success",
          data: { task_id: "task_image", action: "music", status: "SUCCESS", data: [] },
        }),
        { status: 200 },
      );
    };

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    const promise = client.generate({
      model: "suno_music",
      content: [
        { type: "text", text: "make this image sing" },
        {
          type: "image",
          source: { type: "url", url: "https://example.com/image.jpg" },
          meta: { task: "image_to_song", metadata_params: { image_url: "https://example.com/image.jpg" } },
        },
      ],
      parameters: { operation: "music", poll_interval: 1, max_wait: 30 },
      meta: { mv: "chirp-v5-5", title: "Image Song" },
    });
    await vi.advanceTimersByTimeAsync(1000);
    await promise;
    vi.useRealTimers();

    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      prompt: "make this image sing",
      image_url: "https://example.com/image.jpg",
      mv: "chirp-v5-5",
      task: "image_to_song",
      title: "Image Song",
    });
  });

  it("keeps provider-specific Suno fields in meta instead of SDK parameters", async () => {
    vi.useFakeTimers();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/suno/submit/music")) {
        return new Response(JSON.stringify({ code: "success", data: "task_meta" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          code: "success",
          data: { task_id: "task_meta", action: "music", status: "SUCCESS", data: [] },
        }),
        { status: 200 },
      );
    };

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    const promise = client.generate({
      model: "suno_music",
      content: [{ type: "text", text: "warm piano chorus" }],
      parameters: { operation: "music", poll_interval: 1, max_wait: 30 },
      meta: {
        task: "cover",
        title: "Cover Test",
        tags: "warm piano",
        make_instrumental: false,
        task_id: "task_origin",
        clip_id: "clip_origin",
        continue_clip_id: "clip_origin",
      },
    });
    await vi.advanceTimersByTimeAsync(1000);
    await promise;
    vi.useRealTimers();

    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      mv: "chirp-v5-5",
      prompt: "warm piano chorus",
      task: "cover",
      title: "Cover Test",
      tags: "warm piano",
      make_instrumental: false,
      task_id: "task_origin",
      clip_id: "clip_origin",
      continue_clip_id: "clip_origin",
    });
  });

  it("uses sound as a music task and defaults to chirp-v5-5", async () => {
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
          data: { task_id: "task_sound", action: "music", status: "SUCCESS", data: [] },
        }),
        { status: 200 },
      );
    };

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    const promise = client.generate({
      model: "suno_music",
      content: [{ type: "text", text: "gentle rain ambience" }],
      parameters: { operation: "music", poll_interval: 1, max_wait: 30 },
      meta: { task: "sound", metadata_params: { sound: "gentle rain ambience" } },
    });
    await vi.advanceTimersByTimeAsync(1000);
    await promise;
    vi.useRealTimers();

    expect(calls[0]?.url).toBe("https://router.neta.art/suno/submit/music");
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      mv: "chirp-v5-5",
      prompt: "gentle rain ambience",
      task: "sound",
      metadata_params: { sound: "gentle rain ambience" },
    });
  });

  it("parses Yunwu Suno item media fields from task results", async () => {
    vi.useFakeTimers();
    const fetchMock = async (url: string | URL | Request) => {
      if (String(url).endsWith("/suno/submit/music")) {
        return new Response(JSON.stringify({ code: "success", data: "task_yunwu" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          code: "success",
          data: {
            task_id: "task_yunwu",
            action: "music",
            status: "SUCCESS",
            progress: "100%",
            data: {
              code: 200,
              data: {
                taskBatchId: "batch_1",
                items: [
                  {
                    id: "item_1",
                    clipId: "clip_1",
                    title: "Warm Horizon",
                    tags: "cinematic pop",
                    prompt: "warm piano",
                    duration: 142.56,
                    progress: 100,
                    progressMsg: "Production completed",
                    cld2AudioUrl: "https://example.com/song.mp3",
                    cld2ImageUrl: "https://example.com/cover.jpg",
                    cld2VideoUrl: "https://example.com/song.mp4",
                  },
                ],
              },
            },
          },
        }),
        { status: 200 },
      );
    };

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    const promise = client.generate({
      model: "suno_music",
      content: [{ type: "text", text: "warm piano" }],
      parameters: { operation: "music", poll_interval: 1, max_wait: 30 },
    });
    await vi.advanceTimersByTimeAsync(1000);
    const output = await promise;
    vi.useRealTimers();

    expect(output).toEqual([
      {
        type: "audio",
        source: { type: "url", url: "https://example.com/song.mp3" },
        meta: expect.objectContaining({ id: "item_1", clip_id: "clip_1", duration: 142.56 }),
      },
      {
        type: "video",
        source: { type: "url", url: "https://example.com/song.mp4" },
        meta: expect.objectContaining({ id: "item_1", clip_id: "clip_1", progress_message: "Production completed" }),
      },
      {
        type: "image",
        source: { type: "url", url: "https://example.com/cover.jpg" },
        meta: expect.objectContaining({ id: "item_1", clip_id: "clip_1", tags: "cinematic pop" }),
      },
    ]);
  });

  it("supports every defined Suno music task through meta.task", async () => {
    vi.useFakeTimers();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/suno/submit/music")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { task?: string };
        return new Response(JSON.stringify({ code: "success", data: `task_${body.task}` }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          code: "success",
          data: { task_id: "task_done", action: "music", status: "SUCCESS", data: [] },
        }),
        { status: 200 },
      );
    };

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });

    for (const task of sunoMusicTasks) {
      const input = taskRequestInput(task);
      const promise = client.generate({
        model: "suno_music",
        content: input.content,
        parameters: { operation: "music", poll_interval: 1, max_wait: 30 },
        meta: { task, ...input.meta },
      });
      await vi.advanceTimersByTimeAsync(1000);
      await promise;
    }
    vi.useRealTimers();

    const submitCalls = calls.filter((call) => call.url.endsWith("/suno/submit/music"));
    expect(submitCalls).toHaveLength(sunoMusicTasks.length);
    expect(submitCalls.map((call) => JSON.parse(String(call.init.body)).task)).toEqual(
      sunoMusicTasks.map((task) => (task === "remaster" ? undefined : task)),
    );
    for (const call of submitCalls) {
      expect(call.url).toBe("https://router.neta.art/suno/submit/music");
      const body = JSON.parse(String(call.init.body));
      if (body.model_name) expect(body).not.toHaveProperty("mv");
      else expect(body).toMatchObject({ mv: "chirp-v5-5" });
    }
  });

  it("rejects unknown Suno music tasks from meta", async () => {
    const fetchMock = async () => new Response("{}");
    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    await expect(
      client.generate({
        model: "suno_music",
        content: [{ type: "text", text: "hello" }],
        parameters: { operation: "music" },
        meta: { task: "not_a_yunwu_task" },
      }),
    ).rejects.toThrow("meta.task must be one of:");
  });

  it("validates task-specific Suno meta requirements from model declarations", async () => {
    const fetchMock = async () => new Response("{}");
    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    await expect(() =>
      client.validate({
        model: "suno_music",
        content: [{ type: "text", text: "cover this" }],
        parameters: { operation: "music" },
        meta: { task: "cover", clip_id: "clip_origin", continue_clip_id: "clip_origin" },
      }),
    ).toThrow("meta.task cover requires meta.task_id");

    await expect(
      client.generate({
        model: "suno_music",
        content: [{ type: "text", text: "cover this" }],
        parameters: { operation: "music" },
        meta: { task: "cover", clip_id: "clip_origin", continue_clip_id: "clip_origin" },
      }),
    ).rejects.toThrow("meta.task cover requires meta.task_id");

    await expect(() =>
      client.validate({
        model: "suno_music",
        content: [{ type: "text", text: "make image sing" }],
        parameters: { operation: "music" },
        meta: { task: "image_to_song", metadata_params: { prompt: "make image sing" } },
      }),
    ).toThrow("meta.task image_to_song requires image content");

    await expect(() =>
      client.validate({
        model: "suno_music",
        content: [
          {
            type: "image",
            source: { type: "url", url: "https://example.com/image.jpg" },
            meta: { task: "image_to_song" },
          },
        ],
        parameters: { operation: "music" },
      }),
    ).toThrow("meta.task image_to_song requires meta.metadata_params");
  });

  it("normalizes array-wrapped task fetch responses", async () => {
    vi.useFakeTimers();
    const fetchMock = async (url: string | URL | Request) => {
      if (String(url).endsWith("/suno/submit/music")) {
        return new Response(JSON.stringify({ code: "success", data: "task_array" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          code: "success",
          data: [
            {
              task_id: "task_array",
              action: "music",
              status: "SUCCESS",
              data: { audio_url: "https://example.com/array.mp3", title: "Array Wrapped" },
            },
          ],
        }),
        { status: 200 },
      );
    };

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    const promise = client.generate({
      model: "suno_music",
      content: [{ type: "text", text: "warm piano" }],
      parameters: { operation: "music", poll_interval: 1, max_wait: 30 },
    });
    await vi.advanceTimersByTimeAsync(1000);
    const output = await promise;
    vi.useRealTimers();

    expect(output).toEqual([
      {
        type: "audio",
        source: { type: "url", url: "https://example.com/array.mp3" },
        meta: expect.objectContaining({ title: "Array Wrapped", task_id: "task_array" }),
      },
    ]);
  });

  it("keeps outer task status when task data contains media arrays", async () => {
    vi.useFakeTimers();
    const fetchMock = async (url: string | URL | Request) => {
      if (String(url).endsWith("/suno/submit/music")) {
        return new Response(JSON.stringify({ code: "success", data: "task_pending" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          code: "success",
          data: {
            task_id: "task_pending",
            action: "music",
            status: "PENDING",
            data: [{ audio_url: "https://example.com/not-ready.mp3" }],
          },
        }),
        { status: 200 },
      );
    };

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    const promise = client.generate({
      model: "suno_music",
      content: [{ type: "text", text: "warm piano" }],
      parameters: { operation: "music", poll_interval: 1, max_wait: 30 },
    });
    const assertion = expect(promise).rejects.toThrow("Timed out waiting for Suno task");
    await vi.advanceTimersByTimeAsync(31_000);
    await assertion;
    vi.useRealTimers();
  });

  it("routes concat to the concat endpoint", async () => {
    vi.useFakeTimers();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/suno/submit/concat")) {
        return new Response(JSON.stringify({ code: "success", data: "task_concat" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          code: "success",
          data: {
            task_id: "task_concat",
            action: "concat",
            status: "SUCCESS",
            data: {
              audio_url: "https://example.com/concat.mp3",
              clip_id: "clip_concat",
              title: "Full Song",
            },
          },
        }),
        { status: 200 },
      );
    };

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    const promise = client.generate({
      model: "suno_music",
      content: [{ type: "text", text: "concat" }],
      parameters: { operation: "concat", poll_interval: 1, max_wait: 30 },
      meta: { clip_id: "clip_extended", is_infill: false },
    });
    await vi.advanceTimersByTimeAsync(1000);
    const output = await promise;
    vi.useRealTimers();

    expect(calls[0]?.url).toBe("https://router.neta.art/suno/submit/concat");
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      clip_id: "clip_extended",
      is_infill: false,
    });
    expect(output).toEqual([
      {
        type: "audio",
        source: { type: "url", url: "https://example.com/concat.mp3" },
        meta: expect.objectContaining({ clip_id: "clip_concat", operation: "concat" }),
      },
    ]);
  });

  it("returns immediate outputs for non-polled Suno operations", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          code: 200,
          data: {
            taskBatchId: "batch_1",
            upsampled_tags: "acoustic pop, warm piano, bright",
          },
        }),
        { status: 200 },
      );
    };

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    const output = await client.generate({
      model: "suno_music",
      content: [{ type: "text", text: "warm piano" }],
      parameters: { operation: "upsample_tags" },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://router.neta.art/suno/submit/upsample-tags");
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      original_tags: "warm piano",
    });
    expect(output).toEqual([
      {
        type: "text",
        text: "acoustic pop, warm piano, bright",
        meta: expect.objectContaining({ operation: "upsample_tags", task_batch_id: "batch_1" }),
      },
    ]);
  });

  it("uses remaster as a request discriminator without sending task upstream", async () => {
    vi.useFakeTimers();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/suno/submit/music")) {
        return new Response(JSON.stringify({ code: "success", data: "task_remaster" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          code: "success",
          data: {
            task_id: "task_remaster",
            action: "music",
            status: "SUCCESS",
            data: { audio_url: "https://example.com/remaster.mp3" },
          },
        }),
        { status: 200 },
      );
    };

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    const promise = client.generate({
      model: "suno_music",
      content: [],
      parameters: { operation: "music", poll_interval: 1, max_wait: 30 },
      meta: {
        task: "remaster",
        clip_id: "clip_original",
        model_name: "chirp-v5",
        variation_category: "persona",
      },
    });
    await vi.advanceTimersByTimeAsync(1000);
    await promise;
    vi.useRealTimers();

    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      clip_id: "clip_original",
      model_name: "chirp-v5",
      variation_category: "persona",
    });
    expect(JSON.parse(String(calls[0]?.init.body))).not.toHaveProperty("task");
    expect(JSON.parse(String(calls[0]?.init.body))).not.toHaveProperty("mv");
  });

  it("uploads audio through the upload_audio endpoint", async () => {
    vi.useFakeTimers();
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      if (String(url).endsWith("/suno/uploads/audio")) {
        return new Response(JSON.stringify({ code: "success", data: "task_upload" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          code: "success",
          data: {
            task_id: "task_upload",
            action: "upload_audio",
            status: "SUCCESS",
            data: { clip_id: "clip_uploaded", audio_url: "https://example.com/uploaded.mp3" },
          },
        }),
        { status: 200 },
      );
    };

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    const promise = client.generate({
      model: "suno_music",
      content: [
        { type: "text", text: "upload reference audio" },
        { type: "audio", source: { type: "url", url: "https://example.com/input.mp3" } },
      ],
      parameters: { operation: "upload_audio", poll_interval: 1, max_wait: 30 },
    });
    await vi.advanceTimersByTimeAsync(1000);
    const output = await promise;
    vi.useRealTimers();

    expect(calls[0]?.url).toBe("https://router.neta.art/suno/uploads/audio");
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      url: "https://example.com/input.mp3",
    });
    expect(output).toEqual([
      {
        type: "audio",
        source: { type: "url", url: "https://example.com/uploaded.mp3" },
        meta: expect.objectContaining({ clip_id: "clip_uploaded", operation: "upload_audio" }),
      },
    ]);
  });

  it("rejects unsupported Suno operations", async () => {
    const fetchMock = async () => new Response("{}");
    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    await expect(
      client.generate({
        model: "suno_music",
        content: [{ type: "text", text: "hello" }],
        parameters: { operation: "unknown_operation" },
      }),
    ).rejects.toThrow("Parameter operation must be one of: music, lyrics, concat, upsample_tags, upload_audio");
  });
});
