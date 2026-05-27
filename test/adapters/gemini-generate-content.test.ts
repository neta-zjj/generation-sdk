import { describe, expect, it } from "vitest";
import { createGenerationClient } from "../../src/index.js";

describe("gemini.generateContent adapter", () => {
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
});
