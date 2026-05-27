import { GenerationProviderError, GenerationValidationError } from "../errors.js";
import { fetchWithTimeout, joinUrl } from "../http.js";
import type { GenerationAdapterInput, GenerationContentBlock } from "../types.js";
import { compactArray, compactObject } from "../utils.js";
import { mergeTextBlocks } from "../validation.js";

const REQUEST_TIMEOUT_MS = 300_000;
const IMAGE_FETCH_TIMEOUT_MS = 60_000;
const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024;

const DATA_URI_PATTERN = /^data:([^;]+);base64,(.+)$/s;
const MARKDOWN_IMAGE_DATA_URI_PATTERN = /!\[[^\]]*\]\(data:([^;]+);base64,([^)]+)\)/;

type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

type GeminiResponsePart = {
  text?: unknown;
  inlineData?: { mimeType?: unknown; data?: unknown };
  inline_data?: { mime_type?: unknown; mimeType?: unknown; data?: unknown };
};

type GeminiCandidate = {
  content?: { role?: unknown; parts?: GeminiResponsePart[] };
  finishReason?: unknown;
  finishMessage?: unknown;
  safetyRatings?: unknown;
  citationMetadata?: unknown;
  groundingMetadata?: unknown;
  avgLogprobs?: unknown;
  index?: unknown;
};

type GeminiGenerateContentResponse = {
  candidates?: GeminiCandidate[];
  promptFeedback?: unknown;
  usageMetadata?: unknown;
  modelVersion?: unknown;
  responseId?: unknown;
};

function dataUriToInlineData(value: string): GeminiPart | null {
  const match = DATA_URI_PATTERN.exec(value);
  if (!match) return null;
  const [, mimeType, data] = match;
  if (!mimeType || !data) return null;
  return { inlineData: { mimeType, data } };
}

async function urlToInlineData(fetchFn: typeof fetch, url: string): Promise<GeminiPart> {
  const response = await fetchWithTimeout(
    fetchFn,
    url,
    { method: "GET", headers: { "User-Agent": "NetaGeneration/1.0" } },
    IMAGE_FETCH_TIMEOUT_MS,
  );
  if (!response.ok) throw new GenerationProviderError("Failed to fetch reference image", { status: response.status });

  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_REFERENCE_IMAGE_BYTES) {
    throw new GenerationValidationError("Reference image is too large");
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_REFERENCE_IMAGE_BYTES) throw new GenerationValidationError("Reference image is too large");

  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim();
  const mimeType = contentType?.startsWith("image/") ? contentType : "image/png";
  return { inlineData: { mimeType, data: bytes.toString("base64") } };
}

async function sourceToInlineData(input: GenerationAdapterInput, value: string): Promise<GeminiPart> {
  const inline = dataUriToInlineData(value);
  if (inline) return inline;
  if (value.startsWith("http://") || value.startsWith("https://")) return urlToInlineData(input.context.fetch, value);
  throw new GenerationValidationError("Unsupported image source for Gemini image generation");
}

function extractMarkdownDataUriImage(text: string): GenerationContentBlock | null {
  const match = MARKDOWN_IMAGE_DATA_URI_PATTERN.exec(text);
  if (!match) return null;
  const [, mediaType, data] = match;
  if (!mediaType || !data) return null;
  return { type: "image", source: { type: "base64", mediaType, data } };
}

function collectGeminiNoOutputDetails(raw: GeminiGenerateContentResponse): Record<string, unknown> {
  const candidates = raw.candidates ?? [];
  return compactObject({
    finishReasons: compactArray(
      candidates.map((candidate) => candidate.finishReason).filter((value) => value !== undefined),
    ),
    finishMessages: compactArray(
      candidates.map((candidate) => candidate.finishMessage).filter((value) => value !== undefined),
    ),
    safetyRatings: compactArray(candidates.flatMap((candidate) => candidate.safetyRatings ?? [])),
    promptFeedback: raw.promptFeedback,
    usageMetadata: raw.usageMetadata,
    modelVersion: raw.modelVersion,
    responseId: raw.responseId,
    candidateCount: candidates.length,
    candidates: compactArray(
      candidates.map((candidate) =>
        compactObject({
          index: candidate.index,
          finishReason: candidate.finishReason,
          finishMessage: candidate.finishMessage,
          safetyRatings: candidate.safetyRatings,
          citationMetadata: candidate.citationMetadata,
          groundingMetadata: candidate.groundingMetadata,
          avgLogprobs: candidate.avgLogprobs,
          contentRole: candidate.content?.role,
          partCount: candidate.content?.parts?.length,
        }),
      ),
    ),
  });
}

function appendGeminiPartOutput(output: GenerationContentBlock[], part: GeminiResponsePart): void {
  if (typeof part.text === "string" && part.text.trim()) {
    const image = extractMarkdownDataUriImage(part.text);
    if (image) {
      output.push(image);
      return;
    }
    output.push({ type: "text", text: part.text });
    return;
  }

  if (part.inlineData && typeof part.inlineData.data === "string" && part.inlineData.data) {
    output.push({
      type: "image",
      source: {
        type: "base64",
        mediaType: typeof part.inlineData.mimeType === "string" ? part.inlineData.mimeType : "image/png",
        data: part.inlineData.data,
      },
    });
    return;
  }

  const inline = part.inline_data;
  if (!inline || typeof inline.data !== "string" || !inline.data) return;
  const mediaType =
    typeof inline.mime_type === "string"
      ? inline.mime_type
      : typeof inline.mimeType === "string"
        ? inline.mimeType
        : "image/png";
  output.push({ type: "image", source: { type: "base64", mediaType, data: inline.data } });
}

export async function geminiGenerateContentAdapter(input: GenerationAdapterInput): Promise<GenerationContentBlock[]> {
  const prompt = mergeTextBlocks(input.declaration, input.request.content);
  if (!prompt) throw new GenerationValidationError("Prompt text is required");

  const imageParts = await Promise.all(
    input.request.content
      .filter((block): block is Extract<GenerationContentBlock, { type: "image" }> => block.type === "image")
      .map(async (block) => sourceToInlineData(input, await input.context.resolveSource(block.source))),
  );

  const generationConfig: Record<string, unknown> = { responseModalities: ["IMAGE"] };
  const aspectRatio = input.parameters.aspect_ratio;
  const imageSize = input.parameters.image_size;
  if (typeof aspectRatio === "string" || typeof imageSize === "string") {
    const image: Record<string, string> = {};
    if (typeof aspectRatio === "string") image.aspectRatio = aspectRatio;
    if (typeof imageSize === "string") image.imageSize = imageSize;
    generationConfig.responseFormat = { image };
  }

  const payload = {
    contents: [{ parts: [{ text: prompt }, ...imageParts] satisfies GeminiPart[] }],
    generationConfig,
  };

  const response = await fetchWithTimeout(
    input.context.fetch,
    joinUrl(input.context.baseUrl, `/v1beta/models/${encodeURIComponent(input.declaration.model)}:generateContent`),
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
    throw new GenerationProviderError("Gemini generation provider request failed", { status: response.status, body });
  }

  const raw = (await response.json()) as GeminiGenerateContentResponse;
  const output: GenerationContentBlock[] = [];
  for (const candidate of raw.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) appendGeminiPartOutput(output, part);
  }
  if (output.length === 0) {
    throw new GenerationProviderError("Gemini generation returned no output", {
      details: collectGeminiNoOutputDetails(raw),
    });
  }
  return output;
}
