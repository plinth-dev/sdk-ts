# Plinth — TypeScript SDK

A pnpm-workspaces monorepo. Each workspace ships as an independently-versioned npm package under `@plinth-dev`. Split for tree-shaking and selective adoption.

Design rationale per package: <https://plinth.run/sdk/ts/>.

## Packages

| Package | Status | Responsibility |
| --- | --- | --- |
| [`@plinth-dev/env`](./packages/env) | **shipped** · pre-release | Zod-validated env vars; fail-fast at module load. |
| [`@plinth-dev/api-client`](./packages/api-client) | **shipped** · pre-release | Server-only typed fetch wrapper; never throws; RFC 7807 problem+json auto-parse. |
| [`@plinth-dev/authz`](./packages/authz) | **shipped** · pre-release | Server-only Cerbos gRPC wrapper; fail-closed Decision; bypass rejected at startup in production. |
| [`@plinth-dev/authz-react`](./packages/authz-react) | **shipped** · pre-release | `<PermissionsProvider>` / `usePermissions()` / `<Can>` / `<CanAny>` / `<CanAll>` — batched-check-at-layout. |
| `@plinth-dev/forms` | not yet shipped | Server-action forms with Zod validation; `<FormWrapper>` + `<FormField>`. |
| `@plinth-dev/tables` | not yet shipped | Headless data tables with URL state via `nuqs`. |
| `@plinth-dev/otel-web` | not yet shipped | Browser OpenTelemetry SDK init with auto-instrumentations. |

Each shipped package has its own `package.json`, semver pre-release version, README, and minimal dependency surface.

## Install

```bash
pnpm add @plinth-dev/env @plinth-dev/api-client zod
```

Each package has its own README with copy-paste install + minimal example.

## Local development

```bash
pnpm install              # install all workspace deps
pnpm -r build             # build all packages
pnpm -r test              # run all tests
pnpm typecheck            # tsc --noEmit across all packages
pnpm lint                 # biome check .
```

CI runs `pnpm install --frozen-lockfile`, then per-package `build` + `test` + `typecheck` on every push.

## Layout

```
.
├── package.json                    # workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json              # shared compiler options
├── biome.json                      # shared lint/format
└── packages/
    ├── env/                        # @plinth-dev/env
    │   ├── package.json
    │   ├── tsconfig.json   tsup.config.ts   vitest.config.ts
    │   ├── src/index.ts   src/index.test.ts
    │   ├── README.md   LICENSE
    │   └── dist/                   # built; gitignored
    ├── api-client/                 # @plinth-dev/api-client
    └── ...                         # five more packages still to ship
```

## Versioning

Each package is independently versioned. Breaking changes within `0.x` are batched into minor versions; `v1.0` freezes APIs for a year.

## Related

- [`sdk-go`](https://github.com/plinth-dev/sdk-go) — the Go SDK.
- [`starter-web`](https://github.com/plinth-dev/starter-web) — Next.js module starter that imports these packages.
- [`plinth.run`](https://plinth.run) — per-package design docs and tutorials.

## License

MIT — see [LICENSE](./LICENSE).
