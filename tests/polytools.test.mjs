import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));

/** @type {import('vite').ViteDevServer} */
let vite;
/** @type {any} */
let core;
/** @type {any} */
let handlerMod;
/** @type {any} */
let cacheMod;
/** @type {any} */
let nodeAdapterMod;

before(async () => {
  // Provide an in-memory localStorage shim for Node vault tests
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    clear: () => mem.clear(),
  };

  vite = await createServer({
    root: rootDir,
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  core = await vite.ssrLoadModule("/packages/core/src/index.ts");
  handlerMod = await vite.ssrLoadModule("/backend/src/handler.ts");
  cacheMod = await vite.ssrLoadModule("/backend/src/cache.ts");
  nodeAdapterMod = await vite.ssrLoadModule("/backend/adapters/node.ts");
});

after(async () => {
  if (vite) await vite.close();
});

describe("1. @poly/core normalize & wire-sample decoding (PRICE_SCALE = 3)", () => {
  it("decodes scaled integer prices by 10^3 and plain decimal quantities", () => {
    assert.equal(core.PRICE_SCALE, 3);
    assert.equal(core.price("82132470"), 82132.47);
    assert.equal(core.price("81361800"), 81361.8);
    assert.equal(core.price("998780"), 998.78);
    assert.equal(core.price("1000"), 1);
    assert.equal(core.dec("0.22854903"), 0.22854903);
    assert.ok(Number.isNaN(core.price("")));
    assert.ok(Number.isNaN(core.price(null)));
  });

  it("matches BTC-USDT lastPrice and indexPrice in docs/wire-samples/get_market_overview.json", () => {
    const raw = JSON.parse(
      readFileSync(`${rootDir}/docs/wire-samples/get_market_overview.json`, "utf8"),
    );
    const markets = raw.result?.structuredContent?.markets ?? raw.structuredContent?.markets;
    const btc = markets.find((m) => m.symbol === "BTC-USDT");
    assert.ok(btc, "BTC-USDT present in wire sample");
    assert.equal(core.price(btc.lastPrice), 82132.47);
    assert.equal(core.price(btc.low24h), 80300);
  });

  it("computes spreadBps, cumulativeDepth, and wallIndexes accurately", () => {
    const bid = 81902.68;
    const ask = 82132.47;
    const sp = core.spreadBps(bid, ask);
    assert.ok(sp > 28 && sp < 28.1);
    assert.ok(Number.isNaN(core.spreadBps(0, 100)));

    const obRaw = JSON.parse(
      readFileSync(`${rootDir}/docs/wire-samples/get_orderbook.json`, "utf8"),
    );
    const ob = obRaw.result?.structuredContent ?? obRaw.structuredContent;
    const bidLvls = ob.bids
      .map((l) => ({ price: core.price(l.price), qty: core.dec(l.qty) }))
      .sort((a, b) => b.price - a.price);
    const askLvls = ob.asks
      .map((l) => ({ price: core.price(l.price), qty: core.dec(l.qty) }))
      .sort((a, b) => a.price - b.price);
    const bids = core.cumulativeDepth(bidLvls);
    const asks = core.cumulativeDepth(askLvls);
    assert.ok(bids.length > 0 && asks.length > 0);
    // Outward cumulative order: bids descending price, asks ascending price
    assert.ok(bids[0].price >= bids[bids.length - 1].price);
    assert.ok(asks[0].price <= asks[asks.length - 1].price);
    assert.ok(bids[bids.length - 1].cum >= bids[0].cum);
    assert.ok(asks[asks.length - 1].cum >= asks[0].cum);
    const walls = core.wallIndexes([1, 1, 1, 1, 10], 3);
    assert.equal(walls.has(4), true);
  });
});

describe("2. @poly/core McpClient (DEF-01 isError throws & DEF-04 session-only retry)", () => {
  it("throws McpError when result.isError === true and does NOT retry session", async () => {
    let toolCalls = 0;
    let initCalls = 0;
    const fakeFetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.method === "initialize") {
        initCalls++;
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18" } }),
          { status: 200, headers: { "mcp-session-id": "sess-1" } },
        );
      }
      if (body.method === "notifications/initialized") {
        return new Response("{}", { status: 200 });
      }
      if (body.method === "tools/call") {
        toolCalls++;
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: {
              isError: true,
              content: [{ type: "text", text: "validation error: invalid txHash format" }],
            },
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    };

    const client = new core.McpClient({
      url: "https://example.com/mcp",
      fetchImpl: fakeFetch,
    });

    await assert.rejects(
      () => client.callTool("explain_transaction", { txHash: "0xdeadbeef" }),
      (err) => {
        assert.ok(err instanceof core.McpError);
        assert.match(err.message, /validation error: invalid txHash format/);
        return true;
      },
    );
    assert.equal(initCalls, 1, "should not re-initialize session on tool validation error");
    assert.equal(toolCalls, 1, "should not retry tool call on result.isError");
  });

  it("resets sessionId and retries once when HTTP 404 Session not found occurs", async () => {
    let toolCalls = 0;
    let initCalls = 0;
    const fakeFetch = async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.method === "initialize") {
        initCalls++;
        return new Response(
          JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }),
          { status: 200, headers: { "mcp-session-id": `sess-${initCalls}` } },
        );
      }
      if (body.method === "notifications/initialized") {
        return new Response("{}", { status: 200 });
      }
      if (body.method === "tools/call") {
        toolCalls++;
        if (toolCalls === 1) {
          return new Response("Session not found", { status: 404 });
        }
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: { structuredContent: { apiEnv: "testnet", ok: true } },
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    };

    const client = new core.McpClient({
      url: "https://example.com/mcp",
      fetchImpl: fakeFetch,
    });

    const out = await client.callTool("get_spot_markets");
    assert.deepEqual(out, { apiEnv: "testnet", ok: true });
    assert.equal(initCalls, 2, "re-initialized session once after 404");
    assert.equal(toolCalls, 2, "retried tool call once after 404");
  });
});

describe("3. Backend handler allowlists, Node adapter path fix, and bounded TTL cache", () => {
  it("resolves /api/health in node.ts without doubling /api prefix (DEF-02)", async () => {
    const fakeIncoming = {
      url: "/api/health",
      method: "GET",
      headers: { host: "localhost:8787" },
    };
    const webReq = await nodeAdapterMod.toWebRequest(fakeIncoming);
    assert.equal(new URL(webReq.url).pathname, "/api/health");
    const res = await handlerMod.api(webReq);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
  });

  it("rejects non-allowlisted depth, timeframe, side, interval, compareBy, invalid numeric/range params, and empty strings with 400 (DEF-03, DEF-11)", async () => {
    const cases = [
      "http://localhost/api/orderbook?symbol=BTC-USDT&depth=7",
      "http://localhost/api/candles?symbol=BTC-USDT&tf=2h",
      "http://localhost/api/candles?symbol=BTC-USDT&tf=1h&limit=abc",
      "http://localhost/api/candles?symbol=BTC-USDT&tf=1h&startTsSec=1700000500&endTsSec=1700000000",
      "http://localhost/api/trades?symbol=BTC-USDT&side=hold",
      "http://localhost/api/heatmap?symbol=BTC-USDT&interval=10m",
      "http://localhost/api/heatmap?symbol=BTC-USDT&depth=15",
      "http://localhost/api/zipper/compare?asset=USDT&compareBy=speed",
      "http://localhost/api/flow?flowId=invalid-flow-id",
      "http://localhost/api/flow/explain?txHash=0xdeadbeef",
      "http://localhost/api/flow/explain?txHash=%20%20",
    ];
    for (const url of cases) {
      const res = await handlerMod.api(new Request(url));
      assert.equal(res.status, 400, `Expected 400 for ${url}, got ${res.status}`);
    }
  });

  it("caps cache size at 200 keys and preserves long-TTL entries over short-TTL entries (DEF-12)", async () => {
    cacheMod.clearCache();
    let longCalls = 0;
    await cacheMod.cached("zipper:config", 300_000, async () => {
      longCalls++;
      return "long-lived";
    });
    for (let i = 0; i < 245; i++) {
      await cacheMod.cached(`k-${i}`, 1_500, async () => i);
    }
    const stats = cacheMod.cacheStats();
    assert.ok(stats.keys <= 200, `Expected cache keys <= 200, got ${stats.keys}`);
    const retained = await cacheMod.cached("zipper:config", 300_000, async () => {
      longCalls++;
      return "recomputed";
    });
    assert.equal(retained, "long-lived");
    assert.equal(longCalls, 1);
    cacheMod.clearCache();
  });
  it("enforces HTTPS or localhost in resolveMcpUrl (SEC-10)", () => {
    assert.equal(
      core.resolveMcpUrl("testnet", "https://custom.polyester.com/mcp"),
      "https://custom.polyester.com/mcp",
    );
    assert.equal(
      core.resolveMcpUrl("testnet", "http://localhost:8787/mcp"),
      "http://localhost:8787/mcp",
    );
    // Reject non-HTTPS external URLs and fall back to default testnet MCP URL
    assert.equal(
      core.resolveMcpUrl("testnet", "http://evil.example.com/mcp"),
      core.NETWORKS.testnet.mcpUrl,
    );
    assert.equal(
      core.resolveMcpUrl("testnet", "javascript:alert(1)"),
      core.NETWORKS.testnet.mcpUrl,
    );
  });
});

describe("4. Shared canonical-request primitives (SEC-01, SEC-07)", () => {
  it("normalizes the official query example, handles malformed escapes, and hashes actual body bytes", async () => {
    assert.equal(
      core.vault.EMPTY_BODY_SHA256,
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    const rawQuery = "tag=z&q=hello+world&literal=%2B&tag=a&empty=";
    assert.equal(
      core.vault.normalizeCanonicalQuery(rawQuery),
      "empty=&literal=%2B&q=hello%20world&tag=a&tag=z",
    );
    assert.equal(
      core.vault.normalizeCanonicalQuery("filter=50%&incomplete=%2"),
      "filter=50%25&incomplete=%252",
    );
    assert.equal(await core.vault.sha256Hex(""), core.vault.EMPTY_BODY_SHA256);
    assert.equal(
      await core.vault.sha256Hex("abc"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("blocks prefix-key queries whose documentation and pinned-SDK orderings conflict", () => {
    assert.throws(
      () => core.vault.normalizeCanonicalQuery("a=first&a-b=second"),
      (error) => error?.code === "AMBIGUOUS_QUERY_CONTRACT",
    );
    const inspected = core.vault.canonicalizeQuery("a=first&a-b=second", {
      rejectAmbiguous: false,
    });
    assert.equal(inspected.ambiguousOrdering, true);
    assert.equal(inspected.canonicalQuery, "a=first&a-b=second");
  });

  it("supports only exact 32-byte public keys for Bring Your Own Key", () => {
    const sampleHex =
      "0efa75cad8790e3c3238b41790658bff5dab2617bd28e30533f35e77bfe190bd";
    assert.equal(core.vault.normalizePublicKeyHex(sampleHex), sampleHex);
    assert.equal(core.vault.normalizePublicKeyHex(`0x${sampleHex.toUpperCase()}`), sampleHex);
    assert.equal(core.vault.normalizePublicKeyHex("0x1234"), null);
    assert.equal(core.vault.pubKeyB64ToHex(core.vault.pubKeyHexToB64(sampleHex)), sampleHex);
  });

  it("builds the exact five-line canonical string without a trailing newline", () => {
    const canonical = core.vault.buildCanonicalString({
      timestamp: "1773964800123",
      method: "post",
      path: "/v1/orders",
      query: "recvWindow=5000&accountId=acc_1",
      bodySha256Hex:
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    });
    assert.equal(
      canonical,
      "1773964800123\nPOST\n/v1/orders\naccountId=acc_1&recvWindow=5000\nba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    assert.equal(canonical.endsWith("\n"), false);
  });
});
