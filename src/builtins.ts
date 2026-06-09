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

const sunoTaskParameters = {
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
} satisfies GenerationModelDeclaration["parameters"];

const sunoCommonMetaFields = {
  title: { type: "string", optional: true, description: "Suno song title." },
  tags: { type: "string", optional: true, description: "Comma-separated Suno music style tags." },
  prompt: { type: "string", optional: true, description: "Provider prompt override." },
  gpt_description_prompt: { type: "string", optional: true, description: "Suno inspiration-mode prompt." },
  negative_tags: { type: "string", optional: true, description: "Styles to avoid." },
  generation_type: { type: "string", optional: true, description: "Suno generation type." },
  make_instrumental: { type: "boolean", optional: true, default: false, description: "Generate instrumental music." },
  metadata: { type: "object", optional: true, description: "Suno provider metadata payload." },
  metadata_params: {
    type: "object",
    optional: true,
    description: "Yunwu/Suno task-specific metadata payload.",
  },
} satisfies NonNullable<GenerationModelDeclaration["meta"]>["fields"];

const sunoContinuationTaskVariant = {
  required: ["continue_clip_id"],
};

const sunoTaskVariants = {
  extend: sunoContinuationTaskVariant,
  upload_extend: sunoContinuationTaskVariant,
  infill: { required: ["continue_clip_id", "metadata_params"] },
  fixed_infill: { required: ["continue_clip_id", "metadata_params"] },
  infill_intro: { required: ["continue_clip_id", "metadata_params"] },
  infill_outro: { required: ["continue_clip_id", "metadata_params"] },
  cover_infill: { required: ["continue_clip_id", "metadata_params"] },
  cover_extend: sunoContinuationTaskVariant,
  artist_infill: { required: ["continue_clip_id", "metadata_params"] },
  artist_consistency: { required: ["persona_id", "artist_clip_id"] },
  cover: { required: ["task_id", "continue_clip_id"] },
  image_to_song: { requiredContent: ["image"], required: ["metadata_params"] },
  video_to_song: { requiredContent: ["video"], required: ["metadata_params"] },
  concat: { required: ["clip_id"] },
  sound: { required: ["metadata_params"] },
  underpainting: { required: ["metadata_params"] },
  overpainting: { required: ["metadata_params"] },
  remaster: { required: ["metadata_params"] },
  vox: { required: ["artist_clip_id"] },
  chop_sample_condition: { required: ["metadata_params"] },
  mashup_condition: { required: ["metadata_params"] },
  playlist_condition: { required: ["metadata_params"] },
} satisfies NonNullable<GenerationModelDeclaration["meta"]>["taskVariants"];

const sunoLegacyMeta = {
  taskField: "task",
  fields: {
    ...sunoCommonMetaFields,
    task: {
      type: "string",
      optional: true,
      enum: Object.keys(sunoTaskVariants),
      description: "Legacy integrated Suno task for operation=music. Prefer task-specific Suno models.",
    },
    mv: { type: "string", optional: true, description: "Legacy Suno music model version override." },
    task_id: {
      type: "string",
      optional: true,
      description: "Existing Suno task id used for continuation-style tasks.",
    },
    clip_id: {
      type: "string",
      optional: true,
      description: "Existing Suno clip id used for legacy task payloads.",
    },
    continue_clip_id: { type: "string", optional: true, description: "Clip id or URL to continue from." },
    continue_at: { type: "number", optional: true, description: "Continue position in seconds." },
    cover_clip_id: { type: "string", optional: true, description: "Clip id to cover." },
    persona_id: { type: "string", optional: true, description: "Suno persona id for artist-consistency tasks." },
    artist_clip_id: { type: "string", optional: true, description: "Source clip id for artist-consistency tasks." },
  },
  taskVariants: sunoTaskVariants,
} satisfies GenerationModelDeclaration["meta"];

function sunoContentInput(
  options: { text?: "required" | "optional" | "none"; audio?: boolean; image?: boolean; video?: boolean } = {},
): GenerationModelDeclaration["content"]["input"] {
  const input: GenerationModelDeclaration["content"]["input"] = [];
  if (options.text !== "none") {
    input.push({
      type: "text",
      required: options.text === "required",
      max: 16,
      merge: "newline",
      description:
        "Prompt text. The adapter maps merged text to the operation's text field when that field is not provided.",
    });
  }
  if (options.audio) {
    input.push({
      type: "audio",
      required: true,
      max: 1,
      sources: ["url", "base64"],
      description: "Reference audio.",
    });
  }
  if (options.image) {
    input.push({
      type: "image",
      required: true,
      max: 1,
      sources: ["url", "base64"],
      description: "Reference image.",
    });
  }
  if (options.video) {
    input.push({
      type: "video",
      required: true,
      max: 1,
      sources: ["url", "base64"],
      description: "Reference video.",
    });
  }
  return input;
}

const sunoVersions = [
  { model: "suno_music_chirp_v3_0", title: "Suno Music Chirp v3.0", mv: "chirp-v3-0" },
  { model: "suno_music_chirp_v3_5", title: "Suno Music Chirp v3.5", mv: "chirp-v3-5" },
  { model: "suno_music_chirp_v4", title: "Suno Music Chirp v4.0", mv: "chirp-v4" },
  { model: "suno_music_chirp_auk", title: "Suno Music Chirp Auk v4.5", mv: "chirp-auk" },
  { model: "suno_music_chirp_v5", title: "Suno Music Chirp v5.0", mv: "chirp-v5" },
  { model: "suno_music_chirp_fenix", title: "Suno Music Chirp Fenix v5.5", mv: "chirp-fenix" },
] as const;

const sunoMusicExample = {
  title: "Music generation",
  request: {
    model: "suno_music_chirp_fenix",
    content: [{ type: "text", text: "uplifting cinematic pop with warm piano and clear chorus" }],
    meta: {
      title: "Warm Horizon",
      tags: "cinematic pop, warm piano",
      make_instrumental: false,
    },
  },
} satisfies NonNullable<GenerationModelDeclaration["examples"]>[number];

function sunoVersionModel(version: (typeof sunoVersions)[number]): GenerationModelDeclaration {
  return {
    schema: MODEL_SCHEMA,
    model: version.model,
    title: version.title,
    description: "Suno text-to-music model with a fixed Yunwu mv version.",
    adapter: { type: "suno.tasks", operation: "music", payload: { mv: version.mv } },
    content: {
      input: sunoContentInput({ text: "required" }),
    },
    parameters: sunoTaskParameters,
    meta: {
      fields: sunoCommonMetaFields,
    },
    ...(version.model === "suno_music_chirp_fenix" ? { examples: [sunoMusicExample] } : {}),
  };
}

function sunoTaskModel(options: {
  model: string;
  title: string;
  description: string;
  task: string;
  mv?: string;
  content?: Parameters<typeof sunoContentInput>[0];
  fields?: NonNullable<GenerationModelDeclaration["meta"]>["fields"];
  examples?: GenerationModelDeclaration["examples"];
}): GenerationModelDeclaration {
  return {
    schema: MODEL_SCHEMA,
    model: options.model,
    title: options.title,
    description: options.description,
    adapter: {
      type: "suno.tasks",
      operation: "music",
      task: options.task,
      payload: { mv: options.mv ?? "chirp-v5" },
    },
    content: {
      input: sunoContentInput(options.content ?? { text: "optional" }),
    },
    parameters: sunoTaskParameters,
    meta: {
      fields: {
        ...sunoCommonMetaFields,
        ...options.fields,
      },
      taskVariants: sunoTaskVariants,
    },
    ...(options.examples ? { examples: options.examples } : {}),
  };
}

const sunoModels = [
  {
    schema: MODEL_SCHEMA,
    model: "suno_music",
    title: "Suno Music",
    description:
      "Legacy Suno music entrypoint. Prefer versioned models such as suno_music_chirp_fenix and task-specific Suno models.",
    adapter: { type: "suno.tasks", defaults: { mv: "chirp-v5" } },
    content: {
      input: [
        ...sunoContentInput({ text: "optional" }),
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
        description: "Legacy Suno endpoint operation. Prefer first-class Suno model names.",
      },
      ...sunoTaskParameters,
    },
    meta: sunoLegacyMeta,
  },
  ...sunoVersions.map(sunoVersionModel),
  {
    schema: MODEL_SCHEMA,
    model: "suno_lyrics",
    title: "Suno Lyrics",
    description: "Suno lyrics generation model.",
    adapter: { type: "suno.tasks", operation: "lyrics" },
    content: {
      input: sunoContentInput({ text: "required" }),
    },
    parameters: sunoTaskParameters,
  },
  {
    schema: MODEL_SCHEMA,
    model: "suno_style_tags",
    title: "Suno Style Tags",
    description: "Suno style tag upsampling model.",
    adapter: { type: "suno.tasks", operation: "upsample_tags" },
    content: {
      input: sunoContentInput({ text: "required" }),
    },
  },
  {
    schema: MODEL_SCHEMA,
    model: "suno_concat",
    title: "Suno Concat",
    description: "Suno clip concatenation model.",
    adapter: { type: "suno.tasks", operation: "concat" },
    content: {
      input: [],
    },
    parameters: sunoTaskParameters,
    meta: {
      fields: {
        clip_id: { type: "string", description: "Clip id to concatenate." },
        is_infill: { type: "boolean", optional: true, description: "Whether the clip is an infill result." },
      },
    },
  },
  {
    schema: MODEL_SCHEMA,
    model: "suno_upload_audio",
    title: "Suno Upload Audio",
    description: "Suno reference-audio upload model.",
    adapter: { type: "suno.tasks", operation: "upload_audio", defaults: { name: "reference-audio", timeout: 120 } },
    content: {
      input: sunoContentInput({ text: "none", audio: true }),
    },
    parameters: sunoTaskParameters,
    meta: {
      fields: {
        name: { type: "string", optional: true, description: "Upload name." },
        timeout: { type: "integer", optional: true, description: "Upload timeout in seconds." },
      },
    },
  },
  sunoTaskModel({
    model: "suno_image_to_song_chirp_v5",
    title: "Suno Image to Song Chirp v5.0",
    description: "Suno image-to-song task with a fixed chirp-v5 engine.",
    task: "image_to_song",
    content: { text: "optional", image: true },
    fields: {
      metadata_params: { type: "object", description: "Image-to-song metadata payload." },
    },
  }),
  sunoTaskModel({
    model: "suno_video_to_song_chirp_v5",
    title: "Suno Video to Song Chirp v5.0",
    description: "Suno video-to-song task with a fixed chirp-v5 engine.",
    task: "video_to_song",
    content: { text: "optional", video: true },
    fields: {
      metadata_params: { type: "object", description: "Video-to-song metadata payload." },
    },
  }),
  sunoTaskModel({
    model: "suno_sound_chirp_v5",
    title: "Suno Sound Chirp v5.0",
    description: "Suno sound-effect generation task with a fixed chirp-v5 engine.",
    task: "sound",
    content: { text: "optional" },
    fields: {
      metadata_params: { type: "object", description: "Sound task metadata payload." },
    },
  }),
  sunoTaskModel({
    model: "suno_remaster_chirp_v5",
    title: "Suno Remaster Chirp v5.0",
    description: "Suno remaster task with a fixed chirp-v5 engine.",
    task: "remaster",
    content: { text: "optional" },
    fields: {
      metadata_params: { type: "object", description: "Remaster metadata with clip_id and variation_category." },
    },
  }),
  sunoTaskModel({
    model: "suno_extend_chirp_v5",
    title: "Suno Extend Chirp v5.0",
    description: "Suno continuation task with a fixed chirp-v5 engine.",
    task: "extend",
    content: { text: "optional" },
    fields: {
      continue_clip_id: { type: "string", description: "Clip id or URL to continue from." },
      continue_at: { type: "number", optional: true, description: "Continue position in seconds." },
    },
  }),
  sunoTaskModel({
    model: "suno_cover_chirp_v5",
    title: "Suno Cover Chirp v5.0",
    description: "Suno cover task with a fixed chirp-v5 engine.",
    task: "cover",
    content: { text: "optional" },
    fields: {
      cover_clip_id: { type: "string", description: "Clip id to cover." },
      task_id: { type: "string", description: "Source Suno task id used for cover routing." },
      continue_clip_id: { type: "string", description: "Source clip id used by the provider cover workflow." },
      continue_at: { type: "number", optional: true, description: "Source clip continuation position in seconds." },
    },
  }),
  sunoTaskModel({
    model: "suno_infill_chirp_v5",
    title: "Suno Infill Chirp v5.0",
    description: "Suno local edit task with a fixed chirp-v5 engine.",
    task: "infill",
    content: { text: "optional" },
    fields: {
      continue_clip_id: { type: "string", description: "Clip id to edit." },
      metadata_params: { type: "object", description: "Infill timing and replacement metadata." },
    },
  }),
  sunoTaskModel({
    model: "suno_underpainting_chirp_v5",
    title: "Suno Underpainting Chirp v5.0",
    description: "Suno add-accompaniment task with a fixed chirp-v5 engine.",
    task: "underpainting",
    content: { text: "optional" },
    fields: {
      metadata_params: { type: "object", description: "Underpainting clip and timing metadata." },
    },
  }),
  sunoTaskModel({
    model: "suno_overpainting_chirp_v5",
    title: "Suno Overpainting Chirp v5.0",
    description: "Suno add-vocal task with a fixed chirp-v5 engine.",
    task: "overpainting",
    content: { text: "optional" },
    fields: {
      metadata_params: { type: "object", description: "Overpainting clip and timing metadata." },
    },
  }),
  sunoTaskModel({
    model: "suno_vox_chirp_v5",
    title: "Suno Vox Chirp v5.0",
    description: "Suno hum-to-song task with a fixed chirp-v5 engine.",
    task: "vox",
    content: { text: "optional" },
    fields: {
      artist_clip_id: { type: "string", description: "Reference hum or vocal clip id." },
    },
  }),
  sunoTaskModel({
    model: "suno_chop_sample_condition_chirp_v5",
    title: "Suno Chop Sample Condition Chirp v5.0",
    description: "Suno sample-to-song task with a fixed chirp-v5 engine.",
    task: "chop_sample_condition",
    content: { text: "optional" },
    fields: {
      metadata_params: { type: "object", description: "Chop-sample clip and timing metadata." },
    },
  }),
  sunoTaskModel({
    model: "suno_mashup_chirp_v5",
    title: "Suno Mashup Chirp v5.0",
    description: "Suno mashup task with a fixed chirp-v5 engine.",
    task: "mashup_condition",
    content: { text: "optional" },
    fields: {
      metadata_params: { type: "object", description: "Mashup metadata with mashup_clip_ids." },
    },
  }),
  sunoTaskModel({
    model: "suno_playlist_condition_chirp_v5",
    title: "Suno Playlist Condition Chirp v5.0",
    description: "Suno inspiration task with a fixed chirp-v5 engine.",
    task: "playlist_condition",
    content: { text: "optional" },
    fields: {
      metadata_params: { type: "object", description: "Playlist inspiration metadata with playlist_clip_ids." },
    },
  }),
] satisfies GenerationModelDeclaration[];

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
  ...sunoModels,
] satisfies GenerationModelDeclaration[];

export const builtinGenerationModels: GenerationModelDeclaration[] = cloneJson(builtinModels);

export function getBuiltinGenerationModel(model: string): GenerationModelDeclaration | null {
  return cloneJson(builtinModels.find((declaration) => declaration.model === model) ?? null);
}

export function listBuiltinGenerationModels(): GenerationModelDeclaration[] {
  return cloneJson(builtinModels);
}
