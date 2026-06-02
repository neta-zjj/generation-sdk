import { createGenerationClient } from "@neta-art/generation";

const apiKey = process.env.NETA_ROUTER_API_KEY;
if (!apiKey) throw new Error("NETA_ROUTER_API_KEY is required");

const client = createGenerationClient({
  apiKey,
});

const response = await client.generate({
  model: "gpt-image-2",
  content: [{ type: "text", text: "a cinematic portrait of a robot florist, 35mm film" }],
  parameters: { size: "1024x1024", quality: "high" },
});

console.log(response);
