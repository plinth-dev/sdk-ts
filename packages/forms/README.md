# `@plinth-dev/forms`

Server-action forms with Zod validation. `createAction` returns a function that is **safe to pass directly to a `<form action={...}>`**: it parses input, calls your `execute`, captures errors as `success: false` results, and re-throws Next.js framework signals (`NEXT_REDIRECT`, `NEXT_NOT_FOUND`) untouched.

The package is split into two entries:

- `@plinth-dev/forms/server` — `createAction` + adapter setters. Server-only.
- `@plinth-dev/forms/client` — `<FormWrapper>`, `<FormField>`, `useFormContext`. Client-only.

Design rationale: <https://plinth.run/sdk/ts/forms/>.

## Install

```bash
pnpm add @plinth-dev/forms zod react
```

## Wire the adapters once

`@plinth-dev/forms` doesn't import from Next.js directly — apps wire the relevant primitives at startup so the package stays usable from non-Next.js stacks.

```ts
// app/lib/forms.server.ts
import "server-only";
import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { trace } from "@opentelemetry/api";
import {
  setAuthContextFunc,
  setRedirectFunc,
  setRevalidateFunc,
  setRevalidateTagFunc,
  setTraceIdFunc,
} from "@plinth-dev/forms/server";
import { requireAuth } from "@/lib/auth";

setAuthContextFunc(async () => {
  const user = await requireAuth().catch(() => null);
  return user ? { id: user.id, roles: user.roles } : null;
});
setTraceIdFunc(() => trace.getActiveSpan()?.spanContext().traceId ?? "");
setRevalidateFunc(revalidatePath);
setRevalidateTagFunc(revalidateTag);
setRedirectFunc(redirect);
```

Import this file once from a top-level layout so the adapters run before any action.

## Define an action

```ts
// app/items/actions.ts
"use server";
import { z } from "zod";
import { createAction } from "@plinth-dev/forms/server";

export const updateItem = createAction({
  schema: z.object({
    id: z.string().min(1),
    name: z.string().min(1).max(120),
  }),
  execute: async (input, ctx) => {
    if (!ctx.user) throw new Error("Unauthenticated");
    const updated = await db.items.update(input.id, { name: input.name });
    return updated;
  },
  revalidateTags: ["items", (data) => `items:${data.id}`].flat() as string[],
  successMessage: (data) => `Updated ${data.name}.`,
  redirectTo: (data) => `/items/${data.id}`,
});
```

## Render the form

```tsx
// app/items/[id]/edit/page.tsx
"use client";
import { FormField, FormWrapper } from "@plinth-dev/forms/client";
import { toast } from "sonner";
import { updateItem } from "../../actions";

export default function EditItem({ item }: { item: { id: string; name: string } }) {
  return (
    <FormWrapper
      action={updateItem}
      toast={{ onSuccess: toast.success, onError: toast.error }}
    >
      <FormField type="hidden" name="id" defaultValue={item.id} />
      <FormField type="text" name="name" label="Name" defaultValue={item.name} required />
      <button type="submit">Save</button>
    </FormWrapper>
  );
}
```

`<FormField>` reads errors from the surrounding `<FormWrapper>` via context — the per-field error UI updates automatically when the action returns `success: false`.

## API at a glance

### `/server`

| Symbol | Purpose |
|---|---|
| `createAction({ schema, execute, ... })` | Returns an `Action` callable from a `<form action={...}>` or directly. |
| `setAuthContextFunc(fn)` | Wire the user-resolver. Default returns `null`. |
| `setTraceIdFunc(fn)` | Wire the trace-id resolver. Default returns `""`. |
| `setRevalidateFunc(fn)` | Wire `revalidatePath` (or equivalent). Default no-op. |
| `setRevalidateTagFunc(fn)` | Wire `revalidateTag`. Default no-op. |
| `setRedirectFunc(fn)` | Wire `redirect`. Default no-op. |
| `formDataToObject(fd)` | Helper: collapses repeated keys into arrays. |
| `zodIssuesToFields(error)` | Helper: buckets Zod issues by joined path. Root issues land under `_root`. |

### `/client`

| Symbol | Purpose |
|---|---|
| `<FormWrapper action={...} toast={...} onSettled={...} className={...}>` | Wraps `<form>` with React 19's `useActionState`. |
| `<FormField type name label ...>` | Single label + input + error renderer. Reads errors from context. |
| `useFormContext()` | Returns `{ errors, isPending, result }`. Throws in dev outside a wrapper; empty in prod. |

### `ActionResult`

```ts
type ActionResult<T> =
  | { success: true; data: T; message?: string }
  | { success: false; error: string; fields?: Record<string, string[]> };
```

## Behaviour

- **Two input shapes accepted.** The action accepts either a parsed object (when called directly) or a `FormData` (when called via `<form action={...}>`). `FormData` is collapsed to a plain object before Zod parsing — repeated keys become arrays.
- **Validation failure ⇒ `success: false`, no execute.** Zod issues are bucketed by joined field path (e.g. `"user.email"`) for `<FormField>` to render.
- **Execute errors ⇒ `success: false` with the message.** Stringified `Error.message` (or `String(value)` for non-Errors). The action never throws back to the caller — except for framework signals.
- **Framework signals re-thrown untouched.** Errors with `digest` starting `NEXT_REDIRECT` or `NEXT_NOT_FOUND` are re-thrown so Next.js can short-circuit. This means `redirect()` inside `execute` works as Next.js intends.
- **Side-effects only on success.** `revalidate` / `revalidateTags` / `redirectTo` only fire when `execute` resolved cleanly.
- **`redirectTo` runs through the registered adapter.** In Next.js this is `redirect`, which throws to short-circuit the response. The adapter is invoked outside the `try`/`catch` so it propagates correctly.

## Boundaries

- **Server entry is server-only** (typically used from `"use server"` action files and `Server Components`). The package itself doesn't carry the `import "server-only"` marker — `createAction` is just a factory — but app code should keep server-side helpers behind a server boundary.
- **No bundled toast / UI.** `toast` is two callbacks; bring your own (sonner, react-hot-toast, etc.). `<FormField>` accepts `className` and `inputProps` — wire shadcn/ui or your project's primitives.
- **Form state lives on the URL/server, not React state.** `defaultValue` is the only state primitive. No controlled-input wrappers, no useReducer.
- **Doesn't validate JWTs / sessions.** That's `requireAuth` (or your equivalent) inside `setAuthContextFunc`.

## Testing

For non-Next.js test environments, wire fakes via the same setters:

```ts
import {
  resetAdaptersForTests,
  setAuthContextFunc,
  setRedirectFunc,
} from "@plinth-dev/forms/server";

beforeEach(() => {
  setAuthContextFunc(() => ({ id: "u1", roles: ["editor"] }));
  setRedirectFunc(vi.fn());
});
afterEach(() => resetAdaptersForTests());
```

Test the action handler logic directly (without React 19's form-action machinery) via the exported `buildActionHandler` helper from `@plinth-dev/forms/client`.

## Compatibility

- **React 19+** (`useActionState`).
- **Node 20+** (server-only runtime).
- **TypeScript 5.9+** for `verbatimModuleSyntax`.
- **Zod 4+** as a peer dependency.
- ESM-only (`type: "module"`).
- Tree-shakeable (`sideEffects: false`).

## License

MIT — see [LICENSE](./LICENSE).
