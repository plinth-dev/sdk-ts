import { createContext, type ReactNode, useContext, useMemo } from "react";

/**
 * The wire shape from `@plinth-dev/authz`'s `permissionMap`. Keys are bare
 * action names ("read", "update", ...) scoped to the resource the layout
 * fetched. Values are the boolean from Cerbos's decision; full Decision
 * shape (with Reason) lives server-side.
 */
export type PermissionMap = Record<string, boolean>;

/** Props for {@link PermissionsProvider}. */
export interface PermissionsProviderProps {
  permissions: PermissionMap;
  children: ReactNode;
  /**
   * When nesting providers, controls merge behaviour with the parent.
   * - `"replace"` (default) — child fully replaces parent permissions.
   * - `"merge"` — child overrides specific keys; missing keys fall through
   *   to the parent. Useful for sub-routes that fetch one extra permission
   *   rather than the full set again.
   */
  strategy?: "replace" | "merge";
}

/** Public surface returned by {@link usePermissions}. */
export interface UsePermissions {
  has: (action: string) => boolean;
  hasAny: (actions: readonly string[]) => boolean;
  hasAll: (actions: readonly string[]) => boolean;
  raw: PermissionMap;
}

/**
 * Internal context. The unset value is a sentinel — `usePermissions` checks
 * for it explicitly to distinguish "no provider in tree" from "provider
 * with empty permissions".
 */
const UNSET = Symbol.for("@plinth-dev/authz-react/UNSET");

const PermissionsContext = createContext<PermissionMap | typeof UNSET>(UNSET);

/**
 * Wrap a route in a PermissionsProvider so descendants can call
 * `usePermissions()` or use `<Can>` synchronously.
 *
 * Always pass `permissions` from a server-side `permissionMap()` call —
 * never construct it client-side. The provider is read-only; it can't
 * refresh permissions.
 */
export function PermissionsProvider(
  props: PermissionsProviderProps,
): ReactNode {
  const { permissions, children, strategy = "replace" } = props;

  // For "merge" strategy, fold in the parent permissions if a parent
  // provider exists in the tree.
  const parent = useContext(PermissionsContext);
  const merged = useMemo<PermissionMap>(() => {
    if (strategy === "merge" && parent !== UNSET) {
      return { ...parent, ...permissions };
    }
    return permissions;
  }, [permissions, strategy, parent]);

  return (
    <PermissionsContext.Provider value={merged}>
      {children}
    </PermissionsContext.Provider>
  );
}

/**
 * Read the current PermissionMap.
 *
 * Throws in development when called outside a {@link PermissionsProvider}
 * — surfaces a missing-provider bug at the first render. In production
 * builds (`process.env.NODE_ENV === "production"`), falls back to an
 * all-false map: fail-closed, never undefined.
 */
export function usePermissions(): UsePermissions {
  const value = useContext(PermissionsContext);

  if (value === UNSET) {
    if (process.env.NODE_ENV !== "production") {
      throw new Error(
        "usePermissions called outside <PermissionsProvider>. " +
          "Wrap your route with a PermissionsProvider populated from " +
          "@plinth-dev/authz's permissionMap (server-side).",
      );
    }
    // Production: fail-closed; never throw.
    return EMPTY_HOOK_VALUE;
  }

  return makeHook(value);
}

const EMPTY_MAP: PermissionMap = Object.freeze({});
const EMPTY_HOOK_VALUE: UsePermissions = {
  has: () => false,
  hasAny: () => false,
  hasAll: () => false,
  raw: EMPTY_MAP,
};

function makeHook(map: PermissionMap): UsePermissions {
  return {
    has: (action) => map[action] === true,
    hasAny: (actions) => actions.some((a) => map[a] === true),
    hasAll: (actions) => actions.every((a) => map[a] === true),
    raw: map,
  };
}
