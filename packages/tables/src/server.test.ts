import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  parseTableSearchParams,
} from "./server.js";

describe("parseTableSearchParams — pagination", () => {
  it("defaults page=1 and pageSize=25 when absent", () => {
    const r = parseTableSearchParams({}, []);
    expect(r.page).toBe(DEFAULT_PAGE);
    expect(r.pageSize).toBe(DEFAULT_PAGE_SIZE);
  });

  it("parses positive integers from string params", () => {
    const r = parseTableSearchParams({ page: "3", pageSize: "50" }, []);
    expect(r.page).toBe(3);
    expect(r.pageSize).toBe(50);
  });

  it("falls back to defaults on garbage", () => {
    const r = parseTableSearchParams({ page: "abc", pageSize: "0" }, []);
    expect(r.page).toBe(DEFAULT_PAGE);
    expect(r.pageSize).toBe(DEFAULT_PAGE_SIZE);
  });

  it("clamps pageSize to MAX_PAGE_SIZE", () => {
    const r = parseTableSearchParams({ pageSize: "9999" }, []);
    expect(r.pageSize).toBe(MAX_PAGE_SIZE);
  });

  it("ignores negative pages", () => {
    const r = parseTableSearchParams({ page: "-2" }, []);
    expect(r.page).toBe(DEFAULT_PAGE);
  });

  it("takes the first value when an array is supplied", () => {
    const r = parseTableSearchParams({ page: ["7", "9"] }, []);
    expect(r.page).toBe(7);
  });
});

describe("parseTableSearchParams — sort", () => {
  it("defaults sortBy to '' and sortOrder to 'asc'", () => {
    const r = parseTableSearchParams({}, ["name"]);
    expect(r.sortBy).toBe("");
    expect(r.sortOrder).toBe("asc");
  });

  it("respects allowedSortColumns — accepted column passes through", () => {
    const r = parseTableSearchParams(
      { sortBy: "created_at", sortOrder: "desc" },
      ["created_at", "name"],
    );
    expect(r.sortBy).toBe("created_at");
    expect(r.sortOrder).toBe("desc");
  });

  it("drops sortBy when not in the allow-list (SQL-injection guard)", () => {
    const r = parseTableSearchParams(
      { sortBy: "DROP TABLE users", sortOrder: "asc" },
      ["created_at", "name"],
    );
    expect(r.sortBy).toBe("");
  });

  it("normalises sortOrder to 'asc' for any non-'desc' value", () => {
    const r = parseTableSearchParams({ sortBy: "name", sortOrder: "bogus" }, [
      "name",
    ]);
    expect(r.sortOrder).toBe("asc");
  });
});

describe("parseTableSearchParams — search", () => {
  it("returns null when q is absent", () => {
    expect(parseTableSearchParams({}, []).search).toBeNull();
  });

  it("returns null on empty string", () => {
    expect(parseTableSearchParams({ q: "" }, []).search).toBeNull();
  });

  it("returns the trimmed-as-given string", () => {
    expect(parseTableSearchParams({ q: "alpha" }, []).search).toBe("alpha");
  });
});

describe("parseTableSearchParams — filters", () => {
  it("everything non-reserved becomes a filter", () => {
    const r = parseTableSearchParams(
      { status: "active", priority: "high" },
      [],
    );
    expect(r.filters).toEqual({ status: "active", priority: "high" });
  });

  it("comma-separated values become arrays", () => {
    const r = parseTableSearchParams({ status: "active,archived" }, []);
    expect(r.filters.status).toEqual(["active", "archived"]);
  });

  it("a comma-separated single value reduces to a string", () => {
    const r = parseTableSearchParams({ status: "active," }, []);
    expect(r.filters.status).toBe("active");
  });

  it("repeated query params arrive as arrays", () => {
    const r = parseTableSearchParams({ tag: ["a", "b", "c"] }, []);
    expect(r.filters.tag).toEqual(["a", "b", "c"]);
  });

  it("empty values are dropped", () => {
    const r = parseTableSearchParams({ status: "", priority: ",," }, []);
    expect(r.filters).toEqual({});
  });

  it("reserved keys never end up in filters", () => {
    const r = parseTableSearchParams(
      {
        page: "2",
        pageSize: "10",
        sortBy: "name",
        sortOrder: "desc",
        q: "foo",
        status: "active",
      },
      ["name"],
    );
    expect(Object.keys(r.filters)).toEqual(["status"]);
  });

  it("date-range pattern: foo_from / foo_to land in filters", () => {
    const r = parseTableSearchParams(
      { created_from: "2026-01-01", created_to: "2026-12-31" },
      [],
    );
    expect(r.filters).toEqual({
      created_from: "2026-01-01",
      created_to: "2026-12-31",
    });
  });
});
