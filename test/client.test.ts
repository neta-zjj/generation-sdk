import { describe, expect, it } from "vitest";
import { createGenerationClient } from "../src/index.js";

describe("client", () => {
  it("returns a stable response object from custom adapters", async () => {
    const client = createGenerationClient({
      includeBuiltinModels: false,
      models: [
        {
          schema: "neta.generation.model.v1",
          model: "custom-image",
          adapter: { type: "custom.adapter" },
          content: { input: [{ type: "text", required: true }] },
        },
      ],
      apiKey: "key",
      adapters: {
        "custom.adapter": async () => ({
          content: [{ type: "text", text: "done" }],
          metadata: { provider: "test" },
        }),
      },
    });

    await expect(
      client.generate({
        model: "custom-image",
        content: [{ type: "text", text: "hello" }],
      }),
    ).resolves.toEqual({
      model: "custom-image",
      content: [{ type: "text", text: "done" }],
      metadata: { provider: "test" },
    });
  });
});
