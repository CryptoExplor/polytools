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

export interface AccountSessionOwnerState {
  /** Local vault generation only; never sent to the service. */
  sessionGeneration: string | null;
  range: account.AccountHistoryRange;
  activated: boolean;
  snapshot: account.AccountDataSnapshot | null;
  balanceHistory: account.AccountDataset<account.BalanceHistoryData> | null;
  openOrders: account.AccountDataset<account.OpenOrdersData> | null;
  loading: boolean;
  balanceHistoryLoading: boolean;
  openOrdersLoading: boolean;
  catalogReady: boolean;
  markets: Readonly<Record<string, account.FillMarket>>;
  error: account.SafeAccountError | null;
}

export interface AccountSessionOwnerOptions {
  vault: account.AccountVault;
  coordinator?: Coordinator;
  fetchCatalog?: CatalogFetcher;
}

export interface AccountSessionLoadOptions {
  explicit: boolean;
  secureContext: boolean;
}

interface InFlightLoad {
  key: string;
  generation: string;
  entryId: string;
  controller: AbortController;
  promise: Promise<void>;
}

const SESSION_BOUNDARIES = new Set(["LOCK", "WIPE", "VAULT_CHANGED", "IMPORT", "UNLOCK"]);

function emptyState(
  sessionGeneration: string | null,
  range: account.AccountHistoryRange = "30d",
): AccountSessionOwnerState {
  return {
    sessionGeneration,
    range,
    activated: false,
    snapshot: null,
    balanceHistory: null,
    openOrders: null,
    loading: false,
    balanceHistoryLoading: false,
    openOrdersLoading: false,
    catalogReady: false,
    markets: {},
    error: null,
  };
}

/**
 * One observable, session-memory-only owner for all private Account views.
 * It owns the coordinator and single-flights the broad consented read bundle.
 */
export class AccountSessionOwner {
  readonly coordinator: Coordinator;
  private readonly vault: account.AccountVault;
  private readonly fetchCatalog: CatalogFetcher;
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
    this.state = emptyState(this.vault.getSessionInfo()?.generation ?? null);
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

  /** Change the shared reporting window without ever showing rows under a new label. */
  setRange(range: account.AccountHistoryRange): void {
    if (this.disposed || this.state.range === range) return;
    this.cancelLoad();
    this.publish({
      ...this.state,
      range,
      snapshot: null,
      balanceHistory: null,
      openOrders: null,
      loading: false,
      balanceHistoryLoading: false,
      openOrdersLoading: false,
      error: null,
    });
  }

  /** Explicit consent is required before visibility refresh can do any work. */
  refreshIfActivated(secureContext: boolean): Promise<void> {
    if (!this.state.activated) return Promise.resolve();
    return this.load({ explicit: false, secureContext });
  }

  /**
   * Load the official catalog and the existing read-only dataset bundle.
   * Concurrent manual/visibility callers for one session+range receive the
   * same in-flight promise rather than starting duplicate requests.
   */
  load(options: AccountSessionLoadOptions): Promise<void> {
    if (this.disposed || !this.active || !options.secureContext) return Promise.resolve();
    const session = this.vault.getSessionInfo();
    if (!session || !session.registeredKeyId) return Promise.resolve();
    if (!options.explicit && !this.state.activated) return Promise.resolve();

    const key = `${session.generation}:${this.state.range}`;
    if (this.inFlight?.key === key && !this.inFlight.controller.signal.aborted) {
      return this.inFlight.promise;
    }
    this.cancelLoad();

    const controller = new AbortController();
    const request: InFlightLoad = {
      key,
      generation: session.generation,
      entryId: session.entryId,
      controller,
      promise: Promise.resolve(),
    };
    request.promise = Promise.resolve().then(() => this.performLoad(request, session));
    this.inFlight = request;
    this.publish({
      ...this.state,
      activated: this.state.activated || options.explicit,
      loading: true,
      balanceHistoryLoading: true,
      openOrdersLoading: true,
      error: null,
    });
    return request.promise;
  }

  /** Merge validated cursor-import results into the currently selected window. */
  mergeImportedHistory(
    period: account.AccountPeriod,
    result: account.AccountHistoryImportResult,
  ): void {
    const current = this.state.snapshot;
    if (
      this.disposed ||
      !current ||
      current.period.startTime !== period.startTime ||
      current.period.endTime !== period.endTime
    ) return;
    this.publish({
      ...this.state,
      snapshot: {
        ...current,
        ...(result.orders ? { orders: result.orders } : {}),
        ...(result.fills ? { fills: result.fills } : {}),
        ...(result.transfers ? { transfers: result.transfers } : {}),
      },
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelLoad();
    this.unbindVault();
    this.coordinator.dispose();
    this.state = emptyState(null, this.state.range);
    this.listeners.clear();
  }

  private async performLoad(
    request: InFlightLoad,
    session: account.VaultSessionInfo,
  ): Promise<void> {
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
      this.publish({ ...this.state, catalogReady: true, markets: catalog.markets });

      const options = {
        range: this.state.range,
        markets: catalog.markets,
        signal: request.controller.signal,
      };
      const tasks: Promise<void>[] = [
        Promise.resolve().then(() => this.coordinator.loadAll(options)).then((snapshot) => {
          if (this.isCurrent(request)) this.publish({ ...this.state, snapshot });
        }),
        Promise.resolve().then(() => this.coordinator.loadBalanceHistory(options)).then((balanceHistory) => {
          if (this.isCurrent(request)) this.publish({ ...this.state, balanceHistory });
        }),
        Promise.resolve().then(() => this.coordinator.loadOpenOrders(options)).then((openOrders) => {
          if (this.isCurrent(request)) this.publish({ ...this.state, openOrders });
        }),
      ];
      const results = await Promise.allSettled(tasks);
      if (!this.isCurrent(request)) return;
      const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (rejected) this.publish({ ...this.state, error: account.safeAccountError(rejected.reason) });
    } catch (error) {
      if (this.isCurrent(request)) {
        this.publish({ ...this.state, error: account.safeAccountError(error) });
      }
    } finally {
      if (this.isCurrent(request)) {
        this.inFlight = null;
        this.publish({
          ...this.state,
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
      current.entryId === request.entryId,
    );
  }

  private cancelLoad(): void {
    const request = this.inFlight;
    if (!request) return;
    this.inFlight = null;
    request.controller.abort();
    if (!this.disposed) {
      this.publish({
        ...this.state,
        loading: false,
        balanceHistoryLoading: false,
        openOrdersLoading: false,
      });
    }
  }

  private clearForVaultBoundary(): void {
    this.cancelLoad();
    this.publish(emptyState(this.vault.getSessionInfo()?.generation ?? null, this.state.range));
  }

  private publish(next: AccountSessionOwnerState): void {
    if (this.disposed) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}
