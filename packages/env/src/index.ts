/**
 * Plinth env: Zod-validated environment variables, fail-fast at module load.
 *
 * The whole point: a bad env should crash startup, not surface as a 500
 * thirty minutes after deploy. Each module composes a Zod schema (typically
 * by merging `baseSchema` + the platform fragments + module-specific fields)
 * and calls `createEnv` once. Returns the typed env object; throws on first
 * import if validation fails.
 *
 * See https://plinth.run/sdk/ts/env/ for the design rationale.
 */

import { z } from "zod";

// ── Public API ──────────────────────────────────────────────────────

/** Configuration for {@link createEnv}. */
export interface CreateEnvOptions<S extends z.ZodObject> {
  /** Zod schema describing the expected shape. */
  schema: S;

  /**
   * Optional cross-field validation. Throws via {@link z.ZodError} (or any
   * thrown value) to surface in the same error path as schema failures.
   * Useful for "if A is set, B must also be set" rules that Zod's per-field
   * .superRefine doesn't express cleanly.
   */
  refine?: (env: z.infer<S>) => void;

  /**
   * Source map. Defaults to `process.env`. Override for tests.
   */
  source?: Record<string, string | undefined>;

  /**
   * Hook to customise the failure path. Defaults to throwing.
   * Override for graceful degradation in tests; in production code
   * letting the throw bubble up so Node logs and exits is the right move.
   */
  onError?: (error: z.ZodError) => never;
}

/**
 * Validate {@link CreateEnvOptions.source} (or `process.env`) against
 * {@link CreateEnvOptions.schema}. Returns the typed env object.
 *
 * Throws on validation failure. By default the thrown value is the formatted
 * Zod error; Node logs it with a clear message and exits.
 */
export function createEnv<S extends z.ZodObject>(
  options: CreateEnvOptions<S>,
): z.infer<S> {
  const source =
    options.source ?? (process.env as Record<string, string | undefined>);

  const result = options.schema.safeParse(source);
  if (!result.success) {
    if (options.onError) {
      options.onError(result.error);
    }
    throw new EnvValidationError(result.error);
  }

  if (options.refine) {
    options.refine(result.data);
  }

  return result.data;
}

/**
 * The error thrown by {@link createEnv} on validation failure. Wraps the
 * original Zod error and renders a multi-line summary suitable for the
 * Node startup log.
 */
export class EnvValidationError extends Error {
  readonly zodError: z.ZodError;

  constructor(zodError: z.ZodError) {
    super(formatZodError(zodError));
    this.name = "EnvValidationError";
    this.zodError = zodError;
  }
}

function formatZodError(zodError: z.ZodError): string {
  const lines: string[] = ["env validation failed:"];
  for (const issue of zodError.issues) {
    const path = issue.path.join(".") || "(root)";
    lines.push(`  • ${path}: ${issue.message}`);
  }
  return lines.join("\n");
}

// ── Plinth standard schema fragments ────────────────────────────────

/**
 * Base schema every Plinth module composes with. Always-present fields:
 * NODE_ENV, LOG_LEVEL, PORT.
 */
export const baseSchema = z.object({
  NODE_ENV: z
    .enum(["production", "staging", "development", "test"])
    .default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
});

/**
 * Schema for modules that talk to Cerbos. Compose into the module's schema:
 *
 *   const env = createEnv({
 *     schema: baseSchema.merge(cerbosSchema).extend({ ... module-specific }),
 *   });
 */
export const cerbosSchema = z.object({
  CERBOS_ADDRESS: z.string().min(1),
  CERBOS_TLS: z
    .union([
      z.literal("true"),
      z.literal("false"),
      z.literal("1"),
      z.literal("0"),
    ])
    .optional()
    .transform((v) =>
      v === undefined ? undefined : v === "true" || v === "1",
    ),
  CERBOS_ALLOW_BYPASS: z
    .union([
      z.literal("true"),
      z.literal("false"),
      z.literal("1"),
      z.literal("0"),
    ])
    .optional()
    .transform((v) =>
      v === undefined ? undefined : v === "true" || v === "1",
    ),
});

/** Schema for modules that emit OTel traces. */
export const otelSchema = z.object({
  OTEL_EXPORTER_ENDPOINT: z.url().optional(),
  OTEL_TRACES_SAMPLER_ARG: z.coerce.number().min(0).max(1).optional(),
  OTEL_RESOURCE_ATTRIBUTES: z.string().optional(),
});

/** Schema for modules with first-party auth (gateway forwards JWT). */
export const authSchema = z.object({
  AUTH_ISSUER: z.url(),
  AUTH_AUDIENCE: z.string().min(1),
  AUTH_SECRET: z.string().min(32),
});

/**
 * Wrap a Zod schema so the field is required only when NODE_ENV is "production".
 * Useful for fields that are dev-optional but prod-required (Slack webhooks,
 * external API keys, etc.).
 *
 * Pass the **non-optional** schema; the function makes it optional in dev
 * and leaves it required in production:
 *
 *   z.object({
 *     SLACK_WEBHOOK_URL: requiredInProduction(z.url()),
 *   })
 *
 * NODE_ENV is read at schema-construction time, not parse time. Build the
 * schema after process.env.NODE_ENV is set (the normal case in production;
 * tests set it before constructing the schema).
 */
export function requiredInProduction<T extends z.ZodTypeAny>(
  schema: T,
): T | z.ZodOptional<T> {
  if (process.env.NODE_ENV === "production") {
    return schema;
  }
  return schema.optional();
}
