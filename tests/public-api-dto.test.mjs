import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
let vite;
let decodePublicApiResponse;
let PublicApiSchemaError;
let api;

before(async () => {
  vite = await createServer({ root: rootDir, logLevel: "silent", server: { middlewareMode: true } });
  ({ decodePublicApiResponse, PublicApiSchemaError } = await vite.ssrLoadModule("/apps/web/src/lib/publicDtos.ts"));
  ({ api } = await vite.ssrLoadModule("/apps/web/src/lib/api.ts"));
});

after(async () => {
  if (vite) await vite.close();
});

const marketCatalog = () => ({
  apiEnv: "testnet",
  tsSec: 1792664721000,
  assets: [{ asset: "BTC", ledgerId: 1, name: "Bitcoin", quantityDisplayDecimals: 8, quantityScale: 8 }],
  pairs: [{
    symbolId: 7,
    symbol: "BTC-USDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    tickSize: "0.01",
    stepSize: "0.0001",
    minNotionalQuote: "5",
    minQtyBase: "0.001",
    status: "enabled",
    listingAt: 1790000000000,
    delistingAt: null,
  }],
});

const overview = () => ({
  apiEnv: "testnet",
  markets: [{
    symbolId: 7,
    symbol: "BTC-USDT",
    lastPrice: "82132470",
    lastTradeTsMs: 1792664721425,
    change24hBps: -87,
    high24h: "85000000",
    low24h: "80300000",
    volume24hBase: "282.44500075",
    volume24hQuote: "23520703.65003",
    volume24hUsd: "23493871.560597",
    listedTsMs: 1788959288620,
    bestBid: "81959510",
    bestBidQty: "0.00030478",
    bestAsk: "82132470",
    bestAskQty: "0.04595134",
    indexPrice: "82064289.314399",
  }],
  nextPageToken: null,
});

const orderbook = () => ({
  apiEnv: "testnet",
  symbol: "BTC-USDT",
  symbolId: 7,
  depth: 5,
  bookSeq: "7379215",
  bestBid: { price: "81902680", qty: "0.13424745" },
  bestAsk: { price: "82132470", qty: "0.04595134" },
  bidCount: 1,
  askCount: 1,
  bids: [{ price: "81902680", qty: "0.13424745" }],
  asks: [{ price: "82132470", qty: "0.04595134" }],
});

const candles = () => ({
  apiEnv: "testnet",
  symbol: "BTC-USDT",
  symbolId: 7,
  timeframe: "1h",
  candleCount: 1,
  candles: [{
    time: 1792663200,
    open: "2404440",
    high: "2412410",
    low: "2397460",
    close: "2401530",
    volume: "37.400158",
    isClosed: false,
  }],
});

const trades = () => ({
  apiEnv: "testnet",
  symbol: "BTC-USDT",
  symbolId: 7,
  tradeCount: 1,
  trades: [{ matchId: "281474978150541", sideLabel: "sell", price: "81902680", qty: "0.04905255", tsMs: 1792664722564 }],
  nextPageToken: "opaque-next",
});

function wireSample(fileName) {
  const envelope = JSON.parse(readFileSync(new URL(`../docs/wire-samples/${fileName}`, import.meta.url), "utf8"));
  return envelope.result.structuredContent;
}

describe("public market DTO boundary", () => {
  it("accepts the checked-in public wire examples", () => {
    const fixtures = [
      ["/markets", "get_spot_markets.json"],
      ["/overview", "get_market_overview.json"],
      ["/orderbook", "get_orderbook.json"],
      ["/candles", "get_candles.json"],
      ["/trades", "get_recent_trades.json"],
    ];
    for (const [route, fileName] of fixtures) {
      assert.doesNotThrow(() => decodePublicApiResponse(route, wireSample(fileName)), fileName);
    }
  });

  it("validates explicit environment flags and cache counts without defaulting missing fields", () => {
    const payload = {
      ok: true,
      mcpConfigured: false,
      networks: {
        testnet: { mcpConfigured: true },
        mainnet: { mcpConfigured: false, note: "Set MCP_URL_MAINNET when announced." },
      },
      cache: { keys: 0, inFlight: 2 },
      futureField: "preserved",
    };
    assert.equal(decodePublicApiResponse("/env", payload), payload);
    assert.equal(payload.cache.keys, 0);
    assert.throws(
      () => decodePublicApiResponse("/env", { ...payload, cache: { inFlight: 0 } }),
      PublicApiSchemaError,
    );
    assert.throws(
      () => decodePublicApiResponse("/env", { ...payload, mcpConfigured: "false" }),
      PublicApiSchemaError,
    );
  });

  it("accepts the supported market catalog and preserves additive fields", () => {
    const payload = marketCatalog();
    payload.futureField = { preserved: true };
    payload.pairs[0].futurePairField = "additive";
    const decoded = decodePublicApiResponse("/markets", payload);
    assert.equal(decoded, payload);
    assert.deepEqual(decoded.futureField, { preserved: true });
    assert.equal(decoded.pairs[0].futurePairField, "additive");
  });

  it("rejects invalid identity, duplicate IDs, and missing numeric strings without inventing zero", () => {
    assert.throws(
      () => decodePublicApiResponse("/markets", { ...marketCatalog(), apiEnv: "" }),
      (error) => error instanceof PublicApiSchemaError && error.code === "SCHEMA_INCOMPATIBLE",
    );
    const duplicate = marketCatalog();
    duplicate.pairs.push({ ...duplicate.pairs[0], symbol: "ETH-USDT" });
    assert.throws(() => decodePublicApiResponse("/markets", duplicate), PublicApiSchemaError);
    const paddedIdentity = marketCatalog();
    paddedIdentity.pairs[0].symbol = " BTC-USDT ";
    assert.throws(() => decodePublicApiResponse("/markets", paddedIdentity), PublicApiSchemaError);

    const malformedPrice = overview();
    malformedPrice.markets[0].lastPrice = undefined;
    assert.throws(() => decodePublicApiResponse("/overview", malformedPrice), PublicApiSchemaError);
    const numericPrice = overview();
    numericPrice.markets[0].lastPrice = 0;
    assert.throws(() => decodePublicApiResponse("/overview", numericPrice), PublicApiSchemaError);
  });

  it("checks requested market identity while allowing empty filtered results", () => {
    assert.equal(decodePublicApiResponse("/overview", { apiEnv: "testnet", markets: [] }, { symbols: "BTC-USDT" }).markets.length, 0);
    assert.throws(
      () => decodePublicApiResponse("/overview", overview(), { symbols: "ETH-USDT" }),
      PublicApiSchemaError,
    );
  });

  it("validates book, candle, and trade identity and critical field shapes", () => {
    assert.equal(decodePublicApiResponse("/orderbook", orderbook(), { symbol: "BTC-USDT", depth: 5 }).symbol, "BTC-USDT");
    assert.equal(decodePublicApiResponse("/candles", candles(), { symbol: "BTC-USDT", tf: "1h" }).candles.length, 1);
    assert.equal(decodePublicApiResponse("/trades", trades(), { symbol: "BTC-USDT", limit: 50 }).trades[0].sideLabel, "sell");
    assert.throws(() => decodePublicApiResponse("/orderbook", orderbook(), { symbol: "ETH-USDT" }), PublicApiSchemaError);
    assert.throws(() => decodePublicApiResponse("/candles", candles(), { symbol: "BTC-USDT", tf: "1d" }), PublicApiSchemaError);
    const invalidTrade = trades();
    invalidTrade.trades[0].sideLabel = "unknown";
    assert.throws(() => decodePublicApiResponse("/trades", invalidTrade), PublicApiSchemaError);
  });

  it("enforces DTO validation in the browser client and maps invalid JSON safely", async () => {
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async () => new Response(JSON.stringify(trades()), { status: 200 });
      assert.equal((await api.trades("BTC-USDT")).trades.length, 1);

      globalThis.fetch = async () => new Response(JSON.stringify({ apiEnv: "testnet", symbol: "BTC-USDT", trades: [] }), { status: 200 });
      await assert.rejects(() => api.trades("BTC-USDT"), (error) => error instanceof PublicApiSchemaError);

      globalThis.fetch = async () => new Response("not json", { status: 200 });
      await assert.rejects(() => api.orderbook("BTC-USDT"), (error) => error instanceof PublicApiSchemaError);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
