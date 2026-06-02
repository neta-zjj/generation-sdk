#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { listBuiltinGenerationModels } from "../builtins.js";
import { createGenerationClient } from "../client.js";
import { stringifyGenerationModelDeclaration } from "../config.js";
import { exportBuiltinModelConfig, exportBuiltinModelConfigs } from "../export-config.js";
import type { GenerationContentBlock } from "../types.js";

function usage(): never {
  console.log(`neta-generation

Usage:
  neta-generation generate <model> --prompt <text> [--param key=value] [--image-url <url>] [--out <directory>] [--debug] [--debug-sensitive] [--no-debug-response-body]
  neta-generation models list
  neta-generation models export <model> --out <file>
  neta-generation models export-all --out <directory>

Environment:
  NETA_ROUTER_API_KEY  API key used by generate
`);
  process.exit(1);
}

function readOption(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) return null;
  return args[index + 1] ?? null;
}

function readOptions(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index + 1];
    if (args[index] === name && value) values.push(value);
  }
  return values;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function parseParameterValue(raw: string): unknown {
  if (raw.startsWith("json:")) return JSON.parse(raw.slice(5));
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}

function parseParameter(value: string): [string, unknown] {
  const separator = value.indexOf("=");
  if (separator <= 0) throw new Error(`Invalid --param value: ${value}`);
  return [value.slice(0, separator), parseParameterValue(value.slice(separator + 1))];
}

function outputSummary(block: GenerationContentBlock): unknown {
  if (block.type === "text") return block;
  return {
    type: block.type,
    source:
      block.source.type === "url"
        ? block.source
        : {
            type: "base64",
            mediaType: block.source.mediaType,
            bytes: Buffer.byteLength(block.source.data, "base64"),
          },
    meta: block.meta,
  };
}

async function writeOutputFiles(directory: string, output: GenerationContentBlock[]): Promise<void> {
  await mkdir(directory, { recursive: true });
  await Promise.all(
    output.map(async (block, index) => {
      if (
        (block.type !== "image" && block.type !== "video" && block.type !== "audio") ||
        block.source.type !== "base64"
      ) {
        return;
      }
      const extension = block.source.mediaType.split("/")[1]?.split("+")[0] || block.type;
      await writeFile(
        join(directory, `${String(index + 1).padStart(2, "0")}.${extension}`),
        Buffer.from(block.source.data, "base64"),
      );
    }),
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "generate") {
    const model = args[1];
    const prompt = readOption(args, "--prompt");
    const apiKey = process.env.NETA_ROUTER_API_KEY;
    if (!model || !prompt || !apiKey) usage();

    const outputDirectory = readOption(args, "--out");
    const content: GenerationContentBlock[] = [
      { type: "text", text: prompt },
      ...readOptions(args, "--image-url").map((url) => ({
        type: "image" as const,
        source: { type: "url" as const, url },
      })),
    ];
    const parameters = Object.fromEntries(readOptions(args, "--param").map(parseParameter));
    const baseUrl = readOption(args, "--base-url");
    const debug = hasFlag(args, "--debug")
      ? {
          enabled: true,
          includeSensitive: hasFlag(args, "--debug-sensitive"),
          includeResponseBody: !hasFlag(args, "--no-debug-response-body"),
        }
      : undefined;
    const client = createGenerationClient({
      apiKey,
      ...(baseUrl ? { baseUrl } : {}),
      ...(debug ? { debug } : {}),
    });
    const response = await client.generate({ model, content, parameters });
    if (outputDirectory) await writeOutputFiles(outputDirectory, response.content);
    console.log(JSON.stringify({ ...response, content: response.content.map(outputSummary) }, null, 2));
    return;
  }

  if (args[0] !== "models") usage();

  switch (args[1]) {
    case "list": {
      for (const model of listBuiltinGenerationModels()) console.log(model.model);
      return;
    }
    case "export": {
      const model = args[2];
      const out = readOption(args, "--out");
      if (!model || !out) usage();
      await mkdir(dirname(out), { recursive: true });
      await exportBuiltinModelConfig(model, out);
      console.log(out);
      return;
    }
    case "export-all": {
      const out = readOption(args, "--out");
      if (!out) usage();
      await exportBuiltinModelConfigs(out);
      console.log(out);
      return;
    }
    case "dump": {
      const out = readOption(args, "--out");
      const models = listBuiltinGenerationModels();
      if (out) {
        await mkdir(out, { recursive: true });
        await Promise.all(
          models.map((model) =>
            writeFile(join(out, `${model.model}.yaml`), stringifyGenerationModelDeclaration(model)),
          ),
        );
      }
      return;
    }
    default:
      usage();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
