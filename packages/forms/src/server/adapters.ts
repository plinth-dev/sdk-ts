import type { ActionContext } from "./types.js";

/**
 * Adapter setters. App code wires these once at startup, typically in a
 * `lib/forms.server.ts` that imports from `next/cache`, `next/headers`,
 * and `next/navigation`. Defaults are no-ops so the package isn't
 * hard-coupled to Next.js — non-Next.js apps can plug in their own
 * adapters or skip entirely.
 */

let authContextFunc: () =>
  | Promise<ActionContext["user"]>
  | ActionContext["user"] = () => null;

let traceIdFunc: () => string = () => "";

let revalidateFunc: (path: string) => void = () => {
  // no-op
};

let revalidateTagFunc: (tag: string) => void = () => {
  // no-op
};

// `void` covers both Next.js's throw-and-never-return `redirect` and a
// no-op function: `never` is assignable to `void`. Using `never | void`
// would be redundant.
let redirectFunc: (url: string) => void = () => {};

/**
 * Register the auth-resolving function. Called once per action; the
 * returned user (or null) becomes `ActionContext.user`.
 *
 *   import { cookies } from "next/headers";
 *   setAuthContextFunc(async () => {
 *     const session = (await cookies()).get("session")?.value;
 *     if (!session) return null;
 *     return parseSession(session);
 *   });
 */
export function setAuthContextFunc(
  fn: () => Promise<ActionContext["user"]> | ActionContext["user"],
): void {
  authContextFunc = fn;
}

/** Register a function returning the current trace ID (typically from OTel). */
export function setTraceIdFunc(fn: () => string): void {
  traceIdFunc = fn;
}

/**
 * Register the path-revalidation adapter.
 *
 *   import { revalidatePath } from "next/cache";
 *   setRevalidateFunc(revalidatePath);
 */
export function setRevalidateFunc(fn: (path: string) => void): void {
  revalidateFunc = fn;
}

/**
 * Register the tag-revalidation adapter.
 *
 *   import { revalidateTag } from "next/cache";
 *   setRevalidateTagFunc(revalidateTag);
 */
export function setRevalidateTagFunc(fn: (tag: string) => void): void {
  revalidateTagFunc = fn;
}

/**
 * Register the redirect adapter. In Next.js this is `redirect` from
 * `next/navigation`, which throws to short-circuit the response.
 *
 *   import { redirect } from "next/navigation";
 *   setRedirectFunc(redirect);
 */
export function setRedirectFunc(fn: (url: string) => void): void {
  redirectFunc = fn;
}

/**
 * Reset all adapters to their no-op defaults. Test-only.
 */
export function resetAdaptersForTests(): void {
  authContextFunc = () => null;
  traceIdFunc = () => "";
  revalidateFunc = () => {};
  revalidateTagFunc = () => {};
  redirectFunc = () => {};
}

// ── Internal getters used by createAction ─────────────────────────

/** @internal */
export function getAuthContext():
  | Promise<ActionContext["user"]>
  | ActionContext["user"] {
  return authContextFunc();
}

/** @internal */
export function getTraceId(): string {
  return traceIdFunc();
}

/** @internal */
export function callRevalidate(path: string): void {
  revalidateFunc(path);
}

/** @internal */
export function callRevalidateTag(tag: string): void {
  revalidateTagFunc(tag);
}

/** @internal */
export function callRedirect(url: string): void {
  redirectFunc(url);
}
