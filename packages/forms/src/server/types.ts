import type { z } from "zod";

/**
 * Auth context auto-injected into every action's `execute`. The `user`
 * field is populated by an app-registered {@link setAuthContextFunc};
 * `traceId` is populated by an app-registered {@link setTraceIdFunc}.
 *
 * If no setter is registered, `user` is `null` and `traceId` is the
 * empty string. The action can branch on those to require auth.
 */
export interface ActionContext {
  user: { id: string; roles: string[] } | null;
  traceId: string;
}

/**
 * Configuration for {@link createAction}. The schema is the input shape;
 * `execute` runs after schema validation succeeds.
 */
export interface ActionConfig<S extends z.ZodTypeAny, T> {
  /** Zod schema describing the input. */
  schema: S;
  /** The action body. Receives the parsed input and the auth/trace context. */
  execute: (input: z.infer<S>, ctx: ActionContext) => Promise<T> | T;

  /**
   * Path(s) to revalidate after a successful execute. Calls the
   * adapter registered via {@link setRevalidateFunc}.
   */
  revalidate?: string | readonly string[];

  /**
   * Cache tag(s) to revalidate after a successful execute. Calls the
   * adapter registered via {@link setRevalidateTagFunc}.
   */
  revalidateTags?: readonly string[];

  /**
   * User-facing success message. String or function-of-data; included
   * in the {@link ActionResult} on success.
   */
  successMessage?: string | ((data: T) => string);

  /**
   * If set, calls {@link setRedirectFunc}'s adapter with this URL after
   * a successful execute. In Next.js, redirect throws to short-circuit
   * the response — that's expected, the throw is treated as success-with-
   * redirect by FormWrapper.
   */
  redirectTo?: string | ((data: T) => string | undefined);
}

/**
 * Discriminated-union result returned by every action. The `success`
 * flag is the only branch every caller needs.
 *
 * On failure, `fields` carries Zod's per-field error messages so the
 * client form bindings can highlight specific inputs.
 */
export type ActionResult<T> =
  | { success: true; data: T; message?: string }
  | { success: false; error: string; fields?: Record<string, string[]> };

/**
 * The function type returned by {@link createAction}. Accepts either a
 * pre-parsed object (from server code calling the action directly) or
 * a `FormData` (from React 19's `useActionState` form binding).
 */
export type Action<S extends z.ZodTypeAny, T> = (
  input: z.infer<S> | FormData,
  prev?: ActionResult<T> | null,
) => Promise<ActionResult<T>>;
