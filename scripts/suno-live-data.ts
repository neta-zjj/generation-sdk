import type { GenerateRequest } from "../src/index.js";

export type SunoLiveTask =
  | "music"
  | "sound"
  | "infill"
  | "cover"
  | "image_to_song"
  | "video_to_song"
  | "vox"
  | "upsample_tags"
  | "upload_audio";

export const sunoLiveTasks: SunoLiveTask[] = [
  "music",
  "sound",
  "infill",
  "cover",
  "image_to_song",
  "video_to_song",
  "vox",
  "upsample_tags",
  "upload_audio",
];

const DEFAULT_POLL_INTERVAL = 5;
const DEFAULT_MAX_WAIT = 900;

const seed = {
  taskId: "task_x2y4RHi6zGYLhuGd0yNGl6UY01OD6hPJ",
  clipId: "18422034-4d82-4205-ad53-26e66708982c",
  acapellaAudioUrl: "http://cdnimg.exbapp.com/ai/2024-06-18/d416d9c3c34eb22c7d8c094831d8dbd0.mp3",
  imageUrl: "https://upload.wikimedia.org/wikipedia/commons/thumb/3/36/Hopetoun_falls.jpg/640px-Hopetoun_falls.jpg",
  videoUrl: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4",
};

function title(task: string): string {
  return `SDK ${task.replaceAll("_", " ")} ${new Date().toISOString().slice(5, 16).replace(/[-:T]/g, "")}`;
}

function taskModelRequest(
  model: string,
  meta: Record<string, unknown>,
  content: GenerateRequest["content"],
): GenerateRequest {
  return {
    model,
    content,
    parameters: { poll_interval: DEFAULT_POLL_INTERVAL, max_wait: DEFAULT_MAX_WAIT },
    meta,
  };
}

export function buildSunoLiveRequest(task: SunoLiveTask): GenerateRequest {
  const basePrompt = "short original hopeful instrumental pop, warm piano, clear chorus";
  switch (task) {
    case "music":
      return taskModelRequest(
        "suno_music_chirp_fenix",
        {
          title: title(task),
          tags: "hopeful pop, warm piano",
          make_instrumental: true,
        },
        [{ type: "text", text: basePrompt }],
      );
    case "sound":
      return taskModelRequest(
        "suno_sound_chirp_v5",
        {
          title: title(task),
          tags: "ambient, rain, cinematic",
          make_instrumental: true,
          metadata_params: { sound: "gentle rain ambience with distant thunder" },
        },
        [{ type: "text", text: "gentle rain ambience with distant thunder" }],
      );
    case "infill":
      return taskModelRequest(
        "suno_infill_chirp_v5",
        {
          title: title(task),
          tags: "hopeful pop, warm piano",
          make_instrumental: true,
          task_id: seed.taskId,
          clip_id: seed.clipId,
          continue_clip_id: seed.clipId,
          continue_at: 20,
          metadata_params: {
            continue_clip_id: seed.clipId,
            continued_aligned_prompt: "replace this section with a brighter warm piano phrase",
            infill_start_s: 8,
            infill_end_s: 14,
            infill_context_start_s: 0,
            infill_context_end_s: 32,
            metadata: { infill_lyrics: "brighter warm piano phrase" },
          },
        },
        [{ type: "text", text: basePrompt }],
      );
    case "cover":
      return taskModelRequest(
        "suno_cover_chirp_v5",
        {
          title: title(task),
          tags: "hopeful pop, warm piano",
          make_instrumental: false,
          task_id: seed.taskId,
          cover_clip_id: seed.clipId,
          continue_clip_id: seed.clipId,
          continue_at: 20,
        },
        [
          {
            type: "text",
            text: "[Verse]\nnew hopeful lyrics over warm piano\n[Chorus]\ncarry us home in morning light",
          },
        ],
      );
    case "vox":
      return taskModelRequest(
        "suno_vox_chirp_v5",
        {
          title: title(task),
          tags: "pop,female voice",
          make_instrumental: false,
          artist_clip_id: seed.clipId,
        },
        [{ type: "text", text: "[Verse]\nnew hopeful lyrics\n[Chorus]\nwarm piano carries us home" }],
      );
    case "image_to_song": {
      const prompt = "short original instrumental inspired by a quiet waterfall, warm piano";
      const metadataParams = {
        prompt,
        tags: "ambient instrumental, warm piano",
        image_url: seed.imageUrl,
      };
      return taskModelRequest(
        "suno_image_to_song_chirp_v5",
        {
          title: title(task),
          tags: "ambient instrumental, warm piano",
          negative_tags: "",
          generation_type: "TEXT",
          make_instrumental: true,
          prompt,
          gpt_description_prompt: prompt,
          image_url: seed.imageUrl,
          metadata: { create_mode: "custom" },
          metadataParams,
          metadata_params: metadataParams,
        },
        [
          { type: "text", text: prompt },
          { type: "image", source: { type: "url", url: seed.imageUrl } },
        ],
      );
    }
    case "video_to_song": {
      const prompt = "short original instrumental inspired by a slow flower video, warm piano";
      const metadataParams = {
        prompt,
        tags: "cinematic instrumental, warm piano",
        video_url: seed.videoUrl,
      };
      return taskModelRequest(
        "suno_video_to_song_chirp_v5",
        {
          title: title(task),
          tags: "cinematic instrumental, warm piano",
          negative_tags: "",
          generation_type: "TEXT",
          make_instrumental: true,
          prompt,
          gpt_description_prompt: prompt,
          video_url: seed.videoUrl,
          metadata: { create_mode: "custom" },
          metadataParams,
          metadata_params: metadataParams,
        },
        [
          { type: "text", text: prompt },
          { type: "video", source: { type: "url", url: seed.videoUrl } },
        ],
      );
    }
    case "upsample_tags":
      return {
        model: "suno_style_tags",
        content: [{ type: "text", text: "hopeful pop, warm piano, clear chorus" }],
      };
    case "upload_audio":
      return {
        model: "suno_upload_audio",
        content: [{ type: "audio", source: { type: "url", url: seed.acapellaAudioUrl } }],
        parameters: { poll_interval: DEFAULT_POLL_INTERVAL, max_wait: DEFAULT_MAX_WAIT },
      };
  }
}
