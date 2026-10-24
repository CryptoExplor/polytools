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
import { sampledEquityMetrics, summarizeFills, type ObservedFillSummary, type SampledEquityMetrics } from "./analytics";
import {
  validateBalancesResponse,
  validateEquityHistoryResponse,
  validateFeeRatesResponse,
  validateFillsResponse,
  validateOrderHistoryResponse,
  validateTransfersResponse,
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
  markets?: Readonly<Record<string, FillMarket>>;
  signal?: AbortSignal;
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

export interface EquityData {
  response: EquityHistoryResponse;
  /** Metrics use sample sequence numbers for ordering, not invented timestamps. */
  seriesMetrics: SampledEquityMetrics[];
}

export interface OrdersData {
  orders: NormalizedOrder[];
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
  }

  dispose(): void {
    this.unbindLifecycle();
    this.store.dispose();
  }

  private sessionOrThrow(): VaultSessionInfo {
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
  ): void {
    this.assertCurrent(session);
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
  ): AccountDataset<T> {
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
    signal?: AbortSignal,
  ): Promise<AccountDataset<T>> {
    const partition = this.partition(session, operation, params);
    const previous = this.cached<T>(partition);
    const base = emptyDataset<T>(operation, period, this.scopeLabel(params), params);
    try {
      const response = await this.client.request(operation, params, validate, { signal });
      this.assertCurrent(session);
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
      this.storeCurrent(session, partition, operation, params, result);
      return result;
    } catch (error) {
      return this.failure(session, operation, params, period, previous, error);
    }
  }

  private async collectPages<T>(
    session: VaultSessionInfo,
    operation: ReadOnlyOperation,
    params: AccountRequestParams,
    signal: AbortSignal | undefined,
    adapt: (value: unknown) => PageAdapter<T>,
  ): Promise<PageCollection<T>> {
    const quarantined: unknown[] = [];
    let receivedRows = 0;
    let retrievedAtMs: number | null = null;
    const result = await collectCursorPages<T>({
      maxPages: this.maxPages,
      signal,
      fetchPage: async (pageToken) => {
        const response = await this.client.request(
          operation,
          { ...params, pageToken },
          (value) => adapt(value),
          { signal },
        );
        this.assertCurrent(session);
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
    context: { partition: PrivatePartition; previous?: AccountDataset<T>; base: AccountDataset<T> },
    collection: PageCollection<unknown>,
    data: T,
    counts: { accepted: number; duplicates?: number; conflicts?: number; unknown: number },
  ): AccountDataset<T> {
    if (collection.error && collection.pagesFetched === 0) {
      return this.failure(session, operation, params, period, context.previous, collection.error);
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
      this.storeCurrent(session, context.partition, operation, params, result);
    } catch (error) {
      return this.failure(session, operation, params, period, context.previous, error);
    }
    return result;
  }

  private async readOrders(
    session: VaultSessionInfo,
    params: AccountRequestParams,
    period: AccountPeriod,
    markets: Readonly<Record<string, FillMarket>>,
    signal?: AbortSignal,
  ): Promise<AccountDataset<OrdersData>> {
    const context = this.pagedBase<OrdersData>(session, "ordersHistory", params, period);
    try {
      const collection = await this.collectPages(session, "ordersHistory", params, signal, (value) => {
        const page = validateOrderHistoryResponse(value, markets);
        return { nextPageToken: page.nextPageToken, rows: page.orders, quarantined: page.quarantined };
      });
      return this.finishPaged(session, "ordersHistory", params, period, context, collection, {
        orders: collection.rows,
        quarantined: collection.quarantined,
      }, { accepted: collection.rows.length, unknown: collection.quarantined.length });
    } catch (error) {
      return this.failure(session, "ordersHistory", params, period, context.previous, error);
    }
  }

  private async readFills(
    session: VaultSessionInfo,
    params: AccountRequestParams,
    period: AccountPeriod,
    markets: Readonly<Record<string, FillMarket>>,
    signal?: AbortSignal,
  ): Promise<AccountDataset<FillsData>> {
    const context = this.pagedBase<FillsData>(session, "fills", params, period);
    try {
      const collection = await this.collectPages(session, "fills", params, signal, (value) => {
        const page = validateFillsResponse(value, {
          accountScope: JSON.stringify([session.entryId, params.subaccountId ?? "root"]),
          markets,
        });
        return { nextPageToken: page.nextPageToken, rows: page.fills, quarantined: page.quarantined };
      });
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
      const result = this.finishPaged(session, "fills", params, period, context, collection, {
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
      return this.failure(session, "fills", params, period, context.previous, error);
    }
  }

  private async readTransfers(
    session: VaultSessionInfo,
    params: AccountRequestParams,
    period: AccountPeriod | undefined,
    signal?: AbortSignal,
  ): Promise<AccountDataset<TransfersData>> {
    const context = this.pagedBase<TransfersData>(session, "transfers", params, period);
    try {
      const collection = await this.collectPages(session, "transfers", params, signal, (value) => {
        const page = validateTransfersResponse(value);
        return { nextPageToken: page.nextPageToken, rows: page.transfers, quarantined: page.quarantined };
      });
      const unknownReasons = collection.rows.filter((transfer) => !transfer.reasonKnown).length;
      return this.finishPaged(session, "transfers", params, period, context, collection, {
        // Unknown reasons remain visible; they are excluded only from accepted
        // coverage counts, never silently dropped from the activity rows.
        transfers: collection.rows,
        quarantined: collection.quarantined,
      }, {
        accepted: collection.rows.length - unknownReasons,
        unknown: collection.quarantined.length + unknownReasons,
      });
    } catch (error) {
      return this.failure(session, "transfers", params, period, context.previous, error);
    }
  }

  async loadAll(options: AccountDataLoadOptions = {}): Promise<AccountDataSnapshot> {
    const session = this.sessionOrThrow();
    const period = accountPeriodWindow(options.range ?? "30d", this.now());
    const markets = options.markets ?? {};
    const scope = options.subaccountId === undefined ? {} : { subaccountId: options.subaccountId };
    const paged = { ...scope, limit: 100 };
    const timeWindow = { startTime: period.startTime, endTime: period.endTime };
    const [balances, equity, orders, fills, transfers, feeRates] = await Promise.all([
      this.readSingle(session, "balances", scope, undefined, validateBalancesResponse, (data) => data.balances.length, options.signal),
      this.readSingle(session, "equityHistory", { ...scope, range: period.range, groupBy: "ASSET" }, period, (value) => {
        const response = validateEquityHistoryResponse(value);
        return {
          response,
          seriesMetrics: response.series.map((series) => sampledEquityMetrics(
            series.equity.map((equity, index) => ({ timestamp: String(index), equity })),
          )),
        };
      }, (data) => data.response.series.reduce((count, series) => count + series.equity.length, 0), options.signal),
      this.readOrders(session, { ...paged, ...timeWindow }, period, markets, options.signal),
      this.readFills(session, { ...paged, ...timeWindow }, period, markets, options.signal),
      this.readTransfers(session, paged, undefined, options.signal),
      this.readSingle(session, "feeRates", scope, undefined, validateFeeRatesResponse, (data) => data.feeRates.length, options.signal),
    ]);
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
