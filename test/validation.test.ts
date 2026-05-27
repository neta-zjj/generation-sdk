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
});
