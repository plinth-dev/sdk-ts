/**
 * Plinth otel-web: browser OpenTelemetry SDK initialisation.
 *
 * One {@link initWebOtel} call wires the global tracer provider with
 * Plinth's resource attributes, the OTLP/HTTP exporter, the W3C
 * trace-context propagator, and auto-instrumentations for fetch and
 * document-load. Trace context propagates to backend services via the
 * `traceparent` header on outgoing fetch requests.
 *
 * Privacy by default: query strings and fragments are stripped from
 * fetch span URLs. Override with `retainFullUrls: true` for debugging.
 *
 * See https://plinth.run/sdk/ts/otel-web/ for the design rationale.
 */

export type { OtelWebOptions } from "./init.js";
export {
  initWebOtel,
  isInitialised,
  recordError,
  resetForTests,
  withSpan,
} from "./init.js";
export type { OtelProviderProps } from "./provider.js";
export { OtelProvider } from "./provider.js";
