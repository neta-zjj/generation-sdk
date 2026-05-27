import { cp, mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });
await cp("models", "dist/models", { recursive: true });
