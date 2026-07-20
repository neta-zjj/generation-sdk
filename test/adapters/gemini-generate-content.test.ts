import { describe, expect, it } from "vitest";
import { createGenerationClient, type GenerationProviderError } from "../../src/index.js";

describe("gemini.generateContent adapter", () => {
  it("emits redacted debug request events", async () => {
    const events: unknown[] = [];
    const fetchMock = async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "abc" } }] } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const client = createGenerationClient({
      apiKey: "secret-key",
      fetch: fetchMock as typeof fetch,
      debug: { enabled: true, logger: (event) => events.push(event) },
    });
    await client.generate({
      model: "gemini-3.1-flash-image-preview",
      content: [{ type: "text", text: "hello" }],
    });

    expect(events[0]).toEqual({
      type: "request",
      url: "https://router.neta.art/v1beta/models/gemini-3.1-flash-image-preview:generateContent",
      method: "POST",
      headers: { Authorization: "[REDACTED]", "Content-Type": "application/json" },
      body: {
        contents: [{ parts: [{ text: "hello" }] }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: { aspectRatio: "1:1", imageSize: "2K" },
        },
      },
    });
    expect(events[1]).toMatchObject({
      type: "response",
      status: 200,
      headers: { "content-type": "application/json" },
      body: {
        candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "[REDACTED]" } }] } }],
      },
    });
  });

  it("always redacts base64 media even when sensitive debug fields are enabled", async () => {
    const events: unknown[] = [];
    const base64Data = "a".repeat(256);
    const fetchMock = async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: base64Data } }] } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const client = createGenerationClient({
      apiKey: "secret-key",
      fetch: fetchMock as typeof fetch,
      debug: { enabled: true, includeSensitive: true, logger: (event) => events.push(event) },
    });
    await client.generate({
      model: "gemini-3.1-flash-image-preview",
      content: [{ type: "text", text: "hello" }],
    });

    const serialized = JSON.stringify(events);
    expect(serialized).toContain("secret-key");
    expect(serialized).not.toContain(base64Data);
  });

  it("builds generateContent requests", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "abc" } }] } }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    const output = await client.generate({
      model: "gemini-3.1-flash-image-preview",
      content: [{ type: "text", text: "hello" }],
    });

    expect(calls[0]?.url).toBe("https://router.neta.art/v1beta/models/gemini-3.1-flash-image-preview:generateContent");
    expect(output[0]).toEqual({ type: "image", source: { type: "base64", mediaType: "image/png", data: "abc" } });
  });

  it("omits imageSize for fixed-1K Gemini Lite requests", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "abc" } }] } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    await client.generate({
      model: "gemini-3.1-flash-lite-image",
      content: [{ type: "text", text: "hello" }],
    });

    expect(calls[0]?.url).toBe("https://router.neta.art/v1beta/models/gemini-3.1-flash-lite-image:generateContent");
    expect(JSON.parse(String(calls[0]?.init.body)).generationConfig).toEqual({
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: "1:1" },
    });
  });

  it("passes URL image inputs as Gemini fileData without fetching them", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "abc" } }] } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    await client.generate({
      model: "gemini-3.1-flash-image-preview",
      content: [
        { type: "text", text: "edit this" },
        { type: "image", source: { type: "url", url: "https://example.com/reference.png" } },
      ],
    });

    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({
      contents: [
        {
          parts: [{ text: "edit this" }, { fileData: { fileUri: "https://example.com/reference.png" } }],
        },
      ],
      generationConfig: {
        responseModalities: ["IMAGE"],
        imageConfig: { aspectRatio: "1:1", imageSize: "2K" },
      },
    });
  });

  it("passes base64 image inputs as Gemini inlineData", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "abc" } }] } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    };

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    await client.generate({
      model: "gemini-3.1-flash-image-preview",
      content: [
        { type: "text", text: "edit this" },
        { type: "image", source: { type: "base64", mediaType: "image/png", data: "aW1hZ2U=" } },
      ],
    });

    expect(JSON.parse(calls[0]?.init.body as string).contents[0].parts[1]).toEqual({
      inlineData: { mimeType: "image/png", data: "aW1hZ2U=" },
    });
  });

  it("includes Gemini diagnostics when a successful response has no output parts", async () => {
    const fetchMock = async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              index: 0,
              content: { role: "model", parts: [] },
              finishReason: "SAFETY",
              finishMessage: "Response blocked by safety filters.",
              safetyRatings: [{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", probability: "HIGH" }],
            },
          ],
          promptFeedback: { blockReason: "IMAGE_SAFETY" },
          usageMetadata: { totalTokenCount: 12 },
          modelVersion: "gemini-test",
          responseId: "response-1",
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    await expect(
      client.generate({
        model: "gemini-3.1-flash-image-preview",
        content: [{ type: "text", text: "hello" }],
      }),
    ).rejects.toMatchObject({
      name: "GenerationProviderError",
      message: "Gemini generation returned no output",
      details: {
        finishReasons: ["SAFETY"],
        finishMessages: ["Response blocked by safety filters."],
        safetyRatings: [{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", probability: "HIGH" }],
        promptFeedback: { blockReason: "IMAGE_SAFETY" },
        usageMetadata: { totalTokenCount: 12 },
        modelVersion: "gemini-test",
        responseId: "response-1",
        candidateCount: 1,
        candidates: [
          {
            index: 0,
            finishReason: "SAFETY",
            finishMessage: "Response blocked by safety filters.",
            safetyRatings: [{ category: "HARM_CATEGORY_DANGEROUS_CONTENT", probability: "HIGH" }],
            contentRole: "model",
            partCount: 0,
          },
        ],
      },
    } satisfies Partial<GenerationProviderError>);
  });
});
