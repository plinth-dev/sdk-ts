/**
 * Plinth tables — client entry.
 *
 * `<ServerTable>` is the default headless table. `useTableUrlState` is
 * the hook for non-table components that need to read or mutate the URL
 * state (e.g., a sibling search box).
 *
 * Server-side parsing helpers live at `@plinth-dev/tables/server` so a
 * Server Component page can read `searchParams` without pulling in the
 * client bundle.
 *
 * See https://plinth.run/sdk/ts/tables/ for the design rationale.
 */

export { type ColumnDef, ServerTable } from "./ServerTable.js";
export type {
  BooleanFilter,
  DateRangeFilter,
  FilterField,
  HeaderRenderProps,
  SelectFilter,
  ServerTableProps,
  TablePaginationMeta,
  TextFilter,
} from "./types.js";
export {
  type TableUrlState,
  useTableUrlState,
} from "./useTableUrlState.js";
