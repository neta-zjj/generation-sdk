import { GenerationValidationError } from "./errors.js";
import type { GenerationContentBlock, GenerationContentSpec, GenerationModelDeclaration } from "./types.js";

function specsByType(specs: GenerationContentSpec[]) {
  const map = new Map<GenerationContentSpec["type"], GenerationContentSpec>();
  for (const spec of specs) map.set(spec.type, spec);
  return map;
}

export function validateGenerationContent(
  declaration: GenerationModelDeclaration,
  content: GenerationContentBlock[],
): void {
  const inputSpecs = specsByType(declaration.content.input);
  const counts = new Map<GenerationContentSpec["type"], number>();

  for (const block of content) {
    const spec = inputSpecs.get(block.type);
    if (!spec)
      throw new GenerationValidationError(`Content block type is not supported by ${declaration.model}: ${block.type}`);
    counts.set(block.type, (counts.get(block.type) ?? 0) + 1);

    if ("source" in block && spec.sources && !spec.sources.includes(block.source.type)) {
      throw new GenerationValidationError(
        `${block.type} source is not supported by ${declaration.model}: ${block.source.type}`,
      );
    }
  }

  for (const spec of declaration.content.input) {
    const count = counts.get(spec.type) ?? 0;
    if (spec.required && count === 0)
      throw new GenerationValidationError(`Missing required ${spec.type} content block`);
    if (spec.min !== undefined && count < spec.min)
      throw new GenerationValidationError(`Expected at least ${spec.min} ${spec.type} content block(s)`);
    if (spec.max !== undefined && count > spec.max)
      throw new GenerationValidationError(`Expected at most ${spec.max} ${spec.type} content block(s)`);
  }
}

export function resolveGenerationParameters(
  declaration: GenerationModelDeclaration,
  parameters: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const specs = declaration.parameters ?? {};
  const resolved: Record<string, unknown> = {};

  for (const key of Object.keys(parameters ?? {})) {
    if (!specs[key]) throw new GenerationValidationError(`Unknown parameter: ${key}`);
  }

  for (const [key, spec] of Object.entries(specs)) {
    const value = parameters?.[key];
    if (value === undefined) {
      if (spec.default !== undefined) resolved[key] = spec.default;
      else if (!spec.optional) throw new GenerationValidationError(`Missing required parameter: ${key}`);
      continue;
    }

    switch (spec.type) {
      case "string":
        if (typeof value !== "string") throw new GenerationValidationError(`Parameter ${key} must be a string`);
        if (spec.enum && !spec.enum.includes(value))
          throw new GenerationValidationError(`Parameter ${key} must be one of: ${spec.enum.join(", ")}`);
        break;
      case "number":
        if (typeof value !== "number" || !Number.isFinite(value))
          throw new GenerationValidationError(`Parameter ${key} must be a number`);
        if (spec.min !== undefined && value < spec.min)
          throw new GenerationValidationError(`Parameter ${key} must be >= ${spec.min}`);
        if (spec.max !== undefined && value > spec.max)
          throw new GenerationValidationError(`Parameter ${key} must be <= ${spec.max}`);
        break;
      case "integer":
        if (typeof value !== "number" || !Number.isInteger(value))
          throw new GenerationValidationError(`Parameter ${key} must be an integer`);
        if (spec.min !== undefined && value < spec.min)
          throw new GenerationValidationError(`Parameter ${key} must be >= ${spec.min}`);
        if (spec.max !== undefined && value > spec.max)
          throw new GenerationValidationError(`Parameter ${key} must be <= ${spec.max}`);
        break;
      case "boolean":
        if (typeof value !== "boolean") throw new GenerationValidationError(`Parameter ${key} must be a boolean`);
        break;
    }
    resolved[key] = value;
  }

  return resolved;
}

export function mergeTextBlocks(declaration: GenerationModelDeclaration, content: GenerationContentBlock[]): string {
  const textSpec = declaration.content.input.find((spec) => spec.type === "text");
  const separator = textSpec?.merge === "space" ? " " : textSpec?.merge === "concat" ? "" : "\n";
  return content
    .filter((block): block is Extract<GenerationContentBlock, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join(separator)
    .trim();
}
