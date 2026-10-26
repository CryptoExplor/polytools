# Current frontend state

**Source of truth:** commit `62a7518b2ccdbb7ddf5610ac83db78d41af46427` (`main`, PR #4 merge), inspected 2026-10-26.
**Evidence:** all "Confirmed in source" unless stated otherwise. Rendered-state claims are **server render**, not browser.

---

## 1. Stack and shape

| Item | Value | Evidence |
|---|---|---|
| Framework | React 18.3 + `react-router-dom` 6.26 (HashRouter) | `apps/web/package.json`, `apps/web/src/App.tsx` |
| Build | Vite 5.4, TypeScript 5.6, single SPA chunk | `apps/web/vite.config.ts` |
| Styling | One hand-written stylesheet, 2,278 lines, no CSS framework, no CSS-in-JS | `apps/web/src/styles.css` |
| Fonts | System stack only: `Inter, -apple-system, …` and JetBrains Mono fallback — **no webfont is loaded** | `styles.css` `:root` |
| Shared workspace package | `@poly/core` aliased directly to `packages/core/src/index.ts` (source, not built output) | `vite.config.ts` `resolve.alias` |
| Routes | 15 `<Route>` entries, of which 2 are legacy redirects; `account/*` fans out into 6 sections; plus `/account/order-book` alias and a wildcard | `App.tsx`, `Portfolio.tsx` |
| Page modules | 13 files, 8,502 lines | `apps/web/src/pages/*` |
| Shared components | 10 files, 4,526 lines | `apps/web/src/components/*` |
| Frontend libraries | 16 files, 2,058 lines | `apps/web/src/lib/*` |
| Build output | JS 595.31 kB / 177.48 kB gzip (one chunk); CSS 34.09 kB / 7.02 kB gzip; **12 static page imports, 0 dynamic** | fresh `npm run build`, `check:performance` output |
| Tests | 202 tests in 44 suites, incl. SSR-render assertions for UX copy | fresh `npm test` |

`vite.config.ts` also mounts the **real backend handler** as dev middleware, so `npm run dev` is a single-process full-stack preview (`devApiPlugin`), with a wire-sample fallback when the upstream returns 502.

---

## 2. Routes and navigation entries

### 2.1 Route table (confirmed in source)

| # | Path | Component | Sidebar label | Topbar group / title | Route-level symbol selector? |
|---|---|---|---|---|---|
| 1 | `/` | `Dashboard` | Markets | Market Data / Markets | yes |
| 2 | `/book` | `Book` | Order Book | Market Data / Order Book | yes |
| 3 | `/tape` | `Tape` | Recent Trades | Market Data / Recent Trades | yes |
| 4 | `/charts` | `Charts` | Price chart | Market Data / Price chart | yes |
| 5 | `/heatmap` | `HeatmapPage` | Liquidity heatmap | Market Data / Liquidity heatmap | yes |
| 6 | `/compare` | `Compare` | Venue compare | Market Data / Venue compare | no |
| 7 | `/zipper` | `Zipper` | Zipper routes | Cross-Chain / Zipper routes | no |
| 8 | `/calc` | `Calc` | Calculators | Toolkit & Docs / Calculators | yes |
| 9 | `/hub` | `Hub` | Testnet hub | Toolkit & Docs / Testnet hub | no |
| 10 | `/sdk` | `SdkGuide` | SDK quickstart | Toolkit & Docs / SDK quickstart | yes |
| 11 | `/brand-kit` | `BrandKitPage` | Brand kit | Toolkit & Docs / Brand kit | no |
| 12 | `/account` | `Portfolio` | Overview | Account / Overview | no |
| 13 | `/account/api` | `Portfolio` | API setup | Account / API setup | no |
| 14 | `/account/trade` | `Portfolio` | Your Trades | Account / Your Trades | no |
| 15 | `/account/orders` | `Portfolio` | Orders | Account / Orders | no |
| 16 | `/account/pnl` | `Portfolio` | Profit and Loss | Account / Profit and Loss | no |
| 17 | `/account/transactions` | `Portfolio` | Money Movements | Account / Money Movements | no |
| — | `/account/order-book` | `Portfolio` → Orders | *not in nav* | Account / Orders | no |
| — | `/flow` | redirect | *not in nav* | — | — |
| — | `/portfolio` | redirect | *not in nav* | Account / API setup | no |
| — | `*` | redirect to `/` | — | — | — |

Legacy redirects (confirmed in source, `App.tsx` + `lib/navigation.ts`):

- `/flow?mode=…&q=…` → `/account/transactions?mode=…&q=…&scope=public` (preserves query, forces public lookup)
- `/portfolio` → `/account/api`
- `/account/order-book` → Account "Orders" section (`accountSection()`)

Overlays that are not routes:

- **Glossary drawer** (`GlossaryDrawer`), opened from the topbar and the footer. 17 terms in 4 categories, searchable.
- **Brand quick-action context menu** on the sidebar logo (right-click / `Shift+F10`).
- **Order details drawer** (`OrderDetailsDrawer`) inside the Orders section.
- **Export confirmation dialog** (`ConfirmDialog`) inside account sections.

### 2.2 Navigation structure (confirmed in source, `Layout.tsx` `NAV_GROUPS`)

Four groups, **17 items**, flat (no nesting, no collapse, no search):

1. **Account** — Overview, API setup, Your Trades, Orders, Profit and Loss, Money Movements (6)
2. **Market Data** — Markets, Recent Trades, Order Book, Price chart, Liquidity heatmap, Venue compare (6)
3. **Cross-Chain** — Zipper routes (1)
4. **Toolkit & Docs** — Calculators, Testnet hub, SDK quickstart, Brand kit (4)

Additional navigational chrome:

- Topbar breadcrumb: `group / page title` + `Read-only · <env>` eyebrow (`hide-sm`).
- Account section **tabs** (`AccountTabs`) repeat all six Account sidebar items inside the page.
- Persistent footer links: Brand Kit, Glossary, Polyester App ↗, Docs ↗.
- First-visit **intro bar** ("PolyTools is a read-only map of Polyester…") with *Browse markets*, *Testnet setup*, *Dismiss*; dismissal persisted in `localStorage["poly-tools:intro:v1"]`.
- Sidebar footer: pair/asset counts + `apiEnv` + "No wallet or login."

### 2.3 Mobile navigation behavior (confirmed in source, Likely in effect)

- Breakpoint: `@media (max-width: 960px)` turns the sidebar into a fixed off-canvas panel (232 px) with a backdrop and a burger button.
- The closed panel is hidden with `transform: translateX(-100%)` only. It stays mounted, focusable, and exposed to assistive tech. **No `inert` attribute exists anywhere in `apps/web/src`.** Tab order through the hidden menu is **Unknown** (browser-unverified) but the source does not prevent it.
- Escape closes the drawer; focus is not moved into the drawer on open and not restored to the burger on close.

---

## 3. Design tokens and layout system (confirmed in source)

All values below are from `styles.css`. Nothing here is a measurement of rendered output.

### 3.1 Color

| Role | Dark | Light |
|---|---|---|
| canvas | `#0a0a0a` | `#f7f7f7` |
| shell | `#0e0e11` | `#efefef` |
| surface | `#131317` | `#ffffff` |
| elevated | `#19191f` | `#fafafa` |
| border subtle / default / strong | `#1e1e26` / `#292934` / `#3a3a48` | `#e4e4e7` / `#d4d4d8` / `#a1a1aa` |
| text primary / secondary / muted / faint | `#f7f7f7` / `#a1a1aa` / `#71717a` / `#52525b` | `#0a0a0a` / `#52525b` / `#71717a` / `#a1a1aa` |
| accent | `#fa2f6f` | `#fa2f6f` |
| up / down | `#10b981` / `#f43f5e` | `#059669` / `#e11d48` |
| warn / info | `#f59e0b` / `#38bdf8` | `#d97706` / `#0284c7` |

Theme is applied as `data-theme` on `<html>`, initialised from `localStorage["poly-tools:theme"]`, default dark (`lib/store.tsx`).

**Known contrast risk (Confirmed in source + `docs/audit/TEST_AND_VERIFICATION.md`):** `--text-muted` on surface computes ~3.83:1 (dark) and `--text-faint` ~2.40:1 dark / ~2.56:1 light, and these tokens are used for real content (metric sublabels, table captions, `.faint` helper lines, footers), not only decoration.

### 3.2 Typography scale (as authored)

| Element | Size / weight |
|---|---|
| `body` | 13.5 px / 1.45 |
| `.page-header-info h2` | 24 px / 650, −0.025em |
| `.page-header-desc` | 13.5 px, `max-width: 72ch` |
| `.panel-title`, `.card h3` | 14.5 px / 650 |
| `.panel-subtitle` | 12.5 px, muted |
| `.metric-value` | 20 px mono / 650 |
| `.metric-label` | 11.5 px |
| `.metric-sub` | 12 px |
| `.pill` | 11.5 px / 600 |
| `.nav-item` | 13.5 px / 500 |
| `.nav-group` | 11 px / 600 |
| `.panel-footer`, `.foot` | 12 px |

Observations from source: 11 px, 11.5 px, 12 px, 12.5 px, 13 px and 13.5 px are all in active use, so the "scale" is effectively continuous rather than stepped. Several components also set inline `fontSize` values (e.g. `fontSize: 11`, `12`, `15`, `16`, `32` in `Layout.tsx`, `Dashboard.tsx`, `Glossary.tsx`, `ui.tsx` `Countdown`).

### 3.3 Spacing, radius, elevation

- Spacing tokens `--space-1..6` = 4/8/12/16/20/24 px exist but page-level spacing is dominated by literal values and inline styles.
- Radii: `--radius-xs` 4, `--radius-sm` 6, `--radius` 8, `--radius-lg` 10.
- Shadows: three levels, dark theme only meaningfully visible.

### 3.4 Layout metrics and breakpoints

| Property | Value |
|---|---|
| Sidebar | 232 px fixed, `position: sticky`, full viewport height |
| Content | `padding: 24px 32px 40px`, `max-width: 1380px`, centred |
| Page vertical rhythm | `.page-stack` gap 20 px |
| Grids | `.cols-2/3/4`, `.split-7-5`, `.split-8-4`, gap 14 px |
| Metric strip | `repeat(auto-fit, minmax(190px, 1fr))`, gap 12 px |
| Breakpoints | **1080 px** (3/4-col → 2-col; splits → 1-col), **960 px** (sidebar off-canvas, content padding 14 px, `.hide-sm` off), **680 px** (all cols → 1), **640 px** (order drawer header stacks), **600 px** (metric strip 2-col, `.hide-xs` off, ladders 3-col, route tag hidden), `prefers-reduced-motion` global disable |
| Touch targets | `.account-tab` `min-height: 44px` is the only explicit 44 px control; most `.btn.sm` and icon buttons are smaller (source: `.btn` padding, no min-height) |

### 3.5 Responsive visibility classes

`.hide-sm` hides at ≤960 px, `.hide-xs` hides at ≤600 px. These are used for content that is *sometimes* important:

- Topbar `Read-only · <env>` eyebrow (`hide-sm`) — declaration of the read-only guarantee.
- `Glossary` button label (`hide-sm`, icon remains).
- Book ladder "Notional" column (`hide-xs`) and Tape "Notional" and "Match ID / Age" columns (`hide-xs`/`hide-sm`).
- `PublicCacheStatus` fresh-copy pill (`hide-xs`).

That is a copy/trust tradeoff, not just a density tradeoff: the data-provenance pill disappears on phones unless it is stale or errored.

---

## 4. Data flow and freshness (confirmed in source)

### 4.1 Public API facade

`lib/api.ts` calls the same-origin backend (or `VITE_API_BASE` worker) — never the MCP endpoint directly. Endpoints used: `/api/health`, `/api/env`, `/api/markets`, `/api/overview`, `/api/orderbook`, `/api/candles`, `/api/trades`, `/api/heatmap`, `/api/zipper/config`, `/api/zipper/routes`, `/api/zipper/compare`, `/api/flow`, `/api/flow/by-tx`, `/api/flow/explain`.

Every response is checked with `isWireSamplePayload`; when a fixture is used, a sticky `wireSampleUsed` flag is set and `WireSampleNotice` renders on **every** route for the rest of the session.

### 4.2 Polling intervals

| Surface | Interval | Hook |
|---|---|---|
| Dashboard overview | 3 s | `usePollData` |
| Book | 2 s (+ overview 4 s for stats) | `usePollData` |
| Tape | 1.5 s | `usePollData` |
| Charts | 1 s … 60 s by timeframe (+ overview 4 s) | `POLL_BY_TF` |
| Heatmap | 6 s | `usePollData` |
| Compare | 5 s Polyester + 35 s CoinGecko | `usePollData` ×2 |
| Zipper | 60 s | `usePollData` |
| Hub diagnostics | driven by store metadata + manual refresh | `useApp` |

`usePollData` pauses when the tab is hidden, supports user pause/resume, and guards against out-of-order responses. There is **no global pause** — each page owns its own control, and pausing Dashboard does not pause Book.

### 4.3 Client persistence (all public/preference only)

| Key | Contents |
|---|---|
| `poly-tools:symbol` | last selected pair |
| `poly-tools:theme` | `dark` \| `light` |
| `poly-tools:watch:v1` | watchlist; defaults to BTC/ETH/SOL-USDT |
| `poly-tools:intro:v1` | `dismissed` |
| `poly-tools:hub-checklist` | onboarding checklist |
| IndexedDB (`MARKET_METADATA_CACHE_KEY`) | bounded **public** market metadata cache with `freshUntil` provenance |

Account material lives in a separate encrypted vault (`packages/core/src/account/vault.ts`, `vaultStorage.ts`) and private responses are memory-only. `PublicCacheStatus` labels cached public metadata; nothing here caches private data.

### 4.3b Private-data UI boundaries (R2 and R3)

**R2 — selected cursor import.** Entry point: the `notice info` block titled "Need every cursor page?" inside `AccountAnalytics.tsx`, with a page-safety select (100/500/1 000/5 000/10 000) and `Import full history (capped)` / `Cancel import`. Behaviour that must be preserved: progress per operation, "no total or percentage is inferred", cancellation keeps the previous snapshot and does **not** merge the cancelled prefix (`cancelImport`), and failures never replace a visible snapshot with a partial one (`importHistory` early return on `failed`). UI exposure: this is the single most consequential control in the app and it currently lives inside an explanatory notice.

**R3 — cost-basis / P&L.** Entry point: `/account/pnl` → `AccountCostBasis` (506 lines). Inputs are manual and memory-only: opening lots (qty, exact cost, time, provenance note) or an opening-zero attestation, per-transfer flow resolutions (`fill` / `bucket` / `acquisition` / `disposal` / `quote-neutral` + required note), and a labeled valuation mark (price, source, kind, timestamp). Outputs are four independently gated metrics (Realized, Unrealized, Total, Remaining cost), each rendering `Unavailable` with the missing input named. Nothing is persisted; leaving the section discards everything. Copy states "user-assisted" / "exact cost-basis accounting only after…" and must not be softened into a verified-profit claim.

### 4.4 Freshness/status surfaces — there are four different ones

| Component | Where | What it says |
|---|---|---|
| `DataFreshness` (page header) | Dashboard, Book, Tape, Charts, Heatmap, Compare, Zipper | "No data yet" / "Updated 2s ago" / "Paused" + pause and Refresh buttons; turns warn when `age > interval × 3.5` |
| `PublicCacheStatus` (topbar) | any route when metadata came from cache | "Cached metadata · 3m ago" / "Stale metadata" + Retry |
| Topbar fallback pill | when no cache status | "Live MCP" / "Sample data" / "Syncing…" / red **Retry** button |
| `WireSampleNotice` banner | any route after a sample response | "Development wire samples used in this session…" |

`ConnectionStatus` types are `connecting | connected | degraded`, but the topbar renders only three branches (`cache status`, `connected`, `connecting`) and falls through to a Retry button for everything else — so `degraded` is indistinguishable from an unknown state.

---

## 5. Component inventory and reuse (confirmed in source)

### 5.1 Shared primitives (`components/ui.tsx`, 788 lines, 17 exports)

`PageHeader`, `MetricStrip`, `MetricCell`, `Card`, `Stat`, `Pill`, `DataFreshness`, `ErrorBox`, `EmptyState`, `Loading`, `TermTip`, `CopyButton`, `ConfirmDialog`, `SymBadge`, `PairLogo`, `SymbolSelect`, `Sparkline`, `JsonView`, `Countdown`.

Adoption notes:

- `Stat` is defined but unused by any page (superseded by `MetricCell`).
- Three separate "tile" patterns coexist: `.metric-cell` (new), `.card.stat` (legacy), and ad-hoc inline grids of `.kv` rows (Hub diagnostics, API setup, P&L inputs).
- `Card` is used for both real content panels and for single empty states (`<Card><EmptyState …/></Card>`), which produces decorative panels around a single sentence.
- Every `PageHeader` hard-codes an eyebrow `<span>Read-only · Testnet</span>` that duplicates the topbar eyebrow and the footer.

### 5.2 Page-level duplication

| Duplicated concern | Where |
|---|---|
| Symbol selector | Topbar (`Layout`, when route meta says so) **and** inside the page: Book, Tape, Charts, Heatmap, Calc, SDK. Confirmed by server render — each page renders its own `<select>` with up to 18 options |
| Account navigation | Sidebar group **and** `AccountTabs` inside every account page |
| Page title | `PageHeader` `h2`, topbar breadcrumb, and often a repeated `Card` title using the same words (e.g. account pages render "Account overview" in the header *and* on the analytics card) |
| "Read-only" reassurance | PageHeader eyebrow, topbar eyebrow, sidebar brand sub, sidebar disclaimer, footer, intro bar (six places) |
| Not-loaded empty state | `AccountAnalytics` `copy.emptyDescription` **and** the `AccountAnalytics` card body, plus `Portfolio`'s own locked card on Money Movements |
| Symbol/asset tables | `AccountAnalytics` renders three separate tables with hand-written `<thead>` rows; `Heatmap`, `Compare`, `Book`, `Tape` each hand-roll their own row markup |

### 5.3 Charts

| Chart | File | Capability | Accessibility |
|---|---|---|---|
| Candle | `CandleChart.tsx` (496) | SVG candles + volume, crosshair, SMA7/25, keyboard ←/→ inspection | `tabIndex=0`, keyboard handler, `role="img"` labels — **the only chart with keyboard inspection** |
| Depth | `DepthChart.tsx` (313) | Bid/ask cumulative area | `role="img"` + the Book ladder provides a textual equivalent |
| Sparkline | `ui.tsx` | 40-tick session sparkline, `aria-hidden` | none needed (decorative), but "1 tick" placeholder text is user-visible |
| Heatmap | `pages/Heatmap.tsx` (527) | Canvas, pointer hover per cell, `<details>` text inspector with selects | pointer-preferred; the inspector is a `<details>` with no keyboard cursor on the canvas |
| Balance history | `AccountAnalytics.tsx` | Inline `<svg>` polyline per series, exact-sample table in `<details>` | `role="img"` + table |

---

## 6. Deployment configuration (confirmed in source + GitHub API)

| Target | Config | State |
|---|---|---|
| Cloudflare Workers + Assets | `wrangler.toml` (root): `main = backend/adapters/worker.ts`, assets from `apps/web/dist`, SPA fallback, 15-minute alert cron | present |
| Cloudflare Pages | `apps/web/public/_redirects` (`/* /index.html 200`), `_headers` (CSP, nosniff, referrer, permissions, frame-deny) | present |
| Vercel | `vercel.json`: build `apps/web`, output `apps/web/dist`, edge functions `backend/api/**`, same headers | present |
| GitHub Pages | `.github/workflows/pages.yml`, static only, copies `index.html` → `404.html`, needs `VITE_API_BASE` repo variable | **workflow fails on `main`** — run 40306963041: build steps pass, `actions/deploy-pages@v4` returns `Failed to create deployment (status: 404) … Ensure GitHub Pages has been enabled` |
| CI | `.github/workflows/ci.yml`, Node 24, runs runtime/whitespace/external/dependency checks, tests, typecheck, build, performance budget | **green** on the merge commit (run 40306962841) |

Because routing is hash-based, deep links survive every static host without rewrites. That is a strong constraint to preserve: **any navigation redesign should keep `#/` paths working**.

---

## 7. What a first-time visitor actually receives (server render, no browser)

Order of elements on `/`:

1. Sidebar brand "PolyTools" + subline `Read-only · testnet`.
2. 17 nav items in 4 groups.
3. Topbar: burger, `Market Data / Markets`, `Read-only · testnet`, symbol select, cache/freshness pill, Glossary, theme toggle.
4. Optional first-visit intro bar (2 sentences + 3 buttons).
5. Page eyebrow `Read-only · Testnet`.
6. `h2` "Spot Market Overview".
7. 139-character subtitle.
8. Freshness controls ("No data yet", Refresh).
9. Four metric cells (all show `—` before data).
10. Table with 9 columns, 4 row-level buttons each, plus CSV export.

That is roughly **eight distinct statements of product purpose or data provenance before the first price**. The price table itself is the right first content; the framing around it is the problem.

---

## 8. Beginner vs advanced surface map

| Audience | Routes | Intended use | Notes |
|---|---|---|---|
| Beginner, no key | `/` (Markets), `/book`, `/tape`, `/charts`, `/heatmap`, `/compare`, `/calc`, `/hub` | Look at prices, understand terms, try a calculation, start on testnet | `/heatmap` and `/compare` assume comfort with bps and depth; the glossary covers the terms but is not linked from the pages that use them |
| Beginner, connecting an account | `/account`, `/account/api`, `/account/trade`, `/account/orders`, `/account/transactions` | Read own data | Key creation is the hardest beginner task in the product (`Re-encrypt`, `KDF`, `canonical signer`) |
| Advanced | `/account/pnl` (R3), `/sdk`, `/zipper` (contract table), `/account/api` (signer, residual limits) | Accounting, integration, bridge engineering | Correctly detailed, incorrectly surfaced at the same navigation level as beginner tools |
| Non-user audience | `/brand-kit` | Partners/marketing | Reachable from a right-click menu and a footer link; does not need primary navigation |

## 9. Summary of the current UX posture

**Strong, and worth protecting:**

- Public vs private separation is explicit in naming and in copy.
- Missing/denied/partial/stale data is never rendered as zero.
- The experimental P&L area fails closed and says so.
- Sample data and cached data are labelled rather than disguised.
- Keyboard focus styling, skip link, reduced-motion handling, and `aria-live`/`role` usage exist in many places.
- Copy is accurate. Almost every sentence is *true*.

**Weak:**

- Copy is written for the team who built it: it explains mechanisms (partitions, cursor chains, canonical strings, coverage internals) where a user needs an outcome.
- The same reassurance is repeated in 2–7 places, so the signal is diluted.
- Navigation has 17 flat items, four of which are developer tools, and account navigation is duplicated.
- Every page opens with a header block + a metrics strip + a notice before the actual tool.
- The information hierarchy is inverted on several pages: the explanation sits above the numbers.
- Mobile hides provenance and columns using `hide-xs`, which removes context rather than re-flowing it.
- A single 595 kB unmounted-chunk JS bundle and no route-level code splitting.
