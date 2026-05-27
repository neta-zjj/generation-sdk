import { getBuiltinGenerationModel, listBuiltinGenerationModels } from "./builtins.js";
import {
  stringifyGenerationModelDeclaration,
  writeGenerationModelDeclaration,
  writeGenerationModelDeclarations,
} from "./config.js";
import { GenerationConfigError } from "./errors.js";

export function stringifyBuiltinModelConfig(model: string, options: { format?: "yaml" | "json" } = {}): string {
  const declaration = getBuiltinGenerationModel(model);
  if (!declaration) throw new GenerationConfigError(`Built-in model is unavailable: ${model}`);
  return stringifyGenerationModelDeclaration(declaration, options);
}

export async function exportBuiltinModelConfig(model: string, filePath: string): Promise<void> {
  const declaration = getBuiltinGenerationModel(model);
  if (!declaration) throw new GenerationConfigError(`Built-in model is unavailable: ${model}`);
  await writeGenerationModelDeclaration(declaration, filePath);
}

export async function exportBuiltinModelConfigs(directory: string): Promise<void> {
  await writeGenerationModelDeclarations(listBuiltinGenerationModels(), directory);
}
