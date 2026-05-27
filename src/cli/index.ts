#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { listBuiltinGenerationModels } from "../builtins.js";
import { stringifyGenerationModelDeclaration } from "../config.js";
import { exportBuiltinModelConfig, exportBuiltinModelConfigs } from "../export-config.js";

function usage(): never {
  console.log(`neta-generation

Usage:
  neta-generation models list
  neta-generation models export <model> --out <file>
  neta-generation models export-all --out <directory>
`);
  process.exit(1);
}

function readOption(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) return null;
  return args[index + 1] ?? null;
}

async function main() {
  const args = process.argv.slice(2);
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
