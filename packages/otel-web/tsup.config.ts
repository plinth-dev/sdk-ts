import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  splitting: false,
  treeshake: true,
  external: [
    "react",
    "@opentelemetry/api",
    "@opentelemetry/context-zone",
    "@opentelemetry/exporter-trace-otlp-http",
    "@opentelemetry/instrumentation",
    "@opentelemetry/instrumentation-document-load",
    "@opentelemetry/instrumentation-fetch",
    "@opentelemetry/resources",
    "@opentelemetry/sdk-trace-base",
    "@opentelemetry/sdk-trace-web",
    "@opentelemetry/semantic-conventions",
  ],
});
