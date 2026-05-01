import type { ReactNode } from "react";
import { usePermissions } from "./provider.js";

export interface CanProps {
  /** Action name to check (e.g. `"read"`, `"items:delete"`). */
  action: string;
  /**
   * Rendered when not allowed. If omitted, renders nothing — the most
   * common case (hide UI when forbidden).
   */
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Declarative permission gate. Renders `children` when allowed,
 * `fallback` when not.
 *
 *   <Can action="comment">
 *     <CommentButton />
 *   </Can>
 *
 *   <Can action="delete" fallback={<span>Read-only</span>}>
 *     <DeleteButton />
 *   </Can>
 *
 * Reads from the surrounding {@link PermissionsProvider}; the call is
 * synchronous because permissions came pre-resolved from the server.
 */
export function Can(props: CanProps): ReactNode {
  const perms = usePermissions();
  return perms.has(props.action) ? props.children : (props.fallback ?? null);
}

export interface CanAnyProps {
  /** Renders `children` if any of these actions are allowed. */
  actions: readonly string[];
  fallback?: ReactNode;
  children: ReactNode;
}

/** Renders children when ANY of the actions is allowed. */
export function CanAny(props: CanAnyProps): ReactNode {
  const perms = usePermissions();
  return perms.hasAny(props.actions)
    ? props.children
    : (props.fallback ?? null);
}

export interface CanAllProps {
  /** Renders `children` only when all of these actions are allowed. */
  actions: readonly string[];
  fallback?: ReactNode;
  children: ReactNode;
}

/** Renders children only when ALL actions are allowed. */
export function CanAll(props: CanAllProps): ReactNode {
  const perms = usePermissions();
  return perms.hasAll(props.actions)
    ? props.children
    : (props.fallback ?? null);
}
