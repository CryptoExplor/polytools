import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";

const rootDir = new URL("..", import.meta.url).pathname;
let vite;
let AccountSessionOwner;

before(async () => {
  vite = await createServer({ root: rootDir, logLevel: "silent", server: { middlewareMode: true } });
  ({ AccountSessionOwner } = await vite.ssrLoadModule("/apps/web/src/lib/accountSessionOwner.ts"));
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

function dataSet(label) {
  return { data: { label }, coverage: { status: "complete" }, retrievedAtMs: 1_700_000_000_000 };
}

function snapshot(label = "broad bundle") {
  return {
    period: { range: "30d", startTime: "2026-01-01T00:00:00.000Z", endTime: "2026-01-31T00:00:00.000Z" },
    scopeLabel: "Synthetic account",
    balances: dataSet(`${label}:balances`),
    equity: dataSet(`${label}:equity`),
    orders: dataSet(`${label}:orders`),
    fills: dataSet(`${label}:fills`),
    transfers: dataSet(`${label}:transfers`),
    feeRates: dataSet(`${label}:fee-rates`),
  };
}

function fakeCoordinator(overrides = {}) {
  const calls = { loadAll: 0, loadBalanceHistory: 0, loadOpenOrders: 0, dispose: 0 };
  const coordinator = {
    async loadAll() { calls.loadAll += 1; return snapshot(); },
    async loadBalanceHistory() { calls.loadBalanceHistory += 1; return dataSet("balance history"); },
    async loadOpenOrders() { calls.loadOpenOrders += 1; return dataSet("open orders"); },
    async loadOrderDetails() { return dataSet("order details"); },
    async importCursorHistory() { return {}; },
    dispose() { calls.dispose += 1; },
    ...overrides,
  };
  return { coordinator, calls };
}

function fakeCatalog(overrides = {}) {
  return {
    tsSec: "1700000000",
    retrievedAtMs: 1_700_000_000_000,
    markets: { "1": { baseAsset: "BTC", quoteAsset: "USDT", marketSymbol: "BTC-USDT" } },
    ...overrides,
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
      assert.deepEqual(calls, { loadAll: 1, loadBalanceHistory: 1, loadOpenOrders: 1, dispose: 0 });
    } finally {
      owner.dispose();
    }
  });

  it("is observable and single-flights concurrent broad loads while retaining successful datasets", async () => {
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
    const unsubscribe = owner.subscribe(() => observedLoading.push(owner.getSnapshot().loading));
    try {
      owner.setActive(true);
      const first = owner.load({ explicit: true, secureContext: true });
      const second = owner.load({ explicit: false, secureContext: true });
      assert.equal(first, second, "concurrent lifecycle/manual triggers share the exact in-flight promise");
      await Promise.all([first, second]);

      const state = owner.getSnapshot();
      assert.equal(catalogCalls, 1);
      assert.deepEqual(calls, { loadAll: 1, loadBalanceHistory: 1, loadOpenOrders: 1, dispose: 0 });
      assert.equal(state.activated, true);
      assert.equal(state.snapshot.balances.data.label, "broad bundle:balances");
      assert.equal(state.balanceHistory, null, "failed dataset is not fabricated");
      assert.equal(state.openOrders.data.label, "open orders", "other successful dataset is preserved");
      assert.ok(state.error, "the independent task rejection remains observable");
      assert.ok(observedLoading.includes(true));
      assert.equal(observedLoading.at(-1), false);
      assert.equal(vault.clockSkew, 0);
    } finally {
      unsubscribe();
      owner.dispose();
    }
    assert.equal(calls.dispose, 1);
  });

  it("aborts work when leaving private Account views and clears private memory at vault boundaries", async () => {
    let catalogSignal;
    let catalogCalls = 0;
    const { coordinator, calls } = fakeCoordinator();
    const vault = fakeVault();
    const owner = new AccountSessionOwner({
      vault,
      coordinator,
      fetchCatalog: ({ signal }) => {
        catalogCalls += 1;
        catalogSignal = signal;
        return new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
          setTimeout(() => resolve(fakeCatalog()), 100);
        });
      },
    });
    try {
      owner.setActive(true);
      const pending = owner.load({ explicit: true, secureContext: true });
      await Promise.resolve();
      owner.setActive(false);
      assert.equal(catalogSignal.aborted, true);
      await pending;
      assert.equal(calls.loadAll, 0, "no private dataset starts after the view becomes inactive");

      owner.setActive(true);
      await owner.refreshIfActivated(true);
      assert.equal(catalogCalls, 2, "returning to a private view may perform one consented visibility refresh");
      assert.equal(owner.getSnapshot().snapshot.balances.data.label, "broad bundle:balances");

      vault.emit("LOCK", null);
      const state = owner.getSnapshot();
      assert.equal(state.activated, false);
      assert.equal(state.snapshot, null);
      assert.equal(state.balanceHistory, null);
      assert.equal(state.openOrders, null);
      assert.equal(state.sessionGeneration, null);
    } finally {
      owner.dispose();
    }
  });
});
