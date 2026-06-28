import { GenerationValidationError } from "./errors.js";
import type {
  GenerationContentBlock,
  GenerationContentSpec,
  GenerationMetaFieldSpec,
  GenerationModelDeclaration,
  GenerationParameterSpec,
} from "./types.js";

function specsByType(specs: GenerationContentSpec[]) {
  const map = new Map<GenerationContentSpec["type"], GenerationContentSpec>();
  for (const spec of specs) map.set(spec.type, spec);
  return map;
}

function getRole(block: GenerationContentBlock): unknown {
  return block.meta?.role;
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

    const role = getRole(block);
    if (spec.roleRequired && (typeof role !== "string" || role.length === 0)) {
      throw new GenerationValidationError(`${block.type} role is required by ${declaration.model}`);
    }
    if (role !== undefined && spec.roles) {
      if (typeof role !== "string" || role.length === 0 || !spec.roles.includes(role)) {
        throw new GenerationValidationError(
          `${block.type} role is not supported by ${declaration.model}: ${String(role)}`,
        );
      }
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
  const allowUnknownParameters = declaration.allowUnknownParameters ?? false;

  for (const key of Object.keys(parameters ?? {})) {
    if (!specs[key]) {
      if (!allowUnknownParameters) throw new GenerationValidationError(`Unknown parameter: ${key}`);
      const value = parameters?.[key];
      if (value !== undefined) resolved[key] = value;
    }
  }

  for (const [key, spec] of Object.entries(specs)) {
    const value = parameters?.[key];
    if (value === undefined) {
      if (spec.default !== undefined) resolved[key] = spec.default;
      else if (!spec.optional) throw new GenerationValidationError(`Missing required parameter: ${key}`);
      continue;
    }

    validateSpecValue(`Parameter ${key}`, spec, value);
    resolved[key] = value;
  }

  return resolved;
}

export function mergeGenerationMeta(
  requestMeta: Record<string, unknown> | undefined,
  content: GenerationContentBlock[],
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  mergeMetaFields(merged, requestMeta);
  for (const block of content) {
    mergeMetaFields(merged, block.meta);
  }
  return merged;
}

function normalizeMetaKey(key: string): string {
  return key === "metadataParams" ? "metadata_params" : key;
}

function mergeMetaFields(target: Record<string, unknown>, meta: Record<string, unknown> | undefined): void {
  for (const [key, value] of Object.entries(meta ?? {})) {
    const normalizedKey = normalizeMetaKey(key);
    if (value !== undefined && target[normalizedKey] === undefined) target[normalizedKey] = value;
  }
}

function validateSpecValue(
  label: string,
  spec: GenerationParameterSpec | GenerationMetaFieldSpec,
  value: unknown,
): void {
  switch (spec.type) {
    case "string":
      if (typeof value !== "string") throw new GenerationValidationError(`${label} must be a string`);
      if (spec.enum && !spec.enum.includes(value))
        throw new GenerationValidationError(`${label} must be one of: ${spec.enum.join(", ")}`);
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value))
        throw new GenerationValidationError(`${label} must be a number`);
      if (spec.min !== undefined && value < spec.min)
        throw new GenerationValidationError(`${label} must be >= ${spec.min}`);
      if (spec.max !== undefined && value > spec.max)
        throw new GenerationValidationError(`${label} must be <= ${spec.max}`);
      break;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value))
        throw new GenerationValidationError(`${label} must be an integer`);
      if (spec.min !== undefined && value < spec.min)
        throw new GenerationValidationError(`${label} must be >= ${spec.min}`);
      if (spec.max !== undefined && value > spec.max)
        throw new GenerationValidationError(`${label} must be <= ${spec.max}`);
      break;
    case "boolean":
      if (typeof value !== "boolean") throw new GenerationValidationError(`${label} must be a boolean`);
      break;
    case "object":
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new GenerationValidationError(`${label} must be an object`);
      break;
  }
}

export function resolveGenerationMeta(
  declaration: GenerationModelDeclaration,
  meta: Record<string, unknown> | undefined,
  content: GenerationContentBlock[],
): Record<string, unknown> {
  const specs = declaration.meta?.fields ?? {};
  const resolved: Record<string, unknown> = {};

  for (const key of Object.keys(meta ?? {})) {
    if (!specs[key]) {
      const value = meta?.[key];
      if (value !== undefined) resolved[key] = value;
    }
  }

  for (const [key, spec] of Object.entries(specs)) {
    const value = meta?.[key];
    if (value === undefined) {
      if (!spec.optional) throw new GenerationValidationError(`Missing required meta: ${key}`);
      continue;
    }
    validateSpecValue(`meta.${key}`, spec, value);
    resolved[key] = value;
  }

  const taskField = declaration.meta?.taskField;
  const task = taskField && typeof resolved[taskField] === "string" ? resolved[taskField] : undefined;
  if (!task) return resolved;

  const variant = declaration.meta?.taskVariants?.[task];
  if (!variant) throw new GenerationValidationError(`Unsupported meta.${taskField}: ${task}`);

  for (const key of variant.required ?? []) {
    if (resolved[key] === undefined || resolved[key] === null || resolved[key] === "") {
      throw new GenerationValidationError(`meta.${taskField} ${task} requires meta.${key}`);
    }
  }

  for (const type of variant.requiredContent ?? []) {
    if (!content.some((block) => block.type === type)) {
      throw new GenerationValidationError(`meta.${taskField} ${task} requires ${type} content`);
    }
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
