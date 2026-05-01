"use client";

import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useFormContext } from "./context.js";

/** Supported input types. */
export type FormFieldType =
  | "text"
  | "email"
  | "password"
  | "number"
  | "url"
  | "tel"
  | "date"
  | "textarea"
  | "select"
  | "checkbox"
  | "switch"
  | "hidden";

export interface FormFieldOption {
  value: string;
  label: string;
}

export interface FormFieldProps {
  type: FormFieldType;
  /** Field name; matches the Zod schema key + the FormContext error key. */
  name: string;
  /** Visible label. Skip for hidden fields. */
  label?: string;
  /** Optional helper text rendered below the label. */
  description?: string;
  /** Marks the field as required (the schema is the source of truth; this is just a hint to the input). */
  required?: boolean;
  /** Initial value. Form state is the URL/server, not React state. */
  defaultValue?: string | number | boolean;
  /** For `type="select"`. */
  options?: FormFieldOption[];
  /** Disables the input. */
  disabled?: boolean;
  /** Pass-through to the underlying element. */
  inputProps?:
    | InputHTMLAttributes<HTMLInputElement>
    | TextareaHTMLAttributes<HTMLTextAreaElement>
    | SelectHTMLAttributes<HTMLSelectElement>;
  /** Forwarded to the wrapping `<div>`. */
  className?: string;
}

/**
 * One label + input + per-field error message, reading errors from the
 * surrounding `<FormWrapper>`. Plinth doesn't ship CSS — `className`
 * lets you wire shadcn/ui / Tailwind / your project's primitives.
 *
 *   <FormField type="email" name="email" label="Email" required />
 *   <FormField type="select" name="role" label="Role"
 *     options={[{value: "admin", label: "Admin"}, ...]} />
 */
export function FormField(props: FormFieldProps): ReactNode {
  const ctx = useFormContext();
  const fieldErrors = ctx.errors[props.name] ?? [];
  const hasError = fieldErrors.length > 0;
  const inputId = `field-${props.name}`;
  const errorId = `${inputId}-error`;
  const descriptionId = props.description ? `${inputId}-desc` : undefined;
  const ariaDescribedBy =
    [hasError ? errorId : null, descriptionId].filter(Boolean).join(" ") ||
    undefined;

  if (props.type === "hidden") {
    return (
      <input
        type="hidden"
        name={props.name}
        defaultValue={normaliseDefault(props.defaultValue)}
      />
    );
  }

  return (
    <div className={props.className} data-plinth-form-field={props.name}>
      {props.label && (
        <label htmlFor={inputId}>
          {props.label}
          {props.required && <span aria-hidden="true">*</span>}
        </label>
      )}
      {props.description && <p id={descriptionId}>{props.description}</p>}
      {renderInput({ ...props, inputId, ariaDescribedBy, hasError })}
      {hasError && (
        <ul id={errorId} role="alert">
          {fieldErrors.map((msg, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: error messages are stable per render
            <li key={i}>{msg}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface RenderArgs extends FormFieldProps {
  inputId: string;
  ariaDescribedBy: string | undefined;
  hasError: boolean;
}

function renderInput(args: RenderArgs): ReactNode {
  const baseProps = {
    id: args.inputId,
    name: args.name,
    required: args.required,
    disabled: args.disabled,
    "aria-invalid": args.hasError || undefined,
    "aria-describedby": args.ariaDescribedBy,
  };

  switch (args.type) {
    case "textarea":
      return (
        <textarea
          {...baseProps}
          {...(args.inputProps as TextareaHTMLAttributes<HTMLTextAreaElement>)}
          defaultValue={normaliseDefault(args.defaultValue)}
        />
      );

    case "select":
      return (
        <select
          {...baseProps}
          {...(args.inputProps as SelectHTMLAttributes<HTMLSelectElement>)}
          defaultValue={normaliseDefault(args.defaultValue)}
        >
          {args.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );

    case "checkbox":
    case "switch":
      return (
        <input
          {...baseProps}
          {...(args.inputProps as InputHTMLAttributes<HTMLInputElement>)}
          type="checkbox"
          role={args.type === "switch" ? "switch" : undefined}
          defaultChecked={args.defaultValue === true}
        />
      );

    default:
      return (
        <input
          {...baseProps}
          {...(args.inputProps as InputHTMLAttributes<HTMLInputElement>)}
          type={args.type}
          defaultValue={normaliseDefault(args.defaultValue)}
        />
      );
  }
}

function normaliseDefault(
  value: string | number | boolean | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}
