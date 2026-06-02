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
          responseFormat: { image: { aspectRatio: "1:1", imageSize: "2K" } },
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
    const response = await client.generate({
      model: "gemini-3.1-flash-image-preview",
      content: [{ type: "text", text: "hello" }],
    });

    expect(calls[0]?.url).toBe("https://router.neta.art/v1beta/models/gemini-3.1-flash-image-preview:generateContent");
    expect(response).toMatchObject({ model: "gemini-3.1-flash-image-preview" });
    expect(response.content[0]).toEqual({
      type: "image",
      source: { type: "base64", mediaType: "image/png", data: "abc" },
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
