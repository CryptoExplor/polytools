# Current state of the working tree

> **Historical baseline:** this document records the original audit tree, not the latest remediated
> state. Later local responses are indexed in [README.md](./README.md#local-implementation-follow-ups),
> including Phase 2, deployment/Compare fixes, and Phase 3 maintenance. Findings and Git hashes below
> must not be presented as the current verification status without consulting those follow-ups.

## 1. Source of truth and repository discrepancy

**Confirmed:** this audit targets the dirty working tree on `arena/2679a49c-polytools`, not just commit contents.

- Local HEAD: `eab1b24b5d7578d04a57e5110db6cd3d81f64b71` (`main`/PR #3 merge point in the shallow checkout).
- PR #4 is open at a different head: `bcb55d6e03f39bc99ac12fffb5e7eada1b5471ee`.
- PR #4 metadata reports Cloudflare Pages SUCCESS and Workers Builds FAILURE. Those checks do not cover the dirty tree audited here.
- The Workers failure has no exposed annotation/text in the reviewed GitHub metadata. Its cause is **Unknown / Not verified**; owner-only Cloudflare logs are required.
- Mixed files cannot be perfectly attributed between earlier PR work and later working-tree edits by inspection alone. `AccountAnalytics.tsx`, `Portfolio.tsx`, and `tests/account-ux.test.mjs` should be treated as mixed-history files.

No branch, commit, PR, or remote state was changed by this audit.

## 2. Dirty-tree inventory before audit documents

**Confirmed:** immediately before creating `docs/audit/`, there were 46 status entries: 31 modified, 9 deleted, and 6 untracked. These changes predate this documentation pass and are preserved without attribution assumptions.

```text
 M README.md
 M apps/web/.env.example
 M apps/web/src/App.tsx
 M apps/web/src/components/AccountAnalytics.tsx
 M apps/web/src/components/Layout.tsx
 M apps/web/src/components/ui.tsx
 M apps/web/src/lib/hooks.ts
 M apps/web/src/pages/Book.tsx
 M apps/web/src/pages/Dashboard.tsx
 M apps/web/src/pages/Portfolio.tsx
 M apps/web/src/pages/Tape.tsx
 M apps/web/src/styles.css
 M backend/package.json
 M backend/src/handler.ts
 M docs/account-live-verification.md
 M package-lock.json
 M package.json
 M packages/core/src/account/analytics.ts
 M packages/core/src/account/data.ts
 M packages/core/src/account/index.ts
 M packages/core/src/account/normalize.ts
 M packages/core/src/account/rest.ts
 M packages/core/src/account/signer.ts
 M packages/core/src/account/vault.ts
 M packages/core/src/index.ts
 D packages/core/src/keys.ts
 D research/account-analytics/00_CURRENT_STATE.md
 D research/account-analytics/01_OFFICIAL_API_CAPABILITY_MATRIX.md
 D research/account-analytics/02_ACCOUNT_CONNECTION_AND_SECURITY.md
 D research/account-analytics/03_ANALYTICS_AND_FINANCIAL_FORMULAS.md
 D research/account-analytics/04_ACCOUNT_ANALYTICS_FRONTEND_SPEC.md
 D research/account-analytics/05_BACKEND_AND_DATA_ARCHITECTURE.md
 D research/account-analytics/06_IMPLEMENTATION_ROADMAP.md
 D research/account-analytics/07_CODING_AGENT_MASTER_HANDOFF.md
 M scripts/live-test.mjs
 M tests/account-coordinator.test.mjs
 M tests/account-data.test.mjs
 M tests/account-rest.test.mjs
 M tests/account.test.mjs
 M tests/polytools.test.mjs
?? apps/web/src/components/AccountCostBasis.tsx
?? backend/tsconfig.json
?? packages/core/src/account/lots.ts
?? tests/account-cost-basis-ux.test.mjs
?? tests/account-lots.test.mjs
?? tests/account-ux.test.mjs
```

The eight files in `docs/audit/` are new audit output and are not included in that baseline count. The deleted source/research files were not restored or further deleted. No deletion recommendation is made from apparent non-use.

## 3. Architecture and custody boundaries

| Area | Current state | Evidence |
|---|---|---|
| Web SPA | **Implemented.** React/Vite hash-routed SPA with account, public market, cross-chain, developer, and brand routes. | `apps/web/src/App.tsx`, `components/Layout.tsx` |
| Public browser API | **Implemented.** Credential-free JSON calls to the app backend; Compare also calls CoinGecko directly for public USD prices. | `apps/web/src/lib/api.ts`, `lib/coingecko.ts` |
| Public backend | **Implemented.** GET/OPTIONS public routes, open CORS, query allowlists, per-isolate TTL cache, and single-flight coalescing. No private-account route was found. | `backend/src/handler.ts`, `cache.ts`, `mcpServer.ts` |
| Private account REST | **Implemented, live-unverified.** Browser signs registered read-only GETs directly to the exact official testnet REST origin; redirects rejected and credentials omitted. | `packages/core/src/account/rest.ts`, `signer.ts` |
| Private storage | **Implemented.** Unlocked sessions and account snapshots are in memory; encrypted vault entries use IndexedDB. No shared/private backend cache was found. | `vault.ts`, `vaultStorage.ts`, `memoryStore.ts` |
| Wallet authentication | **Missing intentionally/deferred.** API-key vault unlock is not wallet login. No wallet-auth flow was added. | `Portfolio.tsx`, account core |
| Trading/money mutation | **Missing intentionally.** No order placement, cancellation, transfer, withdrawal, or backend private proxy in the application. SDK Guide can generate external snippets that mutate testnet orders when a user runs them elsewhere. | account UI/backend; `SdkGuide.tsx` |
| Worker scheduled job | **Implemented, unverified.** Optional cron reads public movers and may POST a Telegram notification. “Read-only” therefore does not mean “zero network side effects” for the standalone Worker. | `backend/adapters/worker.ts`, both Wrangler files |
| Development samples | **Implemented, development only.** Vite can fall back after upstream 502 to labeled `wire-samples`; some responses are parameterized/synthesized. Production handlers have no equivalent fallback. | `apps/web/vite.config.ts` |

### Public vs private rule that must remain intact

Public trades, books, candles, flows, and catalog data must never be substituted for private account history. Account data must stay on the signed, validated, session-partitioned path. Current source follows that boundary; live server behavior remains unverified.

## 4. Route inventory

“Implemented” below means statically present and reviewed, not browser-certified.

| Route | State | Current behavior and material limits |
|---|---|---|
| `/#/` | **Implemented / Partial UX** | Public market overview, filters, sorting, watchlist, sparklines, CSV. Row Book action incorrectly navigates to private `/account/order-book`; nested interactive controls need correction. |
| `/#/tape` | **Implemented / Partial UX** | Public recent trades, session statistics, filters, sound/notification options. Some quote notionals use `$` regardless of quote asset. Browser permissions/audio were not tested. |
| `/#/book` | **Implemented / Partial UX** | Public L2 book/depth, not account orders. Quote-notional labeling needs quote-aware formatting; ladder provides a textual alternative to depth visualization. |
| `/#/charts` | **Implemented / Runtime unverified** | Public candles, timeframes, volume, crosshair, keyboard arrow inspection. No fresh browser interaction test. |
| `/#/heatmap` | **Implemented / Partial** | Public liquidity canvas and band table. `maxPx === minPx` is treated as no decoded data, which can hide a valid single-price non-zero book; canvas inspection is pointer/touch-oriented. |
| `/#/compare` | **Implemented / Partial** | Polyester versus CoinGecko comparison. Explicit USDT/USDC matching is clearer than other pages; “Matched” falls back to all rows when there are zero matches. |
| `/#/zipper` | **Implemented / Partial copy** | Public chain/route configuration, fees/minimums, illustrative net. No transfer action. “Verified contract addresses” overstates what the UI itself verifies. |
| `/#/calc` | **Implemented / Experimental educational math** | Client-side sizing, toy isolated-margin sketch, manual P&L/fees, conversion. Uses JS numbers, not account exact decimals; live polling can overwrite a manually edited converter price. |
| `/#/hub` | **Implemented / Partial telemetry** | UTC countdown, localStorage checklist, official-resource directory, diagnostics. Missing telemetry can display fallback `19 pairs`, `true`, and `0` as if current. |
| `/#/sdk` | **Implemented / Experimental generator** | SDK snippets and local canonical-string/SHA-256 inspector. No private key input is required by the inspector. Generated snippets are unvalidated/uncompiled and can place/cancel testnet orders when run externally. |
| `/#/brand-kit` | **Implemented / Runtime unverified** | Static catalog plus remote official assets, filters, copy/download links. Inline SVG fallback uses fixed repository strings, not remote HTML. External assets were not freshness-checked. |
| `/#/flow` | **Redirect / Partial UX** | Preserves the query and redirects to `/account/transactions`, whose default is private My Account. A public deep-link user must select Public transaction lookup before the embedded auto-lookup can run. |
| `/#/portfolio` | **Redirect** | Preserves the query and redirects to `/account/api`. |
| `/#/account` | **Implemented private / Live unverified** | Balances, sampled balance/equity history, current fee rates, explicit exports. Not a lifetime P&L statement. |
| `/#/account/api` | **Implemented private setup / Live unverified** | Generate/import encrypted keys, register server key ID, unlock/lock/wipe, legacy migration, local signing diagnostics. Synthetic tests only. |
| `/#/account/trade` | **Implemented private / Live unverified** | Validated account fills and actual execution fees. Never uses the public tape as a fallback. Load button has broader request scope than its label suggests. |
| `/#/account/orders` and legacy `/#/account/order-book` | **Implemented private / Live unverified** | Open orders, completed orders, and read-only order details. The legacy alias is why the Dashboard's wrong Book action lands in private Orders. |
| `/#/account/pnl` | **Experimental private accounting** | Exact R3 ledger with user-supplied basis/flow resolutions/marks. Not independently reconciled tax output; README copy is stale. |
| `/#/account/transactions` | **Implemented private + separate public lookup** | Signed private transfers in one mode, credential-free exact public Flow lookup in the other. No shared private cache or public/private row substitution. |
| Unknown route | **Redirect** | Falls back to `/`. |

## 5. Account state and action map

| State/action | Confirmed current behavior |
|---|---|
| Locked initial state | No private read is made. UI offers API setup or separate public lookup where applicable. |
| Generate/import key | Uses passphrase-derived encrypted vault records and validated key pairs. Passphrase is not stored; live registration is not inferred from local key generation. |
| Unlock | Creates a generation-scoped, nonextractable Ed25519 session. A validated registered server key ID is required for registered reads. |
| Lock/wipe/session change | Aborts/discards session state and invalidates private snapshots. Cross-tab and delayed-response cases have synthetic tests. |
| Load any `AccountAnalytics` view | First fetches the unsigned official spot catalog and applies clock offset, then runs broad `loadAll()` plus balance-history/open-order reads. Thus “Load your trades” is not trades-only; catalog failure can block balances/transfers too. |
| Automatic visibility refresh | Only active after explicit activation; it is not a substitute for initial consent to load private data. |
| Switch account section | Unmounts the active `AccountAnalytics`, disposing its coordinator and in-memory snapshot. Imported history and R3 manual inputs are not shared across sections. |
| Export account dataset | Requires explicit confirmation. Exports loaded validated rows and coverage/filter manifests, not a complete-account guarantee and not R3 P&L. |
| Public transaction lookup | Separate embedded `Flow` path using public backend routes; no account credential required. |

## 6. R2 cursor-import state machine

Evidence: `packages/core/src/account/data.ts` (`AccountDataCoordinator.importCursorHistory`), `pagination.ts`, `apps/web/src/components/AccountAnalytics.tsx` (`importHistory`, `cancelImport`), and coordinator tests.

| Outcome | Current behavior | Assessment |
|---|---|---|
| Default bounded snapshot | Uses bounded reads and labels capped history as partial. Open orders are deliberately not added merely to make `loadAll()` look populated. | **Implemented.** |
| Explicit selected import | Follows selected orders/fills/transfers cursor chains sequentially with opaque cursors, page cap, exact progress, and selection-specific requests. | **Implemented with synthetic regression coverage.** |
| Cursor exhausted with clean rows | Eligible coverage can become complete/filter-complete, subject to row reconciliation. | **Implemented; live completeness unverified.** |
| Cap reached without an operation error | Merges the imported result into the previous snapshot and leaves coverage visibly partial/stopped at cap. | **Confirmed.** |
| Operation error/denial/abort result | Returns before merging any result operation; entire previous visible snapshot remains. A safe error explains that the import did not finish. | **Confirmed.** |
| User cancellation | Aborts the controller, prevents another page, does not mark the prefix complete, and preserves the previous snapshot. No distinct “Import cancelled” message is shown. | **Confirmed behavior; UX copy partial.** |
| Repeated cursor, malformed row, later-page error | Core marks incomplete/partial or returns an error according to the path; it does not silently call the prefix complete. | **Synthetic coverage; live behavior unverified.** |
| Timeout | No code-owned REST or whole-import timeout was found. User/lock abort exists, but a stalled transport can remain pending until the environment settles it. | **Confirmed reliability gap.** |

The withdrawn “zero required flows makes R3 universally eligible” concern is not a current finding; the current component constructs `requiredCount` from relevant transfers and gates unresolved rows.

## 7. R3 cost-basis and P&L state

Evidence: `packages/core/src/account/lots.ts` (`analyzeCostBasis`), `decimal.ts`, `analytics.ts`, `coverage.ts`, `apps/web/src/components/AccountCostBasis.tsx`, and `tests/account-lots.test.mjs`.

| Concern | Current behavior |
|---|---|
| Methods | Exact FIFO and moving weighted average over exact rational/decimal values. Display rounding is separate. |
| Actual fill economics | Base fees reduce acquired quantity; quote fees/rebates affect quote movement; current fee rates are not substituted for historical execution fees. |
| Opening basis | Requires explicit opening lots with provenance or an attested complete-since-inception opening zero. Empty fills do not establish opening zero. |
| Fill coverage | Complete, clean, cursor-exhausted coverage is required. Partial/capped/conflicting/unknown fills block affected outputs. |
| Non-fill flows | Every relevant flow needs a valid explicit resolution. Unknown reasons/kinds block rather than becoming zero or a default internal credit. |
| Internal transfers | Basis carries only through valid matched mappings with exact quantities. Invalid or unmatched legs invalidate affected counterparts. Unified transfer `linkId` is not treated as automatic fill reconciliation or proof of a unique leg. |
| Inventory | Underflow and unsupported negative basis block; uncovered inventory is not realized at zero cost. |
| Quotes/FX | Ledgers remain separate by account/base/quote. There is no implicit cross-quote consolidation or historical FX invention. |
| Realized P&L | Available only when basis, fills, flows, and ledger eligibility pass. It can remain available when no fresh mark exists. |
| Unrealized P&L | Additionally requires one fresh, labeled, non-conflicting mark. Default freshness is five minutes; the UI rechecks time every 15 seconds. |
| Total P&L | Requires both realized and unrealized components; otherwise unavailable, not zero. |
| Event bound | Rejects excessive combined events (`MAX_EVENTS = 20,000`) and invalid freshness policy; this is a safety bound, not evidence of large-account performance. |
| Persistence/export | Manual R3 inputs are component-local and are not included in account exports. No R3 tax-lot export was found. |
| Independent verification | Manual provenance and flow decisions are user attestations. The UI does not independently reconcile them one-to-one to statements or external wallet evidence. |

**Overall classification:** useful, exact, fail-closed **experimental/user-assisted accounting**. It is not verified tax advice, a tax filing engine, or live-certified account reporting.

## 8. Exports and privacy

**Confirmed by source and fresh synthetic tests:**

- account exports preserve exact source decimal strings and distinguish derived fill fields;
- CSV cells are escaped against spreadsheet formula interpretation without changing ordinary valid decimals;
- manifests carry operation, coverage, window, and selected transfer filters;
- only loaded selected rows are exported; empty CSV without trustworthy metadata is refused;
- credentials, private identifiers, opaque cursors, addresses, and raw errors are excluded from the reviewed export schema;
- exports require an explicit dialog and are not proof of complete account history;
- R3 opening lots, flow resolutions, marks, realized P&L, and unrealized P&L are not exported by the current account export path.

Public Dashboard CSV is separate and contains public market rows only.

## 9. Backend, build, and deployment state

- `backend/src/handler.ts` exposes public GET/OPTIONS API routes with open CORS. It has bounded cache keys and parameter allowlists but no code-owned user authentication or rate limiter; this is consistent with a public facade, while deployment protection is unverified.
- The cache is per isolate, not a shared source of truth. MCP clients are pooled per URL inside an isolate.
- Root `npm run build` runs only web `build:all`; root `npm run typecheck` separately covers web and backend.
- `vercel.json` uses `npm -w apps/web run build` (Vite only), so that deployment path does not itself run the TypeScript check included in `build:all`.
- Root `wrangler.toml` combines SPA assets and `/api` and has a custom `[build]` command. `backend/wrangler.toml` is the standalone API/cron Worker configuration.
- No current deploy or dry-run was performed. The Workers failure cannot be attributed to Node version, Wrangler syntax, or any other root cause from available metadata.
- No repository-configured Content-Security-Policy or common security-header set was found in `index.html`, `vercel.json`, or Wrangler configuration. Deployed/platform-injected headers are **Unknown / Not verified**.

## 10. Documentation and copy that lag the code

- `README.md` still describes P&L only as an unavailable state; it does not describe the current experimental R3 calculation path.
- The glossary defines read-only as only public market/bridge data, although authenticated read-only account views now exist.
- The global footer says `raw ÷ 10³` even on exact-decimal account pages where that public-wire rule is not the account amount rule.
- The P&L header implies current valuations are needed for all profit, while realized P&L is intentionally available without a mark when its own gates pass.
- Trades and Orders account views lack the API setup view's explicit “Lock now” action in their headers.
- R2 cancellation preserves data but offers no explicit cancelled status.
- Zipper “Verified contract addresses,” Hub “verified” resource wording, and SDK “ready-to-run”/“safe” wording should be interpreted as content claims, not fresh audit verification.

These are documented findings, not wording changes made by this audit.
