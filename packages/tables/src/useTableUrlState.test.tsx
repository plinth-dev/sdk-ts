import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock next/navigation up-front. The hook reads the searchParams /
// pathname and pushes via the router on every mutator.
const pushMock = vi.fn();
let currentSearch = "";
const pathnameMock = "/items";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => pathnameMock,
  useSearchParams: () => new URLSearchParams(currentSearch),
}));

// Imported after the mock is registered.
import { useTableUrlState } from "./useTableUrlState.js";

beforeEach(() => {
  pushMock.mockClear();
  currentSearch = "";
});

afterEach(() => {
  currentSearch = "";
});

describe("useTableUrlState — read", () => {
  it("returns sensible defaults when the URL has no params", () => {
    const { result } = renderHook(() => useTableUrlState());
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(25);
    expect(result.current.sortBy).toBeNull();
    expect(result.current.sortOrder).toBe("asc");
    expect(result.current.search).toBeNull();
    expect(result.current.filters).toEqual({});
  });

  it("parses page / pageSize / sortBy / sortOrder / q", () => {
    currentSearch = "page=3&pageSize=50&sortBy=name&sortOrder=desc&q=hello";
    const { result } = renderHook(() => useTableUrlState());
    expect(result.current.page).toBe(3);
    expect(result.current.pageSize).toBe(50);
    expect(result.current.sortBy).toBe("name");
    expect(result.current.sortOrder).toBe("desc");
    expect(result.current.search).toBe("hello");
  });

  it("falls back to defaults on garbage", () => {
    currentSearch = "page=abc&pageSize=0&sortOrder=bogus";
    const { result } = renderHook(() => useTableUrlState());
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(25);
    expect(result.current.sortOrder).toBe("asc");
  });
});

describe("useTableUrlState — filters", () => {
  it("non-reserved keys become filters", () => {
    currentSearch = "status=active&priority=high";
    const { result } = renderHook(() => useTableUrlState());
    expect(result.current.filters).toEqual({
      status: "active",
      priority: "high",
    });
  });

  it("comma-separated values become arrays", () => {
    currentSearch = "status=active,archived";
    const { result } = renderHook(() => useTableUrlState());
    expect(result.current.filters.status).toEqual(["active", "archived"]);
  });

  it("excludes reserved keys from the filters bag", () => {
    currentSearch =
      "page=2&pageSize=10&sortBy=name&sortOrder=desc&q=x&status=active";
    const { result } = renderHook(() => useTableUrlState());
    expect(Object.keys(result.current.filters)).toEqual(["status"]);
  });
});

describe("useTableUrlState — write", () => {
  it("setPage(2) pushes ?page=2", () => {
    const { result } = renderHook(() => useTableUrlState());
    act(() => result.current.setPage(2));
    expect(pushMock).toHaveBeenCalledWith("/items?page=2", { scroll: false });
  });

  it("setPage(1) drops the page param", () => {
    currentSearch = "page=5";
    const { result } = renderHook(() => useTableUrlState());
    act(() => result.current.setPage(1));
    expect(pushMock).toHaveBeenCalledWith("/items", { scroll: false });
  });

  it("setSort writes sortBy/sortOrder and resets page", () => {
    currentSearch = "page=4";
    const { result } = renderHook(() => useTableUrlState());
    act(() => result.current.setSort("name", "desc"));
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).toContain("sortBy=name");
    expect(url).toContain("sortOrder=desc");
    expect(url).not.toContain("page=4");
  });

  it("setSearch resets page and sets q", () => {
    currentSearch = "page=3";
    const { result } = renderHook(() => useTableUrlState());
    act(() => result.current.setSearch("hello"));
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).toContain("q=hello");
    expect(url).not.toContain("page=3");
  });

  it("setSearch(null) drops the q param", () => {
    currentSearch = "q=foo&page=3";
    const { result } = renderHook(() => useTableUrlState());
    act(() => result.current.setSearch(null));
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).not.toContain("q=");
    expect(url).not.toContain("page=3");
  });

  it("setFilter sets a single value", () => {
    const { result } = renderHook(() => useTableUrlState());
    act(() => result.current.setFilter("status", "active"));
    expect(pushMock).toHaveBeenCalledWith("/items?status=active", {
      scroll: false,
    });
  });

  it("setFilter joins arrays with commas", () => {
    const { result } = renderHook(() => useTableUrlState());
    act(() => result.current.setFilter("status", ["active", "archived"]));
    const url = pushMock.mock.calls[0][0] as string;
    expect(decodeURIComponent(url)).toBe("/items?status=active,archived");
  });

  it("setFilter(null) clears the key", () => {
    currentSearch = "status=active&page=2";
    const { result } = renderHook(() => useTableUrlState());
    act(() => result.current.setFilter("status", null));
    const url = pushMock.mock.calls[0][0] as string;
    expect(url).not.toContain("status=");
    expect(url).not.toContain("page=2");
  });

  it("setFilter throws in dev when called with a reserved key", () => {
    const orig = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      const { result } = renderHook(() => useTableUrlState());
      expect(() => result.current.setFilter("page", "2")).toThrow(/reserved/);
    } finally {
      process.env.NODE_ENV = orig;
    }
  });

  it("reset() clears all params", () => {
    currentSearch = "page=3&status=active&q=hello";
    const { result } = renderHook(() => useTableUrlState());
    act(() => result.current.reset());
    expect(pushMock).toHaveBeenCalledWith("/items", { scroll: false });
  });
});
