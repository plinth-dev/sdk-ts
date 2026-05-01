"use client";

import { type ReactNode, useActionState, useMemo } from "react";
import type { Action, ActionResult } from "../server/types.js";
import { FormContext, type FormContextValue } from "./context.js";

/** Toast adapters; each defaults to a no-op. */
export interface ToastConfig {
  /** Called when the action succeeded; defaults to no-op. */
  onSuccess?: (message: string) => void;
  /** Called when the action returned `success: false`; defaults to no-op. */
  onError?: (message: string) => void;
}

export interface FormWrapperProps<T> {
  /**
   * The action to invoke on submit. This should be the function returned
   * by `createAction` from `@plinth-dev/forms/server` — but any
   * compatible signature works.
   */
  action: Action<never, T> | ActionFn<T>;

  children: ReactNode;

  /**
   * Toast adapters. Pass `false` to disable; an object to wire success/
   * error callbacks. Plinth doesn't ship a toast library — wire your
   * project's (sonner, react-hot-toast, etc.) here.
   */
  toast?: false | ToastConfig;

  /** Called once per submission, after the action settles. */
  onSettled?: (result: ActionResult<T>) => void;

  /** Forwarded to the underlying `<form>` element. */
  className?: string;
}

/** Loose shape that covers both `Action<S, T>` and ad-hoc actions. */
export type ActionFn<T> = (
  input: FormData,
  prev: ActionResult<T> | null,
) => Promise<ActionResult<T>>;

/**
 * Build the function that `useActionState` runs on each submission.
 * Exported (not part of the public API surface) so the toast / onSettled
 * branching can be unit-tested without driving React 19's form-action
 * machinery through a happy-dom submit event.
 *
 * @internal
 */
export function buildActionHandler<T>(
  action: ActionFn<T>,
  opts: {
    toast?: false | ToastConfig;
    onSettled?: (result: ActionResult<T>) => void;
  },
): (
  prev: ActionResult<T> | null,
  formData: FormData,
) => Promise<ActionResult<T>> {
  return async (prev, formData) => {
    const r = await action(formData, prev);

    if (opts.toast !== false) {
      if (r.success) {
        if (opts.toast?.onSuccess && r.message) opts.toast.onSuccess(r.message);
      } else {
        if (opts.toast?.onError) opts.toast.onError(r.error);
      }
    }
    opts.onSettled?.(r);
    return r;
  };
}

/**
 * Wraps `<form>` with React 19's `useActionState`. Renders children inside
 * a `FormContext.Provider` so descendants can read errors / pending state.
 *
 *   <FormWrapper action={updateItem}>
 *     <FormField type="text" name="name" label="Name" />
 *     <button type="submit">Save</button>
 *   </FormWrapper>
 */
export function FormWrapper<T>(props: FormWrapperProps<T>): ReactNode {
  const { action, children, toast, onSettled, className } = props;

  const handler = useMemo(
    () => buildActionHandler<T>(action as ActionFn<T>, { toast, onSettled }),
    [action, toast, onSettled],
  );

  const [result, formAction, isPending] = useActionState<
    ActionResult<T> | null,
    FormData
  >(handler, null);

  const errors = useMemo<Record<string, string[]>>(() => {
    if (result && result.success === false) {
      return result.fields ?? {};
    }
    return {};
  }, [result]);

  const ctxValue: FormContextValue = useMemo(
    () => ({
      errors,
      isPending,
      result: result as ActionResult<unknown> | null,
    }),
    [errors, isPending, result],
  );

  return (
    <FormContext.Provider value={ctxValue}>
      <form action={formAction} className={className}>
        {children}
      </form>
    </FormContext.Provider>
  );
}
