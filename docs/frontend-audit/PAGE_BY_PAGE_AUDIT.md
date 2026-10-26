# Page-by-page UX audit

Every route in `apps/web/src/App.tsx` is covered, plus the account sub-routes, the two global overlays, and the two legacy redirects.

**Evidence key:** `SRC` = Confirmed in source · `SSR` = Confirmed by server render (markup text, not visual) · `DEV` = Confirmed against the local dev server over HTTP · `LIKELY` = Likely / needs verification · `UNK` = Unknown.

**No finding in this document is browser-confirmed.** Layout, contrast, overflow, and focus-order claims are source- or SSR-derived and must be re-checked visually before being treated as final.

Scoring used per page:

- **Purpose in 5s** — would a newcomer know what this page is for within about five seconds?
- **Primary action** — is there one obvious next action?
- **Text burden** — how much must be read before using the page?

---

## 0. Global shell (applies to all routes)

### G-1 — Six separate declarations of the same guarantee
`SRC` The read-only/testnet message appears in: `PageHeader` eyebrow ("Read-only · Testnet"), topbar eyebrow ("Read-only · testnet"), sidebar brand subline ("Read-only · testnet"), sidebar disclaimer ("Public analytics… No wallet or login."), footer ("PolyTools · Read-only companion…"), and the first-visit intro bar. Impact: repetition trains users to ignore all of them, including the one that matters on a page where an action looks risky.
**Recommendation:** keep **two** placements — one persistent, unmissable location (sidebar brand subline or a single topbar pill), and one contextual statement where a user might otherwise assume live trading (Book, Tape, Account).

### G-2 — Intro bar competes with page content
`SRC`/`SSR` `Layout.tsx:461-490`. The intro section is inside `<main>`, above the route outlet, and renders on every route until dismissed. It has a heading-weight sentence, two sentences of body, and three buttons (Browse markets / Testnet setup / Dismiss). On `/` it pushes the "Spot Market Overview" heading and the price table below a second page header block.
**Impact:** the first thing a returning-but-not-yet-dismissed user sees is marketing copy, not data.
**Recommendation:** move the product explanation into a dismissible *inline* strip inside the Dashboard only, or into a dedicated `/start` panel; keep one line ("Read-only · no wallet needed · testnet data") in the shell.

### G-3 — No `<h1>` anywhere
`SRC` `grep -r "<h1" apps/web/src` returns nothing. Page titles are `<h2>` (`PageHeader`), and panel titles are `<h3>`. The document title is set per route (`Layout.tsx` `document.title = "SYMBOL · Title — PolyTools"`), which is good, but the heading outline starts at level 2 and the sidebar brand is a `<span>`.
**Impact:** screen-reader heading navigation and any SEO/assistive summary lose the page's top-level topic.
**Recommendation:** make `PageHeader`'s title an `<h1>` (keep the visual size) and demote panel titles to `<h2>`. Purely semantic; no visual change.

### G-4 — Duplicate symbol selectors
`SRC`/`SSR` The topbar renders `SymbolSelect` for routes whose `ROUTE_META.showSymbolSelector` is true (`/`, `/book`, `/tape`, `/charts`, `/heatmap`, `/calc`, `/sdk`). Book, Tape, Charts, Heatmap, Calc and SDK **also** render their own `SymbolSelect` inside the page (Book `PageHeader` actions, Tape header actions, Charts header actions, Heatmap toolbar, Calc header actions, SDK symbol select). Two identical dropdowns with the same 18 options appear on one screen, and both write to the same store.
**Impact:** confusing ("which one do I use?"), redundant tab stops, wasted topbar width on mobile.
**Recommendation:** one symbol control per screen. Keep the topbar one for consistency, remove page-level copies, and let a page that needs a symbol-specific header read the store value.

### G-5 — Duplicate account navigation
`SRC`/`SSR` The six account sections are in the sidebar **and** in `AccountTabs` at the top of every account page. On mobile the tabs are the only realistic navigation to sibling sections (sidebar is behind a burger), so the tabs earn their place; the sidebar duplicates it.
**Recommendation:** keep the tabs, collapse the sidebar to a single "My account" entry (see `NAVIGATION_REDESIGN.md`).

### G-6 — Four different freshness components
`SRC` `DataFreshness`, `PublicCacheStatus`, topbar fallback pill, `WireSampleNotice` (see `CURRENT_FRONTEND.md` §4.4). They use different vocabulary for the same axis ("Updated 2s ago" vs "Cached metadata · 3m ago" vs "Live MCP" vs "Sample data").
**Impact:** users cannot build one mental model of "is this fresh?", and on mobile the cached-copy pill is `hide-xs`, so the provenance disappears exactly where space is tightest.
**Recommendation:** one shared `FreshnessBadge` with three states — **Live**, **Cached (age)**, **Sample** — plus a single expandable detail popover carrying store, timestamps, and poll interval.

### G-7 — Overlays without focus management
`SRC` `ConfirmDialog` (`ui.tsx:415-460`) and `GlossaryDrawer` (`Glossary.tsx:150-215`) set `role="dialog" aria-modal="true"`, handle Escape, and autofocus one control, but do **not** trap focus, do not restore focus to the opener, and do not make background content inert. `AccountAnalytics`'s `OrderDetailsDrawer` *does* implement all of it (`AccountAnalytics.tsx:430-470`) and is the correct pattern to copy.
`LIKELY` keyboard users can tab out of a modal into the page behind it. `UNK` exact behavior per browser.
**Recommendation:** extract the drawer's focus utility into `lib/focusTrap.ts` and use it in both dialogs plus the mobile sidebar.

### G-8 — Mobile navigation is reachable when closed
`SRC` The off-canvas sidebar is hidden by transform only; no `inert`. `LIKELY` it remains in the tab order on phones.
**Recommendation:** add `inert`/`hidden` when closed, move focus into the panel on open, restore to the burger on close. Verify with a real keyboard.

---

## 1. `/` — Dashboard ("Spot Market Overview")

**Purpose in 5s:** partially. The page is a market table, but it announces itself as a terminal and explains decoding rules first.
**Primary action:** unclear — five candidates compete (Browse markets from the intro bar, Export CSV, search, watchlist, four row actions).
**Text burden:** 134 rendered words before data, 139-char subtitle, plus the intro bar.

| ID | Finding | Evidence | Recommendation |
|---|---|---|---|
| P-01 | Subtitle is a feature list, not a purpose: *"Real-time top-of-book prices, 24-hour volume, basis-point spreads, and live session tick sparklines across all listed Polyester spot pairs."* | `SRC` `Dashboard.tsx:303`; `SSR` 139 chars | "Prices and 24-hour stats for every Polyester spot market. Updates every 3 seconds." |
| P-02 | Card subtitle explains the row buttons (*"Open a market chart from its symbol, or jump directly to Book, Tape, Chart, or Heatmap."*), and each row then repeats Book/Tape/Chart/Heat four times in a 9-column table | `SRC` `Dashboard.tsx:368` | Remove the sentence; label row buttons in full words (`Order book`, `Trades`, `Chart`, `Depth`) or collapse them into one "Open" menu |
| P-03 | Table footer teaches wire decoding: *"Wire prices are decoded from scaled integers (raw ÷ 10³)… zero extra API calls."* | `SRC` `Dashboard.tsx:388-392` | Move to Developer details; replace with "Prices are from the public testnet feed." |
| P-04 | Four metric cells render `—` before data with sublabels that read like content ("Aggregate spot volume", "Waiting for market data", "Top-of-book bid/ask") | `SSR` | Show skeleton cells or hide the strip until the first response; keep labels but drop the filler sublabels |
| P-05 | Sorting is discoverable only via the `↕` glyph inside each header button; 4 of 9 columns are sortable and 2 have long technical tooltips | `SRC` `renderSortTh` | Keep sorting; move the two decoding tooltips into the Developer details block |
| P-06 | "24h Volume ($)" mixes a USD-normalised figure with a `$` glyph while the same table lists non-USD quote pairs (ETH-BTC, XRP-BTC). The underlying field (`volume24hUsd`) appears to be USD-denominated, so this is a labelling ambiguity rather than a wrong unit | `SRC` `Dashboard.tsx` header `"24h Volume ($)"` + `fmtCompact(dec(m.volume24hUsd), "$")` | Label `24h volume (USD)` and add a one-line note ("quote volumes converted to USD") **only if** the backend confirms conversion; otherwise show the raw quote asset. Do not change the number until the field's meaning is confirmed |
| P-07 | Watchlist, gainers/losers, and quote filters are three separate controls of three different kinds (toggle button, segmented group, segmented group) in one row | `SRC` toolbar | One filter row: search + quote select + "All / Gainers / Losers" + star toggle with count |

**Keep:** sparklines, price flash, CSV export, sticky sortable header, empty-state "Reset filters", keyboard-accessible sort buttons.

---

## 2. `/book` — Public Order Book

**Purpose in 5s:** yes — but only after reading the subtitle that disambiguates it from the private Orders page.
**Primary action:** adjust depth; no trading action (correct).

| ID | Finding | Evidence | Recommendation |
|---|---|---|---|
| P-08 | Subtitle spends its second and third sentences on disclaimers: *"No account key is used. These orders are not necessarily yours."* — the second is confusing next to an "Order Book" title | `SRC` `Book.tsx:143`; `SSR` 134 chars | "Resting buy and sell orders for BTC-USDT. Public data — these are not your orders." (one sentence, one clause) |
| P-09 | Five metric cells above the tool, two of which (Top Spread, Book Imbalance) carry tooltip-only explanations; imbalance adds a bar plus `% B / % A` text plus a third caveat | `SRC` `Book.tsx:190-255` | Keep Best bid / Best ask / Spread / Imbalance. Drop the `bookSeq` technical sublabel into Developer details |
| P-10 | Two depth controls on one page: the header's `Depth 10/20/50/100` and the wall-sensitivity `≥2×/3×/5× median` group | `SRC` | Keep depth in the header; move wall sensitivity into the walls card header (already there) and label it "Wall sensitivity" |
| P-11 | "Detected Liquidity Walls" panel explains statistics before showing anything: *"WALL is a size outlier (≥ 3× median side size), not a detected trader."* | `SRC` `Book.tsx:298` | Lead with the result ("2 large bid levels"), put the definition in the term tooltip that already exists |
| P-12 | Notional column disappears at ≤600 px (`hide-xs`), leaving size and cumulative only | `SRC` CSS `.ladder-head .hide-xs` | Replace with a two-line row on mobile rather than deleting the number |
| P-13 | Depth chart is `role="img"` with no textual summary in the card; the ladder below is the equivalent, but nothing says so | `SRC` `DepthChart.tsx:167` | Add one line: "Exact levels are listed below the chart." |

---

## 3. `/tape` — Recent Trades

**Purpose in 5s:** yes, with a caveat — the whale-alert panel is visually half the page.
**Primary action:** none needed; alerts are secondary but look primary (`Test Alert` button, sound/desktop toggles, threshold select, four filter buttons).

| ID | Finding | Evidence | Recommendation |
|---|---|---|---|
| P-14 | Two "watches" coexist: the alert setup card ("Large Print Alert & Tape Controls") sits **above** the tape, so a visitor must scroll past configuration to see trades | `SRC` `Tape.tsx:360-460` | Put the tape first; move alert setup into a collapsible "Alerts" panel with an on/off summary line ("Alerts off — set a size threshold") |
| P-15 | Alert card subtitle mixes three ideas: *"Alerts are local. They are not orders. Triggered once per unique matchId on newly arriving trades."* | `SRC` `Tape.tsx:368` | "Alerts stay in this browser. Each trade triggers once." |
| P-16 | Session-scoped metrics (Buy Flow, Sell Flow, Aggressor Volume Ratio, Session VWAP, Largest Print Seen) are labelled "Session" but the page never states that they reset on reload | `SRC`/`SSR` | One line under the strip: "Counts reset when you reload." |
| P-17 | Whale threshold shows a value even when alerts are off (`≥ 10.00K USDT`) with no visible on/off state | `SRC` | Add explicit state ("Alerts: off") beside the threshold |
| P-18 | Sound/notification buttons say "Sound Off" / "Desktop Off" as their pressed label, which reads as a status rather than an action | `SRC` `Tape.tsx:404-435` | Use a switch with a label ("Sound alerts") and a status pill |
| P-19 | Mount behaviour unmutes nothing automatically (correct), but `Test Alert` plays a tone and shows a toast without explaining it needs Sound enabled | `SRC` `triggerTestAlert` | Rename "Test alert" and state what it will do in its tooltip |
| P-20 | `Match ID / Age` column is `hide-sm`: the copy affordance disappears on tablets | `SRC` | Keep the age; move copy into the row's expanded state |

---

## 4. `/charts` — Candlestick Chart

**Purpose in 5s:** yes.
**Primary action:** timeframe selection — but there are **four** segmented control groups plus a symbol select plus refresh in the toolbar.

| ID | Finding | Evidence | Recommendation |
|---|---|---|---|
| P-21 | Subtitle duplicates the card subtitle almost verbatim: *"Hover or press Left/Right arrow keys to inspect individual OHLCV bars"* appears twice (page subtitle and card subtitle) | `SRC` `Charts.tsx:128` and `:219`; `SSR` | Keep it once, in the chart card as a small hint |
| P-22 | 11 timeframes + 3 bar counts + 3 windows + 2 SMA toggles = 19 buttons in one toolbar row, wrapping into 3–4 visual rows at tablet width | `SRC` toolbar; `SSR` 21 buttons on the page | Group into: timeframe (primary), bars (secondary select), window (secondary), overlays (in a "Indicators" popover) |
| P-23 | Footer mixes a caveat and a number: *"MCP marks past bars as open on some intervals; only the rightmost bar is the current forming period."* + "Auto-refresh 8.0s for 1h" | `SRC` card footer | Keep the caveat in Developer details; keep the refresh interval in the freshness badge |
| P-24 | `1s` timeframe polls every 1 s while the freshness threshold is `interval × 3.5` — a 3.5 s stall flips the badge to warn | `SRC` `POLL_BY_TF` + `DataFreshness` | Use an absolute minimum staleness window (e.g. 8 s) so sub-2 s users are not shown a warning on a hiccup |

**Keep:** keyboard arrow inspection, SMA colours with matching labels, volume subplot.

---

## 5. `/heatmap` — Liquidity Heatmap

**Purpose in 5s:** no. The subtitle names an internal API (`get_heatmap`) in user-facing copy.
**Primary action:** hover a cell — undiscoverable on touch.

| ID | Finding | Evidence | Recommendation |
|---|---|---|---|
| P-25 | Subtitle exposes an MCP tool name to end users: *"Historical resting bid and ask liquidity buckets from `get_heatmap`."* | `SRC` `Heatmap.tsx:313-318`; `SSR` | "Where buy and sell orders rested over the last hour. Brighter = more size." |
| P-26 | Render order is: header → toolbar → *then* metric strip (the only page that puts metrics after controls) | `SSR` (`0` metric cells in the first screen of markup) | Align with other pages: metrics, then controls, then chart |
| P-27 | Hover-only inspection; the `<details>` "Keyboard and text inspection" is collapsed and below the chart | `SRC` `HeatmapTextInspector` | Open the inspector by default at ≤960 px and give the canvas arrow-key cell navigation |
| P-28 | Six separate legends live in one subtitle line ("Green = … · Red = … · Lines trace …") | `SRC` `Heatmap.tsx:445` | Render a compact legend component under the chart |
| P-29 | "Most Persistent Liquidity Price Bands" table uses six numeric columns with no units in three of them ("Cumulative Size", "Bucket Persistence") | `SRC` | Add unit suffixes; drop "Est. Avg Notional" into a details column |

---

## 6. `/compare` — Cross-Venue Price Comparison

**Purpose in 5s:** no — three disclaimers arrive before a single comparison row.
**Primary action:** none; it is a read-only table.

| ID | Finding | Evidence | Recommendation |
|---|---|---|---|
| P-30 | Subtitle + a warning banner + an info banner all say the comparison is not executable, i.e. the same warning **three times in the first screen** | `SRC` `Compare.tsx:184`, `:196-200`, `:270-283`; `SSR` 2 notices before the table | Keep one prominent line: "Reference only — not a tradeable price." |
| P-31 | The info banner also explains polling cadence and rate limits ("Polyester prices poll every 5s while CoinGecko … every 35s to respect public rate limits") | `SRC` `:270-283` | Move to the freshness popover |
| P-32 | Five metric cells, two of which report feed plumbing ("Polyester Feed Status", "CoinGecko Reference Feed") rather than a user question | `SRC`/`SSR` | Collapse feed status into one badge pair; keep Matched pairs and Widest divergence |
| P-33 | The table has 8 columns including "Parity Gauge" and "Feed Status & Timestamps" — the latter is long prose per row inside a table cell | `SRC` `:490-520` | Move per-row provenance into a tooltip or an expandable row |

**Keep:** the zero-match empty state, wire-sample provenance, term tooltips on bps.

---

## 7. `/zipper` — Cross-Chain Route Comparator

**Purpose in 5s:** yes, though the title contains an internal product name ("Zipper") without explanation.

| ID | Finding | Evidence | Recommendation |
|---|---|---|---|
| P-34 | A 188-char subtitle carries purpose + three data categories + a reassurance | `SRC` `Zipper.tsx:197` | "Compare deposit routes for each token: fees, minimums, and confirmation times." |
| P-35 | Card footer holds a 70-word "Estimation Notice" plus a tip, both below the table where they are read last — yet they qualify every number above | `SRC` `Zipper.tsx:332-350` | Split: one short line above the table ("Estimates only — confirm in the Polyester app"), full method in Developer details |
| P-36 | Two ranking modes are `Rank by Fee` / `Rank by Min Deposit` while the metric strip shows both "cheapest" values simultaneously — three ways to read the same ordering decision | `SRC` | Keep the toggle; make the metric strip show the currently ranked route |
| P-37 | "Simulate Amount" is an unlabelled number input with a currency label after it and no result column header showing what it affects | `SRC` `:316-330` | Label the column it drives ("Est. deposit net") and show the delta inline |
| P-38 | Contract table says addresses are "not independently verified by PolyTools" — a limitation buried in a card subtitle at the bottom | `SRC` `:552` | Keep, but surface as a badge on the card header |

---

## 8. `/calc` — Trading & Risk Calculators

**Purpose in 5s:** partially. Four numbered calculators, 14 inputs, 5 metric cells, and pre-filled example numbers make the page look "already answered".
**Primary action:** ambiguous — four calculators are equally weighted.

| ID | Finding | Evidence | Recommendation |
|---|---|---|---|
| P-39 | Page opens with results for inputs the user never entered ("Sized Position Qty 0.005 BTC", "Simulated Net PnL +958.00 USDT") | `SSR` (`/calc` renders populated metric cells with zero interaction) | Start with empty metric cells and a single "Try a sample" affordance per calculator, or start with calculator 1 only |
| P-40 | Page subtitle calls them "Scratchpads"; card titles are numbered and mixed in register ("1. Risk-Based Position Sizing" vs "2. Educational Isolated-Margin Sketch (Not Polyester Liquidation)") | `SRC` `Calc.tsx:352`, `:427`, `:565` | Name cards by the user question: "Position size", "Liquidation (textbook model)", "Profit & fees", "Unit converter" |
| P-41 | Card 2's title contains its own disclaimer in parentheses; the subtitle then argues about product taxonomy (*"Polyester's public product is unified-asset spot + lending, not isolated-margin perpetuals"*) | `SRC` `Calc.tsx:563-566` | Title "Liquidation estimate (simple model)"; put the product caveat in one info line |
| P-42 | `Try a sample` loads a 3-line walkthrough that pushes the rest of the form down | `SRC` `applySampleSizing` | Move walkthrough below the result, collapsed |
| P-43 | Fee field says "Default 10 bps is a placeholder. Polyester VIP fees are not on this MCP" — accurate, but "MCP" is internal vocabulary | `SRC` `:715` | "Example fee rate — check your own fee tier." |
| P-44 | The page uses `bps`, `tick size`, `step size`, `notional`, `leverage`, `ROI` without inline definitions except via 4 tooltips | `SRC` | Add the glossary affordance inline for the first use of each term in each card |

---

## 9. `/hub` — Testnet Hub & Onboarding

**Purpose in 5s:** yes (it is explicitly an onboarding page), but 671 rendered words and 22 pills make it read as a dashboard, not a checklist.

| ID | Finding | Evidence | Recommendation |
|---|---|---|---|
| P-45 | Two "progress" surfaces: a countdown card and an onboarding-progress card, plus a metric strip already reporting "Onboarding Checklist 0 / 8 (0%)" and "Daily Claim Reset 00:00 UTC" — the same two facts appear twice each | `SRC`/`SSR` | Keep the strip; make each card the *action* (claim window → open app; checklist → the 8 steps) |
| P-46 | `Countdown` renders "13h : 23m : 36s" with a second-by-second update and three explanatory labels underneath ("00:00 UTC start", "44% of UTC day elapsed", "00:00 UTC reset") | `SSR` | Two labels max; drop the percentage |
| P-47 | Diagnostics card is titled "Backend & MCP Connection Diagnostics" and shows keys like "Serving Environment (apiEnv)", "Testnet MCP Configured", "Telemetry from /api/env and /api/markets" | `SRC` `Hub.tsx:415-470` | Rename "Connection details"; move to Developer details or keep collapsed by default |
| P-48 | Safety notice is correct and important, but appears before the actions it protects | `SRC` `:285-293` | Keep it directly above the "Open Polyester Testnet App" action instead |
| P-49 | Checklist items are `<label>` with nested links ("Open link") — clicking the link toggles the checkbox | `SRC` `:395-425` (`onClick={(e) => e.stopPropagation()}` present, `LIKELY` OK but untested) | Verify with keyboard/AT; consider rendering links outside the label |

---

## 10. `/sdk` — SDK & Bot Quickstart

**Purpose in 5s:** yes for developers; **it is the single densest page (820 rendered words, 46 pills, 2 tables, 6 inputs)** and it ships generated trading code.

| ID | Finding | Evidence | Recommendation |
|---|---|---|---|
| P-50 | Page subtitle sells a journey ("from zero-credential public market reads to Ed25519 authenticated orders") and the first cards are matrices, not a quickstart | `SRC` `SdkGuide.tsx:412-420`; `SSR` | Lead with a 3-step "copy this, run it" block; move matrices below |
| P-51 | Generated snippets interpolate unvalidated qty/price/key and the page does not state that running them mutates testnet state | `SRC` (see `docs/audit/UX_AUDIT.md` UX-P7, re-confirmed) | Add one prominent line above the generator: "PolyTools does not run this code. Running it places testnet orders." |
| P-52 | "Beginner Rules" card contains four paragraphs with mixed register ("No Keys Needed for Market Data", "32B public key · ±10s timestamp") | `SRC` `:464-540` | Split into 4 short bullets, one sentence each |
| P-53 | Capability/transport matrices list TypeScript, Python, Go, Rust — Go appears in the matrix but has no quickstart card above | `SRC` `:994`, `:1045` | Either add a Go card or mark the column "no quickstart yet" |
| P-54 | Canonical-string normalizer is an expert tool on a page labelled "Beginner" | `SRC` `:825-960` | Move below a "Advanced" divider |

---

## 11. `/brand-kit` — Brand Kit

**Purpose in 5s:** yes for its audience.
**Primary action:** copy/download an asset. 78 buttons on one page; 1,215 rendered words.

| ID | Finding | Evidence | Recommendation |
|---|---|---|---|
| P-55 | Page ignores the market shell's job: a full product page with 6 section filters, 5 asset groups, and 27 pills | `SRC`/`SSR` | Keep, but link it from the footer only and consider not styling it as a market tool page |
| P-56 | Six card subtitles are guidance paragraphs ("If a surface needs more than the logo: campaigns, social…") | `SRC` `BrandKit.tsx:209-596` | Trim each to one sentence; move detailed usage rules to the guidelines link |
| P-57 | The page is reachable from a right-click context menu on the logo — an interaction the page itself has to explain | `SRC` `BrandKit.tsx:209`; `Layout.tsx` brand menu | Keep the menu (nice power feature) but stop advertising it in body copy |

---

## 12. Account shell — `/account`, `/account/api`, `/account/trade`, `/account/orders`, `/account/pnl`, `/account/transactions`

**Purpose in 5s:** no, for every section. Each authenticated section opens with: tabs → page header (title + 90–223 char subtitle + 3 actions) → "Live compatibility remains unverified" warning → "Section-scoped memory" warning → a 5-cell technical `kv` grid → period select → Load button → explanation line → empty state.

That is **eight blocks before any data**, and four of them are caveats.

| ID | Finding | Evidence | Recommendation |
|---|---|---|---|
| P-58 | Two full-width warning notices on every section, always visible, both about internals: CORS/permission semantics and memory-discard semantics | `SRC` `AccountAnalytics.tsx:965-985`; `SSR` 2 notices per account route | Collapse into one status line ("Connection: locked · reads not verified") plus a "What this means" details block; keep the discard warning only where a long import can be lost |
| P-59 | A 5-cell `kv` grid ("Registered key ID", "Secure browser context", "Authenticated GET reads: Enabled", "Official pair catalog: SpotConfig validated", "CORS / permissions: Not live-verified") duplicates the metric strip on API setup and uses internal nouns | `SRC` `:987-995`; `SSR` | Replace with a 2-item status (`Key saved` / `Unlocked`) and move the rest to Developer details |
| P-60 | Period select shows raw tokens `1d … 365d` as option text while the label uses a friendly phrase (`Balance and equity time period`, `P&L analysis time period`) | `SRC` `:1026-1030` | Use "Last 7 days" etc. (labels already exist in `RANGE_LABELS`) |
| P-61 | Load button label varies by section ("Load account data", "Load your trades", …) but the click always performs the same broad load including the official catalog | `SRC` `load()`; `docs/audit/UX_AUDIT.md` UX-A1 still current | Either rename to "Load account data" everywhere, or make the read actually view-scoped |
| P-62 | "Import full history (capped)" sits inside an info notice with a "Page safety cap" select (100…10 000 pages) — the highest-risk control on the page is inside an explainer box | `SRC` `:1012-1045` | Promote to a normal action with its cap in a details popover; keep cancel + "previous snapshot retained" messaging visible during import |
| P-63 | Every account section renders its title **twice**: once in `Portfolio`'s `PageHeader` and again in `AccountAnalytics`'s `Card` title, with two different subtitles (e.g. `/account/trade` shows "Your Trades" + "Only executions belonging to your connected account…" and then "Your Trades" + "Only executions returned by the authenticated account fills read…") | `SRC` `Portfolio.tsx:407` (PageHeader for all sections) + `AccountAnalytics.tsx:955-963`; `SSR` shows both headings on one page | Remove the `Card` title/subtitle inside `AccountAnalytics` and keep one heading per section. Note: the `Lock now`, `Official API Keys` and `SDK Quickstart` actions **are** present on all sections, so the historical `docs/audit/UX_AUDIT.md` "missing PageHeader" claim is stale |
| P-64 | P&L section subtitle is 223 characters and uses five accounting terms (`cost-basis`, `opening basis`, `resolved flows`, `method provenance`, `current mark`) plus a logic clause about which values need a mark | `SRC` `Portfolio.tsx:60-63`; `SSR` 223 chars | "Profit and loss needs your opening costs, complete trades, and a price mark. Until then we show 'Unavailable' rather than a guess." |
| P-65 | Money Movements asks the user to choose between "My account" and "Public transaction lookup" with a notice that repeats the page subtitle | `SRC` `Portfolio.tsx:121-140` | Make it a two-tab control with one-line descriptions under each tab, dismiss the duplicate notice |
| P-66 | Export controls say "Export validated rows" vs "Export loaded rows" — a distinction users cannot evaluate without the coverage footnote | `SRC` `AccountAnalytics.tsx` `ExportControls` | Say "Download CSV/JSON" and put the coverage caveat in the confirmation dialog (which already exists and is good) |
| P-67 | `DatasetMessages` footer renders a dense machine string: *"Data loaded: 12/14 rows · 2 pages · more pages may remain · 1 duplicate row · 3 conflicting rows · 1 unrecognized row · page limit reached"* | `SRC` `DatasetMessages` | Show two facts ("12 of 14 rows used · more pages may remain") and move the rest into a details block |
| P-68 | Error copy is good but long, and each code prefixes the message with an internal code (`localError` renders `"PERMISSION_DENIED: Your account key does not have permission…"`) | `SRC` `:748-760`, `:1055` | Show the human sentence only; put the code in a tooltip for support |

**Keep, do not weaken:** fail-closed behaviour, "Unavailable" instead of zero, "not a tax statement" in exports, the explicit export confirmation, the order-details drawer, lock/wipe confirmations, memory-only private data.

---

## 13. Overlays

**Glossary** (`GlossaryDrawer`) — 17 terms, good definitions, searchable. Issues: no focus trap (G-7); the "Read-only" entry is a 55-word paragraph that is really a policy statement; subtitle says "17 key market, order book, Zipper bridge, and API terms" which is a count nobody needs. `LIKELY` the drawer is the single best onboarding asset in the product and is only reachable from a `hide-sm`-labelled button and a footer link.

**Brand quick-action menu** — reachable by right-click/`Shift+F10` on the logo, with four actions. `SRC` it opens without moving focus into the menu (`useEffect` focuses the first item only when opened — verified), but there is no arrow-key menu model. `LIKELY` low traffic; leave as a power feature.

**Order details drawer** — the accessibility reference implementation. Keep as-is.

**Export confirmation dialog** — content is long but the situation warrants it; it inherits the missing focus trap from `ConfirmDialog`.

---

## 14. Legacy redirects and deep links

| Path | Behaviour | Assessment |
|---|---|---|
| `/flow?mode=…&q=…` | → `/account/transactions?…&scope=public` | Correct, preserves query (`lib/navigation.ts`). Good compatibility design — reuse this pattern in the redesign. |
| `/portfolio` | → `/account/api` | Works; the redirect target is arguably wrong (a user asking for "portfolio" wants Overview). `LIKELY` change to `/account`. |
| `/account/order-book` | → Orders section | Works; nav never links it. |
| Unknown paths | → `/` | Works, but silently — no "page not found" feedback. |

---

## Cross-page summary

| Rank | Problem | Pages affected | Evidence |
|---|---|---|---|
| 1 | Purpose and warnings stacked above the tool | `/`, `/compare`, `/zipper`, all account routes | SSR order analysis |
| 2 | Internal vocabulary in user copy (`MCP`, `apiEnv`, `SpotConfig`, `bookSeq`, `matchId`, `cursor`, `KDF`, `AEAD`, `get_heatmap`) | 9 of 17 | `SRC` grep + SSR |
| 3 | Repeated disclaimers (read-only ×6, "not executable" ×3, "not profit" ×4) | shell + 6 pages | `SRC` |
| 4 | Duplicate controls (symbol ×2, account nav ×2, depth ×2, ranking ×3) | 6 pages + shell | `SRC` |
| 5 | No primary action on 6 pages; on 4 pages the primary-looking action is configuration | `/book`, `/charts`, `/heatmap`, `/compare`, `/zipper`, `/sdk` | `SRC` |
| 6 | Mobile hides provenance and numeric columns instead of re-flowing | shell, `/book`, `/tape` | CSS `.hide-xs/.hide-sm` |
| 7 | Modal/nav focus management incomplete | shell, glossary, confirmations | `SRC` |
| 8 | No `<h1>`; heading levels start at 2 | all | `SRC` |
| 9 | Density cliff: 68 words (`/heatmap`) to 1,215 (`/brand-kit`) with no consistent template | 17 routes | SSR word counts |
| 10 | Single 595 kB JS chunk, 12 static page imports | shell | build output |
