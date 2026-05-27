import { createGenerationClient } from "@neta-art/generation";

const client = createGenerationClient({ apiKey: process.env.NETA_ROUTER_API_KEY });

const output = await client.generate({
  model: "seedance-2-0-fast",
  content: [{ type: "text", text: "a cat playing piano in a cozy jazz club, cinematic lighting" }],
  parameters: { duration: 5, resolution: "720p", aspect_ratio: "16:9" },
});

console.log(output);
