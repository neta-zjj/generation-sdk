import { describe, expect, it } from "vitest";
import { createGenerationClient, GenerationValidationError } from "../src/index.js";

describe("validation", () => {
  it("resolves default parameters", () => {
    const client = createGenerationClient({ apiKey: "test" });
    const resolved = client.validate({
      model: "gpt-image-2",
      content: [{ type: "text", text: "hello" }],
    });
    expect(resolved.parameters).toMatchObject({ size: "1024x1024", quality: "auto" });
  });

  it("rejects unknown parameters", () => {
    const client = createGenerationClient({ apiKey: "test" });
    expect(() =>
      client.validate({
        model: "gpt-image-2",
        content: [{ type: "text", text: "hello" }],
        parameters: { nope: true },
      }),
    ).toThrow(GenerationValidationError);
  });

  it("rejects base64 media for Seedance video models", () => {
    const client = createGenerationClient({ apiKey: "test" });
    expect(() =>
      client.validate({
        model: "seedance-2-0-fast",
        content: [
          { type: "text", text: "animate this reference" },
          {
            type: "image",
            source: { type: "base64", mediaType: "image/png", data: "abc" },
            meta: { role: "reference_image" },
          },
        ],
      }),
    ).toThrow("image source is not supported by seedance-2-0-fast: base64");
  });

  it("rejects unsupported content roles when declared by the model", () => {
    const client = createGenerationClient({ apiKey: "test" });
    expect(() =>
      client.validate({
        model: "seedance-2-0-fast",
        content: [
          { type: "text", text: "animate this reference" },
          {
            type: "image",
            source: { type: "url", url: "https://example.com/input.png" },
            meta: { role: "reference_video" },
          },
        ],
      }),
    ).toThrow("image role is not supported by seedance-2-0-fast: reference_video");
  });

  it("rejects missing required content roles when declared by the model", () => {
    const client = createGenerationClient({ apiKey: "test" });
    expect(() =>
      client.validate({
        model: "seedance-2-0-fast",
        content: [
          { type: "text", text: "use this motion" },
          { type: "video", source: { type: "url", url: "https://example.com/motion.mp4" } },
        ],
      }),
    ).toThrow("video role is required by seedance-2-0-fast");
  });
});
