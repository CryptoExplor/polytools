import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
let vite;
let hooks;
let identity;

before(async () => {
  vite = await createServer({ root: rootDir, logLevel: "silent", server: { middlewareMode: true } });
  hooks = await vite.ssrLoadModule("/apps/web/src/lib/hooks.ts");
  identity = await vite.ssrLoadModule("/apps/web/src/lib/marketIdentity.ts");
});

after(async () => {
  if (vite) await vite.close();
});

describe("request-keyed polling snapshots", () => {
  it("exposes data and freshness only for the dependencies that produced them", () => {
    const snapshot = {
      data: { symbol: "BTC-USDT" },
      dependencies: ["BTC-USDT", 50],
      updatedAt: 1234,
    };

    assert.equal(hooks.selectPollSnapshot(snapshot, ["BTC-USDT", 50]), snapshot);
    assert.equal(hooks.selectPollSnapshot(snapshot, ["ETH-USDT", 50]), null);
    assert.equal(hooks.selectPollSnapshot(snapshot, ["BTC-USDT"]), null);
    assert.equal(hooks.selectPollSnapshot(null, ["BTC-USDT", 50]), null);

    const errorSnapshot = {
      error: "synthetic failure",
      dependencies: ["BTC-USDT", 50],
      lastErrorAt: 5678,
    };
    assert.equal(hooks.selectPollErrorSnapshot(errorSnapshot, ["BTC-USDT", 50]), errorSnapshot);
    assert.equal(hooks.selectPollErrorSnapshot(errorSnapshot, ["ETH-USDT", 50]), null);
  });

  it("stores and returns response data with the matching request key and timestamp", async () => {
    const source = await readFile(new URL("../apps/web/src/lib/hooks.ts", import.meta.url), "utf8");
    assert.match(source, /data:\s*result,\s*dependencies:\s*deps\.slice\(\),\s*updatedAt:\s*Date\.now\(\)/);
    assert.match(source, /data:\s*currentSnapshot\?\.data\s*\?\?\s*null/);
    assert.match(source, /updatedAt:\s*currentSnapshot\?\.updatedAt\s*\?\?\s*null/);
  });
});

describe("parameterized response identity guards", () => {
  it("selects the requested market instead of assuming the first item is the selected one", () => {
    const markets = [
      { symbol: "ETH-USDT", lastPrice: "2000" },
      { symbol: "BTC-USDT", lastPrice: "90000" },
    ];
    assert.equal(identity.marketForSymbol(markets, "BTC-USDT"), markets[1]);
    assert.equal(identity.marketForSymbol(markets, "DOGE-USDT"), null);
    assert.equal(identity.marketForSymbol(undefined, "BTC-USDT"), null);
  });

  it("rejects order-book, candle, heatmap, and bridge responses for another request", () => {
    const book = { symbol: "BTC-USDT", depth: 50 };
    assert.equal(identity.orderbookForRequest(book, "BTC-USDT", 50), book);
    assert.equal(identity.orderbookForRequest(book, "ETH-USDT", 50), null);
    assert.equal(identity.orderbookForRequest(book, "BTC-USDT", 20), null);

    const candles = { symbol: "BTC-USDT", timeframe: "1h" };
    assert.equal(identity.candlesForRequest(candles, "BTC-USDT", "1h"), candles);
    assert.equal(identity.candlesForRequest(candles, "ETH-USDT", "1h"), null);
    assert.equal(identity.candlesForRequest(candles, "BTC-USDT", "1d"), null);

    const heatmap = { symbol: "BTC-USDT", interval: "5m", depth: 50 };
    assert.equal(identity.heatmapForRequest(heatmap, "BTC-USDT", "5m", 50), heatmap);
    assert.equal(identity.heatmapForRequest(heatmap, "ETH-USDT", "5m", 50), null);
    assert.equal(identity.heatmapForRequest(heatmap, "BTC-USDT", "1m", 50), null);
    assert.equal(identity.heatmapForRequest(heatmap, "BTC-USDT", "5m", 10), null);

    const comparison = {
      asset: "USDT",
      compareBy: "networkFee",
      chainFilter: "1",
    };
    assert.equal(identity.zipperCompareForRequest(comparison, "USDT", "networkFee", "1"), comparison);
    assert.equal(identity.zipperCompareForRequest(comparison, "BTC", "networkFee", "1"), null);
    assert.equal(identity.zipperCompareForRequest(comparison, "USDT", "depositMinAmount", "1"), null);
    assert.equal(identity.zipperCompareForRequest(comparison, "USDT", "networkFee", "2"), null);
    assert.equal(
      identity.zipperCompareForRequest(comparison, "USDT", "networkFee"),
      null,
      "a missing requested chain filter must not accept a response filtered to another chain",
    );
  });

  it("wires identity checks into each parameterized consumer and overview-price reader", async () => {
    const pages = {
      Book: await readFile(new URL("../apps/web/src/pages/Book.tsx", import.meta.url), "utf8"),
      Charts: await readFile(new URL("../apps/web/src/pages/Charts.tsx", import.meta.url), "utf8"),
      Heatmap: await readFile(new URL("../apps/web/src/pages/Heatmap.tsx", import.meta.url), "utf8"),
      Zipper: await readFile(new URL("../apps/web/src/pages/Zipper.tsx", import.meta.url), "utf8"),
      Calc: await readFile(new URL("../apps/web/src/pages/Calc.tsx", import.meta.url), "utf8"),
      SdkGuide: await readFile(new URL("../apps/web/src/pages/SdkGuide.tsx", import.meta.url), "utf8"),
    };

    assert.match(pages.Book, /orderbookForRequest\(data, symbol, depth\)/);
    assert.match(pages.Book, /marketForSymbol\(ov\?\.markets, symbol\)/);
    assert.match(pages.Charts, /candlesForRequest\(data, symbol, tf\)/);
    assert.match(pages.Charts, /marketForSymbol\(ov\?\.markets, symbol\)/);
    assert.match(pages.Heatmap, /heatmapForRequest\(data, symbol, interval, depth\)/);
    assert.match(pages.Zipper, /zipperCompareForRequest\(cmp, asset, compareBy, chainFilter\)/);
    assert.match(pages.Calc, /marketForSymbol\(ov\?\.markets, symbol\)/);
    assert.match(pages.SdkGuide, /marketForSymbol\(ov\?\.markets, symbol\)/);
  });
});
