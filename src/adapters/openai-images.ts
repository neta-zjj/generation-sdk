import { GenerationProviderError, GenerationValidationError } from "../errors.js";
import { fetchWithTimeout, joinUrl } from "../http.js";
import type { GenerationAdapterInput, GenerationContentBlock } from "../types.js";
import { mergeTextBlocks } from "../validation.js";

const REQUEST_TIMEOUT_MS = 300_000;

type OpenAiImagesResponse = {
  data?: Array<{
    url?: unknown;
    revised_prompt?: unknown;
  }>;
};

export async function openAiImagesAdapter(input: GenerationAdapterInput): Promise<GenerationContentBlock[]> {
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
    if (typeof item.revised_prompt === "string" && item.revised_prompt.trim()) {
      output.push({ type: "text", text: item.revised_prompt, meta: { role: "revised_prompt" } });
    }
  }
  return output;
}
