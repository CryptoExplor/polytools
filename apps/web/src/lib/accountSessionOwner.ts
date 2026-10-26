import { account } from "@poly/core";

type Coordinator = Pick<
  account.AccountDataCoordinator,
  | "loadAll"
  | "loadBalanceHistory"
  | "loadOpenOrders"
  | "loadOrderDetails"
  | "importCursorHistory"
  | "dispose"
>;

type CatalogFetcher = typeof account.fetchOfficialSpotCatalog;
type RangeLoadKey = "snapshot" | "balanceHistory" | "openOrders";

export const ACCOUNT_DATA_FRESHNESS_MS = 2 * 60 * 1000;

export interface AccountRangeState {
  snapshot: account.AccountDataSnapshot | null;
  balanceHistory: account.AccountDataset<account.BalanceHistoryData> | null;
  openOrders: account.AccountDataset<account.OpenOrdersData> | null;
  loading: boolean;
  balanceHistoryLoading: boolean;
  openOrdersLoading: boolean;
  lastAttemptAtMs: number | null;
  errors: Partial<Record<RangeLoadKey, account.SafeAccountError>>;
}

export interface AccountSessionOwnerState {
  /** Local vault generation and entry identity; neither is sent to the service. */
  sessionGeneration: string | null;
  sessionEntryId: string | null;
  range: account.AccountHistoryRange;
  activated: boolean;
  /** Private responses are partitioned by reporting range, only in memory. */
  periods: Partial<Record<account.AccountHistoryRange, AccountRangeState>>;
  catalogReady: boolean;
  markets: Readonly<Record<string, account.FillMarket>>;
  catalogError: account.SafeAccountError | null;
}

export interface AccountSessionIdentity {
  generation: string;
  entryId: string;
}

export interface AccountSessionOwnerOptions {
  vault: account.AccountVault;
  coordinator?: Coordinator;
  fetchCatalog?: CatalogFetcher;
  now?: () => number;
}

export interface AccountSessionLoadOptions {
  /** true only for the explicit first activation/manual refresh control */
  explicit: boolean;
  secureContext: boolean;
  range?: account.AccountHistoryRange;
}

interface InFlightLoad {
  key: string;
  range: account.AccountHistoryRange;
  generation: string;
  entryId: string;
  controller: AbortController;
  promise: Promise<void>;
}

const SESSION_BOUNDARIES = new Set(["LOCK", "WIPE", "VAULT_CHANGED", "IMPORT", "UNLOCK"]);

function emptyRangeState(): AccountRangeState {
  return {
    snapshot: null,
    balanceHistory: null,
    openOrders: null,
    loading: false,
    balanceHistoryLoading: false,
    openOrdersLoading: false,
    lastAttemptAtMs: null,
    errors: {},
  };
}

function emptyState(
  session: account.VaultSessionInfo | null,
  range: account.AccountHistoryRange = "30d",
): AccountSessionOwnerState {
  return {
    sessionGeneration: session?.generation ?? null,
    sessionEntryId: session?.entryId ?? null,
    range,
    activated: false,
    periods: {},
    catalogReady: false,
    markets: {},
    catalogError: null,
  };
}

function getRangeDatasets(period: AccountRangeState): Array<account.AccountDataset<unknown> | null> {
  return [
    ...(period.snapshot
      ? [
          period.snapshot.balances,
          period.snapshot.equity,
          period.snapshot.orders,
          period.snapshot.fills,
          period.snapshot.transfers,
          period.snapshot.feeRates,
        ]
      : [null]),
    period.balanceHistory,
    period.openOrders,
  ];
}

/**
 * One observable, session-memory-only owner for all private Account views.
 * It owns the coordinator, keeps per-range snapshots, and single-flights the
 * broad consented read bundle. Nothing private is written to durable storage.
 */
export class AccountSessionOwner {
  readonly coordinator: Coordinator;
  private readonly vault: account.AccountVault;
  private readonly fetchCatalog: CatalogFetcher;
  private readonly now: () => number;
  private readonly listeners = new Set<() => void>();
  private readonly unbindVault: () => void;
  private state: AccountSessionOwnerState;
  private inFlight: InFlightLoad | null = null;
  private active = false;
  private disposed = false;

  constructor(options: AccountSessionOwnerOptions) {
    this.vault = options.vault;
    this.coordinator = options.coordinator ?? new account.AccountDataCoordinator({ vault: options.vault });
    this.fetchCatalog = options.fetchCatalog ?? account.fetchOfficialSpotCatalog;
    this.now = options.now ?? Date.now;
    this.state = emptyState(this.vault.getSessionInfo());
    this.unbindVault = this.vault.subscribe((event) => {
      if (SESSION_BOUNDARIES.has(event.type.toUpperCase())) this.clearForVaultBoundary();
    });
  }

  /** Stable subscribe/getSnapshot functions for React's useSyncExternalStore. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): AccountSessionOwnerState => this.state;

  setActive(active: boolean): void {
    if (this.disposed || this.active === active) return;
    this.active = active;
    // Leaving private Account views prevents further private work. Completed
    // datasets remain in memory for reuse if the user returns before locking.
    if (!active) this.cancelLoad();
  }

  /** Select a tab-local reporting window without discarding other cached ranges. */
  setRange(range: account.AccountHistoryRange): void {
    if (this.disposed || this.state.range === range) return;
    this.publish({ ...this.state, range });
  }

  getRangeState(range: account.AccountHistoryRange = this.state.range): AccountRangeState {
    return this.state.periods[range] ?? emptyRangeState();
  }

  /**
   * Data is considered stale when any successful dataset is over two minutes
   * old, or an incomplete range has gone two minutes without an attempt.
   */
  isRangeStale(range: account.AccountHistoryRange = this.state.range, atMs = this.now()): boolean {
    const period = this.state.periods[range];
    if (!period) return true;
    const datasets = getRangeDatasets(period);
    const timestamps = datasets
      .filter((dataset): dataset is account.AccountDataset<unknown> => dataset !== null)
      .map((dataset) => dataset.retrievedAtMs)
      .filter((timestamp): timestamp is number => timestamp !== null && Number.isFinite(timestamp));
    const hasAllDatasets = datasets.length === 8 && datasets.every(
      (dataset) => dataset !== null && dataset.retrievedAtMs !== null,
    );
    const anyOldDataset = timestamps.some((timestamp) => atMs - timestamp > ACCOUNT_DATA_FRESHNESS_MS);
    if (anyOldDataset) return true;
    if (hasAllDatasets) return false;
    return period.lastAttemptAtMs === null || atMs - period.lastAttemptAtMs > ACCOUNT_DATA_FRESHNESS_MS;
  }

  /** Explicit consent is required before visibility refresh can do any work. */
  refreshIfActivated(secureContext: boolean): Promise<void> {
    const range = this.state.range;
    if (!this.state.activated || !this.shouldRefreshOnVisibility(range)) return Promise.resolve();
    return this.load({ explicit: false, secureContext, range });
  }

  /**
   * Load the official catalog and existing read-only dataset bundle.
   * Concurrent manual/visibility callers for one session+range receive the
   * same in-flight promise. Manual calls use explicit=true and bypass age gates.
   */
  load(options: AccountSessionLoadOptions): Promise<void> {
    if (this.disposed || !this.active || !options.secureContext) return Promise.resolve();
    const session = this.vault.getSessionInfo();
    if (!session || !session.registeredKeyId) return Promise.resolve();
    if (!options.explicit && !this.state.activated) return Promise.resolve();

    const range = options.range ?? this.state.range;
    const key = `${session.generation}:${session.entryId}:${range}`;
    if (this.inFlight?.key === key && !this.inFlight.controller.signal.aborted) {
      return this.inFlight.promise;
    }
    if (!options.explicit && !this.shouldRefreshOnVisibility(range)) return Promise.resolve();
    this.cancelLoad();

    const controller = new AbortController();
    const request: InFlightLoad = {
      key,
      range,
      generation: session.generation,
      entryId: session.entryId,
      controller,
      promise: Promise.resolve(),
    };
    request.promise = Promise.resolve().then(() => this.performLoad(request, session));
    this.inFlight = request;
    const currentPeriod = this.getRangeState(range);
    const nextPeriod: AccountRangeState = {
      ...currentPeriod,
      loading: true,
      balanceHistoryLoading: true,
      openOrdersLoading: true,
      lastAttemptAtMs: this.now(),
      errors: {},
    };
    this.updateRange(range, nextPeriod);
    this.publish({
      ...this.state,
      activated: this.state.activated || options.explicit,
      catalogError: null,
    });
    return request.promise;
  }

  captureSessionIdentity(): AccountSessionIdentity | null {
    const session = this.vault.getSessionInfo();
    if (!session) return null;
    return { generation: session.generation, entryId: session.entryId };
  }

  isSessionIdentityCurrent(identity: AccountSessionIdentity): boolean {
    const current = this.vault.getSessionInfo();
    return Boolean(
      !this.disposed &&
      this.active &&
      current &&
      current.generation === identity.generation &&
      current.entryId === identity.entryId &&
      this.state.sessionGeneration === identity.generation &&
      this.state.sessionEntryId === identity.entryId,
    );
  }

  /** Merge cursor results only into the exact vault session and range they came from. */
  mergeImportedHistory(
    identity: AccountSessionIdentity,
    period: account.AccountPeriod,
    result: account.AccountHistoryImportResult,
  ): boolean {
    const current = this.state.periods[period.range];
    if (
      !this.isSessionIdentityCurrent(identity) ||
      !current?.snapshot ||
      current.snapshot.period.startTime !== period.startTime ||
      current.snapshot.period.endTime !== period.endTime
    ) return false;
    this.updateRange(period.range, {
      ...current,
      snapshot: {
        ...current.snapshot,
        ...(result.orders ? { orders: result.orders } : {}),
        ...(result.fills ? { fills: result.fills } : {}),
        ...(result.transfers ? { transfers: result.transfers } : {}),
      },
    });
    return true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancelLoad();
    this.disposed = true;
    this.unbindVault();
    this.coordinator.dispose();
    this.state = emptyState(null, this.state.range);
    this.listeners.clear();
  }

  private shouldRefreshOnVisibility(range: account.AccountHistoryRange): boolean {
    if (this.inFlight?.range === range && !this.inFlight.controller.signal.aborted) return false;
    if (!this.isRangeStale(range)) return false;
    const lastAttemptAtMs = this.state.periods[range]?.lastAttemptAtMs;
    return lastAttemptAtMs === null || lastAttemptAtMs === undefined || this.now() - lastAttemptAtMs > ACCOUNT_DATA_FRESHNESS_MS;
  }

  private async performLoad(
    request: InFlightLoad,
    session: account.VaultSessionInfo,
  ): Promise<void> {
    let stage: "catalog" | "datasets" = "catalog";
    try {
      const catalog = await this.fetchCatalog({ signal: request.controller.signal });
      if (!this.isCurrent(request)) return;

      // Use the unsigned official catalog's clock only as the signing offset.
      const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
      const skewMs = BigInt(catalog.tsSec) * 1_000n - BigInt(catalog.retrievedAtMs);
      if (skewMs > maxSafe || skewMs < -maxSafe) {
        throw new Error("The official catalog clock offset is outside the supported range.");
      }
      this.vault.setClockSkew(Number(skewMs));
      this.publish({ ...this.state, catalogReady: true, catalogError: null, markets: catalog.markets });

      stage = "datasets";
      const options = {
        range: request.range,
        markets: catalog.markets,
        signal: request.controller.signal,
      };
      const tasks = [
        Promise.resolve().then(() => this.coordinator.loadAll(options)),
        Promise.resolve().then(() => this.coordinator.loadBalanceHistory(options)),
        Promise.resolve().then(() => this.coordinator.loadOpenOrders(options)),
      ] as const;
      const results = await Promise.allSettled(tasks);
      if (!this.isCurrent(request)) return;

      const current = this.getRangeState(request.range);
      const errors = { ...current.errors };
      const [snapshotResult, balanceHistoryResult, openOrdersResult] = results;
      let snapshot = current.snapshot;
      let balanceHistory = current.balanceHistory;
      let openOrders = current.openOrders;
      if (snapshotResult.status === "fulfilled") {
        snapshot = snapshotResult.value;
        delete errors.snapshot;
      } else {
        errors.snapshot = account.safeAccountError(snapshotResult.reason);
      }
      if (balanceHistoryResult.status === "fulfilled") {
        balanceHistory = balanceHistoryResult.value;
        delete errors.balanceHistory;
      } else {
        errors.balanceHistory = account.safeAccountError(balanceHistoryResult.reason);
      }
      if (openOrdersResult.status === "fulfilled") {
        openOrders = openOrdersResult.value;
        delete errors.openOrders;
      } else {
        errors.openOrders = account.safeAccountError(openOrdersResult.reason);
      }
      this.updateRange(request.range, {
        ...current,
        snapshot,
        balanceHistory,
        openOrders,
        errors,
      });
    } catch (error) {
      if (this.isCurrent(request)) {
        if (stage === "catalog") {
          this.publish({ ...this.state, catalogError: account.safeAccountError(error) });
        } else {
          const current = this.getRangeState(request.range);
          this.updateRange(request.range, {
            ...current,
            errors: { ...current.errors, snapshot: account.safeAccountError(error) },
          });
        }
      }
    } finally {
      if (this.isCurrent(request)) {
        this.inFlight = null;
        const current = this.getRangeState(request.range);
        this.updateRange(request.range, {
          ...current,
          loading: false,
          balanceHistoryLoading: false,
          openOrdersLoading: false,
        });
      }
    }
  }

  private isCurrent(request: InFlightLoad): boolean {
    const current = this.vault.getSessionInfo();
    return Boolean(
      !this.disposed &&
      this.active &&
      this.inFlight === request &&
      !request.controller.signal.aborted &&
      current &&
      current.generation === request.generation &&
      current.entryId === request.entryId &&
      this.state.sessionGeneration === request.generation &&
      this.state.sessionEntryId === request.entryId,
    );
  }

  private cancelLoad(): void {
    const request = this.inFlight;
    if (!request) return;
    this.inFlight = null;
    request.controller.abort();
    if (!this.disposed) {
      const current = this.getRangeState(request.range);
      const hasRetrievedData = getRangeDatasets(current).some(
        (dataset) => dataset !== null && dataset.retrievedAtMs !== null,
      );
      this.updateRange(request.range, {
        ...current,
        loading: false,
        balanceHistoryLoading: false,
        openOrdersLoading: false,
        lastAttemptAtMs: hasRetrievedData ? current.lastAttemptAtMs : null,
      });
    }
  }

  private clearForVaultBoundary(): void {
    this.cancelLoad();
    this.publish(emptyState(this.vault.getSessionInfo(), this.state.range));
  }

  private updateRange(range: account.AccountHistoryRange, next: AccountRangeState): void {
    this.publish({
      ...this.state,
      periods: { ...this.state.periods, [range]: next },
    });
  }

  private publish(next: AccountSessionOwnerState): void {
    if (this.disposed) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}
