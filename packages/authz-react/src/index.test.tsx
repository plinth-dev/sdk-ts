import { render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Can,
  CanAll,
  CanAny,
  PermissionsProvider,
  usePermissions,
} from "./index.js";

// ── PermissionsProvider + usePermissions ─────────────────────────────

describe("usePermissions", () => {
  it("returns has/hasAny/hasAll/raw from the provider's map", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PermissionsProvider
        permissions={{ read: true, comment: true, delete: false }}
      >
        {children}
      </PermissionsProvider>
    );

    const { result } = renderHook(() => usePermissions(), { wrapper });

    expect(result.current.has("read")).toBe(true);
    expect(result.current.has("delete")).toBe(false);
    expect(result.current.has("nonexistent")).toBe(false);

    expect(result.current.hasAny(["read", "delete"])).toBe(true);
    expect(result.current.hasAny(["delete", "nonexistent"])).toBe(false);

    expect(result.current.hasAll(["read", "comment"])).toBe(true);
    expect(result.current.hasAll(["read", "delete"])).toBe(false);

    expect(result.current.raw).toEqual({
      read: true,
      comment: true,
      delete: false,
    });
  });

  it("treats missing actions as not-allowed (fail-closed)", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PermissionsProvider permissions={{}}>{children}</PermissionsProvider>
    );
    const { result } = renderHook(() => usePermissions(), { wrapper });
    expect(result.current.has("anything")).toBe(false);
  });
});

// ── Provider missing in tree ────────────────────────────────────────

describe("usePermissions outside provider", () => {
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
  });
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("throws in development", () => {
    process.env.NODE_ENV = "development";
    // Suppress React's error-boundary console.error noise during the throw.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(() => renderHook(() => usePermissions())).toThrow(
        /PermissionsProvider/,
      );
    } finally {
      spy.mockRestore();
    }
  });

  it("falls back to all-false in production", () => {
    process.env.NODE_ENV = "production";
    const { result } = renderHook(() => usePermissions());
    expect(result.current.has("anything")).toBe(false);
    expect(result.current.hasAny(["a", "b"])).toBe(false);
    expect(result.current.hasAll(["a", "b"])).toBe(false);
    expect(result.current.raw).toEqual({});
  });
});

// ── Strategy ───────────────────────────────────────────────────────

describe("nested provider strategies", () => {
  it("'replace' (default) discards parent permissions", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PermissionsProvider permissions={{ read: true, delete: true }}>
        <PermissionsProvider permissions={{ read: false }}>
          {children}
        </PermissionsProvider>
      </PermissionsProvider>
    );
    const { result } = renderHook(() => usePermissions(), { wrapper });
    expect(result.current.has("read")).toBe(false);
    // delete from parent is gone — replace strategy.
    expect(result.current.has("delete")).toBe(false);
  });

  it("'merge' overlays specific keys onto parent", () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PermissionsProvider permissions={{ read: true, delete: true }}>
        <PermissionsProvider permissions={{ read: false }} strategy="merge">
          {children}
        </PermissionsProvider>
      </PermissionsProvider>
    );
    const { result } = renderHook(() => usePermissions(), { wrapper });
    // Child's key wins.
    expect(result.current.has("read")).toBe(false);
    // Parent's key falls through.
    expect(result.current.has("delete")).toBe(true);
  });
});

// ── <Can> ──────────────────────────────────────────────────────────

describe("<Can>", () => {
  it("renders children when allowed", () => {
    render(
      <PermissionsProvider permissions={{ comment: true }}>
        <Can action="comment">
          <span>visible</span>
        </Can>
      </PermissionsProvider>,
    );
    expect(screen.getByText("visible")).toBeTruthy();
  });

  it("renders nothing by default when not allowed", () => {
    render(
      <PermissionsProvider permissions={{ comment: false }}>
        <Can action="comment">
          <span>visible</span>
        </Can>
      </PermissionsProvider>,
    );
    expect(screen.queryByText("visible")).toBeNull();
  });

  it("renders fallback when not allowed", () => {
    render(
      <PermissionsProvider permissions={{ delete: false }}>
        <Can action="delete" fallback={<span>read-only</span>}>
          <button type="button">Delete</button>
        </Can>
      </PermissionsProvider>,
    );
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("read-only")).toBeTruthy();
  });

  it("treats missing action as not allowed", () => {
    render(
      <PermissionsProvider permissions={{}}>
        <Can action="anything">
          <span>nope</span>
        </Can>
      </PermissionsProvider>,
    );
    expect(screen.queryByText("nope")).toBeNull();
  });
});

// ── <CanAny> / <CanAll> ────────────────────────────────────────────

describe("<CanAny>", () => {
  it("renders when any action is allowed", () => {
    render(
      <PermissionsProvider permissions={{ read: false, comment: true }}>
        <CanAny actions={["read", "comment"]}>
          <span>visible</span>
        </CanAny>
      </PermissionsProvider>,
    );
    expect(screen.getByText("visible")).toBeTruthy();
  });

  it("renders fallback when none are allowed", () => {
    render(
      <PermissionsProvider permissions={{ read: false, write: false }}>
        <CanAny actions={["read", "write"]} fallback={<span>none</span>}>
          <span>both</span>
        </CanAny>
      </PermissionsProvider>,
    );
    expect(screen.queryByText("both")).toBeNull();
    expect(screen.getByText("none")).toBeTruthy();
  });
});

describe("<CanAll>", () => {
  it("renders only when all are allowed", () => {
    render(
      <PermissionsProvider permissions={{ read: true, write: true }}>
        <CanAll actions={["read", "write"]}>
          <span>both</span>
        </CanAll>
      </PermissionsProvider>,
    );
    expect(screen.getByText("both")).toBeTruthy();
  });

  it("renders fallback when one is missing", () => {
    render(
      <PermissionsProvider permissions={{ read: true, write: false }}>
        <CanAll actions={["read", "write"]} fallback={<span>partial</span>}>
          <span>both</span>
        </CanAll>
      </PermissionsProvider>,
    );
    expect(screen.queryByText("both")).toBeNull();
    expect(screen.getByText("partial")).toBeTruthy();
  });
});
