import { describe, expect, it } from "vitest";
import {
  createGenerationClient,
  parseGenerationModelDeclaration,
  stringifyBuiltinModelConfig,
  stringifyGenerationModelDeclaration,
} from "../src/index.js";

function builtinDeclarationJson(): Record<string, unknown> {
  return JSON.parse(stringifyBuiltinModelConfig("gpt-image-2", { format: "json" })) as Record<string, unknown>;
}

describe("model visibility", () => {
  it.each([true, false])("roundtrips hidden: %s", (hidden) => {
    const declaration = parseGenerationModelDeclaration(
      JSON.stringify({ ...builtinDeclarationJson(), hidden }),
      "gpt-image-2.json",
    );

    expect(declaration.hidden).toBe(hidden);
    expect(
      parseGenerationModelDeclaration(stringifyGenerationModelDeclaration(declaration), "gpt-image-2.yaml").hidden,
    ).toBe(hidden);
  });

  it("leaves hidden unset by default", () => {
    expect(
      parseGenerationModelDeclaration(JSON.stringify(builtinDeclarationJson()), "gpt-image-2.json").hidden,
    ).toBeUndefined();
  });

  it.each(["true", 1, null])("rejects invalid hidden value: %j", (hidden) => {
    expect(() =>
      parseGenerationModelDeclaration(JSON.stringify({ ...builtinDeclarationJson(), hidden }), "gpt-image-2.json"),
    ).toThrow("Invalid model declaration: gpt-image-2.json");
  });

  it("keeps hidden models available by exact ID", () => {
    const source = createGenerationClient().getModel("gpt-image-2");
    if (!source) throw new Error("gpt-image-2 is unavailable");

    const hiddenModel = { ...source, model: "hidden-image-model", hidden: true };
    const client = createGenerationClient({ models: [hiddenModel], includeBuiltinModels: false });

    expect(client.listModels()).toEqual([hiddenModel]);
    expect(client.getModel(hiddenModel.model)).toEqual(hiddenModel);
    expect(
      client.validate({
        model: hiddenModel.model,
        content: [{ type: "text", text: "a small red toy robot" }],
      }).declaration.hidden,
    ).toBe(true);
  });
});
