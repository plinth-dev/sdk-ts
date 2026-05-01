/**
 * Server entry — pure functions for reading URL searchParams server-side
 * (RSC pages, route handlers). No React, no nuqs, no Next.js imports.
 *
 * Exported separately so a Server Component page can import this without
 * pulling in `<ServerTable>` and its client-only deps.
 */

export const DEFAULT_PAGE = 1;
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 200;

/** The shape of `params` that Next.js passes to a Server Component page. */
export type SearchParamsRecord = Record<string, string | string[] | undefined>;

export interface ParsedTableParams {
  page: number;
  pageSize: number;
  /**
   * The validated sort column, or `null` if no valid sort is set.
   * Matches `useTableUrlState().sortBy` so the same shape works on
   * both sides of the network.
   */
  sortBy: string | null;
  sortOrder: "asc" | "desc";
  /** Raw search string, or `null` if absent / empty. */
  search: string | null;
  /**
   * Filter values keyed by URL key. Single-valued filters become a string;
   * multi-valued filters (comma-separated in the URL) become a string[].
   */
  filters: Record<string, string | string[]>;
}

/**
 * Read pagination / sort / search / filter state out of a Next.js
 * `searchParams` record. Server-side concern only — client code reads the
 * URL via `useTableUrlState` from the main entry.
 *
 * Reserved URL keys (not treated as filters): `page`, `pageSize`, `sortBy`,
 * `sortOrder`, `q`. Everything else lands in `filters`.
 *
 * `allowedSortColumns` is enforced like a SQL injection guard — same
 * philosophy as `sdk-go/paginate`. Pass exactly the columns the repo
 * supports; anything else is silently dropped (sortBy becomes `""`).
 *
 *   const params = parseTableSearchParams(searchParams,
 *     ["created_at", "name", "status"]);
 *   const page = await itemsRepo.list(params);
 */
export function parseTableSearchParams(
  searchParams: SearchParamsRecord,
  allowedSortColumns: readonly string[],
): ParsedTableParams {
  const page = parsePositiveInt(searchParams.page, DEFAULT_PAGE);
  const pageSize = clamp(
    parsePositiveInt(searchParams.pageSize, DEFAULT_PAGE_SIZE),
    1,
    MAX_PAGE_SIZE,
  );

  const rawSort = readString(searchParams.sortBy);
  const sortBy: string | null =
    rawSort && allowedSortColumns.includes(rawSort) ? rawSort : null;
  const sortOrder =
    readString(searchParams.sortOrder) === "desc" ? "desc" : "asc";

  const search = readString(searchParams.q) || null;

  const filters: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(searchParams)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (value === undefined) continue;
    const parsed = parseFilterValue(value);
    if (parsed === null) continue;
    filters[key] = parsed;
  }

  return { page, pageSize, sortBy, sortOrder, search, filters };
}

const RESERVED_KEYS = new Set(["page", "pageSize", "sortBy", "sortOrder", "q"]);

function readString(value: string | string[] | undefined): string {
  if (value === undefined) return "";
  if (Array.isArray(value)) return value[0] ?? "";
  return value;
}

function parsePositiveInt(
  value: string | string[] | undefined,
  fallback: number,
): number {
  const raw = readString(value);
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return fallback;
  return n;
}

function clamp(n: number, min: number, max: number): number {
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

/**
 * Filter values arrive in two shapes:
 *  1. A single string `"active"` — treat as a string filter.
 *  2. A comma-separated string `"active,pending"` — split into an array.
 *  3. A repeated query param `["active","pending"]` — already an array.
 *
 * Empty strings are treated as absent and return `null`.
 */
function parseFilterValue(value: string | string[]): string | string[] | null {
  if (Array.isArray(value)) {
    const clean = value.filter((v) => v.length > 0);
    const first = clean[0];
    if (first === undefined) return null;
    if (clean.length === 1) return first;
    return clean;
  }
  if (value.length === 0) return null;
  if (value.includes(",")) {
    const parts = value.split(",").filter((v) => v.length > 0);
    const first = parts[0];
    if (first === undefined) return null;
    if (parts.length === 1) return first;
    return parts;
  }
  return value;
}
