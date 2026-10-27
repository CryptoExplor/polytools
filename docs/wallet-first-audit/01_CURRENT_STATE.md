# 01 — Current state (verified baseline)

All statements below were checked in this workspace on 2026-10-27. Commands and raw results
are recorded in [`../wallet-first-audit/01_CURRENT_STATE.md`] §10 and in the final response.
No authenticated exchange request was made. No file in `docs/build-reality-audit/` was read,
modified, staged, or committed — that directory **does not exist** in this checkout.

---

## 1. Repository state — and two corrections to the brief

### 1.1 Actual state

| Item | Actual value |
|---|---|
| Current branch | `arena/609563ba-polytools` |
| HEAD SHA | `091a1b1803ce1fb672e5593c10b51fc0c4cbf23c` |
| `main` SHA | `091a1b1803ce1fb672e5593c10b51fc0c4cbf23c` (identical to HEAD) |
| Working tree | **clean** (`nothing to commit, working tree clean`) |
| Clone type | **shallow, depth 1** (`.git/shallow` present; `git rev-list --count HEAD` = `1`) |
| Tracked files | 184 |
| PR #6 state | **MERGED** — `0981f913356e3d442087e1119c3fc81d93ebc06e`, 2026-10-27T09:28:08Z |
| PR #7 state | **MERGED** — `091a1b1803ce1fb672e5593c10b51fc0c4cbf23c`, 2026-10-27T11:21:26Z |

### 1.2 Correction A — the "verified baseline commit" is not HEAD

The brief names `6506e9f6e70a6d13ed5ccaeec378e4f1ad609ff1` as the verified baseline.

- It **does not exist in this checkout** (`git cat-file -t` → `fatal: Not a valid object name`),
  because the clone is depth 1.
- It **does exist on the remote**. `gh api .../commits/6506e9f` returns
  `"Add stale-aware account data caching"`, 2026-10-26T20:09:40Z.
- It is the **4th and final commit of PR #6's head branch** `arena/cb53163e-polytools` —
  not a `main` tip.
- `main` has since advanced **twice**: merge of PR #6 (`0981f91`) and merge of PR #7
  (`091a1b1`).

I fetched `6506e9f` shallowly to diff it. `git diff --stat 6506e9f HEAD` = **25 files,
+1426 / −231**, including `apps/web/src/lib/publicDtos.ts` (new, 306 lines),
`apps/web/src/lib/sdkTypescriptExamples.ts` (new, 122 lines), `tests/public-api-dto.test.mjs`
(new, 211 lines), `tests/sdk-typescript-examples.test.mjs` (new, 89 lines), plus edits to
`packages/core/src/account/analytics.ts`, `export.ts`, `data.ts`, `README.md`.

**All of PR #6's account-reliability safeguards survive into HEAD** — verified individually
in §6, not assumed from the diff.

### 1.3 Correction B — "keep F-07–F-11 deferred" contradicts merged history

The brief says: *"Keep F-07–F-11 and the combined activity feed deferred until the required
data-ordering and cursor contracts are verified."*

Reality:

- **PR #7 is already merged**, titled *"Implement audit findings F-07 through F-11"*.
- The identifiers `F-07`…`F-11` appear **nowhere** in the repository — not in code, docs, or
  tests. (`grep -rn "F-07\|F-08\|…" docs/ apps/ packages/ backend/ tests/` → the only hit is
  an unrelated `DEF-03, DEF-11` string in `tests/polytools.test.mjs:246`.) Their defining
  document would have been `docs/build-reality-audit/`, which is absent here.
- The **combined activity feed is genuinely not implemented**. `packages/core/src/account/activity.ts`
  contains only transfer-reason/side/bucket label maps — no feed. No route, component, or
  dataset merges orders + fills + transfers into one timeline.

So F-07–F-11 cannot be "verified as deferred" because they cannot be identified in the tree.
I have **not** reverted PR #7 (forbidden: no history rewrite, no discarding user work) and have
**not** implemented anything. This is raised as a blocking question in `08_OPEN_QUESTIONS.md` Q1.

---

## 2. Stack, tooling, entry points

| Aspect | Value | Evidence |
|---|---|---|
| Layout | npm workspaces: `packages/core`, `apps/web`, `backend` | `package.json` `workspaces` |
| Package manager | npm (lockfile v3) | `package-lock.json` |
| Node engine | `>=24` | `package.json:engines`. **Sandbox runs v22.22.3** → `EBADENGINE` warning on install |
| Frontend | Vite 5 + React 18 + `react-router-dom` 6, **HashRouter** | `apps/web/package.json`, `apps/web/src/App.tsx` |
| Language | TypeScript `~5.6` | `apps/web/package.json` |
| Backend | One pure Web-API handler, no framework | `backend/src/handler.ts` |
| Deploy targets | Cloudflare Pages/Worker, Vercel Edge, GitHub Pages | `README.md`, `vercel.json`, `wrangler.toml`, `backend/adapters/*` |
| Entry (web) | `apps/web/src/main.tsx` → `App.tsx` | — |
| Entry (api) | `backend/src/handler.ts:api()`; adapters `cloudflare-pages.ts`, `vercel.ts`, `worker.ts`, `node.ts`; shims `functions/api/[[path]].ts`, `backend/api/[...path].ts` | — |

### Commands (verified, see §10 for results)

```
npm install         npm run dev          npm test              npm run typecheck
npm run build       npm run check:runtime    npm run check:whitespace
npm run check:external   npm run check:dependencies   npm run check:contrast
```

---

## 3. Pages, routes, navigation

`apps/web/src/App.tsx` (HashRouter, every non-landing route lazy-loaded, with a build-performance budget).

### Public routes

| Route | Page module | Feature |
|---|---|---|
| `/` | `pages/Dashboard.tsx` | Markets overview, prices, 24h stats, sparklines, watchlist, CSV |
| `/tape` | `pages/Tape.tsx` | Public trade tape, whale alerts |
| `/book` | `pages/Book.tsx` | Order book, depth chart |
| `/charts` | `pages/Charts.tsx` | Candles, volume, crosshair, live refresh |
| `/heatmap` | `pages/Heatmap.tsx` | Order-book depth density / imbalance over time |
| `/compare` | `pages/Compare.tsx` | Polyester index vs CoinGecko, premium/discount bps |
| `/zipper` | `pages/Zipper.tsx` | Bridge chains, fees, minimums, route comparison |
| `/calc` | `pages/Calc.tsx` | Position sizing, margin, PnL/fee, conversion |
| `/hub` | `pages/Hub.tsx` | Faucet, onboarding checklist |
| `/sdk` | `pages/SdkGuide.tsx` | TS/Python/Rust SDK snippets |
| `/brand-kit` | `pages/BrandKit.tsx` | Brand assets |

### Account routes (all rendered by `pages/Portfolio.tsx`, 1084 lines, `path="account/*"`)

| Route | Section key | Feature |
|---|---|---|
| `/account` | overview | Balances, sampled balance/equity history, current fee rates, confirmed exports |
| `/account/api` | api | **Key setup** — encrypted vault, nonextractable Ed25519 session, read-only reads |
| `/account/trade` | trade | Account fills + actual execution fees |
| `/account/orders` | orders | Open + completed orders, order details |
| `/account/pnl` | pnl | Experimental FIFO / moving-weighted-average cost basis |
| `/account/transactions` | transactions | Transfers (+ credential-free public lookup via `?scope=public`) |

Legacy redirects: `/flow` → `/account/transactions?scope=public`, `/portfolio` → `/account`
(`apps/web/src/lib/navigation.ts`, `App.tsx` `AccountRedirect`).

Navigation model: `components/Layout.tsx` groups = Account, Market Data, Cross-Chain (Zipper),
Toolkit & Docs, with per-route titles in a `ROUTE_META` map.

---

## 4. Authentication and wallet connection today

### 4.1 Wallet connection: **does not exist**

- **No wallet library is installed anywhere.** Production dependencies are exactly 8 packages
  (`npm run check:dependencies`: *"Production licenses: MIT=8"*) — React, React DOM,
  React Router and their transitive deps. `grep -rn "viem\|wagmi\|ethers\|walletconnect\|window.ethereum"`
  finds no integration code.
- `apps/web/src/lib/store.tsx` (369 lines) holds theme, symbol, watchlist, public connection
  status. It has **no** wallet, address, chain, or account state.
- `viem` exists in `node_modules` only as a transitive **dev** dependency of `@polyester/sdk`.
- There is therefore no disconnect handler, no `accountsChanged`, no `chainChanged` handling
  — because there is no connection to change.

### 4.2 Exchange authentication today: hand-rolled Ed25519 request signing

Not the SDK. The app implements its own contract:

- `packages/core/src/account/signer.ts` — `Ed25519RequestSigner`. Builds a canonical string and
  emits three headers: `X-API-KEY-ID`, `X-API-TIMESTAMP`, `X-API-SIGNATURE`
  (`signedHeaders()`). Timestamps come from a process-wide `MonotonicTimestampAllocator` so
  each attempt is strictly increasing.
- `packages/core/src/account/canonical.ts` — `buildCanonicalString`, `sha256Hex`, base64/hex helpers.
- `packages/core/src/account/rest.ts` — `POLYESTER_TESTNET_REST_ORIGIN = "https://api.testnet.polyester.com"`,
  `ACCOUNT_CONTRACT_VERSION = "friendly-rest@b34853cb14366c9a64d53a20f6b09496a3c09fc4"`.
  Uses `credentials: "omit"`, `cache: "no-store"`, `redirect: "error"`, `mode: "cors"`
  (documented in `docs/account-live-verification.md`). 30 s default timeout, 120 s max.
- `@polyester/sdk` is a **root devDependency only**. The only occurrences of the string
  `@polyester/sdk` are: `package.json`, the SdkGuide snippet strings
  (`apps/web/src/lib/sdkTypescriptExamples.ts`), `pages/SdkGuide.tsx`, `pages/Hub.tsx`, the
  external-content checker, and two tests. **No runtime import exists.**

### 4.3 Where API keys are entered, validated, stored, transmitted, invalidated

| Stage | Implementation | Evidence |
|---|---|---|
| **Entry / creation** | User creates or imports a key *inside the browser*. The private key never leaves the tab. | `AccountVault.createKey` / `importKey` (`vault.ts:769`, `:829`) |
| **Validation** | `normalizeRegisteredKeyId()` requires server-issued form `/^ak_[A-Za-z0-9_-]{1,125}$/`. A local vault label is explicitly *not* an authentication identity. | `signer.ts:50` |
| **Server registration** | Out-of-band, in Polyester's own UI: `POLYESTER_API_KEYS_URL = "https://testnet.polyester.com/account/api-keys"` (`vault.ts:35`). The user pastes back only the `ak_…` **ID**, never a secret. | `Portfolio.tsx:490`, `:876`, `:1014` |
| **At-rest storage** | IndexedDB only, ciphertext only: PBKDF2-SHA-256 (600 000 iterations, salt 16 B) + AES-GCM-256 (IV 12 B, 128-bit tag, additionalData bound to entry). `INDEXED_DB` via `IndexedDbVaultStorage`. **No localStorage key fallback.** | `vaultStorage.ts`, `vault.ts:34`, `:291` |
| **In memory** | Ed25519 key imported **nonextractable**; PKCS#8 plaintext zeroed in `finally` blocks. | `vault.ts:934-975`, `RAW_ED25519_PKCS8_PREFIX` |
| **Transmission** | Only signature headers. No body, no secret in URL. | `signedHeaders()`, `docs/account-live-verification.md` §3 |
| **Invalidation** | `lock()`, `deleteEntry()`, `wipeAll({includeLegacy})`, `dispose()`; 15-min idle timeout (`DEFAULT_IDLE_TIMEOUT_MS`); 5 failed unlocks → 30 s lockout (`MAX_FAILED_UNLOCKS`, `UNLOCK_LOCKOUT_MS`); monotonic `generation` token re-checked in `requireSession()` → `VAULT_STALE`; cross-tab invalidation via `BroadcastChannel` + `VAULT_CONTROL_STORAGE_KEY` control events. | `vault.ts:32-33`, `:1000-1043`, `requireSession()` |
| **Legacy** | `LEGACY_STORAGE_KEY = "poly-tools:vault:v1"` with `migrateLegacyVault()` + `deleteLegacyVault()` | `vault.ts:30`, `:497`, `:529`, `:1066` |

Credential hygiene is genuinely good here. Nothing private is written to durable storage;
the vault's own comment states "Storage boundary contains ciphertext and random control
metadata only."

---

## 5. Data clients and external dependencies

| Layer | Client | Transport | Auth | Destinations |
|---|---|---|---|---|
| Public market data | `packages/core/src/mcp.ts` (271 lines) + `tools.ts` (134) + `config.ts` | **MCP** streamable-HTTP | none | `https://polyester-mcp-testnet.fabriclabs.workers.dev/mcp` (`config.ts:25`) |
| Public facade | `backend/src/handler.ts` (452) + `cache.ts` | GET JSON + TTL cache, CORS `*` | none | proxies the MCP endpoint |
| Private account data | `packages/core/src/account/rest.ts` (743) | **friendly REST** GETs | Ed25519 headers | `https://api.testnet.polyester.com` |
| Public catalog (unsigned) | `account/catalog.ts` `fetchOfficialSpotCatalog()` | REST GET | none | `GET /v1/spot/config` — also supplies the signing clock |
| Price comparison | `apps/web/src/lib/coingecko.ts` | REST | none | `api.coingecko.com` |
| Optional alerts | `backend/adapters/worker.ts` cron | POST | Telegram bot token | Telegram API |
| Realtime | none (polling) | — | — | — |

**Important architecture fact:** the public tools use MCP, **not** the SDK and **not** the
friendly REST. `backend/src/handler.ts` speaks MCP server-side purely because the MCP
endpoint does not answer browser CORS preflights. The backend is explicitly *not* a
private-account proxy and must never receive private material.

### Public backend routes (`backend/src/handler.ts`)
`/api/health`, `/api/env`, `/api/markets`, `/api/overview`, `/api/orderbook`, `/api/candles`,
`/api/trades`, `/api/heatmap`, `/api/zipper/config`, `/api/zipper/routes`,
`/api/zipper/compare`, `/api/flow`, `/api/flow/by-tx`, `/api/flow/explain` — all GET + OPTIONS.
Query allowlists enforced (`VALID_DEPTHS`, `VALID_TIMEFRAMES`, `VALID_HEATMAP_INTERVALS`,
`VALID_SIDES`, `VALID_COMPARE_BY`, `VALID_LOOKUP_KIND`).

---

## 6. Account-data caching, periods, cursors, session/vault lifecycle

### 6.1 The PR #6 safeguards — individually verified present in HEAD

All of the following were confirmed by reading the code at HEAD, not inferred from the brief.

| Safeguard | Where | Verified behaviour |
|---|---|---|
| **Explicit first-read activation** | `accountSessionOwner.ts` `activated` field; `load()` returns early unless `options.explicit` **or** already activated; `refreshIfActivated()` no-ops when `!activated` | First private read requires the user's explicit action. `activated` is set by `load({explicit:true})`, never by mount or visibility. |
| **Two-minute visibility freshness** | `ACCOUNT_DATA_FRESHNESS_MS = 2 * 60 * 1000` (`:16`); `isRangeStale()` (`:176`); `shouldRefreshOnVisibility()` (`:302`) | Stale if any of 8 datasets is >2 min old, or an incomplete range has gone >2 min without an attempt. Manual refresh passes `explicit:true` and bypasses age gates. |
| **Per-period caches** | `state.periods: Partial<Record<AccountHistoryRange, AccountRangeState>>`; `setRange()`, `getRangeState()` | Switching reporting period never discards another period's data; caches are keyed by range. |
| **Vault/session invalidation** | `SESSION_BOUNDARIES = {LOCK, WIPE, VAULT_CHANGED, IMPORT, UNLOCK}`; `vault.subscribe()` → `clearForVaultBoundary()` | Any vault boundary event wipes all private state and aborts in-flight work. |
| **Stale-response guards** | `isCurrent(request)` (:398) and `isSessionIdentityCurrent()` | A response is discarded unless `inFlight === request`, signal not aborted, and **both** vault generation **and** entryId still match the request's captured values. |
| **View-scoped errors** | `errors: Partial<Record<"snapshot"\|"balanceHistory"\|"openOrders", SafeAccountError>>`; `Promise.allSettled` + per-result assignment | One dataset failing does not blank the others. |
| **Single-flight** | `InFlightLoad` keyed `${generation}:${entryId}:${range}` | Concurrent manual/visibility callers share one promise. |
| **No durable private storage** | class comment + `MemoryDatasetStore` | Private responses live in memory only. |

Additional related mechanisms:
- **Broad disclosed read bundle**: `coordinator.loadAll()` returns a `AccountDataSnapshot`
  covering balances, equity, orders, fills, transfers, feeRates (8 datasets counted in
  `isRangeStale` incl. balanceHistory and openOrders).
- **Clock skew**: derived from the *unsigned* official catalog `tsSec`
  (`accountSessionOwner.ts` `performLoad`), applied only to signing timestamps, bounds-checked
  against `Number.MAX_SAFE_INTEGER`.
- **Cursor pagination**: `account/pagination.ts` `collectCursorPages()` — opaque tokens,
  never parsed; detects repeated cursors (`REPEATED_CURSOR`), enforces a page cap
  (1…10 000, default 1000), returns validated prefix on error so callers can label *partial*.
- **Coverage reporting**: `account/coverage.ts` `Coverage` records `status`, `pagesFetched`,
  `rowsAccepted`, `duplicateRows`, `conflictingRows`, `unknownRows`, `droppedRows`,
  `cursorExhausted`, `stoppedAtCap`, `openingBasis`, `nonFillFlows`. The UI is built on this.
- **Temporary-error stale fallback**: `data.ts:400` — `canUseStale` only when a previous
  dataset exists **and** the error is in `TEMPORARY_ERRORS`; `ACCOUNT_STALE`/`ABORTED` map to
  `"stale"` (`data.ts:230`).

### 6.2 Read-only operation registry (the "broad account-read disclosure and request set")

`packages/core/src/account/signer.ts` `READ_ONLY_OPERATIONS` — 10 operations, all `GET`,
signed only through `AccountVault.signReadRequest()` which rejects anything not in the registry:

| Key | Method | Path |
|---|---|---|
| `authMe` | GET | `/v1/auth/me` |
| `balances` | GET | `/v1/balances` |
| `balanceHistory` | GET | `/v1/balances/history` |
| `equityHistory` | GET | `/v1/equity/history/series` |
| `ordersOpen` | GET | `/v1/orders/open` |
| `ordersHistory` | GET | `/v1/orders/history` |
| `orderDetails` | GET | `/v1/spot/orders/{order_id}` |
| `fills` | GET | `/v1/spot/trades` |
| `transfers` | GET | `/v1/transfers` |
| `feeRates` | GET | `/v1/spot/fee-rates` |

No mutation operation exists anywhere in the repository. Confirmed by the README: *"no order
placement, cancellation, transfer, or withdrawal is provided by this repository."*

---

## 7. Tests and known gaps

### 7.1 Test inventory — `node --test tests/*.test.mjs`, 29 files, **318 tests / 71 suites, all passing**

Account/crypto critical: `account-rest` (14), `account-coordinator` (25), `account-data` (17),
`account-session-owner` (11), `account-lots` (18), `account-export` (6),
`canonical-request` (14), `account-setup-secrets` (2), `account` (15), `account-ux` (18),
`account-cost-basis-ux` (5).
Public/UI: `public-cache` (21), `frontend-batch1` (29), `public-phase1` (10),
`public-api-dto` (7), `polytools` (15), `phase2-ux` (12), `dialog-focus` (12),
`contrast-tokens` (9), `deployment-security` (9), `compare` (7), `maintenance-scripts` (7),
`phase3-ux` (6), `development-parity` (5), `request-identity` (5),
`deploy-workflow-gate` (2), `calculator-copy` (1), `sdk-order-constraints` (20),
`sdk-typescript-examples` (2).

### 7.2 Known gaps (stated by the repo itself, confirmed by inspection)

1. **No live authenticated verification from a browser origin.** `docs/account-live-verification.md`
   is explicitly *"a manual release gate, not a record of completed live verification."* CORS
   preflight, permission scope, and browser-origin success remain **unverified**.
2. **Headless live evidence is second-hand.** `docs/live-testnet-verification-report.md` reports
   8/8 endpoints HTTP 200 with validated schemas, but: *"attributed to the local agent and does
   not replace the browser-origin, CORS, vault, pagination-completeness, or P&L gates."* It also
   notes the referenced commit `3f179d5` could not be resolved.
3. **P&L remains unverified/unavailable** as a verified metric; the UI labels it experimental and
   user-assisted.
4. **`balanceHistory` and `orderDetails` were not in the 8-endpoint live report** (report covers
   `authMe`, `balances`, `feeRates`, `ordersOpen`, `ordersHistory`, `fills`, `transfers`,
   `equityHistory`). Their live compatibility is unproven.
5. **Mainnet private reads unsupported** — no endpoint, signing contract, or permissions verified.
6. **Zero wallet tests** — nothing to test yet.
7. **No realtime/WebSocket usage** — everything polls; no stream coverage.
8. **Node runtime drift** — repo requires Node ≥24, sandbox provides v22.22.3.

---

## 8. Security posture as it stands

- **CSP** (`apps/web/public/_headers`, `packages/core/src/deploymentSecurity.ts`):
  `default-src 'self'; script-src 'self'; frame-ancestors 'none'; frame-src 'none';
  connect-src 'self' https://api.coingecko.com https://api.testnet.polyester.com https://*.workers.dev`
  plus `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options: DENY`.
- **No server secrets in frontend env.** `apps/web/.env.example` carries only an optional
  `VITE_API_BASE`. Telegram secrets are Worker secrets set via `wrangler secret put`.
- **CORS facade is `Access-Control-Allow-Origin: *`** — acceptable for public read-only data,
  and must never be extended to private data.
- Vault encryption parameters are all conservative and documented in §4.3.

---

## 9. Pre-existing working-tree changes

**None.** `git status` reported a clean tree before any work began, and no tracked file was
modified by this audit. All files created by this audit are new and untracked:

```
docs/wallet-first-audit/00_EXECUTIVE_RECOMMENDATION.md
docs/wallet-first-audit/01_CURRENT_STATE.md
docs/wallet-first-audit/02_OFFICIAL_SDK_CAPABILITIES.md
docs/wallet-first-audit/03_FEATURE_PARITY_MATRIX.md
docs/wallet-first-audit/04_TARGET_ARCHITECTURE.md
docs/wallet-first-audit/05_MIGRATION_PLAN.md
docs/wallet-first-audit/06_SECURITY_AND_DATA_RISKS.md
docs/wallet-first-audit/07_ACCEPTANCE_TEST_MATRIX.md
docs/wallet-first-audit/08_OPEN_QUESTIONS.md
```

Nothing staged, nothing committed, per instruction.

---

## 10. Commands run and actual results

| Command | Result |
|---|---|
| `git status` | `On branch arena/609563ba-polytools` / `nothing to commit, working tree clean` |
| `git rev-parse HEAD` | `091a1b1803ce1fb672e5593c10b51fc0c4cbf23c` |
| `git log --oneline -15` | single line: `091a1b1 Merge pull request #7 …` |
| `git rev-list --count HEAD` | `1` (shallow) |
| `cat .git/shallow` | `091a1b1803ce1fb672e5593c10b51fc0c4cbf23c` |
| `git cat-file -t 6506e9f…` | `fatal: git cat-file: could not get object info` |
| `gh api repos/.../commits/6506e9f…` | **found** — `"Add stale-aware account data caching"`, 2026-10-26T20:09:40Z |
| `gh pr list --state all --limit 20` | #6 `MERGED` @ `0981f91`; #7 `MERGED` @ `091a1b1`; #2–#5 also merged |
| `gh pr view 6` | 4 commits; last `6506e9f`; `mergedAt 2026-10-27T09:28:08Z` |
| `git fetch --depth 1 origin 6506e9f` then `git diff --stat 6506e9f HEAD` | 25 files, +1426/−231 |
| `npm install --no-audit --no-fund` | `added 153 packages in 14s`; `EBADENGINE` (needs Node ≥24, have v22.22.3) |
| `npm test` | **318 tests, 318 pass, 0 fail**, 71 suites, 40.3 s |
| `npm run typecheck` | PASS (web + backend, exit 0) |
| `npm run check:runtime` | **Probes PASS** (TextDecoder, Blob, URL, webCrypto, ed25519) but the **command exits 1**: its `engine >=24` assertion fails on the recorded Node v22.22.3 |
| `npm run check:whitespace` | 184/184 files, **0 violations** |
| `npm run check:external` | 13 links, 89 assets, 3 SDKs; `npm:@polyester/sdk pin=0.31.0; sourceMatches=true`; 0 mismatches |
| `npm run check:dependencies` | 225 external paths (8 prod, 217 dev); **`UNLICENSED=1`**; 0 missing licence metadata |
| `npm run check:contrast` | 54/54 token pairs ≥ 4.5:1 |

Not run (out of scope / would consume budget): `npm run build`,
`npm run check:performance`, and all `:live` network checks. No authenticated request was
made at any point.

---

## 11. One-paragraph summary

PolyTools at HEAD `091a1b1` is a clean, passing, well-guarded read-only analytics SPA: 11
public market routes fed by a Fabric-Labs MCP endpoint through a thin CORS facade, and 6
account routes fed by hand-rolled Ed25519-signed GETs against `api.testnet.polyester.com`.
Its account layer is the strongest part of the codebase — encrypted IndexedDB vault,
nonextractable keys, generation-guarded sessions, honest coverage reporting — and all PR #6
safeguards are intact. It has **no wallet connection of any kind**, does not use
`@polyester/sdk` at runtime, and performs no mutations.

**Status correction (see `12` §1).** When this was written the brief assumed "HEAD `6506e9f`,
PR #6 open". Both are now historical: **PR #6 merged 2026-10-27T09:28Z** and **PR #7 merged
2026-10-27T11:21Z**, and `6506e9f` survives only as the head of the frozen branch
`arena/cb53163e-polytools` (squash-merge means it is not an ancestor of `main`). Current baseline:
**`main @ 091a1b1`**, re-verified this session at **318/318 tests across 71 suites**.
The F-07–F-11 deferral instruction is likewise moot: **PR #7 already implemented them** by its own
title and body.
