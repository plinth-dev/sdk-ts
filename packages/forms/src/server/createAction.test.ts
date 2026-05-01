import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  resetAdaptersForTests,
  setAuthContextFunc,
  setRedirectFunc,
  setRevalidateFunc,
  setRevalidateTagFunc,
  setTraceIdFunc,
} from "./adapters.js";
import {
  createAction,
  formDataToObject,
  zodIssuesToFields,
} from "./createAction.js";

afterEach(() => {
  resetAdaptersForTests();
});

// ── Schema validation ─────────────────────────────────────────────

describe("createAction — validation", () => {
  it("returns success on valid input", async () => {
    const action = createAction({
      schema: z.object({ name: z.string().min(1) }),
      execute: async (input) => ({ id: "abc", name: input.name }),
    });

    const result = await action({ name: "ok" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ id: "abc", name: "ok" });
    }
  });

  it("returns success:false with field errors on validation failure", async () => {
    const action = createAction({
      schema: z.object({
        name: z.string().min(1),
        email: z.email(),
      }),
      execute: async () => "unused",
    });

    const result = await action({ name: "", email: "not-an-email" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBe("validation failed");
      expect(result.fields?.name?.length).toBeGreaterThan(0);
      expect(result.fields?.email?.length).toBeGreaterThan(0);
    }
  });

  it("does not call execute when validation fails", async () => {
    const execute = vi.fn(async () => "result");
    const action = createAction({
      schema: z.object({ name: z.string().min(5) }),
      execute,
    });

    await action({ name: "no" });
    expect(execute).not.toHaveBeenCalled();
  });
});

// ── FormData input ────────────────────────────────────────────────

describe("createAction — FormData input", () => {
  it("accepts FormData and parses it via the schema", async () => {
    const action = createAction({
      schema: z.object({
        name: z.string(),
        count: z.coerce.number(),
      }),
      execute: async (input) => input,
    });

    const fd = new FormData();
    fd.set("name", "thing");
    fd.set("count", "42");

    const result = await action(fd);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ name: "thing", count: 42 });
    }
  });

  it("multi-value fields become arrays", () => {
    const fd = new FormData();
    fd.append("tags", "a");
    fd.append("tags", "b");
    fd.set("name", "thing");

    const obj = formDataToObject(fd);
    expect(obj.tags).toEqual(["a", "b"]);
    expect(obj.name).toBe("thing");
  });
});

// ── Auth context ─────────────────────────────────────────────────

describe("createAction — auth context", () => {
  it("defaults to user:null and traceId:''", async () => {
    let captured: { user: unknown; traceId: string } | undefined;
    const action = createAction({
      schema: z.object({ x: z.string() }),
      execute: async (_input, ctx) => {
        captured = { user: ctx.user, traceId: ctx.traceId };
        return "ok";
      },
    });

    await action({ x: "y" });
    expect(captured?.user).toBeNull();
    expect(captured?.traceId).toBe("");
  });

  it("uses registered authContext + traceId adapters", async () => {
    setAuthContextFunc(() => ({ id: "u1", roles: ["editor"] }));
    setTraceIdFunc(() => "trace-abc");

    let captured: { user: unknown; traceId: string } | undefined;
    const action = createAction({
      schema: z.object({}),
      execute: async (_input, ctx) => {
        captured = { user: ctx.user, traceId: ctx.traceId };
        return "ok";
      },
    });

    await action({});
    expect(captured?.user).toEqual({ id: "u1", roles: ["editor"] });
    expect(captured?.traceId).toBe("trace-abc");
  });

  it("supports async authContext adapter", async () => {
    setAuthContextFunc(async () => ({ id: "u2", roles: [] }));

    let captured: unknown;
    const action = createAction({
      schema: z.object({}),
      execute: async (_input, ctx) => {
        captured = ctx.user;
        return "ok";
      },
    });

    await action({});
    expect(captured).toEqual({ id: "u2", roles: [] });
  });
});

// ── Revalidate adapters ──────────────────────────────────────────

describe("createAction — revalidate", () => {
  it("calls revalidatePath for single path", async () => {
    const fn = vi.fn();
    setRevalidateFunc(fn);

    const action = createAction({
      schema: z.object({}),
      execute: async () => "ok",
      revalidate: "/items",
    });

    await action({});
    expect(fn).toHaveBeenCalledWith("/items");
  });

  it("calls revalidatePath for each path in array", async () => {
    const fn = vi.fn();
    setRevalidateFunc(fn);

    const action = createAction({
      schema: z.object({}),
      execute: async () => "ok",
      revalidate: ["/items", "/items/abc"],
    });

    await action({});
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, "/items");
    expect(fn).toHaveBeenNthCalledWith(2, "/items/abc");
  });

  it("calls revalidateTag for each tag", async () => {
    const fn = vi.fn();
    setRevalidateTagFunc(fn);

    const action = createAction({
      schema: z.object({}),
      execute: async () => "ok",
      revalidateTags: ["items", "items:abc"],
    });

    await action({});
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenCalledWith("items");
    expect(fn).toHaveBeenCalledWith("items:abc");
  });

  it("does not revalidate on validation failure", async () => {
    const fn = vi.fn();
    setRevalidateFunc(fn);

    const action = createAction({
      schema: z.object({ x: z.string().min(1) }),
      execute: async () => "ok",
      revalidate: "/x",
    });

    await action({ x: "" });
    expect(fn).not.toHaveBeenCalled();
  });
});

// ── successMessage ────────────────────────────────────────────────

describe("createAction — successMessage", () => {
  it("string message is included in result", async () => {
    const action = createAction({
      schema: z.object({}),
      execute: async () => "data",
      successMessage: "Saved.",
    });

    const r = await action({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.message).toBe("Saved.");
    }
  });

  it("function message receives data", async () => {
    const action = createAction({
      schema: z.object({}),
      execute: async () => ({ name: "alpha" }),
      successMessage: (data) => `Saved ${data.name}.`,
    });

    const r = await action({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.message).toBe("Saved alpha.");
    }
  });

  it("omits message when not configured", async () => {
    const action = createAction({
      schema: z.object({}),
      execute: async () => "data",
    });

    const r = await action({});
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.message).toBeUndefined();
    }
  });
});

// ── redirectTo ────────────────────────────────────────────────────

describe("createAction — redirectTo", () => {
  it("calls the redirect adapter with a string URL", async () => {
    const fn = vi.fn();
    setRedirectFunc(fn);

    const action = createAction({
      schema: z.object({}),
      execute: async () => "ok",
      redirectTo: "/items/abc",
    });

    await action({});
    expect(fn).toHaveBeenCalledWith("/items/abc");
  });

  it("calls the redirect adapter with the function-derived URL", async () => {
    const fn = vi.fn();
    setRedirectFunc(fn);

    const action = createAction({
      schema: z.object({}),
      execute: async () => ({ id: "xyz" }),
      redirectTo: (data) => `/items/${data.id}`,
    });

    await action({});
    expect(fn).toHaveBeenCalledWith("/items/xyz");
  });

  it("does not redirect when the function returns undefined", async () => {
    const fn = vi.fn();
    setRedirectFunc(fn);

    const action = createAction({
      schema: z.object({}),
      execute: async () => "ok",
      redirectTo: () => undefined,
    });

    await action({});
    expect(fn).not.toHaveBeenCalled();
  });

  it("re-throws Next.js framework signal errors (NEXT_REDIRECT)", async () => {
    const action = createAction({
      schema: z.object({}),
      execute: async () => {
        const err = new Error("redirect");
        // Mimic Next.js framework signal shape.
        (err as unknown as { digest: string }).digest =
          "NEXT_REDIRECT;https://x";
        throw err;
      },
    });

    await expect(action({})).rejects.toThrow("redirect");
  });
});

// ── Execute errors ────────────────────────────────────────────────

describe("createAction — execute errors", () => {
  it("non-framework errors become success:false", async () => {
    const action = createAction({
      schema: z.object({}),
      execute: async () => {
        throw new Error("DB blew up");
      },
    });

    const r = await action({});
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toBe("DB blew up");
    }
  });

  it("preserves stringified non-Error throws", async () => {
    const action = createAction({
      schema: z.object({}),
      execute: async () => {
        throw "raw string error";
      },
    });

    const r = await action({});
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toBe("raw string error");
    }
  });
});

// ── Helper: zodIssuesToFields ─────────────────────────────────────

describe("zodIssuesToFields", () => {
  it("buckets per-field issues by joined path", () => {
    const schema = z.object({
      user: z.object({
        email: z.email(),
        age: z.number().min(18),
      }),
    });
    const result = schema.safeParse({ user: { email: "x", age: 5 } });
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = zodIssuesToFields(result.error);
      expect(fields["user.email"]?.length).toBeGreaterThan(0);
      expect(fields["user.age"]?.length).toBeGreaterThan(0);
    }
  });

  it("buckets root-level issues under '_root'", () => {
    const schema = z.string();
    const result = schema.safeParse(42);
    expect(result.success).toBe(false);
    if (!result.success) {
      const fields = zodIssuesToFields(result.error);
      expect(fields._root?.length).toBeGreaterThan(0);
    }
  });
});
