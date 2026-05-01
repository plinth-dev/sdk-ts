# `@plinth-dev/authz`

Server-only Cerbos PDP client. TypeScript counterpart of [`sdk-go/authz`](https://plinth.run/sdk/go/authz/) — same fail-closed contract, same `Decision` shape, same batched-check semantics. Used by Next.js Server Components, server actions, and API route handlers.

The package is server-only — `import "server-only"` at the top — so accidentally pulling it into a Client Component is a build error.

Design rationale: <https://plinth.run/sdk/ts/authz/>.

## Install

```bash
pnpm add @plinth-dev/authz
```

## Minimum example

```ts
// lib/authz.server.ts
import "server-only";
import { getClient } from "@plinth-dev/authz";

// First call reads CERBOS_ADDRESS / CERBOS_TLS / NODE_ENV; cached afterwards.
export const authz = getClient();
```

```tsx
// app/(module)/items/[id]/layout.tsx
import { getClient } from "@plinth-dev/authz";
import { PermissionsProvider } from "@plinth-dev/authz-react";
import { requireAuth } from "@/lib/auth";

export default async function Layout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const user = await requireAuth();
  const { id } = await params;

  // ONE gRPC round-trip for the route's full permission set.
  const permissions = await getClient().permissionMap(
    { id: user.id, roles: user.roles, auxData: { jwt: user.token } },
    { kind: "Item", id },
    ["read", "update", "delete", "comment"],
  );

  return <PermissionsProvider permissions={permissions}>{children}</PermissionsProvider>;
}
```

## Behaviour

- **Fail-closed.** `checkAction`, `checkActions`, `permissionMap` never reject. Any error (network, gRPC, timeout, abort, missing-result) resolves with `{ allowed: false, reason: "Unreachable" }`. The caller writes one branch.
- **Bypass mode.** `CERBOS_ALLOW_BYPASS=1` AND `envName !== "production"` returns `{ allowed: true, reason: "Bypassed" }` and emits a `logger.warn` per call. **Constructing an `AuthzClient` with `envName="production"` and `CERBOS_ALLOW_BYPASS=1` throws `BypassInProductionError`** at construction time.
- **Batched check is primary.** `checkActions(p, r, [...])` issues one gRPC round-trip for many actions on the same resource — matches `<PermissionsProvider>`'s consumer pattern.
- **Pinger.** `client.ping()` calls Cerbos's `serverInfo`. Throws on PDP error (the only public method that can reject); suitable for use as a readiness probe.

## API at a glance

| Symbol | Purpose |
|---|---|
| `new AuthzClient(opts, backend?)` | Construct a client. `backend` is for tests; production code passes only `opts`. |
| `getClient()` | Returns the lazy singleton, configured from `process.env`. Tests can `resetClient()`. |
| `Decision { allowed, reason, action? }` | The outcome shape. `Reason` is `"Allowed" \| "Denied" \| "Unreachable" \| "Bypassed"`. |
| `Principal { id, roles, attributes?, auxData? }` | Actor identity; `auxData.jwt` carries the raw bearer token for Cerbos's `$jwtClaims`. |
| `Resource { kind, id, attributes? }` | What's being acted on. |
| `BypassInProductionError` | Thrown by the constructor when bypass-in-production is detected. |

## Boundaries

- **Server-only.** `import "server-only"` is the build-time enforcement. Accidentally importing this from a Client Component is a build error in Next.js. (For tests, see "Testing" below.)
- **Does not load policies.** Cerbos PDP loads policies; this package never sees them.
- **Does not cache decisions.** The PDP is fast (~1ms p99 in-cluster); caching would mask policy hot-reload.
- **Does not validate JWTs.** Pass the raw token via `Principal.auxData.jwt`; Cerbos's `$jwtClaims` accessor reads it.
- **Does not emit audit.** Audit emission is a separate concern (TS audit package not yet shipped; modules can use `sdk-go/audit` from a Go service or wire their own).

## Testing

The `server-only` runtime check throws unless bundlers apply the `react-server` export condition (Next.js bundlers do; Vitest doesn't). Stub it in your test setup:

```ts
// vitest.setup.ts
const path = require.resolve("server-only");
require.cache[path] = { id: path, filename: path, exports: {}, loaded: true } as NodeModule;
```

Then construct an `AuthzClient` with the second argument — a `CerbosBackend` interface — set to a fake. The interface is exported for this purpose.

## Compatibility

- **Node 20+** (server-only runtime).
- **TypeScript 5.9+** for `verbatimModuleSyntax`.
- **`@cerbos/grpc` 0.26+** as a runtime dependency.
- **`server-only` 0.0.1** (the React-team marker package).
- ESM-only (`type: "module"`).

## License

MIT — see [LICENSE](./LICENSE).
