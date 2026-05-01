import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    target: "es2022",
    external: ["react", "next", "next/navigation", "@tanstack/react-table"],
  },
  {
    entry: { server: "src/server.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    target: "es2022",
  },
]);
