import { afterEach, describe, expect, it, vi } from "vitest";
import { GenerationValidationError } from "../../src/errors.js";
import {
  createGenerationClient,
  type GenerationContentBlock,
  GenerationTimeoutError,
  parseGenerationModelDeclaration,
} from "../../src/index.js";

type FetchCall = { url: string; init: RequestInit };

const SUBMIT_URL = "https://router.neta.art/v1/audio/generations";
const AUDIO_URL = "https://example.com/song.mp3";
const POLL_INTERVAL_MS = 5_000;
const REQUEST_TIMEOUT_MS = 60_000;
// The server ends a song task when it finishes, not on a client deadline; 30 minutes is past the old 21-minute wait.
const SERVER_FINISH_MS = 30 * 60 * 1000;

const styleBlock: GenerationContentBlock = {
  type: "text",
  text: "bright J-pop, female vocal, piano",
  meta: { role: "prompt" },
};
const lyricsBlock: GenerationContentBlock = { type: "text", text: "[verse]\nla la la", meta: { role: "lyrics" } };
const songRequest = { model: "song2", content: [styleBlock, lyricsBlock] };
const OLD_REQUEST_BODY = '{"model":"song2","prompt":"bright J-pop, female vocal, piano","lyrics":"[verse]\\nla la la"}';
const ABC = "X:1\nT:Sunrise\nM:4/4\nK:C\n|:CDEF GABc:|\nw:la la la la";
const MAX_LYRICS_CHARS = 4000;

function textBlock(role: "prompt" | "lyrics" | "abc", text: string): GenerationContentBlock {
  return { type: "text", text, meta: { role } };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// The first response answers the submit; the rest answer successive status polls.
function taskFetch(calls: FetchCall[], submit: Response, ...polls: Response[]): typeof fetch {
  const queue = [...polls];
  return (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    if (init?.method === "POST") return submit;
    return queue.length > 1 ? (queue.shift() as Response) : (queue[0] as Response).clone();
  }) as typeof fetch;
}

function clientWith(calls: FetchCall[], submit: Response, ...polls: Response[]) {
  return createGenerationClient({ apiKey: "key", fetch: taskFetch(calls, submit, ...polls) });
}

// Settles on the first poll, so no timers are needed.
function settlingClient(calls: FetchCall[]) {
  return clientWith(
    calls,
    json({ id: "task-1", status: "queued" }),
    json({ id: "task-1", status: "completed", audio_url: AUDIO_URL }),
  );
}

// song2 as it reads once cfg_scale and abc_mode off are offered again: the adapter must already handle both.
function heldBackClient(calls: FetchCall[]) {
  const declaration = createGenerationClient({ apiKey: "key" }).getModel("song2");
  const abcMode = declaration?.parameters?.abc_mode;
  if (!declaration || abcMode?.type !== "string") throw new Error("song2 declares no string abc_mode");
  return createGenerationClient({
    apiKey: "key",
    models: [
      {
        ...declaration,
        parameters: {
          ...declaration.parameters,
          abc_mode: { ...abcMode, enum: [...(abcMode.enum ?? []), "off"] },
          cfg_scale: { type: "number", optional: true, min: 0, max: 20 },
        },
      },
    ],
    includeBuiltinModels: false,
    fetch: taskFetch(
      calls,
      json({ id: "task-1", status: "queued" }),
      json({ id: "task-1", status: "completed", audio_url: AUDIO_URL }),
    ),
  });
}

// Reports whether the promise has settled, without turning a rejection into an unhandled one.
function watch(promise: Promise<unknown>): { settled: () => boolean } {
  let settled = false;
  promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  return { settled: () => settled };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("song2 generation", () => {
  it("submits style and lyrics, polls to completion, and returns the song with its cost", async () => {
    vi.useFakeTimers();
    const calls: FetchCall[] = [];
    const client = createGenerationClient({
      apiKey: "key",
      fetch: taskFetch(
        calls,
        json({ id: "task-1", status: "queued", usage: { cost: 0.3 } }),
        json({ id: "task-1", status: "in_progress" }),
        json({ id: "task-1", status: "completed", audio_url: AUDIO_URL, usage: { cost: 0.3 } }),
      ),
    });

    const promise = client.generateResult(songRequest);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

    await expect(promise).resolves.toEqual({
      content: [
        {
          type: "audio",
          source: { type: "url", url: AUDIO_URL },
          meta: { task_id: "task-1", status: "succeeded" },
        },
      ],
      cost: 0.3,
    });
    expect(calls.map((call) => [call.init.method, call.url])).toEqual([
      ["POST", SUBMIT_URL],
      ["GET", `${SUBMIT_URL}/task-1`],
      ["GET", `${SUBMIT_URL}/task-1`],
    ]);
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      model: "song2",
      prompt: "bright J-pop, female vocal, piano",
      lyrics: "[verse]\nla la la",
    });
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe("Bearer key");
  });

  it("keeps the submit cost when the status responses carry no usage", async () => {
    const calls: FetchCall[] = [];
    const client = clientWith(
      calls,
      json({ id: "task-1", status: "queued", usage: { cost: 0.3 } }),
      json({ id: "task-1", status: "completed", audio_url: AUDIO_URL }),
    );

    const result = await client.generateResult(songRequest);

    expect(result.cost).toBe(0.3);
  });

  it("keeps polling through queued and unrecognised statuses", async () => {
    vi.useFakeTimers();
    const calls: FetchCall[] = [];
    const client = clientWith(
      calls,
      json({ id: "task-1", status: "queued" }),
      json({ id: "task-1", status: "queued" }),
      json({ id: "task-1", status: "something_new" }),
      json({ id: "task-1", status: "completed", audio_url: AUDIO_URL }),
    );

    const promise = client.generateResult(songRequest);
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);

    await expect(promise).resolves.toMatchObject({ content: [{ type: "audio", source: { url: AUDIO_URL } }] });
    expect(calls).toHaveLength(4);
  });

  describe("input checks before any request", () => {
    it("rejects lyrics longer than 4000 characters with a public reason", async () => {
      const calls: FetchCall[] = [];
      const client = settlingClient(calls);
      const content = [styleBlock, textBlock("lyrics", "a".repeat(MAX_LYRICS_CHARS + 1))];

      await expect(client.generateResult({ model: "song2", content })).rejects.toThrow(
        "lyrics must be at most 4000 characters for song2",
      );
      expect(calls).toHaveLength(0);
    });

    it("accepts lyrics of exactly 4000 characters", async () => {
      const calls: FetchCall[] = [];
      const client = settlingClient(calls);

      await client.generateResult({
        model: "song2",
        content: [styleBlock, textBlock("lyrics", "a".repeat(MAX_LYRICS_CHARS))],
      });

      expect(JSON.parse(String(calls[0]?.init.body)).lyrics).toHaveLength(MAX_LYRICS_CHARS);
    });

    it("trims before counting", async () => {
      const calls: FetchCall[] = [];
      const client = settlingClient(calls);
      const padded = `  \n${"a".repeat(MAX_LYRICS_CHARS)}\n  `;

      await client.generateResult({ model: "song2", content: [styleBlock, textBlock("lyrics", padded)] });

      expect(JSON.parse(String(calls[0]?.init.body)).lyrics).toBe("a".repeat(MAX_LYRICS_CHARS));
    });

    it("counts code points, not UTF-16 units", async () => {
      const accepted: FetchCall[] = [];
      await settlingClient(accepted).generateResult({
        model: "song2",
        content: [styleBlock, textBlock("lyrics", "😀".repeat(MAX_LYRICS_CHARS))],
      });
      expect(accepted).toHaveLength(2);

      const rejected: FetchCall[] = [];
      await expect(
        settlingClient(rejected).generateResult({
          model: "song2",
          content: [styleBlock, textBlock("lyrics", "😀".repeat(MAX_LYRICS_CHARS + 1))],
        }),
      ).rejects.toBeInstanceOf(GenerationValidationError);
      expect(rejected).toHaveLength(0);
    });

    it("accepts a style description over the old 2000 character limit", async () => {
      const calls: FetchCall[] = [];
      const longStyle = "a".repeat(10_000);

      await settlingClient(calls).generateResult({
        model: "song2",
        content: [textBlock("prompt", longStyle), lyricsBlock],
      });

      expect(JSON.parse(String(calls[0]?.init.body)).prompt).toBe(longStyle);
    });

    it.each([
      ["empty prompt", [textBlock("prompt", "   "), lyricsBlock]],
      ["empty lyrics", [styleBlock, textBlock("lyrics", "")]],
      ["two prompts and no lyrics", [styleBlock, textBlock("prompt", "second style")]],
      ["two lyrics and no prompt", [lyricsBlock, textBlock("lyrics", "more words")]],
    ])("rejects %s", async (_name, content) => {
      const calls: FetchCall[] = [];
      const client = settlingClient(calls);

      await expect(client.generateResult({ model: "song2", content })).rejects.toBeInstanceOf(
        GenerationValidationError,
      );
      expect(calls).toHaveLength(0);
    });

    it.each([
      ["lyrics over 4000 characters", [styleBlock, textBlock("lyrics", "a".repeat(MAX_LYRICS_CHARS + 1))]],
      ["empty lyrics", [styleBlock, textBlock("lyrics", "  ")]],
      ["two prompts and no lyrics", [styleBlock, textBlock("prompt", "second style")]],
    ])("client.validate rejects %s", (_name, content) => {
      const calls: FetchCall[] = [];
      const client = settlingClient(calls);

      expect(() => client.validate({ model: "song2", content })).toThrow(GenerationValidationError);
      expect(calls).toHaveLength(0);
    });

    it("client.validate accepts a long style description and a long score without sending a request", () => {
      const calls: FetchCall[] = [];
      const client = settlingClient(calls);

      expect(() =>
        client.validate({
          model: "song2",
          content: [
            textBlock("prompt", "a".repeat(10_000)),
            lyricsBlock,
            textBlock("abc", `X:1\n${"a".repeat(70_000)}`),
          ],
        }),
      ).not.toThrow();
      expect(calls).toHaveLength(0);
    });

    it("client.validate accepts a style and lyrics pair without sending a request", () => {
      const calls: FetchCall[] = [];
      const client = settlingClient(calls);

      expect(() => client.validate(songRequest)).not.toThrow();
      expect(calls).toHaveLength(0);
    });
  });

  describe("old requests keep their shape", () => {
    it("sends exactly the style and lyrics keys, in order, when there is no score or parameter", async () => {
      const calls: FetchCall[] = [];

      await settlingClient(calls).generateResult(songRequest);

      expect(calls[0]?.init.body).toBe(OLD_REQUEST_BODY);
    });

    it("sends the same body when the parameters are an empty object", async () => {
      const calls: FetchCall[] = [];

      await settlingClient(calls).generateResult({ ...songRequest, parameters: {} });

      expect(calls[0]?.init.body).toBe(OLD_REQUEST_BODY);
    });

    it.each([
      ["no abc key", {}],
      ["an empty abc", { abc: "" }],
      ["a blank abc", { abc: "  \n " }],
      ["a null abc", { abc: null }],
      ["a non-string abc", { abc: 12 }],
    ])("returns the one audio block when the completed task has %s", async (_name, extra) => {
      const calls: FetchCall[] = [];
      const client = clientWith(
        calls,
        json({ id: "task-1", status: "queued" }),
        json({ id: "task-1", status: "completed", audio_url: AUDIO_URL, ...extra }),
      );

      const result = await client.generateResult(songRequest);

      expect(result.content).toEqual([
        { type: "audio", source: { type: "url", url: AUDIO_URL }, meta: { task_id: "task-1", status: "succeeded" } },
      ]);
    });
  });

  describe("score input", () => {
    it("sends the abc text block as the abc key after style and lyrics", async () => {
      const calls: FetchCall[] = [];

      await settlingClient(calls).generateResult({
        model: "song2",
        content: [styleBlock, lyricsBlock, textBlock("abc", ABC)],
      });

      const body = JSON.parse(String(calls[0]?.init.body));
      expect(body).toEqual({
        model: "song2",
        prompt: "bright J-pop, female vocal, piano",
        lyrics: "[verse]\nla la la",
        abc: ABC,
      });
      expect(Object.keys(body)).toEqual(["model", "prompt", "lyrics", "abc"]);
    });

    it("accepts the abc block in any position", async () => {
      const calls: FetchCall[] = [];

      await settlingClient(calls).generateResult({
        model: "song2",
        content: [textBlock("abc", ABC), styleBlock, lyricsBlock],
      });

      expect(JSON.parse(String(calls[0]?.init.body)).abc).toBe(ABC);
    });

    it("trims the abc text and keeps its inner line breaks", async () => {
      const calls: FetchCall[] = [];

      await settlingClient(calls).generateResult({
        model: "song2",
        content: [styleBlock, lyricsBlock, textBlock("abc", `\n  ${ABC}\n\n`)],
      });

      expect(JSON.parse(String(calls[0]?.init.body)).abc).toBe(ABC);
    });

    it("accepts a score longer than the old 64000 character limit", async () => {
      const calls: FetchCall[] = [];
      const longAbc = `X:1\n${"a".repeat(70_000)}`;

      await settlingClient(calls).generateResult({
        model: "song2",
        content: [styleBlock, lyricsBlock, textBlock("abc", longAbc)],
      });

      expect(JSON.parse(String(calls[0]?.init.body)).abc).toBe(longAbc);
    });

    it.each([
      ["a blank abc", [styleBlock, lyricsBlock, textBlock("abc", " \n\t ")]],
      ["two abc blocks", [styleBlock, lyricsBlock, textBlock("abc", ABC), textBlock("abc", ABC)]],
      ["an abc without lyrics", [styleBlock, textBlock("abc", ABC)]],
      ["an abc without a style", [lyricsBlock, textBlock("abc", ABC)]],
    ])("rejects %s before any request", async (_name, content) => {
      const calls: FetchCall[] = [];
      const client = settlingClient(calls);

      await expect(client.generateResult({ model: "song2", content })).rejects.toBeInstanceOf(
        GenerationValidationError,
      );
      expect(() => client.validate({ model: "song2", content })).toThrow(GenerationValidationError);
      expect(calls).toHaveLength(0);
    });

    it("still rejects a fourth text block and an unknown role", () => {
      const client = settlingClient([]);

      expect(() =>
        client.validate({
          model: "song2",
          content: [styleBlock, lyricsBlock, textBlock("abc", ABC), textBlock("prompt", "another")],
        }),
      ).toThrow(GenerationValidationError);
      expect(() =>
        client.validate({
          model: "song2",
          content: [styleBlock, lyricsBlock, { type: "text", text: ABC, meta: { role: "score" } }],
        }),
      ).toThrow(GenerationValidationError);
    });
  });

  describe("generation parameters", () => {
    it("resolves no parameters for an old request, so cohub queues the same empty object", () => {
      const client = settlingClient([]);

      expect(client.validate(songRequest).parameters).toEqual({});
      expect(client.validate({ ...songRequest, parameters: {} }).parameters).toEqual({});
    });

    it.each([
      ["abc_mode", "melody"],
      ["seed", 42],
      ["return_abc", true],
    ])("adds only %s to the request body when it is the one parameter given", async (key, value) => {
      const calls: FetchCall[] = [];

      await settlingClient(calls).generateResult({ ...songRequest, parameters: { [key]: value } });

      expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
        model: "song2",
        prompt: "bright J-pop, female vocal, piano",
        lyrics: "[verse]\nla la la",
        [key]: value,
      });
    });

    it("sends zero and false, which are values and not absence", async () => {
      const calls: FetchCall[] = [];

      await settlingClient(calls).generateResult({
        ...songRequest,
        parameters: { seed: 0, return_abc: false },
      });

      expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ seed: 0, return_abc: false });
    });

    it("sends the score and every parameter after style and lyrics in a fixed order", async () => {
      const calls: FetchCall[] = [];

      await settlingClient(calls).generateResult({
        model: "song2",
        content: [styleBlock, lyricsBlock, textBlock("abc", ABC)],
        parameters: { return_abc: true, seed: 9_007_199_254_740_991, abc_mode: "melody" },
      });

      const body = JSON.parse(String(calls[0]?.init.body));
      expect(body).toEqual({
        model: "song2",
        prompt: "bright J-pop, female vocal, piano",
        lyrics: "[verse]\nla la la",
        abc: ABC,
        abc_mode: "melody",
        seed: 9_007_199_254_740_991,
        return_abc: true,
      });
      expect(Object.keys(body)).toEqual(["model", "prompt", "lyrics", "abc", "abc_mode", "seed", "return_abc"]);
    });

    it.each([
      ["abc_mode", ["full", "melody"]],
      ["seed", [0, 1, 9_007_199_254_740_991]],
      ["return_abc", [true, false]],
    ])("accepts the documented values of %s", (key, values) => {
      const client = settlingClient([]);

      for (const value of values) {
        expect(() => client.validate({ ...songRequest, parameters: { [key]: value } })).not.toThrow();
      }
    });

    it.each([
      ["abc_mode", ["loud", "FULL", "off", "", 1, true]],
      ["seed", [-1, 1.5, 9_007_199_254_740_992, "7", true, Number.NaN, Number.POSITIVE_INFINITY]],
      ["return_abc", ["true", 1, 0]],
    ])("rejects out-of-contract values of %s before any request", async (key, values) => {
      const calls: FetchCall[] = [];
      const client = settlingClient(calls);

      for (const value of values) {
        const request = { ...songRequest, parameters: { [key]: value } };
        expect(() => client.validate(request), JSON.stringify([key, value])).toThrow(GenerationValidationError);
        await expect(client.generateResult(request)).rejects.toBeInstanceOf(GenerationValidationError);
      }
      expect(calls).toHaveLength(0);
    });

    it.each(["n", "cot", "abc", "cfg_scale"])("does not open %s as a parameter", (key) => {
      const client = settlingClient([]);

      expect(() => client.validate({ ...songRequest, parameters: { [key]: 2 } })).toThrow(
        expect.objectContaining({ message: `Unknown parameter: ${key}` }),
      );
    });

    it("declares every parameter as optional without a default", () => {
      const parameters = settlingClient([]).getModel("song2")?.parameters ?? {};

      expect(Object.keys(parameters)).toEqual([
        "abc_mode",
        "seed",
        "return_abc",
        "abc_continue",
        "harmony",
        "lyric_schedule",
      ]);
      for (const spec of Object.values(parameters)) {
        expect(spec.optional).toBe(true);
        expect(spec).not.toHaveProperty("default");
      }
      expect(parameters.abc_continue).toMatchObject({ type: "boolean" });
      expect(parameters.harmony).toMatchObject({ type: "object" });
      expect(parameters.lyric_schedule).toMatchObject({ type: "object" });
    });

    it("tells agents that melody mode rejects a score with chord marks", () => {
      const description = settlingClient([]).getModel("song2")?.parameters?.abc_mode?.description ?? "";

      const rule = description.split(". ").find((s) => /melody/.test(s) && /chord/.test(s) && /reject/.test(s));

      expect(rule).toBeDefined();
    });
  });

  describe("continuation, section order and lyric schedule", () => {
    const abcContent = [styleBlock, lyricsBlock, textBlock("abc", ABC)];
    const schedule = (overrides: Record<string, unknown> = {}) => ({
      sections: [{ start_sec: 0, lyric: [0, 3] }],
      ...overrides,
    });

    it.each([
      ["abc_continue false", { abc_continue: false }],
      ["no new parameter", {}],
      ["harmony null", { harmony: null }],
      ["harmony empty", { harmony: {} }],
      ["harmony empty follow", { harmony: { follow: [] } }],
      ["harmony null follow", { harmony: { follow: null } }],
      ["lyric_schedule null", { lyric_schedule: null }],
    ])("leaves the old body unchanged when there is %s", async (_name, parameters) => {
      const calls: FetchCall[] = [];

      await settlingClient(calls).generateResult({ ...songRequest, parameters });

      expect(calls[0]?.init.body).toBe(OLD_REQUEST_BODY);
    });

    it("adds abc_continue only when it is true", async () => {
      const calls: FetchCall[] = [];

      await settlingClient(calls).generateResult({
        model: "song2",
        content: abcContent,
        parameters: { abc_continue: true },
      });

      const body = JSON.parse(String(calls[0]?.init.body));
      expect(body).toEqual({
        model: "song2",
        prompt: "bright J-pop, female vocal, piano",
        lyrics: "[verse]\nla la la",
        abc: ABC,
        abc_continue: true,
      });
      expect(Object.keys(body)).toEqual(["model", "prompt", "lyrics", "abc", "abc_continue"]);
    });

    it("adds harmony with lowercased section names", async () => {
      const calls: FetchCall[] = [];

      await settlingClient(calls).generateResult({
        model: "song2",
        content: abcContent,
        parameters: { abc_continue: true, harmony: { follow: ["Verse", "CHORUS 2"] } },
      });

      expect(JSON.parse(String(calls[0]?.init.body)).harmony).toEqual({ follow: ["verse", "chorus 2"] });
    });

    it("adds the lyric schedule with only the fields given", async () => {
      const calls: FetchCall[] = [];

      await settlingClient(calls).generateResult({
        ...songRequest,
        parameters: {
          lyric_schedule: {
            sections: [
              { start_sec: 0, lyric: [0, 3] },
              { start_sec: 12.5, lyric: [3, 9] },
            ],
            lead_sec: 1.5,
            behind: 2,
            mode: "mask",
          },
        },
      });

      expect(JSON.parse(String(calls[0]?.init.body)).lyric_schedule).toEqual({
        sections: [
          { start_sec: 0, lyric: [0, 3] },
          { start_sec: 12.5, lyric: [3, 9] },
        ],
        lead_sec: 1.5,
        behind: 2,
        mode: "mask",
      });
    });

    it("does not add defaults inside the lyric schedule", async () => {
      const calls: FetchCall[] = [];

      await settlingClient(calls).generateResult({
        ...songRequest,
        parameters: { lyric_schedule: schedule() },
      });

      expect(JSON.parse(String(calls[0]?.init.body)).lyric_schedule).toEqual({
        sections: [{ start_sec: 0, lyric: [0, 3] }],
      });
    });

    it("treats null optional schedule fields as absent", async () => {
      const calls: FetchCall[] = [];

      await settlingClient(calls).generateResult({
        ...songRequest,
        parameters: {
          lyric_schedule: {
            sections: [{ start_sec: 0, lyric: [0, 3] }],
            lead_sec: null,
            behind: null,
            mode: null,
          },
        },
      });

      expect(JSON.parse(String(calls[0]?.init.body)).lyric_schedule).toEqual({
        sections: [{ start_sec: 0, lyric: [0, 3] }],
      });
    });

    it("adds all three after the existing parameters in a fixed order", async () => {
      const calls: FetchCall[] = [];

      await settlingClient(calls).generateResult({
        model: "song2",
        content: abcContent,
        parameters: {
          return_abc: true,
          abc_continue: true,
          harmony: { follow: ["Verse"] },
          lyric_schedule: schedule(),
        },
      });

      const body = JSON.parse(String(calls[0]?.init.body));
      expect(body).toEqual({
        model: "song2",
        prompt: "bright J-pop, female vocal, piano",
        lyrics: "[verse]\nla la la",
        abc: ABC,
        return_abc: true,
        abc_continue: true,
        harmony: { follow: ["verse"] },
        lyric_schedule: { sections: [{ start_sec: 0, lyric: [0, 3] }] },
      });
      expect(Object.keys(body)).toEqual([
        "model",
        "prompt",
        "lyrics",
        "abc",
        "return_abc",
        "abc_continue",
        "harmony",
        "lyric_schedule",
      ]);
    });

    it("counts lyric spans in code points, not UTF-16 units", async () => {
      const calls: FetchCall[] = [];
      const content = [styleBlock, textBlock("lyrics", "😀ab")];

      await settlingClient(calls).generateResult({
        model: "song2",
        content,
        parameters: { lyric_schedule: { sections: [{ start_sec: 0, lyric: [0, 3] }] } },
      });
      expect(JSON.parse(String(calls[0]?.init.body)).lyric_schedule).toEqual({
        sections: [{ start_sec: 0, lyric: [0, 3] }],
      });

      const rejected: FetchCall[] = [];
      await expect(
        settlingClient(rejected).generateResult({
          model: "song2",
          content,
          parameters: { lyric_schedule: { sections: [{ start_sec: 0, lyric: [0, 4] }] } },
        }),
      ).rejects.toThrow("must satisfy 0 <= c0 < c1 <= 3");
      expect(rejected).toHaveLength(0);
    });

    it("sends the caller's untrimmed lyrics and original spans when the schedule is on", async () => {
      const calls: FetchCall[] = [];
      const rawLyrics = "  😀ab  ";
      const sections = [
        { start_sec: 0, lyric: [2, 5] },
        { start_sec: 1, lyric: [5, 7] },
      ];

      await settlingClient(calls).generateResult({
        model: "song2",
        content: [styleBlock, textBlock("lyrics", rawLyrics)],
        parameters: { lyric_schedule: { sections } },
      });

      const body = JSON.parse(String(calls[0]?.init.body));
      expect(body.lyrics).toBe(rawLyrics);
      expect(body.lyric_schedule).toEqual({ sections });
    });

    it("accepts a span ending at the original code-point length, whitespace included", async () => {
      const calls: FetchCall[] = [];
      const content = [styleBlock, textBlock("lyrics", "  abc  ")];

      await settlingClient(calls).generateResult({
        model: "song2",
        content,
        parameters: { lyric_schedule: { sections: [{ start_sec: 0, lyric: [0, 7] }] } },
      });
      expect(JSON.parse(String(calls[0]?.init.body)).lyric_schedule).toEqual({
        sections: [{ start_sec: 0, lyric: [0, 7] }],
      });

      const rejected: FetchCall[] = [];
      await expect(
        settlingClient(rejected).generateResult({
          model: "song2",
          content,
          parameters: { lyric_schedule: { sections: [{ start_sec: 0, lyric: [0, 8] }] } },
        }),
      ).rejects.toThrow("must satisfy 0 <= c0 < c1 <= 7");
      expect(rejected).toHaveLength(0);
    });

    it("counts the original lyrics in code points for non-ASCII text", async () => {
      const calls: FetchCall[] = [];
      const content = [styleBlock, textBlock("lyrics", " 😀ab ")];

      await settlingClient(calls).generateResult({
        model: "song2",
        content,
        parameters: { lyric_schedule: { sections: [{ start_sec: 0, lyric: [0, 5] }] } },
      });
      expect(JSON.parse(String(calls[0]?.init.body)).lyrics).toBe(" 😀ab ");

      const rejected: FetchCall[] = [];
      await expect(
        settlingClient(rejected).generateResult({
          model: "song2",
          content,
          parameters: { lyric_schedule: { sections: [{ start_sec: 0, lyric: [0, 6] }] } },
        }),
      ).rejects.toThrow("must satisfy 0 <= c0 < c1 <= 5");
      expect(rejected).toHaveLength(0);
    });

    it("keeps trimming the lyrics when no schedule is given", async () => {
      const calls: FetchCall[] = [];

      await settlingClient(calls).generateResult({
        model: "song2",
        content: [styleBlock, textBlock("lyrics", "  abc  ")],
      });

      expect(JSON.parse(String(calls[0]?.init.body)).lyrics).toBe("abc");
    });

    it.each([
      [
        "abc_continue without abc",
        { ...songRequest, parameters: { abc_continue: true } },
        "abc_continue requires an abc text block",
      ],
      [
        "abc_continue that is not a boolean",
        { ...songRequest, parameters: { abc_continue: "yes" } },
        "Parameter abc_continue must be a boolean",
      ],
      [
        "harmony that is not an object",
        { ...songRequest, parameters: { harmony: [] } },
        "Parameter harmony must be an object",
      ],
      [
        "lyric_schedule that is not an object",
        { ...songRequest, parameters: { lyric_schedule: [] } },
        "Parameter lyric_schedule must be an object",
      ],
      [
        "harmony with abc and no continuation",
        { model: "song2", content: abcContent, parameters: { harmony: { follow: ["verse"] } } },
        "harmony requires abc_continue true",
      ],
      [
        "harmony with melody",
        { ...songRequest, parameters: { harmony: { follow: ["verse"] }, abc_mode: "melody" } },
        "melody score has no chords",
      ],
      [
        "harmony with an unknown key",
        { ...songRequest, parameters: { harmony: { follow: ["verse"], strength: 1 } } },
        "harmony.strength is not supported",
      ],
      [
        "harmony with a non-array follow",
        { ...songRequest, parameters: { harmony: { follow: "verse" } } },
        "harmony.follow must be an array",
      ],
      [
        "harmony with a non-string name",
        { ...songRequest, parameters: { harmony: { follow: [1] } } },
        "harmony.follow[0] must be a string",
      ],
      [
        "harmony with a null name",
        { ...songRequest, parameters: { harmony: { follow: [null] } } },
        "harmony.follow[0] must be a string",
      ],
      [
        "harmony with an invalid name",
        { ...songRequest, parameters: { harmony: { follow: ["1verse"] } } },
        "must start with a letter",
      ],
      [
        "lyric_schedule with bias",
        { ...songRequest, parameters: { lyric_schedule: schedule({ bias: 1 }) } },
        "lyric_schedule.bias is not supported",
      ],
      [
        "lyric_schedule with a bad mode",
        { ...songRequest, parameters: { lyric_schedule: schedule({ mode: "all" }) } },
        "lyric_schedule.mode must be mask",
      ],
      [
        "lyric_schedule with empty sections",
        { ...songRequest, parameters: { lyric_schedule: { sections: [] } } },
        "lyric_schedule.sections must be a non-empty array",
      ],
      [
        "lyric_schedule with null sections",
        { ...songRequest, parameters: { lyric_schedule: { sections: null } } },
        "lyric_schedule.sections must be a non-empty array",
      ],
      [
        "lyric_schedule with a section that is not an object",
        { ...songRequest, parameters: { lyric_schedule: { sections: [1] } } },
        "lyric_schedule.sections[0] must be an object",
      ],
      [
        "lyric_schedule with an unknown section key",
        {
          ...songRequest,
          parameters: { lyric_schedule: { sections: [{ start_sec: 0, lyric: [0, 3], extra: true }] } },
        },
        "lyric_schedule.sections[0].extra is not supported",
      ],
      [
        "lyric_schedule with a negative start",
        {
          ...songRequest,
          parameters: { lyric_schedule: { sections: [{ start_sec: -1, lyric: [0, 3] }] } },
        },
        "start_sec must be a finite non-negative number",
      ],
      [
        "lyric_schedule with a null start",
        {
          ...songRequest,
          parameters: { lyric_schedule: { sections: [{ start_sec: null, lyric: [0, 3] }] } },
        },
        "start_sec must be a finite non-negative number",
      ],
      [
        "lyric_schedule with decreasing starts",
        {
          ...songRequest,
          parameters: {
            lyric_schedule: {
              sections: [
                { start_sec: 2, lyric: [0, 1] },
                { start_sec: 1, lyric: [1, 2] },
              ],
            },
          },
        },
        "start_sec must not decrease",
      ],
      [
        "lyric_schedule with a malformed lyric pair",
        {
          ...songRequest,
          parameters: { lyric_schedule: { sections: [{ start_sec: 0, lyric: [0] }] } },
        },
        "lyric must be a [c0, c1] pair",
      ],
      [
        "lyric_schedule with a null lyric pair",
        {
          ...songRequest,
          parameters: { lyric_schedule: { sections: [{ start_sec: 0, lyric: null }] } },
        },
        "lyric must be a [c0, c1] pair",
      ],
      [
        "lyric_schedule with non-integer offsets",
        {
          ...songRequest,
          parameters: { lyric_schedule: { sections: [{ start_sec: 0, lyric: [0.5, 1] }] } },
        },
        "lyric must contain two integers",
      ],
      [
        "lyric_schedule with a null offset",
        {
          ...songRequest,
          parameters: { lyric_schedule: { sections: [{ start_sec: 0, lyric: [null, 1] }] } },
        },
        "lyric must contain two integers",
      ],
      [
        "lyric_schedule outside the lyrics",
        {
          ...songRequest,
          parameters: { lyric_schedule: { sections: [{ start_sec: 0, lyric: [0, 99] }] } },
        },
        "lyric must satisfy 0 <= c0 < c1 <=",
      ],
      [
        "lyric_schedule with a negative lead",
        { ...songRequest, parameters: { lyric_schedule: schedule({ lead_sec: -1 }) } },
        "lyric_schedule.lead_sec must be a finite non-negative number",
      ],
      [
        "lyric_schedule with a fractional behind",
        { ...songRequest, parameters: { lyric_schedule: schedule({ behind: 1.5 }) } },
        "lyric_schedule.behind must be a non-negative integer",
      ],
    ])("rejects %s before any request", async (_name, request, message) => {
      const calls: FetchCall[] = [];
      const client = settlingClient(calls);

      expect(() => client.validate(request)).toThrow(message);
      await expect(client.generateResult(request)).rejects.toBeInstanceOf(GenerationValidationError);
      expect(calls).toHaveLength(0);
    });

    it("rejects abc_continue and harmony with abc_mode off once off is offered", async () => {
      const calls: FetchCall[] = [];
      const client = heldBackClient(calls);
      const content = [styleBlock, lyricsBlock, textBlock("abc", ABC)];

      await expect(
        client.generateResult({
          model: "song2",
          content,
          parameters: { abc_continue: true, abc_mode: "off" },
        }),
      ).rejects.toThrow("abc_continue cannot be used with abc_mode off");
      await expect(
        client.generateResult({
          model: "song2",
          content: [styleBlock, lyricsBlock],
          parameters: { harmony: { follow: ["verse"] }, abc_mode: "off" },
        }),
      ).rejects.toThrow("harmony cannot be used with abc_mode off");
      expect(calls).toHaveLength(0);
    });
  });

  describe("score output", () => {
    const completedWith = (abc: unknown) =>
      clientWith(
        [],
        json({ id: "task-1", status: "queued", usage: { cost: 0.3 } }),
        json({ id: "task-1", status: "completed", audio_url: AUDIO_URL, abc, usage: { cost: 0.3 } }),
      );

    it("appends the score as an abc text block after the audio block, with the task id", async () => {
      const result = await completedWith(ABC).generateResult({
        ...songRequest,
        parameters: { return_abc: true },
      });

      expect(result).toEqual({
        content: [
          { type: "audio", source: { type: "url", url: AUDIO_URL }, meta: { task_id: "task-1", status: "succeeded" } },
          { type: "text", text: ABC, meta: { role: "abc", task_id: "task-1" } },
        ],
        cost: 0.3,
      });
    });

    it("returns the score exactly as received", async () => {
      const raw = `${ABC}\n\n`;

      const result = await completedWith(raw).generateResult(songRequest);

      expect(result.content[1]).toMatchObject({ type: "text", text: raw });
    });

    it("does not add a score block while the task is still running", async () => {
      vi.useFakeTimers();
      const client = clientWith(
        [],
        json({ id: "task-1", status: "queued" }),
        json({ id: "task-1", status: "in_progress", abc: ABC }),
        json({ id: "task-1", status: "completed", audio_url: AUDIO_URL }),
      );

      const promise = client.generateResult(songRequest);
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);

      await expect(promise).resolves.toMatchObject({ content: [{ type: "audio" }] });
      expect((await promise).content).toHaveLength(1);
    });

    it("still reports a failed task as a provider error when it carries a score", async () => {
      const client = clientWith(
        [],
        json({ id: "task-1", status: "queued" }),
        json({ id: "task-1", status: "failed", abc: ABC, error: { code: "generation_failed", message: "no" } }),
      );

      await expect(client.generateResult(songRequest)).rejects.toMatchObject({ name: "GenerationProviderError" });
    });

    it("accepts the returned score block as the abc input of the next request", async () => {
      const first = await completedWith(ABC).generateResult({ ...songRequest, parameters: { return_abc: true } });
      const returned = first.content.find((block) => block.type === "text");
      if (!returned) throw new Error("expected a score block");
      const calls: FetchCall[] = [];

      await settlingClient(calls).generateResult({
        model: "song2",
        content: [styleBlock, lyricsBlock, returned],
        parameters: { abc_mode: "melody" },
      });

      expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ abc: ABC, abc_mode: "melody" });
    });
  });

  describe("against the declaration published before the score", () => {
    // models/song2.yaml as published before the score: the platform keeps serving it until the new one is saved,
    // while the adapter is already new.
    const previousDeclaration = parseGenerationModelDeclaration(
      `schema: neta.generation.model.v1
model: song2
title: Song 2
category: audio
description: Generates a full song with vocals from a style description and lyrics. Both texts are required and capped at 2000 characters each. Generation is asynchronous and can take several minutes.
adapter:
  type: newapi.audioGenerations
content:
  input:
    - type: text
      required: true
      min: 2
      max: 2
      roles:
        - prompt
        - lyrics
      roleRequired: true
      description: Exactly two text blocks. Use meta.role prompt for the style description and meta.role lyrics for the lyrics to sing.
examples:
  - title: Song from style and lyrics
    request:
      model: song2
      content:
        - type: text
          text: bright J-pop, female vocal, piano
          meta:
            role: prompt
        - type: text
          text: |-
            [verse]
            la la la
          meta:
            role: lyrics
`,
      "song2.yaml",
    );

    function previousClient(calls: FetchCall[]) {
      return createGenerationClient({
        apiKey: "key",
        models: [previousDeclaration],
        includeBuiltinModels: false,
        fetch: taskFetch(
          calls,
          json({ id: "task-1", status: "queued" }),
          json({ id: "task-1", status: "completed", audio_url: AUDIO_URL }),
        ),
      });
    }

    it("sends an old request unchanged", async () => {
      const calls: FetchCall[] = [];

      const result = await previousClient(calls).generateResult(songRequest);

      expect(calls[0]?.init.body).toBe(OLD_REQUEST_BODY);
      expect(result.content).toHaveLength(1);
    });

    it.each([
      ["a score", { model: "song2", content: [styleBlock, lyricsBlock, textBlock("abc", ABC)] }],
      ["a parameter", { ...songRequest, parameters: { return_abc: true } }],
    ])("rejects %s loudly before any request instead of dropping it", async (_name, request) => {
      const calls: FetchCall[] = [];

      await expect(previousClient(calls).generateResult(request)).rejects.toBeInstanceOf(GenerationValidationError);
      expect(calls).toHaveLength(0);
    });
  });

  describe("conflicting score settings", () => {
    const abcContent = [styleBlock, lyricsBlock, textBlock("abc", ABC)];

    it.each([
      ["melody with a score", { model: "song2", content: abcContent, parameters: { abc_mode: "melody" } }],
      [
        "full with a score and return_abc",
        { model: "song2", content: abcContent, parameters: { abc_mode: "full", return_abc: true } },
      ],
    ])("accepts %s", async (_name, request) => {
      const calls: FetchCall[] = [];

      await settlingClient(calls).generateResult(request);

      expect(calls).toHaveLength(2);
    });
  });

  // cfg_scale and abc_mode off are not offered yet. The adapter keeps mapping and checking them, so offering them again
  // is a change to the declaration alone.
  describe("cfg_scale and abc_mode off", () => {
    const abcContent = [styleBlock, lyricsBlock, textBlock("abc", ABC)];

    it.each([
      ["cfg_scale 3", { cfg_scale: 3 }, "Unknown parameter: cfg_scale"],
      ["cfg_scale 1", { cfg_scale: 1 }, "Unknown parameter: cfg_scale"],
      ["abc_mode off", { abc_mode: "off" }, "must be one of: full, melody"],
    ])("are not offered by the declaration, so %s is rejected before any request", async (_name, parameters, message) => {
      const calls: FetchCall[] = [];
      const client = settlingClient(calls);
      const request = { ...songRequest, parameters };

      expect(() => client.validate(request)).toThrow(message);
      await expect(client.generateResult(request)).rejects.toBeInstanceOf(GenerationValidationError);
      expect(calls).toHaveLength(0);
    });

    describe("once the declaration offers them", () => {
      it.each([
        ["cfg_scale", 3.5],
        ["abc_mode", "off"],
      ])("adds only %s to the request body when it is the one parameter given", async (key, value) => {
        const calls: FetchCall[] = [];

        await heldBackClient(calls).generateResult({ ...songRequest, parameters: { [key]: value } });

        expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
          model: "song2",
          prompt: "bright J-pop, female vocal, piano",
          lyrics: "[verse]\nla la la",
          [key]: value,
        });
      });

      it("sends cfg_scale zero, which is a value and not absence", async () => {
        const calls: FetchCall[] = [];

        await heldBackClient(calls).generateResult({ ...songRequest, parameters: { cfg_scale: 0 } });

        expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({ cfg_scale: 0 });
      });

      it("sends the score and every parameter after style and lyrics in a fixed order", async () => {
        const calls: FetchCall[] = [];

        await heldBackClient(calls).generateResult({
          model: "song2",
          content: abcContent,
          parameters: { return_abc: true, cfg_scale: 4, seed: 9_007_199_254_740_991, abc_mode: "melody" },
        });

        const body = JSON.parse(String(calls[0]?.init.body));
        expect(body).toEqual({
          model: "song2",
          prompt: "bright J-pop, female vocal, piano",
          lyrics: "[verse]\nla la la",
          abc: ABC,
          abc_mode: "melody",
          seed: 9_007_199_254_740_991,
          cfg_scale: 4,
          return_abc: true,
        });
        expect(Object.keys(body)).toEqual([
          "model",
          "prompt",
          "lyrics",
          "abc",
          "abc_mode",
          "seed",
          "cfg_scale",
          "return_abc",
        ]);
      });

      it.each([
        ["abc_mode", ["full", "melody", "off"]],
        ["cfg_scale", [0, 1.5, 20]],
      ])("accepts the documented values of %s", (key, values) => {
        const client = heldBackClient([]);

        for (const value of values) {
          expect(() => client.validate({ ...songRequest, parameters: { [key]: value } })).not.toThrow();
        }
      });

      it("rejects out-of-contract values of cfg_scale before any request", async () => {
        const calls: FetchCall[] = [];
        const client = heldBackClient(calls);

        for (const value of [-0.1, 20.1, "1", true, Number.NaN, Number.POSITIVE_INFINITY]) {
          const request = { ...songRequest, parameters: { cfg_scale: value } };
          expect(() => client.validate(request), JSON.stringify(value)).toThrow(GenerationValidationError);
          await expect(client.generateResult(request)).rejects.toBeInstanceOf(GenerationValidationError);
        }
        expect(calls).toHaveLength(0);
      });

      it.each([
        ["a score", { model: "song2", content: abcContent, parameters: { abc_mode: "off" } }],
        ["return_abc true", { ...songRequest, parameters: { abc_mode: "off", return_abc: true } }],
        [
          "a score and return_abc true",
          { model: "song2", content: abcContent, parameters: { abc_mode: "off", return_abc: true } },
        ],
      ])("rejects abc_mode off with %s before any request", async (_name, request) => {
        const calls: FetchCall[] = [];
        const client = heldBackClient(calls);

        expect(() => client.validate(request)).toThrow(GenerationValidationError);
        await expect(client.generateResult(request)).rejects.toBeInstanceOf(GenerationValidationError);
        expect(calls).toHaveLength(0);
      });

      it.each([
        ["off without a score", { ...songRequest, parameters: { abc_mode: "off" } }],
        ["off with return_abc false", { ...songRequest, parameters: { abc_mode: "off", return_abc: false } }],
      ])("accepts %s", async (_name, request) => {
        const calls: FetchCall[] = [];

        await heldBackClient(calls).generateResult(request);

        expect(calls).toHaveLength(2);
      });
    });
  });

  describe("failures", () => {
    it.each([
      "generation_failed",
      "generation_timeout",
    ])("throws the provider error %s and stops polling", async (code) => {
      vi.useFakeTimers();
      const calls: FetchCall[] = [];
      const client = clientWith(
        calls,
        json({ id: "task-1", status: "queued" }),
        json({ id: "task-1", status: "in_progress" }),
        json({ id: "task-1", status: "failed", error: { code, message: "worker gave up" } }),
      );

      const promise = client.generateResult(songRequest);
      const rejection = expect(promise).rejects.toMatchObject({
        name: "GenerationProviderError",
        message: expect.stringContaining("worker gave up"),
        details: { taskId: "task-1", code, message: "worker gave up" },
      });
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      await rejection;

      const settled = calls.length;
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
      expect(calls).toHaveLength(settled);
    });

    it("keeps the 60 second timeout on each request", async () => {
      vi.useFakeTimers();
      const client = createGenerationClient({
        apiKey: "key",
        fetch: ((_url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
          })) as typeof fetch,
      });

      const promise = client.generateResult(songRequest);
      const rejection = expect(promise).rejects.toBeInstanceOf(GenerationTimeoutError);
      await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
      await rejection;
    });

    it("delivers a song that finishes after 30 minutes", async () => {
      vi.useFakeTimers();
      const calls: FetchCall[] = [];
      let done = false;
      const client = createGenerationClient({
        apiKey: "key",
        fetch: (async (url: string | URL | Request, init?: RequestInit) => {
          calls.push({ url: String(url), init: init ?? {} });
          if (init?.method === "POST") return json({ id: "task-1", status: "queued" });
          return done
            ? json({ id: "task-1", status: "completed", audio_url: AUDIO_URL })
            : json({ id: "task-1", status: "in_progress" });
        }) as typeof fetch,
      });

      const promise = client.generateResult(songRequest);
      const outcome = watch(promise);
      await vi.advanceTimersByTimeAsync(SERVER_FINISH_MS);
      expect(outcome.settled()).toBe(false);
      expect(calls.length).toBeGreaterThan(SERVER_FINISH_MS / POLL_INTERVAL_MS);

      done = true;
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      await expect(promise).resolves.toMatchObject({ content: [{ type: "audio", source: { url: AUDIO_URL } }] });
    });

    it("throws a provider error with status and body when the submit is rejected", async () => {
      const calls: FetchCall[] = [];
      const body = JSON.stringify({ error: { message: "insufficient quota" } });
      const client = clientWith(calls, new Response(body, { status: 403 }));

      await expect(client.generateResult(songRequest)).rejects.toMatchObject({
        name: "GenerationProviderError",
        status: 403,
        body,
      });
      expect(calls).toHaveLength(1);
    });

    it("throws a provider error with status and body when a status poll fails", async () => {
      const calls: FetchCall[] = [];
      const client = clientWith(
        calls,
        json({ id: "task-1", status: "queued" }),
        new Response("bad gateway", { status: 502 }),
      );

      await expect(client.generateResult(songRequest)).rejects.toMatchObject({
        name: "GenerationProviderError",
        status: 502,
        body: "bad gateway",
      });
    });

    it("throws a provider error when a response is not JSON", async () => {
      const calls: FetchCall[] = [];
      const client = clientWith(calls, new Response("<html>oops</html>", { status: 200 }));

      await expect(client.generateResult(songRequest)).rejects.toMatchObject({
        name: "GenerationProviderError",
        status: 200,
        body: "<html>oops</html>",
      });
    });

    it("throws a provider error when the submit response has no task id", async () => {
      const calls: FetchCall[] = [];
      const client = clientWith(calls, json({ status: "queued" }));

      await expect(client.generateResult(songRequest)).rejects.toMatchObject({
        name: "GenerationProviderError",
      });
      expect(calls).toHaveLength(1);
    });

    it("throws a provider error when a completed task has no audio url", async () => {
      const calls: FetchCall[] = [];
      const client = clientWith(
        calls,
        json({ id: "task-1", status: "queued" }),
        json({ id: "task-1", status: "completed" }),
      );

      await expect(client.generateResult(songRequest)).rejects.toMatchObject({
        name: "GenerationProviderError",
        details: { taskId: "task-1" },
      });
    });
  });
});
