import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  api,
  clearRegistry,
  register,
  setFetchImpl,
  setTraceHeaderFunc,
} from "./index.js";

// Helper: build a fetch stub that returns a sequence of Responses.
function fetchStub(responses: Response[]): typeof fetch {
  let i = 0;
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => {
    if (i >= responses.length) {
      throw new Error(`fetch stub exhausted (no Response #${i})`);
    }
    return responses[i++];
  }) as unknown as typeof fetch;
}

function jsonResponse(
  status: number,
  body: unknown,
  contentType = "application/json",
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": contentType },
  });
}

beforeEach(() => {
  clearRegistry();
  setTraceHeaderFunc(() => undefined);
});

afterEach(() => {
  setFetchImpl(undefined);
});

describe("register / api", () => {
  it("returns a client with all 5 verbs", () => {
    register("foo", { baseUrl: "http://x" });
    const c = api("foo");
    expect(typeof c.get).toBe("function");
    expect(typeof c.post).toBe("function");
    expect(typeof c.put).toBe("function");
    expect(typeof c.patch).toBe("function");
    expect(typeof c.delete).toBe("function");
  });

  it("throws synchronously for unregistered names", () => {
    expect(() => api("nonexistent")).toThrow(/not registered/);
  });

  it("re-registering replaces config", () => {
    register("foo", { baseUrl: "http://a" });
    register("foo", { baseUrl: "http://b" });
    const calls: string[] = [];
    setFetchImpl(
      vi.fn(async (url) => {
        calls.push(String(url));
        return jsonResponse(200, {});
      }) as unknown as typeof fetch,
    );
    return api("foo")
      .get("/x")
      .then(() => {
        expect(calls).toEqual(["http://b/x"]);
      });
  });
});

describe("happy path", () => {
  it("decodes a 200 JSON response into data", async () => {
    register("foo", { baseUrl: "http://x" });
    setFetchImpl(fetchStub([jsonResponse(200, { hello: "world" })]));

    const res = await api("foo").get<{ hello: string }>("/items");
    expect(res.success).toBe(true);
    expect(res.error).toBeNull();
    expect(res.data?.hello).toBe("world");
    expect(res.meta.status).toBe(200);
  });

  it("returns null data for 204 No Content", async () => {
    register("foo", { baseUrl: "http://x" });
    setFetchImpl(fetchStub([new Response(null, { status: 204 })]));

    const res = await api("foo").delete("/items/abc");
    expect(res.success).toBe(true);
    expect(res.data).toBeNull();
    expect(res.meta.status).toBe(204);
  });

  it("returns text for non-JSON 2xx", async () => {
    register("foo", { baseUrl: "http://x" });
    setFetchImpl(
      fetchStub([
        new Response("plain text body", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      ]),
    );
    const res = await api("foo").get<string>("/text");
    expect(res.success).toBe(true);
    expect(res.data).toBe("plain text body");
  });
});

describe("RFC 7807 problem+json parsing", () => {
  it("parses code, message, fields from the body", async () => {
    register("foo", { baseUrl: "http://x" });
    const problem = {
      type: "https://plinth.run/errors/validation",
      title: "Validation failed",
      status: 422,
      detail: "body failed validation",
      code: "validation",
      fields: { email: "must be valid" },
    };
    setFetchImpl(
      fetchStub([jsonResponse(422, problem, "application/problem+json")]),
    );

    const res = await api("foo").post("/items", { x: 1 });
    expect(res.success).toBe(false);
    expect(res.error?.status).toBe(422);
    expect(res.error?.code).toBe("validation");
    expect(res.error?.message).toContain("body failed");
    expect(res.error?.fields?.email).toBe("must be valid");
  });

  it("falls back to text body for non-JSON error", async () => {
    register("foo", { baseUrl: "http://x" });
    setFetchImpl(
      fetchStub([
        new Response("upstream cooked", {
          status: 500,
          headers: { "content-type": "text/plain" },
        }),
      ]),
    );
    const res = await api("foo").get("/x");
    expect(res.success).toBe(false);
    expect(res.error?.code).toBe("unknown");
    expect(res.error?.message).toContain("upstream cooked");
  });
});

describe("retries", () => {
  it("retries on 503 then succeeds", async () => {
    register("foo", { baseUrl: "http://x", retry: { count: 2, backoffMs: 1 } });
    setFetchImpl(
      fetchStub([
        new Response(null, { status: 503 }),
        new Response(null, { status: 503 }),
        jsonResponse(200, { ok: true }),
      ]),
    );

    const res = await api("foo").get("/x");
    expect(res.success).toBe(true);
  });

  it("returns the last failure after exhausting retries", async () => {
    register("foo", { baseUrl: "http://x", retry: { count: 1, backoffMs: 1 } });
    setFetchImpl(
      fetchStub([
        new Response(null, { status: 503 }),
        new Response(null, { status: 503 }),
      ]),
    );
    const res = await api("foo").get("/x");
    expect(res.success).toBe(false);
    expect(res.error?.status).toBe(503);
  });

  it("does not retry on 4xx", async () => {
    register("foo", { baseUrl: "http://x", retry: { count: 3, backoffMs: 1 } });
    const stub = fetchStub([new Response(null, { status: 404 })]);
    setFetchImpl(stub);
    const res = await api("foo").get("/x");
    expect(res.success).toBe(false);
    expect(res.error?.status).toBe(404);
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it("retries on network errors", async () => {
    register("foo", { baseUrl: "http://x", retry: { count: 1, backoffMs: 1 } });
    let calls = 0;
    setFetchImpl(
      vi.fn(async () => {
        calls++;
        if (calls === 1) throw new TypeError("ECONNRESET");
        return jsonResponse(200, {});
      }) as unknown as typeof fetch,
    );
    const res = await api("foo").get("/x");
    expect(res.success).toBe(true);
    expect(calls).toBe(2);
  });
});

describe("auth + headers", () => {
  it("calls authHeader per request", async () => {
    let calls = 0;
    register("foo", {
      baseUrl: "http://x",
      authHeader: () => {
        calls++;
        return `Bearer token-${calls}`;
      },
    });
    let lastInit: RequestInit | undefined;
    setFetchImpl(
      vi.fn(async (_url, init) => {
        lastInit = init;
        return jsonResponse(200, {});
      }) as unknown as typeof fetch,
    );
    await api("foo").get("/a");
    expect((lastInit?.headers as Headers).get("authorization")).toBe(
      "Bearer token-1",
    );
    await api("foo").get("/b");
    expect((lastInit?.headers as Headers).get("authorization")).toBe(
      "Bearer token-2",
    );
    expect(calls).toBe(2);
  });

  it("supports async authHeader", async () => {
    register("foo", {
      baseUrl: "http://x",
      authHeader: async () => "Bearer async-tok",
    });
    let lastInit: RequestInit | undefined;
    setFetchImpl(
      vi.fn(async (_url, init) => {
        lastInit = init;
        return jsonResponse(200, {});
      }) as unknown as typeof fetch,
    );
    await api("foo").get("/a");
    expect((lastInit?.headers as Headers).get("authorization")).toBe(
      "Bearer async-tok",
    );
  });

  it("merges defaultHeaders + per-call headers (per-call wins)", async () => {
    register("foo", {
      baseUrl: "http://x",
      defaultHeaders: {
        "x-default": "default-value",
        "x-shared": "from-config",
      },
    });
    let lastInit: RequestInit | undefined;
    setFetchImpl(
      vi.fn(async (_url, init) => {
        lastInit = init;
        return jsonResponse(200, {});
      }) as unknown as typeof fetch,
    );
    await api("foo").get("/x", {
      headers: { "x-shared": "from-call", "x-call": "extra" },
    });
    const h = lastInit?.headers as Headers;
    expect(h.get("x-default")).toBe("default-value");
    expect(h.get("x-shared")).toBe("from-call"); // per-call wins
    expect(h.get("x-call")).toBe("extra");
  });

  it("injects trace headers when configured", async () => {
    setTraceHeaderFunc(() => ({ traceparent: "00-aaaa-bbbb-01" }));
    register("foo", { baseUrl: "http://x" });
    let lastInit: RequestInit | undefined;
    setFetchImpl(
      vi.fn(async (_url, init) => {
        lastInit = init;
        return jsonResponse(200, {});
      }) as unknown as typeof fetch,
    );
    await api("foo").get("/x");
    expect((lastInit?.headers as Headers).get("traceparent")).toBe(
      "00-aaaa-bbbb-01",
    );
  });
});

describe("body serialization", () => {
  it("auto-stringifies object bodies and sets content-type", async () => {
    register("foo", { baseUrl: "http://x" });
    let captured: { url: string; init: RequestInit | undefined } | undefined;
    setFetchImpl(
      vi.fn(async (url, init) => {
        captured = { url: String(url), init };
        return jsonResponse(201, { id: "abc" });
      }) as unknown as typeof fetch,
    );
    await api("foo").post("/items", { name: "thing" });
    expect(captured?.init?.body).toBe(JSON.stringify({ name: "thing" }));
    expect((captured?.init?.headers as Headers).get("content-type")).toBe(
      "application/json",
    );
  });

  it("does not double-encode string bodies", async () => {
    register("foo", { baseUrl: "http://x" });
    let lastInit: RequestInit | undefined;
    setFetchImpl(
      vi.fn(async (_url, init) => {
        lastInit = init;
        return jsonResponse(200, {});
      }) as unknown as typeof fetch,
    );
    await api("foo").post("/x", "raw text");
    expect(lastInit?.body).toBe("raw text");
  });
});

describe("URL joining", () => {
  it("handles trailing slash on base + leading slash on path", async () => {
    register("foo", { baseUrl: "http://x/" });
    let captured = "";
    setFetchImpl(
      vi.fn(async (url) => {
        captured = String(url);
        return jsonResponse(200, {});
      }) as unknown as typeof fetch,
    );
    await api("foo").get("/items/abc");
    expect(captured).toBe("http://x/items/abc");
  });

  it("handles missing slashes", async () => {
    register("foo", { baseUrl: "http://x" });
    let captured = "";
    setFetchImpl(
      vi.fn(async (url) => {
        captured = String(url);
        return jsonResponse(200, {});
      }) as unknown as typeof fetch,
    );
    await api("foo").get("items/abc");
    expect(captured).toBe("http://x/items/abc");
  });
});

describe("meta", () => {
  it("captures traceparent and x-request-id from the response", async () => {
    register("foo", { baseUrl: "http://x" });
    setFetchImpl(
      fetchStub([
        new Response(JSON.stringify({}), {
          status: 200,
          headers: {
            "content-type": "application/json",
            traceparent: "00-trace-span-01",
            "x-request-id": "req-xyz",
          },
        }),
      ]),
    );
    const res = await api("foo").get("/x");
    expect(res.meta.traceId).toBe("00-trace-span-01");
    expect(res.meta.requestId).toBe("req-xyz");
  });
});
