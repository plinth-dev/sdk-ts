# `@plinth-dev/tables`

Headless data tables with **URL state**. The default Plinth table reads pagination, sort, search, and filter values out of `searchParams` server-side, renders rows fetched by the page, and routes user interaction back through the router. No client-side filtering, no SPA-style state — sharing a URL shares the entire view.

The package splits into two entries:

- `@plinth-dev/tables` — `<ServerTable>` + `useTableUrlState`. Client-only.
- `@plinth-dev/tables/server` — `parseTableSearchParams`. Pure function, RSC-safe.

Design rationale: <https://plinth.run/sdk/ts/tables/>.

## Install

```bash
pnpm add @plinth-dev/tables
```

The package depends on `@tanstack/react-table` (bundled) and peer-depends on `next` (15.x or 16.x — `next/navigation` is used directly).

## Minimum example

```tsx
// app/(module)/items/page.tsx — Server Component
import { ServerTable, type ColumnDef } from "@plinth-dev/tables";
import { parseTableSearchParams } from "@plinth-dev/tables/server";
import { itemsRepo } from "@/lib/repo";

interface Item { id: string; name: string; status: "active" | "archived"; }

const columns: ColumnDef<Item>[] = [
  { id: "name", accessorKey: "name", header: "Name" },
  { id: "status", accessorKey: "status", header: "Status" },
];

export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = parseTableSearchParams(sp, ["name", "status", "created_at"]);
  const page = await itemsRepo.list(params);

  return (
    <ServerTable
      columns={columns}
      data={page.items}
      pagination={page.meta}
      searchPlaceholder="Search items..."
      filters={[
        {
          type: "select",
          key: "status",
          label: "Status",
          options: [
            { value: "active", label: "Active" },
            { value: "archived", label: "Archived" },
          ],
        },
        { type: "date-range", key: "created", label: "Created" },
      ]}
    />
  );
}
```

The `<ServerTable>` component is a Client Component (it uses `useRouter` / `useSearchParams`), but the page that mounts it is a Server Component — your data fetching happens server-side.

## URL conventions

| Reserved key | Purpose |
|---|---|
| `page` | 1-based page number. Omitted from URL when 1. |
| `pageSize` | Items per page. Defaults to 25, clamped to 200. |
| `sortBy` | Column id. Validated against `parseTableSearchParams`'s allow-list. |
| `sortOrder` | `"asc"` or `"desc"`. Anything else normalises to `"asc"`. |
| `q` | Free-text search. |

Anything else lands in `filters`. Multi-value filters are encoded `?status=active,archived` (comma-separated). Repeated query params (`?tag=a&tag=b`) are also accepted on the read side.

## API at a glance

### Main entry

| Symbol | Purpose |
|---|---|
| `<ServerTable columns data pagination filters? searchPlaceholder? emptyState? onRowClick? renderHeader? renderRow? className?>` | The default table. |
| `useTableUrlState()` | Read / write URL state. Returns `{ page, pageSize, sortBy, sortOrder, search, filters, setPage, setSort, setSearch, setFilter, reset }`. |
| `ColumnDef<T>` | Re-exported from TanStack Table for convenience. |
| `FilterField` | `SelectFilter \| TextFilter \| DateRangeFilter \| BooleanFilter`. |
| `TablePaginationMeta` | The shape `<ServerTable>`'s `pagination` prop expects. Mirrors `sdk-go/paginate.Meta`. |

### Server entry (`@plinth-dev/tables/server`)

| Symbol | Purpose |
|---|---|
| `parseTableSearchParams(searchParams, allowedSortColumns)` | Reads RSC `searchParams` into `{ page, pageSize, sortBy, sortOrder, search, filters }`. |
| `DEFAULT_PAGE` (1) / `DEFAULT_PAGE_SIZE` (25) / `MAX_PAGE_SIZE` (200) | Defaults. |

## Filter primitives

```ts
type FilterField =
  | { type: "select"; key: string; label: string; multi?: boolean;
      options: ReadonlyArray<{ value: string; label: string }> }
  | { type: "text"; key: string; label: string; placeholder?: string }
  | { type: "date-range"; key: string; label: string }   // emits <key>_from / <key>_to
  | { type: "boolean"; key: string; label: string };
```

The default header renders one chip per filter. To replace the chrome (search input + filters) wholesale, pass `renderHeader`. To replace per-row rendering (custom layout, action menus), pass `renderRow`.

## Behaviour

- **URL is the source of truth.** `setSort` / `setSearch` / `setFilter` push the router with `scroll: false`. The Server Component re-runs with the new searchParams and streams new rows.
- **Page resets on every change.** Sort, search, filter — any of these resets `page` to 1 so users don't end up beyond the new result count.
- **Allow-list enforces sort safety.** `parseTableSearchParams` drops `sortBy` values not in the supplied list — same SQL-injection-prevention philosophy as `sdk-go/paginate`.
- **Active sort flips on click.** First click on an unsorted column sorts ascending; the next click on the active column flips to descending.
- **Empty state.** Renders `emptyState` (or `"No results."`) when `data.length === 0`.
- **Render slots.** `renderHeader` and `renderRow` replace the default UI without losing the URL-state plumbing.
- **`scroll: false` everywhere.** Page changes don't jump to the top — the table interaction stays where the user is looking.

## Boundaries

- **Server-side pagination only.** No client-side filtering, sorting, or virtualisation. Data is what the server sent. If you need 1k+ visible rows, wrap rows in TanStack Virtual yourself.
- **Doesn't fetch data.** Pages do that; the table just renders.
- **No CSV export, no column reorder, no column resize.** Out of scope for v0.1.0.
- **Doesn't validate filter values.** A `select` filter accepts any string — your repo layer should ignore unknowns. The allow-list applies to `sortBy` only.
- **Doesn't ship CSS.** Default header and pager render plain elements with `data-plinth-table-*` hooks. Style with Tailwind, shadcn, or a stylesheet of your choosing.

## Testing

The `useTableUrlState` hook reads from `next/navigation`. In Vitest, mock the three hooks before importing the SUT:

```ts
const pushMock = vi.fn();
let currentSearch = "";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => "/items",
  useSearchParams: () => new URLSearchParams(currentSearch),
}));
```

`parseTableSearchParams` is a pure function — no setup required.

## Compatibility

- **Next.js 15+ or 16+** (peer dependency — `next/navigation` is the navigation primitive).
- **React 19+**.
- **Node 20+** for the build toolchain.
- **TanStack Table 8+** as a runtime dep.
- ESM-only (`type: "module"`).
- Tree-shakeable (`sideEffects: false`).

## License

MIT — see [LICENSE](./LICENSE).
