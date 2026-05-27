import { describe, expect, it } from "vitest";
import { createGenerationClient } from "../../src/index.js";

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
    const output = await client.generate({
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
    expect(output[0]).toEqual({ type: "image", source: { type: "url", url: "https://example.com/out.png" } });
  });
});
