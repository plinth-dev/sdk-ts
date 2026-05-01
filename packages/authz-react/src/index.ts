/**
 * Plinth authz-react: client-side permissions consumer for the
 * batched-check-at-layout pattern.
 *
 * The server (typically a Next.js layout) calls `permissionMap()` from
 * `@plinth-dev/authz` once per route, gets back a `Record<string, boolean>`,
 * and passes it to `<PermissionsProvider permissions={...}>`. Every component
 * below the provider gets permissions synchronously via `usePermissions()`
 * or the declarative `<Can>` gate — no further round-trips, no loading state.
 *
 * See https://plinth.run/sdk/ts/authz-react/ for the design rationale.
 */

export type { CanAllProps, CanAnyProps, CanProps } from "./gates.js";
export { Can, CanAll, CanAny } from "./gates.js";
export type {
  PermissionMap,
  PermissionsProviderProps,
  UsePermissions,
} from "./provider.js";
export { PermissionsProvider, usePermissions } from "./provider.js";
