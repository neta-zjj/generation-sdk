import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createGenerationClient,
  exportBuiltinModelConfig,
  parseGenerationModelDeclaration,
  readGenerationModelDeclarationsFromDirectory,
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
    const raw = stringifyBuiltinModelConfig("suno_image_to_song_chirp_v5");
    const declaration = parseGenerationModelDeclaration(raw, "suno_image_to_song_chirp_v5.yaml");
    expect(declaration.adapter).toMatchObject({
      operation: "music",
      task: "image_to_song",
      payload: { mv: "chirp-v5" },
    });
    expect(declaration.meta?.taskVariants?.image_to_song).toMatchObject({
      requiredContent: ["image"],
      required: ["metadata_params"],
    });
  });

  it("does not expose the removed legacy Suno model", () => {
    const client = createGenerationClient({ apiKey: "test" });
    expect(client.getModel("suno_music")).toBeNull();
    expect(() =>
      client.validate({
        model: "suno_music",
        content: [{ type: "text", text: "warm piano" }],
      }),
    ).toThrow("Generation model is unavailable: suno_music");
    expect(() => client.stringifyModelConfig("suno_music")).toThrow("Generation model is unavailable: suno_music");
  });

  it("keeps infrastructure names out of model descriptions", () => {
    const client = createGenerationClient({ apiKey: "test" });
    for (const model of client.listModels()) {
      expect(model.description, model.model).not.toMatch(/\b(?:router|new[ -]?api)\b/i);
    }
  });

  it("does not advertise base64 input sources", () => {
    const client = createGenerationClient({ apiKey: "test" });
    for (const model of client.listModels()) {
      for (const input of model.content.input) {
        expect(input.sources ?? [], `${model.model}: ${input.type}`).not.toContain("base64");
      }
    }
  });

  it("keeps krea2 text-only", () => {
    const client = createGenerationClient({ apiKey: "test" });
    expect(client.getModel("krea2")?.content.input.map((input) => input.type)).toEqual(["text"]);
    expect(() =>
      client.validate({
        model: "krea2",
        content: [
          { type: "text", text: "an editorial portrait" },
          { type: "image", source: { type: "url", url: "https://example.com/reference.png" } },
        ],
      }),
    ).toThrow("Content block type is not supported by krea2: image");
  });

  it("accepts an ignored BiRefNet workflow prompt", () => {
    const client = createGenerationClient({ apiKey: "test" });
    const image = { type: "image" as const, source: { type: "url" as const, url: "https://example.com/source.png" } };

    expect(client.getModel("birefnet-general")?.content.input.map((input) => input.type)).toEqual(["text", "image"]);
    expect(() => client.validate({ model: "birefnet-general", content: [image] })).not.toThrow();
    expect(() =>
      client.validate({
        model: "birefnet-general",
        content: [{ type: "text", text: "remove the background" }, image],
      }),
    ).not.toThrow();
  });

  it("enforces valid krea2 image sizes", () => {
    const client = createGenerationClient({ apiKey: "test" });
    const size = client.getModel("krea2")?.parameters?.size;
    if (!size || size.type !== "string") throw new Error("krea2 size parameter is unavailable");
    expect(size.dimensions).toEqual({ min: 256, max: 1024, multipleOf: 16 });

    for (const value of [size.default, ...(size.examples ?? [])]) {
      const resolved = client.validate({
        model: "krea2",
        content: [{ type: "text", text: "an editorial portrait" }],
        parameters: { size: value },
      });
      expect(resolved.parameters.size).toBe(value);
    }

    const requestWithSize = (value: string) => ({
      model: "krea2",
      content: [{ type: "text" as const, text: "an editorial portrait" }],
      parameters: { size: value },
    });
    expect(() => client.validate(requestWithSize("1024"))).toThrow("Parameter size must be formatted as WIDTHxHEIGHT");
    expect(() => client.validate(requestWithSize("240x1024"))).toThrow("Parameter size dimensions must be >= 256");
    expect(() => client.validate(requestWithSize("1040x1024"))).toThrow("Parameter size dimensions must be <= 1024");
    expect(() => client.validate(requestWithSize("1000x1024"))).toThrow(
      "Parameter size dimensions must be multiples of 16",
    );
  });

  it("does not expose unsupported krea2 quality settings", () => {
    const client = createGenerationClient({ apiKey: "test" });
    expect(client.getModel("krea2")?.parameters).not.toHaveProperty("quality");
    expect(() =>
      client.validate({
        model: "krea2",
        content: [{ type: "text", text: "an editorial portrait" }],
        parameters: { quality: "high" },
      }),
    ).toThrow("Unknown parameter: quality");
  });

  it("keeps Gemini Lite output fixed at 1K", () => {
    const client = createGenerationClient({ apiKey: "test" });
    const lite = client.getModel("gemini-3.1-flash-lite-image");
    const preview = client.getModel("gemini-3.1-flash-image-preview");

    expect(lite?.parameters).not.toHaveProperty("image_size");
    expect(preview?.parameters?.image_size).toMatchObject({
      default: "2K",
      enum: ["512", "1K", "2K", "4K"],
    });
    expect(() =>
      client.validate({
        model: "gemini-3.1-flash-lite-image",
        content: [{ type: "text", text: "a product photo" }],
        parameters: { image_size: "2K" },
      }),
    ).toThrow("Unknown parameter: image_size");
  });

  it("publishes the supported NoobXL image sizes", () => {
    const client = createGenerationClient({ apiKey: "test" });
    const expected = ["1024x1024", "896x1152", "1152x896", "1344x768", "768x1344"];

    for (const model of ["noobxl-t2i-onediff", "noobxl-i2i-ipa-onediff"]) {
      const size = client.getModel(model)?.parameters?.size;
      expect(size, model).toMatchObject({ type: "string", default: "1024x1024", enum: expected });
    }
  });

  it("validates every built-in model example", () => {
    const client = createGenerationClient({ apiKey: "test" });
    for (const model of client.listModels()) {
      for (const example of model.examples ?? []) {
        expect(() => client.validate(example.request), `${model.model}: ${example.title ?? "example"}`).not.toThrow();
      }
    }
  });

  it("parses published model declaration files", async () => {
    const declarations = await readGenerationModelDeclarationsFromDirectory(join(process.cwd(), "models"));
    const client = createGenerationClient({ apiKey: "test" });

    expect(declarations).toEqual(client.listModels());

    expect(declarations.map((declaration) => declaration.model).sort()).toEqual(
      client
        .listModels()
        .map((model) => model.model)
        .sort(),
    );
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
