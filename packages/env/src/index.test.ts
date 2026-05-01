import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  authSchema,
  baseSchema,
  cerbosSchema,
  createEnv,
  EnvValidationError,
  otelSchema,
  requiredInProduction,
} from "./index.js";

describe("createEnv", () => {
  it("returns the parsed env on success", () => {
    const env = createEnv({
      schema: z.object({
        FOO: z.string(),
        COUNT: z.coerce.number(),
      }),
      source: { FOO: "bar", COUNT: "42" },
    });
    expect(env.FOO).toBe("bar");
    expect(env.COUNT).toBe(42);
  });

  it("throws EnvValidationError on schema failure", () => {
    expect(() =>
      createEnv({
        schema: z.object({ REQUIRED: z.string() }),
        source: {},
      }),
    ).toThrow(EnvValidationError);
  });

  it("error message mentions every failing field", () => {
    try {
      createEnv({
        schema: z.object({ A: z.string(), B: z.string() }),
        source: {},
      });
    } catch (e) {
      expect(e).toBeInstanceOf(EnvValidationError);
      const msg = (e as EnvValidationError).message;
      expect(msg).toContain("A");
      expect(msg).toContain("B");
      expect(msg).toContain("env validation failed");
      return;
    }
    throw new Error("did not throw");
  });

  it("calls onError instead of throwing when provided", () => {
    const errors: z.ZodError[] = [];
    expect(() =>
      createEnv({
        schema: z.object({ X: z.string() }),
        source: {},
        onError: (e) => {
          errors.push(e);
          throw new Error("custom");
        },
      }),
    ).toThrow("custom");
    expect(errors).toHaveLength(1);
  });

  it("calls refine after schema parse", () => {
    expect(() =>
      createEnv({
        schema: z.object({ A: z.string(), B: z.string() }),
        source: { A: "x", B: "y" },
        refine: (env) => {
          if (env.A === env.B) return;
          throw new Error("A and B must match");
        },
      }),
    ).toThrow("A and B must match");
  });

  it("defaults source to process.env", () => {
    process.env.PLINTH_TEST_SOURCE_DEFAULT = "alpha";
    try {
      const env = createEnv({
        schema: z.object({ PLINTH_TEST_SOURCE_DEFAULT: z.string() }),
      });
      expect(env.PLINTH_TEST_SOURCE_DEFAULT).toBe("alpha");
    } finally {
      delete process.env.PLINTH_TEST_SOURCE_DEFAULT;
    }
  });
});

describe("baseSchema", () => {
  it("provides sensible defaults", () => {
    const env = createEnv({ schema: baseSchema, source: {} });
    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(8080);
  });

  it("rejects invalid NODE_ENV", () => {
    expect(() =>
      createEnv({ schema: baseSchema, source: { NODE_ENV: "weird" } }),
    ).toThrow(EnvValidationError);
  });

  it("coerces PORT", () => {
    const env = createEnv({ schema: baseSchema, source: { PORT: "9090" } });
    expect(env.PORT).toBe(9090);
  });

  it("rejects out-of-range ports", () => {
    expect(() =>
      createEnv({ schema: baseSchema, source: { PORT: "70000" } }),
    ).toThrow(EnvValidationError);
  });
});

describe("cerbosSchema", () => {
  it("requires CERBOS_ADDRESS", () => {
    expect(() => createEnv({ schema: cerbosSchema, source: {} })).toThrow(
      EnvValidationError,
    );
  });

  it("coerces booleans from common string forms", () => {
    const env = createEnv({
      schema: cerbosSchema,
      source: {
        CERBOS_ADDRESS: "cerbos:3593",
        CERBOS_TLS: "true",
        CERBOS_ALLOW_BYPASS: "1",
      },
    });
    expect(env.CERBOS_TLS).toBe(true);
    expect(env.CERBOS_ALLOW_BYPASS).toBe(true);
  });

  it("treats absent flags as false-equivalent (undefined)", () => {
    const env = createEnv({
      schema: cerbosSchema,
      source: { CERBOS_ADDRESS: "cerbos:3593" },
    });
    expect(env.CERBOS_TLS).toBeUndefined();
    expect(env.CERBOS_ALLOW_BYPASS).toBeUndefined();
  });
});

describe("otelSchema", () => {
  it("rejects malformed OTEL_EXPORTER_ENDPOINT", () => {
    expect(() =>
      createEnv({
        schema: otelSchema,
        source: { OTEL_EXPORTER_ENDPOINT: "not-a-url" },
      }),
    ).toThrow(EnvValidationError);
  });

  it("clamps OTEL_TRACES_SAMPLER_ARG to [0, 1]", () => {
    expect(() =>
      createEnv({
        schema: otelSchema,
        source: { OTEL_TRACES_SAMPLER_ARG: "1.5" },
      }),
    ).toThrow(EnvValidationError);
  });
});

describe("authSchema", () => {
  it("requires a minimum-length AUTH_SECRET", () => {
    expect(() =>
      createEnv({
        schema: authSchema,
        source: {
          AUTH_ISSUER: "https://auth.example.com",
          AUTH_AUDIENCE: "items",
          AUTH_SECRET: "short",
        },
      }),
    ).toThrow(EnvValidationError);
  });

  it("accepts a 32+ character secret", () => {
    const env = createEnv({
      schema: authSchema,
      source: {
        AUTH_ISSUER: "https://auth.example.com",
        AUTH_AUDIENCE: "items",
        AUTH_SECRET: "x".repeat(64),
      },
    });
    expect(env.AUTH_SECRET).toHaveLength(64);
  });
});

describe("requiredInProduction", () => {
  it("allows undefined when NODE_ENV is not production", () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    try {
      const env = createEnv({
        schema: z.object({
          OPTIONAL_IN_DEV: requiredInProduction(z.string()),
        }),
        source: {},
      });
      expect(env.OPTIONAL_IN_DEV).toBeUndefined();
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it("requires the value in production", () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      expect(() =>
        createEnv({
          schema: z.object({
            REQUIRED_IN_PROD: requiredInProduction(z.string()),
          }),
          source: {},
        }),
      ).toThrow(EnvValidationError);
    } finally {
      process.env.NODE_ENV = original;
    }
  });

  it("accepts a real value in production", () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const env = createEnv({
        schema: z.object({
          PROD_VAR: requiredInProduction(z.string()),
        }),
        source: { PROD_VAR: "actual-value" },
      });
      expect(env.PROD_VAR).toBe("actual-value");
    } finally {
      process.env.NODE_ENV = original;
    }
  });
});
