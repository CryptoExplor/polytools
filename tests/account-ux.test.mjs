import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createServer } from "vite";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const source = (path) => readFileSync(resolve(rootDir, path), "utf8");
const render = (element) => renderToStaticMarkup(element);

let vite;
let account;
let api;
let AccountAnalytics;
let DatasetMessages;
let DatasetStatus;
let ExecutionFee;
let NoDataset;
let Portfolio;

before(async () => {
  vite = await createServer({ root: rootDir, logLevel: "silent", server: { middlewareMode: true } });
  ({ account } = await vite.ssrLoadModule("/packages/core/src/index.ts"));
  ({ api } = await vite.ssrLoadModule("/apps/web/src/lib/api.ts"));
  ({
    AccountAnalytics,
    DatasetMessages,
    DatasetStatus,
    ExecutionFee,
    NoDataset,
  } = await vite.ssrLoadModule("/apps/web/src/components/AccountAnalytics.tsx"));
  ({ default: Portfolio } = await vite.ssrLoadModule("/apps/web/src/pages/Portfolio.tsx"));
});

after(async () => {
  if (vite) await vite.close();
});

function coverage(status, overrides = {}) {
  return {
    operation: "fills",
    contractVersion: "synthetic-test",
    scopeLabel: "Synthetic account",
    filters: {},
    status,
    pagesFetched: 1,
    rowsReceived: 0,
    rowsAccepted: 0,
    duplicateRows: 0,
    conflictingRows: 0,
    unknownRows: 0,
    droppedRows: 0,
    cursorExhausted: status === "complete" || status === "filter-complete",
    stoppedAtCap: false,
    openingBasis: "unknown",
    nonFillFlows: "unresolved",
    ...overrides,
  };
}

function dataset(status, code, data = null) {
  return {
    data,
    coverage: coverage(status),
    retrievedAtMs: null,
    ...(code ? { error: { code, operation: "fills", localCorrelationId: "synthetic-test" } } : {}),
  };
}

function fill(overrides = {}) {
  return {
    accountScope: "synthetic-account-scope",
    symbol: "1",
    marketSymbol: "BTC-USDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    matchId: "match-1",
    orderId: "order-1",
    side: "BUY",
    quantity: "0.01",
    price: "100000",
    feeMagnitude: "0.8",
    feeAsset: "QUOTE",
    feeIsRebate: false,
    timestamp: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderAccount(view, session = null) {
  return render(React.createElement(AccountAnalytics, { accountVault: null, session, view }));
}

describe("Account UX source and cache isolation", () => {
  it("keeps account views on AccountAnalytics and public routes on Tape/Book", () => {
    const portfolio = source("apps/web/src/pages/Portfolio.tsx");
    const analytics = source("apps/web/src/components/AccountAnalytics.tsx");
    const app = source("apps/web/src/App.tsx");
    const tape = source("apps/web/src/pages/Tape.tsx");

    assert.ok(!portfolio.includes("<Tape"));
    assert.ok(!portfolio.includes("<Book"));
    assert.ok(portfolio.includes('section === "trade"\n    ? "trades"'));
    assert.ok(portfolio.includes('section === "orders"\n      ? "orders"'));
    assert.ok(portfolio.includes('section === "transactions"\n          ? "transfers"'));
    assert.ok(portfolio.includes('<AccountAnalytics owner={accountDataOwner} session={session} view={analyticsView} active={privateAnalyticsActive} />'));
    assert.ok(!analytics.includes("api.trades"));
    assert.ok(!analytics.includes("/api/trades"));
    assert.ok(!analytics.includes("../lib/api"));
    assert.ok(app.includes('path="book" element={<Book />}'));
    assert.ok(app.includes('path="tape" element={<Tape />}'));
    assert.ok(tape.includes("api.trades(symbol, 50)"));
    assert.ok(tape.includes("Public data — not your fills"));
  });

  it("shows order-agnostic equity samples and separates the account testnet label from public environment", () => {
    const analytics = source("apps/web/src/components/AccountAnalytics.tsx");
    const portfolio = source("apps/web/src/pages/Portfolio.tsx");
    const layout = source("apps/web/src/components/Layout.tsx");
    const html = renderAccount("overview");

    assert.ok(html.includes("Private reads: Testnet only"));
    assert.ok(portfolio.includes("Private account reads use Polyester Testnet only."));
    assert.ok(layout.includes("Read-only · {apiEnv}"), "the global badge still reports the public API environment");
    assert.ok(analytics.includes("point order is unverified"));
    assert.ok(analytics.includes("<th>Samples</th><th>Observed low</th><th>Observed high</th>"));
    assert.ok(!analytics.includes("<th>Latest</th>"));
    assert.ok(!analytics.includes("<th>Change</th>"));
    assert.ok(!analytics.includes("<th>Drawdown</th>"));
  });

  it("keeps the public trades request free of account authentication headers", async () => {
    const originalFetch = globalThis.fetch;
    let captured;
    try {
      globalThis.fetch = async (url, init) => {
        captured = { url: String(url), init };
        return new Response(JSON.stringify({
          apiEnv: "testnet",
          symbol: "BTC-USDT",
          symbolId: 1,
          tradeCount: 0,
          trades: [],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      };
      await api.trades("BTC-USDT", 50);
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(captured.url, "/api/trades?symbol=BTC-USDT&limit=50");
    assert.deepEqual(captured.init.headers, { Accept: "application/json" });
    assert.equal(captured.init.credentials, undefined);
    assert.equal(captured.init.method, undefined);
  });

  it("keeps private cache partitions separate by operation and filters", () => {
    const store = new account.MemoryDatasetStore();
    const partition = {
      sessionGeneration: "synthetic-generation",
      scopeKey: "synthetic-scope",
      operation: "fills",
      filters: { range: "30d" },
    };
    try {
      store.set(partition, { marker: "private fills" });
      assert.deepEqual(store.get(partition), { marker: "private fills" });
      assert.equal(store.get({ ...partition, operation: "ordersHistory" }), undefined);
      assert.equal(store.get({ ...partition, filters: { range: "7d" } }), undefined);
      assert.equal(store.get({ ...partition, sessionGeneration: "another-generation" }), undefined);
    } finally {
      store.dispose();
    }

    const backend = source("backend/src/handler.ts");
    const rest = source("packages/core/src/account/rest.ts");
    const signer = source("packages/core/src/account/signer.ts");
    assert.ok(backend.includes('cached(`trades:${symbol}:${limit}:${side ?? "*"}`'));
    assert.ok(backend.includes("data.recentTrades(symbol, limit, side)"));
    assert.ok(signer.includes('fills: { method: "GET", path: "/v1/spot/trades"'));
    assert.ok(rest.includes('credentials: "omit"'));
    assert.ok(rest.includes('cache: "no-store"'));
    assert.ok(rest.includes('redirect: "error"'));
  });

  it("wires private transfers to the shared owner and keeps public Flow lookup credential-free", () => {
    const portfolio = source("apps/web/src/pages/Portfolio.tsx");
    assert.ok(portfolio.includes('scope === "mine"'));
    assert.ok(portfolio.includes('scope === "all" ? <Flow embedded />'));
    assert.ok(portfolio.includes('section === "transactions" && movementScope === "mine"'));
    assert.ok(portfolio.includes("accountDataOwner.setActive(privateAnalyticsActive)"));
    assert.ok(portfolio.includes('<AccountAnalytics owner={accountDataOwner} session={session} view={analyticsView} active={privateAnalyticsActive} />'));
    assert.ok(portfolio.includes("Public transaction lookup"));
    assert.ok(portfolio.includes("Single lookup, not a feed."));
  });

  it("gates refresh and private rendering to active private Account views", () => {
    const portfolio = source("apps/web/src/pages/Portfolio.tsx");
    const analytics = source("apps/web/src/components/AccountAnalytics.tsx");
    assert.ok(portfolio.includes("if (!privateAnalyticsActive) return"));
    assert.ok(portfolio.includes("privateAnalyticsActiveRef.current && document.visibilityState === \"visible\""));
    assert.ok(analytics.includes("owner?.setRange(range)"));
    assert.ok(!analytics.includes("refreshIfActivated"), "tab changes select cached data without auto-refreshing");
    assert.ok(analytics.includes("if (!active) return null;"));
    assert.ok(analytics.includes("return owner.load({ explicit, secureContext, range })"));
    assert.equal(render(React.createElement(AccountAnalytics, { session: null, active: false })), "");
  });

  it("keeps periods local to each view, caches them in the owner, and scopes errors to relevant datasets", () => {
    const analytics = source("apps/web/src/components/AccountAnalytics.tsx");
    const owner = source("apps/web/src/lib/accountSessionOwner.ts");
    assert.ok(analytics.includes("const [rangesByView, setRangesByView] = useState(DEFAULT_VIEW_RANGES)"));
    assert.ok(analytics.includes("const range = rangesByView[view]"));
    assert.ok(analytics.includes("ownerState.periods[range] ?? EMPTY_RANGE_STATE"));
    assert.ok(analytics.includes("rangeErrors.balanceHistory ? [rangeErrors.balanceHistory] : []"));
    assert.ok(analytics.includes("view === \"orders\" && rangeErrors.openOrders"));
    assert.ok(analytics.includes("account-session-status__controls"));
    assert.ok(!analytics.includes('className="account-view-controls'));
    assert.ok(owner.includes("ACCOUNT_DATA_FRESHNESS_MS = 2 * 60 * 1000"));
    assert.ok(owner.includes("periods: { ...this.state.periods, [range]: next }"));
    assert.ok(owner.includes("mergeImportedHistory(\n    identity: AccountSessionIdentity"));
  });
});

describe("Account per-view rendering and empty states", () => {
  it("keeps page titles at the route level instead of repeating them in the analytics panel", () => {
    const portfolio = source("apps/web/src/pages/Portfolio.tsx");
    const analytics = source("apps/web/src/components/AccountAnalytics.tsx");
    assert.ok(portfolio.includes("<PageHeader"));
    assert.ok(portfolio.includes("title={header.title}"));
    assert.ok(!analytics.includes("title={copy.title}"));
    assert.ok(!analytics.includes("subtitle={copy.subtitle}"));
  });

  const cases = [
    {
      view: "overview",
      empty: "No account data loaded",
      load: "Load account data",
      forbidden: ["Your Trades and Actual Fees", "Order history", "Money Movements"],
    },
    {
      view: "trades",
      empty: "Your Trades are not loaded",
      load: "Load account data",
      forbidden: ["Current balances", "Order history", "Money Movements", "Current fee rates"],
    },
    {
      view: "orders",
      empty: "Your Orders are not loaded",
      load: "Load account data",
      forbidden: ["Your Trades and Actual Fees", "Current balances", "Money Movements"],
    },
    {
      view: "transfers",
      empty: "Your money movements are not loaded",
      load: "Load account data",
      forbidden: ["Your Trades and Actual Fees", "Order history", "Current balances"],
    },
    {
      view: "pnl",
      empty: "Profit and loss inputs are not loaded",
      load: "Load account data",
      forbidden: ["Your Trades and Actual Fees", "Order history", "Current balances", "Money Movements"],
    },
  ];

  for (const testCase of cases) {
    it(`renders only the ${testCase.view} initial view and its own empty copy`, () => {
      const html = renderAccount(testCase.view);
      assert.ok(html.includes(testCase.empty));
      assert.ok(html.includes(testCase.load));
      for (const forbidden of testCase.forbidden) assert.ok(!html.includes(forbidden), forbidden);
      assert.ok(!html.includes("Balance history is not loaded"));
      assert.ok(!html.includes("Open orders are not loaded"));
      if (testCase.view === "transfers") assert.ok(!html.includes("<select"));
      else assert.ok(html.includes('aria-label="Account reporting period"'));
    });
  }

  it("uses the session-aware empty description instead of the locked copy after unlock", () => {
    const html = renderAccount("trades", { generation: "synthetic-generation", registeredKeyId: "ak_synthetic" });
    assert.ok(html.includes("Load account data"));
    assert.ok(!html.includes("Set up or unlock a read-only key in API setup"));
  });

  it("renders the locked private transfers state with public lookup as a separate choice", () => {
    const html = render(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/account/transactions"] },
        React.createElement(Portfolio),
      ),
    );
    assert.ok(html.includes("Unlock to view your transfers"));
    assert.ok(html.includes("No private request while locked"));
    assert.ok(html.includes("Public transaction lookup"));
    assert.ok(html.includes("Set up a key or use public lookup"));
    assert.ok(!html.includes("Public flow lookup results"));
  });

  it("keeps loaded-view sections bound to their own validated datasets", () => {
    const analytics = source("apps/web/src/components/AccountAnalytics.tsx");
    const tradesStart = analytics.indexOf('{view === "trades" && <Card');
    const transfersStart = analytics.indexOf('{view === "transfers" && <Card');
    const ordersStart = analytics.indexOf('{view === "orders" && <Card');
    const overviewStart = analytics.indexOf('{view === "overview" && <Card title="Current balances"');
    assert.ok(tradesStart >= 0 && transfersStart > tradesStart && ordersStart >= 0 && overviewStart >= 0);
    const trades = analytics.slice(tradesStart, transfersStart);
    assert.ok(trades.includes("snapshot.fills.data.summary.calculations.map"));
    assert.ok(trades.includes("<ExecutionFee fill={fill} />"));
    assert.ok(!trades.includes("snapshot.feeRates"));
    assert.ok(!trades.includes("makerFeeRatePercent"));
    assert.ok(!trades.includes("takerFeeRatePercent"));
    assert.ok(analytics.includes("snapshot.orders.data.orders.map"));
    assert.ok(analytics.includes("snapshot.transfers.data.transfers"));
    assert.ok(analytics.includes('<OpenOrdersCard dataset={openOrders}'));
    assert.ok(analytics.includes("Current rates are not historical execution fees"));
  });
});

describe("Account dataset status and error rendering", () => {
  it("renders permission denial without presenting an empty account", () => {
    const value = dataset("denied", "PERMISSION_DENIED");
    const html = render(React.createElement(React.Fragment, null,
      React.createElement(NoDataset, { dataset: value }),
      React.createElement(DatasetMessages, { dataset: value }),
      React.createElement(DatasetStatus, { dataset: value }),
    ));
    assert.ok(html.includes("Permission needed"));
    assert.ok(html.includes("does not have permission"));
    assert.ok(html.includes("No rows were inferred"));
    assert.ok(html.includes("does not mean your account is empty"));
  });

  it("renders malformed data as blocked and unavailable rather than zero", () => {
    const value = dataset("blocked", "SCHEMA_INCOMPATIBLE");
    const html = render(React.createElement(React.Fragment, null,
      React.createElement(NoDataset, { dataset: value }),
      React.createElement(DatasetMessages, { dataset: value }),
      React.createElement(DatasetStatus, { dataset: value }),
    ));
    assert.ok(html.includes("Account data unavailable"));
    assert.ok(html.includes("format this app does not understand"));
    assert.ok(html.includes("Affected numbers are blocked"));
    assert.ok(html.includes("Unavailable"));
  });

  it("preserves stale, partial, and temporary-error explanations", () => {
    const stale = dataset("stale", undefined);
    const partial = dataset("partial", undefined);
    const unavailable = dataset("unavailable", "SERVER");
    const staleHtml = render(React.createElement(DatasetMessages, { dataset: stale }));
    const partialHtml = render(React.createElement(DatasetMessages, { dataset: partial }));
    const unavailableHtml = render(React.createElement(DatasetMessages, { dataset: unavailable }));
    assert.ok(staleHtml.includes("may be out of date"));
    assert.ok(staleHtml.includes("not a complete history"));
    assert.ok(partialHtml.includes("Only part of the requested data is loaded"));
    assert.ok(partialHtml.includes("more pages may remain"));
    assert.ok(unavailableHtml.includes("temporarily unavailable"));
    assert.ok(unavailableHtml.includes("no public data was substituted"));
  });

  it("distinguishes loading and not-loaded status pills", () => {
    assert.ok(render(React.createElement(DatasetStatus, { dataset: null, loading: true })).includes("Loading"));
    assert.ok(render(React.createElement(DatasetStatus, { dataset: null })).includes("Not loaded"));
    assert.ok(render(React.createElement(DatasetStatus, { dataset: dataset("partial") })).includes("Partial data"));
  });
});

describe("Actual execution fee presentation", () => {
  it("renders the execution's actual fee and fee asset, not a current rate", () => {
    const value = fill();
    const calculation = account.calculateFill(value);
    assert.equal(calculation.signedFee.raw, "-0.8");
    assert.equal(calculation.dQuote.raw, "-1000.8");

    const html = render(React.createElement(ExecutionFee, { fill: value }));
    assert.ok(html.includes("Actual execution fee"));
    assert.ok(html.includes("0.8"));
    assert.ok(html.includes("USDT"));
    assert.ok(html.includes("fee"));
    assert.ok(!html.includes("makerFeeRatePercent"));
    assert.ok(!html.includes("takerFeeRatePercent"));
  });

  it("renders a real execution rebate separately and aggregates exact fees by asset", () => {
    const charge = fill();
    const rebate = fill({
      matchId: "match-2",
      orderId: "order-2",
      feeAsset: "BASE",
      feeMagnitude: "0.000008",
      feeIsRebate: true,
    });
    const html = render(React.createElement(ExecutionFee, { fill: rebate }));
    assert.ok(html.includes("Actual execution rebate"));
    assert.ok(html.includes("+"));
    assert.ok(html.includes("0.000008"));
    assert.ok(html.includes("BTC"));
    assert.ok(html.includes("rebate"));

    const summary = account.summarizeFills([charge, rebate], { status: "complete" });
    const quoteFees = summary.feesByAsset.find((entry) => entry.asset === "USDT");
    const baseFees = summary.feesByAsset.find((entry) => entry.asset === "BTC");
    assert.equal(quoteFees.grossCharges.raw, "0.8");
    assert.equal(quoteFees.grossRebates.raw, "0");
    assert.equal(quoteFees.netFees.raw, "0.8");
    assert.equal(baseFees.grossCharges.raw, "0");
    assert.equal(baseFees.grossRebates.raw, "0.000008");
    assert.equal(baseFees.netFees.raw, "-0.000008");
  });
});
