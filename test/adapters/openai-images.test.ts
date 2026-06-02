import { describe, expect, it } from "vitest";
import { createGenerationClient, type GenerationProviderError } from "../../src/index.js";

describe("openai.images adapter", () => {
  it("builds image generation requests", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchMock = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({ data: [{ url: "https://example.com/out.png", revised_prompt: "revised" }] }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    };

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    const response = await client.generate({
      model: "gpt-image-2",
      content: [{ type: "text", text: "hello" }],
      parameters: { size: "1024x1024" },
    });

    expect(calls[0]?.url).toBe("https://router.neta.art/v1/images/generations");
    expect(JSON.parse(String(calls[0]?.init.body))).toMatchObject({
      model: "gpt-image-2",
      prompt: "hello",
      size: "1024x1024",
    });
    expect(response).toMatchObject({ model: "gpt-image-2" });
    expect(response.content[0]).toEqual({ type: "image", source: { type: "url", url: "https://example.com/out.png" } });
  });

  it("returns base64 image output", async () => {
    const fetchMock = async () =>
      new Response(JSON.stringify({ data: [{ b64_json: "abc" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    const response = await client.generate({
      model: "gpt-image-2",
      content: [{ type: "text", text: "hello" }],
    });

    expect(response.content[0]).toEqual({
      type: "image",
      source: { type: "base64", mediaType: "image/png", data: "abc" },
    });
  });

  it("includes provider diagnostics when a successful response has no output", async () => {
    const fetchMock = async () =>
      new Response(
        JSON.stringify({
          created: 123,
          usage: { total_tokens: 42 },
          data: [{ url: "", b64_json: "" }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );

    const client = createGenerationClient({ apiKey: "key", fetch: fetchMock as typeof fetch });
    await expect(
      client.generate({
        model: "gpt-image-2",
        content: [{ type: "text", text: "hello" }],
      }),
    ).rejects.toMatchObject({
      name: "GenerationProviderError",
      message: "Image generation returned no output",
      details: {
        created: 123,
        usage: { total_tokens: 42 },
        dataCount: 1,
        data: [{ hasUrl: false, hasBase64Json: false }],
      },
    } satisfies Partial<GenerationProviderError>);
  });
});
