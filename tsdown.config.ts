import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/builtins.ts", "src/cli/index.ts"],
  format: ["esm"],
  // Keep .js/.d.ts so package.json exports stay stable for "type": "module" packages.
  // tsdown defaults fixedExtension=true on platform=node, which emits .mjs/.d.mts and breaks exports.
  fixedExtension: false,
  dts: true,
  sourcemap: true,
  clean: true,
  shims: true,
});
