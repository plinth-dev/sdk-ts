import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthzClient,
  BypassInProductionError,
  type CerbosBackend,
  type Logger,
  resetClient,
} from "./index.js";

// ── Fake Cerbos backend ─────────────────────────────────────────────

interface FakeBackendCalls {
  isAllowed: number;
  checkResource: number;
  serverInfo: number;
  lastIsAllowedAction?: string;
  lastResource?: { kind: string; id: string };
}

function makeFakeBackend(opts: {
  isAllowedReturns?: boolean;
  isAllowedThrows?: Error;
  checkResourceReturns?: Record<string, boolean>;
  checkResourceThrows?: Error;
  serverInfoThrows?: Error;
}): { backend: CerbosBackend; calls: FakeBackendCalls } {
  const calls: FakeBackendCalls = {
    isAllowed: 0,
    checkResource: 0,
    serverInfo: 0,
  };
  const backend: CerbosBackend = {
    isAllowed: async (req) => {
      calls.isAllowed++;
      calls.lastIsAllowedAction = req.action;
      calls.lastResource = { kind: req.resource.kind, id: req.resource.id };
      if (opts.isAllowedThrows) throw opts.isAllowedThrows;
      return opts.isAllowedReturns ?? false;
    },
    checkResource: async (req) => {
      calls.checkResource++;
      if (opts.checkResourceThrows) throw opts.checkResourceThrows;
      const map = opts.checkResourceReturns ?? {};
      return {
        isAllowed: (action: string) => {
          if (!(action in map) && req.actions.includes(action)) {
            // Action requested but not in the script — emulate Cerbos
            // returning false for actions not explicitly allowed.
            return false;
          }
          return map[action];
        },
      };
    },
    serverInfo: async () => {
      calls.serverInfo++;
      if (opts.serverInfoThrows) throw opts.serverInfoThrows;
      return {};
    },
  };
  return { backend, calls };
}

// Silent logger so test output isn't littered with warn lines.
const silentLogger: Logger = { warn: () => {}, error: () => {} };

// ── BypassInProduction ─────────────────────────────────────────────

describe("BypassInProductionError", () => {
  let originalEnvBypass: string | undefined;
  beforeEach(() => {
    originalEnvBypass = process.env.CERBOS_ALLOW_BYPASS;
  });
  afterEach(() => {
    if (originalEnvBypass === undefined) delete process.env.CERBOS_ALLOW_BYPASS;
    else process.env.CERBOS_ALLOW_BYPASS = originalEnvBypass;
  });

  it("rejects bypass when envName is 'production'", () => {
    process.env.CERBOS_ALLOW_BYPASS = "1";
    expect(
      () =>
        new AuthzClient({
          address: "x",
          envName: "production",
          logger: silentLogger,
        }),
    ).toThrow(BypassInProductionError);
  });

  it("allows bypass in dev", () => {
    process.env.CERBOS_ALLOW_BYPASS = "1";
    const fake = makeFakeBackend({});
    expect(
      () =>
        new AuthzClient(
          { address: "x", envName: "dev", logger: silentLogger },
          fake.backend,
        ),
    ).not.toThrow();
  });

  it("does not bypass when env var is unset", () => {
    delete process.env.CERBOS_ALLOW_BYPASS;
    const fake = makeFakeBackend({ isAllowedReturns: true });
    const client = new AuthzClient(
      { address: "x", envName: "production", logger: silentLogger },
      fake.backend,
    );
    return client
      .checkAction({ id: "u1", roles: ["r"] }, { kind: "K", id: "i" }, "read")
      .then((d) => {
        expect(d.reason).toBe("Allowed");
        expect(fake.calls.isAllowed).toBe(1);
      });
  });

  it("rejects ClientOptions without address", () => {
    expect(() => new AuthzClient({ address: "" })).toThrow(
      /address is required/,
    );
  });
});

// ── checkAction ────────────────────────────────────────────────────

describe("checkAction", () => {
  it("returns Allowed when PDP allows", async () => {
    const fake = makeFakeBackend({ isAllowedReturns: true });
    const client = new AuthzClient(
      { address: "x", envName: "dev", logger: silentLogger },
      fake.backend,
    );
    const d = await client.checkAction(
      { id: "u1", roles: ["editor"] },
      { kind: "Item", id: "i1" },
      "update",
    );
    expect(d.allowed).toBe(true);
    expect(d.reason).toBe("Allowed");
    expect(d.action).toBe("update");
    expect(fake.calls.lastIsAllowedAction).toBe("update");
  });

  it("returns Denied when PDP denies", async () => {
    const fake = makeFakeBackend({ isAllowedReturns: false });
    const client = new AuthzClient(
      { address: "x", envName: "dev", logger: silentLogger },
      fake.backend,
    );
    const d = await client.checkAction(
      { id: "u1", roles: [] },
      { kind: "K", id: "i" },
      "delete",
    );
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("Denied");
  });

  it("returns Unreachable on transport error (fail-closed)", async () => {
    const fake = makeFakeBackend({
      isAllowedThrows: new Error("connection refused"),
    });
    const client = new AuthzClient(
      { address: "x", envName: "dev", logger: silentLogger },
      fake.backend,
    );
    const d = await client.checkAction(
      { id: "u1", roles: [] },
      { kind: "K", id: "i" },
      "read",
    );
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("Unreachable");
  });

  it("never throws, even on backend error", async () => {
    const fake = makeFakeBackend({ isAllowedThrows: new Error("boom") });
    const client = new AuthzClient(
      { address: "x", envName: "dev", logger: silentLogger },
      fake.backend,
    );
    // .resolves is the assertion that we don't throw.
    await expect(
      client.checkAction(
        { id: "u1", roles: [] },
        { kind: "K", id: "i" },
        "read",
      ),
    ).resolves.toBeDefined();
  });

  it("propagates principal/resource attributes", async () => {
    const fake = makeFakeBackend({ isAllowedReturns: true });
    const client = new AuthzClient(
      { address: "x", envName: "dev", logger: silentLogger },
      fake.backend,
    );
    await client.checkAction(
      { id: "u1", roles: ["editor"], attributes: { team: "platform" } },
      { kind: "Item", id: "i1", attributes: { owner: "u2" } },
      "update",
    );
    expect(fake.calls.lastResource).toEqual({ kind: "Item", id: "i1" });
  });

  it("logs and short-circuits in bypass mode", async () => {
    const originalBypass = process.env.CERBOS_ALLOW_BYPASS;
    process.env.CERBOS_ALLOW_BYPASS = "1";
    try {
      const fake = makeFakeBackend({
        isAllowedThrows: new Error("would error"),
      });
      const warnings: string[] = [];
      const logger: Logger = {
        warn: (msg) => warnings.push(msg),
        error: () => {},
      };
      const client = new AuthzClient(
        { address: "x", envName: "dev", logger },
        fake.backend,
      );
      const d = await client.checkAction(
        { id: "u1", roles: [] },
        { kind: "K", id: "i" },
        "read",
      );
      expect(d).toEqual({ allowed: true, reason: "Bypassed", action: "read" });
      expect(fake.calls.isAllowed).toBe(0); // backend never called
      expect(warnings.some((m) => m.includes("BYPASS"))).toBe(true);
    } finally {
      if (originalBypass === undefined) delete process.env.CERBOS_ALLOW_BYPASS;
      else process.env.CERBOS_ALLOW_BYPASS = originalBypass;
    }
  });
});

// ── checkActions ───────────────────────────────────────────────────

describe("checkActions", () => {
  it("returns per-action decisions", async () => {
    const fake = makeFakeBackend({
      checkResourceReturns: { read: true, update: true, delete: false },
    });
    const client = new AuthzClient(
      { address: "x", envName: "dev", logger: silentLogger },
      fake.backend,
    );
    const decisions = await client.checkActions(
      { id: "u1", roles: ["editor"] },
      { kind: "Item", id: "i1" },
      ["read", "update", "delete"],
    );
    expect(decisions.read?.allowed).toBe(true);
    expect(decisions.update?.allowed).toBe(true);
    expect(decisions.delete?.allowed).toBe(false);
    expect(fake.calls.checkResource).toBe(1);
  });

  it("returns all-Unreachable on transport error", async () => {
    const fake = makeFakeBackend({ checkResourceThrows: new Error("boom") });
    const client = new AuthzClient(
      { address: "x", envName: "dev", logger: silentLogger },
      fake.backend,
    );
    const decisions = await client.checkActions(
      { id: "u1", roles: [] },
      { kind: "K", id: "i" },
      ["a", "b", "c"],
    );
    for (const action of ["a", "b", "c"]) {
      expect(decisions[action]?.reason).toBe("Unreachable");
      expect(decisions[action]?.allowed).toBe(false);
    }
  });

  it("returns all-Bypassed in bypass mode", async () => {
    const originalBypass = process.env.CERBOS_ALLOW_BYPASS;
    process.env.CERBOS_ALLOW_BYPASS = "1";
    try {
      const fake = makeFakeBackend({});
      const client = new AuthzClient(
        { address: "x", envName: "dev", logger: silentLogger },
        fake.backend,
      );
      const decisions = await client.checkActions(
        { id: "u1", roles: [] },
        { kind: "K", id: "i" },
        ["read", "delete"],
      );
      for (const action of ["read", "delete"]) {
        expect(decisions[action]?.allowed).toBe(true);
        expect(decisions[action]?.reason).toBe("Bypassed");
      }
      expect(fake.calls.checkResource).toBe(0);
    } finally {
      if (originalBypass === undefined) delete process.env.CERBOS_ALLOW_BYPASS;
      else process.env.CERBOS_ALLOW_BYPASS = originalBypass;
    }
  });
});

// ── permissionMap ──────────────────────────────────────────────────

describe("permissionMap", () => {
  it("returns a flat boolean record", async () => {
    const fake = makeFakeBackend({
      checkResourceReturns: { read: true, delete: false },
    });
    const client = new AuthzClient(
      { address: "x", envName: "dev", logger: silentLogger },
      fake.backend,
    );
    const perms = await client.permissionMap(
      { id: "u1", roles: ["r"] },
      { kind: "K", id: "i" },
      ["read", "delete"],
    );
    expect(perms).toEqual({ read: true, delete: false });
  });

  it("fails closed on transport error", async () => {
    const fake = makeFakeBackend({ checkResourceThrows: new Error("boom") });
    const client = new AuthzClient(
      { address: "x", envName: "dev", logger: silentLogger },
      fake.backend,
    );
    const perms = await client.permissionMap(
      { id: "u1", roles: [] },
      { kind: "K", id: "i" },
      ["read", "delete"],
    );
    expect(perms).toEqual({ read: false, delete: false });
  });
});

// ── ping ───────────────────────────────────────────────────────────

describe("ping", () => {
  it("calls serverInfo", async () => {
    const fake = makeFakeBackend({});
    const client = new AuthzClient(
      { address: "x", envName: "dev", logger: silentLogger },
      fake.backend,
    );
    await client.ping();
    expect(fake.calls.serverInfo).toBe(1);
  });

  it("propagates errors", async () => {
    const fake = makeFakeBackend({ serverInfoThrows: new Error("PDP down") });
    const client = new AuthzClient(
      { address: "x", envName: "dev", logger: silentLogger },
      fake.backend,
    );
    await expect(client.ping()).rejects.toThrow("PDP down");
  });

  it("skips backend in bypass mode", async () => {
    const originalBypass = process.env.CERBOS_ALLOW_BYPASS;
    process.env.CERBOS_ALLOW_BYPASS = "1";
    try {
      const fake = makeFakeBackend({
        serverInfoThrows: new Error("would error"),
      });
      const client = new AuthzClient(
        { address: "x", envName: "dev", logger: silentLogger },
        fake.backend,
      );
      await expect(client.ping()).resolves.toBeUndefined();
      expect(fake.calls.serverInfo).toBe(0);
    } finally {
      if (originalBypass === undefined) delete process.env.CERBOS_ALLOW_BYPASS;
      else process.env.CERBOS_ALLOW_BYPASS = originalBypass;
    }
  });
});

// ── close ──────────────────────────────────────────────────────────

describe("close", () => {
  it("is a no-op", async () => {
    const fake = makeFakeBackend({});
    const client = new AuthzClient(
      { address: "x", envName: "dev", logger: silentLogger },
      fake.backend,
    );
    await expect(client.close()).resolves.toBeUndefined();
  });
});

// ── getClient singleton ────────────────────────────────────────────

describe("getClient", () => {
  beforeEach(() => {
    resetClient();
  });

  it("requires CERBOS_ADDRESS", () => {
    delete process.env.CERBOS_ADDRESS;
    // Spawn into expect() so the lazy init throws inside it
    return import("./index.js").then(({ getClient }) => {
      expect(() => getClient()).toThrow(/CERBOS_ADDRESS/);
    });
  });
});

// Avoid leaking spy state if vi was used elsewhere (kept for parity).
afterEach(() => {
  vi.restoreAllMocks();
});
