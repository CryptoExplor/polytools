import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

function order(id = "order1", overrides = {}) {
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
    ...overrides,
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
    if (path === "/v1/balances/history") {
      return jsonResponse({
        range: "7d",
        bucket: "1h",
        startTsSec: 1767225600,
        endTsSec: 1767229200,
        points: 2,
        series: [{ account: "trading", asset: "BTC", balance: ["2.5", "2.5000001"] }],
      });
    }
    if (path === "/v1/equity/history/series") {
      return jsonResponse({
        range: "7d",
        points: 2,
        btcPrices: ["100", "101"],
        series: [{ asset: { id: 1, symbol: "BTC" }, equity: ["10", "11"] }],
      });
    }
    if (path === "/v1/orders/open") {
      return jsonResponse({
        orders: [order("open1", { status: "WORKING", cumQty: "0", leavesQty: "0.01" })],
      });
    }
    if (path === "/v1/orders/history") {
      return parsed.searchParams.get("pageToken")
        ? jsonResponse({ nextPageToken: "", orders: [order("order2")] })
        : jsonResponse({ nextPageToken: "order-cursor", orders: [order("order1")] });
    }
    if (path === "/v1/spot/orders/order1") {
      return jsonResponse({ nextPageToken: "", order: order("order1"), trades: [fill], transfers: [] });
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

function pagedHistoryRouter(calls, fillPages = 3, transferPages = 2) {
  return successRouter(calls, {
    "/v1/spot/trades": (parsed) => {
      const token = parsed.searchParams.get("pageToken");
      const index = token ? Number(token.slice("fill-".length)) : 0;
      const id = index + 1;
      return jsonResponse({
        nextPageToken: index + 1 < fillPages ? `fill-${id}` : "",
        trades: [{ ...fill, matchId: String(id), orderId: `order${id}`, lineage: { generation: 1, id: `order${id}` } }],
        transfers: [],
      });
    },
    "/v1/transfers": (parsed) => {
      const token = parsed.searchParams.get("page_token");
      const index = token ? Number(token.slice("transfer-".length)) : 0;
      const id = index + 1;
      return jsonResponse({
        nextPageToken: index + 1 < transferPages ? `transfer-${id}` : "",
        transfers: [{ ...transfer, amount: String(id), flowId: `flow-${id}` }],
      });
    },
  });
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

function historyBody(value = "2.5000001") {
  return {
    range: "7d", bucket: "1h", startTsSec: 1767225600, endTsSec: 1767229200, points: 2,
    series: [{ account: "trading", asset: "BTC", balance: ["2.5", value] }],
  };
}

async function waitFor(predicate) {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for synthetic request scheduling.");
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

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
    assert.equal(snapshot.equity.data.seriesMetrics[0].sampleCount, 2);
    assert.equal(snapshot.equity.data.seriesMetrics[0].observedLow.raw, "10");
    assert.equal(snapshot.equity.data.seriesMetrics[0].observedHigh.raw, "11");
    assert.equal("timestamp" in snapshot.equity.data.response.series[0], false);
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

  it("keeps the activation disclosure aligned with the actual broad read bundle", async () => {
    const vault = await connected();
    const catalogCalls = [];
    const pair = { symbolId: 1, symbol: "BTC-USDT", baseAsset: "BTC", quoteAsset: "USDT" };
    const catalog = await account.fetchOfficialSpotCatalog({
      fetchImpl: async (url, init) => {
        catalogCalls.push({ url, init });
        return jsonResponse({ tsSec: "1767225600", assets: [], pairs: [pair] });
      },
    });
    const restCalls = [];
    const { coordinator } = makeCoordinator(vault, successRouter(restCalls));
    const options = { range: "7d", markets: catalog.markets };
    await Promise.all([
      coordinator.loadAll(options),
      coordinator.loadBalanceHistory(options),
      coordinator.loadOpenOrders(options),
    ]);

    const actualPaths = [...new Set(restCalls.map(({ url }) => new URL(url).pathname))].sort();
    assert.deepEqual(actualPaths, [
      "/v1/balances",
      "/v1/balances/history",
      "/v1/equity/history/series",
      "/v1/orders/history",
      "/v1/orders/open",
      "/v1/spot/fee-rates",
      "/v1/spot/trades",
      "/v1/transfers",
    ].sort());
    assert.equal(catalogCalls.length, 1);
    assert.equal(new URL(catalogCalls[0].url).pathname, "/v1/spot/config");
    assert.equal(catalogCalls[0].init.method, "GET");
    assert.equal(restCalls.every(({ init }) => init.method === "GET" && init.body === undefined), true);

    const source = await readFile(new URL("../apps/web/src/components/AccountAnalytics.tsx", import.meta.url), "utf8");
    const disclosureStart = source.indexOf("<strong>Before loading account data:</strong>");
    assert.notEqual(disclosureStart, -1, "the read scope remains disclosed before the activation controls");
    const disclosureEnd = source.indexOf("</div>", disclosureStart);
    const disclosure = source.slice(disclosureStart, disclosureEnd);
    for (const label of [
      "official spot-market catalog",
      "balances",
      "equity history",
      "order history",
      "fills",
      "transfers",
      "fee rates",
      "balance history",
      "open orders",
      "document becomes visible",
    ]) {
      assert.ok(disclosure.includes(label), `disclosure should name ${label}`);
    }

    const owner = await readFile(new URL("../apps/web/src/lib/accountSessionOwner.ts", import.meta.url), "utf8");
    assert.match(owner, /this\.fetchCatalog\(\{ signal: request\.controller\.signal \}\)/);
    assert.match(owner, /this\.coordinator\.loadAll\(options\)/);
    assert.match(owner, /this\.coordinator\.loadBalanceHistory\(options\)/);
    assert.match(owner, /this\.coordinator\.loadOpenOrders\(options\)/);
    assert.match(owner, /if \(!options\.explicit && !this\.state\.activated\) return Promise\.resolve\(\)/);
    assert.match(owner, /this\.inFlight\?\.key === key/);

    const portfolio = await readFile(new URL("../apps/web/src/pages/Portfolio.tsx", import.meta.url), "utf8");
    assert.match(portfolio, /document\.addEventListener\("visibilitychange", onVisibility\)/);
    assert.match(portfolio, /refreshIfActivated/);
    assert.match(portfolio, /privateAnalyticsActive/);
  });

  it("loads typed open orders independently, including an omitted exhausted cursor", async () => {
    const vault = await connected();
    const calls = [];
    const { coordinator } = makeCoordinator(vault, successRouter(calls));
    const dataset = await coordinator.loadOpenOrders({ markets });
    assert.equal(dataset.data.orders.length, 1);
    assert.equal(dataset.data.orders[0].orderId, "open1");
    assert.equal(dataset.data.orders[0].status, "WORKING");
    assert.equal(dataset.coverage.status, "complete");
    assert.equal(dataset.coverage.cursorExhausted, true);
    assert.equal(dataset.coverage.rowsReceived, 1);
    assert.equal(dataset.coverage.rowsAccepted, 1);
    assert.equal(account.rowsReconcile(dataset.coverage), true);
    const openCall = calls.find(({ url }) => new URL(url).pathname === "/v1/orders/open");
    assert.equal(openCall.init.method, "GET");
    assert.equal(new URL(openCall.url).searchParams.has("startTime"), false);
  });

  it("loads fixed-range balance history with exact values, identity, timing, and coverage", async () => {
    const vault = await connected();
    const calls = [];
    const { coordinator } = makeCoordinator(vault, successRouter(calls));
    const dataset = await coordinator.loadBalanceHistory({ range: "7d" });
    assert.equal(dataset.coverage.status, "complete");
    assert.equal(dataset.coverage.cursorExhausted, true);
    assert.equal(dataset.coverage.rowsReceived, 2);
    assert.equal(dataset.data.series[0].asset, "BTC");
    assert.equal(dataset.data.series[0].account, "trading");
    assert.equal(dataset.data.series[0].balance[1], "2.5000001");
    assert.equal(dataset.data.startTsSec, 1767225600);
    assert.equal(dataset.data.endTsSec, 1767229200);
    assert.equal(dataset.data.timing.available, true);
    assert.equal(dataset.data.timing.bucketSeconds, 3600);
    const call = calls.find(({ url }) => new URL(url).pathname === "/v1/balances/history");
    assert.equal(new URL(call.url).searchParams.get("range"), "7d");
    assert.equal(call.init.method, "GET");
  });

  it("loads order details with exact dynamic paths and validated lineage executions", async () => {
    const vault = await connected();
    const calls = [];
    const { coordinator } = makeCoordinator(vault, successRouter(calls));
    const dataset = await coordinator.loadOrderDetails({ orderId: "order1", markets });
    assert.equal(dataset.coverage.status, "complete");
    assert.equal(dataset.data.order.orderId, "order1");
    assert.equal(dataset.data.executions.length, 1);
    assert.equal(dataset.data.executions[0].feeMagnitude, "0.8");
    assert.equal(dataset.data.executions[0].lineageId, "order1");
    const call = calls.find(({ url }) => new URL(url).pathname === "/v1/spot/orders/order1");
    assert.equal(new URL(call.url).searchParams.get("includeExecutionHistory"), "true");
    assert.equal(new URL(call.url).searchParams.has("orderId"), false);
    assert.equal(call.init.method, "GET");
  });

  it("keeps open orders independent when loaded concurrently with the main snapshot", async () => {
    const vault = await connected();
    const calls = [];
    const { coordinator } = makeCoordinator(vault, successRouter(calls));
    const [snapshot, open] = await Promise.all([
      coordinator.loadAll({ markets }),
      coordinator.loadOpenOrders({ markets }),
    ]);
    assert.equal(snapshot.balances.data.balances.length, 1);
    assert.equal(open.data.orders[0].orderId, "open1");
  });

  it("keeps malformed open-order rows visible as partial coverage", async () => {
    const vault = await connected();
    const calls = [];
    const { coordinator } = makeCoordinator(vault, successRouter(calls, {
      "/v1/orders/open": () => jsonResponse({
        orders: [order("open1", { status: "WORKING" }), { symbol: "unknown" }],
      }),
    }));
    const dataset = await coordinator.loadOpenOrders({ markets });
    assert.equal(dataset.data.orders.length, 1);
    assert.equal(dataset.data.quarantined.length, 1);
    assert.equal(dataset.coverage.status, "partial");
    assert.equal(dataset.coverage.rowsReceived, 2);
    assert.equal(dataset.coverage.rowsAccepted, 1);
    assert.equal(dataset.coverage.unknownRows, 1);
    assert.equal(account.rowsReconcile(dataset.coverage), true);
  });

  it("distinguishes empty fixed-range, open-order, and order-detail responses", async () => {
    const vault = await connected();
    const calls = [];
    const { coordinator } = makeCoordinator(vault, successRouter(calls, {
      "/v1/balances/history": () => jsonResponse({ range: "7d", points: 0, series: [] }),
      "/v1/orders/open": () => jsonResponse({ nextPageToken: "", orders: [] }),
      "/v1/spot/orders/order1": () => jsonResponse({ nextPageToken: "", trades: [], transfers: [] }),
    }));
    const history = await coordinator.loadBalanceHistory({ range: "7d" });
    const open = await coordinator.loadOpenOrders({ markets });
    const details = await coordinator.loadOrderDetails({ orderId: "order1", markets });
    assert.deepEqual(history.data.series, []);
    assert.equal(history.data.timing.available, false);
    assert.deepEqual(open.data.orders, []);
    assert.equal(details.data.order, null);
    assert.deepEqual(details.data.executions, []);
    for (const dataset of [history, open, details]) {
      assert.equal(dataset.coverage.status, "complete");
      assert.equal(dataset.data !== null, true);
    }
  });

  it("blocks malformed balance timing and unassociated order executions", async () => {
    const vault = await connected();
    const calls = [];
    const { coordinator } = makeCoordinator(vault, successRouter(calls, {
      "/v1/balances/history": () => jsonResponse({
        range: "7d", bucket: "1h", startTsSec: 1767225600, endTsSec: 1767225601, points: 2,
        series: [{ account: "trading", asset: "BTC", balance: ["2.5", "2.6"] }],
      }),
      "/v1/spot/orders/order1": () => jsonResponse({
        nextPageToken: "", order: order("order1"),
        trades: [{ ...fill, lineage: { generation: 1, id: "other1" } }], transfers: [],
      }),
    }));
    const history = await coordinator.loadBalanceHistory({ range: "7d" });
    const details = await coordinator.loadOrderDetails({ orderId: "order1", markets });
    assert.equal(history.data, null);
    assert.equal(history.coverage.status, "blocked");
    assert.equal(history.error.code, "SCHEMA_INCOMPATIBLE");
    assert.equal(details.data, null);
    assert.equal(details.coverage.status, "blocked");
    assert.equal(details.error.code, "SCHEMA_INCOMPATIBLE");
  });

  it("retains validated order-detail prefixes with partial coverage after a later-page failure", async () => {
    const vault = await connected();
    const calls = [];
    const { coordinator } = makeCoordinator(vault, successRouter(calls, {
      "/v1/spot/orders/order1": (parsed) => parsed.searchParams.get("pageToken")
        ? jsonResponse({ code: "UNAVAILABLE", detail: "synthetic private detail" }, 503)
        : jsonResponse({ nextPageToken: "opaque+cursor", order: order("order1"), trades: [fill], transfers: [] }),
    }));
    const dataset = await coordinator.loadOrderDetails({ orderId: "order1", markets });
    assert.equal(dataset.data.order.orderId, "order1");
    assert.equal(dataset.data.executions.length, 1);
    assert.equal(dataset.coverage.status, "partial");
    assert.equal(dataset.coverage.cursorExhausted, false);
    assert.equal(dataset.coverage.pagesFetched, 1);
    assert.equal(dataset.error.code, "SERVER");
    assert.equal(JSON.stringify(dataset).includes("synthetic private detail"), false);
    const second = calls.filter(({ url }) => new URL(url).pathname === "/v1/spot/orders/order1")[1];
    assert.equal(new URL(second.url).searchParams.get("pageToken"), "opaque+cursor");
  });

  it("keeps balance-history, open-order, and order-detail denials independent", async () => {
    const vault = await connected();
    const calls = [];
    const denied = () => jsonResponse({ code: "PERMISSION_DENIED", detail: "synthetic private detail" }, 403);
    const { coordinator } = makeCoordinator(vault, successRouter(calls, {
      "/v1/balances/history": denied,
      "/v1/orders/open": denied,
      "/v1/spot/orders/order1": denied,
    }));
    const datasets = await Promise.all([
      coordinator.loadBalanceHistory(),
      coordinator.loadOpenOrders({ markets }),
      coordinator.loadOrderDetails({ orderId: "order1", markets }),
    ]);
    for (const dataset of datasets) {
      assert.equal(dataset.data, null);
      assert.equal(dataset.coverage.status, "denied");
      assert.equal(dataset.error.code, "PERMISSION_DENIED");
      assert.equal(JSON.stringify(dataset).includes("synthetic private detail"), false);
    }
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

  it("keeps unknown transfer reasons visible while reconciling partial coverage", async () => {
    const vault = await connected();
    const calls = [];
    const { coordinator } = makeCoordinator(vault, successRouter(calls, {
      "/v1/transfers": () => jsonResponse({
        nextPageToken: "",
        transfers: [{ ...transfer, transferCode: "FUTURE_REASON" }],
      }),
    }));
    const snapshot = await coordinator.loadAll({ markets });
    const row = snapshot.transfers.data.transfers[0];
    assert.equal(row.transferCode, "FUTURE_REASON");
    assert.equal(row.reasonLabel, "Unknown activity");
    assert.equal(row.reasonKnown, false);
    assert.equal(snapshot.transfers.data.transfers.length, 1);
    assert.equal(snapshot.transfers.coverage.status, "partial");
    assert.equal(snapshot.transfers.coverage.rowsReceived, 1);
    assert.equal(snapshot.transfers.coverage.rowsAccepted, 0);
    assert.equal(snapshot.transfers.coverage.unknownRows, 1);
    assert.equal(account.rowsReconcile(snapshot.transfers.coverage), true);
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

  it("keeps same-session balance-history data stale after a temporary failure", async () => {
    const vault = await connected();
    const calls = [];
    let fail = false;
    const { coordinator } = makeCoordinator(vault, successRouter(calls, {
      "/v1/balances/history": () => fail
        ? jsonResponse({ code: "UNAVAILABLE" }, 503)
        : jsonResponse(historyBody()),
    }));
    await coordinator.loadBalanceHistory({ range: "7d" });
    fail = true;
    const stale = await coordinator.loadBalanceHistory({ range: "7d" });
    assert.equal(stale.coverage.status, "stale");
    assert.equal(stale.data.series[0].balance[1], "2.5000001");
    assert.equal(stale.error.code, "SERVER");
  });

  it("lets only the newest same-session balance-history generation update data and cache", async () => {
    const vault = await connected();
    const pending = [];
    let fail = false;
    const { coordinator } = makeCoordinator(vault, async (url, init) => {
      if (new URL(url).pathname !== "/v1/balances/history") return successRouter([])(url, init);
      if (fail) return jsonResponse({ code: "UNAVAILABLE" }, 503);
      return new Promise((resolve) => pending.push({ url, resolve }));
    });
    const firstPromise = coordinator.loadBalanceHistory({ range: "7d" });
    const firstOutcome = firstPromise.then(() => null, (error) => error);
    await waitFor(() => pending.length >= 1);
    const secondPromise = coordinator.loadBalanceHistory({ range: "7d" });
    await waitFor(() => pending.length >= 2);
    pending[1].resolve(jsonResponse(historyBody("9.8765432")));
    const second = await secondPromise;
    assert.equal(second.data.series[0].balance[1], "9.8765432");
    pending[0].resolve(jsonResponse(historyBody("1.0000000")));
    const firstError = await firstOutcome;
    assert.equal(firstError?.code, "ACCOUNT_STALE");
    fail = true;
    const cached = await coordinator.loadBalanceHistory({ range: "7d" });
    assert.equal(cached.coverage.status, "stale");
    assert.equal(cached.data.series[0].balance[1], "9.8765432");
  });

  it("discards a delayed balance-history response after lock and clears its snapshot", async () => {
    const vault = await connected();
    const pending = [];
    const { coordinator, store } = makeCoordinator(vault, async (url) => {
      if (new URL(url).pathname === "/v1/balances/history") {
        return new Promise((resolve) => pending.push(resolve));
      }
      return jsonResponse({ balances: [balance] });
    });
    const result = coordinator.loadBalanceHistory({ range: "7d" });
    await waitFor(() => pending.length === 1);
    await vault.lock();
    pending[0](jsonResponse(historyBody()));
    await assert.rejects(result, (error) => error?.code === "ACCOUNT_STALE");
    assert.equal(store.size, 0);
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

  it("keeps the default snapshot capped while explicit import follows cursors with exact period and count progress", async () => {
    const vault = await connected();
    const calls = [];
    const { coordinator } = makeCoordinator(vault, pagedHistoryRouter(calls), { maxPages: 1 });
    const capped = await coordinator.loadAll({ range: "7d", markets });
    assert.equal(capped.fills.coverage.status, "partial");
    assert.equal(capped.fills.coverage.stoppedAtCap, true);
    assert.equal(capped.fills.coverage.pagesFetched, 1);
    assert.equal(capped.transfers.coverage.status, "partial");
    assert.equal(capped.transfers.coverage.stoppedAtCap, true);

    const progress = [];
    const beforeImportCalls = calls.length;
    const imported = await coordinator.importCursorHistory({
      period: capped.period,
      maxPages: 5,
      markets,
      onProgress: (value) => progress.push(value),
    });
    assert.equal(imported.period.startTime, capped.period.startTime);
    assert.equal(imported.period.endTime, capped.period.endTime);
    assert.equal(imported.fills.coverage.status, "complete");
    assert.equal(imported.fills.coverage.pagesFetched, 3);
    assert.equal(imported.fills.coverage.cursorExhausted, true);
    assert.equal(imported.fills.data.summary.calculations.length, 3);
    assert.equal(imported.transfers.coverage.status, "complete");
    assert.equal(imported.transfers.coverage.pagesFetched, 2);
    assert.equal(imported.transfers.data.transfers.length, 2);
    assert.deepEqual(progress.map((value) => value.operation), ["fills", "fills", "fills", "transfers", "transfers"]);
    assert.deepEqual(progress.filter((value) => value.operation === "fills").map((value) => value.pagesFetched), [1, 2, 3]);
    assert.deepEqual(progress.filter((value) => value.operation === "transfers").map((value) => value.pagesFetched), [1, 2]);
    assert.equal(progress.every((value) => value.maxPages === 5 && value.rowsReceived >= 1), true);
    const importCalls = calls.slice(beforeImportCalls);
    assert.equal(importCalls.every(({ url }) => ["/v1/spot/trades", "/v1/transfers"].includes(new URL(url).pathname)), true);
    assert.equal(importCalls.some(({ url }) => new URL(url).searchParams.get("pageToken") === "fill-2"), true);
    assert.equal(importCalls.some(({ url }) => new URL(url).searchParams.get("page_token") === "transfer-1"), true);
    assert.equal(JSON.stringify(imported).includes("fill-2"), false);
    assert.equal(JSON.stringify(imported).includes("transfer-1"), false);
  });

  it("imports only selected order history without adding fills or transfer requests", async () => {
    const vault = await connected();
    const calls = [];
    const { coordinator } = makeCoordinator(vault, pagedHistoryRouter(calls));
    const snapshot = await coordinator.loadAll({ markets });
    const beforeImport = calls.length;
    const progress = [];
    const result = await coordinator.importCursorHistory({
      period: snapshot.period,
      maxPages: 5,
      operations: ["orders"],
      markets,
      onProgress: (value) => progress.push(value),
    });
    assert.equal(result.orders.coverage.status, "complete");
    assert.equal(result.orders.coverage.pagesFetched, 2);
    assert.equal(result.orders.data.orders.length, 2);
    assert.equal(result.fills, undefined);
    assert.equal(result.transfers, undefined);
    assert.deepEqual(progress.map((value) => [value.operation, value.pagesFetched]), [["orders", 1], ["orders", 2]]);
    assert.equal(calls.slice(beforeImport).every(({ url }) => new URL(url).pathname === "/v1/orders/history"), true);
  });

  it("keeps an explicit import partial at its selected cap and rejects an unsafe page policy before reading", async () => {
    const vault = await connected();
    const calls = [];
    const { coordinator } = makeCoordinator(vault, pagedHistoryRouter(calls));
    const snapshot = await coordinator.loadAll({ markets });
    const before = calls.length;
    await assert.rejects(
      () => coordinator.importCursorHistory({ period: snapshot.period, maxPages: 0, markets }),
      (error) => error?.code === "INVALID_REQUEST",
    );
    assert.equal(calls.length, before);
    await assert.rejects(
      () => coordinator.importCursorHistory({ period: snapshot.period, maxPages: 2, operations: ["fills", "fills"], markets }),
      (error) => error?.code === "INVALID_REQUEST",
    );
    assert.equal(calls.length, before);
    const result = await coordinator.importCursorHistory({ period: snapshot.period, maxPages: 1, markets });
    assert.equal(result.fills.coverage.status, "partial");
    assert.equal(result.fills.coverage.stoppedAtCap, true);
    assert.equal(result.fills.coverage.cursorExhausted, false);
    assert.equal(result.transfers.coverage.status, "partial");
    assert.equal(result.transfers.coverage.stoppedAtCap, true);
  });

  it("aborts explicit cursor import without requesting another page or marking the prefix complete", async () => {
    const vault = await connected();
    const calls = [];
    const { coordinator } = makeCoordinator(vault, pagedHistoryRouter(calls));
    const snapshot = await coordinator.loadAll({ markets });
    const beforeImport = calls.length;
    const controller = new AbortController();
    const result = await coordinator.importCursorHistory({
      period: snapshot.period,
      maxPages: 10,
      markets,
      signal: controller.signal,
      onProgress: (value) => {
        if (value.operation === "fills" && value.pagesFetched === 1) controller.abort();
      },
    });
    assert.equal(controller.signal.aborted, true);
    assert.equal(result.fills.coverage.status, "partial");
    assert.equal(result.fills.coverage.cursorExhausted, false);
    assert.equal(result.fills.error.code, "ABORTED");
    const fillCalls = calls.slice(beforeImport).filter(({ url }) => new URL(url).pathname === "/v1/spot/trades");
    assert.equal(fillCalls.some(({ url }) => new URL(url).searchParams.get("pageToken") === "fill-1"), false);
  });
});
