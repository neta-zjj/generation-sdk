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

const dramatiqImageParameters = {
  size: {
    type: "string",
    optional: true,
    default: "1024x1024",
    description: "Output image size as WIDTHxHEIGHT.",
    examples: ["1024x1024", "768x1024", "1024x768"],
  },
  negative_prompt: {
    type: "string",
    optional: true,
    description: "Negative prompt forwarded to the Dramatiq Comfy workflow.",
  },
  seed: {
    type: "integer",
    optional: true,
    min: 0,
    description: "Random seed for reproducibility.",
  },
} satisfies GenerationModelDeclaration["parameters"];

const dramatiqI2IParameters = {
  ...dramatiqImageParameters,
  controlnet_weight: {
    type: "number",
    optional: true,
    min: 0,
    max: 2,
    description: "ControlNet tile weight. The provider default is 0.8.",
  },
  ipadapter_face_image_ref: {
    type: "string",
    optional: true,
    description: "Optional face reference image URL for IP-Adapter.",
  },
  ipadapter_face_weight: {
    type: "number",
    optional: true,
    min: 0,
    max: 2,
    description: "IP-Adapter face weight. The provider default is 0.6 when a face reference is supplied.",
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

const sunoContinuationTaskVariant = {
  required: ["task_id", "clip_id", "continue_clip_id"],
};

const sunoMeta = {
  taskField: "task",
  fields: {
    task: {
      type: "string",
      optional: true,
      enum: [
        "extend",
        "upload_extend",
        "infill",
        "fixed_infill",
        "infill_intro",
        "infill_outro",
        "cover_infill",
        "cover_extend",
        "artist_infill",
        "artist_consistency",
        "cover",
        "image_to_song",
        "video_to_song",
        "concat",
        "sound",
        "underpainting",
        "remaster",
        "vox",
        "mashup_condition",
      ],
      description: "Integrated Suno music task for operation=music.",
    },
    mv: { type: "string", optional: true, description: "Suno music model version." },
    task_id: {
      type: "string",
      optional: true,
      description: "Existing Suno task id used for continuation-style tasks.",
    },
    clip_id: {
      type: "string",
      optional: true,
      description: "Existing Suno clip id used for continuation-style tasks.",
    },
    continue_clip_id: { type: "string", optional: true, description: "Clip id to continue from." },
    continue_at: { type: "number", optional: true, description: "Continue position in seconds." },
    model_name: { type: "string", optional: true, description: "Suno model name used by remaster." },
    variation_category: { type: "string", optional: true, description: "Remaster variation category." },
    metadata_params: {
      type: "object",
      optional: true,
      description: "Yunwu/Suno task-specific metadata payload.",
    },
  },
  taskVariants: {
    extend: sunoContinuationTaskVariant,
    upload_extend: sunoContinuationTaskVariant,
    infill: sunoContinuationTaskVariant,
    fixed_infill: sunoContinuationTaskVariant,
    infill_intro: sunoContinuationTaskVariant,
    infill_outro: sunoContinuationTaskVariant,
    cover_infill: sunoContinuationTaskVariant,
    cover_extend: sunoContinuationTaskVariant,
    artist_infill: sunoContinuationTaskVariant,
    artist_consistency: sunoContinuationTaskVariant,
    cover: sunoContinuationTaskVariant,
    image_to_song: { requiredContent: ["image"], required: ["metadata_params"] },
    video_to_song: { requiredContent: ["video"], required: ["metadata_params"] },
    concat: sunoContinuationTaskVariant,
    sound: { required: ["metadata_params"] },
    underpainting: { required: ["metadata_params"] },
    remaster: { sendTask: false, required: ["clip_id", "model_name", "variation_category"] },
    vox: sunoContinuationTaskVariant,
    mashup_condition: sunoContinuationTaskVariant,
  },
} satisfies GenerationModelDeclaration["meta"];

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
    model: "noobxl-t2i-onediff",
    title: "NoobXL T2I OneDiff",
    description: "USA new-api Dramatiq text-to-image model backed by the ComfyUI actor.",
    allowUnknownParameters: true,
    adapter: { type: "openai.images" },
    content: {
      input: [{ type: "text", required: true, min: 1, max: 16, merge: "newline", description: "Prompt text." }],
    },
    parameters: dramatiqImageParameters,
    examples: [
      {
        title: "Text to image",
        request: {
          model: "noobxl-t2i-onediff",
          content: [{ type: "text", text: "anime key visual, luminous city at night, crisp linework" }],
          parameters: { size: "1024x1024", negative_prompt: "low quality, blurry" },
        },
      },
    ],
  },
  {
    schema: MODEL_SCHEMA,
    model: "noobxl-i2i-ipa-onediff",
    title: "NoobXL I2I IPA OneDiff",
    description: "USA new-api Dramatiq image-to-image model backed by the ComfyUI actor.",
    allowUnknownParameters: true,
    adapter: { type: "openai.images" },
    content: {
      input: [
        { type: "text", required: true, min: 1, max: 16, merge: "newline", description: "Prompt text." },
        {
          type: "image",
          required: true,
          min: 1,
          max: 1,
          sources: ["url", "base64"],
          description: "Single source image.",
        },
      ],
    },
    parameters: dramatiqI2IParameters,
    examples: [
      {
        title: "Image to image",
        request: {
          model: "noobxl-i2i-ipa-onediff",
          content: [
            { type: "text", text: "keep the character identity, redraw as a polished anime illustration" },
            { type: "image", source: { type: "url", url: "https://example.com/reference.png" } },
          ],
          parameters: { size: "1024x1024", controlnet_weight: 0.8 },
        },
      },
    ],
  },
  {
    schema: MODEL_SCHEMA,
    model: "birefnet-general",
    title: "BiRefNet General",
    description: "USA new-api Dramatiq single-image tool for BiRefNet segmentation and background removal.",
    adapter: { type: "openai.images" },
    content: {
      input: [
        {
          type: "image",
          required: true,
          min: 1,
          max: 1,
          sources: ["url", "base64"],
          description: "Single source image.",
        },
      ],
    },
    examples: [
      {
        title: "Remove background",
        request: {
          model: "birefnet-general",
          content: [{ type: "image", source: { type: "url", url: "https://example.com/portrait.png" } }],
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
  {
    schema: MODEL_SCHEMA,
    model: "suno_music",
    title: "Suno Music",
    description: "Suno music model for songs, lyrics, sound effects, and integrated music tasks.",
    adapter: { type: "suno.tasks" },
    content: {
      input: [
        {
          type: "text",
          required: false,
          max: 16,
          merge: "newline",
          description:
            "Optional prompt text. The adapter maps merged text to the operation's text field when that field is not provided.",
        },
        {
          type: "audio",
          required: false,
          max: 1,
          sources: ["url", "base64"],
          description: "Optional reference audio. The adapter maps it to url when url is not provided.",
        },
        {
          type: "image",
          required: false,
          max: 1,
          sources: ["url", "base64"],
          description: "Optional image source. The adapter maps it to image_url when image_url is not provided.",
        },
        {
          type: "video",
          required: false,
          max: 1,
          sources: ["url", "base64"],
          description: "Optional video source. The adapter maps it to video_url when video_url is not provided.",
        },
      ],
    },
    parameters: {
      operation: {
        type: "string",
        optional: true,
        default: "music",
        enum: ["music", "lyrics"],
        description:
          "Stable Suno endpoint operation. Provider-specific fields such as task, mv, title, tags, metadataParams, and clip_id belong in request meta.",
      },
      poll_interval: {
        type: "integer",
        optional: true,
        default: 5,
        min: 1,
        max: 60,
        description: "Seconds between task status checks.",
      },
      max_wait: {
        type: "integer",
        optional: true,
        default: 600,
        min: 30,
        max: 3600,
        description: "Maximum seconds to wait for task completion.",
      },
    },
    meta: sunoMeta,
    examples: [
      {
        title: "Music generation",
        request: {
          model: "suno_music",
          content: [{ type: "text", text: "uplifting cinematic pop with warm piano and clear chorus" }],
          parameters: { operation: "music" },
          meta: {
            mv: "chirp-v5-5",
            title: "Warm Horizon",
            tags: "cinematic pop, warm piano",
            make_instrumental: false,
          },
        },
      },
      {
        title: "Lyrics",
        request: {
          model: "suno_music",
          content: [{ type: "text", text: "write a hopeful chorus about sunrise after a storm" }],
          parameters: { operation: "lyrics" },
        },
      },
      {
        title: "Sound effect",
        request: {
          model: "suno_music",
          content: [{ type: "text", text: "ambient music with gentle rain and distant thunder" }],
          parameters: { operation: "music" },
          meta: {
            task: "sound",
            mv: "chirp-v5-5",
            metadata_params: { sound: "gentle rain ambience with distant thunder" },
            title: "Gentle Rain",
            tags: "ambient, rain, cinematic",
            make_instrumental: true,
          },
        },
      },
      {
        title: "Image to song",
        request: {
          model: "suno_music",
          content: [
            { type: "text", text: "turn this image into a short hopeful pop song" },
            { type: "image", source: { type: "url", url: "https://picsum.photos/512/512" } },
          ],
          parameters: { operation: "music" },
          meta: {
            task: "image_to_song",
            mv: "chirp-v5-5",
            metadata_params: {
              image_url: "https://picsum.photos/512/512",
              prompt: "turn this image into a short hopeful pop song",
            },
          },
        },
      },
    ],
  },
] satisfies GenerationModelDeclaration[];

export const builtinGenerationModels: GenerationModelDeclaration[] = cloneJson(builtinModels);

export function getBuiltinGenerationModel(model: string): GenerationModelDeclaration | null {
  return cloneJson(builtinModels.find((declaration) => declaration.model === model) ?? null);
}

export function listBuiltinGenerationModels(): GenerationModelDeclaration[] {
  return cloneJson(builtinModels);
}
