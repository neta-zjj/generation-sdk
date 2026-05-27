import type { GenerationContentBlock } from "./types.js";

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function slugifyFileName(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "model"
  );
}

export function getBlockMeta(block: GenerationContentBlock): Record<string, unknown> | undefined {
  return "meta" in block ? block.meta : undefined;
}
