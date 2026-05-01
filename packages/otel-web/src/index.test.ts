import { trace } from "@opentelemetry/api";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  initWebOtel,
  isInitialised,
  recordError,
  resetForTests,
  withSpan,
} from "./init.js";

const TRACER = "test";

const baseOpts = {
  serviceName: "test-svc",
  serviceVersion: "0.0.0-test",
  moduleName: "test-module",
  environment: "dev",
  useSimpleProcessor: true,
};

beforeEach(() => {
  resetForTests();
});
afterEach(() => {
  resetForTests();
});

// ── Required options ─────────────────────────────────────────────

describe("initWebOtel — required options", () => {
  it("throws without serviceName", () => {
    expect(() =>
      initWebOtel({
        ...baseOpts,
        serviceName: "",
        exporter: new InMemorySpanExporter(),
      }),
    ).toThrow(/serviceName/);
  });

  it("throws without serviceVersion", () => {
    expect(() =>
      initWebOtel({
        ...baseOpts,
        serviceVersion: "",
        exporter: new InMemorySpanExporter(),
      }),
    ).toThrow(/serviceVersion/);
  });

  it("throws without moduleName", () => {
    expect(() =>
      initWebOtel({
        ...baseOpts,
        moduleName: "",
        exporter: new InMemorySpanExporter(),
      }),
    ).toThrow(/moduleName/);
  });

  it("throws without environment", () => {
    expect(() =>
      initWebOtel({
        ...baseOpts,
        environment: "",
        exporter: new InMemorySpanExporter(),
      }),
    ).toThrow(/environment/);
  });
});

// ── Idempotent init ─────────────────────────────────────────────

describe("initWebOtel — idempotency", () => {
  it("isInitialised reflects state", () => {
    expect(isInitialised()).toBe(false);
    initWebOtel({ ...baseOpts, exporter: new InMemorySpanExporter() });
    expect(isInitialised()).toBe(true);
  });

  it("second call is a no-op", () => {
    initWebOtel({ ...baseOpts, exporter: new InMemorySpanExporter() });
    expect(() =>
      initWebOtel({ ...baseOpts, exporter: new InMemorySpanExporter() }),
    ).not.toThrow();
  });
});

// ── Resource attributes ─────────────────────────────────────────

describe("resource attributes", () => {
  it("populates service.name, service.version, deployment.environment.name, module.name", async () => {
    const exporter = new InMemorySpanExporter();
    initWebOtel({
      ...baseOpts,
      serviceName: "items-web",
      serviceVersion: "1.2.3",
      environment: "production",
      moduleName: "items",
      sampleRate: 1.0,
      exporter,
    });

    const tracer = trace.getTracer(TRACER);
    const span = tracer.startSpan("op");
    span.end();
    await flush(exporter);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    const res = spans[0]!.resource.attributes;
    expect(res["service.name"]).toBe("items-web");
    expect(res["service.version"]).toBe("1.2.3");
    expect(res["deployment.environment.name"]).toBe("production");
    expect(res["module.name"]).toBe("items");
  });

  it("merges resourceAttributes overrides", async () => {
    const exporter = new InMemorySpanExporter();
    initWebOtel({
      ...baseOpts,
      sampleRate: 1.0,
      resourceAttributes: { "deployment.region": "us-east-1" },
      exporter,
    });

    const tracer = trace.getTracer(TRACER);
    const span = tracer.startSpan("op");
    span.end();
    await flush(exporter);

    const res = exporter.getFinishedSpans()[0]!.resource.attributes;
    expect(res["deployment.region"]).toBe("us-east-1");
  });
});

// ── withSpan ─────────────────────────────────────────────────────

describe("withSpan", () => {
  it("creates a span around a sync function", async () => {
    const exporter = new InMemorySpanExporter();
    initWebOtel({ ...baseOpts, sampleRate: 1.0, exporter });

    const result = withSpan("sync-op", () => 42);
    expect(result).toBe(42);
    await flush(exporter);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe("sync-op");
  });

  it("creates a span around an async function", async () => {
    const exporter = new InMemorySpanExporter();
    initWebOtel({ ...baseOpts, sampleRate: 1.0, exporter });

    const result = await withSpan("async-op", async () => 99);
    expect(result).toBe(99);
    await flush(exporter);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.name).toBe("async-op");
  });

  it("records exceptions and re-throws", async () => {
    const exporter = new InMemorySpanExporter();
    initWebOtel({ ...baseOpts, sampleRate: 1.0, exporter });

    expect(() =>
      withSpan("throws", () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");

    await flush(exporter);
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.status.code).toBe(2 /* SpanStatusCode.ERROR */);
    expect(spans[0]!.events.length).toBeGreaterThan(0); // recordException added an event
  });

  it("records async exceptions and re-throws", async () => {
    const exporter = new InMemorySpanExporter();
    initWebOtel({ ...baseOpts, sampleRate: 1.0, exporter });

    await expect(
      withSpan("async-throws", async () => {
        throw new Error("async boom");
      }),
    ).rejects.toThrow("async boom");

    await flush(exporter);
    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.status.code).toBe(2);
  });
});

// ── recordError ─────────────────────────────────────────────────

describe("recordError", () => {
  it("tags the active span when called inside withSpan", async () => {
    const exporter = new InMemorySpanExporter();
    initWebOtel({ ...baseOpts, sampleRate: 1.0, exporter });

    withSpan("with-error", () => {
      recordError(new Error("non-fatal"), { foo: "bar" });
    });
    await flush(exporter);

    const spans = exporter.getFinishedSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0]!.attributes.foo).toBe("bar");
    expect(spans[0]!.events.length).toBeGreaterThan(0);
    expect(spans[0]!.status.code).toBe(2);
  });

  it("is a no-op when no active span", () => {
    initWebOtel({ ...baseOpts, exporter: new InMemorySpanExporter() });
    // Should not throw.
    recordError(new Error("orphan"));
  });
});

// ── Sample rate defaults ────────────────────────────────────────

describe("sample rate", () => {
  // We can't directly inspect the sampler, so this is a smoke test.
  // 1.0 sample rate is exercised by every other test that emits a span.

  it("respects environment defaults via no-throw construction", () => {
    expect(() =>
      initWebOtel({
        ...baseOpts,
        environment: "production",
        exporter: new InMemorySpanExporter(),
      }),
    ).not.toThrow();
  });
});

// ── Helper: force the SimpleSpanProcessor to flush ──────────────

async function flush(exporter: InMemorySpanExporter): Promise<void> {
  // SimpleSpanProcessor exports synchronously on span.end(); but the
  // exporter's `getFinishedSpans` reflects the latest snapshot — small
  // microtask wait covers any deferred work.
  await new Promise((resolve) => setTimeout(resolve, 0));
  void exporter; // silence unused-arg if not needed
}
