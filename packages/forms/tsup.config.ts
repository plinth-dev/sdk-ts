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
    // No treeshake — treeshake (rollup) strips the "use client"
    // directive from the source files, and esbuild's banner option
    // gets re-stripped under treeshake too. Letting esbuild run alone
    // preserves the directive.
    external: ["react", "zod", "../server/index.js"],
    banner: { js: '"use client";' },
  },
]);
