# `@plinth-dev/otel-web`

Browser OpenTelemetry SDK initialisation. One `initWebOtel` call wires the global tracer provider with Plinth's resource attributes (`service.name`, `service.version`, `module.name`, `deployment.environment.name`), the OTLP/HTTP exporter, the W3C trace-context+baggage propagator, and auto-instrumentations for `fetch` and `document-load`.

Trace context propagates to backend services via the `traceparent` header on outgoing fetch requests. Backend's `sdk-go/otel` reads it; the trace continues unbroken across the network.

Design rationale: <https://plinth.run/sdk/ts/otel-web/>.

## Install

```bash
pnpm add @plinth-dev/otel-web
```

## Minimum example

```tsx
// app/layout.tsx — root layout
import { OtelProvider } from "@plinth-dev/otel-web";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <body>
        <OtelProvider
          options={{
            serviceName: "items-web",
            serviceVersion: process.env.NEXT_PUBLIC_VERSION!,
            moduleName: "items",
            environment: process.env.NEXT_PUBLIC_ENV!,
          }}
        >
          {children}
        </OtelProvider>
      </body>
    </html>
  );
}
```

`OtelProvider` calls `initWebOtel` exactly once on mount. After that, every fetch from the page is traced; trace context flows to the backend.

## Manual spans

```tsx
"use client";
import { withSpan, recordError } from "@plinth-dev/otel-web";

export async function publishItem(id: string) {
  return withSpan("items.publish", async () => {
    try {
      const result = await api.publish(id);
      return result;
    } catch (err) {
      recordError(err as Error, { item_id: id });
      throw err;
    }
  });
}
```

## API

| Symbol | Purpose |
|---|---|
| `<OtelProvider options={...}>` | React component. Calls `initWebOtel` on mount; idempotent. |
| `initWebOtel(opts)` | Direct init — useful outside React. |
| `OtelWebOptions` | `serviceName` / `serviceVersion` / `moduleName` / `environment` required; everything else has defaults. |
| `withSpan(name, fn)` | Run `fn` inside an active span. Sync or async; auto-ends; errors recorded + re-thrown. |
| `recordError(err, attrs?)` | Tag the active span with an exception and set status to ERROR. No-op if no active span. |
| `isInitialised()` | Test helper. |
| `resetForTests()` | Test helper — discards the provider so a subsequent `initWebOtel` is fresh. |

## Defaults

- **`exporterEndpoint`**: omitted → `OTLPTraceExporter()` defaults (typically `http://localhost:4318/v1/traces`). Pass `""` to disable export entirely.
- **Sampling**: parent-based ratio. Defaults: `0.05` in production, `0.5` in staging, `1.0` elsewhere.
- **Propagator**: W3C TraceContext + Baggage.
- **Privacy**: fetch span URLs have query strings + fragments redacted (`https://api/users?token=...` becomes `https://api/users`). Set `retainFullUrls: true` only for debugging.
- **Auto-instrumentations**: `FetchInstrumentation`, `DocumentLoadInstrumentation` registered by default.

## Behaviour

- **`initWebOtel` is idempotent.** Subsequent calls log a warning and return.
- **Required options:** `serviceName`, `serviceVersion`, `moduleName`, `environment`. Construction throws if any is missing — fail-fast on misconfiguration.
- **Resource attributes**: composed via `resourceFromAttributes`. `module.name` is the Plinth-specific dimension.
- **Cross-realm-safe Promise check** in `withSpan` (Vitest can serve source/test from different realms; we use `typeof .then === "function"` instead of `instanceof Promise`).

## Testing

`Options.exporter` accepts an `InMemorySpanExporter`. Set `useSimpleProcessor: true` so `span.end()` synchronously exports — no flush needed. Pin `sampleRate: 1.0` so single-span tests aren't probabilistically dropped.

```ts
import { initWebOtel, resetForTests, withSpan } from "@plinth-dev/otel-web";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";

beforeEach(() => resetForTests());

it("works", async () => {
  const exporter = new InMemorySpanExporter();
  initWebOtel({
    serviceName: "test", serviceVersion: "0", moduleName: "test", environment: "dev",
    sampleRate: 1.0, exporter, useSimpleProcessor: true,
  });
  // ... emit a span ...
  const spans = exporter.getFinishedSpans();
  // ... assert ...
});
```

## Compatibility

- Browser (`document` + `fetch` + `Promise`). Server-side rendering loads the module but defers init to the client (the `OtelProvider` wraps a `useEffect`).
- React 19+ peer dep (only for `OtelProvider`; the function-API works without React).
- ESM-only (`type: "module"`).
- Tree-shakeable (`sideEffects: false`).

## License

MIT — see [LICENSE](./LICENSE).
