import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createGenerationClient,
  exportBuiltinModelConfig,
  parseGenerationModelDeclaration,
  stringifyBuiltinModelConfig,
} from "../src/index.js";

describe("config", () => {
  it("roundtrips a built-in model declaration", () => {
    const raw = stringifyBuiltinModelConfig("gpt-image-2");
    const declaration = parseGenerationModelDeclaration(raw, "gpt-image-2.yaml");
    expect(declaration.schema).toBe("neta.generation.model.v1");
    expect(declaration.model).toBe("gpt-image-2");
  });

  it("roundtrips built-in model meta declarations", () => {
    const raw = stringifyBuiltinModelConfig("suno_music");
    const declaration = parseGenerationModelDeclaration(raw, "suno_music.yaml");
    expect(declaration.meta?.taskField).toBe("task");
    expect(declaration.meta?.taskVariants?.remaster).toMatchObject({
      sendTask: false,
      required: ["clip_id", "model_name", "variation_category"],
    });
    expect(declaration.meta?.taskVariants?.image_to_song).toMatchObject({
      requiredContent: ["image"],
      required: ["metadata_params"],
    });
  });

  it("validates every built-in model example", () => {
    const client = createGenerationClient({ apiKey: "test" });
    for (const model of client.listModels()) {
      for (const example of model.examples ?? []) {
        expect(() => client.validate(example.request), `${model.model}: ${example.title ?? "example"}`).not.toThrow();
      }
    }
  });

  it("exports model declarations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "generation-"));
    try {
      const file = join(dir, "gpt-image-2.yaml");
      await exportBuiltinModelConfig("gpt-image-2", file);
      const client = createGenerationClient({ apiKey: "test" });
      expect(client.stringifyModelConfig("gpt-image-2")).toContain("schema: neta.generation.model.v1");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
