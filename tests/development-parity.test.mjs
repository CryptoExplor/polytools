import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const source = (path) => readFileSync(`${rootDir}/${path}`, "utf8");
const MCP_ENV = { MCP_URL: "https://example.com/mcp" };
const TX = `0x${"1".repeat(64)}`;

let vite;
let backend;
let devConfig;
let browserApi;
let provenance;
let WireSampleNotice;

before(async () => {
  vite = await createServer({
    root: rootDir,
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  backend = await vite.ssrLoadModule("/backend/src/handler.ts");
  devConfig = await vite.ssrLoadModule("/apps/web/vite.config.ts");
  browserApi = await vite.ssrLoadModule("/apps/web/src/lib/api.ts");
  provenance = await vite.ssrLoadModule("/apps/web/src/lib/provenance.ts");
  ({ WireSampleNotice } = await vite.ssrLoadModule(
    "/apps/web/src/components/WireSampleNotice.tsx",
  ));
});

after(async () => {
  if (vite) await vite.close();
});

function fallback(url, status) {
  return devConfig.devWireSampleFallbackForStatus(new URL(url), status);
}

describe("P2-8 shared production/development request matrix", () => {
  it("passes production validation and errors through without sample substitution", async () => {
    const cases = [
      ["GET", "http://local/api/orderbook", 400],
      ["GET", "http://local/api/orderbook?symbol=BTC-USDT&depth=7", 400],
      ["GET", "http://local/api/candles?symbol=BTC-USDT&tf=invalid", 400],
      ["GET", "http://local/api/candles?symbol=BTC-USDT&startTsSec=20&endTsSec=10", 400],
      ["GET", "http://local/api/trades?symbol=BTC-USDT&side=invalid", 400],
      ["GET", "http://local/api/heatmap?symbol=BTC-USDT&interval=1d", 400],
      ["GET", "http://local/api/heatmap?symbol=BTC-USDT&depth=7", 400],
      ["GET", "http://local/api/zipper/compare?asset=ETH&compareBy=invalid", 400],
      ["GET", "http://local/api/flow?flowId=not-valid", 400],
      ["GET", "http://local/api/flow/by-tx?txHash=not-valid", 400],
      ["GET", `http://local/api/flow/explain?txHash=${TX}&lookupKind=invalid`, 400],
      ["GET", "http://local/api/not-a-route", 404],
      ["POST", "http://local/api/markets", 405],
    ];

    for (const [method, url, expected] of cases) {
      const response = await backend.api(new Request(url, { method }), { env: MCP_ENV });
      assert.equal(response.status, expected, `${method} ${url}`);
      assert.equal(response.headers.get(provenance.WIRE_SAMPLE_HEADER), null);
      assert.equal(fallback(url, response.status), null, `${method} ${url} must not use samples`);
    }
  });

  it("labels every synthetic 502 fallback and preserves supported parameter shaping", () => {
    const cases = [
      ["http://local/api/markets", (body) => assert.ok(body.pairs.length > 0)],
      ["http://local/api/overview", (body) => assert.ok(body.markets.length > 0)],
      ["http://local/api/orderbook?symbol=ETH-USDT&depth=50", (body) => {
        assert.equal(body.symbol, "ETH-USDT");
        assert.equal(body.depth, 50);
      }],
      ["http://local/api/candles?symbol=SOL-USDT&tf=4h", (body) => {
        assert.equal(body.symbol, "SOL-USDT");
        assert.equal(body.timeframe, "4h");
      }],
      ["http://local/api/trades?symbol=BTC-USDT&side=buy", (body) => {
        assert.ok(body.trades.length > 0);
        assert.ok(body.trades.every((trade) => trade.sideLabel === "buy"));
        assert.equal(body.tradeCount, body.trades.length);
      }],
      ["http://local/api/heatmap?symbol=ETH-USDT&interval=5m&depth=100", (body) => {
        assert.equal(body.symbol, "ETH-USDT");
        assert.equal(body.interval, "5m");
        assert.equal(body.depth, 100);
      }],
      ["http://local/api/zipper/config", (body) => assert.ok(body.chains.length > 0)],
      ["http://local/api/zipper/routes?asset=USDT", (body) => {
        assert.equal(body.asset, "USDT");
        assert.ok(body.routes.length > 0);
      }],
      ["http://local/api/zipper/compare?asset=ETH&compareBy=depositMinAmount", (body) => {
        assert.equal(body.asset, "ETH");
        assert.equal(body.compareBy, "depositMinAmount");
      }],
      ["http://local/api/flow?flowId=00000000-0000-4000-8000-000000000000", (body) => {
        assert.equal(body.found, false);
      }],
      [`http://local/api/flow/by-tx?txHash=${TX}`, (body) => {
        assert.equal(body.txHash, TX);
        assert.equal(body.found, false);
      }],
      [`http://local/api/flow/explain?txHash=${TX}`, (body) => {
        assert.equal(body.txHash, TX);
        assert.equal(body.found, false);
      }],
    ];

    for (const [url, check] of cases) {
      const result = fallback(url, 502);
      assert.ok(result, url);
      assert.equal(result.status, 200, url);
      assert.equal(result.body.dataSource, provenance.WIRE_SAMPLE_DATA_SOURCE, url);
      check(result.body);
    }
  });

  it("has no private-account sample route and retains the separate no-store catalog", () => {
    for (const path of [
      "/v1/spot/config",
      "/v1/spot/fills",
      "/api/account/fills",
      "/api/private/orders",
    ]) {
      assert.equal(fallback(`http://local${path}`, 502), null, path);
    }
    const config = source("apps/web/vite.config.ts");
    assert.ok(!config.includes("AccountAnalytics"));
    assert.ok(!config.includes("fetchOfficialSpotCatalog"));

    const catalog = source("packages/core/src/account/catalog.ts");
    assert.ok(catalog.includes("POLYESTER_TESTNET_REST_ORIGIN"));
    assert.ok(catalog.includes('cache: "no-store"'));
  });
});

describe("P2-8 session-persistent sample provenance", () => {
  it("marks synthetic header responses through the public API client without credentials", async () => {
    const originalFetch = globalThis.fetch;
    let notifications = 0;
    let requestInit;
    const unsubscribe = browserApi.subscribeWireSampleUsage(() => {
      notifications += 1;
    });
    globalThis.fetch = async (_url, init) => {
      requestInit = init;
      return new Response(JSON.stringify({ dataSource: "wire-samples" }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          [provenance.WIRE_SAMPLE_HEADER]: "wire-samples",
        },
      });
    };
    try {
      await browserApi.api.markets();
      assert.equal(browserApi.hasUsedWireSamples(), true);
      assert.equal(notifications, 1);
      assert.equal(requestInit.headers.Accept, "application/json");
      assert.ok(!("Authorization" in requestInit.headers));
    } finally {
      globalThis.fetch = originalFetch;
      unsubscribe();
    }
  });

  it("renders an explicit non-dismissible notice and keeps it in the shared route layout", () => {
    const html = renderToStaticMarkup(React.createElement(WireSampleNotice));
    assert.ok(html.includes("Development wire samples used in this session"));
    assert.ok(html.includes("not live data or production-compatibility evidence"));
    assert.ok(html.includes("private account reads never use these samples"));
    assert.ok(!html.includes("Dismiss"));

    const layout = source("apps/web/src/components/Layout.tsx");
    assert.ok(layout.includes("{wireSampleUsed && <WireSampleNotice />}"));
    const outlet = "<Outlet context={registerAccountHeader} />";
    assert.ok(layout.includes(outlet));
    assert.ok(layout.indexOf("{wireSampleUsed && <WireSampleNotice />}") < layout.indexOf(outlet));

    const store = source("apps/web/src/lib/store.tsx");
    assert.ok(store.includes("useState(hasUsedWireSamples)"));
    assert.ok(store.includes("subscribeWireSampleUsage"));
    assert.ok(store.includes('if (dataSource === "wire-samples") setWireSampleUsed(true)'));

    const config = source("apps/web/vite.config.ts");
    assert.ok(config.includes("res.setHeader(WIRE_SAMPLE_HEADER, WIRE_SAMPLE_DATA_SOURCE)"));
    assert.ok(config.includes("productionStatus === 502"));
  });
});
