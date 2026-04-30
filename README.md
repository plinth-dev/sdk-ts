# Plinth — TypeScript SDK

A pnpm-workspaces monorepo. Each workspace ships as an independently-versioned npm package under `@plinth-dev`. Split for tree-shaking and selective adoption.

> **Status: v0.1.0 — Phase B in progress.** API surfaces are being designed; expect breaking changes until each package is tagged at `v0.1.0`.

## Packages

| Package | Responsibility |
| --- | --- |
| [`@plinth-dev/authz-react`](./packages/authz-react) | `<PermissionsProvider>`, `usePermissions()`, `<Can>` — the batched-check-at-layout pattern |
| [`@plinth-dev/api-client`](./packages/api-client) | Server-only typed fetch wrapper; never throws on HTTP errors; retries on 5xx/429 |
| [`@plinth-dev/authz`](./packages/authz) | Server-only Cerbos gRPC wrapper; mirrors the Go SDK semantics |
| [`@plinth-dev/otel-web`](./packages/otel-web) | Browser OpenTelemetry SDK init with auto-instrumentations |
| [`@plinth-dev/forms`](./packages/forms) | Server-action forms with Zod validation |
| [`@plinth-dev/tables`](./packages/tables) | Headless data tables with URL state via `nuqs` |
| [`@plinth-dev/env`](./packages/env) | Zod-schema-validated env vars; fail-fast at module load |

## Install

```bash
pnpm add @plinth-dev/authz-react
```

Each package has its own README with copy-paste install + minimal example.

## Local development

```bash
pnpm install              # install all workspace deps
pnpm -r build             # build all packages
pnpm -r test              # run all tests
pnpm changeset            # propose a release
```

## Design intent

The API surface for each package is documented in detail at [plinth.run/sdk](https://plinth.run/sdk/). This repo holds the implementations.

## Layout

```
.
├── packages/
│   ├── api-client/
│   ├── authz/
│   ├── authz-react/
│   ├── env/
│   ├── forms/
│   ├── otel-web/
│   └── tables/
├── pnpm-workspace.yaml
├── package.json
└── tsconfig.base.json
```

## Versioning

Each package is independently versioned. Breaking changes within `0.x` are batched into minor versions; v1.0 freezes APIs for a year.

## Related

- [`sdk-go`](https://github.com/plinth-dev/sdk-go) — the Go SDK.
- [`starter-web`](https://github.com/plinth-dev/starter-web) — Next.js module starter that imports these packages.
- [`plinth.run`](https://plinth.run) — design ADRs and tutorials.

## License

MIT — see [LICENSE](./LICENSE).
