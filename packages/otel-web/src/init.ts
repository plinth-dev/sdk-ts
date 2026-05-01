import {
  context,
  propagation,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import { ZoneContextManager } from "@opentelemetry/context-zone";
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from "@opentelemetry/core";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { registerInstrumentations } from "@opentelemetry/instrumentation";
import { DocumentLoadInstrumentation } from "@opentelemetry/instrumentation-document-load";
import { FetchInstrumentation } from "@opentelemetry/instrumentation-fetch";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  SimpleSpanProcessor,
  type SpanExporter,
  TraceIdRatioBasedSampler,
} from "@opentelemetry/sdk-trace-base";
import { WebTracerProvider } from "@opentelemetry/sdk-trace-web";
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";

// Stable string for deployment environment. semconv exposes the constant
// under /incubating; we hardcode the wire value to avoid the subpath import.
const ATTR_DEPLOYMENT_ENVIRONMENT_NAME = "deployment.environment.name";

/**
 * Configuration for {@link initWebOtel}. `serviceName`, `serviceVersion`,
 * and `moduleName` are required; the rest fall back to sensible defaults.
 */
export interface OtelWebOptions {
  /** Should match the API's `service.name` (e.g. `"items-web"`). */
  serviceName: string;
  /** Build-time version (typically injected via `NEXT_PUBLIC_VERSION`). */
  serviceVersion: string;
  /** Plinth module name (e.g. `"items"`). Populates `module.name`. */
  moduleName: string;
  /** `"production"` | `"staging"` | `"dev"`. Drives default sampling. */
  environment: string;

  /**
   * OTLP/HTTP traces endpoint. Default: the in-cluster collector address
   * (the platform chart terminates traffic from the browser at a public
   * ingress). Pass `undefined` to disable export entirely.
   */
  exporterEndpoint?: string;

  /**
   * `[0, 1]` sample ratio. Defaults: `0.05` in production, `0.5` in
   * staging, `1.0` in dev.
   */
  sampleRate?: number;

  /** Extra resource attributes; merged with the defaults. */
  resourceAttributes?: Record<string, string>;

  /**
   * If false (default), URL query strings and fragments are redacted from
   * fetch span URLs (`https://api/users?token=...` becomes
   * `https://api/users`). Set true ONLY for debugging.
   */
  retainFullUrls?: boolean;

  /**
   * Override the SpanExporter. Tests inject in-memory recorders;
   * production usually leaves this nil and lets initWebOtel build the
   * OTLP exporter.
   */
  exporter?: SpanExporter;

  /**
   * If true, use a SimpleSpanProcessor (synchronous flush). Tests should
   * pass true so spans are visible immediately after `span.end()`.
   * Production uses a BatchSpanProcessor with the SDK defaults.
   */
  useSimpleProcessor?: boolean;
}

const PLINTH_OTEL_WEB_TRACER = "@plinth-dev/otel-web";

let initialised = false;
let activeProvider: WebTracerProvider | null = null;

/**
 * Configure the global tracer provider, propagator, resource, and
 * auto-instrumentations.
 *
 * Idempotent: calling more than once logs a warning and returns. Use
 * {@link resetForTests} between tests if you want a fresh provider.
 */
export function initWebOtel(opts: OtelWebOptions): void {
  if (initialised) {
    if (typeof console !== "undefined") {
      console.warn(
        "@plinth-dev/otel-web: initWebOtel already called; skipping re-init",
      );
    }
    return;
  }

  if (!opts.serviceName) {
    throw new Error("initWebOtel: serviceName is required");
  }
  if (!opts.serviceVersion) {
    throw new Error("initWebOtel: serviceVersion is required");
  }
  if (!opts.moduleName) {
    throw new Error("initWebOtel: moduleName is required");
  }
  if (!opts.environment) {
    throw new Error("initWebOtel: environment is required");
  }

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: opts.serviceName,
    [ATTR_SERVICE_VERSION]: opts.serviceVersion,
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: opts.environment,
    "module.name": opts.moduleName,
    ...(opts.resourceAttributes ?? {}),
  });

  const sampleRate = opts.sampleRate ?? defaultSampleRate(opts.environment);
  const sampler = new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(sampleRate),
  });

  const exporter = buildExporter(opts);
  const processor = exporter
    ? opts.useSimpleProcessor
      ? new SimpleSpanProcessor(exporter)
      : new BatchSpanProcessor(exporter)
    : null;

  const provider = new WebTracerProvider({
    resource,
    sampler,
    spanProcessors: processor ? [processor] : [],
  });

  provider.register({
    contextManager: new ZoneContextManager(),
    propagator: new CompositePropagator({
      propagators: [
        new W3CTraceContextPropagator(),
        new W3CBaggagePropagator(),
      ],
    }),
  });

  activeProvider = provider;

  registerInstrumentations({
    instrumentations: [
      new DocumentLoadInstrumentation(),
      new FetchInstrumentation({
        applyCustomAttributesOnSpan: opts.retainFullUrls
          ? undefined
          : (span, request) => {
              const url = readUrl(request);
              if (url) {
                const cleaned = stripQueryAndFragment(url);
                span.setAttribute("http.url", cleaned);
              }
            },
      }),
    ],
  });

  initialised = true;
}

/** True if {@link initWebOtel} has been called. Useful in tests. */
export function isInitialised(): boolean {
  return initialised;
}

/**
 * Reset the module-scoped state. Test-only — never call from app code.
 * After this, a subsequent {@link initWebOtel} call will run as if fresh.
 */
export function resetForTests(): void {
  if (activeProvider) {
    void activeProvider.shutdown();
    activeProvider = null;
  }
  initialised = false;
  trace.disable();
  context.disable();
  propagation.disable();
}

function defaultSampleRate(environment: string): number {
  switch (environment) {
    case "production":
      return 0.05;
    case "staging":
      return 0.5;
    default:
      return 1.0;
  }
}

function buildExporter(opts: OtelWebOptions): SpanExporter | null {
  if (opts.exporter !== undefined) return opts.exporter;
  if (opts.exporterEndpoint === undefined && opts.exporter === undefined) {
    return new OTLPTraceExporter();
  }
  if (opts.exporterEndpoint === "") {
    return null;
  }
  return new OTLPTraceExporter({ url: opts.exporterEndpoint });
}

function readUrl(request: Request | RequestInit | string): string | undefined {
  if (typeof request === "string") return request;
  if (request instanceof Request) return request.url;
  return undefined;
}

function stripQueryAndFragment(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    // Relative URLs throw on `new URL(...)` without a base; do a manual
    // strip as fallback.
    const fragmentIdx = rawUrl.indexOf("#");
    let result = fragmentIdx >= 0 ? rawUrl.slice(0, fragmentIdx) : rawUrl;
    const queryIdx = result.indexOf("?");
    if (queryIdx >= 0) result = result.slice(0, queryIdx);
    return result;
  }
}

// ── Span helpers (re-exports of common OTel idioms with one less import) ──

/**
 * Run `fn` inside an active span named `name`. Span is ended automatically;
 * exceptions are recorded and re-thrown.
 *
 *   await withSpan("items.publish", async () => {
 *     await api.publish(item);
 *   });
 */
export function withSpan<T>(name: string, fn: () => T): T;
export function withSpan<T>(name: string, fn: () => Promise<T>): Promise<T>;
export function withSpan<T>(
  name: string,
  fn: () => T | Promise<T>,
): T | Promise<T> {
  const tracer = trace.getTracer(PLINTH_OTEL_WEB_TRACER);
  const span = tracer.startSpan(name);
  const ctx = trace.setSpan(context.active(), span);

  // We use startSpan + context.with rather than startActiveSpan because
  // startActiveSpan's async-callback variant has a quirk where setStatus
  // calls in the catch path don't always reflect on the exported span
  // (verified empirically on @opentelemetry/sdk-trace-web 2.7).
  let maybePromise: T | Promise<T>;
  try {
    maybePromise = context.with(ctx, fn);
  } catch (err) {
    span.recordException(err as Error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: errMessage(err) });
    span.end();
    throw err;
  }

  // Duck-type rather than `instanceof Promise` — Vitest can serve init.ts
  // and the test file from different realms, breaking instanceof checks
  // across the boundary.
  if (isThenable(maybePromise)) {
    return (async () => {
      try {
        const value = await maybePromise;
        span.end();
        return value;
      } catch (err) {
        span.recordException(err as Error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: errMessage(err),
        });
        span.end();
        throw err;
      }
    })() as Promise<T>;
  }

  span.end();
  return maybePromise;
}

/**
 * Tag the currently-active span with an exception and set its status to
 * Error. No-op if no active span is in context. Convenience over the
 * verbose two-line pattern.
 */
export function recordError(err: Error, attrs?: Record<string, string>): void {
  const span = trace.getActiveSpan();
  if (!span) return;
  span.recordException(err);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      span.setAttribute(k, v);
    }
  }
  span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Cross-realm-safe Promise check. `value instanceof Promise` returns false
 * when `value` was created by a different realm's Promise constructor —
 * Vitest's module loader can introduce that boundary between source and
 * test files. Duck-type the `.then` method instead.
 */
function isThenable<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof (value as { then?: unknown })?.then === "function";
}
