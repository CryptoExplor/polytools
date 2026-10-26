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
let requestSequencing;
let PublicCacheStatus;

before(async () => {
  vite = await createServer({
    root: rootDir,
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  cacheLib = await vite.ssrLoadModule("/apps/web/src/lib/publicCache.ts");
  marketLib = await vite.ssrLoadModule("/apps/web/src/lib/marketMetadataCache.ts");
  requestSequencing = await vite.ssrLoadModule("/apps/web/src/lib/metadataRequestSequencer.ts");
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

  it("keeps newer or equal in-memory data when an older persistent read finishes late", async () => {
    for (const advanceMs of [100, 0]) {
      let now = 100_000;
      const persistent = new cacheLib.MemoryPublicCacheStorage();
      const old = envelope(KEY, now, { id: 1 });
      await persistent.putIfNewer(old);
      const gate = deferred();
      let firstGet = true;
      const storage = {
        get: async (key) => {
          if (firstGet) {
            firstGet = false;
            return gate.promise;
          }
          return persistent.get(key);
        },
        putIfNewer: (entry, isCurrent) => persistent.putIfNewer(entry, isCurrent),
        delete: (key, savedAt, isCurrent) => persistent.delete(key, savedAt, isCurrent),
        getAll: () => persistent.getAll(),
      };
      const cache = new cacheLib.PublicDataCache({ storage, now: () => now });
      const delayedRead = cache.read(KEY, POLICY, decode);

      now += advanceMs;
      await cache.refresh({ key: KEY, policy: POLICY, decode, fetcher: async () => response(2) });
      gate.resolve(old);
      const result = await delayedRead;
      assert.equal(result.origin, "memory");
      assert.equal(result.entry.value.id, 2);
      assert.equal((await cache.read(KEY, POLICY, decode)).entry.value.id, 2);
    }
  });

  it("does not resurrect a persistent read that was pending during invalidation", async () => {
    const now = 100_000;
    const persistent = new cacheLib.MemoryPublicCacheStorage();
    const old = envelope(KEY, now, { id: 1 });
    await persistent.putIfNewer(old);
    const gate = deferred();
    let firstGet = true;
    const storage = {
      get: async (key) => {
        if (firstGet) {
          firstGet = false;
          return gate.promise;
        }
        return persistent.get(key);
      },
      putIfNewer: (entry, isCurrent) => persistent.putIfNewer(entry, isCurrent),
      delete: (key, savedAt, isCurrent) => persistent.delete(key, savedAt, isCurrent),
      getAll: () => persistent.getAll(),
    };
    const cache = new cacheLib.PublicDataCache({ storage, now: () => now });
    const delayedRead = cache.read(KEY, POLICY, decode);
    await cache.invalidate(KEY);
    gate.resolve(old);

    assert.equal(await delayedRead, null);
    assert.equal(await cache.read(KEY, POLICY, decode), null);
    assert.equal(await persistent.get(KEY), null);
  });

  it("rejects outdated schemas, invalid envelopes, and invalid cached values", async () => {
    const now = 100_000;
    const invalidEntries = [
      envelope(KEY, now, { id: 1 }, { schema: "fixture@0" }),
      envelope(KEY, now, { id: 1 }, { format: "old-format" }),
      envelope(KEY, now, { id: "invalid" }),
      envelope(KEY, now + 1, { id: 1 }),
      envelope(KEY, now, { id: 1 }, { savedAt: "unavailable" }),
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
    const reloadedAfterFailure = new cacheLib.PublicDataCache({ storage, now: () => now });
    assert.deepEqual((await reloadedAfterFailure.read(KEY, POLICY, decode)).entry.value, { id: 1 });

    const noStore = await cache.refresh({
      ...options,
      fetcher: async () => response(2, "no-store"),
    });
    assert.deepEqual(noStore.value, { id: 2 });
    assert.equal(noStore.entry, null);
    assert.equal(await cache.read(KEY, POLICY, decode), null);
  });

  it("invalidates an older reusable entry after an oversized successful response", async () => {
    let now = 100_000;
    const storage = new cacheLib.MemoryPublicCacheStorage();
    const policy = { ...POLICY, maxBytes: 1_024 };
    const variableDecode = (value) => value && Number.isSafeInteger(value.id)
      ? { id: value.id, ...(value.note ? { note: value.note } : {}) }
      : null;
    const cache = new cacheLib.PublicDataCache({ storage, now: () => now });
    await cache.refresh({
      key: KEY,
      policy,
      decode: variableDecode,
      fetcher: async () => ({ data: { id: 1 }, cacheControl: "public, max-age=60" }),
    });

    now += 100;
    const oversized = await cache.refresh({
      key: KEY,
      policy,
      decode: variableDecode,
      fetcher: async () => ({
        data: { id: 2, note: "x".repeat(2_000) },
        cacheControl: "public, max-age=60",
      }),
    });
    assert.equal(oversized.value.id, 2);
    assert.equal(oversized.entry, null);
    assert.equal(await cache.read(KEY, policy, variableDecode), null);
    assert.equal(await storage.get(KEY), null);
    const reloaded = new cacheLib.PublicDataCache({ storage, now: () => now });
    assert.equal(await reloaded.read(KEY, policy, variableDecode), null);
  });

  it("clears older entries for non-cacheable and zero-retention success directives", async () => {
    for (const cacheControl of ["no-store", "private", "public, max-age=0, must-revalidate"]) {
      let now = 100_000;
      const storage = new cacheLib.MemoryPublicCacheStorage();
      const cache = new cacheLib.PublicDataCache({ storage, now: () => now });
      const options = { key: KEY, policy: POLICY, decode };
      await cache.refresh({ ...options, fetcher: async () => response(1) });
      now += 1;
      const result = await cache.refresh({
        ...options,
        fetcher: async () => response(2, cacheControl),
      });
      assert.equal(result.value.id, 2);
      assert.equal(result.entry, null);
      assert.equal(await cache.read(KEY, POLICY, decode), null);
      assert.equal(await storage.get(KEY), null);
    }
  });

  it("prevents a delayed non-cacheable delete from removing a newer post-invalidation result", async () => {
    const now = 100_000;
    const persistent = new cacheLib.MemoryPublicCacheStorage();
    const deleteStarted = deferred();
    const releaseDelete = deferred();
    let deferDelete = false;
    const storage = {
      get: (key) => persistent.get(key),
      putIfNewer: (entry, isCurrent) => persistent.putIfNewer(entry, isCurrent),
      delete: async (key, savedAt, isCurrent) => {
        if (deferDelete) {
          deferDelete = false;
          deleteStarted.resolve();
          await releaseDelete.promise;
        }
        return persistent.delete(key, savedAt, isCurrent);
      },
      getAll: () => persistent.getAll(),
    };
    const cache = new cacheLib.PublicDataCache({ storage, now: () => now });
    const options = { key: KEY, policy: POLICY, decode };
    await cache.refresh({ ...options, fetcher: async () => response(1) });

    deferDelete = true;
    const older = cache.refresh({ ...options, fetcher: async () => response(2, "no-store") });
    const olderRejected = assert.rejects(older, (error) => error?.code === "STALE_RESPONSE");
    await deleteStarted.promise;
    await cache.invalidate(KEY);
    await cache.refresh({ ...options, fetcher: async () => response(3) });
    releaseDelete.resolve();
    await olderRejected;

    assert.equal((await cache.read(KEY, POLICY, decode)).entry.value.id, 3);
    assert.equal((await persistent.get(KEY)).value.id, 3);
  });

  it("does not let a read started during non-cacheable cleanup restore the old record", async () => {
    const now = 100_000;
    const persistent = new cacheLib.MemoryPublicCacheStorage();
    const deleteStarted = deferred();
    const releaseDelete = deferred();
    const getStarted = deferred();
    const releaseGet = deferred();
    let deferDelete = false;
    let deferGet = false;
    const storage = {
      get: async (key) => {
        const raw = await persistent.get(key);
        if (deferGet) {
          deferGet = false;
          getStarted.resolve();
          await releaseGet.promise;
        }
        return raw;
      },
      putIfNewer: (entry, isCurrent) => persistent.putIfNewer(entry, isCurrent),
      delete: async (key, savedAt, isCurrent) => {
        if (deferDelete) {
          deferDelete = false;
          deleteStarted.resolve();
          await releaseDelete.promise;
        }
        return persistent.delete(key, savedAt, isCurrent);
      },
      getAll: () => persistent.getAll(),
    };
    const cache = new cacheLib.PublicDataCache({ storage, now: () => now });
    const options = { key: KEY, policy: POLICY, decode };
    await cache.refresh({ ...options, fetcher: async () => response(1) });

    deferDelete = true;
    const networkOnly = cache.refresh({ ...options, fetcher: async () => response(2, "no-store") });
    await deleteStarted.promise;
    deferGet = true;
    const pendingRead = cache.read(KEY, POLICY, decode);
    await getStarted.promise;
    releaseDelete.resolve();
    assert.equal((await networkOnly).value.id, 2);
    releaseGet.resolve();
    assert.equal(await pendingRead, null);
    assert.equal(await cache.read(KEY, POLICY, decode), null);
    assert.equal(await persistent.get(KEY), null);
  });

  it("does not let a read started during invalidation cleanup restore the old record", async () => {
    const now = 100_000;
    const persistent = new cacheLib.MemoryPublicCacheStorage();
    const deleteStarted = deferred();
    const releaseDelete = deferred();
    const getStarted = deferred();
    const releaseGet = deferred();
    let deferDelete = false;
    let deferGet = false;
    const storage = {
      get: async (key) => {
        const raw = await persistent.get(key);
        if (deferGet) {
          deferGet = false;
          getStarted.resolve();
          await releaseGet.promise;
        }
        return raw;
      },
      putIfNewer: (entry, isCurrent) => persistent.putIfNewer(entry, isCurrent),
      delete: async (key, savedAt, isCurrent) => {
        if (deferDelete) {
          deferDelete = false;
          deleteStarted.resolve();
          await releaseDelete.promise;
        }
        return persistent.delete(key, savedAt, isCurrent);
      },
      getAll: () => persistent.getAll(),
    };
    const cache = new cacheLib.PublicDataCache({ storage, now: () => now });
    await cache.refresh({ key: KEY, policy: POLICY, decode, fetcher: async () => response(1) });

    deferDelete = true;
    const invalidation = cache.invalidate(KEY);
    await deleteStarted.promise;
    deferGet = true;
    const pendingRead = cache.read(KEY, POLICY, decode);
    await getStarted.promise;
    releaseDelete.resolve();
    await invalidation;
    releaseGet.resolve();
    assert.equal(await pendingRead, null);
    assert.equal(await cache.read(KEY, POLICY, decode), null);
    assert.equal(await persistent.get(KEY), null);
  });

  it("prevents an older invalidation delete from removing a newer result", async () => {
    const now = 100_000;
    const persistent = new cacheLib.MemoryPublicCacheStorage();
    const deleteStarted = deferred();
    const releaseDelete = deferred();
    let deferDelete = false;
    const storage = {
      get: (key) => persistent.get(key),
      putIfNewer: (entry, isCurrent) => persistent.putIfNewer(entry, isCurrent),
      delete: async (key, savedAt, isCurrent) => {
        if (deferDelete) {
          deferDelete = false;
          deleteStarted.resolve();
          await releaseDelete.promise;
        }
        return persistent.delete(key, savedAt, isCurrent);
      },
      getAll: () => persistent.getAll(),
    };
    const cache = new cacheLib.PublicDataCache({ storage, now: () => now });
    const options = { key: KEY, policy: POLICY, decode };
    await cache.refresh({ ...options, fetcher: async () => response(1) });

    const newerFetchStarted = deferred();
    deferDelete = true;
    const invalidation = cache.invalidate(KEY);
    await deleteStarted.promise;
    const newer = cache.refresh({
      ...options,
      fetcher: async () => {
        newerFetchStarted.resolve();
        return response(2);
      },
    });
    await newerFetchStarted.promise;
    releaseDelete.resolve();
    await invalidation;
    await newer;

    assert.equal((await persistent.get(KEY)).value.id, 2);
    assert.equal((await cache.read(KEY, POLICY, decode)).entry.value.id, 2);
  });

  it("prevents cleanup of an old snapshot from deleting a newer refresh", async () => {
    let now = 100_000;
    const persistent = new cacheLib.MemoryPublicCacheStorage();
    const getAllStarted = deferred();
    const releaseGetAll = deferred();
    let deferGetAll = false;
    const storage = {
      get: (key) => persistent.get(key),
      putIfNewer: (entry, isCurrent) => persistent.putIfNewer(entry, isCurrent),
      delete: (key, savedAt, isCurrent) => persistent.delete(key, savedAt, isCurrent),
      getAll: async () => {
        const records = await persistent.getAll();
        if (deferGetAll) {
          deferGetAll = false;
          getAllStarted.resolve();
          await releaseGetAll.promise;
        }
        return records;
      },
    };
    const cache = new cacheLib.PublicDataCache({ storage, now: () => now });
    const options = { key: KEY, policy: POLICY, decode };
    await cache.refresh({ ...options, fetcher: async () => response(1) });

    now += POLICY.maxAgeMs + 1;
    deferGetAll = true;
    const cleaning = cache.cleanup([POLICY.schema]);
    await getAllStarted.promise;
    await cache.refresh({ ...options, fetcher: async () => response(2) });
    releaseGetAll.resolve();
    await cleaning;

    assert.equal((await persistent.get(KEY)).value.id, 2);
    assert.equal((await cache.read(KEY, POLICY, decode)).entry.value.id, 2);
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
    assert.deepEqual((await storage.get(KEY)).value, { id: 2 });
  });

  it("blocks late stale writes after invalidation without deleting a same-time newer result", async () => {
    for (const withNewer of [false, true]) {
      const now = 100_000;
      const persistent = new cacheLib.MemoryPublicCacheStorage();
      const oldPutStarted = deferred();
      const releaseOldPut = deferred();
      let deferFirstPut = true;
      const storage = {
        get: (key) => persistent.get(key),
        putIfNewer: async (entry, isCurrent) => {
          if (deferFirstPut) {
            deferFirstPut = false;
            oldPutStarted.resolve();
            await releaseOldPut.promise;
          }
          return persistent.putIfNewer(entry, isCurrent);
        },
        delete: (key, savedAt, isCurrent) => persistent.delete(key, savedAt, isCurrent),
        getAll: () => persistent.getAll(),
      };
      const cache = new cacheLib.PublicDataCache({ storage, now: () => now });
      const options = { key: KEY, policy: POLICY, decode };
      const older = cache.refresh({ ...options, fetcher: async () => response(1) });
      const olderRejected = assert.rejects(older, (error) => error?.code === "STALE_RESPONSE");
      await oldPutStarted.promise;
      await cache.invalidate(KEY);

      if (withNewer) {
        await cache.refresh({ ...options, fetcher: async () => response(2) });
      }
      releaseOldPut.resolve();
      await olderRejected;

      if (withNewer) {
        assert.equal((await cache.read(KEY, POLICY, decode)).entry.value.id, 2);
        assert.equal((await persistent.get(KEY)).value.id, 2);
      } else {
        assert.equal(await cache.read(KEY, POLICY, decode), null);
        assert.equal(await persistent.get(KEY), null);
      }
    }
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

describe("provider request sequencing", () => {
  it("keeps forced network and environment refreshes current across cache-only checks", () => {
    const sequencer = new requestSequencing.MetadataRequestSequencer();
    const manualCacheCheck = sequencer.beginCacheCheck();
    const forcedNetwork = sequencer.beginNetworkRefresh();
    const environment = sequencer.beginEnvironmentRefresh();

    // A later automatic fresh/offline check returns without beginning a network
    // refresh. It supersedes only the earlier cache-check UI state.
    const automaticCacheCheck = sequencer.beginCacheCheck();
    assert.equal(sequencer.isCacheCheckCurrent(manualCacheCheck), false);
    assert.equal(sequencer.isCacheCheckCurrent(automaticCacheCheck), true);
    assert.equal(sequencer.isNetworkRefreshCurrent(forcedNetwork), true);
    assert.equal(sequencer.isEnvironmentRefreshCurrent(environment), true);

    const apply = requestSequencing.shouldApplyMetadataNetworkResult;
    assert.equal(apply({ requestCurrent: true, resultSavedAt: 200, visibleSavedAt: 100 }), true);
    assert.equal(apply({ requestCurrent: true, resultSavedAt: 200, visibleSavedAt: 200 }), true);
    assert.equal(apply({ requestCurrent: true, resultSavedAt: 100, visibleSavedAt: 200 }), false);
    assert.equal(apply({ requestCurrent: false, resultSavedAt: 200, visibleSavedAt: 100 }), false);

    const nextNetwork = sequencer.beginNetworkRefresh();
    assert.equal(sequencer.isNetworkRefreshCurrent(forcedNetwork), false);
    assert.equal(sequencer.isNetworkRefreshCurrent(nextNetwork), true);
    sequencer.invalidate();
    assert.equal(sequencer.isCacheCheckCurrent(automaticCacheCheck), false);
    assert.equal(sequencer.isNetworkRefreshCurrent(nextNetwork), false);
    assert.equal(sequencer.isEnvironmentRefreshCurrent(environment), false);

    const store = source("apps/web/src/lib/store.tsx");
    assert.ok(!store.includes("metaReqRef"));
    assert.ok(store.includes("requestCurrent: isNetworkCurrent()"));
    assert.ok(store.includes("visibleSavedAt: marketsUpdatedAtRef.current"));
    const freshReturn = store.indexOf('if (decision === "use-fresh") return;');
    const networkBegin = store.indexOf("networkRequest = sequencer.beginNetworkRefresh()");
    assert.ok(freshReturn >= 0);
    assert.ok(networkBegin > freshReturn);
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
    assert.ok(!fresh.includes("hide-xs"), "fresh status keeps its provenance visible on small screens");

    const stale = renderToStaticMarkup(React.createElement(PublicCacheStatus, {
      ...base,
      now: 102_000,
      refreshing: true,
    }));
    assert.ok(stale.includes("Stale metadata"));
    assert.ok(stale.includes("refreshing"));
    assert.ok(!stale.includes("hide-xs"), "stale status must remain visible on small screens");

    const failed = renderToStaticMarkup(React.createElement(PublicCacheStatus, {
      ...base,
      now: 102_000,
      error: "synthetic refresh failure",
    }));
    assert.ok(failed.includes("Try again"));
    assert.ok(failed.includes("last valid cached copy is retained"));
    assert.ok(!failed.includes("hide-xs"), "failure status must remain visible on small screens");
  });
});
