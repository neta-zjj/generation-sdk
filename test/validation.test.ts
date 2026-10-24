import { describe, expect, it } from "vitest";
import {
  createGenerationClient,
  type GenerateRequest,
  type GenerationAdapter,
  type GenerationAdapterInput,
  GenerationConfigError,
  type GenerationModelDeclaration,
  GenerationUnsupportedAdapterError,
  GenerationValidationError,
  MODEL_SCHEMA,
} from "../src/index.js";

const textBlock = { type: "text" as const, text: "a fox" };
const imageBlock = { type: "image" as const, source: { type: "url" as const, url: "https://example.com/fox.png" } };

describe("validation", () => {
  it("resolves default parameters", () => {
    const client = createGenerationClient({ apiKey: "test" });
    const resolved = client.validate({
      model: "gpt-image-2",
      content: [{ type: "text", text: "hello" }],
    });
    expect(resolved.parameters).toEqual({ size: "1024x1024", quality: "auto" });
  });

  it("accepts GPT image transparent background parameters", () => {
    const client = createGenerationClient({ apiKey: "test" });
    const resolved = client.validate({
      model: "gpt-image-2",
      content: [{ type: "text", text: "a ceramic cup" }],
      parameters: { background: "transparent", output_format: "png" },
    });
    expect(resolved.parameters).toEqual({
      size: "1024x1024",
      quality: "auto",
      background: "transparent",
      output_format: "png",
    });
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

  it("rejects missing required audio roles for Seedance", () => {
    const client = createGenerationClient({ apiKey: "test" });
    expect(() =>
      client.validate({
        model: "seedance-2-0-fast",
        content: [
          { type: "text", text: "use this soundtrack" },
          {
            type: "image",
            source: { type: "url", url: "https://example.com/subject.jpg" },
            meta: { role: "reference_image" },
          },
          { type: "audio", source: { type: "url", url: "https://example.com/reference.mp3" } },
        ],
      }),
    ).toThrow("audio role is required by seedance-2-0-fast");
  });

  it("validates array items and stepped numbers, and copies array defaults", () => {
    const model: GenerationModelDeclaration = {
      ...customModel("custom.arrays"),
      parameters: {
        formats: {
          type: "array",
          optional: true,
          default: ["glb"],
          items: { type: "string", enum: ["glb", "fbx"] },
          min: 1,
          max: 2,
          unique: true,
        },
        ids: { type: "array", optional: true, items: { type: "integer", min: 0, max: 9 } },
        duration: { type: "number", optional: true, min: 2, max: 10, multipleOf: 0.5 },
      },
    };
    const client = createGenerationClient({ apiKey: "test", models: [model], includeBuiltinModels: false });
    const validate = (parameters: Record<string, unknown>) =>
      client.validate({ model: model.model, content: [{ type: "text", text: "hello" }], parameters });

    const first = validate({});
    expect(first.parameters).toEqual({ formats: ["glb"] });
    (first.parameters.formats as string[]).push("fbx");
    expect(validate({}).parameters).toEqual({ formats: ["glb"] });
    expect(client.getModel(model.model)?.parameters?.formats?.default).toEqual(["glb"]);
    expect(validate({ formats: ["fbx", "glb"], ids: [0, 9], duration: 2.5 }).parameters).toEqual({
      formats: ["fbx", "glb"],
      ids: [0, 9],
      duration: 2.5,
    });

    for (const [parameters, message] of [
      [{ formats: "glb" }, "Parameter formats must be an array"],
      [{ formats: [] }, "Parameter formats must contain at least 1 item(s)"],
      [{ formats: ["glb", "fbx", "glb"] }, "Parameter formats must contain at most 2 item(s)"],
      [{ formats: ["glb", "glb"] }, "Parameter formats must not contain duplicate items"],
      [{ formats: ["obj"] }, "Parameter formats[0] must be one of: glb, fbx"],
      [{ ids: [1, "2"] }, "Parameter ids[1] must be an integer"],
      [{ ids: [10] }, "Parameter ids[0] must be <= 9"],
      [{ duration: 2.25 }, "Parameter duration must be a multiple of 0.5"],
      [{ duration: 1.5 }, "Parameter duration must be >= 2"],
    ] as const) {
      expect(() => validate(parameters), message).toThrow(message);
    }
  });

  it("treats null object parameters as off and rejects wrong object shapes", () => {
    const model: GenerationModelDeclaration = {
      ...customModel("custom.objects"),
      parameters: { extra: { type: "object", optional: true } },
    };
    const client = createGenerationClient({ apiKey: "test", models: [model], includeBuiltinModels: false });
    const validate = (parameters: Record<string, unknown>) =>
      client.validate({ model: model.model, content: [{ type: "text", text: "hello" }], parameters });

    expect(validate({ extra: null }).parameters).toEqual({});
    expect(validate({ extra: {} }).parameters).toEqual({ extra: {} });
    expect(() => validate({ extra: [] })).toThrow("Parameter extra must be an object");
    expect(() => validate({ extra: "x" })).toThrow("Parameter extra must be an object");
  });

  it("validates a request against the model and the operation that parameters.operation selects", async () => {
    const model = operationsModel("custom.operations");
    const received: GenerationAdapterInput[] = [];
    const adapter: GenerationAdapter = async (input) => {
      received.push(input);
      return [];
    };
    const client = createGenerationClient({
      apiKey: "test",
      models: [model],
      includeBuiltinModels: false,
      adapters: { "custom.adapter": adapter },
    });
    const validate = (content: GenerationAdapterInput["request"]["content"], parameters?: Record<string, unknown>) =>
      client.validate({ model: model.model, content, ...(parameters ? { parameters } : {}) });

    const draw = validate([textBlock], { operation: "draw", size: "1024x1024" });
    expect(draw.parameters).toEqual({ operation: "draw", seed: 7, size: "1024x1024" });
    expect(draw.declaration).toEqual({
      schema: MODEL_SCHEMA,
      model: model.model,
      category: "image",
      adapter: { type: "custom.adapter" },
      content: { input: [{ type: "text", required: true, min: 1, max: 1 }] },
      parameters: { ...model.parameters, size: { type: "string" } },
    });
    expect(validate([textBlock, imageBlock], { operation: "edit" }).declaration.content.input).toEqual([
      { type: "text", required: true, min: 1, max: 1 },
      { type: "image", required: true, min: 1, max: 1 },
    ]);
    expect(client.getModel(model.model)).toEqual(model);

    await client.generate({ model: model.model, content: [textBlock, imageBlock], parameters: { operation: "edit" } });
    expect(received.map((input) => [input.parameters, Object.keys(input.declaration.parameters ?? {})])).toEqual([
      [{ operation: "edit", seed: 7 }, ["operation", "seed"]],
    ]);

    for (const [content, parameters, message] of [
      [[textBlock], undefined, "Missing required parameter: operation"],
      [[textBlock], { operation: null }, "Parameter operation must be a string"],
      [[textBlock], { operation: "erase" }, "Parameter operation must be one of: draw, edit"],
      [[textBlock], { operation: "draw" }, "Missing required parameter: size"],
      [[textBlock, imageBlock], { operation: "edit", size: "1024x1024" }, "Unknown parameter: size"],
      [[textBlock, imageBlock], { operation: "draw", size: "1024x1024" }, "Content block type is not supported"],
      [[textBlock], { operation: "edit" }, "Missing required image content block"],
    ] as const) {
      expect(() => validate([...content], parameters), message).toThrow(GenerationValidationError);
      expect(() => validate([...content], parameters), message).toThrow(message);
    }
  });

  it("uses the operation parameter default and fails fast on operations that the declaration cannot select", () => {
    const model = operationsModel("custom.default-operation");
    const withDefault: GenerationModelDeclaration = {
      ...model,
      parameters: { ...model.parameters, operation: { type: "string", enum: ["draw", "edit"], default: "edit" } },
    };
    const withoutSelector: GenerationModelDeclaration = {
      ...model,
      model: "custom.no-selector",
      parameters: { seed: { type: "integer", default: 7 } },
    };
    const unknownOperation: GenerationModelDeclaration = {
      ...model,
      model: "custom.unknown-operation",
      parameters: { ...model.parameters, operation: { type: "string", enum: ["draw", "edit", "erase"] } },
    };
    const client = createGenerationClient({
      apiKey: "test",
      models: [withDefault, withoutSelector, unknownOperation],
      includeBuiltinModels: false,
    });

    expect(client.validate({ model: model.model, content: [textBlock, imageBlock] }).parameters).toEqual({
      operation: "edit",
      seed: 7,
    });
    const cases: Array<[GenerateRequest, string]> = [
      [
        { model: withoutSelector.model, content: [textBlock] },
        "custom.no-selector declares operations without an operation parameter",
      ],
      [
        { model: unknownOperation.model, content: [textBlock], parameters: { operation: "erase" } },
        "custom.unknown-operation does not declare operation erase",
      ],
    ];
    for (const [request, message] of cases) {
      expect(() => client.validate(request), message).toThrow(GenerationConfigError);
      expect(() => client.validate(request), message).toThrow(message);
    }
  });

  it("runs a custom adapter validation hook exactly once per validate or generate call", async () => {
    let validationCalls = 0;
    let adapterCalls = 0;
    const adapter: GenerationAdapter = Object.assign(
      async () => {
        adapterCalls += 1;
        return [];
      },
      {
        validate: () => {
          validationCalls += 1;
        },
      },
    );
    const model = customModel("custom.validated");
    const client = createGenerationClient({
      apiKey: "test",
      models: [model],
      includeBuiltinModels: false,
      adapters: { "custom.adapter": adapter },
    });
    const request = { model: model.model, content: [{ type: "text" as const, text: "hello" }] };

    client.validate(request);
    expect(validationCalls).toBe(1);
    expect(adapterCalls).toBe(0);

    validationCalls = 0;
    await client.generate(request);
    expect(validationCalls).toBe(1);
    expect(adapterCalls).toBe(1);
  });

  it("keeps a body request ID ahead of later header fallbacks across multiple fetches", async () => {
    const model = customModel("custom.multi-fetch");
    const responses = [
      new Response(JSON.stringify({ request_id: "body-request" }), {
        headers: { "content-type": "application/json", "x-request-id": "first-header" },
      }),
      new Response("ok", { headers: { "content-type": "text/plain", "x-request-id": "later-header" } }),
    ];
    const fetchMock = async () => responses.shift() as Response;
    const adapter: GenerationAdapter = async (input) => {
      await input.context.fetch("https://example.com/first");
      await input.context.fetch("https://example.com/second");
      return [];
    };
    const client = createGenerationClient({
      apiKey: "test",
      fetch: fetchMock as typeof fetch,
      models: [model],
      includeBuiltinModels: false,
      adapters: { "custom.adapter": adapter },
    });

    await expect(
      client.generateResult({ model: model.model, content: [{ type: "text", text: "hello" }] }),
    ).resolves.toMatchObject({ requestId: "body-request" });
  });

  it("keeps x-request-id ahead of a later x-oneapi-request-id across multiple fetches", async () => {
    const model = customModel("custom.multi-header-fetch");
    const responses = [
      new Response("first", { headers: { "x-request-id": "primary-header" } }),
      new Response("second", { headers: { "x-oneapi-request-id": "later-fallback-header" } }),
    ];
    const fetchMock = async () => responses.shift() as Response;
    const adapter: GenerationAdapter = async (input) => {
      await input.context.fetch("https://example.com/first");
      await input.context.fetch("https://example.com/second");
      return [];
    };
    const client = createGenerationClient({
      apiKey: "test",
      fetch: fetchMock as typeof fetch,
      models: [model],
      includeBuiltinModels: false,
      adapters: { "custom.adapter": adapter },
    });

    await expect(
      client.generateResult({ model: model.model, content: [{ type: "text", text: "hello" }] }),
    ).resolves.toMatchObject({ requestId: "primary-header" });
  });

  it("keeps custom adapters without hooks compatible", async () => {
    const model = customModel("custom.no-hook");
    const adapter: GenerationAdapter = async () => [];
    const client = createGenerationClient({
      apiKey: "test",
      models: [model],
      includeBuiltinModels: false,
      adapters: { "custom.adapter": adapter },
    });
    const request = { model: model.model, content: [{ type: "text" as const, text: "hello" }] };

    expect(() => client.validate(request)).not.toThrow();
    await expect(client.generate(request)).resolves.toEqual([]);
  });

  it("keeps validation non-throwing for an unregistered custom adapter", async () => {
    const model = customModel("custom.unregistered");
    const client = createGenerationClient({
      apiKey: "test",
      models: [model],
      includeBuiltinModels: false,
    });
    const request = { model: model.model, content: [{ type: "text" as const, text: "hello" }] };

    expect(() => client.validate(request)).not.toThrow();
    await expect(client.generate(request)).rejects.toBeInstanceOf(GenerationUnsupportedAdapterError);
  });

  it("does not expose the internal adapter validation lookup", async () => {
    const packageExports = await import("../src/index.js");
    expect(packageExports).not.toHaveProperty("tryGetGenerationAdapter");
  });
});

function customModel(model: string): GenerationModelDeclaration {
  return {
    schema: MODEL_SCHEMA,
    model,
    category: "image",
    adapter: { type: "custom.adapter" },
    content: {
      input: [{ type: "text", required: true, min: 1, max: 1 }],
    },
  };
}

function operationsModel(model: string): GenerationModelDeclaration {
  return {
    ...customModel(model),
    parameters: {
      operation: { type: "string", enum: ["draw", "edit"] },
      seed: { type: "integer", default: 7 },
    },
    operations: {
      draw: { title: "Draw", parameters: { size: { type: "string" } } },
      edit: { content: { input: [{ type: "image", required: true, min: 1, max: 1 }] } },
    },
  };
}
