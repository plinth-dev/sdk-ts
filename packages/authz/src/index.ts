/**
 * Plinth authz: server-only Cerbos PDP client.
 *
 * TypeScript counterpart of `sdk-go/authz`. Same fail-closed contract,
 * same Decision shape, same batched-check semantics. The package is
 * server-only — see the `import "server-only"` marker below — and the
 * Cerbos gRPC SDK is a runtime dependency.
 *
 * See https://plinth.run/sdk/ts/authz/ for the design rationale.
 */

import "server-only";

import { GRPC } from "@cerbos/grpc";

// ── Public types ────────────────────────────────────────────────────

/**
 * Reason explains a {@link Decision}. Always populated, even when allowed.
 *
 * The string literals are the wire format ops uses to distinguish
 * "PDP said no" from "PDP is dead" without parsing error strings.
 */
export type Reason = "Allowed" | "Denied" | "Unreachable" | "Bypassed";

/**
 * Decision is the explicit outcome of a permission check. Callers should
 * log the full Decision (not just `allowed`) so ops can distinguish
 * "denied by policy" from "denied because PDP is sick".
 */
export interface Decision {
  allowed: boolean;
  reason: Reason;
  /** Populated for diagnostics; e.g. `"items:read"`. */
  action?: string;
}

/** Identifies the actor making the request. */
export interface Principal {
  id: string;
  roles: string[];
  attributes?: Record<string, unknown>;
  auxData?: AuxData;
}

/** Aux data passed alongside the principal/resource. */
export interface AuxData {
  /** Raw JWT bearer token; Cerbos's `$jwtClaims` accessor reads it. */
  jwt: string;
  /** Optional ID of the JWKS configured on the PDP. */
  keySetId?: string;
}

/** Identifies the thing being acted upon. */
export interface Resource {
  /** Cerbos resource kind (`"Item"`, `"Approval"`, ...). */
  kind: string;
  id: string;
  attributes?: Record<string, unknown>;
}

/** Configuration for the {@link AuthzClient} constructor. */
export interface ClientOptions {
  /** Cerbos PDP gRPC endpoint (e.g. `"cerbos:3593"`). Required. */
  address: string;
  /** Encrypt with TLS. Default `false` — suitable for in-cluster service-mesh. */
  tls?: boolean;
  /**
   * Pluggable structured logger. Defaults to `console` with structured shape.
   */
  logger?: Logger;
  /**
   * Used by the bypass-mode safety check. Set to `"production"` to reject
   * `CERBOS_ALLOW_BYPASS=1` at construction time. Defaults to
   * `process.env.NODE_ENV`.
   */
  envName?: string;
}

/** Minimum logger interface — every console.* compatible logger satisfies it. */
export interface Logger {
  warn: (msg: string, attrs?: Record<string, unknown>) => void;
  error: (msg: string, attrs?: Record<string, unknown>) => void;
}

// ── Sentinel errors ─────────────────────────────────────────────────

/**
 * Thrown by the {@link AuthzClient} constructor if `CERBOS_ALLOW_BYPASS=1`
 * is set when `envName === "production"`. This is a startup-time safety
 * check; there is no way to enable bypass at runtime in production.
 */
export class BypassInProductionError extends Error {
  constructor() {
    super(
      "authz: CERBOS_ALLOW_BYPASS=1 is rejected when envName is 'production'",
    );
    this.name = "BypassInProductionError";
  }
}

// ── Internal: testable backend interface ────────────────────────────

/**
 * The subset of the Cerbos GRPC client we use. Lets tests stub the
 * backend without spinning up a real PDP. The real `@cerbos/grpc` GRPC
 * class satisfies this naturally.
 */
export interface CerbosBackend {
  isAllowed(request: CerbosIsAllowedRequest): Promise<boolean>;
  checkResource(
    request: CerbosCheckResourceRequest,
  ): Promise<CerbosCheckResult>;
  serverInfo(): Promise<unknown>;
}

interface CerbosIsAllowedRequest {
  principal: CerbosPrincipal;
  resource: CerbosResource;
  action: string;
  auxData?: CerbosAuxData;
}

interface CerbosCheckResourceRequest {
  principal: CerbosPrincipal;
  resource: CerbosResource;
  actions: string[];
  auxData?: CerbosAuxData;
}

interface CerbosCheckResult {
  isAllowed(action: string): boolean | undefined;
}

interface CerbosPrincipal {
  id: string;
  roles: string[];
  attr?: Record<string, unknown>;
}

interface CerbosResource {
  kind: string;
  id: string;
  attr?: Record<string, unknown>;
}

interface CerbosAuxData {
  jwt?: { token: string; keySetId?: string };
}

// ── Client ──────────────────────────────────────────────────────────

/**
 * Server-only Cerbos PDP client. Safe for concurrent use.
 *
 * Construct once at app init (typically in `lib/authz.server.ts` or
 * similar) and reuse via the {@link getClient} singleton.
 */
export class AuthzClient {
  private readonly backend: CerbosBackend;
  private readonly bypassMode: boolean;
  private readonly logger: Logger;

  /**
   * Construct a Client. Throws {@link BypassInProductionError} if
   * `CERBOS_ALLOW_BYPASS=1` and `envName === "production"`.
   *
   * The `backend` parameter is for tests; production code passes only
   * `opts` and a real `@cerbos/grpc` client is built from `opts.address`.
   */
  constructor(opts: ClientOptions, backend?: CerbosBackend) {
    if (!opts.address) {
      throw new Error("authz: ClientOptions.address is required");
    }
    const envName = opts.envName ?? process.env.NODE_ENV;
    const bypass = process.env.CERBOS_ALLOW_BYPASS === "1";
    if (bypass && envName === "production") {
      throw new BypassInProductionError();
    }
    this.bypassMode = bypass;
    this.logger = opts.logger ?? defaultLogger;

    if (bypass) {
      this.logger.warn(
        "authz: CERBOS_ALLOW_BYPASS=1 — every checkAction returns Allowed",
        { envName },
      );
    }

    this.backend =
      backend ??
      (new GRPC(opts.address, {
        tls: opts.tls ?? false,
      }) as unknown as CerbosBackend);
  }

  /**
   * Evaluates a single action. Fail-closed: any error
   * (network / PDP error / timeout / abort) resolves with
   * `{ allowed: false, reason: "Unreachable" }`. Never rejects.
   */
  async checkAction(
    p: Principal,
    r: Resource,
    action: string,
  ): Promise<Decision> {
    if (this.bypassMode) {
      this.logger.warn("authz: BYPASS — would have called Cerbos", {
        action,
        resourceKind: r.kind,
        resourceId: r.id,
        principal: p.id,
      });
      return { allowed: true, reason: "Bypassed", action };
    }

    try {
      const allowed = await this.backend.isAllowed({
        principal: toCerbosPrincipal(p),
        resource: toCerbosResource(r),
        action,
        auxData: toCerbosAuxData(p.auxData),
      });
      return allowed
        ? { allowed: true, reason: "Allowed", action }
        : { allowed: false, reason: "Denied", action };
    } catch (err) {
      this.logger.warn("authz: PDP unreachable", {
        action,
        resourceKind: r.kind,
        error: errMessage(err),
      });
      return { allowed: false, reason: "Unreachable", action };
    }
  }

  /**
   * Evaluates many actions against the SAME resource in one round-trip.
   * On transport failure, every action gets `Unreachable`.
   */
  async checkActions(
    p: Principal,
    r: Resource,
    actions: string[],
  ): Promise<Record<string, Decision>> {
    const out: Record<string, Decision> = {};

    if (this.bypassMode) {
      this.logger.warn(
        "authz: BYPASS — batched check would have called Cerbos",
        {
          actions: actions.length,
          resourceKind: r.kind,
          resourceId: r.id,
        },
      );
      for (const action of actions) {
        out[action] = { allowed: true, reason: "Bypassed", action };
      }
      return out;
    }

    let result: CerbosCheckResult;
    try {
      result = await this.backend.checkResource({
        principal: toCerbosPrincipal(p),
        resource: toCerbosResource(r),
        actions,
        auxData: toCerbosAuxData(p.auxData),
      });
    } catch (err) {
      this.logger.warn("authz: PDP unreachable on batched check", {
        actions: actions.length,
        resourceKind: r.kind,
        error: errMessage(err),
      });
      for (const action of actions) {
        out[action] = { allowed: false, reason: "Unreachable", action };
      }
      return out;
    }

    for (const action of actions) {
      const allowed = result.isAllowed(action);
      if (allowed === undefined) {
        // Cerbos didn't return a result for this action — treat as
        // unreachable; shouldn't happen in normal operation.
        out[action] = { allowed: false, reason: "Unreachable", action };
      } else if (allowed) {
        out[action] = { allowed: true, reason: "Allowed", action };
      } else {
        out[action] = { allowed: false, reason: "Denied", action };
      }
    }
    return out;
  }

  /**
   * Returns a flattened `{ action: allowed }` map. Convenience wrapper
   * for the batched-check-at-layout pattern: server fetches once,
   * passes to `<PermissionsProvider>` from `@plinth-dev/authz-react`.
   */
  async permissionMap(
    p: Principal,
    r: Resource,
    actions: string[],
  ): Promise<Record<string, boolean>> {
    const decisions = await this.checkActions(p, r, actions);
    const out: Record<string, boolean> = {};
    for (const [action, d] of Object.entries(decisions)) {
      out[action] = d.allowed;
    }
    return out;
  }

  /**
   * Health probe — calls Cerbos `serverInfo`. Throws on PDP error.
   * Suitable for use as a readiness-probe Pinger.
   */
  async ping(): Promise<void> {
    if (this.bypassMode) return; // bypass mode never talks to Cerbos
    await this.backend.serverInfo();
  }

  /**
   * Releases the underlying gRPC connection. Currently a no-op; the
   * Cerbos client doesn't expose a close method in the current SDK.
   * Reserved for future use.
   */
  async close(): Promise<void> {
    // No-op.
  }
}

// ── Singleton ───────────────────────────────────────────────────────

let cached: AuthzClient | undefined;

/**
 * Return the singleton AuthzClient. Reads CERBOS_ADDRESS, CERBOS_TLS, and
 * NODE_ENV from process.env on first call. Subsequent calls return the
 * cached instance.
 *
 * Throws synchronously on first call if CERBOS_ADDRESS is missing or
 * CERBOS_ALLOW_BYPASS=1 in production. Tests can call {@link resetClient}
 * between tests to discard the singleton.
 */
export function getClient(): AuthzClient {
  if (!cached) {
    const address = process.env.CERBOS_ADDRESS;
    if (!address) {
      throw new Error("authz: CERBOS_ADDRESS env var is required");
    }
    cached = new AuthzClient({
      address,
      tls: process.env.CERBOS_TLS === "true" || process.env.CERBOS_TLS === "1",
    });
  }
  return cached;
}

/** Discard the cached singleton. Test-only. */
export function resetClient(): void {
  cached = undefined;
}

// ── Type conversion ────────────────────────────────────────────────

function toCerbosPrincipal(p: Principal): CerbosPrincipal {
  const out: CerbosPrincipal = { id: p.id, roles: p.roles };
  if (p.attributes) out.attr = p.attributes;
  return out;
}

function toCerbosResource(r: Resource): CerbosResource {
  const out: CerbosResource = { kind: r.kind, id: r.id };
  if (r.attributes) out.attr = r.attributes;
  return out;
}

function toCerbosAuxData(aux: AuxData | undefined): CerbosAuxData | undefined {
  if (!aux?.jwt) return undefined;
  const jwt: { token: string; keySetId?: string } = { token: aux.jwt };
  if (aux.keySetId) jwt.keySetId = aux.keySetId;
  return { jwt };
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

const defaultLogger: Logger = {
  warn: (msg, attrs) => {
    // eslint-disable-next-line no-console
    console.warn(msg, attrs ?? {});
  },
  error: (msg, attrs) => {
    // eslint-disable-next-line no-console
    console.error(msg, attrs ?? {});
  },
};
