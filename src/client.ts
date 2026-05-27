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
import { createDebugFetch } from "./http.js";
import { defaultGenerationSourceResolver } from "./source.js";
import type {
  CreateGenerationClientOptions,
  GenerateRequest,
  GenerationClient,
  GenerationDebugConfig,
  GenerationModelDeclaration,
} from "./types.js";
import { cloneJson } from "./utils.js";
import { resolveGenerationParameters, validateGenerationContent } from "./validation.js";

const DEFAULT_BASE_URL = "https://router.neta.art";

function redactDebugEvent<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => redactDebugEvent(item)) as T;
  if (!value || typeof value !== "object") return value;

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (/^(authorization|api[-_]?key|token|b64_json|thoughtSignature)$/i.test(key) || key === "data") {
      output[key] = "[REDACTED]";
    } else {
      output[key] = redactDebugEvent(child);
    }
  }
  return output as T;
}

function defaultDebugLogger(event: unknown): void {
  console.error(JSON.stringify(event, null, 2));
}

function resolveDebugConfig(debug: CreateGenerationClientOptions["debug"]): GenerationDebugConfig | undefined {
  if (!debug) return undefined;
  if (debug === true) {
    return {
      enabled: true,
      includeSensitive: false,
      includeResponseBody: true,
      logger: (event) => defaultDebugLogger(redactDebugEvent(event)),
    };
  }
  if (!debug.enabled) return undefined;
  const includeSensitive = debug.includeSensitive ?? false;
  const logger = debug.logger ?? defaultDebugLogger;
  return {
    enabled: true,
    includeSensitive,
    includeResponseBody: debug.includeResponseBody ?? true,
    logger: (event) => logger(includeSensitive ? event : redactDebugEvent(event)),
  };
}

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
  const debug = resolveDebugConfig(options.debug);
  const adapterFetch = debug ? createDebugFetch(fetchFn, debug) : fetchFn;

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
          fetch: adapterFetch,
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
