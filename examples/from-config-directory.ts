import { createGenerationClientFromDirectory } from "@neta-art/generation";

const apiKey = process.env.NETA_ROUTER_API_KEY;
if (!apiKey) throw new Error("NETA_ROUTER_API_KEY is required");

const client = await createGenerationClientFromDirectory("./models", {
  apiKey,
});

console.log(client.listModels().map((model) => model.model));
