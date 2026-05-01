"use client";

import { createContext, useContext } from "react";
import type { ActionResult } from "../server/types.js";

/** Surface returned by {@link useFormContext}. */
export interface FormContextValue {
  /** Per-field error map (Zod issues by field name). Empty when no errors. */
  errors: Record<string, string[]>;
  /** True while the action is in flight (React 19 transition). */
  isPending: boolean;
  /** The most recent action result, or null before the first submit. */
  result: ActionResult<unknown> | null;
}

const SENTINEL = Symbol.for("@plinth-dev/forms/UNSET");

export const FormContext = createContext<FormContextValue | typeof SENTINEL>(
  SENTINEL,
);

/**
 * Read the surrounding form's pending / error / result state. Use inside
 * a `<FormWrapper>`; outside, throws in development and returns an empty
 * shape in production.
 */
export function useFormContext(): FormContextValue {
  const value = useContext(FormContext);
  if (value === SENTINEL) {
    if (process.env.NODE_ENV !== "production") {
      throw new Error(
        "useFormContext called outside <FormWrapper>. Wrap your form in a FormWrapper.",
      );
    }
    return EMPTY;
  }
  return value;
}

const EMPTY: FormContextValue = Object.freeze({
  errors: {},
  isPending: false,
  result: null,
});
