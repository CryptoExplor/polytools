# Coding-agent master handoff — PolyTools read-only account analytics

**Handoff date:** 2026-10-23  
**Repository:** `CryptoExplor/polytools`  
**Working branch:** `arena/0dc32768-polytools`  
**Audited application revision:** `171aa84a8753243dc75c9938db7d7e61dc187fa7`  
**Current deliverable:** research/specification only. No account feature has been implemented and no application source file was intentionally changed.

## 1. Read these reports first

The requested “seven reports” plus this handoff are eight files:

1. [`00_CURRENT_STATE.md`](./00_CURRENT_STATE.md) — actual application/backend/vault behavior, checks, and evidence legend.
2. [`01_OFFICIAL_API_CAPABILITY_MATRIX.md`](./01_OFFICIAL_API_CAPABILITY_MATRIX.md) — exact endpoints, SDK/MCP support, policies, pagination, and contract drift.
3. [`02_ACCOUNT_CONNECTION_AND_SECURITY.md`](./02_ACCOUNT_CONNECTION_AND_SECURITY.md) — encrypted vault, signing, CORS, privacy, and live-verification gates.
4. [`03_ANALYTICS_AND_FINANCIAL_FORMULAS.md`](./03_ANALYTICS_AND_FINANCIAL_FORMULAS.md) — exact arithmetic, observed metrics, lot accounting, and incomplete-data rules.
5. [`04_ACCOUNT_ANALYTICS_FRONTEND_SPEC.md`](./04_ACCOUNT_ANALYTICS_FRONTEND_SPEC.md) — routes, components, interactions, accessibility, and every UI state.
6. [`05_BACKEND_AND_DATA_ARCHITECTURE.md`](./05_BACKEND_AND_DATA_ARCHITECTURE.md) — modules, session/cache/cursor pipelines, and tests.
7. [`06_IMPLEMENTATION_ROADMAP.md`](./06_IMPLEMENTATION_ROADMAP.md) — phases, priorities, risks, rollout, and release gates.
8. This handoff — condensed execution instructions.

Do not implement from this summary alone where a linked report contains a stricter rule. The detailed reports are normative.

## 2. Mission and non-goals

### Mission

Extend the existing PolyTools shell into personalized, beginner-friendly, **read-only Polyester testnet account analytics**, using official interfaces and explicit evidence. Start with secure connection, balances/sampled equity, orders/fills, and observed activity. Add P&L only when cost-basis/completeness gates are proven.

### Non-goals / prohibited behavior

- No feature code during the research task; future implementation requires the user's go-ahead.
- No real trade, cancel, transfer, withdrawal, key/policy mutation, deposit-address creation, or interactive-session acquisition.
- No credentials from another user, credentials in chat/CI/source/tickets, or request to the user to paste a secret into conversation.
- No request for trading/transfer/withdrawal write permissions to make reads work.
- No shared/global credential, server-side signer, generic proxy, secret in URL/log/error, or unpartitioned private cache.
- No persistent decrypted private key or continued use of the plaintext vault.
- No synthetic production data, silent zero-filling, invented endpoint/metric, deposit-as-profit, fee-as-burn, or unsupported historical P&L.

## 3. Established baseline

### Actual application

- `/portfolio` is a local Ed25519 vault and interactive request-signing display. It does not execute authenticated requests or retrieve analytics.
- `/sdk` generates text snippets and duplicates canonical-string logic; it does not execute trading snippets.
- Existing public pages use public REST/MCP/CoinGecko data. Every backend adapter shares the public GET handler and global public TTL cache.
- There are no private account routes, account analytics, database, private websocket consumer, or per-user backend state.
- Existing public tools must remain credential-free.

### Current security defects

- `packages/core/src/keys.ts` persists extractable PKCS#8 secrets in plaintext `localStorage` key `poly-tools:vault:v1`.
- No passphrase, lock, idle lock, or cross-tab wipe; key-ID validation and signed-output cleanup are insufficient.
- `Portfolio.tsx` defaults to nonexistent `/v1/account/balances`; the official current-balance path is `/v1/balances`.
- `SdkGuide.tsx` duplicates signing logic and has an unsafe hash fallback edge case.
- No deployed CSP/security-header policy was found.
- Temporary lockfile audit on 2026-10-23 found four vulnerabilities (three moderate, one high), involving Vite/esbuild development-server advisories and React Router. No fix was applied and the temporary lockfile was removed.

### Baseline checks

After installing manifest dependencies without creating a persistent lockfile:

```text
npm test           → 12/12 passed, four suites
npm run typecheck  → passed
npm run build      → passed
```

These demonstrate the existing public app only, not account analytics or private API access. The audit environment used Node `v22.22.3`; the web app is React 18, not React 19. Installed versions included Vite `5.4.21`, React Router DOM `6.30.6`, and TypeScript `5.6.3`.

## 4. Evidence boundaries

Use the labels in `00 §2`; never replace them with a generic “verified.”

| Item | Current truth |
| --- | --- |
| PolyTools behavior | Repository-inspected; existing tests/typecheck/build executed |
| Official endpoints/schemas | Documentation-, schema-, and SDK-source-verified at pinned revisions |
| Public REST | Config, BTC-USDT overview/candles succeeded; invalid orderbook depth returned structured 400 on 2026-10-23 |
| Authenticated REST | **No call made; unverified** |
| Browser CORS | **Unknown** |
| MCP account support | **Not established; existing PolyTools MCP wrappers are public-only** |
| Private realtime | Schema/SDK-source only; not demonstrated |
| Analytics UI | Specification only; not demonstrated |
| Historical P&L | Not supportable without opening basis, complete fills, resolved flows, quote consistency, and marks |

Official source pins are listed in `00 §3`. Keep those commit links in future evidence updates. Do not cite a shallow source inspection as an endpoint call.

## 5. Approved architecture decisions

1. **Direct browser friendly REST** to the explicit official testnet host; local Ed25519 signing; `credentials: "omit"` and memory-only private responses.
2. **No private backend/proxy in MVP.** Existing `backend/src/handler.ts`, `cache.ts`, `mcpServer.ts`, and adapters stay public-only.
3. **Encrypted IndexedDB vault**, AES-GCM/PBKDF2, memory-only nonextractable unlock, idle lock, cross-tab lock/wipe, and explicit legacy migration/quarantine.
4. **One GET-only private client and one canonical signer**, not another copy in a page/component.
5. **Exact decimal/rational arithmetic**, no JavaScript `Number` for financial state and no scale divisors on friendly REST decimals.
6. **Coverage before metrics.** Cursor exhaustion, no dropped/unknown/conflicting rows, and all dependent datasets are required for “complete.” Filter-complete is not inception-complete.
7. **Polling/manual refresh first**, with visible-tab abort and per-dataset freshness. No private websocket requirement.
8. **P&L is optional post-MVP**, gated by opening lots, complete fills, resolved non-fill flows, one quote asset or documented historical FX, and fresh marks for unrealized values.

If CORS or nonextractable browser signing fails, stop and report. Do not silently change these decisions.

## 6. Minimum endpoint map

All private rows are schema/document-verified only until the owner-controlled live gate. Use friendly REST paths exactly; do not normalize naming conventions.

| Need | Friendly REST / generated path | Notes |
| --- | --- | --- |
| Auth context | Generated `GET /v1/auth/me` | Works without policy per docs; identity, not grant list |
| Current balances | `GET /v1/balances` | Total per asset = trading + funding |
| Balance history | `GET /v1/balances/history` | Fixed ranges; sampled/columnar |
| Equity history | `GET /v1/equity/history/series` | Sampled USDT valuation, not live P&L |
| Open orders | `GET /v1/orders/open` | Not `/v1/spot/orders/open` |
| Terminal orders | `GET /v1/orders/history` | Not `/v1/spot/orders/history` |
| Order details | `GET /v1/spot/orders/{order_id}` | Bounded execution page, not reconciliation watermark |
| User fills | `GET /v1/spot/trades` | Actual fee asset/magnitude/rebate sign |
| Finalized transfers | `GET /v1/transfers` | Friendly surface lacks Connect time/code filters; grant unverified |
| Effective fee rates | `GET /v1/spot/fee-rates` | Current percent strings; grant unverified; not historical fees |
| Subaccounts | Generated `GET /v1/auth/subaccounts` | Not in friendly REST spec; root-first, verify before UI |
| Holds | ConnectRPC `ListHolds` only in reviewed surface | No friendly REST operation/high-level TS method; exclude MVP |
| Deposit addresses | Generated `GET /v1/chain/deposit-addresses` | Sensitive and unnecessary for core analytics; exclude MVP |
| Root portfolio snapshot/history | `/v1/equity/portfolio/snapshot`, `/v1/equity/portfolio/history/series` | **Session-only; API keys unsupported** |

Policy candidates are `read-balances`, `read-spot`, and optional `read-internal-transfers`. Exact per-RPC grant annotations are absent for some operations; probe minimally. Never substitute a write grant.

Friendly REST uses operation-specific snake/camel query names. Preserve opaque cursors as exact strings. Python/Rust transfer decoders lose nonnumeric cursors; do not use them for complete-history claims. TypeScript has no high-level holds method and can filter unknown-catalog orders, which raw ingestion must not silently copy.

## 7. Security implementation invariants

### Vault

- Replace plaintext `localStorage` persistence; do not simply encrypt with a hardcoded key.
- AES-GCM 256, fresh random IV/salt, versioned PBKDF2-SHA-256 parameters, authenticated metadata, and no persisted passphrase/derived key/unlocked `CryptoKey`.
- Import session Ed25519 key as nonextractable where supported; clear decrypted buffers/inputs and minimize copies.
- Lock after inactivity and immediately on explicit lock/wipe; abort requests and invalidate late responses.
- Cross-tab messages contain only random local event/generation IDs, never account data.
- Legacy v1 migration requires explicit user choice and verified encrypted write before legacy deletion.

### Signing

Required official headers:

```text
X-API-KEY-ID
X-API-TIMESTAMP   # Unix milliseconds, within 10 seconds of server time
X-API-SIGNATURE   # 64-byte Ed25519 signature, hex or standard Base64
```

Canonical UTF-8 string, no trailing newline:

```text
timestamp_ms\nUPPERCASE_METHOD\nexact_path\ncanonical_query\nsha256_hex_exact_body
```

Hash the empty GET body too. Allocate monotonic fresh timestamps for every attempt and re-sign retries. Use a fixed operation allowlist; analytics cannot sign arbitrary writes.

Documentation sorts decoded query keys/values; pinned official TypeScript sorts complete encoded `key=value` pair strings. Build sent URL and canonical query from one pair list and resolve the conflict with independent/owner-controlled vectors, including opaque cursors, repeats, reserved characters, Unicode, and prefix keys. Do not silently choose per request.

### Data/privacy

- Private responses stay out of `localStorage`, IndexedDB, Cache Storage, service workers, cookies, backend cache, logs, telemetry, and URLs.
- Memory cache key must include local session generation + verified scope + operation + normalized filters.
- Lock/wipe/scope switch clears all private data and aborts requests.
- Exports exclude secrets, public keys, signatures, cursors, raw account IDs, and raw secret-bearing errors; escape spreadsheet formulas.
- Real keys stay out of Vite dev/Arena preview until dependency/development-server and deployment security gates are resolved.

## 8. Financial invariants

### Observed metrics

```text
totalBalance[a] = trading[a] + funding[a]
N[fill] = quantity × price
signedFee = +magnitude for rebate, −magnitude for charge

dBase  = (BUY  ? +q : −q) + (feeAsset = BASE  ? signedFee : 0)
dQuote = (SELL ? +N : −N) + (feeAsset = QUOTE ? signedFee : 0)
```

`observedNetQuoteFlow = ΣdQuote` is **not P&L**. Group notional/quote flows by quote asset and actual fees/rebates by real fee asset. Referral share is not extra trader income. Current fee rates never reprice history. Fees are not burns.

Sampled equity change and drawdown are labeled sampled. A deposit is a capital flow; equity change is not automatically profit.

### Gated lots

- Acquisition (`dBase > 0`): lot quantity `dBase`, lot cost `−dQuote`.
- Disposal (`dBase < 0`): quantity `−dBase`, proceeds `dQuote`.
- FIFO/weighted-average realized P&L = proceeds − removed cost, but only with known opening lots, complete fills, and resolved non-fill flows.
- Unrealized P&L additionally needs valid remaining cost and a fresh labeled mark.
- Missing basis, unknown fee/flow/asset, conflicting duplicates, negative inventory, mixed quotes without FX, or partial required history blocks P&L. Never clamp or assume zero cost.

Hand-calculated regression vector:

```text
Buy 0.01 BTC at 100,000 USDT, quote fee 0.8:
  acquisition cost = 1,000.8 USDT
Sell 0.01 BTC at 110,000 USDT, quote fee 0.88:
  proceeds = 1,099.12 USDT
  realized P&L = 98.32 USDT  # only in the complete flat example
```

Base-fee buy vector: `q=0.01 BTC`, `N=1,000 USDT`, base fee `0.000008 BTC` gives acquired quantity `0.009992 BTC`, cost `1,000 USDT`.

See `03` for FIFO/weighted-average formulas, non-fill-flow treatment, and the full incomplete-data matrix.

## 9. Required frontend behavior

Evolve `/portfolio` into:

- Overview
- Balances & equity
- Orders & fills
- Activity & fees (only verified capabilities)
- Connection & security

Implement a shared connection bar, root-first scope selection, manual/visible-tab refresh, and Lock/Forget. Public routes remain unchanged for disconnected users.

Every dataset needs explicit:

```text
disconnected / locked / verifying / loading / refreshing / fresh /
stale / empty-complete / partial / permission-denied / CORS-blocked /
schema-incompatible / rate-limited / unavailable
```

No loading skeleton or error becomes a numeric zero. “All rows for this filter loaded” requires an empty next cursor and clean coverage. Use Load more for keyset pagination, not invented page numbers. A P&L placeholder says why it is unavailable; it does not show `0.00`.

Reuse `Layout`, `components/ui.tsx`, `Glossary`, formatting/polling patterns, and the existing test harness. Do not force account samples into `CandleChart` or invent timestamps before history-point interpolation is verified.

## 10. File-level work order

### Step 1 — R0 vault/signer (synthetic only)

Likely touch:

- Add `packages/core/src/account/{types,decimal,canonical,signer,vault,vaultStorage}.ts` (names may follow repo conventions).
- Refactor `packages/core/src/keys.ts` into a compatibility/migration boundary; do not leave plaintext active storage.
- Update `packages/core/src/index.ts` with a namespaced API.
- Refactor `apps/web/src/pages/Portfolio.tsx` and `SdkGuide.tsx` away from duplicate/unsafe signing paths without adding request execution to snippets.
- Extend tests with synthetic key material and independent verification.

Exit: all `02` security tests pass; no real key used.

### Step 2 — Deployment security

Review/touch as appropriate:

- `apps/web/index.html`, `apps/web/vite.config.ts`
- `vercel.json`, `_redirects`, `wrangler.toml`, `backend/wrangler.toml`, `.github/workflows/pages.yml`
- Manifest dependencies after audit-driven upgrades.

Preserve existing public TradingView/MCP/CoinGecko behavior. Do not claim GitHub Pages can emit headers it cannot. Real-key hosting requires the approved CSP/header posture.

### Step 3 — GET client, schemas, coverage, session store

Likely add:

- `packages/core/src/account/{rest,capabilities,pagination,normalize,coverage,analytics}.ts`
- `apps/web/src/lib/account/{AccountSession,AccountProvider,memoryStore,useAccountDataset,scheduler,crossTab}.tsx/ts`
- Synthetic `tests/fixtures/account/*` and account test suites.

The root test script currently runs only `tests/polytools.test.mjs`; deliberately update it or import new suites so CI actually runs them. Keep `@poly/core` zero-dependency unless a new dependency is separately justified.

Exit: fake-fetch tests prove GET allowlist, exact paths/queries, lossless decimals/cursors, coverage, dedup, cache partition, abort, and safe errors.

### Step 4 — State-complete UI

Likely touch/add:

- `apps/web/src/App.tsx` for nested portfolio routes.
- `apps/web/src/pages/Portfolio.tsx` and new account page components.
- `apps/web/src/components/account/*`; reuse `components/{Layout,ui,Glossary}.tsx`.
- Keep `apps/web/src/lib/store.tsx` limited to non-identifying preferences; no private responses.

Exit: all states/accessibility/mobile behaviors demonstrated with fixtures; production has no fixture-as-live path.

### Step 5 — Owner live gate

Follow `02 §13` / `06 Phase 4`. First use preflight/synthetic invalid-key diagnostics where possible; then the owner uses a disposable minimal-read testnet key locally. No secret enters chat or CI. Record only sanitized status/schema evidence and update `01`.

**Stop conditions:** CORS blocked, server only grants a read after a write permission is added, ambiguous signing cannot be resolved, actual schema is incompatible, or hosting cannot meet security requirements. Leave the feature blocked/unavailable and report—do not work around with infrastructure or false data.

### Step 6 — Enable verified R1/R2 datasets

Implement only operations that passed the gate. Add transfers/rates/exports after their specific evidence. Keep backend public-only. Re-run all public and account regression checks.

### Step 7 — Optional R3 only on a new approved task

Implement `lots.ts`, opening-basis/flow-resolution UI, fresh marks, and independent exact-lot tests. Do not pull this into the initial dashboard to make it look complete.

## 11. Test checklist

### Always

```bash
npm test
npm run typecheck
npm run build
git status --short
git diff --stat
```

Add/run the new account/browser suites explicitly. Audit dependencies reproducibly and scan for secrets before real-key release. Do not create a temporary lockfile and then claim a permanent audit fix; if introducing a lockfile, make that an intentional reviewed change.

### Required synthetic categories

- Vault wrong passphrase/tamper/migration/wipe/reload/cross-tab.
- Signing official example, independent signature, concurrent timestamps, exact sent URL/body, reserved/repeated/Unicode/cursor queries.
- REST every operation, CORS-like rejection, auth/denial/rate/server/network/schema errors, fresh-signed retry only where allowed.
- Pagination empty/nonempty/multiple pages/empty intermediate/repeated cursor/later failure/cap/abort.
- Two-account cache isolation and late-response invalidation.
- Exact decimals and all formula vectors, partial data, unknown/conflicting rows, order replacements, settlement duplicates, mixed assets.
- UI every state, lock during fetch, scope switch, offline/stale, mobile/keyboard/focus, safe export.

No expected value should be generated solely by the code under test. No test needs a real credential or real trade.

## 12. Safe reporting format for future verification

For each operation, record:

```text
Operation and friendly path
Contract/SDK revision
Test origin and environment (no raw URL query/cursor)
Credential type and read-policy set (no key/account ID)
Call result: not attempted / blocked / denied / succeeded
Schema checks: empty/nonempty, decimals, timestamps, pagination
Application demonstration: fixture or live, and which
Remaining limitations
```

Never paste a private response, key ID, account ID, address, signature, canonical string, or cursor into the reports. Sanitized synthetic fixtures must be identified as synthetic and must not be used as evidence of a successful live call.

## 13. Definition of done for the first real release

- [ ] R0 security gates pass in actual target browsers and production-like hosting.
- [ ] Exact-origin authenticated CORS and minimal-policy results are recorded for every enabled operation.
- [ ] Only GET reads are possible; no write permission or private proxy exists.
- [ ] Vault, signing, storage, cross-tab, cache-partition, and late-response tests pass.
- [ ] Current balances/sampled equity/orders/fills show source, scope, coverage, and freshness.
- [ ] Empty/denied/partial/stale/blocked states never become zero or success.
- [ ] Deposits/equity changes/net quote flow are not called profit; fees are not burns.
- [ ] P&L remains unavailable until every R3 gate is independently satisfied.
- [ ] Exports, if enabled, are exact, safe, and coverage-labeled.
- [ ] Existing public tools remain credential-free; all tests, typecheck, production build, dependency/security checks pass.
- [ ] Evidence labels in `00`/`01` are updated to distinguish source inspection, schema checks, public calls, authenticated calls, and application demonstration.

## 14. Safest immediate next step

**No credential is needed:** review the specifications, then implement the encrypted vault/signer and synthetic contract tests. In parallel, a browser preflight/synthetic-invalid-key CORS diagnostic can be run from the intended origin without accessing an account.

Only after those gates should the owner optionally perform local minimal-read testnet verification. Do not ask for the key in this conversation and do not ask the owner to make a trade or transfer for testing.
