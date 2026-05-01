/**
 * Plinth api-client: server-only typed fetch wrapper.
 *
 * Centralises base URL, auth header, retries, and timeouts behind a named
 * registry. Returns a typed [`ApiResponse`] that the caller branches on
 * via `.success` — never throws on HTTP errors.
 *
 * Auto-parses RFC 7807 problem+json (the shape `sdk-go/errors` produces)
 * into the `error` field. Trace context propagates via the W3C `traceparent`
 * header when [`setTraceHeaderFunc`] has been wired up.
 *
 * See https://plinth.run/sdk/ts/api-client/ for the design rationale.
 */

// ── Public types ────────────────────────────────────────────────────

/** A successful or failed API response, never an exception. */
export interface ApiResponse<T> {
  /** Parsed body for 2xx responses; `null` for non-2xx, network errors, timeouts. */
  data: T | null;
  /** True iff the response was 2xx and decoded successfully. */
  success: boolean;
  /** Populated for non-2xx, network errors, and timeouts. */
  error: ApiError | null;
  /** Always populated. Includes the HTTP status (0 for network errors). */
  meta: ApiResponseMeta;
}

/** Detail about a non-success response. */
export interface ApiError {
  /** HTTP status (0 for network errors and timeouts). */
  status: number;
  /**
   * Plinth-typed error code (`"not_found"`, `"validation"`, etc.) when the
   * response carried `application/problem+json`. `"network"` for fetch
   * failures, `"timeout"` for AbortError on the timeout signal,
   * `"unknown"` otherwise.
   */
  code: string;
  /** Human-readable diagnostic; never user-facing. */
  message: string;
  /** Validation field errors when `code === "validation"`. */
  fields?: Record<string, string>;
}

export interface ApiResponseMeta {
  status: number;
  /** W3C traceparent ID echoed back from the server, when present. */
  traceId?: string;
  /** Caller-set request ID (X-Request-ID), echoed back when present. */
  requestId?: string;
}

/** Configuration registered for a named API. */
export interface ApiConfig {
  /** Base URL (e.g. `"https://items-api.example.com"`); paths join with `/`. */
  baseUrl: string;
  /** Headers sent on every request. */
  defaultHeaders?: Record<string, string>;
  /**
   * Returns the value for the `Authorization` header (e.g. `"Bearer …"`),
   * or `null` to omit. Called per request.
   */
  authHeader?: () => Promise<string | null> | string | null;
  /** Per-request timeout in ms; default 30000. */
  timeoutMs?: number;
  /** Retry policy. Default: 2 retries on `[502, 503, 504, 429]` with 100 ms initial backoff. */
  retry?: RetryPolicy;
}

export interface RetryPolicy {
  count: number;
  backoffMs: number;
  /** Statuses that trigger a retry. Default `[502, 503, 504, 429]`. */
  onStatuses?: number[];
}

/** The fetch surface used by callers. */
export interface ApiClient {
  get<T>(path: string, init?: RequestInit): Promise<ApiResponse<T>>;
  post<T>(
    path: string,
    body?: unknown,
    init?: RequestInit,
  ): Promise<ApiResponse<T>>;
  put<T>(
    path: string,
    body?: unknown,
    init?: RequestInit,
  ): Promise<ApiResponse<T>>;
  patch<T>(
    path: string,
    body?: unknown,
    init?: RequestInit,
  ): Promise<ApiResponse<T>>;
  delete<T>(path: string, init?: RequestInit): Promise<ApiResponse<T>>;
}

// ── Module state ────────────────────────────────────────────────────

const registry = new Map<string, ApiConfig>();

let traceHeaderFunc: () => Record<string, string> | undefined = () => undefined;

let fetchImpl: typeof fetch = (...args) => fetch(...args);

/**
 * Override the global fetch (for tests). Pass `undefined` to restore
 * the platform default.
 */
export function setFetchImpl(impl: typeof fetch | undefined): void {
  fetchImpl = impl ?? ((...args) => fetch(...args));
}

/**
 * Register a function that returns trace-propagation headers (typically
 * just `{ traceparent: "..." }`). Called per request; returning undefined
 * or an empty object skips header injection.
 *
 * Wire from your OTel setup:
 *
 *   import { context, propagation } from "@opentelemetry/api";
 *   setTraceHeaderFunc(() => {
 *     const carrier: Record<string, string> = {};
 *     propagation.inject(context.active(), carrier);
 *     return carrier;
 *   });
 */
export function setTraceHeaderFunc(
  fn: () => Record<string, string> | undefined,
): void {
  traceHeaderFunc = fn;
}

/**
 * Register a named API. Subsequent `api(name)` calls produce clients that
 * use this configuration.
 *
 * Re-registering replaces the previous config — useful for tests; intentional
 * in production usage too (modules can override at startup based on flags).
 */
export function register(name: string, config: ApiConfig): void {
  registry.set(name, config);
}

/** Clear all registered APIs. Used by tests; never call from app code. */
export function clearRegistry(): void {
  registry.clear();
}

/**
 * Return a typed client for a previously-registered API. Throws synchronously
 * if the name isn't registered — that's a programmer error, surface it loudly.
 */
export function api(name: string): ApiClient {
  const config = registry.get(name);
  if (!config) {
    throw new Error(
      `@plinth-dev/api-client: api(${JSON.stringify(name)}) not registered; call register() at app init`,
    );
  }
  return makeClient(name, config);
}

// ── Internals ───────────────────────────────────────────────────────

const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_RETRY: RetryPolicy = {
  count: 2,
  backoffMs: 100,
  onStatuses: [502, 503, 504, 429],
};

function makeClient(name: string, config: ApiConfig): ApiClient {
  const exec = async <T>(
    method: string,
    path: string,
    body: unknown,
    init: RequestInit | undefined,
  ): Promise<ApiResponse<T>> =>
    execute<T>(name, config, method, path, body, init);

  return {
    get: <T>(path: string, init?: RequestInit) =>
      exec<T>("GET", path, undefined, init),
    post: <T>(path: string, body?: unknown, init?: RequestInit) =>
      exec<T>("POST", path, body, init),
    put: <T>(path: string, body?: unknown, init?: RequestInit) =>
      exec<T>("PUT", path, body, init),
    patch: <T>(path: string, body?: unknown, init?: RequestInit) =>
      exec<T>("PATCH", path, body, init),
    delete: <T>(path: string, init?: RequestInit) =>
      exec<T>("DELETE", path, undefined, init),
  };
}

async function execute<T>(
  _name: string,
  config: ApiConfig,
  method: string,
  path: string,
  body: unknown,
  init: RequestInit | undefined,
): Promise<ApiResponse<T>> {
  const url = joinUrl(config.baseUrl, path);
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT;
  const retry = config.retry ?? DEFAULT_RETRY;
  const retryStatuses = retry.onStatuses ?? DEFAULT_RETRY.onStatuses!;

  // Build static headers once per call.
  const baseHeaders = await buildHeaders(method, body, config, init);

  let attempt = 0;
  let lastResponse: ApiResponse<T> | null = null;

  while (attempt <= retry.count) {
    const result = await sendOne<T>(
      url,
      method,
      body,
      baseHeaders,
      init,
      timeoutMs,
    );

    // Success or non-retryable failure → return.
    if (result.success || !shouldRetry(result, retryStatuses)) {
      return result;
    }

    lastResponse = result;
    attempt += 1;
    if (attempt > retry.count) break;

    const delay = retry.backoffMs * 2 ** (attempt - 1);
    await sleep(delay);
  }

  return lastResponse!;
}

async function sendOne<T>(
  url: string,
  method: string,
  body: unknown,
  baseHeaders: Headers,
  init: RequestInit | undefined,
  timeoutMs: number,
): Promise<ApiResponse<T>> {
  const headers = new Headers(baseHeaders);
  if (init?.headers) {
    new Headers(init.headers).forEach((v, k) => {
      headers.set(k, v);
    });
  }
  const traceHeaders = traceHeaderFunc();
  if (traceHeaders) {
    for (const [k, v] of Object.entries(traceHeaders)) {
      headers.set(k, v);
    }
  }

  const requestBody =
    body === undefined || body === null
      ? undefined
      : typeof body === "string"
        ? body
        : JSON.stringify(body);
  if (requestBody !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const externalSignal = init?.signal ?? null;
  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(new TimeoutError()),
    timeoutMs,
  );
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener(
        "abort",
        () => controller.abort(externalSignal.reason),
        {
          once: true,
        },
      );
    }
  }

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method,
      headers,
      body: requestBody,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    return networkError<T>(err);
  } finally {
    clearTimeout(timeoutId);
  }

  return parseResponse<T>(response);
}

async function buildHeaders(
  _method: string,
  _body: unknown,
  config: ApiConfig,
  _init: RequestInit | undefined,
): Promise<Headers> {
  const h = new Headers();
  h.set("accept", "application/json");
  if (config.defaultHeaders) {
    for (const [k, v] of Object.entries(config.defaultHeaders)) {
      h.set(k, v);
    }
  }
  if (config.authHeader) {
    const token = await config.authHeader();
    if (token) h.set("authorization", token);
  }
  return h;
}

function shouldRetry(
  res: ApiResponse<unknown>,
  retryStatuses: number[],
): boolean {
  // Network errors, timeouts: retry.
  if (res.error?.code === "network" || res.error?.code === "timeout") {
    return true;
  }
  // Status-based retry list.
  if (res.error && retryStatuses.includes(res.meta.status)) {
    return true;
  }
  return false;
}

async function parseResponse<T>(res: Response): Promise<ApiResponse<T>> {
  const contentType = res.headers.get("content-type") ?? "";
  const traceId = res.headers.get("traceparent") ?? undefined;
  const requestId = res.headers.get("x-request-id") ?? undefined;
  const meta: ApiResponseMeta = { status: res.status, traceId, requestId };

  if (res.ok) {
    let data: T | null = null;
    if (contentType.includes("application/json")) {
      try {
        data = (await res.json()) as T;
      } catch (err) {
        return {
          data: null,
          success: false,
          error: {
            status: res.status,
            code: "decode",
            message: errMessage(err) || "failed to decode response JSON",
          },
          meta,
        };
      }
    } else if (res.status !== 204) {
      // Non-JSON body that isn't No Content — surface it as text in `data`.
      try {
        data = (await res.text()) as unknown as T;
      } catch {
        data = null;
      }
    }
    return { data, success: true, error: null, meta };
  }

  // Non-2xx: attempt RFC 7807 problem+json parsing, fall back to text.
  if (
    contentType.includes("application/problem+json") ||
    contentType.includes("application/json")
  ) {
    try {
      const parsed = (await res.json()) as ProblemBody;
      return {
        data: null,
        success: false,
        error: {
          status: res.status,
          code: parsed.code ?? "unknown",
          message: parsed.detail ?? parsed.title ?? `HTTP ${res.status}`,
          fields: parsed.fields,
        },
        meta,
      };
    } catch {
      // fall through to text body
    }
  }

  let text = "";
  try {
    text = await res.text();
  } catch {
    // ignore
  }
  return {
    data: null,
    success: false,
    error: {
      status: res.status,
      code: "unknown",
      message: text.trim() || `HTTP ${res.status}`,
    },
    meta,
  };
}

interface ProblemBody {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  code?: string;
  trace_id?: string;
  fields?: Record<string, string>;
}

class TimeoutError extends Error {
  constructor() {
    super("request timed out");
    this.name = "TimeoutError";
  }
}

function networkError<T>(err: unknown): ApiResponse<T> {
  if (
    err instanceof TimeoutError ||
    (err as { name?: string })?.name === "TimeoutError"
  ) {
    return {
      data: null,
      success: false,
      error: { status: 0, code: "timeout", message: errMessage(err) },
      meta: { status: 0 },
    };
  }
  // AbortError raised by external signal (caller cancelled)
  if ((err as { name?: string })?.name === "AbortError") {
    return {
      data: null,
      success: false,
      error: { status: 0, code: "aborted", message: errMessage(err) },
      meta: { status: 0 },
    };
  }
  return {
    data: null,
    success: false,
    error: { status: 0, code: "network", message: errMessage(err) },
    meta: { status: 0 },
  };
}

function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function joinUrl(base: string, path: string): string {
  const b = base.endsWith("/") ? base.slice(0, -1) : base;
  const p = path.startsWith("/") ? path : `/${path}`;
  return b + p;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
