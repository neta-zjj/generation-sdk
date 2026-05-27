import { getGenerationAdapter } from "./adapters/index.js";
import { builtinGenerationModels } from "./builtins.js";
import {
  readGenerationModelDeclarationsFromDirectory,
  readGenerationModelDeclarationsFromFiles,
  stringifyGenerationModelDeclaration,
  writeGenerationModelDeclaration,
  writeGenerationModelDeclarations,
} from "./config.js";
import { GenerationConfigError } from "./errors.js";
import { defaultGenerationSourceResolver } from "./source.js";
import type {
  CreateGenerationClientOptions,
  GenerateRequest,
  GenerationClient,
  GenerationModelDeclaration,
} from "./types.js";
import { cloneJson } from "./utils.js";
import { resolveGenerationParameters, validateGenerationContent } from "./validation.js";

const DEFAULT_BASE_URL = "https://router.neta.art";

function resolveModels(options: CreateGenerationClientOptions): GenerationModelDeclaration[] {
  const includeBuiltinModels = options.includeBuiltinModels ?? !options.models;
  const models = [...(includeBuiltinModels ? builtinGenerationModels : []), ...(options.models ?? [])];
  const byModel = new Map<string, GenerationModelDeclaration>();
  for (const model of models) byModel.set(model.model, cloneJson(model));
  return [...byModel.values()].sort((a, b) => a.model.localeCompare(b.model));
}

export function createGenerationClient(options: CreateGenerationClientOptions = {}): GenerationClient {
  const models = resolveModels(options);
  const byModel = new Map(models.map((declaration) => [declaration.model, declaration]));
  const fetchFn = options.fetch ?? globalThis.fetch;
  if (!fetchFn) throw new GenerationConfigError("A fetch implementation is required");

  function requireModel(model: string): GenerationModelDeclaration {
    const declaration = byModel.get(model);
    if (!declaration) throw new GenerationConfigError(`Generation model is unavailable: ${model}`);
    return declaration;
  }

  return {
    validate(request: GenerateRequest) {
      const declaration = requireModel(request.model);
      validateGenerationContent(declaration, request.content);
      const parameters = resolveGenerationParameters(declaration, request.parameters);
      return { declaration: cloneJson(declaration), request: cloneJson(request), parameters };
    },

    async generate(request: GenerateRequest) {
      const resolved = this.validate(request);
      const apiKey = request.apiKey ?? options.apiKey;
      if (!apiKey) throw new GenerationConfigError("apiKey is required");
      const adapter = getGenerationAdapter(resolved.declaration.adapter.type, options.adapters);
      return adapter({
        ...resolved,
        context: {
          apiKey,
          baseUrl: request.baseUrl ?? options.baseUrl ?? DEFAULT_BASE_URL,
          fetch: fetchFn,
          resolveSource: options.sourceResolver ?? defaultGenerationSourceResolver,
        },
      });
    },

    listModels() {
      return cloneJson(models);
    },

    getModel(model: string) {
      const declaration = byModel.get(model);
      return declaration ? cloneJson(declaration) : null;
    },

    stringifyModelConfig(model: string, stringifyOptions = {}) {
      return stringifyGenerationModelDeclaration(requireModel(model), stringifyOptions);
    },

    exportModelConfig(model: string, filePath: string) {
      return writeGenerationModelDeclaration(requireModel(model), filePath);
    },

    exportModelConfigs(directory: string) {
      return writeGenerationModelDeclarations(models, directory);
    },
  };
}

export async function createGenerationClientFromFiles(
  filePaths: string[],
  options: Omit<CreateGenerationClientOptions, "models"> = {},
): Promise<GenerationClient> {
  const models = await readGenerationModelDeclarationsFromFiles(filePaths);
  return createGenerationClient({ ...options, models, includeBuiltinModels: options.includeBuiltinModels ?? true });
}

export async function createGenerationClientFromDirectory(
  directory: string,
  options: Omit<CreateGenerationClientOptions, "models"> = {},
): Promise<GenerationClient> {
  const models = await readGenerationModelDeclarationsFromDirectory(directory);
  return createGenerationClient({ ...options, models, includeBuiltinModels: options.includeBuiltinModels ?? true });
}

export async function createGenerationClientFromFile(
  filePath: string,
  options: Omit<CreateGenerationClientOptions, "models"> = {},
): Promise<GenerationClient> {
  return createGenerationClientFromFiles([filePath], options);
}
