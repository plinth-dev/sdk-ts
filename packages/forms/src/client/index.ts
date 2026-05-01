/**
 * Plinth forms — client entry.
 *
 * `<FormWrapper>` wraps a `<form>` with React 19's `useActionState`
 * and exposes per-field error state via context. `<FormField>` is the
 * single-input building block. `useFormContext` reads the state from
 * any descendant.
 *
 * See https://plinth.run/sdk/ts/forms/ for the design rationale.
 */

export type { FormContextValue } from "./context.js";
export { useFormContext } from "./context.js";
export type {
  FormFieldOption,
  FormFieldProps,
  FormFieldType,
} from "./FormField.js";
export { FormField } from "./FormField.js";
export type { ActionFn, FormWrapperProps, ToastConfig } from "./FormWrapper.js";
export { FormWrapper } from "./FormWrapper.js";
