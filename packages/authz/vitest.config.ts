import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Vitest doesn't apply the "react-server" export condition by default,
    // so the `server-only` package's runtime check fires and tests can't
    // even load. Stub it to a literal empty module via setup.
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
