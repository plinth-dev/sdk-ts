import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  splitting: false,
  // No treeshake — rollup's tree-shaking strips the top-level
  // "use client" directive that Next.js reads to mark this as a
  // Client Component module. Letting esbuild run alone preserves it.
  external: ["react"],
  banner: { js: '"use client";' },
});
