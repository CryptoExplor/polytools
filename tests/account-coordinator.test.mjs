import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const PASSPHRASE = "synthetic coordinator passphrase";
const SEED = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const PUBLIC = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
const KEY_ID = "ak_synthetic_coordinator";
let vite;
let account;
const values = new Map();
const vaults = [];
const coordinators = [];

before(async () => {
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
  };
  vite = await createServer({ root: rootDir, logLevel: "silent", server: { middlewareMode: true } });
  account = (await vite.ssrLoadModule("/packages/core/src/index.ts")).account;
});

beforeEach(() => values.clear());

after(async () => {
  for (const coordinator of coordinators) coordinator.dispose();
  for (const vault of vaults) vault.dispose();
  if (vite) await vite.close();
});

async function connected() {
  const vault = new account.AccountVault({
    storage: new account.MemoryVaultStorage(),
    legacyStorage: globalThis.localStorage,
    channel: null,
  });
  vaults.push(vault);
  await vault.importKey({
    label: "synthetic-coordinator",
    passphrase: PASSPHRASE,
    registeredKeyId: KEY_ID,
    privateKeyHex: SEED,
    publicKeyHex: PUBLIC,
  });
  return vault;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

const balance = {
  symbol: "BTC",
  trading: "2.5",
  funding: "1.25",
  reserved: "0.5",
  available: "2",
  tradingRevision: "4",
  fundingRevision: "5",
};

const fill = {
  executedAt: "2026-01-01T00:00:00Z",
  fee: "0.8",
  feeAsset: "QUOTE",
  feeIsRebate: false,
  isMaker: true,
  lineage: { generation: 1, id: "order1" },
  matchId: "1",
  orderId: "order1",
  price: "100000",
  qty: "0.01",
  referralShare: "0",
  side: "BUY",
  symbol: "1",
};

function order(id = "order1") {
  return {
    orderId: id,
    symbol: "1",
    side: "BUY",
    status: "FILLED",
    orderType: "LIMIT",
    price: "100000",
    origQty: "0.01",
    cumQty: "0.01",
    leavesQty: "0",
    avgPx: "100000",
    createdAt: "2026-01-01T00:00:00Z",
    lineage: { generation: 1, id },
    version: 1,
  };
}

const transfer = {
  account: "trading",
  asset: "USDT",
  amount: "1",
  balanceAfter: "2",
  destination: { kind: "TRADING_ACCOUNT", address: "" },
  flowId: "",
  isDebit: false,
  linkId: "0",
  source: { kind: "EXTERNAL_ADDRESS", address: "synthetic-address" },
  timestamp: "1700000000000000",
  transferCode: "DEPOSIT",
};

function successRouter(calls, overrides = {}) {
  return async (url, init) => {
    calls.push({ url, init });
    const parsed = new URL(url);
    const path = parsed.pathname;
    if (overrides[path]) return overrides[path](parsed, init);
    if (path === "/v1/balances") return jsonResponse({ balances: [balance] });
    if (path === "/v1/equity/history/series") {
      return jsonResponse({
        range: "7d",
        points: 2,
        btcPrices: ["100", "101"],
        series: [{ asset: { id: 1, symbol: "BTC" }, equity: ["10", "11"] }],
      });
    }
    if (path === "/v1/orders/history") {
      return parsed.searchParams.get("pageToken")
        ? jsonResponse({ nextPageToken: "", orders: [order("order2")] })
        : jsonResponse({ nextPageToken: "order-cursor", orders: [order("order1")] });
    }
    if (path === "/v1/spot/trades") {
      return jsonResponse({ nextPageToken: "", trades: [fill], transfers: [] });
    }
    if (path === "/v1/transfers") return jsonResponse({ nextPageToken: "", transfers: [transfer] });
    if (path === "/v1/spot/fee-rates") {
      return jsonResponse({ feeRates: [{ symbol: "BTC-USDT", makerFeeRatePercent: "-0.01", takerFeeRatePercent: "0.1", vipTier: 0 }] });
    }
    throw new Error(`Unexpected synthetic path: ${path}`);
  };
}

function makeCoordinator(vault, fetchImpl, options = {}) {
  const client = new account.AccountRestClient({ vault, fetchImpl });
  const store = new account.MemoryDatasetStore();
  const coordinator = new account.AccountDataCoordinator({
    vault,
    client,
    store,
    now: () => Date.parse("2026-01-08T00:00:00Z"),
    ...options,
  });
  coordinators.push(coordinator);
  return { coordinator, store };
}

const markets = { "1": { baseAsset: "BTC", quoteAsset: "USDT", marketSymbol: "BTC-USDT" } };

describe("Official public catalog boundary", () => {
  it("loads pair identity without credentials and rejects conflicting catalog IDs", async () => {
    const pair = { symbolId: 1, symbol: "BTC-USDT", baseAsset: "BTC", quoteAsset: "USDT" };
    const calls = [];
    const catalog = await account.fetchOfficialSpotCatalog({
      now: () => 123,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return jsonResponse({ tsSec: "1", assets: [], pairs: [pair] });
      },
    });
    assert.equal(catalog.markets["1"].quoteAsset, "USDT");
    assert.equal(catalog.retrievedAtMs, 123);
    assert.equal(calls[0].url, "https://api.testnet.polyester.com/v1/spot/config");
    assert.equal(calls[0].init.method, "GET");
    assert.equal(calls[0].init.credentials, "omit");
    assert.equal(calls[0].init.headers, undefined);
    await assert.rejects(
      () => account.fetchOfficialSpotCatalog({
        fetchImpl: async () => jsonResponse({ tsSec: "1", assets: [], pairs: [pair, pair] }),
      }),
      (error) => error?.code === "SCHEMA_INCOMPATIBLE",
    );
  });
});

describe("Account data coordinator (synthetic authenticated transport)", () => {
  it("loads independent datasets with exact fees, cursor coverage, period bounds, and GET-only requests", async () => {
    const vault = await connected();
    const calls = [];
    const { coordinator } = makeCoordinator(vault, successRouter(calls));
    const snapshot = await coordinator.loadAll({ range: "7d", markets });
    assert.equal(snapshot.balances.coverage.status, "complete");
    assert.equal(snapshot.balances.data.balances[0].trading, "2.5");
    assert.equal(snapshot.equity.data.seriesMetrics[0].change.raw, "1");
    assert.equal(snapshot.orders.data.orders.length, 2);
    assert.equal(snapshot.orders.coverage.pagesFetched, 2);
    assert.equal(snapshot.orders.coverage.cursorExhausted, true);
    assert.equal(snapshot.fills.data.summary.feesByAsset[0].asset, "USDT");
    assert.equal(snapshot.fills.data.summary.feesByAsset[0].netFees.raw, "0.8");
    assert.equal(snapshot.fills.coverage.status, "complete");
    assert.equal(snapshot.transfers.data.transfers.length, 1);
    assert.equal(snapshot.feeRates.data.feeRates[0].makerFeeRatePercent, "-0.01");
    assert.equal(snapshot.period.startTime, "2026-01-01T00:00:00.000Z");
    assert.equal(snapshot.period.endTime, "2026-01-08T00:00:00.000Z");
    assert.equal(calls.length, 7);
    assert.equal(calls.every(({ init }) => init.method === "GET" && init.body === undefined), true);
    const fillCall = calls.find(({ url }) => new URL(url).pathname === "/v1/spot/trades");
    assert.match(fillCall.url, /startTime=2026-01-01T00%3A00%3A00.000Z/);
  });

  it("keeps permission failures independent and never turns them into empty successful datasets", async () => {
    const vault = await connected();
    const calls = [];
    const denied = () => jsonResponse({ code: "PERMISSION_DENIED", detail: "synthetic private detail" }, 403);
    const { coordinator } = makeCoordinator(vault, successRouter(calls, {
      "/v1/spot/trades": denied,
      "/v1/orders/history": denied,
      "/v1/transfers": denied,
      "/v1/spot/fee-rates": denied,
      "/v1/equity/history/series": denied,
    }));
    const snapshot = await coordinator.loadAll({ markets });
    assert.equal(snapshot.balances.coverage.status, "complete");
    for (const dataset of [snapshot.fills, snapshot.orders, snapshot.transfers, snapshot.feeRates, snapshot.equity]) {
      assert.equal(dataset.coverage.status, "denied");
      assert.equal(dataset.data, null);
      assert.equal(dataset.error.code, "PERMISSION_DENIED");
      assert.equal(JSON.stringify(dataset).includes("synthetic private detail"), false);
    }
  });

  it("marks conflicting or unknown fills partial and blocks observed aggregates", async () => {
    const vault = await connected();
    const calls = [];
    const conflicting = { ...fill, price: "100001" };
    const { coordinator } = makeCoordinator(vault, successRouter(calls, {
      "/v1/spot/trades": () => jsonResponse({ nextPageToken: "", trades: [fill, conflicting, { symbol: "unknown" }], transfers: [] }),
    }));
    const snapshot = await coordinator.loadAll({ markets });
    assert.equal(snapshot.fills.coverage.status, "partial");
    assert.equal(snapshot.fills.coverage.conflictingRows, 1);
    assert.equal(snapshot.fills.coverage.unknownRows, 1);
    assert.equal(account.observedFillEligibility(snapshot.fills.data.summary, snapshot.fills.coverage).available, false);
    assert.equal(snapshot.fills.data.summary.metricLabel, "observed-metrics-blocked");
  });

  it("blocks fee aggregates when an otherwise valid page contains an unknown financial row", async () => {
    const vault = await connected();
    const calls = [];
    const { coordinator } = makeCoordinator(vault, successRouter(calls, {
      "/v1/spot/trades": () => jsonResponse({ nextPageToken: "", trades: [fill, { symbol: "unknown" }], transfers: [] }),
    }));
    const snapshot = await coordinator.loadAll({ markets });
    assert.equal(snapshot.fills.data.summary.eligible, false);
    assert.equal(snapshot.fills.data.summary.metricLabel, "observed-metrics-blocked");
    assert.equal(snapshot.fills.coverage.unknownRows, 1);
    assert.equal(account.observedFillEligibility(snapshot.fills.data.summary, snapshot.fills.coverage).available, false);
  });

  it("marks same-session cached data stale on a temporary failure without hiding the error", async () => {
    const vault = await connected();
    const calls = [];
    let failBalances = false;
    const { coordinator } = makeCoordinator(vault, successRouter(calls, {
      "/v1/balances": () => failBalances
        ? jsonResponse({ code: "UNAVAILABLE" }, 503)
        : jsonResponse({ balances: [balance] }),
    }));
    await coordinator.loadAll({ markets });
    failBalances = true;
    const snapshot = await coordinator.loadAll({ markets });
    assert.equal(snapshot.balances.coverage.status, "stale");
    assert.equal(snapshot.balances.data.balances[0].symbol, "BTC");
    assert.equal(snapshot.balances.error.code, "SERVER");
    assert.equal(snapshot.balances.coverage.rowsAccepted, 1);
  });

  it("clears all private snapshots on the vault's real uppercase lock event", async () => {
    const vault = await connected();
    const calls = [];
    const { coordinator, store } = makeCoordinator(vault, successRouter(calls));
    await coordinator.loadAll({ markets });
    assert.equal(store.size > 0, true);
    await vault.lock();
    assert.equal(store.size, 0);
    await assert.rejects(() => coordinator.loadAll({ markets }), (error) => error?.code === "ACCOUNT_STALE");
  });
});
