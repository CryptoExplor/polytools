import {
  canonicalizePairs,
  CanonicalRequestError,
  type QueryPair,
} from "./canonical";
import {
  READ_ONLY_OPERATIONS,
  type ReadOnlyOperation,
} from "./signer";
import { AccountVaultError, type AccountVault } from "./vault";

export const POLYESTER_TESTNET_REST_ORIGIN = "https://api.testnet.polyester.com";
export const ACCOUNT_CONTRACT_VERSION = "friendly-rest@b34853cb14366c9a64d53a20f6b09496a3c09fc4";

const DEFAULT_ACCOUNT_REQUEST_TIMEOUT_MS = 30_000;
const MAX_ACCOUNT_REQUEST_TIMEOUT_MS = 120_000;
const ACCOUNT_REQUEST_TIMEOUT_REASON = Symbol("account-request-timeout");

export type AccountErrorCode =
  | "ABORTED"
  | "TIMEOUT"
  | "ACCOUNT_STALE"
  | "CORS_BLOCKED"
  | "NETWORK"
  | "RATE_LIMITED"
  | "SERVER"
  | "UNAUTHENTICATED"
  | "PERMISSION_DENIED"
  | "TIMESTAMP_SKEW"
  | "SIGNATURE_INVALID"
  | "KEY_DISABLED"
  | "KEY_EXPIRED"
  | "IP_NOT_ALLOWED"
  | "SCHEMA_INCOMPATIBLE"
  | "HTTP_ERROR"
  | "CONTRACT_CONFLICT"
  | "INVALID_REQUEST";

export interface SafeAccountError {
  code: AccountErrorCode;
  operation: string;
  localCorrelationId: string;
  httpStatus?: number;
  retryAfterMs?: number;
}

export class AccountRestError extends Error {
  constructor(
    readonly code: AccountErrorCode,
    readonly operation: string,
    message: string,
    readonly details: Omit<SafeAccountError, "code" | "operation" | "localCorrelationId"> & {
      localCorrelationId?: string;
    } = {},
  ) {
    super(message);
    this.name = "AccountRestError";
  }

  toSafeError(): SafeAccountError {
    return {
      code: this.code,
      operation: this.operation,
      localCorrelationId: this.details.localCorrelationId ?? "local-unavailable",
      ...(this.details.httpStatus !== undefined ? { httpStatus: this.details.httpStatus } : {}),
      ...(this.details.retryAfterMs !== undefined ? { retryAfterMs: this.details.retryAfterMs } : {}),
    };
  }
}

export interface AccountRequestParams {
  subaccountId?: string;
  range?: "1d" | "7d" | "30d" | "90d" | "180d" | "365d";
  ledger?: string | number;
  accountCode?: string;
  groupBy?: "ACCOUNT" | "ASSET";
  symbol?: string | readonly string[];
  side?: "BUY" | "SELL";
  triggerId?: string;
  status?: "PENDING" | "PENDING_CANCEL" | "WORKING" | "FILLED" | "CANCELED" | "REJECTED";
  startTime?: string;
  endTime?: string;
  afterMatchId?: string;
  orderId?: string;
  lineageId?: string;
  throughGeneration?: number;
  includeTransfers?: boolean;
  includeExecutionHistory?: boolean;
  includeAttachedRisk?: boolean;
  includeAttachedRiskState?: boolean;
  limit?: number;
  pageToken?: string;
  reversed?: boolean;
}

export interface BuiltReadRequest {
  operation: ReadOnlyOperation;
  method: "GET";
  path: string;
  canonicalQuery: string;
  url: string;
}

export interface AccountResponse<T> {
  data: T;
  operation: ReadOnlyOperation;
  contractVersion: typeof ACCOUNT_CONTRACT_VERSION;
  retrievedAtMs: number;
}

export interface AccountRestClientOptions {
  vault: AccountVault;
  fetchImpl?: typeof fetch;
  /** Only the explicit dotted official testnet origin is accepted. */
  baseUrl?: string;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  /** Per-attempt deadline covering signing, fetch, and response-body reading. */
  requestTimeoutMs?: number;
  sleepImpl?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
}

const BASE58_ID = /^[1-9A-HJ-NP-Za-km-z]+$/;
const SAFE_SYMBOL = /^[A-Za-z0-9._-]{1,64}$/;
const SAFE_TEXT = /^[^\u0000-\u001f\u007f]{1,512}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const ORDER_STATUSES = new Set([
  "PENDING",
  "PENDING_CANCEL",
  "WORKING",
  "FILLED",
  "CANCELED",
  "REJECTED",
]);

function correlationId(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }
  } catch {
    // A non-sensitive fallback is sufficient for a local correlation label.
  }
  return `local-${Date.now().toString(36)}`;
}

function invalid(operation: string, message: string): AccountRestError {
  return new AccountRestError("INVALID_REQUEST", operation, message, {
    localCorrelationId: correlationId(),
  });
}

function assertKeys(operation: ReadOnlyOperation, params: AccountRequestParams, allowed: Set<string>): void {
  for (const key of Object.keys(params)) {
    if (!allowed.has(key) || params[key as keyof AccountRequestParams] === undefined) {
      if (!allowed.has(key)) throw invalid(operation, `Unsupported filter for ${operation}.`);
    }
  }
}

function text(value: string | undefined, operation: string, field: string, max = 512): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > max || !SAFE_TEXT.test(value)) {
    throw invalid(operation, `Invalid ${field}.`);
  }
  return value;
}

function id(value: string | undefined, operation: string, field: string): string | undefined {
  const result = text(value, operation, field, 256);
  if (result !== undefined && !BASE58_ID.test(result)) throw invalid(operation, `Invalid ${field}.`);
  return result;
}

function symbols(value: string | readonly string[] | undefined, operation: string): string[] {
  if (value === undefined) return [];
  const values = typeof value === "string" ? [value] : [...value];
  if (values.length > 100) throw invalid(operation, "Too many symbols.");
  return values.map((value) => {
    if (typeof value !== "string" || !SAFE_SYMBOL.test(value)) {
      throw invalid(operation, "Invalid public symbol filter.");
    }
    return value;
  });
}

function booleanValue(value: boolean | undefined, operation: string, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw invalid(operation, `Invalid ${field}.`);
  return value ? "true" : "false";
}

function limit(value: number | undefined, operation: string): string | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1 || value > 1000) {
    throw invalid(operation, "Limit must be an integer from 1 to 1000.");
  }
  return String(value);
}

function cursor(value: string | undefined, operation: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || value.length > 8192 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw invalid(operation, "Invalid opaque cursor.");
  }
  // Do not trim, parse, decode, or normalize this value.
  return value;
}

function timestamp(value: string | undefined, operation: string, field: string): string | undefined {
  const result = text(value, operation, field, 128);
  if (result !== undefined && !RFC3339.test(result)) throw invalid(operation, `Invalid ${field}.`);
  return result;
}

function push(pairs: QueryPair[], key: string, value: string | undefined): void {
  if (value !== undefined) pairs.push({ key, value });
}

function commonSpotPairs(params: AccountRequestParams, operation: ReadOnlyOperation): QueryPair[] {
  const pairs: QueryPair[] = [];
  push(pairs, "subaccountId", id(params.subaccountId, operation, "subaccountId"));
  for (const symbol of symbols(params.symbol, operation)) push(pairs, "symbol", symbol);
  if (params.side !== undefined) {
    if (params.side !== "BUY" && params.side !== "SELL") throw invalid(operation, "Invalid side.");
    push(pairs, "side", params.side);
  }
  push(pairs, "triggerId", id(params.triggerId, operation, "triggerId"));
  push(pairs, "limit", limit(params.limit, operation));
  push(pairs, "pageToken", cursor(params.pageToken, operation));
  push(pairs, "includeAttachedRisk", booleanValue(params.includeAttachedRisk, operation, "includeAttachedRisk"));
  push(pairs, "includeAttachedRiskState", booleanValue(params.includeAttachedRiskState, operation, "includeAttachedRiskState"));
  return pairs;
}

/** Exact per-operation friendly REST serializers from the pinned OpenAPI. */
export function serializeReadOperation(
  operation: ReadOnlyOperation,
  params: AccountRequestParams = {},
): { path: string; pairs: QueryPair[]; canonicalQuery: string } {
  if (!Object.prototype.hasOwnProperty.call(READ_ONLY_OPERATIONS, operation)) {
    throw invalid(String(operation), "Operation is not in the read-only registry.");
  }
  const definition = READ_ONLY_OPERATIONS[operation];
  let path: string = definition.path;
  let pairs: QueryPair[] = [];
  const allKeys = new Set<string>();

  switch (operation) {
    case "authMe":
      assertKeys(operation, params, allKeys);
      break;
    case "balances":
      allKeys.add("subaccountId");
      assertKeys(operation, params, allKeys);
      push(pairs, "subaccount_id", id(params.subaccountId, operation, "subaccountId"));
      break;
    case "balanceHistory":
      ["subaccountId", "range", "ledger", "accountCode"].forEach((key) => allKeys.add(key));
      assertKeys(operation, params, allKeys);
      push(pairs, "subaccount_id", id(params.subaccountId, operation, "subaccountId"));
      if (params.range !== undefined && !["1d", "7d", "30d", "90d", "180d", "365d"].includes(params.range)) {
        throw invalid(operation, "Invalid history range.");
      }
      push(pairs, "range", params.range);
      push(pairs, "ledger", text(params.ledger as string | undefined, operation, "ledger", 128));
      push(pairs, "account_code", text(params.accountCode, operation, "accountCode", 256));
      break;
    case "equityHistory":
      ["subaccountId", "range", "groupBy", "accountCode"].forEach((key) => allKeys.add(key));
      assertKeys(operation, params, allKeys);
      push(pairs, "subaccount_id", id(params.subaccountId, operation, "subaccountId"));
      if (params.range !== undefined && !["1d", "7d", "30d", "90d", "180d", "365d"].includes(params.range)) {
        throw invalid(operation, "Invalid history range.");
      }
      push(pairs, "range", params.range);
      if (params.groupBy !== undefined && params.groupBy !== "ACCOUNT" && params.groupBy !== "ASSET") {
        throw invalid(operation, "Invalid equity grouping.");
      }
      push(pairs, "group_by", params.groupBy);
      push(pairs, "account_code", text(params.accountCode, operation, "accountCode", 256));
      break;
    case "transfers": {
      ["subaccountId", "ledger", "limit", "pageToken", "reversed"].forEach((key) => allKeys.add(key));
      assertKeys(operation, params, allKeys);
      push(pairs, "subaccount_id", id(params.subaccountId, operation, "subaccountId"));
      if (params.ledger !== undefined) {
        if (typeof params.ledger !== "number" || !Number.isInteger(params.ledger)) {
          throw invalid(operation, "Transfer ledger must be an integer asset ID.");
        }
        push(pairs, "ledger", String(params.ledger));
      }
      push(pairs, "limit", limit(params.limit, operation));
      push(pairs, "page_token", cursor(params.pageToken, operation));
      push(pairs, "reversed", booleanValue(params.reversed, operation, "reversed"));
      break;
    }
    case "ordersOpen":
    case "ordersHistory": {
      [
        "subaccountId", "symbol", "side", "triggerId", "limit", "pageToken",
        "includeAttachedRisk", "includeAttachedRiskState", "status", "startTime", "endTime",
      ].forEach((key) => allKeys.add(key));
      if (operation === "ordersOpen") {
        ["status", "startTime", "endTime"].forEach((key) => allKeys.delete(key));
      }
      assertKeys(operation, params, allKeys);
      pairs = commonSpotPairs(params, operation);
      if (operation === "ordersHistory") {
        if (params.status !== undefined && !ORDER_STATUSES.has(params.status)) {
          throw invalid(operation, "Invalid order status.");
        }
        push(pairs, "status", params.status);
        push(pairs, "startTime", timestamp(params.startTime, operation, "startTime"));
        push(pairs, "endTime", timestamp(params.endTime, operation, "endTime"));
      }
      break;
    }
    case "orderDetails": {
      [
        "orderId", "subaccountId", "includeExecutionHistory", "limit", "pageToken",
        "includeAttachedRisk", "includeAttachedRiskState",
      ].forEach((key) => allKeys.add(key));
      assertKeys(operation, params, allKeys);
      const orderId = id(params.orderId, operation, "orderId");
      if (!orderId) throw invalid(operation, "A validated orderId is required for order details.");
      // The identifier is the only dynamic path segment. It is base58-checked
      // above and is never accepted as an arbitrary caller-supplied path.
      path = `/v1/spot/orders/${orderId}`;
      push(pairs, "subaccountId", id(params.subaccountId, operation, "subaccountId"));
      push(pairs, "includeExecutionHistory", booleanValue(params.includeExecutionHistory, operation, "includeExecutionHistory"));
      push(pairs, "limit", limit(params.limit, operation));
      push(pairs, "pageToken", cursor(params.pageToken, operation));
      push(pairs, "includeAttachedRisk", booleanValue(params.includeAttachedRisk, operation, "includeAttachedRisk"));
      push(pairs, "includeAttachedRiskState", booleanValue(params.includeAttachedRiskState, operation, "includeAttachedRiskState"));
      break;
    }
    case "fills": {
      [
        "subaccountId", "symbol", "side", "startTime", "endTime", "afterMatchId",
        "orderId", "lineageId", "throughGeneration", "includeTransfers", "limit", "pageToken",
      ].forEach((key) => allKeys.add(key));
      assertKeys(operation, params, allKeys);
      if (params.orderId !== undefined && params.lineageId !== undefined) {
        throw invalid(operation, "orderId and lineageId are mutually exclusive.");
      }
      if (params.afterMatchId !== undefined && params.symbol === undefined) {
        throw invalid(operation, "afterMatchId requires symbol.");
      }
      if (params.throughGeneration !== undefined && params.lineageId === undefined) {
        throw invalid(operation, "throughGeneration requires lineageId.");
      }
      push(pairs, "subaccountId", id(params.subaccountId, operation, "subaccountId"));
      const selectedSymbols = symbols(params.symbol, operation);
      if (selectedSymbols.length > 1) throw invalid(operation, "Fills accepts one symbol.");
      if (selectedSymbols[0] !== undefined) push(pairs, "symbol", selectedSymbols[0]);
      if (params.side !== undefined) {
        if (params.side !== "BUY" && params.side !== "SELL") throw invalid(operation, "Invalid side.");
        push(pairs, "side", params.side);
      }
      push(pairs, "startTime", timestamp(params.startTime, operation, "startTime"));
      push(pairs, "endTime", timestamp(params.endTime, operation, "endTime"));
      if (params.afterMatchId !== undefined && !/^[1-9][0-9]*$/.test(params.afterMatchId)) {
        throw invalid(operation, "Invalid afterMatchId.");
      }
      push(pairs, "afterMatchId", params.afterMatchId);
      push(pairs, "orderId", id(params.orderId, operation, "orderId"));
      push(pairs, "lineageId", id(params.lineageId, operation, "lineageId"));
      if (params.throughGeneration !== undefined) {
        if (!Number.isSafeInteger(params.throughGeneration) || params.throughGeneration < 0) {
          throw invalid(operation, "Invalid throughGeneration.");
        }
        push(pairs, "throughGeneration", String(params.throughGeneration));
      }
      push(pairs, "includeTransfers", booleanValue(params.includeTransfers, operation, "includeTransfers"));
      push(pairs, "limit", limit(params.limit, operation));
      push(pairs, "pageToken", cursor(params.pageToken, operation));
      break;
    }
    case "feeRates":
      ["subaccountId", "symbol"].forEach((key) => allKeys.add(key));
      assertKeys(operation, params, allKeys);
      push(pairs, "subaccountId", id(params.subaccountId, operation, "subaccountId"));
      for (const symbol of symbols(params.symbol, operation)) push(pairs, "symbol", symbol);
      break;
    default:
      throw invalid(operation, "Operation is not implemented in the read-only serializer.");
  }

  const canonicalQuery = canonicalizePairs(pairs).canonicalQuery;
  return { path, pairs, canonicalQuery };
}

export function buildReadRequest(
  operation: ReadOnlyOperation,
  params: AccountRequestParams = {},
  baseUrl = POLYESTER_TESTNET_REST_ORIGIN,
): BuiltReadRequest {
  if (baseUrl !== POLYESTER_TESTNET_REST_ORIGIN) {
    throw invalid(operation, "Only the explicit official dotted testnet REST origin is allowed.");
  }
  const serialized = serializeReadOperation(operation, params);
  return {
    operation,
    method: "GET",
    path: serialized.path,
    canonicalQuery: serialized.canonicalQuery,
    url: `${baseUrl}${serialized.path}${serialized.canonicalQuery ? `?${serialized.canonicalQuery}` : ""}`,
  };
}

function combineSignals(
  ...inputSignals: Array<AbortSignal | undefined>
): { signal: AbortSignal; cleanup: () => void } {
  const signals = inputSignals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (signals.length === 1) return { signal: signals[0], cleanup: () => undefined };
  const controller = new AbortController();
  const listeners = signals.map((signal) => {
    const abort = () => {
      if (!controller.signal.aborted) controller.abort(signal.reason);
    };
    if (signal.aborted) abort();
    signal.addEventListener("abort", abort, { once: true });
    return { signal, abort };
  });
  return {
    signal: controller.signal,
    cleanup: () => {
      for (const { signal, abort } of listeners) signal.removeEventListener("abort", abort);
    },
  };
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Aborted", "AbortError");
}

/** Race an asynchronous request stage against cancellation, including test transports
 * or body readers that do not themselves observe AbortSignal. */
function withAbort<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(abortError(signal)));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    void Promise.resolve()
      .then(() => settled ? undefined : operation())
      .then(
        (value) => finish(() => resolve(value as T)),
        (error) => finish(() => reject(error)),
      );
  });
}

function retryAfter(response: Response): number | undefined {
  const raw = response.headers.get("retry-after");
  if (!raw || !/^\d+$/.test(raw)) return undefined;
  const seconds = Number(raw);
  return Number.isSafeInteger(seconds) ? Math.min(seconds * 1000, 30_000) : undefined;
}

function structuredCode(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { code?: unknown; error?: unknown; status?: unknown };
    return [parsed.code, parsed.error, parsed.status]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toUpperCase();
  } catch {
    return "";
  }
}

function mapHttpStatus(status: number, body: string): AccountErrorCode {
  const code = structuredCode(body);
  if (code.includes("TIMESTAMP_SKEW")) return "TIMESTAMP_SKEW";
  if (code.includes("SIGNATURE_INVALID")) return "SIGNATURE_INVALID";
  if (code.includes("KEY_DISABLED")) return "KEY_DISABLED";
  if (code.includes("KEY_EXPIRED")) return "KEY_EXPIRED";
  if (code.includes("IP_NOT_ALLOWED")) return "IP_NOT_ALLOWED";
  if (code.includes("PERMISSION_DENIED")) return "PERMISSION_DENIED";
  if (status === 401) return "UNAUTHENTICATED";
  if (status === 403) return "PERMISSION_DENIED";
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "SERVER";
  return "HTTP_ERROR";
}

function safeMessage(code: AccountErrorCode): string {
  switch (code) {
    case "UNAUTHENTICATED": return "The account request could not authenticate.";
    case "PERMISSION_DENIED": return "This read is not granted to the current read-only connection.";
    case "TIMESTAMP_SKEW": return "The device clock or signing timestamp was rejected.";
    case "SIGNATURE_INVALID": return "The request signature was rejected; automatic retry is stopped.";
    case "RATE_LIMITED": return "The read endpoint is temporarily rate-limited.";
    case "SERVER": return "The read endpoint is temporarily unavailable.";
    case "CORS_BLOCKED": return "Browser access could not be verified (CORS or network policy).";
    case "SCHEMA_INCOMPATIBLE": return "This response version is not supported by the current account parser.";
    case "ACCOUNT_STALE": return "The account session changed; the late response was discarded.";
    case "ABORTED": return "The account request was aborted.";
    case "TIMEOUT": return "The account request exceeded its time limit.";
    default: return "The account read failed safely; no private response was retained.";
  }
}

function mapError(error: unknown, operation: ReadOnlyOperation): AccountRestError {
  if (error instanceof AccountRestError) return error;
  if (error instanceof AccountVaultError) {
    const code: AccountErrorCode =
      error.code === "VAULT_LOCKED" || error.code === "VAULT_STALE"
        ? "ACCOUNT_STALE"
        : error.code === "KEY_ID_REQUIRED"
          ? "UNAUTHENTICATED"
          : "INVALID_REQUEST";
    return new AccountRestError(code, operation, code === "ACCOUNT_STALE" ? safeMessage(code) : error.message, {
      localCorrelationId: correlationId(),
    });
  }
  if (error instanceof CanonicalRequestError) {
    return new AccountRestError("CONTRACT_CONFLICT", operation, error.message, {
      localCorrelationId: correlationId(),
    });
  }
  if (error instanceof Error && error.name === "AbortError") {
    return new AccountRestError("ABORTED", operation, safeMessage("ABORTED"), {
      localCorrelationId: correlationId(),
    });
  }
  if (error instanceof TypeError) {
    return new AccountRestError("CORS_BLOCKED", operation, safeMessage("CORS_BLOCKED"), {
      localCorrelationId: correlationId(),
    });
  }
  return new AccountRestError("NETWORK", operation, safeMessage("NETWORK"), {
    localCorrelationId: correlationId(),
  });
}

function retryable(code: AccountErrorCode): boolean {
  return code === "RATE_LIMITED" || code === "SERVER";
}

async function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  if (milliseconds <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export class AccountRestClient {
  private readonly vault: AccountVault;
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly requestTimeoutMs: number;
  private readonly sleepImpl: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  private readonly now: () => number;

  constructor(options: AccountRestClientOptions) {
    this.vault = options.vault;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.baseUrl = options.baseUrl ?? POLYESTER_TESTNET_REST_ORIGIN;
    if (this.baseUrl !== POLYESTER_TESTNET_REST_ORIGIN) {
      throw new AccountRestError("INVALID_REQUEST", "client", "Only the official dotted testnet origin is allowed.", {
        localCorrelationId: correlationId(),
      });
    }
    this.maxRetries = Math.max(0, Math.min(2, Math.floor(options.maxRetries ?? 0)));
    this.retryBaseDelayMs = Math.max(0, Math.min(5_000, Math.floor(options.retryBaseDelayMs ?? 250)));
    const requestedTimeout = options.requestTimeoutMs ?? DEFAULT_ACCOUNT_REQUEST_TIMEOUT_MS;
    this.requestTimeoutMs = Number.isFinite(requestedTimeout)
      ? Math.max(1, Math.min(MAX_ACCOUNT_REQUEST_TIMEOUT_MS, Math.floor(requestedTimeout)))
      : DEFAULT_ACCOUNT_REQUEST_TIMEOUT_MS;
    this.sleepImpl = options.sleepImpl ?? defaultSleep;
    this.now = options.now ?? Date.now;
  }

  async request<T>(
    operation: ReadOnlyOperation,
    params: AccountRequestParams,
    validate: (value: unknown) => T,
    options: { signal?: AbortSignal } = {},
  ): Promise<AccountResponse<T>> {
    let attempt = 0;
    while (true) {
      const session = this.vault.getSessionInfo();
      if (!session) throw new AccountRestError("ACCOUNT_STALE", operation, "Unlock the vault before account reads.", {
        localCorrelationId: correlationId(),
      });
      const generation = session.generation;
      const timeoutController = new AbortController();
      const timeoutId = setTimeout(
        () => timeoutController.abort(ACCOUNT_REQUEST_TIMEOUT_REASON),
        this.requestTimeoutMs,
      );
      const combined = combineSignals(session.signal, options.signal, timeoutController.signal);
      const assertRequestActive = () => {
        if (combined.signal.reason === ACCOUNT_REQUEST_TIMEOUT_REASON) {
          throw new AccountRestError("TIMEOUT", operation, safeMessage("TIMEOUT"), {
            localCorrelationId: correlationId(),
          });
        }
        if (session.signal.aborted || this.vault.getSessionInfo()?.generation !== generation) {
          throw new AccountRestError("ACCOUNT_STALE", operation, safeMessage("ACCOUNT_STALE"), {
            localCorrelationId: correlationId(),
          });
        }
        if (combined.signal.aborted) {
          throw new AccountRestError("ABORTED", operation, safeMessage("ABORTED"), {
            localCorrelationId: correlationId(),
          });
        }
      };
      try {
        const built = buildReadRequest(operation, params, this.baseUrl);
        const signed = await withAbort(
          () => this.vault.signReadRequest({
            operation,
            path: built.path,
            query: built.canonicalQuery,
          }),
          combined.signal,
        );
        const canonicalLines = signed.canonicalString.split("\n");
        const signedPath = canonicalLines[2];
        const signedQuery = canonicalLines[3];
        if (signedPath !== built.path || signedQuery !== built.canonicalQuery) {
          throw new AccountRestError("CONTRACT_CONFLICT", operation, "The sent path/query and signed path/query differ; request blocked.", {
            localCorrelationId: correlationId(),
          });
        }
        const response = await withAbort(
          () => this.fetchImpl(built.url, {
            method: "GET",
            headers: signed.headers,
            credentials: "omit",
            cache: "no-store",
            redirect: "error",
            referrerPolicy: "no-referrer",
            mode: "cors",
            signal: combined.signal,
          }),
          combined.signal,
        );
        assertRequestActive();
        const body = await withAbort(() => response.text(), combined.signal);
        if (!response.ok) {
          const code = mapHttpStatus(response.status, body);
          throw new AccountRestError(code, operation, safeMessage(code), {
            localCorrelationId: correlationId(),
            httpStatus: response.status,
            retryAfterMs: retryAfter(response),
          });
        }
        const contentType = response.headers.get("content-type") ?? "";
        if (!/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|\s*$)/i.test(contentType)) {
          throw new AccountRestError("SCHEMA_INCOMPATIBLE", operation, safeMessage("SCHEMA_INCOMPATIBLE"), {
            localCorrelationId: correlationId(),
            httpStatus: response.status,
          });
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(body) as unknown;
        } catch {
          throw new AccountRestError("SCHEMA_INCOMPATIBLE", operation, safeMessage("SCHEMA_INCOMPATIBLE"), {
            localCorrelationId: correlationId(),
            httpStatus: response.status,
          });
        }
        let data: T;
        try {
          data = validate(parsed);
        } catch (error) {
          if (error instanceof AccountRestError) throw error;
          throw new AccountRestError("SCHEMA_INCOMPATIBLE", operation, safeMessage("SCHEMA_INCOMPATIBLE"), {
            localCorrelationId: correlationId(),
            httpStatus: response.status,
          });
        }
        assertRequestActive();
        return {
          data,
          operation,
          contractVersion: ACCOUNT_CONTRACT_VERSION,
          retrievedAtMs: this.now(),
        };
      } catch (error) {
        const mapped = combined.signal.reason === ACCOUNT_REQUEST_TIMEOUT_REASON
          ? new AccountRestError("TIMEOUT", operation, safeMessage("TIMEOUT"), {
            localCorrelationId: correlationId(),
          })
          : mapError(error, operation);
        if (attempt < this.maxRetries && retryable(mapped.code) && !combined.signal.aborted) {
          const delay = mapped.details.retryAfterMs ?? Math.min(5_000, this.retryBaseDelayMs * 2 ** attempt);
          attempt += 1;
          clearTimeout(timeoutId);
          try {
            await this.sleepImpl(delay, combined.signal);
          } catch (sleepError) {
            throw mapError(sleepError, operation);
          }
          continue;
        }
        throw mapped;
      } finally {
        clearTimeout(timeoutId);
        combined.cleanup();
      }
    }
  }
}

export function safeAccountError(error: unknown, operation = "account"): SafeAccountError {
  if (error instanceof AccountRestError) return error.toSafeError();
  return {
    code: "NETWORK",
    operation,
    localCorrelationId: correlationId(),
  };
}
