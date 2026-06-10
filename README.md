# @neta-art/generation

A lightweight multimodal generation SDK with built-in model presets, model declaration files, and adapter-based provider calls.

## Install

```bash
npm install @neta-art/generation
```

## Quick start

```ts
import { createGenerationClient } from "@neta-art/generation";

const client = createGenerationClient({
  apiKey: process.env.NETA_ROUTER_API_KEY!,
});

const output = await client.generate({
  model: "gpt-image-2",
  content: [
    { type: "text", text: "a cinematic portrait of a robot florist, 35mm film" },
  ],
  parameters: {
    size: "1024x1024",
    quality: "high",
  },
});

console.log(output);
```

`baseUrl` defaults to `https://router.neta.art`. Pass a different endpoint when needed:

```ts
const client = createGenerationClient({
  apiKey: process.env.NETA_ROUTER_API_KEY!,
  baseUrl: "https://router.neta.art",
});
```

## Local testing with `.env`

`.env` is ignored by Git. Copy `.env.example` to `.env` and fill in your router key:

```bash
cp .env.example .env
```

```dotenv
NETA_ROUTER_API_KEY=your_api_key_here
```

Node.js does not load `.env` automatically for library code. The example scripts use Node's native `--env-file` flag through npm scripts:

```bash
pnpm example:basic-image
pnpm example:image-editing
pnpm example:text-to-video
```

You can also call providers through the CLI:

```bash
node --env-file=.env ./dist/cli/index.js generate gemini-3.1-flash-image-preview \
  --prompt "a simple abstract geometric app icon" \
  --param aspect_ratio=1:1 \
  --param image_size=512 \
  --debug
```

Use `--image-url` for reference images, `--out` to write base64 outputs to files, and `json:` for non-string parameter values, for example `--param duration=json:5`.

## Debug provider requests

Pass `debug: true` to print the final provider request and response metadata to stderr. Sensitive fields such as `Authorization` and base64 image data are redacted by default.

```ts
const client = createGenerationClient({
  apiKey: process.env.NETA_ROUTER_API_KEY!,
  debug: true,
});
```

For a custom logger or full unredacted payloads:

```ts
const client = createGenerationClient({
  apiKey: process.env.NETA_ROUTER_API_KEY!,
  debug: {
    enabled: true,
    includeSensitive: true,
    logger: (event) => console.error(JSON.stringify(event, null, 2)),
  },
});
```

## Built-in models

- `gpt-image-2`
- `gemini-3.1-flash-image-preview`
- `kling-text-to-video`
- `kling-image-to-video`
- `kling-omni-video`
- `kling-multi-image-to-video`
- `seedance-2-0`
- `seedance-2-0-fast`
- `suno_music`

Built-in model declarations share the same client-level `apiKey` and `baseUrl`.

## Image editing with a reference image

```ts
const output = await client.generate({
  model: "gemini-3.1-flash-image-preview",
  content: [
    { type: "text", text: "turn this portrait into a watercolor illustration" },
    { type: "image", source: { type: "url", url: "https://example.com/portrait.jpg" } },
  ],
  parameters: {
    aspect_ratio: "3:4",
    image_size: "2K",
  },
});
```

## Video generation

```ts
const output = await client.generate({
  model: "seedance-2-0-fast",
  content: [
    { type: "text", text: "a cat playing piano in a cozy jazz club, cinematic lighting" },
  ],
  parameters: {
    duration: 5,
    resolution: "720p",
    aspect_ratio: "16:9",
  },
});
```

Frame and reference-image video modes use `meta.role`:

```ts
await client.generate({
  model: "seedance-2-0",
  content: [
    { type: "text", text: "create a smooth dramatic transition" },
    { type: "image", source: { type: "url", url: "https://example.com/start.jpg" }, meta: { role: "first_frame" } },
    { type: "image", source: { type: "url", url: "https://example.com/end.jpg" }, meta: { role: "last_frame" } },
  ],
});
```

Kling exposes stable capability model ids while the adapter sends the latest upstream `model_name` for each capability:

```ts
await client.generate({
  model: "kling-image-to-video",
  content: [
    { type: "text", text: "gently turn toward the camera with soft natural motion" },
    { type: "image", source: { type: "url", url: "https://example.com/input.png" } },
  ],
  parameters: {
    duration: 5,
    aspect_ratio: "16:9",
  },
});
```

Kling built-in pricing is aligned with Yunwu Model Hub. `kling-text-to-video`, `kling-image-to-video`, and
`kling-multi-image-to-video` use Yunwu `kling-video` pricing; `kling-omni-video` uses Yunwu `kling-omni-video` pricing.
Both are currently `modelPrice: 0.017`, displayed by Yunwu as `1.190` credits per request, with token groups
`default: 1` and `特价kling: 0.7`.

## Music generation

```ts
const output = await client.generate({
  model: "suno_music",
  content: [
    { type: "text", text: "uplifting cinematic pop with warm piano and clear chorus" },
  ],
  parameters: {
    operation: "music",
  },
  meta: {
    mv: "chirp-v5-5",
    title: "Warm Horizon",
    tags: "cinematic pop, warm piano",
    make_instrumental: false,
  },
});

console.log(output);
```

Suno uses one public model, `suno_music`. SDK-level parameters control execution:

- `music`
- `lyrics`

Provider-specific Suno fields belong in `meta`, not `parameters`. The adapter passes `meta` through to Suno and defaults
`meta.mv` to `chirp-v5-5` for music requests. Use `meta.task` for Yunwu-style integrated tasks such as `sound`, `cover`,
`image_to_song`, `video_to_song`, `remaster`, `underpainting`, or `mashup_condition`.

## Load model declarations from files

```ts
import { createGenerationClientFromDirectory } from "@neta-art/generation";

const client = await createGenerationClientFromDirectory("./models", {
  apiKey: process.env.NETA_ROUTER_API_KEY!,
});
```

Supported declaration formats:

- `.yaml`
- `.yml`
- `.json`

Custom declarations are merged with built-in models by default. If the same `model` exists, the custom declaration wins.

## Export model declarations

```ts
import { exportBuiltinModelConfig } from "@neta-art/generation";

await exportBuiltinModelConfig("gpt-image-2", "./gpt-image-2.yaml");
```

CLI:

```bash
neta-generation models list
neta-generation models export gpt-image-2 --out ./gpt-image-2.yaml
neta-generation models export-all --out ./models
```

## Model declaration schema

```yaml
schema: neta.generation.model.v1
model: gpt-image-2
title: GPT Image 2
adapter:
  type: openai.images
content:
  input:
    - type: text
      required: true
      min: 1
      max: 16
      merge: newline
    - type: image
      required: false
      max: 16
      sources:
        - url
        - base64
parameters:
  size:
    type: string
    optional: true
    default: 1024x1024
```

Adapter credentials are intentionally not stored in model declarations. Use client-level or request-level `apiKey` and `baseUrl` instead.

## Content sources

```ts
type GenerationSource =
  | { type: "url"; url: string }
  | { type: "base64"; mediaType: string; data: string };
```

## Adapter types

Built-in adapters:

- `openai.images`
- `gemini.generateContent`
- `ark.videoGenerations`
- `kling.videoGenerations`
- `suno.tasks`

You can register custom adapters:

```ts
const client = createGenerationClient({
  apiKey,
  adapters: {
    "custom.adapter": async (input) => {
      return [];
    },
  },
});
```

## Validation without provider calls

```ts
const resolved = client.validate({
  model: "gpt-image-2",
  content: [{ type: "text", text: "hello" }],
});

console.log(resolved.parameters);
```

## Error handling

```ts
import { GenerationValidationError, GenerationProviderError } from "@neta-art/generation";

try {
  await client.generate(request);
} catch (error) {
  if (error instanceof GenerationValidationError) {
    console.error("Invalid request", error.message);
  } else if (error instanceof GenerationProviderError) {
    console.error("Provider failed", error.message);
  }
}
```
