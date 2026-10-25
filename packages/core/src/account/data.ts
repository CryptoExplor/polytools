import {
  ACCOUNT_CONTRACT_VERSION,
  AccountRestClient,
  AccountRestError,
  safeAccountError,
  type AccountRequestParams,
  type AccountResponse,
  type SafeAccountError,
} from "./rest";
import type { ReadOnlyOperation } from "./signer";
import type { AccountVault, VaultSessionInfo } from "./vault";
import { MemoryDatasetStore, type PrivatePartition } from "./memoryStore";
import { collectCursorPages, CursorIngestionError } from "./pagination";
import { emptyCoverage, type Coverage, type CoverageStatus } from "./coverage";
import { deduplicateFills, sampledEquityMetrics, summarizeFills, type FillInput, type ObservedFillSummary, type SampledEquityMetrics } from "./analytics";
import {
  validateBalanceHistoryResponse,
  validateBalancesResponse,
  validateEquityHistoryResponse,
  validateFeeRatesResponse,
  validateFillsResponse,
  validateOrderDetailsResponse,
  validateOrderHistoryResponse,
  validateOrdersOpenResponse,
  validateTransfersResponse,
  type BalanceHistoryResponse,
  type EquityHistoryResponse,
  type FillMarket,
  type NormalizedBalance,
  type NormalizedFeeRate,
  type NormalizedOrder,
  type NormalizedTransfer,
} from "./normalize";

export type AccountHistoryRange = NonNullable<AccountRequestParams["range"]>;

export interface AccountReadClient {
  request<T>(
    operation: ReadOnlyOperation,
    params: AccountRequestParams,
    validate: (value: unknown) => T,
    options?: { signal?: AbortSignal },
  ): Promise<AccountResponse<T>>;
}

export interface AccountDataCoordinatorOptions {
  vault: AccountVault;
  client?: AccountReadClient;
  store?: MemoryDatasetStore;
  /** A cap is always visible as partial coverage, never as a complete history. */
  maxPages?: number;
  now?: () => number;
}

export interface AccountPeriod {
  range: AccountHistoryRange;
  startTime: string;
  endTime: string;
}

export interface AccountDataLoadOptions {
  range?: AccountHistoryRange;
  subaccountId?: string;
  ledger?: string;
  accountCode?: string;
  markets?: Readonly<Record<string, FillMarket>>;
  signal?: AbortSignal;
}

export interface OrderDetailsLoadOptions extends AccountDataLoadOptions {
  orderId: string;
}

export type AccountCursorImportOperation = "orders" | "fills" | "transfers";

export interface AccountCursorProgress {
  operation: AccountCursorImportOperation;
  pagesFetched: number;
  rowsReceived: number;
  maxPages: number;
  hasNextPage: boolean;
}

export interface AccountHistoryImportOptions extends AccountDataLoadOptions {
  /** Reuse the exact snapshot window; do not silently move the end time. */
  period: AccountPeriod;
  /** Explicit safety cap. Reaching it remains partial, never complete. */
  maxPages: number;
  /** Defaults to fills + transfers for the R2 activity/R3 input path. */
  operations?: readonly AccountCursorImportOperation[];
  onProgress?: (progress: AccountCursorProgress) => void;
}

export interface AccountHistoryImportResult {
  period: AccountPeriod;
  orders?: AccountDataset<OrdersData>;
  fills?: AccountDataset<FillsData>;
  transfers?: AccountDataset<TransfersData>;
}

export interface AccountDataset<T> {
  data: T | null;
  coverage: Coverage;
  retrievedAtMs: number | null;
  error?: SafeAccountError;
}

export interface BalancesData {
  balances: NormalizedBalance[];
}

export type BalanceHistoryData = BalanceHistoryResponse;

export interface EquityData {
  response: EquityHistoryResponse;
  /** Metrics use sample sequence numbers for ordering, not invented timestamps. */
  seriesMetrics: SampledEquityMetrics[];
}

export interface OrdersData {
  orders: NormalizedOrder[];
  quarantined: unknown[];
}

export interface OpenOrdersData {
  orders: NormalizedOrder[];
  quarantined: unknown[];
}

export interface OrderDetailsData {
  order: NormalizedOrder | null;
  /** Deduplicated lineage executions; never settlement legs or inferred fills. */
  executions: FillInput[];
  quarantined: unknown[];
}

export interface FillsData {
  summary: ObservedFillSummary;
  quarantined: unknown[];
}

export interface TransfersData {
  transfers: NormalizedTransfer[];
  quarantined: unknown[];
}

export interface FeeRatesData {
  feeRates: NormalizedFeeRate[];
}

export interface AccountDataSnapshot {
  period: AccountPeriod;
  scopeLabel: string;
  balances: AccountDataset<BalancesData>;
  equity: AccountDataset<EquityData>;
  orders: AccountDataset<OrdersData>;
  fills: AccountDataset<FillsData>;
  transfers: AccountDataset<TransfersData>;
  feeRates: AccountDataset<FeeRatesData>;
}

interface PageAdapter<T> {
  nextPageToken: string;
  rows: readonly T[];
  quarantined?: readonly unknown[];
}

interface PageCollection<T> {
  rows: T[];
  quarantined: unknown[];
  pagesFetched: number;
  receivedRows: number;
  cursorExhausted: boolean;
  stoppedAtCap: boolean;
  repeatedCursor: boolean;
  retrievedAtMs: number | null;
  error?: unknown;
}

interface PageReadPolicy {
  maxPages?: number;
  onPage?: (pagesFetched: number, rowsReceived: number, hasNextPage: boolean) => void;
}

interface RequestGeneration {
  key: string;
  generation: number;
}

const RANGE_DAYS: Record<AccountHistoryRange, number> = {
  "1d": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "180d": 180,
  "365d": 365,
};

const TEMPORARY_ERRORS = new Set(["NETWORK", "CORS_BLOCKED", "SERVER", "RATE_LIMITED"]);

export function accountPeriodWindow(
  range: AccountHistoryRange = "30d",
  now = Date.now(),
): AccountPeriod {
  if (!Object.prototype.hasOwnProperty.call(RANGE_DAYS, range)) {
    throw new AccountRestError("INVALID_REQUEST", "account", "Invalid account reporting range.");
  }
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new AccountRestError("INVALID_REQUEST", "account", "Invalid account reporting clock.");
  }
  const end = new Date(now).toISOString();
  const start = new Date(now - RANGE_DAYS[range] * 86_400_000).toISOString();
  return { range, startTime: start, endTime: end };
}

function filterValues(params: AccountRequestParams): Record<string, string | number | boolean | string[]> {
  const result: Record<string, string | number | boolean | string[]> = {};
  for (const [key, value] of Object.entries(params)) {
    if (key === "pageToken" || value === undefined) continue;
    if (Array.isArray(value)) result[key] = [...value] as string[];
    else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      result[key] = value;
    }
  }
  return result;
}

function statusForError(error: SafeAccountError): CoverageStatus {
  if (error.code === "PERMISSION_DENIED" || error.code === "UNAUTHENTICATED") return "denied";
  if (error.code === "ACCOUNT_STALE" || error.code === "ABORTED") return "stale";
  if (["CORS_BLOCKED", "CONTRACT_CONFLICT", "SCHEMA_INCOMPATIBLE"].includes(error.code)) return "blocked";
  return "unavailable";
}

function cursorError(error: unknown, operation: ReadOnlyOperation): SafeAccountError {
  if (error instanceof CursorIngestionError) {
    const code = error.code === "ABORTED" ? "ABORTED" : "SCHEMA_INCOMPATIBLE";
    return safeAccountError(new AccountRestError(code, operation, "Cursor ingestion did not complete safely."), operation);
  }
  return safeAccountError(error, operation);
}

function emptyDataset<T>(
  operation: ReadOnlyOperation,
  period: AccountPeriod | undefined,
  scopeLabel: string,
  params: AccountRequestParams,
): AccountDataset<T> {
  const coverage = emptyCoverage(operation, ACCOUNT_CONTRACT_VERSION, scopeLabel);
  coverage.filters = filterValues(params);
  if (period && ["fills", "ordersHistory", "equityHistory"].includes(operation)) {
    coverage.requestedStart = period.startTime;
    coverage.requestedEnd = period.endTime;
  }
  return { data: null, coverage, retrievedAtMs: null };
}

/**
 * Coordinates independently permissioned reads. It never treats a successful
 * public catalog or one private operation as proof that another read is granted.
 */
export class AccountDataCoordinator {
  private readonly vault: AccountVault;
  private readonly client: AccountReadClient;
  private readonly store: MemoryDatasetStore;
  private readonly maxPages: number;
  private readonly now: () => number;
  private readonly unbindLifecycle: () => void;
  private readonly unbindRequests: () => void;
  private readonly requestGenerations = new Map<string, number>();
  private requestSequence = 0;
  private disposed = false;

  constructor(options: AccountDataCoordinatorOptions) {
    this.vault = options.vault;
    this.client = options.client ?? new AccountRestClient({
      vault: options.vault,
      ...(options.now ? { now: options.now } : {}),
    });
    this.store = options.store ?? new MemoryDatasetStore();
    this.maxPages = options.maxPages ?? 25;
    if (!Number.isSafeInteger(this.maxPages) || this.maxPages < 1 || this.maxPages > 10_000) {
      throw new AccountRestError("INVALID_REQUEST", "account", "Invalid account page cap.");
    }
    this.now = options.now ?? Date.now;
    this.unbindLifecycle = this.store.bindLifecycle((listener) => this.vault.subscribe(listener));
    this.unbindRequests = this.vault.subscribe((event) => {
      if (["LOCK", "WIPE", "VAULT_CHANGED", "IMPORT", "UNLOCK"].includes(event.type.toUpperCase())) {
        this.invalidate();
      }
    });
  }

  dispose(): void {
    this.disposed = true;
    this.requestGenerations.clear();
    this.unbindRequests();
    this.unbindLifecycle();
    this.store.dispose();
  }

  /** Invalidate every in-flight dataset and all same-session private snapshots. */
  invalidate(): void {
    this.requestSequence += 1;
    this.requestGenerations.clear();
    this.store.clear();
  }

  private sessionOrThrow(): VaultSessionInfo {
    if (this.disposed) {
      throw new AccountRestError("ACCOUNT_STALE", "account", "The account coordinator was disposed; private data was discarded.");
    }
    const session = this.vault.getSessionInfo();
    if (!session) {
      throw new AccountRestError("ACCOUNT_STALE", "account", "Unlock the vault before account reads.");
    }
    return session;
  }

  private assertCurrent(session: VaultSessionInfo): void {
    const current = this.vault.getSessionInfo();
    if (
      !current ||
      current.generation !== session.generation ||
      current.entryId !== session.entryId ||
      session.signal.aborted
    ) {
      throw new AccountRestError("ACCOUNT_STALE", "account", "The account session changed; private data was discarded.");
    }
  }

  private beginRequest(key: string): RequestGeneration {
    if (this.disposed) {
      throw new AccountRestError("ACCOUNT_STALE", "account", "The account coordinator was disposed; private data was discarded.");
    }
    const generation = ++this.requestSequence;
    this.requestGenerations.set(key, generation);
    return { key, generation };
  }

  private assertRequestCurrent(session: VaultSessionInfo, request: RequestGeneration): void {
    this.assertCurrent(session);
    if (this.disposed || this.requestGenerations.get(request.key) !== request.generation) {
      throw new AccountRestError("ACCOUNT_STALE", "account", "A newer account request superseded this response; it was discarded.");
    }
  }

  private scopeLabel(params: AccountRequestParams): string {
    return params.subaccountId ? "Selected subaccount" : "Main account";
  }

  private partition(
    session: VaultSessionInfo,
    operation: ReadOnlyOperation,
    params: AccountRequestParams,
  ): PrivatePartition {
    return {
      sessionGeneration: session.generation,
      scopeKey: JSON.stringify([session.entryId, params.subaccountId ?? "root"]),
      operation,
      filters: filterValues(params),
    };
  }

  private cached<T>(partition: PrivatePartition): AccountDataset<T> | undefined {
    try {
      return this.store.get<AccountDataset<T>>(partition);
    } catch {
      return undefined;
    }
  }

  private storeCurrent<T>(
    session: VaultSessionInfo,
    partition: PrivatePartition,
    operation: ReadOnlyOperation,
    params: AccountRequestParams,
    value: AccountDataset<T>,
    request?: RequestGeneration,
  ): void {
    if (request) this.assertRequestCurrent(session, request);
    else this.assertCurrent(session);
    const current = this.vault.getSessionInfo();
    if (!current) return;
    this.store.setIfCurrent(partition, value, this.partition(current, operation, params));
  }

  private failure<T>(
    session: VaultSessionInfo,
    operation: ReadOnlyOperation,
    params: AccountRequestParams,
    period: AccountPeriod | undefined,
    previous: AccountDataset<T> | undefined,
    error: unknown,
    request?: RequestGeneration,
  ): AccountDataset<T> {
    if (request) this.assertRequestCurrent(session, request);
    const safe = cursorError(error, operation);
    const base = emptyDataset<T>(operation, period, this.scopeLabel(params), params);
    const canUseStale = previous?.data !== null && previous?.data !== undefined && TEMPORARY_ERRORS.has(safe.code);
    if (canUseStale && previous) {
      return {
        ...previous,
        coverage: { ...previous.coverage, status: "stale" },
        error: safe,
      };
    }
    base.coverage.status = statusForError(safe);
    base.error = safe;
    return base;
  }

  private async readSingle<T>(
    session: VaultSessionInfo,
    operation: ReadOnlyOperation,
    params: AccountRequestParams,
    period: AccountPeriod | undefined,
    validate: (value: unknown) => T,
    rowCount: (data: T) => number,
    request: RequestGeneration,
    signal?: AbortSignal,
  ): Promise<AccountDataset<T>> {
    const partition = this.partition(session, operation, params);
    const previous = this.cached<T>(partition);
    const base = emptyDataset<T>(operation, period, this.scopeLabel(params), params);
    try {
      const response = await this.client.request(operation, params, validate, { signal });
      this.assertRequestCurrent(session, request);
      const rows = rowCount(response.data);
      const result: AccountDataset<T> = {
        data: response.data,
        retrievedAtMs: response.retrievedAtMs,
        coverage: {
          ...base.coverage,
          status: "complete",
          pagesFetched: 1,
          rowsReceived: rows,
          rowsAccepted: rows,
          cursorExhausted: true,
          retrievedAtMs: response.retrievedAtMs,
        },
      };
      this.storeCurrent(session, partition, operation, params, result, request);
      return result;
    } catch (error) {
      return this.failure(session, operation, params, period, previous, error, request);
    }
  }

  private async collectPages<T>(
    session: VaultSessionInfo,
    operation: ReadOnlyOperation,
    params: AccountRequestParams,
    request: RequestGeneration,
    signal: AbortSignal | undefined,
    adapt: (value: unknown) => PageAdapter<T>,
    policy: PageReadPolicy = {},
  ): Promise<PageCollection<T>> {
    const quarantined: unknown[] = [];
    let receivedRows = 0;
    let retrievedAtMs: number | null = null;
    const result = await collectCursorPages<T>({
      maxPages: policy.maxPages ?? this.maxPages,
      signal,
      onPage: (page, pagesFetched) => {
        policy.onPage?.(pagesFetched, receivedRows, Boolean(page.nextPageToken));
      },
      fetchPage: async (pageToken) => {
        const response = await this.client.request(
          operation,
          { ...params, pageToken },
          (value) => adapt(value),
          { signal },
        );
        this.assertRequestCurrent(session, request);
        const page = response.data;
        receivedRows += page.rows.length + (page.quarantined?.length ?? 0);
        if (page.quarantined) quarantined.push(...page.quarantined);
        retrievedAtMs = response.retrievedAtMs;
        return { rows: page.rows, nextPageToken: page.nextPageToken };
      },
    });
    return {
      rows: [...result.rows],
      quarantined,
      pagesFetched: result.pagesFetched,
      receivedRows,
      cursorExhausted: result.cursorExhausted,
      stoppedAtCap: result.stoppedAtCap,
      repeatedCursor: result.repeatedCursor,
      retrievedAtMs,
      ...(result.error === undefined ? {} : { error: result.error }),
    };
  }

  private pagedBase<T>(
    session: VaultSessionInfo,
    operation: ReadOnlyOperation,
    params: AccountRequestParams,
    period: AccountPeriod | undefined,
  ): { partition: PrivatePartition; previous?: AccountDataset<T>; base: AccountDataset<T> } {
    const partition = this.partition(session, operation, params);
    return {
      partition,
      previous: this.cached<T>(partition),
      base: emptyDataset<T>(operation, period, this.scopeLabel(params), params),
    };
  }

  private finishPaged<T>(
    session: VaultSessionInfo,
    operation: ReadOnlyOperation,
    params: AccountRequestParams,
    period: AccountPeriod | undefined,
    request: RequestGeneration,
    context: { partition: PrivatePartition; previous?: AccountDataset<T>; base: AccountDataset<T> },
    collection: PageCollection<unknown>,
    data: T,
    counts: { accepted: number; duplicates?: number; conflicts?: number; unknown: number },
  ): AccountDataset<T> {
    if (collection.error && collection.pagesFetched === 0) {
      return this.failure(session, operation, params, period, context.previous, collection.error, request);
    }
    const hasPartialData = Boolean(
      collection.error ||
      collection.stoppedAtCap ||
      collection.repeatedCursor ||
      !collection.cursorExhausted ||
      counts.conflicts ||
      counts.unknown,
    );
    const result: AccountDataset<T> = {
      data,
      retrievedAtMs: collection.retrievedAtMs,
      ...(collection.error ? { error: cursorError(collection.error, operation) } : {}),
      coverage: {
        ...context.base.coverage,
        status: hasPartialData ? "partial" : "complete",
        pagesFetched: collection.pagesFetched,
        rowsReceived: collection.receivedRows,
        rowsAccepted: counts.accepted,
        duplicateRows: counts.duplicates ?? 0,
        conflictingRows: counts.conflicts ?? 0,
        unknownRows: counts.unknown,
        cursorExhausted: collection.cursorExhausted,
        stoppedAtCap: collection.stoppedAtCap,
        retrievedAtMs: collection.retrievedAtMs ?? undefined,
      },
    };
    try {
      this.storeCurrent(session, context.partition, operation, params, result, request);
    } catch (error) {
      return this.failure(session, operation, params, period, context.previous, error, request);
    }
    return result;
  }

  private async readOrders(
    session: VaultSessionInfo,
    params: AccountRequestParams,
    period: AccountPeriod,
    markets: Readonly<Record<string, FillMarket>>,
    request: RequestGeneration,
    signal?: AbortSignal,
    policy?: PageReadPolicy,
  ): Promise<AccountDataset<OrdersData>> {
    const context = this.pagedBase<OrdersData>(session, "ordersHistory", params, period);
    try {
      const collection = await this.collectPages(session, "ordersHistory", params, request, signal, (value) => {
        const page = validateOrderHistoryResponse(value, markets);
        return { nextPageToken: page.nextPageToken, rows: page.orders, quarantined: page.quarantined };
      }, policy);
      return this.finishPaged(session, "ordersHistory", params, period, request, context, collection, {
        orders: collection.rows,
        quarantined: collection.quarantined,
      }, { accepted: collection.rows.length, unknown: collection.quarantined.length });
    } catch (error) {
      return this.failure(session, "ordersHistory", params, period, context.previous, error, request);
    }
  }

  private async readFills(
    session: VaultSessionInfo,
    params: AccountRequestParams,
    period: AccountPeriod,
    markets: Readonly<Record<string, FillMarket>>,
    request: RequestGeneration,
    signal?: AbortSignal,
    policy?: PageReadPolicy,
  ): Promise<AccountDataset<FillsData>> {
    const context = this.pagedBase<FillsData>(session, "fills", params, period);
    try {
      const collection = await this.collectPages(session, "fills", params, request, signal, (value) => {
        const page = validateFillsResponse(value, {
          accountScope: JSON.stringify([session.entryId, params.subaccountId ?? "root"]),
          markets,
        });
        return { nextPageToken: page.nextPageToken, rows: page.fills, quarantined: page.quarantined };
      }, policy);
      const preliminary = summarizeFills(collection.rows, { status: "partial" });
      const status: CoverageStatus = collection.error || collection.stoppedAtCap || collection.repeatedCursor ||
        !collection.cursorExhausted || collection.quarantined.length > 0 || !preliminary.eligible
        ? "partial"
        : "complete";
      const summary = summarizeFills(collection.rows, { status });
      if (collection.quarantined.length > 0) {
        summary.eligible = false;
        summary.metricLabel = "observed-metrics-blocked";
        summary.issues.push("Unknown response rows block affected fill aggregates.");
      }
      const result = this.finishPaged(session, "fills", params, period, request, context, collection, {
        summary,
        quarantined: collection.quarantined,
      }, {
        accepted: summary.rowsAccepted,
        duplicates: summary.duplicateRows,
        conflicts: summary.conflictingRows,
        unknown: collection.quarantined.length + summary.unknownRows,
      });
      return result;
    } catch (error) {
      return this.failure(session, "fills", params, period, context.previous, error, request);
    }
  }

  private async readTransfers(
    session: VaultSessionInfo,
    params: AccountRequestParams,
    period: AccountPeriod | undefined,
    request: RequestGeneration,
    signal?: AbortSignal,
    policy?: PageReadPolicy,
  ): Promise<AccountDataset<TransfersData>> {
    const context = this.pagedBase<TransfersData>(session, "transfers", params, period);
    try {
      const collection = await this.collectPages(session, "transfers", params, request, signal, (value) => {
        const page = validateTransfersResponse(value);
        return { nextPageToken: page.nextPageToken, rows: page.transfers, quarantined: page.quarantined };
      }, policy);
      const unknownReasons = collection.rows.filter((transfer) => !transfer.reasonKnown).length;
      return this.finishPaged(session, "transfers", params, period, request, context, collection, {
        // Unknown reasons remain visible; they are excluded only from accepted
        // coverage counts, never silently dropped from the activity rows.
        transfers: collection.rows,
        quarantined: collection.quarantined,
      }, {
        accepted: collection.rows.length - unknownReasons,
        unknown: collection.quarantined.length + unknownReasons,
      });
    } catch (error) {
      return this.failure(session, "transfers", params, period, context.previous, error, request);
    }
  }

  /**
   * Load open orders independently from terminal history. This deliberately
   * does not add another request to loadAll(): callers can keep permission and
   * coverage failures for the two order datasets separate.
   */
  async loadOpenOrders(options: AccountDataLoadOptions = {}): Promise<AccountDataset<OpenOrdersData>> {
    const session = this.sessionOrThrow();
    const request = this.beginRequest("openOrders");
    const scope = options.subaccountId === undefined ? {} : { subaccountId: options.subaccountId };
    const params: AccountRequestParams = { ...scope, limit: 100 };
    const context = this.pagedBase<OpenOrdersData>(session, "ordersOpen", params, undefined);
    try {
      const collection = await this.collectPages(session, "ordersOpen", params, request, options.signal, (value) => {
        const page = validateOrdersOpenResponse(value, options.markets ?? {});
        return { nextPageToken: page.nextPageToken, rows: page.orders, quarantined: page.quarantined };
      });
      return this.finishPaged(session, "ordersOpen", params, undefined, request, context, collection, {
        orders: collection.rows,
        quarantined: collection.quarantined,
      }, { accepted: collection.rows.length, unknown: collection.quarantined.length });
    } catch (error) {
      return this.failure(session, "ordersOpen", params, undefined, context.previous, error, request);
    }
  }

  /** Load fixed-range sampled balances without adding a request to loadAll(). */
  async loadBalanceHistory(options: AccountDataLoadOptions = {}): Promise<AccountDataset<BalanceHistoryData>> {
    const session = this.sessionOrThrow();
    const request = this.beginRequest("balanceHistory");
    const scope = options.subaccountId === undefined ? {} : { subaccountId: options.subaccountId };
    const params: AccountRequestParams = {
      ...scope,
      range: options.range ?? "7d",
      ...(options.ledger === undefined ? {} : { ledger: options.ledger }),
      ...(options.accountCode === undefined ? {} : { accountCode: options.accountCode }),
    };
    return this.readSingle(
      session,
      "balanceHistory",
      params,
      undefined,
      validateBalanceHistoryResponse,
      (data) => data.series.reduce((count, series) => count + series.balance.length, 0),
      request,
      options.signal,
    );
  }

  /** Load one order and all safely bounded pages of its lineage executions. */
  async loadOrderDetails(options: OrderDetailsLoadOptions): Promise<AccountDataset<OrderDetailsData>> {
    const session = this.sessionOrThrow();
    const request = this.beginRequest("orderDetails");
    const scope = options.subaccountId === undefined ? {} : { subaccountId: options.subaccountId };
    const params: AccountRequestParams = {
      ...scope,
      orderId: options.orderId,
      includeExecutionHistory: true,
      limit: 100,
    };
    const context = this.pagedBase<OrderDetailsData>(session, "orderDetails", params, undefined);
    let selectedOrder: NormalizedOrder | null = null;
    let orderSeen = false;
    try {
      const collection = await this.collectPages(session, "orderDetails", params, request, options.signal, (value) => {
        const page = validateOrderDetailsResponse(value, {
          accountScope: JSON.stringify([session.entryId, params.subaccountId ?? "root"]),
          markets: options.markets ?? {},
          orderId: options.orderId,
        });
        if (!orderSeen) {
          selectedOrder = page.order;
          orderSeen = true;
        } else if (JSON.stringify(selectedOrder) !== JSON.stringify(page.order)) {
          throw new AccountRestError(
            "SCHEMA_INCOMPATIBLE",
            "orderDetails",
            "The order changed while execution pages were read; the inconsistent snapshot was blocked.",
          );
        }
        return { nextPageToken: page.nextPageToken, rows: page.executions, quarantined: page.quarantined };
      });
      const deduplicated = deduplicateFills(collection.rows);
      return this.finishPaged(session, "orderDetails", params, undefined, request, context, collection, {
        order: selectedOrder,
        executions: deduplicated.rows,
        quarantined: collection.quarantined,
      }, {
        accepted: deduplicated.rows.length,
        duplicates: deduplicated.duplicateRows,
        conflicts: deduplicated.conflictingRows,
        unknown: collection.quarantined.length,
      });
    } catch (error) {
      return this.failure(session, "orderDetails", params, undefined, context.previous, error, request);
    }
  }

  /**
   * Explicitly import fills and transfers with a caller-selected page policy.
   * This is separate from loadAll(), whose existing bounded snapshot behavior
   * is unchanged. The exact supplied period is reused so selected datasets can
   * safely replace their counterparts in an existing snapshot.
   */
  async importCursorHistory(options: AccountHistoryImportOptions): Promise<AccountHistoryImportResult> {
    if (!Number.isSafeInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > 10_000) {
      throw new AccountRestError("INVALID_REQUEST", "account", "Cursor import page cap must be between 1 and 10000.");
    }
    const period = options.period;
    const startMs = period ? Date.parse(period.startTime) : Number.NaN;
    const endMs = period ? Date.parse(period.endTime) : Number.NaN;
    if (
      !period ||
      !Object.prototype.hasOwnProperty.call(RANGE_DAYS, period.range) ||
      !Number.isFinite(startMs) ||
      !Number.isFinite(endMs) ||
      startMs >= endMs
    ) {
      throw new AccountRestError("INVALID_REQUEST", "account", "Cursor import requires the existing valid snapshot period.");
    }
    const operations: readonly AccountCursorImportOperation[] = options.operations ?? ["fills", "transfers"];
    const validOperations = new Set<AccountCursorImportOperation>(["orders", "fills", "transfers"]);
    if (
      operations.length === 0 ||
      operations.length > validOperations.size ||
      new Set(operations).size !== operations.length ||
      operations.some((operation) => !validOperations.has(operation))
    ) {
      throw new AccountRestError("INVALID_REQUEST", "account", "Choose each cursor import operation at most once.");
    }
    const session = this.sessionOrThrow();
    // Use the same generation key as loadAll so either operation supersedes an
    // older broad snapshot read instead of racing to overwrite its datasets.
    const request = this.beginRequest("all");
    const markets = options.markets ?? {};
    const scope = options.subaccountId === undefined ? {} : { subaccountId: options.subaccountId };
    const paged = { ...scope, limit: 100 };
    const timeWindow = { startTime: period.startTime, endTime: period.endTime };
    const policy = (operation: AccountCursorImportOperation): PageReadPolicy => ({
      maxPages: options.maxPages,
      onPage: (pagesFetched, rowsReceived, hasNextPage) => options.onProgress?.({
        operation,
        pagesFetched,
        rowsReceived,
        maxPages: options.maxPages,
        hasNextPage,
      }),
    });
    const result: AccountHistoryImportResult = { period: { ...period } };
    // Full-history imports are deliberately sequential. The ordinary snapshot
    // may read independent datasets concurrently, but a cursor import must not
    // create parallel request streams or obscure rate-limit behavior.
    for (const operation of operations) {
      if (operation === "orders") {
        result.orders = await this.readOrders(
          session,
          { ...paged, ...timeWindow },
          period,
          markets,
          request,
          options.signal,
          policy("orders"),
        );
      } else if (operation === "fills") {
        result.fills = await this.readFills(
          session,
          { ...paged, ...timeWindow },
          period,
          markets,
          request,
          options.signal,
          policy("fills"),
        );
      } else {
        result.transfers = await this.readTransfers(session, paged, undefined, request, options.signal, policy("transfers"));
      }
    }
    this.assertRequestCurrent(session, request);
    return result;
  }

  async loadAll(options: AccountDataLoadOptions = {}): Promise<AccountDataSnapshot> {
    const session = this.sessionOrThrow();
    const request = this.beginRequest("all");
    const period = accountPeriodWindow(options.range ?? "30d", this.now());
    const markets = options.markets ?? {};
    const scope = options.subaccountId === undefined ? {} : { subaccountId: options.subaccountId };
    const paged = { ...scope, limit: 100 };
    const timeWindow = { startTime: period.startTime, endTime: period.endTime };
    const [balances, equity, orders, fills, transfers, feeRates] = await Promise.all([
      this.readSingle(session, "balances", scope, undefined, validateBalancesResponse, (data) => data.balances.length, request, options.signal),
      this.readSingle(session, "equityHistory", { ...scope, range: period.range, groupBy: "ASSET" }, period, (value) => {
        const response = validateEquityHistoryResponse(value);
        return {
          response,
          seriesMetrics: response.series.map((series) => sampledEquityMetrics(
            series.equity.map((equity, index) => ({ timestamp: String(index), equity })),
          )),
        };
      }, (data) => data.response.series.reduce((count, series) => count + series.equity.length, 0), request, options.signal),
      this.readOrders(session, { ...paged, ...timeWindow }, period, markets, request, options.signal),
      this.readFills(session, { ...paged, ...timeWindow }, period, markets, request, options.signal),
      this.readTransfers(session, paged, undefined, request, options.signal),
      this.readSingle(session, "feeRates", scope, undefined, validateFeeRatesResponse, (data) => data.feeRates.length, request, options.signal),
    ]);
    this.assertRequestCurrent(session, request);
    return {
      period,
      scopeLabel: this.scopeLabel(scope),
      balances,
      equity,
      orders,
      fills,
      transfers,
      feeRates,
    };
  }
}
