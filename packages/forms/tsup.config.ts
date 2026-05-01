import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { "server/index": "src/server/index.ts" },
    format: ["esm"],
    dts: true,
    clean: true,
    sourcemap: true,
    target: "es2022",
    splitting: false,
    treeshake: true,
    external: ["react", "zod"],
  },
  {
    entry: { "client/index": "src/client/index.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    target: "es2022",
    splitting: false,
    treeshake: true,
    external: ["react", "zod", "../server/index.js"],
  },
]);
