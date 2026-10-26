# Design system and frontend quality audit

**Evidence:** all `SRC` (source/CSS) unless marked `SSR` (server render) or `LIKELY`. Nothing here is measured in a browser.

**Overall judgement:** the app already *has* a design system — one token block, one stylesheet, a coherent dark-first palette, and a small set of shared primitives. The problem is not the absence of a system; it is **partial adoption**. Pages reach past the primitives with inline styles and one-off markup, so the same concepts (metric tile, status pill, notice, table) render slightly differently on each page.

Recommendation: **extend and enforce the existing system**, not replace it.

---

## 1. Typography

### 1.1 What exists

| Role | Token | Size | Weight |
|---|---|---|---|
| Body | — | 13.5 px / 1.45 | 400 |
| Page title | `.page-header-info h2` | 24 px, −0.025em | 650 |
| Page description | `.page-header-desc` | 13.5 px, max 72ch | 400, secondary |
| Panel title | `.panel-title` / `.card h3` | 14.5 px | 650 |
| Panel subtitle | `.panel-subtitle` | 12.5 px | 400, muted |
| Metric value | `.metric-value` | 20 px mono, tabular | 650 |
| Metric label | `.metric-label` | 11.5 px | 500, muted |
| Metric sub | `.metric-sub` | 12 px | 400, secondary |
| Pill | `.pill` | 11.5 px | 600 |
| Nav item | `.nav-item` | 13.5 px | 500 |
| Nav group | `.nav-group` | 11 px | 600 |

### 1.2 Findings

| ID | Finding | Impact | Recommendation |
|---|---|---|---|
| DS-01 | **Six near-identical small sizes in active use:** 11, 11.5, 12, 12.5, 13, 13.5 px. Also inline `fontSize` overrides in `Layout.tsx` (11), `Dashboard.tsx` (11, 12), `Glossary.tsx` (10, 12, 12.5, 13, 16), `ui.tsx` (32), `Heatmap.tsx` (12) | The hierarchy reads as "everything is small", and the differences are below the just-noticeable threshold, so they cost effort without producing hierarchy | Collapse to a 5-step scale: **11 (micro label) / 12.5 (secondary) / 13.5 (body) / 15 (panel title) / 24 (page title) / 32 (hero number)**. Remove inline font sizes from page modules. |
| DS-02 | **Mono (`--mono`) carries both numbers and identifiers.** Prices, quantities, IDs, `ak_…` keys, canonical strings, and `raw ÷ 10³` are all mono | Numbers benefit from tabular mono; identifiers make the page feel like a terminal | Keep mono for numerics; use sans for identifiers unless the user must read character-by-character (`ak_…`, signature) |
| DS-03 | **No webfont is loaded** despite `Inter` and `JetBrains Mono` being first in the stacks | Typography differs per OS; the brand kit advertises Inter | Either ship Inter locally (adds weight; conflicts with the zero-external-dependency stance and the bundle budget) or drop Inter from the stack and document the system stack. **Decide, don't leave it implicit.** |
| DS-04 | `font-variant-numeric: tabular-nums` is applied to `.metric-value`, `.pill`, `.stat .value`, but **not** to table cells (`table.data td`), which is where live updates actually change digit counts | Live-updating prices in tables shift horizontally — a classic readability defect (`LIKELY`, needs browser confirmation) | Add `font-variant-numeric: tabular-nums` to `table.data` numeric cells and to `.mono` |
| DS-05 | Uppercase + letter-spacing is applied inconsistently: `.stat .label` uses `text-transform: uppercase`, `.metric-label` does not; `.nav-group` does not | Two "small label" conventions | Pick one (recommend sentence case everywhere; uppercase only for the `WALL`/`WHALE` inline tags) |
| DS-06 | `--text-muted` and `--text-faint` are used for real content (metric sublabels, captions, helper lines) at measured contrast 3.83:1 / 2.40:1 (dark) and 2.56:1 (light) | Meaningful text can be unreadable for low-vision users and in bright light | Introduce **text roles** (`--text-caption` ≥ 4.5:1, `--text-decoration` ≥ 3:1) and migrate `.faint` helper lines that carry meaning to `--text-secondary`. Do not simply recolor all semantic surfaces. |

---

## 2. Spacing and hierarchy

| ID | Finding | Evidence | Recommendation |
|---|---|---|---|
| DS-07 | Spacing tokens exist (`--space-1..6`) but are largely unused; pages set literal values (7.5, 9, 11, 15, 18, 20 px) | `styles.css`, inline styles | Adopt the tokens in new/edited rules; do not run a global find-replace |
| DS-08 | Every page is a `.page-stack` (gap 20 px) of: header → metrics → notices → toolbar → card(s) → secondary card(s). Pages with more notices simply get taller | `SSR` order analysis | Cap the header block at **one** notice; move the rest into details/status popovers |
| DS-09 | Metric strips take 190 px min per cell; four pages (`/book`, `/tape`, `/compare`, `/calc`) use 5 cells, which wraps to 3+2 at 1080 px and to 2+2+1 at 600 px, creating an uneven last row | `SRC` `grid-template-columns: repeat(auto-fit, minmax(190px, 1fr))` | Cap at 4 cells per strip (move the 5th into the panel header) so rows wrap evenly at 2 and 4 |
| DS-10 | `Card` is used for empty states (`<Card><EmptyState/></Card>`) producing a bordered 200 px panel containing one sentence | `SRC` several pages | Add a `Card variant="bare"` for empty/loading states |
| DS-11 | Visual hierarchy inverts on 5 pages: explanation text is above the numbers (Compare, Zipper, account sections, Hub diagnostics, SDK) | `SSR` | Header → numbers → tool → explanation-in-details |

---

## 3. Controls

| Control | Current | Problems | Recommendation |
|---|---|---|---|
| `.btn` | 12.5 px, 6×12 padding, radius 6 | Computed height ≈ 30 px; `.btn.sm` ≈ 27 px | Ensure ≥ 32 px height for primary actions on touch; ≥ 24 px is the WCAG 2.2 minimum and `.btn.sm` sits right at the edge |
| `.btn.primary` | Pink fill | Used for "Refresh now", "Load account data", "Trace Lifecycle", "Generate & Encrypt", "Sign Locally", "Import full history", "Open SDK Quickstart", "Sync Live Price" | **Primary is over-assigned.** On several pages 2–3 buttons are primary, so none is. Rule: one primary per view region |
| `.btn.ghost` | Transparent, subtle border | Reads as disabled next to `.btn` | Increase border contrast or use `--text-secondary` → `--text-primary` on hover only |
| `.btn.danger` | Used for "Retry" on connection failure, "Forget All", "Delete", "Retry" on cache | **"Retry" is styled as destructive** in the topbar and in `PublicCacheStatus` | Retry must be neutral; danger is for deletion only |
| `table.data th .th-sort-btn` | Transparent, colored when active | Discoverable only via `↕` glyph | Keep, and add a visible underline/`cursor: pointer` affordance |
| `.row-action-btn` | 11.5 px, 3×7 padding, muted | Computed height ≈ 25 px with ~2 px gaps — just above the 24 px WCAG 2.2 minimum but extremely dense; four per row × 19 rows = 76 small targets | Consolidate into one "Open" menu or make them ≥ 24 px with 8 px gap |
| `.star-btn` | 14 px glyph, 2×4 padding, `line-height: 1` | ≈ 18 px target — below the 24 px minimum | Expand hit area to 24×24 with negative margin so density is unchanged |
| `.seg-group` / `.seg-btn` | Used for 4 different semantics: mutually exclusive filter (timeframe), toggle (SMA), mode switch (Generate/Import), and navigation-ish (View All / Matched) | Same visual for different behaviours; only some have `aria-pressed` | Define two components: `SegmentedFilter` (`role="group"` + `aria-pressed`) and `TabSwitch` (`role="tablist"`, roving tabindex). Audit which is which |
| `.input` / `.select` | Same styling, 13 px, radius 6 | Selects in metric/toolbar contexts get inline `style={{ width: "auto" }}` overrides in 8 places | Add `.select.auto` |
| Labels | `.field` wraps `<label>` + control; some controls use `aria-label` only, some have visible labels, some have `<span className="faint">` stacked above a `<select>` inside a `<label>` | Inconsistent; `<label>` wrapping a `<select>` plus `aria-label` duplicates the name | Standardise: visible label above, no `aria-label` when a visible label exists |

`SSR` counts hint at the scale of the problem: `/calc` renders **14** form controls in 4 cards with 4 different presentation styles; `/account/api` renders 4 inputs plus 2 selects plus 5 buttons in four visually different groups; `/brand-kit` renders **78 buttons** including 15 token × 3 angle selectors.

---

## 4. Cards, panels and information density

| ID | Finding | Recommendation |
|---|---|---|
| DS-12 | `MetricStrip`/`MetricCell`, `.card.stat`, and ad-hoc `.kv` grids are three tile systems | Deprecate `.stat`; define `StatGrid` for key/value diagnostics so Hub/API setup stop hand-rolling `<div className="kv">` |
| DS-13 | Panels almost always have a subtitle. Many subtitles are methodology, not summary (e.g. "Total = trading + funding. Reserved and available are not added again.") | Make `Card subtitle` a one-line summary; add `Card footnote` for methodology that renders below content, or push to `details` |
| DS-14 | `flush` panels put tables edge-to-edge (good) but then re-add inline `style={{ border: "none", borderRadius: 0 }}` at call sites (Dashboard, Tape, Compare, account) | Move that reset into `.panel-flush .table-wrap` |
| DS-15 | Long pages have no section index: `/brand-kit` (6 sections), `/sdk` (6 cards), `/calc` (4 calculators) | Add a sticky in-page section nav (`role="navigation"`, anchors) at desktop; a `<select>` jump at mobile |

---

## 5. Tables and charts

**Tables**

- `table.data` headers are right-aligned by default with `align-left` opt-in, 11.5 px, muted, `nowrap`. Good for numeric tables; but `Heatmap`'s band table and several account tables use bare `<table>` (no `.data` class), so they inherit default browser styles — `SRC` `Heatmap.tsx` uses `<table>` inside `.table-wrap`.
- 21 `<table>` elements exist across the frontend (10 of them inside `AccountAnalytics.tsx` alone); 20 use `table.data` with headers that differ in alignment and count, and 1 (`Heatmap.tsx:481`) uses a bare `<table>` and therefore inherits browser defaults. **Recommendation:** one `DataTable` wrapper providing `caption`, sticky header, zebra rows, and numeric alignment.
- No table anywhere has `<caption>` except the balance-sample table, and no table uses `scope="col"` on headers. `SRC`.
- Horizontal overflow is handled by `.table-wrap { overflow-x: auto }` on most tables, but the Dashboard and Compare tables set `style={{ border: "none", borderRadius: 0 }}` on the wrapper — fine — while `Book`'s ladder is a CSS grid (not a table), so it is not scrollable, it *reflows* by hiding columns at 600 px.
- **Zero pagination everywhere**: `/tape` buffers 200 rows, Dashboard renders all 19 markets, Heatmap renders 36 bands, `/brand-kit` renders 45 images. On current data volumes this is fine; it is a scaling risk, not a current defect.

**Charts**

| Chart | Good | Missing |
|---|---|---|
| `CandleChart` | Keyboard ←/→ inspection, `tabIndex=0`, descriptive labels, SMA colour legend | No announced value change (no `aria-live`); no zoom/pan; no "as of" caption inside the SVG |
| `DepthChart` | Clear bid/ask fills, `role="img"` label | No textual summary; relies on the ladder below, which nothing states |
| Heatmap canvas | Fast, precise hover readout | Pointer-only inspection; no keyboard cell cursor; **no accessible name on the `<canvas>`** beyond `aria-label` on a non-semantic element; text inspector collapsed by default |
| `Sparkline` | Zero-dependency, `aria-hidden`, no extra requests | Shows literal text "1 tick" while collecting, which reads like a number without context |
| Balance history | Exact table in `<details>`, honest "chart geometry unavailable" fallback | y-axis has no values; x-axis has no labels |

**Recommendation:** a shared `ChartFrame` providing title, `as of` timestamp, legend, keyboard hint, and an "Exact values" disclosure. This is the single change that would most improve chart trustworthiness.

---

## 6. Status, freshness and notice vocabulary

Four visual tones exist (`notice` = warn-by-default, `.notice.warn`, `.notice.error`, `.notice.info`, `.notice.success` defined), but usage is inconsistent:

- A neutral safety notice (Hub "Testnet Safety Notice") uses bare `.notice`, which is **styled as a warning** — visually correct but semantically unlabelled, and it lacks `role`.
- Account compatibility warning uses `.notice.warn`; the "Section-scoped memory" notice uses `.notice.info`; both are equally persistent.
- `ErrorBox` uses `.notice.warn` for invalid input and `.notice.error` for transport errors, with an icon and `aria-live="polite"` — good.
- `Pill` kinds (`up/down/accent/warn/info`) are used for both *state* (Live, Locked, Unavailable) and *decoration* (Testnet, ENV, UTC Schedule). Same visual weight for different meanings.

**Recommendation**

1. Define notice semantics: `info` (neutral fact), `warning` (affects a decision), `error` (action failed), `success` (completed). Add `role="status"`/`role="alert"` by variant automatically.
2. Define pill semantics: state pills (with a dot), category pills (outline only, no fill), numeric deltas (up/down). Stop using filled accent pills for static labels like `ENV: PENDING`.
3. One freshness badge component (`Live` / `Cached · 3m` / `Out of date` / `Sample`), replacing the four current implementations.

---

## 7. Themes

- Dark is the default; light is complete (`[data-theme="light"]` defines all tokens).
- The theme is applied on `<html data-theme>` and mirrored by `class="dark"` in `index.html` — two attributes for one concept. `SRC` `index.html` has `class="dark" data-theme="dark"`; `store.tsx` sets only `data-theme`. `LIKELY` no visual effect, but it is dead state.
- No `prefers-color-scheme` default: a user with a light OS preference still gets dark until they toggle. `SRC` `loadInitialTheme()` returns `"dark"` when nothing is stored.
- Charts hard-code colours in places (`#38bdf8` for SMA7, `#f59e0b` for SMA25 in `Charts.tsx` inline styles) instead of tokens, so they do not adapt to the light theme. `SRC`.
- `--accent` is identical in both themes (`#fa2f6f`) while `--accent-text` differs; text on accent (`--btn primary: #fff`) is only checked against dark. Contrast on the light theme accent button is `UNK`.
- Forced-colors mode is not addressed. `UNK` behaviour.

**Recommendation:** respect `prefers-color-scheme` when no preference is stored; move the two chart colours to tokens (`--chart-series-1/2`); drop the duplicate `class="dark"`.

---

## 8. Loading, empty, error states and layout shift

| ID | Finding | Impact | Recommendation |
|---|---|---|---|
| DS-16 | Loading uses `Loading` (shimmer bars with varying widths) inside **table rows**, metric cells, and cards. Table-row skeletons have a different height than real rows | Layout shift when data arrives (`LIKELY`; the table row containing `<Loading lines={7}/>` is taller than a 1-row table) | Size skeletons to the real row height; render metric cells with the same padding and a placeholder value of `—` |
| DS-17 | Metric strips show `—` before data for some pages (Dashboard, Book) but `Loading` blocks for others (Heatmap) and nothing at all for others (Compare shows "Syncing…" in cells) | Three different "no data yet" behaviours | One rule: metric value = `—`, sublabel = state, with `aria-busy` on the strip |
| DS-18 | Error handling is duplicated: `ErrorBox` (pages) vs inline `notice error` (account, API setup, Calc) vs `localError` strings | Inconsistent recovery affordances (some have Retry, some don't) | Route all async failures through `ErrorBox`; keep account dataset errors as inline `DatasetMessages` because they are per-dataset |
| DS-19 | Account `localError` prefixes server codes: `"PERMISSION_DENIED: Your account key…"` | Codes leak into user copy | Show sentence; code in `title` |
| DS-20 | Empty states are wrapped in `Card` on 6 pages and rendered bare on others | Inconsistent vertical rhythm | `EmptyState` inside a `Card variant="bare"` everywhere |
| DS-21 | `WireSampleNotice` appears above the page header on every route once a sample was seen, pushing content down on first sample detection | Layout shift on first load in fallback environments | Reserve space or move it into the topbar as a persistent `Sample data` badge (the badge already exists) |

---

## 9. Dialogs and overlays

| Surface | Semantics | Focus trap | Restore focus | Background inert | Escape |
|---|---|---|---|---|---|
| `OrderDetailsDrawer` | `role="dialog" aria-modal aria-labelledby` | **yes** | **yes** | body scroll lock | yes |
| `ConfirmDialog` | `role="dialog" aria-modal aria-labelledby` (static id `confirm-dialog-title`) | **no** | **no** | no | yes |
| `GlossaryDrawer` | `role="dialog" aria-modal aria-labelledby` | **no** | **no** | no | yes |
| Mobile sidebar | `aside` + `aria-label` | **no** | **no** | no (also not `inert` when closed) | yes |
| Brand context menu | `role="group"` | n/a | yes (returns to trigger) | n/a | yes |

Two additional details: `ConfirmDialog` uses a hard-coded `id="confirm-dialog-title"`, so two dialogs on one page would collide (`SRC`; currently only one is open at a time, but `Portfolio` renders three `ConfirmDialog`s simultaneously in the DOM tree with `open` flags — the `id` is only emitted when open, so it is safe today but fragile). Use `useId()` like the drawer does.

**Recommendation:** extract `useDialogFocus()` from `OrderDetailsDrawer` into `lib/focus.ts`; apply to `ConfirmDialog`, `GlossaryDrawer`, and the mobile sidebar. Add `aria-hidden`/`inert` on the background. Add tests with `@testing-library`-style SSR assertions for attributes and a manual keyboard checklist.

---

## 10. Accessibility summary (source-level only)

**Present and good:** skip link, global `:focus-visible` 2 px accent outline, `prefers-reduced-motion` global disable, `aria-sort` on sortable headers, `aria-pressed` on toggles, `role="status"`/`role="alert"` in several places, `aria-live="polite"` on toast/import progress, 44 px account tabs, descriptive `aria-label`s on icon-only buttons, `<label htmlFor>` on most forms, keyboard chart inspection, per-row `aria-label`s on action buttons.

**Gaps, ranked:**

1. **No `<h1>`**; heading outline starts at 2 (`SRC`).
2. **Focus not trapped/restored** in two dialogs and the mobile nav (§9).
3. **Contrast below 4.5:1** on meaningful small text in both themes (`docs/audit/TEST_AND_VERIFICATION.md` measurements).
4. **Small targets**: `.row-action-btn` ≈ 20 px, `.star-btn` ≈ 18 px.
5. **Mobile hides content** (notional, match ID, provenance pill) rather than reflowing.
6. **Canvas heatmap has no keyboard access**; `role="img"` on the depth chart has no equivalent description inside its card.
7. **Icon-only buttons on mobile**: Glossary loses its label at ≤960 px; theme toggle is always icon-only with `aria-label` (fine) but no tooltip on touch.
8. **`aria-label` duplicating visible labels** on some wrapped `<label>` + `aria-label` controls.
9. **Live regions**: import progress updates a polite region every page; acceptable, but verify it does not announce on every poll.
10. **No `lang` change markers** for strings like `raw ÷ 10³`; minor.

Unverifiable here and required before any accessibility claim: real tab order, screen-reader announcement quality, zoom/reflow at 200–400 %, forced-colors, and touch accuracy.

---

## 11. Component reuse and duplication

| Duplication | Count | Recommendation |
|---|---|---|
| Hand-written `<table><thead>` blocks | 21 | `DataTable` with column definitions |
| `<div className="kv"><span className="k">…` diagnostic rows | 46 | `KeyValueList` |
| Inline-styled flex rows (`className="row-flex" style={…}`) | 57 | `.row-8`/`.row-tight` utility classes |
| `SymbolSelect` instances | 2 per market page | one |
| Page titles rendered twice (header + card) | 6 account sections | once |
| Freshness implementations | 4 | one |
| Notice call sites (`className="notice…"`) | 42 static + 2 dynamic (10 `warn`, 12 `info`, 6 `error`, 6 bare/`mt-2` variants) | notice variant + `details`; bare `.notice` currently renders as a warning without a variant |
| `.btn primary` call sites | 14 across the page modules | one primary per view region |
| `useNow` intervals | 1 s in several components on the same page (Tape, Countdown, DataFreshness, freshness) | consolidate to a single ticking context per page; each `useNow(1000)` is an independent `setInterval` re-rendering its subtree |

That last item is a real efficiency finding: `/tape` mounts `useNow(1000)` (page) plus `DataFreshness`'s own `useNow(1000)`, and `Layout` mounts `useNow(2000)` for the topbar. On `/hub` there is `useNow(1000)` in the page **and** another inside `Countdown`. `LIKELY` harmless at current scale, but it is a per-second re-render of the whole metric strip and tape header. Consolidating into one `NowProvider` is a small, contained improvement.

---

## 12. Network and rendering behaviour

| ID | Finding | Evidence | Recommendation |
|---|---|---|---|
| DS-22 | Every market page polls independently, and `Book`/`Charts`/`Calc` each additionally poll `/api/overview` on a second interval | `SRC` `usePollData(() => api.overview([symbol]), 4000…)` in Book, Charts, and the store also fetches overview for Dashboard | Share a symbol-scoped overview cache in the store; one poller serves all consumers |
| DS-23 | Symbol change triggers a full store update that re-renders every mounted consumer (context value is a new object each render) | `SRC` `store.tsx` `useMemo` dependency list | Split context into `data`/`actions`, or use `useSyncExternalStore` selectors |
| DS-24 | Watchlist toggling rewrites `localStorage` and re-renders the whole Dashboard table | `SRC` `toggleWatchlist` | Fine for 19 rows; note before scaling |
| DS-25 | `visibilitychange` in `AccountAnalytics` triggers `load(false)` on every tab refocus once activated | `SRC` `:906-913` | Correct behaviour, but with the broad `loadAll` this can issue several authenticated requests on each refocus. Confirm with the owner before changing (privacy/correctness sensitive) |
| DS-26 | No route-level code splitting: 12 static imports, one 595 kB chunk | fresh build output | `React.lazy` for `/brand-kit`, `/sdk`, `/heatmap`, `/calc` (the four heaviest, lowest-frequency areas) would cut the initial bundle materially with no behavioural change. **Measure first**: the current budget passes (595 kB ≤ 625 kB), so this is P2 |
| DS-27 | `sourcemap: true` in production build | `vite.config.ts` | Source maps ship publicly (2,029 kB map). Intentional? If not, a disclosure risk for source readers (not a security defect per se) |
| DS-28 | `img` elements in `SymBadge` use `loading="lazy"` with a `useState` `imgFailed` fallback per instance — 19 per Dashboard row set, 45 in brand kit | `SRC` `ui.tsx` | Fine; the fallback logic is duplicated per badge instance. Consider one preloaded sprite or a shared failure set |

---

## 13. What a design-consistency batch should and should not do

**Do**

1. Add the missing primitives (`DataTable`, `KeyValueList`, `FreshnessBadge`, `SegmentedFilter`/`TabSwitch`, `ChartFrame`, `useDialogFocus`).
2. Migrate one page at a time, keeping screenshots/SSR text snapshots as regression evidence.
3. Fix `tabular-nums`, the `<h1>`, and the three focus traps first — they are invisible in diffs and immediately felt.
4. Retire `.stat`, the duplicated symbol selector, and the duplicated account page titles.

**Do not**

1. Replace the stylesheet with a framework or a token generator. The current CSS is coherent and dependency-free; the cost is not justified by the audit evidence.
2. Run a global visual restyle. Every page has financial copy tied to layout decisions; change one context at a time.
3. "Fix" contrast by recolouring semantic colors globally — that would alter the meaning of up/down/warn.
4. Touch account state, custody, coverage gates, or P&L copy in a design batch.
