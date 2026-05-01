"use client";

import {
  type CellContext,
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  type HeaderContext,
  useReactTable,
} from "@tanstack/react-table";
import type { ReactNode } from "react";
import type { FilterField, ServerTableProps } from "./types.js";
import { useTableUrlState } from "./useTableUrlState.js";

/**
 * The default Plinth data table. Reads URL state, renders rows, and
 * routes pagination / sort / filter / search interactions back to the
 * server.
 *
 *   <ServerTable
 *     columns={columns}
 *     data={page.items}
 *     pagination={page.meta}
 *     filters={[{ type: "select", key: "status", label: "Status",
 *                 options: [...] }]}
 *     searchPlaceholder="Search items..."
 *   />
 */
export function ServerTable<T>(props: ServerTableProps<T>): ReactNode {
  const {
    columns,
    data,
    pagination,
    filters,
    searchPlaceholder,
    emptyState,
    onRowClick,
    renderHeader,
    renderRow,
    className,
  } = props;

  const url = useTableUrlState();

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
  });

  return (
    <div className={className} data-plinth-table>
      {renderHeader ? (
        renderHeader({
          search: url.search ?? "",
          setSearch: (v) => url.setSearch(v.length > 0 ? v : null),
          filters: filters ?? [],
          searchPlaceholder,
        })
      ) : (
        <DefaultHeader
          search={url.search ?? ""}
          setSearch={(v) => url.setSearch(v.length > 0 ? v : null)}
          filters={filters ?? []}
          searchPlaceholder={searchPlaceholder}
        />
      )}

      <table>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => {
                const sortable =
                  header.column.columnDef.enableSorting !== false;
                const sortBy = url.sortBy;
                const isActive = sortBy === header.column.id;
                const ctx = header.getContext() as HeaderContext<T, unknown>;
                const onSort = sortable
                  ? () => {
                      const nextOrder =
                        isActive && url.sortOrder === "asc" ? "desc" : "asc";
                      url.setSort(header.column.id, nextOrder);
                    }
                  : undefined;
                return (
                  <th
                    key={header.id}
                    onClick={onSort}
                    aria-sort={
                      isActive
                        ? url.sortOrder === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                    style={onSort ? { cursor: "pointer" } : undefined}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(header.column.columnDef.header, ctx)}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>{emptyState ?? "No results."}</td>
            </tr>
          ) : renderRow ? (
            data.map((row, i) => renderRow(row, i))
          ) : (
            table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                onClick={
                  onRowClick ? () => onRowClick(row.original) : undefined
                }
                style={onRowClick ? { cursor: "pointer" } : undefined}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id}>
                    {flexRender(
                      cell.column.columnDef.cell,
                      cell.getContext() as CellContext<T, unknown>,
                    )}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>

      <Pager
        page={pagination.page}
        pageSize={pagination.pageSize}
        totalCount={pagination.totalCount}
        totalPages={pagination.totalPages}
        hasNext={pagination.hasNext}
        onPageChange={url.setPage}
      />
    </div>
  );
}

interface DefaultHeaderProps {
  search: string;
  setSearch: (value: string) => void;
  filters: FilterField[];
  searchPlaceholder?: string;
}

function DefaultHeader(props: DefaultHeaderProps): ReactNode {
  return (
    <div data-plinth-table-header>
      <input
        type="search"
        placeholder={props.searchPlaceholder ?? "Search..."}
        defaultValue={props.search}
        onChange={(e) => props.setSearch((e.target as HTMLInputElement).value)}
        aria-label="Search"
      />
      {props.filters.length > 0 && (
        <div data-plinth-table-filters>
          {props.filters.map((f) => (
            <FilterChip key={f.key} field={f} />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({ field }: { field: FilterField }): ReactNode {
  const url = useTableUrlState();
  const current = url.filters[field.key] ?? null;

  if (field.type === "select") {
    if (field.multi) {
      const selected = Array.isArray(current)
        ? current
        : current
          ? [current]
          : [];
      return (
        <select
          aria-label={field.label}
          multiple
          value={selected}
          onChange={(e) => {
            const next = Array.from(
              (e.target as HTMLSelectElement).selectedOptions,
              (o) => o.value,
            );
            url.setFilter(field.key, next.length > 0 ? next : null);
          }}
        >
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    }
    return (
      <select
        aria-label={field.label}
        value={typeof current === "string" ? current : ""}
        onChange={(e) => {
          const v = (e.target as HTMLSelectElement).value;
          url.setFilter(field.key, v.length > 0 ? v : null);
        }}
      >
        <option value="">{field.label}</option>
        {field.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === "text") {
    return (
      <input
        type="text"
        placeholder={field.placeholder ?? field.label}
        aria-label={field.label}
        defaultValue={typeof current === "string" ? current : ""}
        onChange={(e) => {
          const v = (e.target as HTMLInputElement).value;
          url.setFilter(field.key, v.length > 0 ? v : null);
        }}
      />
    );
  }

  if (field.type === "boolean") {
    const isOn = current === "true";
    return (
      <label>
        <input
          type="checkbox"
          checked={isOn}
          onChange={(e) =>
            url.setFilter(
              field.key,
              (e.target as HTMLInputElement).checked ? "true" : null,
            )
          }
        />
        {field.label}
      </label>
    );
  }

  // date-range
  const fromKey = `${field.key}_from`;
  const toKey = `${field.key}_to`;
  const from = url.filters[fromKey];
  const to = url.filters[toKey];
  return (
    <fieldset
      aria-label={field.label}
      data-plinth-table-daterange
      style={{ border: "none", padding: 0, margin: 0 }}
    >
      <input
        type="date"
        aria-label={`${field.label} from`}
        defaultValue={typeof from === "string" ? from : ""}
        onChange={(e) =>
          url.setFilter(fromKey, (e.target as HTMLInputElement).value || null)
        }
      />
      <input
        type="date"
        aria-label={`${field.label} to`}
        defaultValue={typeof to === "string" ? to : ""}
        onChange={(e) =>
          url.setFilter(toKey, (e.target as HTMLInputElement).value || null)
        }
      />
    </fieldset>
  );
}

interface PagerProps {
  page: number;
  pageSize: number;
  totalCount?: number;
  totalPages?: number;
  hasNext: boolean;
  onPageChange: (n: number) => void;
}

function Pager(props: PagerProps): ReactNode {
  const totalPages = props.totalPages ?? null;
  const totalCount = props.totalCount ?? null;
  const start = (props.page - 1) * props.pageSize + 1;
  const end =
    totalCount !== null
      ? Math.min(props.page * props.pageSize, totalCount)
      : null;

  return (
    <div data-plinth-table-pager>
      <span data-plinth-table-pager-summary>
        {totalCount !== null && end !== null
          ? `${start}–${end} of ${totalCount}`
          : `Page ${props.page}`}
      </span>
      <button
        type="button"
        onClick={() => props.onPageChange(props.page - 1)}
        disabled={props.page <= 1}
        aria-label="Previous page"
      >
        ‹
      </button>
      <button
        type="button"
        onClick={() => props.onPageChange(props.page + 1)}
        disabled={
          !props.hasNext && (totalPages === null || props.page >= totalPages)
        }
        aria-label="Next page"
      >
        ›
      </button>
    </div>
  );
}

// Re-export the TanStack ColumnDef type for consumer convenience —
// avoids forcing every column-definition file to depend on TanStack
// directly.
export type { ColumnDef };
