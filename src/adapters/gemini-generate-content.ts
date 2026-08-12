import { GenerationProviderError, GenerationValidationError } from "../errors.js";
import { fetchWithTimeout, joinUrl } from "../http.js";
import type { GenerationAdapterInput, GenerationContentBlock } from "../types.js";
import { compactArray, compactObject } from "../utils.js";
import { mergeTextBlocks } from "../validation.js";

const REQUEST_TIMEOUT_MS = 300_000;
const MARKDOWN_IMAGE_DATA_URI_PATTERN = /!\[[^\]]*\]\(data:([^;]+);base64,([^)]+)\)/;

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { fileUri: string } };

type GeminiResponsePart = {
  text?: unknown;
  inlineData?: { mimeType?: unknown; data?: unknown };
  fileData?: { mimeType?: unknown; fileUri?: unknown };
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

function isHttpUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

async function imageBlockToGeminiPart(
  input: GenerationAdapterInput,
  block: Extract<GenerationContentBlock, { type: "image" }>,
): Promise<GeminiPart> {
  if (block.source.type === "base64") {
    return { inlineData: { mimeType: block.source.mediaType, data: block.source.data } };
  }
  const fileUri = await input.context.resolveSource(block.source);
  if (!isHttpUrl(fileUri))
    throw new GenerationValidationError("Gemini image URL source must resolve to an HTTP(S) URL");
  return { fileData: { fileUri } };
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

function appendGeminiFileDataOutput(
  output: GenerationContentBlock[],
  fileData: GeminiResponsePart["fileData"],
): boolean {
  if (typeof fileData?.fileUri !== "string" || !fileData.fileUri) return false;
  const mediaType = typeof fileData.mimeType === "string" ? fileData.mimeType : "image/png";
  output.push({ type: "image", source: { type: "url", url: fileData.fileUri }, meta: { mediaType } });
  return true;
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

  appendGeminiFileDataOutput(output, part.fileData);
}

export async function geminiGenerateContentAdapter(input: GenerationAdapterInput): Promise<GenerationContentBlock[]> {
  const prompt = mergeTextBlocks(input.declaration, input.request.content);
  if (!prompt) throw new GenerationValidationError("Prompt text is required");

  const imageParts = await Promise.all(
    input.request.content
      .filter((block): block is Extract<GenerationContentBlock, { type: "image" }> => block.type === "image")
      .map((block) => imageBlockToGeminiPart(input, block)),
  );

  const generationConfig: Record<string, unknown> = { responseModalities: ["IMAGE"] };
  const aspectRatio = input.parameters.aspect_ratio;
  const imageSize = input.parameters.image_size;
  if (typeof aspectRatio === "string" || typeof imageSize === "string") {
    const image: Record<string, string> = {};
    if (typeof aspectRatio === "string") image.aspectRatio = aspectRatio;
    if (typeof imageSize === "string") image.imageSize = imageSize;
    generationConfig.imageConfig = image;
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
    { stage: "submit" },
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
