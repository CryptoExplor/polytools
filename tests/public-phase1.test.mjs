import { after, before, describe, it } from "node:test";
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

let vite;
let formatCompactQuoteNotional;
let decodeHeatmapBuckets;
let converterPriceReducer;
let telemetry;
let dashboard;
let Hub;
let AppProvider;

before(async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear(),
  };

  vite = await createServer({
    root: rootDir,
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ formatCompactQuoteNotional } = await vite.ssrLoadModule(
    "/apps/web/src/lib/format.ts",
  ));
  ({ decodeHeatmapBuckets } = await vite.ssrLoadModule(
    "/apps/web/src/lib/heatmap.ts",
  ));
  ({ converterPriceReducer } = await vite.ssrLoadModule(
    "/apps/web/src/lib/converter.ts",
  ));
  telemetry = await vite.ssrLoadModule("/apps/web/src/lib/telemetry.ts");
  dashboard = await vite.ssrLoadModule("/apps/web/src/pages/Dashboard.tsx");
  ({ default: Hub } = await vite.ssrLoadModule("/apps/web/src/pages/Hub.tsx"));
  ({ AppProvider } = await vite.ssrLoadModule("/apps/web/src/lib/store.tsx"));
});

after(async () => {
  if (vite) await vite.close();
});

function heatBucket({ tsSec = 1, bids = [], asks = [] } = {}) {
  return {
    tsSec,
    bids: {
      price: bids.map(([px]) => px),
      qty: bids.map(([, qty]) => qty),
    },
    asks: {
      price: asks.map(([px]) => px),
      qty: asks.map(([, qty]) => qty),
    },
  };
}

describe("Phase 1 quote-notional units", () => {
  it("uses $ only for actual USD quote denomination and labels non-USD fixtures", () => {
    assert.equal(formatCompactQuoteNotional(2500, "USD"), "$2.50K");
    assert.equal(formatCompactQuoteNotional(2500, "USDT"), "2.50K USDT");
    assert.equal(formatCompactQuoteNotional(2500, "BTC"), "2.50K BTC");
    assert.equal(formatCompactQuoteNotional(2500, "ETH"), "2.50K ETH");
    assert.ok(!formatCompactQuoteNotional(2500, "BTC").includes("$"));
  });

  it("wires visible notionals, thresholds, and alerts to the selected quote asset", () => {
    const tape = source("apps/web/src/pages/Tape.tsx");
    const book = source("apps/web/src/pages/Book.tsx");
    const heatmap = source("apps/web/src/pages/Heatmap.tsx");
    const depth = source("apps/web/src/components/DepthChart.tsx");

    for (const text of [tape, book, heatmap, depth]) {
      assert.ok(
        !/fmtCompact\([^)]*"\$"/.test(text),
        "quote notionals must not use the dollar-prefixed compact formatter",
      );
    }
    for (const text of [tape, book, heatmap]) {
      assert.ok(text.includes("formatCompactQuoteNotional"));
    }
    assert.ok(tape.includes("t.notional >= curThreshold"));
    assert.ok(tape.includes("formatCompactQuoteNotional(threshold, quote)"));
    assert.ok(tape.includes("formatCompactQuoteNotional(biggest.notional, curQuote)"));
    assert.ok(book.includes("quoteAsset={quote}"));
    assert.ok(depth.includes("formatCompactQuoteNotional(hover.cum * hover.price, quoteAsset)"));
    assert.ok(!depth.includes('fmtCompact(hover.cum * hover.price, "$")'));
  });
});

describe("Phase 1 Heatmap decoding", () => {
  it("distinguishes empty and zero-only responses from renderable liquidity", () => {
    assert.equal(decodeHeatmapBuckets([]), null);
    const zeroOnly = heatBucket({
      bids: [["100000", "0"]],
      asks: [["101000", "0.000"]],
    });
    assert.equal(decodeHeatmapBuckets([zeroOnly]), null);
  });

  it("retains a valid non-zero single-price book with a separate render domain", () => {
    const flat = heatBucket({
      bids: [["90000", "0"], ["100000", "2"]],
      asks: [["100000", "3"]],
    });
    const decoded = decodeHeatmapBuckets([flat]);
    assert.ok(decoded);
    assert.equal(decoded.minPx, 100);
    assert.equal(decoded.maxPx, 100);
    assert.ok(decoded.renderMinPx < 100);
    assert.ok(decoded.renderMaxPx > 100);
    assert.ok(Number.isFinite(decoded.binSize) && decoded.binSize > 0);
    assert.equal(decoded.buckets[0].bestBid, 100);
    assert.equal(decoded.buckets[0].bestAsk, 100);
    assert.equal(decoded.buckets[0].totalBidQty, 2);
    assert.equal(decoded.buckets[0].totalAskQty, 3);
    assert.equal(decoded.grid.length, 1);
    assert.equal(decoded.grid[0].length, 36);
    assert.equal(decoded.bandTotals.length, 1);
    assert.equal(decoded.bandTotals[0].totalQty, 5);
  });

  it("preserves normal multi-price extrema and separated liquidity bands", () => {
    const normal = heatBucket({
      bids: [["99000", "1"], ["100000", "2"]],
      asks: [["101000", "4"]],
    });
    const decoded = decodeHeatmapBuckets([normal]);
    assert.ok(decoded);
    assert.equal(decoded.minPx, 99);
    assert.equal(decoded.maxPx, 101);
    assert.equal(decoded.renderMinPx, 99);
    assert.equal(decoded.renderMaxPx, 101);
    assert.equal(decoded.buckets[0].bestBid, 100);
    assert.equal(decoded.buckets[0].bestAsk, 101);
    assert.equal(decoded.bandTotals.length, 3);
    assert.equal(
      decoded.bandTotals.reduce((sum, band) => sum + band.totalQty, 0),
      7,
    );
  });
});

describe("Phase 1 Calculator reference-price ownership", () => {
  it("keeps a manual edit after a poll and changes only on explicit forced sync", () => {
    const live = converterPriceReducer(
      { value: 82000, manual: false },
      { type: "sync", value: 83000 },
    );
    assert.deepEqual(live, { value: 83000, manual: false });

    const manual = converterPriceReducer(live, { type: "edit", value: 90000 });
    assert.deepEqual(manual, { value: 90000, manual: true });

    const afterPoll = converterPriceReducer(manual, { type: "sync", value: 84000 });
    assert.strictEqual(afterPoll, manual, "blocked poll preserves the manual state object");
    assert.equal(afterPoll.value, 90000);

    const explicitlySynced = converterPriceReducer(manual, {
      type: "sync",
      value: 85000,
      force: true,
    });
    assert.deepEqual(explicitlySynced, { value: 85000, manual: false });
  });
});

describe("Phase 1 Hub telemetry availability", () => {
  it("preserves actual false/zero values and labels only missing values", () => {
    assert.equal(telemetry.formatBooleanTelemetry(false, false), "false");
    assert.equal(telemetry.formatBooleanTelemetry(true, false), "true");
    assert.equal(telemetry.formatBooleanTelemetry(undefined, true), "Pending");
    assert.equal(telemetry.formatBooleanTelemetry(undefined, false), "Unknown");
    assert.equal(telemetry.formatCountTelemetry(0, false, " / 200 max"), "0 / 200 max");
    assert.equal(telemetry.formatCountTelemetry(undefined, true), "Pending");
    assert.equal(telemetry.formatCountTelemetry(undefined, false), "Unknown");
  });

  it("SSR initial loading does not fabricate pairs, MCP flags, cache counts, or live source", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(AppProvider, null, React.createElement(Hub)),
      ),
    );
    assert.ok(html.includes("Pending"));
    assert.ok(!html.includes("19 pairs"));
    assert.ok(!html.includes("0 / 200 max"));
    assert.ok(!html.includes(">true<"));
    assert.ok(!html.includes(">false<"));
    assert.ok(!html.includes("live MCP endpoint"));
  });
});

describe("Phase 1 Dashboard navigation and independent controls", () => {
  it("selects the symbol and navigates Book to the public /book route", () => {
    assert.deepEqual(dashboard.DASHBOARD_TOOL_PATHS, {
      book: "/book",
      tape: "/tape",
      charts: "/charts",
      heatmap: "/heatmap",
    });
    const calls = [];
    dashboard.openDashboardTool(
      "ETH-BTC",
      "book",
      (symbol) => calls.push(["symbol", symbol]),
      (path) => calls.push(["navigate", path]),
    );
    assert.deepEqual(calls, [
      ["symbol", "ETH-BTC"],
      ["navigate", "/book"],
    ]);
  });

  it("uses native independent buttons without row activation or nested tooltip buttons", () => {
    const text = source("apps/web/src/pages/Dashboard.tsx");
    assert.ok(!text.includes("/account/order-book"));
    assert.ok(!text.includes('role="button"'));
    assert.ok(!text.includes("tabIndex={0}"));
    assert.ok(!text.includes("onKeyDown"));
    assert.ok(!text.includes("interactive-row"));
    assert.ok(!text.includes("<TermTip"));
    assert.ok(text.includes('className="market-open-btn"'));
    assert.ok(text.includes('onClick={() => toggleWatchlist(m.symbol)}'));
    assert.ok(text.includes('onClick={() => openTool(m.symbol, "book")}'));
    assert.ok(text.includes("title={tip}"));

    // Structural event-wiring check only: native Enter/Space and mouse behavior
    // still require a real browser/AT pass; no DOM or browser is used here.
    const rowTags = text.match(/<tr\b[^>]*>/g) ?? [];
    assert.ok(rowTags.length > 0);
    for (const tag of rowTags) {
      assert.ok(!tag.includes("onClick"));
      assert.ok(!tag.includes("onKeyDown"));
      assert.ok(!tag.includes("role="));
      assert.ok(!tag.includes("tabIndex"));
    }
  });
});
