import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const PASSPHRASE = "synthetic REST passphrase";
const SEED = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const PUBLIC = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
const KEY_ID = "ak_synthetic_rest";
let vite;
let account;
const values = new Map();
const vaults = [];

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
  for (const vault of vaults) vault.dispose();
  if (vite) await vite.close();
});

async function connected(options = {}) {
  const vault = new account.AccountVault({
    storage: new account.MemoryVaultStorage(),
    legacyStorage: globalThis.localStorage,
    channel: null,
    ...options,
  });
  vaults.push(vault);
  await vault.importKey({
    label: "synthetic-rest",
    passphrase: PASSPHRASE,
    registeredKeyId: KEY_ID,
    privateKeyHex: SEED,
    publicKeyHex: PUBLIC,
  });
  return vault;
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

describe("Friendly REST read-only serializers", () => {
  it("uses exact operation paths and operation-specific query names", () => {
    assert.equal(account.buildReadRequest("balances").url, "https://api.testnet.polyester.com/v1/balances");
    assert.equal(
      account.buildReadRequest("balanceHistory", {
        subaccountId: "123456789",
        range: "30d",
        ledger: "BTC",
        accountCode: "trading",
      }).url,
      "https://api.testnet.polyester.com/v1/balances/history?account_code=trading&ledger=BTC&range=30d&subaccount_id=123456789",
    );
    assert.equal(
      account.buildReadRequest("transfers", {
        ledger: 7,
        pageToken: "cursor",
        reversed: true,
      }).url,
      "https://api.testnet.polyester.com/v1/transfers?ledger=7&page_token=cursor&reversed=true",
    );
    const open = account.buildReadRequest("ordersOpen", {
      symbol: ["ETH-USDT", "BTC-USDT"],
      side: "BUY",
      limit: 100,
    });
    assert.equal(open.path, "/v1/orders/open");
    assert.equal(open.canonicalQuery, "limit=100&side=BUY&symbol=BTC-USDT&symbol=ETH-USDT");
    assert.equal(open.url.endsWith(`?${open.canonicalQuery}`), true);
    assert.equal(account.buildReadRequest("fills", { symbol: "BTC-USDT" }).path, "/v1/spot/trades");
    assert.equal(account.buildReadRequest("feeRates").path, "/v1/spot/fee-rates");
  });

  it("encodes opaque cursors exactly once and preserves Unicode/reserved bytes", () => {
    const cursor = "a+b/% 字";
    const built = account.buildReadRequest("fills", { symbol: "BTC-USDT", pageToken: cursor });
    assert.equal(
      built.canonicalQuery,
      "pageToken=a%2Bb%2F%25%20%E5%AD%97&symbol=BTC-USDT",
    );
    assert.equal(built.url, `https://api.testnet.polyester.com/v1/spot/trades?${built.canonicalQuery}`);
    assert.equal(built.url.includes(cursor), false);
  });

  it("rejects unsupported filters, invalid cursor/method/origin, and conflicting fill scopes", () => {
    assert.throws(() => account.buildReadRequest("balances", { pageToken: "x" }), (error) => error?.code === "INVALID_REQUEST");
    assert.throws(() => account.buildReadRequest("fills", { afterMatchId: "2" }), (error) => error?.code === "INVALID_REQUEST");
    assert.throws(() => account.buildReadRequest("fills", { orderId: "abc", lineageId: "def" }), (error) => error?.code === "INVALID_REQUEST");
    assert.throws(() => account.buildReadRequest("fills", { pageToken: "bad\n" }), (error) => error?.code === "INVALID_REQUEST");
    assert.throws(() => account.buildReadRequest("createOrder"), (error) => error?.code === "INVALID_REQUEST");
    assert.throws(() => account.buildReadRequest("balances", {}, "https://api-testnet.polyester.com"), (error) => error?.code === "INVALID_REQUEST");
  });
});

describe("Signed fake-fetch account client", () => {
  it("signs the exact sent GET with safe fetch defaults and validates JSON before returning", async () => {
    const vault = await connected();
    const calls = [];
    const client = new account.AccountRestClient({
      vault,
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return jsonResponse({ synthetic: true });
      },
    });
    const result = await client.request("balances", {}, (value) => {
      assert.deepEqual(value, { synthetic: true });
      return value;
    });
    assert.equal(result.data.synthetic, true);
    assert.equal(calls.length, 1);
    const [{ url, init }] = calls;
    assert.equal(url, "https://api.testnet.polyester.com/v1/balances");
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "omit");
    assert.equal(init.cache, "no-store");
    assert.equal(init.redirect, "error");
    assert.equal(init.referrerPolicy, "no-referrer");
    assert.equal(init.mode, "cors");
    assert.equal(init.body, undefined);
    assert.equal(init.headers["X-API-KEY-ID"], KEY_ID);
    assert.match(init.headers["X-API-TIMESTAMP"], /^\d+$/);
    assert.match(init.headers["X-API-SIGNATURE"], /^[A-Za-z0-9+/]+={0,2}$/);
    assert.equal(result.contractVersion, account.ACCOUNT_CONTRACT_VERSION);
  });

  it("maps HTTP/structured errors without echoing response bodies or retrying permission failures", async () => {
    const vault = await connected();
    let calls = 0;
    const client = new account.AccountRestClient({
      vault,
      maxRetries: 2,
      retryBaseDelayMs: 0,
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({ code: "PERMISSION_DENIED", detail: "synthetic private detail" }, 403);
      },
    });
    await assert.rejects(
      () => client.request("balances", {}, (value) => value),
      (error) => {
        assert.equal(error.code, "PERMISSION_DENIED");
        assert.equal(error.message.includes("synthetic private detail"), false);
        assert.equal(error.toSafeError().operation, "balances");
        return true;
      },
    );
    assert.equal(calls, 1);
  });

  it("retries only bounded temporary failures with a fresh signature/timestamp", async () => {
    const vault = await connected();
    const timestamps = [];
    let calls = 0;
    const client = new account.AccountRestClient({
      vault,
      maxRetries: 1,
      retryBaseDelayMs: 0,
      sleepImpl: async () => undefined,
      fetchImpl: async (_url, init) => {
        calls += 1;
        timestamps.push(init.headers["X-API-TIMESTAMP"]);
        return calls === 1 ? jsonResponse({ code: "UNAVAILABLE" }, 503) : jsonResponse({ ok: true });
      },
    });
    const result = await client.request("balances", {}, (value) => value);
    assert.equal(result.data.ok, true);
    assert.equal(calls, 2);
    assert.equal(new Set(timestamps).size, 2);
  });

  it("fails closed on schema/content errors and CORS-like transport rejection", async () => {
    const vault = await connected();
    const badContent = new account.AccountRestClient({
      vault,
      fetchImpl: async () => new Response("not json", { status: 200, headers: { "content-type": "text/plain" } }),
    });
    await assert.rejects(
      () => badContent.request("balances", {}, (value) => value),
      (error) => error?.code === "SCHEMA_INCOMPATIBLE",
    );
    const badSchema = new account.AccountRestClient({
      vault,
      fetchImpl: async () => jsonResponse({ unexpected: true }),
    });
    await assert.rejects(
      () => badSchema.request("balances", {}, () => { throw new Error("synthetic schema mismatch"); }),
      (error) => error?.code === "SCHEMA_INCOMPATIBLE",
    );
    const cors = new account.AccountRestClient({
      vault,
      fetchImpl: async () => { throw new TypeError("synthetic CORS failure"); },
    });
    await assert.rejects(
      () => cors.request("balances", {}, (value) => value),
      (error) => error?.code === "CORS_BLOCKED",
    );
  });

  it("discards a deliberately late response after lock instead of returning private data", async () => {
    const vault = await connected();
    let release;
    let called;
    const calledPromise = new Promise((resolve) => { called = resolve; });
    const client = new account.AccountRestClient({
      vault,
      fetchImpl: async () => {
        called();
        return new Promise((resolve) => { release = resolve; });
      },
    });
    const pending = client.request("balances", {}, (value) => value);
    await calledPromise;
    await vault.lock();
    release(jsonResponse({ privateSyntheticRow: "must not escape" }));
    await assert.rejects(pending, (error) => error?.code === "ACCOUNT_STALE" || error?.code === "ABORTED");
  });
});
