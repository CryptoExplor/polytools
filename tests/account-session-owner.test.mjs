import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";

const rootDir = new URL("..", import.meta.url).pathname;
const BASE_NOW = 1_700_000_000_000;
let vite;
let AccountSessionOwner;
let ACCOUNT_DATA_FRESHNESS_MS;

before(async () => {
  vite = await createServer({ root: rootDir, logLevel: "silent", server: { middlewareMode: true } });
  ({ AccountSessionOwner, ACCOUNT_DATA_FRESHNESS_MS } = await vite.ssrLoadModule("/apps/web/src/lib/accountSessionOwner.ts"));
});

after(async () => {
  if (vite) await vite.close();
});

function connectedSession(overrides = {}) {
  return {
    generation: "generation-one",
    entryId: "entry-one",
    registeredKeyId: "ak_synthetic",
    signal: new AbortController().signal,
    ...overrides,
  };
}

function fakeVault(initialSession = connectedSession()) {
  let session = initialSession;
  const listeners = new Set();
  return {
    getSessionInfo: () => session,
    setClockSkew(value) { this.clockSkew = value; },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(type, nextSession = session) {
      session = nextSession;
      for (const listener of [...listeners]) listener({ type });
    },
  };
}

function dataSet(label, retrievedAtMs = BASE_NOW) {
  return { data: { label }, coverage: { status: "complete" }, retrievedAtMs };
}

function snapshot(label = "broad bundle", range = "30d", retrievedAtMs = BASE_NOW) {
  return {
    period: {
      range,
      startTime: "2026-01-01T00:00:00.000Z",
      endTime: "2026-01-31T00:00:00.000Z",
    },
    scopeLabel: "Synthetic account",
    balances: dataSet(`${label}:balances`, retrievedAtMs),
    equity: dataSet(`${label}:equity`, retrievedAtMs),
    orders: dataSet(`${label}:orders`, retrievedAtMs),
    fills: dataSet(`${label}:fills`, retrievedAtMs),
    transfers: dataSet(`${label}:transfers`, retrievedAtMs),
    feeRates: dataSet(`${label}:fee-rates`, retrievedAtMs),
  };
}

function fakeCoordinator(overrides = {}, getNow = () => BASE_NOW) {
  const calls = { loadAll: 0, loadBalanceHistory: 0, loadOpenOrders: 0, dispose: 0, ranges: [] };
  const coordinator = {
    async loadAll(options = {}) {
      calls.loadAll += 1;
      calls.ranges.push(options.range ?? "30d");
      const range = options.range ?? "30d";
      return snapshot(`broad bundle ${range}`, range, getNow());
    },
    async loadBalanceHistory() { calls.loadBalanceHistory += 1; return dataSet("balance history", getNow()); },
    async loadOpenOrders() { calls.loadOpenOrders += 1; return dataSet("open orders", getNow()); },
    async loadOrderDetails() { return dataSet("order details", getNow()); },
    async importCursorHistory() { return {}; },
    dispose() { calls.dispose += 1; },
    ...overrides,
  };
  return { coordinator, calls };
}

function fakeCatalog(now = BASE_NOW) {
  return {
    tsSec: String(Math.floor(now / 1000)),
    retrievedAtMs: now,
    markets: { "1": { baseAsset: "BTC", quoteAsset: "USDT", marketSymbol: "BTC-USDT" } },
  };
}

describe("Portfolio-owned account session store", () => {
  it("does no read while inactive, locked, missing a key ID, or before explicit consent", async () => {
    let catalogCalls = 0;
    const { coordinator, calls } = fakeCoordinator();
    const vault = fakeVault(null);
    const owner = new AccountSessionOwner({
      vault,
      coordinator,
      fetchCatalog: async () => { catalogCalls += 1; return fakeCatalog(); },
    });
    try {
      await owner.load({ explicit: true, secureContext: true });
      owner.setActive(true);
      await owner.load({ explicit: true, secureContext: true });
      assert.equal(catalogCalls, 0, "locked vault must not start even the catalog read");

      vault.emit("UNLOCK", connectedSession({ registeredKeyId: "" }));
      await owner.refreshIfActivated(true);
      await owner.load({ explicit: false, secureContext: true });
      assert.equal(catalogCalls, 0, "missing server key ID cannot trigger private reads");

      vault.emit("VAULT_CHANGED", connectedSession());
      await owner.refreshIfActivated(true);
      assert.equal(catalogCalls, 0, "visibility cannot replace explicit first-read consent");

      await owner.load({ explicit: true, secureContext: true });
      assert.equal(catalogCalls, 1);
      assert.deepEqual(calls, { loadAll: 1, loadBalanceHistory: 1, loadOpenOrders: 1, dispose: 0, ranges: ["30d"] });
      assert.equal(owner.getSnapshot().periods["30d"].snapshot.balances.data.label, "broad bundle 30d:balances");
    } finally {
      owner.dispose();
    }
  });

  it("is observable and single-flights concurrent broad loads while isolating a dataset error", async () => {
    const { coordinator, calls } = fakeCoordinator({
      async loadBalanceHistory() {
        calls.loadBalanceHistory += 1;
        throw new Error("synthetic history failure");
      },
    });
    let catalogCalls = 0;
    const vault = fakeVault();
    const owner = new AccountSessionOwner({
      vault,
      coordinator,
      fetchCatalog: async ({ signal }) => {
        catalogCalls += 1;
        assert.equal(signal.aborted, false);
        return fakeCatalog();
      },
    });
    const observedLoading = [];
    const unsubscribe = owner.subscribe(() => observedLoading.push(owner.getRangeState("30d").loading));
    try {
      owner.setActive(true);
      const first = owner.load({ explicit: true, secureContext: true, range: "30d" });
      const second = owner.load({ explicit: false, secureContext: true, range: "30d" });
      assert.equal(first, second, "concurrent lifecycle/manual triggers share the exact in-flight promise");
      await Promise.all([first, second]);

      const state = owner.getRangeState("30d");
      assert.equal(catalogCalls, 1);
      assert.deepEqual(calls, { loadAll: 1, loadBalanceHistory: 1, loadOpenOrders: 1, dispose: 0, ranges: ["30d"] });
      assert.equal(owner.getSnapshot().activated, true);
      assert.equal(state.snapshot.balances.data.label, "broad bundle 30d:balances");
      assert.equal(state.balanceHistory, null, "failed dataset is not fabricated");
      assert.equal(state.openOrders.data.label, "open orders", "other successful dataset is preserved");
      assert.equal(state.errors.balanceHistory.code, "NETWORK", "the failure belongs to balance history");
      assert.equal(state.errors.snapshot, undefined, "a successful snapshot is not marked failed");
      assert.equal(owner.getSnapshot().catalogError, null);
      assert.ok(observedLoading.includes(true));
      assert.equal(observedLoading.at(-1), false);
      assert.equal(vault.clockSkew, 0);
    } finally {
      unsubscribe();
      owner.dispose();
    }
    assert.equal(calls.dispose, 1);
  });

  it("refreshes on visibility only after two minutes, while manual refresh bypasses the threshold", async () => {
    let now = BASE_NOW;
    const { coordinator, calls } = fakeCoordinator({}, () => now);
    const owner = new AccountSessionOwner({
      vault: fakeVault(),
      coordinator,
      now: () => now,
      fetchCatalog: async () => fakeCatalog(now),
    });
    try {
      owner.setActive(true);
      await owner.load({ explicit: true, secureContext: true, range: "30d" });
      assert.equal(owner.isRangeStale("30d"), false);
      assert.equal(calls.loadAll, 1);

      owner.setActive(false);
      owner.setActive(true);
      await owner.refreshIfActivated(true);
      assert.equal(calls.loadAll, 1, "re-entering a private view reuses fresh shared data");

      now += ACCOUNT_DATA_FRESHNESS_MS;
      await owner.refreshIfActivated(true);
      assert.equal(calls.loadAll, 1, "exactly two minutes is not older than two minutes");

      now += 1;
      assert.equal(owner.isRangeStale("30d"), true);
      await owner.refreshIfActivated(true);
      assert.equal(calls.loadAll, 2, "a stale visible range refreshes once");
      assert.equal(owner.isRangeStale("30d"), false);

      now += 1_000;
      await owner.load({ explicit: true, secureContext: true, range: "30d" });
      assert.equal(calls.loadAll, 3, "manual refresh bypasses the age threshold");
    } finally {
      owner.dispose();
    }
  });

  it("holds visibility refresh off while a cursor import is paging", async () => {
    let now = BASE_NOW;
    const { coordinator, calls } = fakeCoordinator({}, () => now);
    const owner = new AccountSessionOwner({
      vault: fakeVault(),
      coordinator,
      now: () => now,
      fetchCatalog: async () => fakeCatalog(now),
    });
    try {
      owner.setActive(true);
      await owner.load({ explicit: true, secureContext: true, range: "30d" });
      assert.equal(calls.loadAll, 1);
      const periodBefore = owner.getSnapshot().periods["30d"].snapshot.period;

      // Data goes stale mid-import; without a hold this publishes a new
      // period.endTime and the import's merge is then rejected.
      now += ACCOUNT_DATA_FRESHNESS_MS + 1;
      assert.equal(owner.isRangeStale("30d"), true);

      owner.beginHistoryImport();
      await owner.refreshIfActivated(true);
      assert.equal(calls.loadAll, 1, "visibility must not load during an import");
      assert.deepEqual(
        owner.getSnapshot().periods["30d"].snapshot.period,
        periodBefore,
        "the snapshot the import will merge into must survive",
      );

      // Manual refresh is an explicit user action and still runs.
      await owner.load({ explicit: true, secureContext: true, range: "30d" });
      assert.equal(calls.loadAll, 2, "an explicit refresh is not held off");

      owner.endHistoryImport();
      now += ACCOUNT_DATA_FRESHNESS_MS + 1;
      await owner.refreshIfActivated(true);
      assert.equal(calls.loadAll, 3, "visibility refresh resumes after the import");
    } finally {
      owner.dispose();
    }
  });

  it("releases the import hold when an import ends or the owner is disposed", async () => {
    let now = BASE_NOW;
    const { coordinator, calls } = fakeCoordinator({}, () => now);
    const owner = new AccountSessionOwner({
      vault: fakeVault(),
      coordinator,
      now: () => now,
      fetchCatalog: async () => fakeCatalog(now),
    });
    try {
      owner.setActive(true);
      await owner.load({ explicit: true, secureContext: true, range: "30d" });

      // Nested holds must not leak a permanent block.
      owner.beginHistoryImport();
      owner.beginHistoryImport();
      owner.endHistoryImport();
      now += ACCOUNT_DATA_FRESHNESS_MS + 1;
      await owner.refreshIfActivated(true);
      assert.equal(calls.loadAll, 1, "one remaining hold still blocks visibility refresh");

      owner.endHistoryImport();
      owner.endHistoryImport(); // extra calls are harmless
      await owner.refreshIfActivated(true);
      assert.equal(calls.loadAll, 2, "the hold is released exactly once per begin");
    } finally {
      owner.dispose();
    }
  });

  it("reports a dropped merge when the snapshot period moved during the import", async () => {
    const { coordinator } = fakeCoordinator({});
    const owner = new AccountSessionOwner({
      vault: fakeVault(),
      coordinator,
      now: () => BASE_NOW,
      fetchCatalog: async () => fakeCatalog(BASE_NOW),
    });
    try {
      owner.setActive(true);
      await owner.load({ explicit: true, secureContext: true, range: "30d" });
      const snapshotPeriod = owner.getSnapshot().periods["30d"].snapshot.period;
      const identity = owner.captureSessionIdentity();
      assert.ok(identity, "an unlocked session has an identity");

      // The period captured when the import started no longer matches.
      const movedPeriod = { ...snapshotPeriod, endTime: new Date(BASE_NOW + 1000).toISOString() };
      assert.equal(
        owner.mergeImportedHistory(identity, movedPeriod, { period: movedPeriod }),
        false,
        "a moved period must be reported, not silently merged",
      );
      assert.equal(
        owner.mergeImportedHistory(identity, snapshotPeriod, { period: snapshotPeriod }),
        true,
        "the matching period still merges",
      );
    } finally {
      owner.dispose();
    }
  });

  it("keeps reporting-period caches separate and restores prior ranges without refetching", async () => {
    const { coordinator, calls } = fakeCoordinator();
    const owner = new AccountSessionOwner({ vault: fakeVault(), coordinator, fetchCatalog: async () => fakeCatalog() });
    try {
      owner.setActive(true);
      await owner.load({ explicit: true, secureContext: true, range: "30d" });
      owner.setRange("7d");
      assert.equal(owner.getSnapshot().range, "7d");
      assert.equal(owner.getRangeState("7d").snapshot, null);
      await owner.load({ explicit: true, secureContext: true, range: "7d" });
      assert.deepEqual(calls.ranges, ["30d", "7d"]);

      owner.setRange("30d");
      assert.equal(owner.getRangeState("30d").snapshot.period.range, "30d");
      assert.equal(owner.getRangeState("30d").snapshot.balances.data.label, "broad bundle 30d:balances");
      assert.equal(owner.getRangeState("7d").snapshot.period.range, "7d");
      assert.equal(calls.loadAll, 2, "selecting a cached period does not initiate a new request");
    } finally {
      owner.dispose();
    }
  });

  it("retries an aborted initial load after re-entry and clears every period on lock", async () => {
    let now = BASE_NOW;
    let catalogSignal;
    let catalogCalls = 0;
    const { coordinator, calls } = fakeCoordinator({}, () => now);
    const vault = fakeVault();
    const owner = new AccountSessionOwner({
      vault,
      coordinator,
      now: () => now,
      fetchCatalog: ({ signal }) => {
        catalogCalls += 1;
        if (catalogCalls > 1) return Promise.resolve(fakeCatalog(now));
        catalogSignal = signal;
        return new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
          setTimeout(() => resolve(fakeCatalog(now)), 100);
        });
      },
    });
    try {
      owner.setActive(true);
      const pending = owner.load({ explicit: true, secureContext: true });
      await new Promise((resolve) => setImmediate(resolve));
      owner.setActive(false);
      assert.equal(catalogSignal.aborted, true);
      await pending;
      assert.equal(calls.loadAll, 0, "no private dataset starts after the view becomes inactive");

      now += ACCOUNT_DATA_FRESHNESS_MS + 1;
      owner.setActive(true);
      await owner.refreshIfActivated(true);
      assert.equal(catalogCalls, 2, "an aborted first attempt with no response is retried on re-entry");
      assert.equal(owner.getRangeState("30d").snapshot.balances.data.label, "broad bundle 30d:balances");

      vault.emit("LOCK", null);
      const state = owner.getSnapshot();
      assert.equal(state.activated, false);
      assert.deepEqual(state.periods, {});
      assert.equal(state.sessionGeneration, null);
      assert.equal(state.sessionEntryId, null);
    } finally {
      owner.dispose();
    }
  });

  it("discards late main-load and cursor-merge results after account identity changes", async () => {
    let resolveOldSnapshot;
    let loadAllCalls = 0;
    const oldSnapshotPromise = new Promise((resolve) => { resolveOldSnapshot = resolve; });
    const { coordinator, calls } = fakeCoordinator({
      async loadAll(options = {}) {
        loadAllCalls += 1;
        calls.loadAll += 1;
        calls.ranges.push(options.range ?? "30d");
        if (loadAllCalls === 1) return oldSnapshotPromise;
        return snapshot("account two", options.range ?? "30d");
      },
    });
    const vault = fakeVault(connectedSession());
    const owner = new AccountSessionOwner({ vault, coordinator, fetchCatalog: async () => fakeCatalog() });
    try {
      owner.setActive(true);
      const oldIdentity = owner.captureSessionIdentity();
      const oldLoad = owner.load({ explicit: true, secureContext: true, range: "30d" });
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(loadAllCalls, 1);

      vault.emit("VAULT_CHANGED", connectedSession({ generation: "generation-two", entryId: "entry-two" }));
      assert.equal(owner.getSnapshot().activated, false);
      assert.deepEqual(owner.getSnapshot().periods, {});

      const newIdentity = owner.captureSessionIdentity();
      assert.ok(newIdentity);
      await owner.load({ explicit: true, secureContext: true, range: "30d" });
      const newPeriod = owner.getRangeState("30d").snapshot.period;
      assert.equal(owner.getRangeState("30d").snapshot.balances.data.label, "account two:balances");

      const staleImport = {
        period: newPeriod,
        fills: dataSet("old account imported fills"),
      };
      assert.equal(owner.mergeImportedHistory(oldIdentity, newPeriod, staleImport), false);
      assert.equal(owner.getRangeState("30d").snapshot.fills.data.label, "account two:fills");

      resolveOldSnapshot(snapshot("account one", "30d"));
      await oldLoad;
      assert.equal(owner.getSnapshot().sessionGeneration, "generation-two");
      assert.equal(owner.getRangeState("30d").snapshot.balances.data.label, "account two:balances");
      assert.equal(owner.getRangeState("30d").snapshot.fills.data.label, "account two:fills");
    } finally {
      owner.dispose();
    }
  });
});
