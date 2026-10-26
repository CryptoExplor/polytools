# Public-cache race hardening

- **Date:** 2026-10-25
- **Branch:** `arena/2679a49c-polytools`
- **Pre-edit state:** clean working tree at `22ebfed52621e7d262834260b95da7a50eec4ea4`
- **Status:** reviewed for publication; browser and other PR release gates remain open; not release-approved
- **Verified source/test tree:** `ed8723db33bd779df7033672a296ba81856614cf` before post-verification audit documentation updates; see section 6

## 1. Decision and scope

The four confirmed existing public-cache problems are addressed in source and dependency-free synthetic tests. This is not a second cache and does not add a cached endpoint, private persistence, credentials, account behavior, polling, or deployment.

Production caching remains limited to the existing validated public `GET /api/markets` catalog through `api.marketsForCache()` and `marketMetadataCache`. The account vault, authenticated account reads, R2 cursor behavior, and R3 fail-closed accounting are unchanged.

Stop here for review. Fresh exact-tree repository, TypeScript, build, and performance results are recorded in section 6. Real-browser validation and the other documented PR release gates remain open; this document does not authorize cache expansion or private persistence.

## 2. Root causes and fixes

| Problem | Root cause | Implemented fix |
|---|---|---|
| Delayed persistent reads could overwrite newer memory | `read()` awaited storage without recording an operation revision or rechecking the visible in-memory writer before publishing the persistent value | Reads capture generation plus mutation revision. A newer committed operation supersedes the pending read; a current valid memory value may be returned, but old persistent data is not published. Newer memory wins; an equal-`savedAt` current first writer wins when no newer mutation occurred. Missing/invalid times fail envelope decoding. |
| Invalidation and asynchronous storage operations could resurrect or delete data | A generation check before an asynchronous write/delete was insufficient; cleanup could also act on an old snapshot | Memory and IndexedDB writes/deletes accept an operation guard checked after asynchronous work and before mutation. Per-key revisions close read/delete/write await windows. Invalidation owns its generation, and a post-invalidation refresh may fetch concurrently but waits for the prior persistent delete before committing. Cleanup deletes carry the snapshot `savedAt` plus generation/revision guards. Stale refresh memory cleanup uses reference identity, not timestamp equality. |
| Oversized or other non-cacheable success could make older data current again | The network value was returned without removing the prior reusable entry | Valid oversized, `no-store`, `private`, and zero-retention successes return their network value but invalidate older reusable memory/persistent entries. Reads pending during that cleanup cannot restore the old value. Fetch/network/validation failures still retain the last valid entry. |
| A later cache-only check could cancel a manual network refresh | One provider request counter covered cache checks, network requests, and environment diagnostics | `MetadataRequestSequencer` gives cache checks, network refreshes, and environment refreshes independent sequence numbers. Network results also require current network ownership and a `savedAt` no older than the visible value; equal times use latest network-operation order. Existing same-key cache-flight deduplication remains. |
| Stale/error provenance could disappear on narrow screens | The status pill always received `hide-xs` | Only a fresh non-error cache pill is hidden at the extra-small breakpoint. Stale/error provenance and retry remain visible in the rendered markup. |

No polling interval, event registration cadence, API endpoint list, cache key, schema, freshness limit, stale limit, byte limit, or public/private storage boundary was changed.

## 3. Files changed

- `apps/web/src/lib/publicCache.ts` — read ordering, mutation revisions, guarded IndexedDB/memory writes and deletes, invalidation/commit ordering, non-cacheable retention, and cleanup guards.
- `apps/web/src/lib/metadataRequestSequencer.ts` — new dependency-free request sequencer and visible-result ordering helper; this coordinates requests and stores no response data.
- `apps/web/src/lib/store.tsx` — existing provider wiring only; the cache singleton, endpoint, decoder, and 60-second check are unchanged.
- `apps/web/src/components/PublicCacheStatus.tsx` — responsive stale/error provenance class.
- `tests/public-cache.test.mjs` — deterministic deferred-promise/controlled-storage regressions and SSR/source assertions.
- `docs/audit/LOCAL_CACHE_PILOT.md` — link to this hardening review and clarification of historical results.
- `docs/audit/PUBLIC_CACHE_RACE_FIXES.md` — this evidence report.

## 4. Deterministic regression coverage

`tests/public-cache.test.mjs` now declares **21 tests in four suites**. The new cases use explicitly resolved deferred promises and controlled storage, not sleeps. Coverage includes:

- delayed persistent reads with newer and equal-`savedAt` memory values;
- invalid/missing timestamps and public-only runtime decoding;
- reads pending before and during invalidation;
- reads pending during non-cacheable cleanup;
- late writes, delayed non-cacheable deletes, and same-time newer results after invalidation;
- an older invalidation delete overlapping a newer post-invalidation refresh;
- cleanup using an old storage snapshot while a newer refresh commits;
- oversized, `no-store`, `private`, and zero-retention successes;
- same-key request deduplication and failure retention;
- independent cache/network/environment provider sequencing;
- fresh versus stale/error responsive-class SSR markup.

The standalone harness executes the dependency-free production cache and sequencer modules directly. It does **not** execute the React provider, real IndexedDB, or a browser.

## 5. Initial verification before dependency setup

### Synthetic tests and dependency-free checks actually run

Local runtime: **Node v22.22.3**. At this initial stage, no dependencies had been installed or upgraded.

| Command | Result |
|---|---|
| `node --experimental-transform-types --test /tmp/polytools-cache-fix-verification.mjs` | **PASS: 11/11 tests**, 0 failed. Log: `/tmp/polytools-cache-fix-verification-20261025.log`. Node emitted its experimental type-transform warning. |
| `node --test tests/maintenance-scripts.test.mjs` | **PASS: 7/7 tests**, 2 suites. Log: `/tmp/polytools-cache-fix-maintenance-20261025.log`. |
| `npm run check:runtime` | **PASS** for the current Node runtime and checked Web APIs/crypto. This is not a Node 18/20/22 matrix rerun. |
| `npm run check:dependencies` | **PASS** lockfile/license/workspace inventory; explicitly not a vulnerability audit. No manifest or lockfile changed. |
| `git diff --check` | **PASS**; no whitespace/conflict-marker error in tracked edits. |
| `npm run check:whitespace` | **PASS: 162/162** tracked plus untracked/non-ignored files checked; 0 violations, 0 binary/large files skipped. |
| `node --experimental-transform-types --input-type=module -e 'await import("./apps/web/src/lib/publicCache.ts"); await import("./apps/web/src/lib/metadataRequestSequencer.ts"); console.log("Native cache/sequencer imports: PASS")'` | **PASS** for both native module imports; experimental type-transform warning only. Log: `/tmp/polytools-cache-fix-imports-20261025.log`. |

### Repository checks then blocked by the existing environment

These were setup failures before the later lockfile-only `npm ci`; they are preserved as initial evidence and superseded by the fresh passing results in section 6, not by historical test counts.

| Command | Exact local outcome |
|---|---|
| `node --test tests/public-cache.test.mjs` | Exit 1 during module loading: `Cannot find package 'react'`. None of the 21 focused assertions executed in this runner. Log: `/tmp/polytools-cache-fix-focused-test-20261025.log`. |
| `npm test` | Exit 1. Raw runner summary: 23 tests, 7 passed, 16 failed; the 16 failures were test-file module-load failures caused by absent packages such as `vite`/`react`, while the seven passes were dependency-free maintenance tests. This is **not** a full behavioral test run or a demonstrated cache assertion failure. Log: `/tmp/polytools-cache-fix-npm-test-20261025.log`. |
| `npm run typecheck` | Exit 127: `tsc: not found`. Log: `/tmp/polytools-cache-fix-typecheck-20261025.log`. |
| `npm run build` | Exit 127 at `tsc -p tsconfig.json`: `tsc: not found`; Vite build did not start. Log: `/tmp/polytools-cache-fix-build-20261025.log`. |
| `npm run check:performance` | Exit 1: `apps/web/dist/index.html is missing; run npm run build first`. No performance/build measurement was produced. |

These are environment/dependency gates, not passes. Historical pilot or CI results are not substituted for a fresh full-suite run of these edits.

### Source and scope review

- Production call-site inspection still finds only `marketMetadataCache` and `api.marketsForCache()` for this application cache. No new cached endpoint was added.
- The provider diff contains no polling timer or endpoint change.
- No account, R2, R3, API wrapper, vault, manifest, or lockfile file was edited. At this initial stage, that was a diff/scope check rather than an R2/R3 runtime rerun; section 6 records the later full-suite result.
- At this initial stage, no real credentials, authenticated live requests, financial mutations, SDK/trading execution, commit, push, merge, deployment, or dependency installation occurred.

## 6. Exact release-tree verification with existing lockfile dependencies

### 6.1 Exact tree and PR identity

Preflight ran on 2026-10-25 with Node **v22.22.3** and npm **10.9.8**:

- Branch: `arena/2679a49c-polytools`.
- Local HEAD: `22ebfed52621e7d262834260b95da7a50eec4ea4`.
- PR #4: `OPEN`, base `main`, head branch `arena/2679a49c-polytools`, head `22ebfed52621e7d262834260b95da7a50eec4ea4`, `mergeStateStatus: UNSTABLE`, `mergedAt: null`.
- PR URL: https://github.com/CryptoExplor/polytools/pull/4.
- Exact non-ignored working-tree fingerprint before dependency setup and again after tests/build: `ed8723db33bd779df7033672a296ba81856614cf`.

At preflight, the local HEAD and then-current PR head were identical commits, while the cache fixes and this report were uncommitted working-tree changes. Therefore these results verified the fingerprinted working tree, **not** the then-current PR head, which did not yet contain the fixes.

Exact pre-verification `git status --short --untracked-files=all`:

```text
 M apps/web/src/components/PublicCacheStatus.tsx
 M apps/web/src/lib/publicCache.ts
 M apps/web/src/lib/store.tsx
 M docs/audit/LOCAL_CACHE_PILOT.md
 M tests/public-cache.test.mjs
?? apps/web/src/lib/metadataRequestSequencer.ts
?? docs/audit/PUBLIC_CACHE_RACE_FIXES.md
```

The fingerprint was generated without changing the real index or committing:

```sh
index=$(mktemp /tmp/polytools-release-index-XXXXXX)
cp .git/index "$index"
GIT_INDEX_FILE="$index" git add -A -- .
GIT_INDEX_FILE="$index" git write-tree
rm -f "$index"
```

Preflight log: `/tmp/polytools-release-tree-preflight-20261025.log`. PR evidence: `/tmp/polytools-pr4-head-20261025.json` and `/tmp/polytools-pr4-postverify-20261025.json`.

### 6.2 Lockfile-only setup

`node_modules` was absent. The new verification environment was prepared with exactly:

```sh
npm ci
```

Result: exit **0**, `added 113 packages, and audited 117 packages in 6s`. npm reported **7 vulnerabilities (5 moderate, 2 high)**. No `npm audit fix`, dependency update, or version override was run. These audit findings remain separate from the passing lockfile/license inventory.

The following SHA-256 values were identical before and after setup and after verification:

```text
package.json       250d245033aa1f80df13f2091fc2ce04b78e98a6c5fdf89beb5a2848ff4bb1bc
package-lock.json  0ac0c77d724f57516507c9f9da4a09da36b2506ae9a08b8082052b52c00562de
```

Setup log: `/tmp/polytools-release-npm-ci-20261025.log`. `node_modules` is ignored; no manifest or lockfile entered the working-tree diff.

### 6.3 Fresh commands and results

| Exact command | Fresh result on tree `ed8723db…` |
|---|---|
| `node --test tests/public-cache.test.mjs` | **PASS, exit 0: 21/21 tests, 4 suites**, 0 failed/skipped. Log: `/tmp/polytools-release-focused-20261025.log`. |
| `npm test` (`node --test tests/*.test.mjs`) | **PASS, exit 0: 202/202 tests, 44 suites**, 0 failed/skipped; 25,226 ms runner duration. Log: `/tmp/polytools-release-full-tests-20261025.log`. Existing React SSR `useLayoutEffect` warnings were not suppressed. |
| `npm run typecheck` | **PASS, exit 0** for both `apps/web` and `backend` TypeScript projects. Log: `/tmp/polytools-release-typecheck-20261025.log`. |
| `npm run build` | **PASS, exit 0**; Vite 5.4.21, 99 modules. JS 595.31 kB / 177.48 kB gzip, CSS 34.09 kB / 7.02 kB gzip, source map 2,029.11 kB. The existing over-500-kB chunk warning remains. Log: `/tmp/polytools-release-build-20261025.log`. |
| `npm run check:performance` | **PASS, exit 0**. Initial JS: 1 request, 595,963 bytes, 177,125 gzip-9 bytes; CSS: 1 request, 34,086 bytes, 6,987 gzip-9 bytes; 3 other icon/manifest requests; 12 static and 0 dynamic app-page imports. All four byte budgets passed. Log: `/tmp/polytools-release-performance-20261025.log`. |
| `npm run check:dependencies` | **PASS** lockfile v3/license/workspace inventory; this is explicitly not a vulnerability audit and does not erase the npm audit findings above. Log: `/tmp/polytools-release-dependencies-20261025.log`. |
| `git diff --check` | The tracked-edit check passed during verification. The later complete parent/tree pre-publication check found four Markdown hard-break trailing-space lines in this new report; they were normalized before commit and the complete delta was rechecked. |
| `npm run check:whitespace` | **PASS: 162/162** tracked plus untracked/non-ignored files, 0 violations. Log before this report update: `/tmp/polytools-release-whitespace-before-docs-20261025.log`. |

The temporary-index fingerprint after setup, tests, and build exactly matched the preflight fingerprint. Thus no source, test, manifest, lockfile, or audit-document content changed during execution. Only audit documentation was written afterward: this report's fresh evidence and the pilot link's updated verification summary.

### 6.4 Four requested regressions

All of the following are fresh passing tests in the focused 21/21 run and again within the full 202/202 run:

| Requested regression | Passing test evidence |
|---|---|
| Delayed read versus newer write | `keeps newer or equal in-memory data when an older persistent read finishes late` |
| Read versus invalidation | `does not resurrect a persistent read that was pending during invalidation`; `does not let a read started during invalidation cleanup restore the old record` |
| Non-cacheable success versus old cache | `invalidates an older reusable entry after an oversized successful response`; `clears older entries for non-cacheable and zero-retention success directives`; delayed-delete and read-during-non-cacheable-cleanup cases also passed |
| Manual refresh versus automatic cache check | `keeps forced network and environment refreshes current across cache-only checks` |

These are controlled-storage/deferred-promise and SSR/source tests. Their passage does not prove real IndexedDB or multi-tab browser behavior.

### 6.5 Scope and unchanged-behavior checks

The following checks ran against the same verified tree:

```sh
grep -RIn 'new PublicDataCache\|new IndexedDbPublicCacheStorage' apps/web/src packages backend --exclude='publicCache.ts'
grep -RIn 'marketsForCache\|MARKET_METADATA_CACHE_KEY' apps/web/src --exclude='publicCache.ts'
git diff --name-only HEAD -- apps/web/src/lib/api.ts packages/core/src/account apps/web/src/components/account* apps/web/src/pages/Account* tests/account* package.json package-lock.json apps/web/package.json backend/package.json packages/core/package.json
git diff HEAD -- apps/web/src/lib/store.tsx | grep -E '^[+-].*(setInterval|setTimeout|MARKET_METADATA_REVALIDATE_MS|addEventListener|removeEventListener)'
git status --short -- package.json package-lock.json apps/web/package.json backend/package.json packages/core/package.json
```

Results:

- Only `marketMetadataCache` constructs `PublicDataCache` with `IndexedDbPublicCacheStorage`; its only network fetcher is `api.marketsForCache()` for public `/api/markets`. No Zipper or other endpoint uses this persistent browser cache.
- Account/R2/R3/API-wrapper/dependency diff output was empty. Private account snapshots remain memory-only and the encrypted vault remains separate.
- Polling/event-cadence diff output was empty; the 60-second metadata revalidation constant is unchanged.
- Account, R2, and R3 synthetic suites passed within the full 202/202 run, including cursor/coverage, exact arithmetic, privacy, opening-basis, flow, and fresh-mark gates. This is not authenticated live-accounting evidence.
- No dependency version or lockfile change occurred. Full scope output: `/tmp/polytools-release-scope-check-20261025.log`.

### 6.6 Browser tooling availability

The environment inventory found no Chromium/Chrome/Firefox executable, no Playwright/Puppeteer package, no jsdom/happy-dom/fake-indexeddb package, and no browser test/config file outside dependencies. Probe log: `/tmp/polytools-release-browser-inventory-20261025.log`.

Consequently, no real-browser test was run. These requested gates remain **open**:

1. Real IndexedDB reload and revalidation.
2. Actual offline/reconnect behavior.
3. Two-tab refreshes and cross-tab timing.
4. Small-screen stale/error status, retry interaction, and layout.

The passing SSR class assertions are not substitutes for these browser checks.

## 7. Unverified browser and live behavior

No browser tooling or installed DOM/browser dependencies are available in this checkout. The following remain explicitly unverified:

- real IndexedDB reload, transaction timing, eviction, denial, and revalidation behavior;
- offline/reconnect transitions in an actual browser;
- two-tab refreshes, cross-tab timing, and duplicate network behavior;
- small-screen layout, visibility, retry interaction, and assistive-technology announcements;
- real HTTP cache interaction, origin request reduction, load time, Web Vitals, and live endpoint behavior.

SSR/source assertions and synthetic storage adapters must not be presented as evidence for those behaviors. No live measurement was taken.

## 8. Remaining review gates

1. Exercise real IndexedDB reload/revalidation, offline/reconnect, two tabs, and narrow-screen stale/error messaging in browser tooling. The local Node 22 focused/full/typecheck/build/performance checks are complete and passing, but they do not close these browser gates.
2. At verification, the fixes were uncommitted and absent from PR #4's then-current `22ebfed` head. Any subsequently published head must be shown to contain the exact reviewed source/test changes before inheriting these results; publication alone does not close the release gates.
3. Review npm's reported 5 moderate and 2 high audit findings separately; no dependency remediation was attempted. The large-chunk build warning also remains despite passing the current performance budgets.
4. Keep the existing public-only/privacy boundaries and unchanged polling under review. Full synthetic account/R2/R3 success does not close authenticated live-accounting gates.
5. Do not merge PR #4 while its separately documented acceptance, dependency, browser/live/accounting, or deployment gates remain unresolved. In particular, prior Node 18 and Workers Builds failures are not cleared by this local Node 22 work.
