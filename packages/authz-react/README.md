# `@plinth-dev/authz-react`

The client-side complement to [`@plinth-dev/authz`](../authz). Consumes a `PermissionMap` (boolean record) fetched once per route at the server-side layout, and exposes it to every descendant via `usePermissions()` and the declarative `<Can>` gate.

Permissions are pre-resolved server-side; the hook is **synchronous** — no loading state, no client-side Cerbos calls.

Design rationale: <https://plinth.run/sdk/ts/authz-react/>.

## Install

```bash
pnpm add @plinth-dev/authz-react
```

## The pattern

```tsx
// app/(module)/items/[id]/layout.tsx — Server Component
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

  // ONE gRPC round-trip for the whole route's permissions.
  const permissions = await getClient().permissionMap(
    { id: user.id, roles: user.roles, auxData: { jwt: user.token } },
    { kind: "Item", id },
    ["read", "update", "delete", "comment"],
  );

  return <PermissionsProvider permissions={permissions}>{children}</PermissionsProvider>;
}
```

```tsx
// Anywhere below the layout — Server or Client Component
import { Can, usePermissions } from "@plinth-dev/authz-react";

export default function Page() {
  return (
    <article>
      {/* Conditional rendering — children hidden when not allowed */}
      <Can action="comment">
        <CommentButton />
      </Can>

      {/* With fallback — explicit forbidden state */}
      <Can action="delete" fallback={<span className="text-muted">Read-only</span>}>
        <DeleteButton />
      </Can>
    </article>
  );
}

// Client Component using the hook directly
"use client";
import { usePermissions } from "@plinth-dev/authz-react";

export function ConditionalToolbar() {
  const perms = usePermissions();
  if (!perms.hasAny(["update", "delete"])) return null;
  return <Toolbar />;
}
```

## API

| Symbol | Purpose |
|---|---|
| `<PermissionsProvider permissions={...} strategy?>` | Wrap a route. `strategy="merge"` overlays onto the parent provider; default `"replace"` discards parent. |
| `usePermissions()` | Returns `{ has(action), hasAny([...]), hasAll([...]), raw }`. Throws in dev outside a provider; falls back to all-false in production. |
| `<Can action fallback?>` | Renders children when allowed; `fallback` (or nothing) when not. |
| `<CanAny actions fallback?>` | Renders when ANY action is allowed. |
| `<CanAll actions fallback?>` | Renders only when ALL actions are allowed. |

### Types

```ts
type PermissionMap = Record<string, boolean>;

interface UsePermissions {
  has: (action: string) => boolean;
  hasAny: (actions: readonly string[]) => boolean;
  hasAll: (actions: readonly string[]) => boolean;
  raw: PermissionMap;
}
```

## Behaviour

- **Permissions are pre-resolved server-side.** The hook is synchronous; no loading state.
- **Provider-throws-in-dev, falls-back-in-prod.** `usePermissions()` outside a `<PermissionsProvider>` throws in development (catches missing-wrapper bugs immediately) and returns an all-false map in production (fail-closed, never undefined).
- **Missing actions are not allowed.** `has("nonexistent")` returns `false`; the layout's `permissionMap` should include every action descendants will ask about.
- **Tree-shakeable.** Each export lives in a small file; `sideEffects: false` means `<Can>`-only consumers don't bundle the hook and vice versa.

## Boundaries

- **Does not call Cerbos.** Ever. `@plinth-dev/authz` (server-only) is the only path to Cerbos.
- **Does not refresh permissions.** Stale UI until the next route navigation re-runs the layout. Refresh-on-WebSocket adds complexity we don't want in v0.1.0.
- **Does not expose roles.** Action-only API; roles are policy-internal.

## Compatibility

- **React 19+**.
- **Node 20+** for the build toolchain.
- ESM-only (`type: "module"`).
- Tree-shakeable (`sideEffects: false`).

## License

MIT — see [LICENSE](./LICENSE).
