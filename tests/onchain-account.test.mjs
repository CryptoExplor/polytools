/**
 * The on-chain account view: address derivation plus funding balances read from a
 * public explorer. Proves nothing about the exchange — the entire point is that
 * this path needs no exchange login.
 */
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import { createServer as createVite } from "vite";

const SMART = `0x${"a1".repeat(20)}`;
const SIGNER = `0x${"b2".repeat(20)}`;
const TOKEN = `0x${"c3".repeat(20)}`;

let vite;
let client;
let backend;
let explorer;

before(async () => {
  vite = await createVite({
    root: new URL("..", import.meta.url).pathname,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "error",
  });
  client = await vite.ssrLoadModule("/apps/web/src/lib/onchainAccount.ts");
  backend = await vite.ssrLoadModule("/backend/src/handler.ts");
  explorer = await vite.ssrLoadModule("/backend/src/onchainBalances.ts");
});

// Without this the dev server keeps the process alive and the run appears to hang.
after(async () => {
  await vite?.close();
});

const jsonResponse = (status, payload) => async () =>
  new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

const rejectsWith = async (promise, code) => {
  try {
    await promise;
  } catch (error) {
    assert.equal(error.code, code, `expected ${code}, got ${error.code}`);
    return;
  }
  assert.fail(`expected ${code}, but the promise resolved`);
};

const row = (symbol, value, decimals = 6, type = "ERC-20", contract = TOKEN) => ({
  value,
  token: { address_hash: contract, symbol, name: `${symbol} token`, decimals: String(decimals), type },
});

describe("formatting token amounts", () => {
  it("formats without floating point", () => {
    assert.equal(explorer.formatUnits("1000000", 6), "1");
    assert.equal(explorer.formatUnits("1500000", 6), "1.5");
    assert.equal(explorer.formatUnits("123456789", 6), "123.456789");
    assert.equal(explorer.formatUnits("0", 0), "0");
    assert.equal(explorer.formatUnits("1", 0), "1");
  });

  it("stays exact beyond Number.MAX_SAFE_INTEGER", () => {
    // An 18-decimal balance routinely exceeds 2^53; Number() would round it.
    assert.equal(explorer.formatUnits("123456789012345678901234567890", 18), "123,456,789,012.34567890123456789");
  });

  it("groups thousands and trims trailing zeros", () => {
    assert.equal(explorer.formatUnits("1234567000", 6), "1,234.567");
    assert.equal(explorer.formatUnits("12000", 3), "12");
  });

  it("rejects input it cannot represent", () => {
    assert.equal(explorer.formatUnits("1.5", 6), null);
    assert.equal(explorer.formatUnits("-12", 6), null);
    assert.equal(explorer.formatUnits("12", -1), null);
    assert.equal(explorer.formatUnits("12", 99), null);
  });
});

describe("normalising an explorer payload", () => {
  it("keeps real holdings and drops zero-value spam, native coins and NFTs", () => {
    const rows = explorer.parseExplorerBalances([
      row("USDT", "2500000"),
      row("SPAM", "0", 18),
      row("NFT", "1", 0, "ERC-721"),
      { value: "1", token: null },
      { value: "5" },
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].symbol, "USDT");
    assert.equal(rows[0].formatted, "2.5");
  });

  it("sorts the largest holding first", () => {
    const rows = explorer.parseExplorerBalances([row("USDC", "1000000"), row("USDT", "9000000")]);
    assert.deepEqual(rows.map((r) => r.symbol), ["USDT", "USDC"]);
  });

  it("returns nothing for an unfunded account, rather than throwing", () => {
    assert.deepEqual(explorer.parseExplorerBalances([]), []);
    assert.deepEqual(explorer.parseExplorerBalances({ message: "nope" }), []);
  });
});

describe("the balances route", () => {
  const call = (query, fetchImpl) =>
    backend.api(new Request(`https://polytools.example/api/account/balances${query}`), { fetch: fetchImpl });

  it("returns normalised balances and never contacts the browser's origin", async () => {
    let seen = null;
    const response = await call(`?address=${SMART}`, async (url, init) => {
      seen = { url, headers: init?.headers };
      return new Response(JSON.stringify([row("USDT", "2500000")]), { status: 200 });
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.balances.length, 1);
    assert.equal(body.balances[0].formatted, "2.5");
    assert.match(seen.url, /blockscout\.com\/api\/v2\/addresses\/0x[a-f0-9]{40}\/token-balances/i);
    assert.deepEqual(seen.headers, { Accept: "application/json" });
  });

  it("rejects a malformed address without calling the explorer", async () => {
    let called = false;
    const response = await call("?address=nope", async () => {
      called = true;
      return new Response("[]");
    });
    assert.equal(response.status, 400);
    assert.equal(called, false);
  });

  it("reports an unreachable explorer as a gateway error, not a crash", async () => {
    const response = await call(`?address=${SMART}`, async () => {
      throw new Error("network down");
    });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, "explorer_unreachable");
  });

  it("reports a non-array payload rather than rendering nothing", async () => {
    const response = await call(`?address=${SMART}`, jsonResponse(200, { message: "nope" }));
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, "explorer_invalid_response");
  });
});

describe("the client calls our own API, not the explorer", () => {
  it("derives the address through /api", async () => {
    let seen = null;
    const address = await client.deriveSmartAccountAddress(SIGNER, async (url) => {
      seen = url;
      return new Response(JSON.stringify({ signerAddress: SIGNER, smartAccountAddress: SMART }), { status: 200 });
    });
    assert.equal(address, SMART);
    assert.equal(seen, `/api/account/address?signer=${SIGNER}`);
  });

  it("reads balances through /api and drops malformed rows", async () => {
    let seen = null;
    const rows = await client.fetchOnchainBalances(SMART, async (url) => {
      seen = url;
      return new Response(
        JSON.stringify({
          address: SMART,
          balances: [
            { address: TOKEN, symbol: "USDT", decimals: 6, raw: "2500000", formatted: "2.5", name: null },
            { address: "0xnope", symbol: "BAD", decimals: 6, raw: "1", formatted: "1", name: null },
            { address: TOKEN, symbol: "", decimals: 6, raw: "1", formatted: "1", name: null },
          ],
        }),
        { status: 200 },
      );
    });
    assert.equal(seen, `/api/account/balances?address=${SMART}`);
    assert.deepEqual(rows.map((r) => r.symbol), ["USDT"]);
  });

  it("refuses a malformed address before any request", async () => {
    let called = false;
    const fetchImpl = async () => {
      called = true;
      return new Response("{}");
    };
    await rejectsWith(client.deriveSmartAccountAddress("not-an-address", fetchImpl), "invalid_address");
    await rejectsWith(client.fetchOnchainBalances("nope", fetchImpl), "invalid_address");
    assert.equal(called, false, "must not send a malformed address");
  });

  it("surfaces a failed lookup instead of inventing an address", async () => {
    await rejectsWith(
      client.deriveSmartAccountAddress(SIGNER, jsonResponse(503, { error: "smart_account_derivation_unavailable" })),
      "lookup_failed",
    );
    await rejectsWith(
      client.deriveSmartAccountAddress(SIGNER, jsonResponse(200, { smartAccountAddress: "0xnope" })),
      "invalid_response",
    );
    await rejectsWith(client.fetchOnchainBalances(SMART, jsonResponse(200, {})), "invalid_response");
  });
});
