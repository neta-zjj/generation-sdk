import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createGenerationClient,
  exportBuiltinModelConfig,
  listBuiltinGenerationModels,
  parseGenerationModelDeclaration,
  readGenerationModelDeclaration,
  stringifyBuiltinModelConfig,
} from "../src/index.js";

describe("config", () => {
  it("roundtrips a built-in model declaration", () => {
    const raw = stringifyBuiltinModelConfig("gpt-image-2");
    const declaration = parseGenerationModelDeclaration(raw, "gpt-image-2.yaml");
    expect(declaration.schema).toBe("neta.generation.model.v1");
    expect(declaration.model).toBe("gpt-image-2");
  });

  it("exports model declarations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "generation-"));
    try {
      const file = join(dir, "nested", "gpt-image-2.yaml");
      await exportBuiltinModelConfig("gpt-image-2", file);
      const client = createGenerationClient({ apiKey: "test" });
      expect(client.stringifyModelConfig("gpt-image-2")).toContain("schema: neta.generation.model.v1");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps built-in declarations and bundled yaml files in sync", async () => {
    for (const builtin of listBuiltinGenerationModels()) {
      const fromFile = await readGenerationModelDeclaration(join(process.cwd(), "models", `${builtin.model}.yaml`));
      expect(fromFile).toEqual(builtin);
    }
  });

  it("rejects malformed content specs while parsing declarations", () => {
    expect(() =>
      parseGenerationModelDeclaration(
        `
schema: neta.generation.model.v1
model: broken
adapter:
  type: openai.images
content:
  input:
    - type: nonsense
`,
        "broken.yaml",
      ),
    ).toThrow("Invalid model declaration: broken.yaml");
  });
});
