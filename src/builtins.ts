import type { GenerationModelDeclaration } from "./types.js";
import { MODEL_SCHEMA } from "./types.js";
import { cloneJson } from "./utils.js";

const imageSizeParameters = {
  size: {
    type: "string",
    optional: true,
    default: "1024x1024",
    description: "Output image size.",
    examples: ["auto", "1024x1024", "1536x1024", "1024x1536", "2048x2048", "2048x1152", "3840x2160", "2160x3840"],
  },
  quality: {
    type: "string",
    optional: true,
    default: "auto",
    enum: ["auto", "low", "medium", "high"],
    description: "Image quality.",
  },
} satisfies GenerationModelDeclaration["parameters"];

function videoParameters(defaults: { resolution: string; maxWait: number }) {
  return {
    duration: {
      type: "integer",
      optional: true,
      default: 5,
      min: 4,
      max: 15,
      description: "Video duration in seconds.",
    },
    resolution: {
      type: "string",
      optional: true,
      default: defaults.resolution,
      enum: ["480p", "720p", "1080p", "2K"],
      description: "Output video resolution.",
    },
    aspect_ratio: {
      type: "string",
      optional: true,
      default: "16:9",
      enum: ["16:9", "9:16", "1:1", "4:3", "3:2", "2:3", "3:4", "21:9", "adaptive"],
      description: "Output aspect ratio. Use adaptive to let the model choose.",
    },
    fps: { type: "integer", optional: true, default: 30, min: 1, max: 60, description: "Frames per second." },
    seed: { type: "integer", optional: true, description: "Random seed for reproducibility." },
    generate_audio: { type: "boolean", optional: true, default: true, description: "Generate synchronized audio." },
    return_last_frame: {
      type: "boolean",
      optional: true,
      default: true,
      description: "Return the last frame as an image for chaining video segments.",
    },
    camera_fixed: {
      type: "boolean",
      optional: true,
      default: false,
      description: "Fix camera position when supported.",
    },
    watermark: { type: "boolean", optional: true, default: false, description: "Add AI Generated watermark." },
    poll_interval: {
      type: "integer",
      optional: true,
      default: 2,
      min: 1,
      max: 30,
      description: "Seconds between task status checks.",
    },
    max_wait: {
      type: "integer",
      optional: true,
      default: defaults.maxWait,
      min: 30,
      max: 1800,
      description: "Maximum seconds to wait for task completion.",
    },
  } satisfies GenerationModelDeclaration["parameters"];
}

const builtinModels = [
  {
    schema: MODEL_SCHEMA,
    model: "gpt-image-2",
    title: "GPT Image 2",
    description:
      "Image generation model with optional reference images. Good for photorealistic scenes, detailed images, and image editing with references.",
    adapter: { type: "openai.images" },
    content: {
      input: [
        { type: "text", required: true, min: 1, max: 16, merge: "newline", description: "Prompt text." },
        {
          type: "image",
          required: false,
          max: 16,
          sources: ["url", "base64"],
          description: "Optional reference images.",
        },
      ],
    },
    parameters: imageSizeParameters,
    examples: [
      {
        title: "Basic image",
        request: {
          model: "gpt-image-2",
          content: [{ type: "text", text: "a cyberpunk cat in neon rain" }],
          parameters: { size: "1024x1024", quality: "auto" },
        },
      },
    ],
  },
  {
    schema: MODEL_SCHEMA,
    model: "gemini-3.1-flash-image-preview",
    title: "Gemini 3.1 Flash Image Preview",
    description:
      "Gemini image generation and editing model. Good for text rendering, infographics, style transfer, and iterative image editing with references.",
    adapter: { type: "gemini.generateContent" },
    content: {
      input: [
        { type: "text", required: true, min: 1, max: 16, merge: "newline", description: "Prompt text." },
        {
          type: "image",
          required: false,
          max: 14,
          sources: ["url", "base64"],
          description: "Optional reference images.",
        },
      ],
    },
    parameters: {
      aspect_ratio: {
        type: "string",
        optional: true,
        default: "1:1",
        enum: ["1:1", "16:9", "4:3", "3:2", "3:4", "2:3", "9:16", "5:4", "4:5", "21:9", "1:4", "4:1", "1:8", "8:1"],
        description: "Output aspect ratio.",
      },
      image_size: {
        type: "string",
        optional: true,
        default: "2K",
        enum: ["512", "1K", "2K", "4K"],
        description: "Output image resolution.",
      },
    },
    examples: [
      {
        title: "Basic image",
        request: {
          model: "gemini-3.1-flash-image-preview",
          content: [
            { type: "text", text: "a vibrant infographic explaining photosynthesis with clear readable labels" },
          ],
          parameters: { aspect_ratio: "16:9", image_size: "1K" },
        },
      },
    ],
  },
  {
    schema: MODEL_SCHEMA,
    model: "seedance-2-0",
    title: "Seedance 2.0",
    description: "Higher quality Ark video generation model for final production outputs.",
    adapter: { type: "ark.videoGenerations" },
    content: {
      input: [
        { type: "text", required: true, min: 1, max: 16, merge: "newline", description: "Video prompt." },
        {
          type: "image",
          required: false,
          max: 9,
          sources: ["url", "base64"],
          description: "Optional image input. Use meta.role as first_frame, last_frame, or reference_image.",
        },
      ],
    },
    parameters: videoParameters({ resolution: "1080p", maxWait: 900 }),
  },
  {
    schema: MODEL_SCHEMA,
    model: "seedance-2-0-fast",
    title: "Seedance 2.0 Fast",
    description:
      "Fast Ark video generation model for drafts, rapid iteration, text-to-video, image-to-video, and reference-guided video generation.",
    adapter: { type: "ark.videoGenerations" },
    content: {
      input: [
        { type: "text", required: true, min: 1, max: 16, merge: "newline", description: "Video prompt." },
        {
          type: "image",
          required: false,
          max: 9,
          sources: ["url", "base64"],
          description: "Optional image input. Use meta.role as first_frame, last_frame, or reference_image.",
        },
      ],
    },
    parameters: videoParameters({ resolution: "720p", maxWait: 600 }),
  },
] satisfies GenerationModelDeclaration[];

export const builtinGenerationModels: GenerationModelDeclaration[] = cloneJson(builtinModels);

export function getBuiltinGenerationModel(model: string): GenerationModelDeclaration | null {
  return cloneJson(builtinModels.find((declaration) => declaration.model === model) ?? null);
}

export function listBuiltinGenerationModels(): GenerationModelDeclaration[] {
  return cloneJson(builtinModels);
}
