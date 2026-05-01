# `@plinth-dev/env`

Zod-validated environment variables — fail-fast at module load. A bad env should crash startup, not surface as a 500 thirty minutes after deploy.

Design rationale: <https://plinth.run/sdk/ts/env/>.

## Install

```bash
pnpm add @plinth-dev/env zod
```

## Minimum example

```ts
// lib/env.server.ts
import "server-only";
import { z } from "zod";
import {
  authSchema,
  baseSchema,
  cerbosSchema,
  createEnv,
  otelSchema,
  requiredInProduction,
} from "@plinth-dev/env";

export const env = createEnv({
  schema: baseSchema
    .merge(cerbosSchema)
    .merge(authSchema)
    .merge(otelSchema)
    .extend({
      DATABASE_URL: z.url(),
      ITEMS_API_URL: z.url(),
      // Optional in dev, required in production:
      SLACK_WEBHOOK_URL: requiredInProduction(z.url()),
    }),
  refine: (env) => {
    if (env.CERBOS_ALLOW_BYPASS && env.NODE_ENV === "production") {
      throw new Error("CERBOS_ALLOW_BYPASS is rejected in production");
    }
  },
});
```

A bad env throws `EnvValidationError` at the first `import` of this module, with a multi-line message naming every failing field. Node logs it and exits.

## API

| Symbol | Purpose |
|---|---|
| `createEnv({ schema, refine?, source?, onError? })` | Validate + return the typed env. Throws on failure unless `onError` overrides. |
| `EnvValidationError` | Error thrown on schema failure; wraps the original `z.ZodError`. |
| `baseSchema` | NODE_ENV / LOG_LEVEL / PORT — every Plinth module needs these. |
| `cerbosSchema` | CERBOS_ADDRESS / CERBOS_TLS / CERBOS_ALLOW_BYPASS. |
| `otelSchema` | OTEL_EXPORTER_ENDPOINT / OTEL_TRACES_SAMPLER_ARG / OTEL_RESOURCE_ATTRIBUTES. |
| `authSchema` | AUTH_ISSUER / AUTH_AUDIENCE / AUTH_SECRET (≥ 32 chars). |
| `requiredInProduction(schema)` | Make a non-optional schema optional in dev; leave required in production. |

## Behaviour notes

- **Validate at module load, not first read.** Once the module's first import runs, the env is parsed; any failure throws synchronously.
- **`source` defaults to `process.env`.** Override for tests.
- **`requiredInProduction` reads `NODE_ENV` at schema-construction time.** Build the schema after `process.env.NODE_ENV` is set — which is the normal case in production. Tests must set `process.env.NODE_ENV` before constructing the schema.
- **Boolean env vars (`CERBOS_TLS`, `CERBOS_ALLOW_BYPASS`) accept `"true" | "false" | "1" | "0"`.** Unset stays `undefined` (so optional flags behave); set values transform to `boolean`.
- **`Zod v4`.** This package depends on Zod 4 as a peer dep — pin it in your app.

## Compatibility

- **Node 20+**. Uses ESM exports + `process.env`.
- **TypeScript 5.9+** for `verbatimModuleSyntax` and modern Zod inference.
- ESM-only (`type: "module"`); CJS consumers can interop via dynamic import.
- Tree-shakeable; the standard fragments (`baseSchema` etc.) only get bundled if you import them.

## License

MIT — see [LICENSE](./LICENSE).
