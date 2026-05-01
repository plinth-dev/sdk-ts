import type { ColumnDef } from "@tanstack/react-table";
import type { ReactNode } from "react";

/**
 * Pagination metadata shape consumed by `<ServerTable>`. Mirrors what
 * `sdk-go/paginate.Page[T].Meta` produces — pass it through with no
 * transformation. Both offset (`totalCount`/`totalPages`) and cursor
 * (`nextCursor`) modes are supported; `hasNext` is the only required
 * field beyond `page` + `pageSize`.
 */
export interface TablePaginationMeta {
  page: number;
  pageSize: number;
  totalCount?: number;
  totalPages?: number;
  nextCursor?: string;
  hasNext: boolean;
}

export interface SelectFilter {
  type: "select";
  /** URL key. Avoid the reserved keys: `page`, `pageSize`, `sortBy`, `sortOrder`, `q`. */
  key: string;
  label: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  /** When true, multiple selections are joined with `,` in the URL. */
  multi?: boolean;
}

export interface TextFilter {
  type: "text";
  key: string;
  label: string;
  placeholder?: string;
}

export interface DateRangeFilter {
  type: "date-range";
  /** Generates two URL keys: `<key>_from` and `<key>_to`. */
  key: string;
  label: string;
}

export interface BooleanFilter {
  type: "boolean";
  key: string;
  label: string;
}

export type FilterField =
  | SelectFilter
  | TextFilter
  | DateRangeFilter
  | BooleanFilter;

export interface HeaderRenderProps {
  search: string;
  setSearch: (value: string) => void;
  filters: FilterField[];
  searchPlaceholder?: string;
}

export interface ServerTableProps<T> {
  columns: ColumnDef<T>[];
  data: T[];
  pagination: TablePaginationMeta;

  filters?: FilterField[];
  searchPlaceholder?: string;
  emptyState?: ReactNode;

  onRowClick?: (row: T) => void;

  /** Replace the default header (search input + filter chips). */
  renderHeader?: (props: HeaderRenderProps) => ReactNode;
  /** Replace the default `<tr>` rendering for each row. */
  renderRow?: (row: T, index: number) => ReactNode;

  /** Forwarded to the wrapping `<div>`. */
  className?: string;
}
