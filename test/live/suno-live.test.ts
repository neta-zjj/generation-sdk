import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { buildSunoLiveRequest, sunoLiveTasks } from "../../scripts/suno-live-data.js";
import { createGenerationClient } from "../../src/index.js";

const DEFAULT_BASE_URL = "https://dev.router.neta.art";
const KEY_FILE = "/tmp/neta-router-key";

async function readApiKey(): Promise<string> {
  const envKey = (process.env.NETA_ROUTER_API_KEY ?? process.env.NETA_API_KEY)?.trim();
  if (envKey) return envKey;
  return (await readFile(KEY_FILE, "utf8")).trim();
}

function hasRunEnvironment(): boolean {
  const envKey = process.env.NETA_ROUTER_API_KEY ?? process.env.NETA_API_KEY;
  return Boolean(envKey?.trim() || existsSync(KEY_FILE));
}

const liveDescribe = hasRunEnvironment() ? describe : describe.skip;

liveDescribe("suno live provider smoke", () => {
  it.each(sunoLiveTasks)("%s returns real provider output", async (task) => {
    const apiKey = await readApiKey();
    const client = createGenerationClient({ apiKey, baseUrl: DEFAULT_BASE_URL });
    const request = buildSunoLiveRequest(task);
    const output = await client.generate(request);

    expect(output.length).toBeGreaterThan(0);

    const outputTypes = output.map((block) => block.type);
    if (task === "upsample_tags") {
      expect(outputTypes).toEqual(["text"]);
      expect(output[0]).toMatchObject({
        type: "text",
        text: expect.any(String),
        meta: expect.objectContaining({
          operation: "upsample_tags",
        }),
      });
      return;
    }

    if (task === "upload_audio") {
      expect(outputTypes).toContain("audio");
      expect(outputTypes).toContain("image");
      expect(output[0]).toMatchObject({
        type: "audio",
        source: { type: "url" },
        meta: expect.objectContaining({
          operation: "upload_audio",
          action: "upload_audio",
          progress: 100,
        }),
      });
      return;
    }

    expect(outputTypes).toEqual(["audio", "image", "audio", "image"]);
    expect(output[0]).toMatchObject({
      type: "audio",
      source: { type: "url" },
      meta: expect.objectContaining({
        progress: 100,
        action: expect.any(String),
      }),
    });
    expect(output[1]).toMatchObject({
      type: "image",
      source: { type: "url" },
    });
  });
});
