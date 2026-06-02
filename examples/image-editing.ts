import { createGenerationClient } from "@neta-art/generation";

const apiKey = process.env.NETA_ROUTER_API_KEY;
if (!apiKey) throw new Error("NETA_ROUTER_API_KEY is required");

const client = createGenerationClient({ apiKey });

const response = await client.generate({
  model: "gemini-3.1-flash-image-preview",
  content: [
    { type: "text", text: "turn this portrait into a watercolor illustration, keep the same pose" },
    { type: "image", source: { type: "url", url: "https://example.com/portrait.jpg" } },
  ],
  parameters: { aspect_ratio: "3:4", image_size: "2K" },
});

console.log(response);
