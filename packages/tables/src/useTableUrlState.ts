"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";

/** What `useTableUrlState()` returns. */
export interface TableUrlState {
  page: number;
  pageSize: number;
  sortBy: string | null;
  sortOrder: "asc" | "desc";
  search: string | null;
  /** All non-reserved URL keys, with comma-separated multi values split into arrays. */
  filters: Record<string, string | string[]>;

  setPage: (n: number) => void;
  setSort: (column: string, order: "asc" | "desc") => void;
  setSearch: (s: string | null) => void;
  setFilter: (key: string, value: string | string[] | null) => void;
  reset: () => void;
}

/**
 * Read and write the table's URL state. Reads use Next.js's
 * `useSearchParams`; writes go through `useRouter().push` with
 * `scroll: false` so the page stays put while the server component
 * re-renders with the new query.
 *
 * Reserved URL keys: `page`, `pageSize`, `sortBy`, `sortOrder`, `q`.
 * Anything else lands in `filters` (string for single values, string[]
 * for comma-separated multi values).
 *
 * Page is reset to 1 on every sort / search / filter change so users
 * never end up on a stale page beyond the new result count.
 */
export function useTableUrlState(): TableUrlState {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const page = parsePositiveInt(searchParams.get("page"), 1);
  const pageSize = parsePositiveInt(searchParams.get("pageSize"), 25);
  const sortBy = nullIfEmpty(searchParams.get("sortBy"));
  const sortOrder: "asc" | "desc" =
    searchParams.get("sortOrder") === "desc" ? "desc" : "asc";
  const search = nullIfEmpty(searchParams.get("q"));

  const filters = useMemo<Record<string, string | string[]>>(() => {
    const out: Record<string, string | string[]> = {};
    for (const [key, value] of searchParams.entries()) {
      if (RESERVED.has(key)) continue;
      if (value.length === 0) continue;
      const existing = out[key];
      if (existing === undefined) {
        out[key] = value.includes(",") ? splitComma(value) : value;
        continue;
      }
      // Repeated query param — collect into an array.
      out[key] = Array.isArray(existing)
        ? [...existing, value]
        : [existing, value];
    }
    return out;
  }, [searchParams]);

  const navigate = useCallback(
    (newParams: URLSearchParams) => {
      const qs = newParams.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );

  const cloneParams = useCallback(
    () => new URLSearchParams(searchParams.toString()),
    [searchParams],
  );

  const setPage = useCallback(
    (n: number) => {
      const next = cloneParams();
      if (n > 1) next.set("page", String(n));
      else next.delete("page");
      navigate(next);
    },
    [cloneParams, navigate],
  );

  const setSort = useCallback(
    (column: string, order: "asc" | "desc") => {
      const next = cloneParams();
      next.set("sortBy", column);
      next.set("sortOrder", order);
      next.delete("page");
      navigate(next);
    },
    [cloneParams, navigate],
  );

  const setSearch = useCallback(
    (s: string | null) => {
      const next = cloneParams();
      if (s && s.length > 0) next.set("q", s);
      else next.delete("q");
      next.delete("page");
      navigate(next);
    },
    [cloneParams, navigate],
  );

  const setFilter = useCallback(
    (key: string, value: string | string[] | null) => {
      if (RESERVED.has(key)) {
        if (process.env.NODE_ENV !== "production") {
          throw new Error(
            `useTableUrlState.setFilter: "${key}" is reserved (page/pageSize/sortBy/sortOrder/q).`,
          );
        }
        return;
      }
      const next = cloneParams();
      next.delete(key);
      if (Array.isArray(value)) {
        if (value.length > 0) next.set(key, value.join(","));
      } else if (value !== null && value.length > 0) {
        next.set(key, value);
      }
      next.delete("page");
      navigate(next);
    },
    [cloneParams, navigate],
  );

  const reset = useCallback(() => {
    navigate(new URLSearchParams());
  }, [navigate]);

  return {
    page,
    pageSize,
    sortBy,
    sortOrder,
    search,
    filters,
    setPage,
    setSort,
    setSearch,
    setFilter,
    reset,
  };
}

const RESERVED = new Set(["page", "pageSize", "sortBy", "sortOrder", "q"]);

function parsePositiveInt(raw: string | null, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 1) return fallback;
  return n;
}

function nullIfEmpty(raw: string | null): string | null {
  if (!raw || raw.length === 0) return null;
  return raw;
}

function splitComma(value: string): string | string[] {
  const parts = value.split(",").filter((v) => v.length > 0);
  const first = parts[0];
  if (first === undefined) return "";
  if (parts.length === 1) return first;
  return parts;
}
