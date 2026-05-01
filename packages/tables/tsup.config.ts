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
    // Preserve "use client" — without this Next.js builds the entry as
    // a Server Component and the React hooks (useRouter, useState,
    // useMemo) error at build time.
    banner: { js: '"use client";' },
  },
  {
    entry: { server: "src/server.ts" },
    format: ["esm"],
    dts: true,
    sourcemap: true,
    target: "es2022",
  },
]);
