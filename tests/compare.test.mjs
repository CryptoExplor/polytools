import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const source = (path) => readFileSync(`${rootDir}/${path}`, "utf8");

let vite;
let compare;
let CompareEmptyState;

before(async () => {
  vite = await createServer({
    root: rootDir,
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  compare = await vite.ssrLoadModule("/apps/web/src/lib/compare.ts");
  ({ CompareEmptyState } = await vite.ssrLoadModule("/apps/web/src/pages/Compare.tsx"));
});

after(async () => {
  if (vite) await vite.close();
});

function market(symbol, overrides = {}) {
  return {
    symbolId: 1,
    symbol,
    lastPrice: "50000000",
    lastTradeTsMs: 1_700_000_000_000,
    change24hBps: 0,
    high24h: "51000000",
    low24h: "49000000",
    volume24hBase: "1",
    volume24hQuote: "50000",
    volume24hUsd: "50000",
    listedTsMs: 1_600_000_000_000,
    bestBid: "49900000",
    bestBidQty: "1",
    bestAsk: "50100000",
    bestAskQty: "1",
    indexPrice: "51000000",
    ...overrides,
  };
}

function emptyState(props) {
  return renderToStaticMarkup(React.createElement(CompareEmptyState, {
    allRowsCount: 0,
    overviewReceived: false,
    overviewError: false,
    onShowAll: () => undefined,
    onRetry: () => undefined,
    ...props,
  }));
}

describe("P2-10 Compare row derivation and zero-match filtering", () => {
  it("matches USDT and USDC with exact reference differences", () => {
    const rows = compare.buildCompareRows(
      [market("BTC-USDT"), market("BTC-USDC", { symbolId: 2 })],
      { bitcoin: { usd: 50_000 } },
      "index",
    );
    assert.deepEqual(rows.map((row) => row.status), ["matched", "matched"]);
    for (const row of rows) {
      assert.equal(row.refUsd, 50_000);
      assert.equal(row.absDiff, 1_000);
      assert.equal(row.premBps, 200);
    }

    const lastRows = compare.buildCompareRows(
      [market("BTC-USDT")],
      { bitcoin: { usd: 50_000 } },
      "last",
    );
    assert.equal(lastRows[0].absDiff, 0);
    assert.equal(lastRows[0].premBps, 0);
  });

  it("keeps non-USD quotes and unmapped assets out of matches", () => {
    const rows = compare.buildCompareRows(
      [market("ETH-BTC"), market("FOO-USDT", { symbolId: 2 })],
      { ethereum: { usd: 3_000 }, bitcoin: { usd: 50_000 } },
      "index",
    );
    assert.equal(rows[0].status, "non_usd_quote");
    assert.equal(rows[0].quote, "BTC");
    assert.equal(rows[1].status, "unmapped");
    for (const row of rows) {
      assert.equal(row.refUsd, null);
      assert.equal(row.absDiff, null);
      assert.equal(row.premBps, null);
    }
  });

  it("does not turn missing, zero, negative, or malformed references into matches", () => {
    for (const cg of [
      null,
      {},
      { bitcoin: {} },
      { bitcoin: { usd: 0 } },
      { bitcoin: { usd: -1 } },
      { bitcoin: { usd: Number.NaN } },
      { bitcoin: { usd: "50000" } },
    ]) {
      const [row] = compare.buildCompareRows([market("BTC-USDT")], cg, "index");
      assert.equal(row.status, "ref_unavailable");
      assert.equal(row.refUsd, null);
      assert.equal(row.absDiff, null);
      assert.equal(row.premBps, null);
    }
  });

  it("separates invalid Polyester prices from reference availability and preserves fallback", () => {
    const [invalid] = compare.buildCompareRows(
      [market("BTC-USDT", { indexPrice: "0", lastPrice: "0" })],
      { bitcoin: { usd: 50_000 } },
      "index",
    );
    assert.equal(invalid.status, "poly_unavailable");
    assert.equal(invalid.refUsd, 50_000);
    assert.equal(invalid.absDiff, null);
    assert.equal(invalid.premBps, null);

    const [fallback] = compare.buildCompareRows(
      [market("BTC-USDT", { indexPrice: "0", lastPrice: "51000000" })],
      { bitcoin: { usd: 50_000 } },
      "index",
    );
    assert.equal(fallback.status, "matched");
    assert.equal(fallback.absDiff, 1_000);
  });

  it("returns a real empty Matched result instead of substituting All Listed", () => {
    const allRows = compare.buildCompareRows(
      [market("ETH-BTC"), market("FOO-USDT", { symbolId: 2 }), market("BTC-USDT", { symbolId: 3 })],
      null,
      "index",
    );
    const matchedRows = allRows.filter((row) => row.status === "matched");
    assert.equal(matchedRows.length, 0);
    assert.deepEqual(compare.selectVisibleCompareRows(allRows, matchedRows, "matched"), []);
    assert.equal(compare.selectVisibleCompareRows(allRows, matchedRows, "all").length, 3);
  });
});

describe("P2-10 Compare provenance and empty states", () => {
  it("distinguishes live, wire-sample, and stale match labels", () => {
    assert.equal(compare.compareMatchLabel({ sample: false, stale: false }), "Live Match");
    assert.equal(compare.compareMatchLabel({ sample: true, stale: false }), "Sample Match");
    assert.equal(compare.compareMatchLabel({ sample: false, stale: true }), "Stale Match");
    assert.equal(compare.compareMatchLabel({ sample: true, stale: true }), "Sample Match");

    const page = source("apps/web/src/pages/Compare.tsx");
    assert.ok(page.includes("polyesterSample ? \"Sample data\""));
    assert.ok(page.includes("Development wire sample · not live"));
    assert.ok(page.includes("Feed error; last valid data retained"));
    assert.ok(page.includes("Poly Price Unavailable"));
  });

  it("renders distinct zero-match, empty-overview, and unavailable-feed states", () => {
    const zeroMatch = emptyState({ allRowsCount: 3, overviewReceived: true });
    assert.ok(zeroMatch.includes("No comparable prices right now"));
    assert.ok(zeroMatch.includes("Show All Listed"));
    assert.ok(zeroMatch.includes("never matches"));
    // Rows can be unmatched because Polyester has no price; do not blame CoinGecko alone.
    assert.ok(zeroMatch.includes("Polyester"));
    assert.ok(zeroMatch.includes("CoinGecko"));
    assert.ok(!zeroMatch.includes("No usable CoinGecko USD price"));
    assert.ok(!zeroMatch.includes("No comparison data available"));

    const emptyOverview = emptyState({ allRowsCount: 0, overviewReceived: true });
    assert.ok(emptyOverview.includes("No listed markets"));
    assert.ok(emptyOverview.includes("not a zero-match filter"));

    const unavailable = emptyState({ allRowsCount: 0, overviewError: true });
    assert.ok(unavailable.includes("No comparison data available"));
    assert.ok(unavailable.includes("no match count can be calculated"));
  });
});
