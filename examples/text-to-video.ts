import { createGenerationClient } from "@neta-art/generation";

const apiKey = process.env.NETA_ROUTER_API_KEY;
if (!apiKey) throw new Error("NETA_ROUTER_API_KEY is required");

const client = createGenerationClient({ apiKey });

const response = await client.generate({
  model: "seedance-2-0-fast",
  content: [{ type: "text", text: "a cat playing piano in a cozy jazz club, cinematic lighting" }],
  parameters: { duration: 5, resolution: "720p", aspect_ratio: "16:9" },
});

console.log(response);
