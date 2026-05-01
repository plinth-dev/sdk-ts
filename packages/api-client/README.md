# `@plinth-dev/api-client`

Server-only typed fetch wrapper for Next.js. Named API registry, retries on 5xx/429 with exponential backoff, abort-signal propagation, RFC 7807 problem+json auto-parsing. **Never throws on HTTP errors** — returns `ApiResponse<T>` with `success: boolean`. The caller writes one branch.

Design rationale: <https://plinth.run/sdk/ts/api-client/>.

## Install

```bash
pnpm add @plinth-dev/api-client
```

## Minimum example

```ts
// app/api-clients.server.ts — registered once at module init
import "server-only";
import { register } from "@plinth-dev/api-client";
import { cookies } from "next/headers";

register("items-api", {
  baseUrl: process.env.ITEMS_API_URL!,
  authHeader: async () => {
    const session = (await cookies()).get("session")?.value;
    return session ? `Bearer ${session}` : null;
  },
  timeoutMs: 10_000,
});
```

```tsx
// app/(module)/items/[id]/page.tsx
import { api } from "@plinth-dev/api-client";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const res = await api("items-api").get<Item>(`/items/${id}`);

  if (!res.success) {
    if (res.error!.code === "not_found") notFound();
    throw new Error(res.error!.message);
  }
  return <ItemView item={res.data!} />;
}
```

## Behaviour

- **Never throws on HTTP errors.** A 404, 500, network failure, timeout — all return `{ success: false, error: {...}, data: null, meta: {...} }`. One branch.
- **Auto-parses RFC 7807 problem+json.** When the response Content-Type is `application/problem+json` (the shape `sdk-go/errors`'s middleware emits), `error.code`, `error.message`, `error.fields` are populated from the body. Other error responses get `{ code: "unknown", message: <body text> }`.
- **Retries 5xx + 429 with exponential backoff** (default 2 retries, 100 ms initial, doubling). Retry list is configurable. Network errors and timeouts also retry.
- **Abort propagation.** If `init.signal` is provided, it cascades through retries. Server-component cancellation (Next.js's request abort) thus actually cancels in-flight retries.
- **Trace propagation.** Wire OTel via `setTraceHeaderFunc` once at app init; the function is called per request and its output is merged into the request headers. Compatible with `@opentelemetry/api`'s `propagation.inject`.
- **Per-call header override.** Pass `init.headers`; per-call wins over `defaultHeaders`.

## API at a glance

| Symbol | Purpose |
|---|---|
| `register(name, config)` | Register a named API. Re-registering replaces. |
| `api(name)` | Returns a typed `ApiClient` with `get`/`post`/`put`/`patch`/`delete`. Throws if name unregistered (programmer error). |
| `ApiResponse<T>` | `{ data, success, error, meta }`. The single shape every call returns. |
| `ApiError` | `{ status, code, message, fields? }`. |
| `setTraceHeaderFunc(fn)` | Wire OTel propagation. |
| `setFetchImpl(impl)` | Test-only override for the underlying fetch. |
| `clearRegistry()` | Test-only reset. |

## Compatibility

- **Server-only**: uses `Headers`, `Response`, `AbortController`, `fetch` — all available in Node 20+ and Next.js Server Components / actions.
- **Node 20+** (native fetch).
- **TypeScript 5.9+** for `verbatimModuleSyntax`.
- ESM-only.

## License

MIT — see [LICENSE](./LICENSE).
