import { GenerationProviderError, GenerationValidationError } from "../errors.js";
import { fetchWithTimeout, joinUrl } from "../http.js";
import type { GenerationAdapterInput, GenerationAdapterResult, GenerationContentBlock } from "../types.js";
import { compactArray, compactObject } from "../utils.js";
import { mergeTextBlocks } from "../validation.js";

const REQUEST_TIMEOUT_MS = 300_000;

type OpenAiImagesResponse = {
  data?: Array<{
    url?: unknown;
    b64_json?: unknown;
    revised_prompt?: unknown;
  }>;
  created?: unknown;
  usage?: unknown;
  background?: unknown;
  output_format?: unknown;
  quality?: unknown;
  size?: unknown;
};

function collectOpenAiImagesNoOutputDetails(raw: OpenAiImagesResponse): Record<string, unknown> {
  const data = raw.data ?? [];
  return compactObject({
    created: raw.created,
    usage: raw.usage,
    background: raw.background,
    outputFormat: raw.output_format,
    quality: raw.quality,
    size: raw.size,
    dataCount: data.length,
    data: compactArray(
      data.map((item) =>
        compactObject({
          hasUrl: typeof item.url === "string" && item.url.length > 0,
          hasBase64Json: typeof item.b64_json === "string" && item.b64_json.length > 0,
          revisedPrompt: item.revised_prompt,
        }),
      ),
    ),
  });
}

export async function openAiImagesAdapter(input: GenerationAdapterInput): Promise<GenerationAdapterResult> {
  const prompt = mergeTextBlocks(input.declaration, input.request.content);
  if (!prompt) throw new GenerationValidationError("Prompt text is required");

  const images = await Promise.all(
    input.request.content
      .filter((block): block is Extract<GenerationContentBlock, { type: "image" }> => block.type === "image")
      .map((block) => input.context.resolveSource(block.source)),
  );

  const payload: Record<string, unknown> = {
    model: input.declaration.model,
    prompt,
    ...input.parameters,
  };
  if (images.length > 0) payload.image = images;

  const response = await fetchWithTimeout(
    input.context.fetch,
    joinUrl(input.context.baseUrl, "/v1/images/generations"),
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.context.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
    REQUEST_TIMEOUT_MS,
  );

  if (!response.ok) {
    const body = await response.text().catch(() => response.statusText);
    throw new GenerationProviderError("Image generation provider request failed", { status: response.status, body });
  }

  const raw = (await response.json()) as OpenAiImagesResponse;
  const output: GenerationContentBlock[] = [];
  for (const item of raw.data ?? []) {
    if (typeof item.url === "string" && item.url) {
      output.push({ type: "image", source: { type: "url", url: item.url } });
    }
    if (typeof item.b64_json === "string" && item.b64_json) {
      output.push({ type: "image", source: { type: "base64", mediaType: "image/png", data: item.b64_json } });
    }
    if (typeof item.revised_prompt === "string" && item.revised_prompt.trim()) {
      output.push({ type: "text", text: item.revised_prompt, meta: { role: "revised_prompt" } });
    }
  }
  if (output.length === 0) {
    throw new GenerationProviderError("Image generation returned no output", {
      details: collectOpenAiImagesNoOutputDetails(raw),
    });
  }
  return { content: output };
}
