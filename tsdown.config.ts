import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/builtins.ts", "src/cli/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  shims: true,
});
