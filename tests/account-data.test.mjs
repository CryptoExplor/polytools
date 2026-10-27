import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
let vite;
let account;

before(async () => {
  vite = await createServer({ root: rootDir, logLevel: "silent", server: { middlewareMode: true } });
  account = (await vite.ssrLoadModule("/packages/core/src/index.ts")).account;
});

after(async () => {
  if (vite) await vite.close();
});

function fill(overrides = {}) {
  return {
    accountScope: "synthetic-scope",
    symbol: "BTC-USDT",
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
    timestamp: "1",
    ...overrides,
  };
}

describe("Exact account arithmetic and coverage", () => {
  it("retains precision, normalizes negative zero, supports recurring rationals, and rounds only for display", () => {
    const left = account.parseDecimal("0.1000000000000000000000000001");
    const right = account.parseDecimal("0.2000000000000000000000000002");
    assert.equal(account.decimalToString(account.add(left, right)), "0.3000000000000000000000000003");
    assert.equal(account.parseDecimal("-0").raw, "0");
    assert.equal(account.parseDecimal("-0").sourceRaw, "-0");
    const third = account.divide(account.parseDecimal("1"), account.parseDecimal("3"));
    assert.equal(third.raw, "1/3");
    assert.equal(account.formatDecimal(third, 3), "0.333");
    assert.equal(account.formatDecimal(account.parseDecimal("0.125"), 2), "0.12");
    assert.equal(account.formatDecimal(account.parseDecimal("0.135"), 2), "0.14");
    assert.doesNotThrow(() => JSON.stringify(third));
    for (const invalid of ["", "NaN", "Infinity", "1e3", " 1", "1,2"]) {
      assert.throws(() => account.parseDecimal(invalid), (error) => error?.code === "INVALID_DECIMAL");
    }
  });

  it("computes total balance as trading plus funding without adding reserved or available", () => {
    const total = account.totalBalance({
      asset: "BTC",
      trading: "2.5",
      funding: "1.25",
      reserved: "0.5",
      available: "2.0",
    });
    assert.equal(total.raw, "3.75");
  });

  it("matches the hand-calculated quote-fee flat example without calling cash flow P&L", () => {
    const summary = account.summarizeFills([
      fill(),
      fill({
        matchId: "match-2",
        orderId: "order-2",
        side: "SELL",
        price: "110000",
        feeMagnitude: "0.88",
        timestamp: "2",
      }),
    ]);
    assert.equal(summary.calculations[0].dQuote.raw, "-1000.8");
    assert.equal(summary.calculations[1].dQuote.raw, "1099.12");
    assert.equal(summary.volumeByQuote[0].asset, "USDT");
    assert.equal(summary.volumeByQuote[0].value.raw, "2100");
    assert.equal(summary.observedNetQuoteFlowByQuote[0].value.raw, "98.32");
    assert.equal(summary.baseFlowByAsset[0].value.raw, "0");
    assert.equal(summary.feesByAsset[0].grossCharges.raw, "1.68");
    assert.equal(summary.feesByAsset[0].netFees.raw, "1.68");
    assert.equal("realizedPnl" in summary, false);
    assert.equal("pnl" in summary, false);
  });

  it("reduces acquired inventory by a base fee and credits a quote rebate", () => {
    const baseFee = account.calculateFill(fill({ feeAsset: "BASE", feeMagnitude: "0.000008" }));
    assert.equal(baseFee.dBase.raw, "0.009992");
    assert.equal(baseFee.dQuote.raw, "-1000");
    const rebate = account.calculateFill(fill({
      side: "SELL",
      quantity: "0.02",
      price: "5000",
      feeMagnitude: "0.01",
      feeIsRebate: true,
    }));
    assert.equal(rebate.dQuote.raw, "100.01");
    assert.throws(
      () => account.calculateFill(fill({ side: "SELL", feeAsset: "BASE" })),
      (error) => error?.code === "INCOMPATIBLE_DATA",
    );
  });

  it("keeps mixed quote and fee assets in separate exact groups", () => {
    const summary = account.summarizeFills([
      fill(),
      fill({
        symbol: "ETH-USDC",
        baseAsset: "ETH",
        quoteAsset: "USDC",
        matchId: "match-2",
        orderId: "order-2",
        quantity: "2",
        price: "3000",
        feeMagnitude: "0.5",
      }),
      fill({
        matchId: "match-3",
        orderId: "order-3",
        feeAsset: "BASE",
        feeMagnitude: "0.000008",
      }),
    ]);
    assert.deepEqual(summary.volumeByQuote.map((entry) => entry.asset), ["USDC", "USDT"]);
    assert.deepEqual(summary.feesByAsset.map((entry) => entry.asset), ["BTC", "USDC", "USDT"]);
    assert.equal(summary.volumeByQuote.find((entry) => entry.asset === "USDC").value.raw, "6000");
    assert.equal(summary.volumeByQuote.find((entry) => entry.asset === "USDT").value.raw, "2000");
  });

  it("collapses identical fills but blocks aggregates on conflicting financial duplicates", () => {
    const original = fill();
    const duplicate = account.summarizeFills([original, { ...original }]);
    assert.equal(duplicate.duplicateRows, 1);
    assert.equal(duplicate.rowsAccepted, 1);
    assert.equal(duplicate.eligible, true);
    const conflict = account.summarizeFills([original, { ...original, price: "100001" }]);
    assert.equal(conflict.conflictingRows, 1);
    assert.equal(conflict.eligible, false);
    assert.equal(conflict.metricLabel, "observed-metrics-blocked");
    const malformed = account.summarizeFills([{ ...original, quantity: "not-a-number" }]);
    assert.equal(malformed.unknownRows, 1);
    assert.equal(malformed.quarantined.length, 1);
    assert.equal(malformed.eligible, false);
  });

  it("reports order-agnostic sampled equity bounds without chronological metrics", () => {
    const metrics = account.sampledEquityMetrics(["100", "120", "90"]);
    assert.equal(metrics.sampleCount, 3);
    assert.equal(metrics.observedLow.raw, "90");
    assert.equal(metrics.observedHigh.raw, "120");
    assert.equal(metrics.label, "sampled-valuation-order-unverified-not-pnl");
    for (const chronologicalField of ["latest", "start", "change", "maxDrawdownAbsolute", "maxDrawdownPercent"]) {
      assert.equal(chronologicalField in metrics, false);
    }
    const reversed = account.sampledEquityMetrics(["90", "120", "100"]);
    assert.equal(reversed.observedLow.raw, metrics.observedLow.raw);
    assert.equal(reversed.observedHigh.raw, metrics.observedHigh.raw);
    assert.equal(account.sampledEquityMetrics([]).observedLow, undefined);
    assert.throws(() => account.sampledEquityMetrics(["100", "not-a-decimal"]));
  });

  it("requires clean exhausted coverage and separate basis/flow gates for P&L", () => {
    const coverage = account.emptyCoverage("fills", "synthetic-contract");
    assert.equal(account.observedMetricEligibility(coverage).available, false);
    coverage.status = "partial";
    assert.equal(account.observedMetricEligibility(coverage).available, true);
    coverage.status = "complete";
    coverage.cursorExhausted = true;
    coverage.pagesFetched = 1;
    coverage.openingBasis = "unknown";
    coverage.nonFillFlows = "unresolved";
    assert.equal(account.completeMetricEligibility(coverage).available, true);
    assert.equal(account.pnlEligibility(coverage).available, false);
    coverage.openingBasis = "supplied";
    coverage.nonFillFlows = "resolved";
    assert.equal(account.pnlEligibility(coverage, { quoteAssets: ["USDT"] }).available, true);
    assert.equal(account.pnlEligibility(coverage, { quoteAssets: ["USDT", "USDC"] }).available, false);
    coverage.stoppedAtCap = true;
    coverage.status = "partial";
    assert.equal(account.completeMetricEligibility(coverage).available, false);
  });

  it("preserves transport-level fill coverage when checking observed eligibility", () => {
    const summary = account.summarizeFills([fill()]);
    const coverage = account.emptyCoverage("fills", "synthetic-contract");
    Object.assign(coverage, {
      status: "partial",
      pagesFetched: 1,
      cursorExhausted: true,
      rowsReceived: 2,
      rowsAccepted: 1,
      unknownRows: 1,
    });
    // The summary is valid for its one normalized row, but the transport saw
    // an additional quarantined row. That unknown row must not be erased.
    assert.equal(account.observedFillEligibility(summary, coverage).available, false);

    const clean = account.emptyCoverage("fills", "synthetic-contract");
    Object.assign(clean, {
      status: "complete",
      pagesFetched: 1,
      cursorExhausted: true,
      rowsReceived: 1,
      rowsAccepted: 1,
    });
    assert.equal(account.observedFillEligibility(summary, clean).available, true);
  });

  it("estimates current fee scenarios without repricing history", () => {
    const scenario = account.currentRateScenario(
      account.parseDecimal("1000"),
      account.parseDecimal("-0.01"),
      account.parseDecimal("0.1"),
    );
    assert.equal(scenario.makerEstimate.raw, "-0.1");
    assert.equal(scenario.takerEstimate.raw, "1");
    assert.equal(scenario.label, "current-rate-scenario-not-historical-fee");
  });
});

describe("DTO validation and private memory partitions", () => {
  it("validates balances without rescaling and rejects incompatible numeric representations", () => {
    const result = account.validateBalancesResponse({
      balances: [{
        symbol: "BTC",
        trading: "2.5",
        funding: "1.25",
        reserved: "0.5",
        available: "2",
        tradingRevision: "4",
        fundingRevision: "5",
      }],
    });
    assert.equal(result.balances[0].trading, "2.5");
    assert.equal(account.totalBalance(result.balances[0]).raw, "3.75");
    assert.throws(() => account.validateBalancesResponse({
      balances: [{ ...result.balances[0], trading: "2.5e1" }],
    }), (error) => error?.name === "AccountSchemaError");
  });

  it("allows maker rebates but rejects negative taker fee rates", () => {
    const rate = {
      symbol: "BTC-USDT",
      makerFeeRatePercent: "-0.01",
      takerFeeRatePercent: "0.1",
      vipTier: 0,
    };
    assert.equal(account.validateFeeRatesResponse({ feeRates: [rate] }).feeRates[0].makerFeeRatePercent, "-0.01");
    assert.throws(
      () => account.validateFeeRatesResponse({ feeRates: [{ ...rate, takerFeeRatePercent: "-0.0001" }] }),
      (error) => error?.name === "AccountSchemaError",
    );
  });

  it("rejects misaligned history vectors and quarantines unknown fill markets", () => {
    assert.throws(() => account.validateEquityHistoryResponse({
      range: "1d",
      points: 2,
      btcPrices: ["100", "101"],
      series: [{ equity: ["1000"] }],
    }), (error) => error?.name === "AccountSchemaError");
    const page = account.validateFillsResponse({
      nextPageToken: "opaque-next",
      trades: [
        {
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
          symbol: "market-1",
        },
        { symbol: "unknown-market" },
      ],
      transfers: [],
    }, {
      accountScope: "synthetic-scope",
      markets: { "market-1": { baseAsset: "BTC", quoteAsset: "USDT", marketSymbol: "BTC-USDT" } },
    });
    assert.equal(page.fills.length, 1);
    assert.equal(page.fills[0].quantity, "0.01");
    assert.equal(page.fills[0].marketSymbol, "BTC-USDT");
    assert.equal(page.quarantined.length, 1);
    assert.equal(page.nextPageToken, "opaque-next");
  });

  it("accepts pair-string fills and omitted settlement legs but rejects ambiguous markets", () => {
    const rawFill = {
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
      symbol: "BTC-USDT",
    };
    const market = { baseAsset: "BTC", quoteAsset: "USDT", marketSymbol: "BTC-USDT" };
    const page = account.validateFillsResponse(
      { nextPageToken: "", trades: [rawFill] },
      { accountScope: "synthetic-scope", markets: { "1": market } },
    );
    assert.equal(page.fills.length, 1);
    assert.equal(page.fills[0].symbol, "1");
    assert.equal(page.fills[0].marketSymbol, "BTC-USDT");
    assert.equal(page.fills[0].baseAsset, "BTC");
    assert.equal(page.settlementLegs.length, 0);
    assert.equal(page.quarantined.length, 0);

    const ambiguous = account.validateFillsResponse(
      { nextPageToken: "", trades: [rawFill] },
      { accountScope: "synthetic-scope", markets: { "1": market, "2": { ...market } } },
    );
    assert.equal(ambiguous.fills.length, 0);
    assert.equal(ambiguous.quarantined.length, 1);
  });

  it("partitions private snapshots by session, scope, operation, and stable filters", () => {
    const store = new account.MemoryDatasetStore();
    const partition = {
      sessionGeneration: "generation-a",
      scopeKey: "scope-a",
      operation: "balances",
      filters: { range: "1d", symbols: ["BTC", "ETH"] },
    };
    const sameFiltersDifferentOrder = {
      ...partition,
      filters: { symbols: ["BTC", "ETH"], range: "1d" },
    };
    const otherScope = { ...partition, scopeKey: "scope-b" };
    store.set(partition, { rows: ["synthetic-a"] });
    assert.deepEqual(store.get(sameFiltersDifferentOrder), { rows: ["synthetic-a"] });
    assert.equal(store.get(otherScope), undefined);
    assert.equal(store.setIfCurrent(partition, { rows: ["late"] }, otherScope), undefined);
    assert.deepEqual(store.get(partition), { rows: ["synthetic-a"] });
    store.set(otherScope, { rows: ["synthetic-b"] });
    store.clearSession("generation-a");
    assert.equal(store.size, 0);
    let lifecycleListener;
    const unbind = store.bindLifecycle((listener) => {
      lifecycleListener = listener;
      return () => {};
    });
    store.set(partition, { rows: ["must-be-cleared"] });
    lifecycleListener({ type: "LOCK" });
    assert.equal(store.size, 0);
    store.set(partition, { rows: ["must-be-cleared-on-change"] });
    lifecycleListener({ type: "VAULT_CHANGED" });
    assert.equal(store.size, 0);
    unbind();
    store.dispose();
  });
});

describe("Opaque cursor ingestion", () => {
  it("continues through an empty intermediate page and preserves reserved cursor strings", async () => {
    const tokens = [];
    const pages = [
      { rows: [], nextPageToken: "a+b/% 字" },
      { rows: ["row-1"], nextPageToken: "next=1&x=2" },
      { rows: ["row-2"], nextPageToken: "" },
    ];
    const result = await account.collectCursorPages({
      fetchPage: async (token) => {
        tokens.push(token);
        return pages[tokens.length - 1];
      },
    });
    assert.deepEqual(tokens, [undefined, "a+b/% 字", "next=1&x=2"]);
    assert.deepEqual(result.rows, ["row-1", "row-2"]);
    assert.equal(result.cursorExhausted, true);
    assert.equal(result.pagesFetched, 3);
  });

  it("marks caps, repeated cursors, later errors, and aborts incomplete", async () => {
    const capped = await account.collectCursorPages({
      maxPages: 1,
      fetchPage: async () => ({ rows: [1], nextPageToken: "opaque" }),
    });
    assert.equal(capped.stoppedAtCap, true);
    assert.equal(capped.cursorExhausted, false);

    const repeated = await account.collectCursorPages({
      fetchPage: async () => ({ rows: [1], nextPageToken: "repeat" }),
    });
    assert.equal(repeated.repeatedCursor, true);
    assert.equal(repeated.cursorExhausted, false);
    assert.equal(repeated.error.code, "REPEATED_CURSOR");

    let page = 0;
    const laterError = await account.collectCursorPages({
      fetchPage: async () => {
        page += 1;
        if (page === 2) throw new Error("synthetic later failure");
        return { rows: ["prefix"], nextPageToken: "continue" };
      },
    });
    assert.deepEqual(laterError.rows, ["prefix"]);
    assert.equal(laterError.cursorExhausted, false);
    assert.equal(laterError.error.message, "synthetic later failure");

    const controller = new AbortController();
    controller.abort();
    const aborted = await account.collectCursorPages({
      signal: controller.signal,
      fetchPage: async () => ({ rows: [1], nextPageToken: "" }),
    });
    assert.equal(aborted.error.code, "ABORTED");
    assert.equal(aborted.rows.length, 0);
  });
});
