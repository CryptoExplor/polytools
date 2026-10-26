# PolyTools frontend UX audit — index and evidence rules

**Audit date:** 2026-10-26
**Repository:** `CryptoExplor/polytools`
**Branch audited:** `main` at merge commit `62a7518b2ccdbb7ddf5610ac83db78d41af46427` (PR #4, merged 2026-10-26T10:22:51Z)
**Working copy used for inspection:** `arena/793e90ca-polytools` at the same commit, clean tree
**Audit type:** static source review + server-side render text extraction + local dev-server HTTP checks
**Not performed:** real-browser rendering, device/emulator testing, screen-reader testing, live-account testing, accessibility certification, user research

## What this package is

This is a **design, copy, information-architecture, and frontend-quality audit** of the PolyTools web app as it exists in the tree above. It proposes a prioritized plan; it does not change application code.

The goal is the one the owner asked for: make existing functionality easier to **find, understand, and use** — not remove it. Nothing in this package authorizes deleting a feature, weakening a warning, altering an accounting gate, or changing a financial number.

## Documents

| File | Purpose |
|---|---|
| [README.md](./README.md) | This index: scope, method, evidence rules, limits |
| [CURRENT_FRONTEND.md](./CURRENT_FRONTEND.md) | Exact current state: routes, navigation, components, tokens, breakpoints, data flow, deployment, build metrics |
| [PAGE_BY_PAGE_AUDIT.md](./PAGE_BY_PAGE_AUDIT.md) | Findings for every route against the required A–E criteria |
| [TEXT_SIMPLIFICATION.md](./TEXT_SIMPLIFICATION.md) | Current → proposed copy inventory (navigation, titles, buttons, statuses, warnings, errors, empty states, account terms) |
| [NAVIGATION_REDESIGN.md](./NAVIGATION_REDESIGN.md) | Before/after navigation, grouping rationale, URL compatibility, mobile behavior |
| [DESIGN_SYSTEM_AUDIT.md](./DESIGN_SYSTEM_AUDIT.md) | Typography, spacing, components, tables/charts, themes, responsive design, accessibility, performance |
| [USER_JOURNEYS.md](./USER_JOURNEYS.md) | Eight task-based walkthroughs with friction points and simpler flows |
| [FRONTEND_ROADMAP.md](./FRONTEND_ROADMAP.md) | P0–P3 plan with evidence, effort, risk, acceptance criteria, tests |
| [REVIEW_BRIEF.md](./REVIEW_BRIEF.md) | Short independent-review brief for a second AI/human reviewer |
| [BATCH1_IMPLEMENTATION.md](./BATCH1_IMPLEMENTATION.md) | What the approved batch 1 changed, what the automated checks prove, and the browser pass still required |

## Why a new package instead of editing `docs/audit/`

`docs/audit/` is the **engineering, security, accounting, and release audit trail**. Several of its UX findings were already remediated in the tree reviewed here; others remain open. Mixing a new design audit into those files would corrupt their historical evidence.

This package therefore:

- **reads** `docs/audit/` and records which findings are historical versus still current (see §5);
- **does not modify** any file in `docs/audit/`;
- **does not modify** application code, tests, dependencies, deployment config, or Git history.

## Evidence labels

Every significant claim in this package carries one of four labels.

| Label | Meaning here |
|---|---|
| **Confirmed in source** | Directly readable in the reviewed commit: a component, a style rule, a configuration value, or a locally run deterministic command. Says nothing about rendering. |
| **Confirmed in browser** | Observed in a real browser session at a stated viewport. **This label is not used anywhere in this package** — no browser tooling was available. Zero claims rest on it. |
| **Likely / needs verification** | A reasoned inference from source. The specific missing check is named next to the claim. |
| **Unknown** | No adequate evidence. Neither success nor failure is inferred. |

One additional, clearly-marked evidence channel was used and is always spelled out:

> **Confirmed by server render** — the component tree was rendered with `react-dom/server` (`renderToStaticMarkup`) under `MemoryRouter` + `AppProvider`, and the resulting HTML text was inspected. This proves *which strings, controls, and landmarks the code produces in the unauthenticated/empty state*. It is **not** a visual check: it does not prove layout, contrast, overflow, focus order, or appearance in any browser.

Rendered-state facts must never be reported as "seen on screen". Where this package says "renders", it means server-rendered markup, not a screenshot.

## Method actually used

1. Read the entire app shell (`App.tsx`, `Layout.tsx`), all 13 page modules (8,502 lines), all 10 shared components (4,526 lines), all 16 frontend libraries (2,058 lines), and all 2,278 lines of `styles.css`.
2. Read `docs/audit/` (15 files, 2,462 lines) and separated historical findings from current behavior by re-checking each claim against the reviewed commit.
3. Ran the repository's own verification commands locally (see §4).
4. Started the real Vite dev server and exercised the API proxies to see what the app serves in this environment.
5. Rendered every route server-side and extracted visible text, control counts, and notice counts per route (see §6).
6. Wrote findings, copy proposals, IA proposal, and a roadmap.

## 4. Fresh local verification

Run in this checkout on 2026-10-26 with Node `v22.22.3` (the repo declares `engines.node >= 24`; npm emitted `EBADENGINE` warnings only), after `npm install` (116 packages).

| Command | Result |
|---|---|
| `npm test` | **PASS** — 202 tests, 44 suites, 0 failed, 0 skipped |
| `npm run typecheck` | **PASS** — web + backend TypeScript projects |
| `npm run build` | **PASS** — Vite build; 99 modules; JS 595.31 kB (gzip 177.48 kB), CSS 34.09 kB (gzip 7.02 kB); one "chunk larger than 500 kB" warning |
| `npm run check:performance` | **PASS** — all four budgets (JS 595,963 ≤ 625,000 B; JS gzip 177,125 ≤ 185,000 B; CSS 34,086 ≤ 40,000 B; CSS gzip 6,987 ≤ 10,000 B) |
| Vite dev server (`npm -w apps/web run dev`, port 5173) | **Starts**. `/` → 200. `/api/env` → 200 JSON. `/api/markets` → 200 with header `x-polytools-data-source: wire-samples`. `/api/overview` → 200. |

`git status` was clean before and after the audit. Two throwaway SSR helper scripts were created under `scripts/` for text extraction and deleted before handoff. `package-lock.json` was restored after `npm install`.

## 5. Relationship to `docs/audit/`

`docs/audit/PR4_COMBINED_RELEASE_AUDIT.md` recorded a **DO NOT MERGE** decision on a 103-file tree with nine open gates. PR #4 was nevertheless merged into `main` on 2026-10-26. The gates in that document are therefore still **unverified**, not withdrawn.

For UX specifically, this audit re-checked every `docs/audit/UX_AUDIT.md` finding against the reviewed commit. Results:

**Remediated in the reviewed tree** (historical, do not re-report as current):

- Dashboard "Book" row action now targets public `/book` (`Dashboard.tsx` `DASHBOARD_TOOL_PATHS`).
- Quote notionals are formatted with the real quote asset, not `$`, via `lib/format.ts` `formatCompactQuoteNotional` (used by Tape, Book, Heatmap, DepthChart).
- Heatmap flat-book decoding now keeps non-zero liquidity (`lib/heatmap.ts`, `flatBook` branch).
- Compare has a real zero-match state (`CompareEmptyState`) instead of silently falling back to all rows.
- Calculator converter price no longer overwrites manual input on every poll (`converterPriceReducer`, `dispatchConvPrice`).
- Hub telemetry uses `pending`/`unavailable` fallbacks instead of fake defaults (`lib/telemetry.ts`).
- Flow deep links now land on public lookup via `App.tsx` `/flow` → `accountRedirectTarget(..., "public")`.
- Brand filters have an empty state (`BrandFilterEmptyState`).
- Copy buttons report failure (`lib/clipboard.ts` `copyButtonPresentation`).
- `CopyButton` no longer produces "Copy Copy".
- Countdown live region uses `aria-live="off"`.
- Dashboard no longer nests interactive row buttons inside a `role="button"` row; sort headers no longer contain a tooltip button.
- Brand section filters use `role="group"` instead of fake tabs.

**Still current** (re-confirmed in this audit):

- Shared `ConfirmDialog` and `GlossaryDrawer` set `aria-modal="true"` but do not trap focus or restore it; no `inert` is used anywhere in `apps/web/src` (`A11Y-1`).
- Meaningful small text uses tokens measured below 4.5:1 in `docs/audit/TEST_AND_VERIFICATION.md` (`A11Y-2`).
- Heatmap visual has no keyboard cell inspection; DepthChart is `role="img"` only (`A11Y-4`).
- Account Load remains coupled to the official catalog; view-specific labels overstate scope (`UX-A1`).
- Account section switching discards imported history without a pre-warning at the moment of the click (`UX-A2`).
- SDK generated snippets are not validated or compiled (`UX-P7`).
- Account copy mismatches listed in `UX-A4` are largely fixed. One part of that item is now stale: **every** account section renders `PageHeader`, so "Lock now", "Official API Keys" and "SDK Quickstart" are available on Trades/Orders too. The remaining defect is the opposite — `PageHeader` and `AccountAnalytics`'s own `Card` render the same title twice (see `PAGE_BY_PAGE_AUDIT.md` P-63).

**Deployment fact discovered during this audit (not a UI issue):** the `Deploy to GitHub Pages` workflow on `main` **failed** at `actions/deploy-pages@v4` with `Failed to create deployment (status: 404) … Ensure GitHub Pages has been enabled`. The build steps passed. This is a repository-settings gap, recorded here because it affects whether any of this UI is reachable.

## 6. Rendered-state measurements (server render, empty/unauthenticated state)

Extracted from `renderToStaticMarkup` output. "Words" counts all visible text nodes in the main content region; "subtitle" is the character length of `.page-header-desc`.

| Route | Page heading (`h2`) | Words | Subtitle chars | Notices | Metric cells | Buttons | Pills | Tables | Form inputs |
|---|---|---|---|---|---|---|---|---|---|
| `/` | Spot Market Overview | 134 | 139 | 0 | 4 | 14 | 1 | 1 | 1 |
| `/book` | Public Order Book · BTC-USDT | 159 | 134 | 0 | 5 | 8 | 1 | 0 | 1 |
| `/tape` | Recent Market Trades · BTC-USDT | 203 | 119 | 0 | 5 | 11 | 2 | 0 | 2 |
| `/charts` | Candlestick Chart · BTC-USDT | 144 | 152 | 0 | 4 | 21 | 1 | 0 | 1 |
| `/heatmap` | Order Book Liquidity Heatmap | 68 | 161 | 0 | 0 | 10 | 2 | 0 | 1 |
| `/compare` | Cross-Venue Price Comparison | 217 | 170 | 2 | 5 | 8 | 1 | 1 | 0 |
| `/zipper` | Zipper Cross-Chain Route Comparator | 209 | 188 | 0 | 4 | 3 | 1 | 0 | 4 |
| `/calc` | Trading & Risk Calculators · BTC-USDT | 429 | 135 | 0 | 5 | 14 | 2 | 0 | 14 |
| `/hub` | Testnet Hub & Onboarding Guide | 671 | 161 | 1 | 4 | 2 | 22 | 0 | 8 |
| `/sdk` | Beginner SDK & Trading Bot Quickstart Studio | 820 | 184 | 0 | 5 | 10 | 46 | 2 | 6 |
| `/brand-kit` | Polyester Brand Kit & Token Assets | 1,215 | 169 | 0 | 4 | 78 | 27 | 0 | 2 |
| `/account` | Account overview | 226 | 146 | 2 | 0 | 1 | 2 | 0 | 1 |
| `/account/api` | API setup | 458 | 123 | 1 | 4 | 4 | 2 | 0 | 4 |
| `/account/trade` | Your Trades | 227 | 122 | 2 | 0 | 1 | 2 | 0 | 1 |
| `/account/orders` | Your Orders | 215 | 89 | 2 | 0 | 1 | 2 | 0 | 1 |
| `/account/pnl` | Profit and Loss | 250 | 223 | 2 | 0 | 1 | 2 | 0 | 1 |
| `/account/transactions` | Money Movements | 138 | 111 | 1 | 0 | 3 | 2 | 0 | 0 |

These numbers describe the **empty state only**; pages with loaded data render considerably more. They are useful for relative density comparison (e.g. `/brand-kit` at 1,215 words is ~9× `/`), not as absolute page weight.

## 7. Limits — what this audit did not establish

- **No browser was available.** No screenshot, viewport test, zoom test, reflow test, forced-colors test, or animation review was performed. Every visual claim is marked Likely or left Unknown.
- **No assistive technology** was used. Contrast figures quoted from `docs/audit/` are deterministic luminance calculations, not a WCAG conformance result.
- **No live account** was unlocked and no authenticated request was made. Account-page findings concern the locked and empty states, which is what the server render produced.
- **The sandbox cannot reach the testnet API.** `/api/markets` served `wire-samples`, so all data-path observations in this environment describe the labelled-sample fallback, not live testnet behavior.
- **No user research.** Nothing here is a user-study claim.
- **No performance profiling** beyond bundle sizes from the build script. No Web Vitals, no rendering profile, no network waterfall.
