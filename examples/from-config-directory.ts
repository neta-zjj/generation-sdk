import { createGenerationClientFromDirectory } from "@neta-art/generation";

const client = await createGenerationClientFromDirectory("./models", {
  apiKey: process.env.NETA_ROUTER_API_KEY,
});

console.log(client.listModels().map((model) => model.model));
