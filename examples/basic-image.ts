import { createGenerationClient } from "@neta-art/generation";

const client = createGenerationClient({
  apiKey: process.env.NETA_ROUTER_API_KEY,
});

const output = await client.generate({
  model: "gpt-image-2",
  content: [{ type: "text", text: "a cinematic portrait of a robot florist, 35mm film" }],
  parameters: { size: "1024x1024", quality: "high" },
});

console.log(output);
