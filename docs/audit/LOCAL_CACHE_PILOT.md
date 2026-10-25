# Local public-data cache pilot

**Review date:** 2026-10-25
**Status:** implemented locally, uncommitted; public `/api/markets` pilot only
**Baseline:** current mixed working tree on `arena/2679a49c-polytools`; this document does not attribute unrelated pre-existing changes to the pilot.

## 1. Scope and decision

The pilot persists only the validated public spot-market catalog returned by the public backend's `GET /api/markets`. It does not cache account responses, official account-path spot configuration, prices, order books, fills, cursor imports, R3 inputs, credentials, or bearer/signing material.

This endpoint was selected because the existing `AppProvider` already shares one catalog across route navigation. The repeated request that could actually be removed was therefore the catalog fetch on a full app reload or return, not a fetch on every HashRouter navigation.

IndexedDB is not treated as secure storage. The new database contains validated public metadata only and is separate from the encrypted account vault. Storage denial, quota failure, eviction, or unsupported IndexedDB falls back to memory/network behavior.

## 2. Existing behavior discovered

### Browser request coordination

- `apps/web/src/lib/api.ts` used credential-free JSON GET wrappers and TypeScript casts. It had no runtime response validation, application cache, or cross-hook single-flight coordinator.
- `AppProvider` fetched `/api/markets` and `/api/env` once per full provider mount and on manual refresh. Route navigation reused provider state. Manual/latest-request protection used `metaReqRef`.
- `usePollData` plus `startPoll` provided per-mounted-hook single-flight, jitter, generation/request-ID stale-response guards, and hidden-tab tick suppression. It did not share entries across hooks or page mounts and did not check offline state.
- Existing polling included Dashboard overview at 3s; Tape trades at 1.5s; Book orderbook at 2s plus overview at 4s; Charts candles at timeframe-specific 5–60s plus overview at 4s; Heatmap at 6s; Compare overview at 5s plus CoinGecko at 35s; Calc overview at 5s.
- Existing `localStorage` records were small preferences/checklists (theme, symbol, watchlist, intro, Hub checklist), not account snapshots. The account vault used a separate IndexedDB ciphertext store.

### Backend cache and HTTP directives (source evidence)

`backend/src/cache.ts` is a per-isolate, 200-key TTL cache with single-flight coalescing and expired/soonest-expiring eviction. It is not a cross-isolate source of truth. `backend/src/handler.ts` emits route-specific `Cache-Control` on successful cached JSON routes.

| Endpoint family | Backend memory TTL | HTTP max-age | Existing browser behavior |
|---|---:|---:|---|
| `/api/markets` | 60s | 60s | One provider fetch per mount/manual refresh |
| `/api/overview` | 2s | 2s | Poll per mounted tool |
| `/api/orderbook` | 1.5s | 1s | Poll per mounted Book |
| `/api/candles` | 3s | 3s | Timeframe/range-dependent poll |
| `/api/trades` | 1.2s | 1s | Poll per mounted Tape |
| `/api/heatmap` | 5s | 5s | Poll per mounted Heatmap |
| `/api/zipper/config`, routes, compare | 300s | 300s | Explicit page loads |
| Flow/by-tx/explain | No handler cache | None | Explicit identifier lookup |
| Health/env | No handler cache | None | Provider/diagnostic loads |

The browser's ordinary HTTP cache may already satisfy some requests. The pilot's synthetic API-call counts are not measurements of origin traffic.

### Private, R2, and R3 boundaries

- Authenticated account GETs use exact-origin registered signing, omitted credentials, `cache: "no-store"`, response validation, safe errors, and session/request generation checks.
- Private snapshots use generation/scope/operation/filter-partitioned memory only. Lock, wipe, import, unlock, and vault-change lifecycle events clear them; delayed responses are rejected.
- The separate official `/v1/spot/config` account-reference read is public and unsigned but deliberately uses `no-store` and its own schema/clock handling. It is not replaced by the `/api/markets` cache.
- R2 cursor imports follow opaque cursors with page caps and partial coverage. Failed/cancelled imports do not merge a cancelled prefix or replace the previous visible snapshot.
- R3 keeps exact fail-closed coverage, opening-basis, flow-resolution, quote-separation, and fresh-mark gates. Cached records would not establish complete history. No R3 input or output is persisted by this pilot.

## 3. Policy by endpoint family

Only the first row is implemented. Later rows are proposals, not authorization to expand the pilot.

| Family | Policy and disposition |
|---|---|
| Public market metadata `/api/markets` | **Implemented:** schema `spot-markets@1`; key includes sanitized API origin/path, endpoint, and schema; memory + separate IndexedDB; fresh at most 60s and capped by HTTP `max-age`; visibly stale fallback up to 24h; 1 MiB entry limit; eight-entry bound; expiry/schema cleanup. |
| Market overview/prices | Later candidate for short in-memory sharing keyed by normalized symbols/limit. Use roughly the server 2s freshness window, preserve last valid visible data, and do not persist by default. Cached values must never be labeled live. |
| Order books | Later candidate for short in-memory sharing by symbol/depth with approximately 1s freshness. No persistent order-book pilot; fast-changing snapshots and stale-trading interpretation require separate UX review. |
| Candles | Later in-memory candidate by symbol/timeframe/limit/exact range. Closed historical ranges may justify persistence only after range-merge and incomplete-candle rules are designed. Fetching only missing ranges is not implemented here. |
| Recent public trades | Later short in-memory candidate by symbol/limit/side. Never substitute these rows for private fills. No persistence in this phase. |
| Heatmap | Later short in-memory candidate by symbol/interval/depth/window/limit. Larger records require measured memory/IndexedDB costs before persistence. |
| Zipper configuration/routes/compare | Relatively stable public candidates for a later 5-minute-fresh cache with endpoint-specific validators and bounded stale fallback. Not implemented. |
| Flow/by-tx/explain | No persistent caching by default: lookups are stateful and user-supplied transaction identifiers can be sensitive. |
| Health/env/diagnostics | No persistent cache; operational telemetry should not masquerade as current. |
| CoinGecko references | No change. Review actual response directives and rate limits before any shared cache; retain the slow 35s poll. |
| Official account-path spot config | Unchanged direct validated `no-store` read. It is not interchangeable with the public backend catalog. |
| Private account data/R2/R3 | **No persistent cache.** Existing memory partitions, signing, permissions, invalidation, cursor coverage, and accounting gates remain authoritative. |

## 4. Implemented architecture

- `publicCache.ts` defines versioned envelopes (`polytools-public-cache@1`), stable keys, save/fresh/expiry times, runtime decode hooks, memory and IndexedDB adapters, size/entry bounds, cleanup, single-flight refresh, invalidation generations, and newer-only persistent writes.
- Cached and network values use the same decoder. The market decoder validates the actual wire-sample shape, rejects duplicates/malformed values, caps array lengths, and strips unknown fields before reuse or persistence.
- `Cache-Control: no-store` and `private` responses are returned to the UI but not retained; previous cached copies are removed. `no-cache`/`max-age=0` require revalidation. `must-revalidate` removes stale offline reuse. Missing freshness headers produce a stale-while-revalidate copy rather than a fresh claim.
- A fresh hit skips the fetch. A stale hit renders first and revalidates in the background. Explicit refresh forces revalidation. Only validated success replaces UI/cache state; errors retain the last valid copy.
- Identical concurrent refreshes share one promise. Invalidated older responses cannot overwrite newer results. Persistent writes with older save times do not replace newer records.
- The app checks freshness every 60s while visible/online, on return to visibility, and on online/offline events. Offline intervals do no work. There is no service worker, periodic background sync, or claim of syncing while the browser is closed.
- The Layout and Hub identify cached/stale metadata, save age, refresh state, and refresh failure. Cached metadata is not labeled “Live MCP.” No cached prices or order books were introduced.

## 5. Deployment and privacy constraints

- Reviewed targets include the root Cloudflare Worker + static assets, standalone backend Worker/GitHub Pages arrangement, Vercel static frontend + Edge API, and Node/Vite adapters. Browser IndexedDB belongs only to the frontend origin; Workers/Edge isolates cannot access it.
- Backend cron configuration is unrelated to browser background refresh. No deployment or dry-run was performed for this pilot.
- IndexedDB may be unavailable, blocked, evicted, or cleared. Its contents are readable by script running on the origin, so no secret or private account material belongs there.
- Client save times use the browser clock. Future-dated records are rejected; clock changes can cause safe cache misses or earlier/later revalidation.
- The pilot adds a visible/online stale revalidation that did not previously exist for market metadata. Long-lived sessions can therefore make more metadata requests than the old mount-only behavior even while fresh reloads avoid requests.

## 6. Verification and measured effect

Synthetic tests in `tests/public-cache.test.mjs` cover cache hit/miss, fresh/stale/expired records, invalid and outdated schemas, the real public market wire-sample shape, refresh failure preservation, duplicate prevention, out-of-order invalidation, size/entry cleanup, Cache-Control, offline/reconnect decisions, and SSR cached/stale UI labels.

- Focused public-cache tests: **10/10 passed (3 suites)**.
- Full repository tests: **158/158 passed (32 suites)**, including existing account lock/invalidation, R2 cancellation/coverage, R3 completeness/valuation, and Phase 1/2 UX tests.
- Root web/backend typechecks: **passed**.
- Production build: **passed**, 93 modules; the pre-existing large-chunk warning remains (`587.60 kB`, `175.07 kB` gzip).
- Synthetic fresh two-load scenario: **1 client fetch versus 2 without the cache = 50% fewer client fetch calls**. This is not a browser network, origin-request, Web-Vital, or load-time measurement.

## 7. Remaining limitations and review gates

- No real browser, IndexedDB implementation, multi-tab workflow, offline browser transition, assistive technology, deployment, or live endpoint was exercised. Tests use synthetic storage/fixtures plus SSR/source assertions.
- No real load-time improvement or origin quota reduction is claimed. Browser HTTP caching and deployment cache behavior can change the effect.
- Actual IndexedDB quota/eviction behavior and cross-tab storage timing need browser validation. The persistent adapter's newer-only rule is tested through the storage contract, not a real browser database.
- Other public endpoints remain unchanged. Prices, order books, candles, trades, heatmaps, and Zipper datasets require separate validators, freshness UX, and measured benefit before caching.
- Private persistence remains stopped pending a separately reviewed encryption, key-lifecycle, account-isolation, lock/logout, account-switch, cross-tab invalidation, and safe-deletion design.
