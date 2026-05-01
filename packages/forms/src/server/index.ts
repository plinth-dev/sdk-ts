/**
 * Plinth forms — server entry.
 *
 * Server-action factory + adapter setters. The package is intentionally
 * not hard-coupled to Next.js — apps wire `next/cache`, `next/headers`,
 * and `next/navigation` adapters via the setter functions below at startup.
 *
 * See https://plinth.run/sdk/ts/forms/ for the design rationale.
 */

export {
  resetAdaptersForTests,
  setAuthContextFunc,
  setRedirectFunc,
  setRevalidateFunc,
  setRevalidateTagFunc,
  setTraceIdFunc,
} from "./adapters.js";
export {
  createAction,
  formDataToObject,
  zodIssuesToFields,
} from "./createAction.js";
export type {
  Action,
  ActionConfig,
  ActionContext,
  ActionResult,
} from "./types.js";
