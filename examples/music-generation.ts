import { createGenerationClient } from "@neta-art/generation";

const apiKey = process.env.NETA_ROUTER_API_KEY;
if (!apiKey) throw new Error("NETA_ROUTER_API_KEY is required");

const client = createGenerationClient({ apiKey });

const output = await client.generate({
  model: "suno_music",
  content: [{ type: "text", text: "uplifting cinematic pop with warm piano and clear chorus" }],
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
