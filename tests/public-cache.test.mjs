import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const source = (path) => readFileSync(`${rootDir}/${path}`, "utf8");
const POLICY = {
  schema: "fixture@1",
  freshMs: 1_000,
  maxAgeMs: 10_000,
  maxBytes: 100_000,
};
const KEY = "public:synthetic:/fixture:fixture@1";
const decode = (value) => {
  if (!value || typeof value !== "object" || !Number.isSafeInteger(value.id)) return null;
  return { id: value.id };
};
const response = (id, cacheControl = "public, max-age=60") => ({
  data: { id, discarded: "not retained" },
  cacheControl,
});

let vite;
let cacheLib;
let marketLib;
let PublicCacheStatus;

before(async () => {
  vite = await createServer({
    root: rootDir,
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  cacheLib = await vite.ssrLoadModule("/apps/web/src/lib/publicCache.ts");
  marketLib = await vite.ssrLoadModule("/apps/web/src/lib/marketMetadataCache.ts");
  ({ PublicCacheStatus } = await vite.ssrLoadModule(
    "/apps/web/src/components/PublicCacheStatus.tsx",
  ));
});

after(async () => {
  if (vite) await vite.close();
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function envelope(key, savedAt, value = { id: 1 }, overrides = {}) {
  return {
    format: cacheLib.PUBLIC_CACHE_FORMAT,
    key,
    schema: POLICY.schema,
    savedAt,
    freshUntil: savedAt + POLICY.freshMs,
    expiresAt: savedAt + POLICY.maxAgeMs,
    value,
    ...overrides,
  };
}

describe("public cache hits, freshness, validation, and persistence", () => {
  it("handles miss, memory hit, persistent hit, stale data, and expiry", async () => {
    let now = 100_000;
    const storage = new cacheLib.MemoryPublicCacheStorage();
    const cache = new cacheLib.PublicDataCache({ storage, now: () => now });
    assert.equal(await cache.read(KEY, POLICY, decode), null);

    let fetches = 0;
    const result = await cache.refresh({
      key: KEY,
      policy: POLICY,
      decode,
      fetcher: async () => {
        fetches += 1;
        return response(1);
      },
    });
    assert.deepEqual(result.value, { id: 1 });
    assert.equal(fetches, 1);
    assert.equal(result.entry.savedAt, now);
    assert.equal(result.entry.freshUntil, now + 1_000);

    now += 500;
    const memory = await cache.read(KEY, POLICY, decode);
    assert.equal(memory.origin, "memory");
    assert.equal(memory.fresh, true);
    assert.deepEqual(memory.entry.value, { id: 1 });

    const reloaded = new cacheLib.PublicDataCache({ storage, now: () => now });
    const persistent = await reloaded.read(KEY, POLICY, decode);
    assert.equal(persistent.origin, "persistent");
    assert.equal(persistent.fresh, true);

    now += 501;
    const stale = await reloaded.read(KEY, POLICY, decode);
    assert.equal(stale.fresh, false);
    assert.deepEqual(stale.entry.value, { id: 1 });

    now += 9_000;
    assert.equal(await reloaded.read(KEY, POLICY, decode), null);
    assert.equal(await storage.get(KEY), null);
  });

  it("rejects outdated schemas, invalid envelopes, and invalid cached values", async () => {
    const now = 100_000;
    const invalidEntries = [
      envelope(KEY, now, { id: 1 }, { schema: "fixture@0" }),
      envelope(KEY, now, { id: 1 }, { format: "old-format" }),
      envelope(KEY, now, { id: "invalid" }),
      envelope(KEY, now + 1, { id: 1 }),
      envelope(KEY, now, { id: 1 }, { expiresAt: now - 1 }),
    ];
    for (const invalid of invalidEntries) {
      const storage = new cacheLib.MemoryPublicCacheStorage();
      await storage.putIfNewer(invalid);
      const cache = new cacheLib.PublicDataCache({ storage, now: () => now });
      assert.equal(await cache.read(KEY, POLICY, decode), null);
      assert.equal(await storage.get(KEY), null);
    }
  });

  it("validates and strips the real public market wire-sample shape", () => {
    const raw = JSON.parse(source("docs/wire-samples/get_spot_markets.json"));
    const sample = raw.result.structuredContent;
    const decoded = marketLib.decodePublicSpotMarkets({
      ...sample,
      dataSource: "wire-samples",
      unexpectedServerField: { discarded: true },
    });
    assert.ok(decoded);
    assert.equal(decoded.dataSource, "wire-samples");
    assert.equal(decoded.pairs.length, sample.pairs.length);
    assert.equal(decoded.assets.length, sample.assets.length);
    assert.ok(!("unexpectedServerField" in decoded));

    const duplicate = {
      ...sample,
      pairs: [sample.pairs[0], sample.pairs[0]],
    };
    assert.equal(marketLib.decodePublicSpotMarkets(duplicate), null);
  });
});

describe("public cache refresh safety and request coordination", () => {
  it("preserves the last valid copy after network or validation failure", async () => {
    const now = 100_000;
    const storage = new cacheLib.MemoryPublicCacheStorage();
    const cache = new cacheLib.PublicDataCache({ storage, now: () => now });
    const options = { key: KEY, policy: POLICY, decode };
    await cache.refresh({ ...options, fetcher: async () => response(1) });

    await assert.rejects(
      cache.refresh({ ...options, fetcher: async () => { throw new Error("synthetic offline"); } }),
      /synthetic offline/,
    );
    assert.deepEqual((await cache.read(KEY, POLICY, decode)).entry.value, { id: 1 });

    await assert.rejects(
      cache.refresh({ ...options, fetcher: async () => response("invalid") }),
      (error) => error?.code === "INVALID_DATA",
    );
    assert.deepEqual((await cache.read(KEY, POLICY, decode)).entry.value, { id: 1 });

    const noStore = await cache.refresh({
      ...options,
      fetcher: async () => response(2, "no-store"),
    });
    assert.deepEqual(noStore.value, { id: 2 });
    assert.equal(noStore.entry, null);
    assert.equal(await cache.read(KEY, POLICY, decode), null);
  });

  it("deduplicates identical concurrent requests", async () => {
    const cache = new cacheLib.PublicDataCache({
      storage: new cacheLib.MemoryPublicCacheStorage(),
      now: () => 100_000,
    });
    const pending = deferred();
    let fetches = 0;
    const options = {
      key: KEY,
      policy: POLICY,
      decode,
      fetcher: () => {
        fetches += 1;
        return pending.promise;
      },
    };
    const first = cache.refresh(options);
    const second = cache.refresh(options);
    assert.equal(fetches, 1);
    pending.resolve(response(1));
    const [a, b] = await Promise.all([first, second]);
    assert.deepEqual(a.value, { id: 1 });
    assert.deepEqual(b.value, { id: 1 });
  });

  it("prevents an invalidated older response from overwriting a newer result", async () => {
    let now = 100_000;
    const storage = new cacheLib.MemoryPublicCacheStorage();
    const cache = new cacheLib.PublicDataCache({ storage, now: () => now });
    const pending = [];
    const options = {
      key: KEY,
      policy: POLICY,
      decode,
      fetcher: () => {
        const next = deferred();
        pending.push(next);
        return next.promise;
      },
    };

    const older = cache.refresh(options);
    const olderRejected = assert.rejects(
      older,
      (error) => error?.code === "STALE_RESPONSE",
    );
    await cache.invalidate(KEY);
    const newer = cache.refresh(options);
    assert.equal(pending.length, 2);

    now += 1;
    pending[1].resolve(response(2));
    await newer;
    pending[0].resolve(response(1));
    await olderRejected;

    const current = await cache.read(KEY, POLICY, decode);
    assert.deepEqual(current.entry.value, { id: 2 });
    assert.equal(current.entry.savedAt, now);
  });

  it("measures one avoided fetch across two fresh app-load cycles", async () => {
    const now = 100_000;
    const storage = new cacheLib.MemoryPublicCacheStorage();
    let fetches = 0;
    const load = async (cache) => {
      const hit = await cache.read(KEY, POLICY, decode);
      const decision = cacheLib.publicCacheLoadDecision({
        offline: false,
        fresh: hit?.fresh ?? false,
        force: false,
      });
      if (decision === "use-fresh") return hit.entry.value;
      return (await cache.refresh({
        key: KEY,
        policy: POLICY,
        decode,
        fetcher: async () => {
          fetches += 1;
          return response(1);
        },
      })).value;
    };

    await load(new cacheLib.PublicDataCache({ storage, now: () => now }));
    await load(new cacheLib.PublicDataCache({ storage, now: () => now }));
    assert.equal(fetches, 1, "two cached loads need one fetch; two uncached loads need two");
    assert.equal((2 - fetches) / 2, 0.5);
  });
});

describe("public cache retention, offline policy, and UI provenance", () => {
  it("cleans expired/outdated records, enforces entry bounds, and skips oversized writes", async () => {
    const now = 100_000;
    const storage = new cacheLib.MemoryPublicCacheStorage();
    await storage.putIfNewer(envelope("expired", 1, { id: 1 }, { expiresAt: now - 1 }));
    await storage.putIfNewer(envelope("outdated", 1, { id: 1 }, { schema: "old" }));
    await storage.putIfNewer(envelope("oldest", now - 3_000));
    await storage.putIfNewer(envelope("middle", now - 2_000));
    await storage.putIfNewer(envelope("newest", now - 1_000));

    const cache = new cacheLib.PublicDataCache({ storage, now: () => now, maxEntries: 2 });
    await cache.cleanup([POLICY.schema]);
    const retained = (await storage.getAll()).map((entry) => entry.key).sort();
    assert.deepEqual(retained, ["middle", "newest"]);

    const small = new cacheLib.PublicDataCache({ storage: new cacheLib.MemoryPublicCacheStorage(), now: () => now });
    const oversized = await small.refresh({
      key: KEY,
      policy: { ...POLICY, maxBytes: 20 },
      decode,
      fetcher: async () => response(1),
    });
    assert.deepEqual(oversized.value, { id: 1 });
    assert.equal(oversized.entry, null);
    assert.equal(await small.read(KEY, { ...POLICY, maxBytes: 20 }, decode), null);
  });

  it("honors Cache-Control and models offline, fresh, stale, and forced decisions", () => {
    assert.equal(cacheLib.resolvePublicCachePolicy(POLICY, "public, max-age=60").freshMs, 1_000);
    assert.equal(cacheLib.resolvePublicCachePolicy(POLICY, "public, max-age=0").freshMs, 0);
    assert.equal(cacheLib.resolvePublicCachePolicy(POLICY, null).freshMs, 0);
    assert.equal(cacheLib.resolvePublicCachePolicy(POLICY, "no-cache").freshMs, 0);
    assert.equal(cacheLib.resolvePublicCachePolicy(POLICY, "no-store").persist, false);
    assert.equal(cacheLib.resolvePublicCachePolicy(POLICY, "private").persist, false);
    assert.equal(
      cacheLib.resolvePublicCachePolicy(POLICY, "public, max-age=60, must-revalidate").maxAgeMs,
      1_000,
    );

    assert.equal(cacheLib.publicCacheLoadDecision({ offline: true, fresh: true, force: false }), "offline");
    assert.equal(cacheLib.publicCacheLoadDecision({ offline: false, fresh: true, force: false }), "use-fresh");
    assert.equal(cacheLib.publicCacheLoadDecision({ offline: false, fresh: false, force: false }), "revalidate");
    assert.equal(cacheLib.publicCacheLoadDecision({ offline: false, fresh: true, force: true }), "revalidate");

    const store = source("apps/web/src/lib/store.tsx");
    assert.ok(store.includes('document.addEventListener("visibilitychange", check)'));
    assert.ok(store.includes('window.addEventListener("online", check)'));
    assert.ok(store.includes('window.addEventListener("offline", check)'));
    assert.ok(store.includes("if (navigator.onLine) check()"));
  });

  it("labels fresh, stale, refreshing, and failed cached metadata without calling it live", () => {
    const base = {
      origin: "persistent",
      savedAt: 100_000,
      freshUntil: 101_000,
      now: 100_500,
      refreshing: false,
      error: null,
      sample: false,
      onRetry: () => undefined,
    };
    const fresh = renderToStaticMarkup(React.createElement(PublicCacheStatus, base));
    assert.ok(fresh.includes("Cached metadata"));
    assert.ok(fresh.includes("IndexedDB cache"));
    assert.ok(fresh.includes("Saved 1970-01-01T00:01:40.000Z"));
    assert.ok(fresh.includes("Not a live price or order book"));

    const stale = renderToStaticMarkup(React.createElement(PublicCacheStatus, {
      ...base,
      now: 102_000,
      refreshing: true,
    }));
    assert.ok(stale.includes("Stale metadata"));
    assert.ok(stale.includes("refreshing"));

    const failed = renderToStaticMarkup(React.createElement(PublicCacheStatus, {
      ...base,
      now: 102_000,
      error: "synthetic refresh failure",
    }));
    assert.ok(failed.includes("Retry"));
    assert.ok(failed.includes("last valid cached copy is retained"));
  });
});
