import type { z } from "zod";
import {
  callRedirect,
  callRevalidate,
  callRevalidateTag,
  getAuthContext,
  getTraceId,
} from "./adapters.js";
import type {
  Action,
  ActionConfig,
  ActionContext,
  ActionResult,
} from "./types.js";

/**
 * Build a server action from a Zod schema and an `execute` function.
 *
 * The returned function accepts either a pre-parsed object (server code
 * calling the action directly) or a `FormData` (React's `useActionState`
 * form binding). Output is always {@link ActionResult} — never throws,
 * except when the action's redirect adapter does (Next.js's `redirect`
 * throws by design; the throw bubbles unchanged).
 */
export function createAction<S extends z.ZodTypeAny, T>(
  config: ActionConfig<S, T>,
): Action<S, T> {
  return async (input, _prev) => {
    // 1. Coerce FormData → object before parsing.
    const candidate =
      input instanceof FormData ? formDataToObject(input) : input;

    // 2. Schema validation. Failures return ActionResult{success:false}.
    const parsed = config.schema.safeParse(candidate);
    if (!parsed.success) {
      return {
        success: false,
        error: "validation failed",
        fields: zodIssuesToFields(parsed.error),
      };
    }

    // 3. Build the auth/trace context. Defaults to {user:null, traceId:""}.
    const ctx: ActionContext = {
      user: await Promise.resolve(getAuthContext()),
      traceId: getTraceId(),
    };

    // 4. Run execute. Errors become ActionResult{success:false} unless they
    //    look like a redirect signal (Next.js `redirect()` throws a special
    //    error class) — in which case re-throw so the framework can handle.
    let data: T;
    try {
      data = await Promise.resolve(
        config.execute(parsed.data as z.infer<S>, ctx),
      );
    } catch (err) {
      if (isFrameworkSignal(err)) throw err;
      return { success: false, error: errMessage(err) };
    }

    // 5. Revalidate paths and tags.
    if (config.revalidate) {
      const paths = Array.isArray(config.revalidate)
        ? config.revalidate
        : [config.revalidate];
      for (const p of paths) callRevalidate(p);
    }
    if (config.revalidateTags) {
      for (const t of config.revalidateTags) callRevalidateTag(t);
    }

    // 6. Resolve message.
    const message =
      typeof config.successMessage === "function"
        ? config.successMessage(data)
        : config.successMessage;

    // 7. Redirect (in Next.js, this throws — propagates to the framework).
    if (config.redirectTo) {
      const url =
        typeof config.redirectTo === "function"
          ? config.redirectTo(data)
          : config.redirectTo;
      if (url) {
        callRedirect(url);
        // If the redirect adapter is a no-op (test stub), fall through and
        // return success below.
      }
    }

    return message !== undefined
      ? { success: true, data, message }
      : { success: true, data };
  };
}

// ── helpers ───────────────────────────────────────────────────────

/**
 * Flatten a `FormData` into a plain object suitable for Zod parsing.
 * - Multiple values for the same key → array.
 * - Single value → string (FormData values are always string|File).
 * - File values pass through unchanged.
 */
export function formDataToObject(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(Array.from(formData.keys()))) {
    const all = formData.getAll(key);
    if (all.length === 1) {
      out[key] = all[0];
    } else {
      out[key] = all;
    }
  }
  return out;
}

/**
 * Convert Zod issues into the per-field shape `{ fieldName: [msg, msg, ...] }`.
 * Issues at the root (no path) are bucketed under `_root`.
 */
export function zodIssuesToFields(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.length === 0 ? "_root" : issue.path.join(".");
    if (!out[key]) out[key] = [];
    out[key].push(issue.message);
  }
  return out;
}

/**
 * Detect Next.js framework signal errors (`redirect()`, `notFound()`, etc.)
 * by checking for the `digest` string Next attaches. We re-throw these
 * unchanged so the framework can handle them.
 */
function isFrameworkSignal(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const digest = (err as { digest?: unknown }).digest;
  if (typeof digest !== "string") return false;
  return (
    digest.startsWith("NEXT_REDIRECT") ||
    digest.startsWith("NEXT_NOT_FOUND") ||
    digest.startsWith("DYNAMIC_SERVER_USAGE")
  );
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
