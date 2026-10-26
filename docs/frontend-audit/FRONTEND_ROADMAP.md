# Prioritized frontend improvement roadmap

Derived from the findings in `PAGE_BY_PAGE_AUDIT.md`, `TEXT_SIMPLIFICATION.md`, `NAVIGATION_REDESIGN.md`, `DESIGN_SYSTEM_AUDIT.md`, and `USER_JOURNEYS.md`.

**Nothing here is authorized.** This is a plan for owner review. Every task below is scoped to avoid changing: custody, authentication, encryption, account read permissions, R2 import coverage or cancellation semantics, R3 accounting gates, financial formulas, or the public/private data boundary.

**Complexity** = S (< 1 day, one or two files) · M (1–3 days, several files + tests) · L (> 3 days, cross-cutting, needs staged review).

---

## 0. How to read a task

Each task lists: problem and user impact · evidence (file + symbol) · change · benefit · complexity · regression risk · dependencies · acceptance criteria · suggested tests.

Test types correspond to what the repo already does (`tests/*.test.mjs` use `node:test` + `react-dom/server` + source assertions + `vite.ssrLoadModule`):

- **SSR** — render a route/component and assert visible text, heading count, control count, attributes.
- **SOURCE** — assert a route map / label table / absence of a banned term.
- **ROUTE** — render every path in `App.tsx` and assert it resolves to the expected component or redirect.
- **MANUAL** — must be done in a real browser; cannot be satisfied by this suite.

---

# P0 — Correctness, security, and misleading UX

## P0-1 — Mobile hides the data-provenance pill

**Problem / impact.** On screens ≤ 600 px the cached/stale metadata pill (`PublicCacheStatus`) is forced to `display: none` unless it is already stale or errored. A phone user viewing cached public metadata sees no indication that what they are looking at is a cached copy. Rule violated: *do not imply that stale market data is live.*
**Evidence.** `apps/web/src/components/PublicCacheStatus.tsx` — `className={\`pill ${stale || error ? "warn" : ""}${stale || error ? "" : " hide-xs"}\`}`; `apps/web/src/styles.css` `@media (max-width: 600px) { .hide-xs { display: none !important } }`.
**Change.** Never hide the provenance state. At ≤600 px render a compact badge with a dot and short label (`Cached 3m`, `Out of date`, `Sample`), and move the full sentence into the existing `title`/popover. This is the direction the upcoming `FreshnessBadge` (P2-1) formalises; P0-1 must not wait for it.
**Benefit.** Restores the trust signal exactly where space pressure currently deletes it.
**Complexity.** S.
**Regression risk.** Low. Visual density on mobile increases by ~70 px in the topbar; verify wrapping.
**Dependencies.** None.
**Acceptance criteria.** At 390 px width, cached public metadata always shows a visible state badge; no freshness/provenance element uses `.hide-xs`; stale and fresh states are visually distinguishable.
**Tests.** SOURCE: assert no `hide-xs` on any freshness/provenance element. SSR: `PublicCacheStatus` renders its label for `origin="persistent"`, `sample=false`, `stale=false`. MANUAL: 390 px, cached and stale variants.

## P0-2 — Closed mobile navigation remains in the tab order

**Problem / impact.** The off-canvas sidebar is hidden with a transform only. It is not `inert`, not `hidden`, not `aria-hidden`. Keyboard, switch-access, and screen-reader users can enter a menu they cannot see; screen readers announce 17 links that are visually absent. This breaks a mobile workflow and is a WCAG 2.4.3 / 1.3.2 concern.
**Evidence.** `apps/web/src/components/Layout.tsx` — `<aside className={\`sidebar ${navOpen ? "open" : ""}\`}>` with no `inert`; `apps/web/src/styles.css` `@media (max-width: 960px) { .sidebar { transform: translateX(-100%) } }`; `grep -r "inert" apps/web/src` → no matches.
**Change.** Apply `inert` (and `aria-hidden` fallback) to the sidebar when closed at mobile widths; move focus to the first nav item on open; return focus to the burger on close and on Escape. Keep the desktop behaviour identical (the panel is not off-canvas above 960 px).
**Benefit.** Removes an invisible focus trap and an SR dead zone.
**Complexity.** S.
**Regression risk.** Low–medium: `inert` support must be confirmed in the target browsers, and the open/close effects must not run at desktop widths.
**Dependencies.** Shares the focus utility with P1-7.
**Acceptance criteria.** When closed, no sidebar link is focusable; when opened by keyboard, focus lands inside the panel; Escape and backdrop click return focus to the burger; desktop layout unchanged.
**Tests.** MANUAL (authoritative) — keyboard tab sweep at 390 px and 1280 px. SSR/SOURCE: assert the `inert` attribute is conditioned on `navOpen` and viewport state does not leak into SSR.

## P0-3 — Account "Load" label does not describe the private reads it performs

**Problem / impact.** Each section's button says "Load your trades" / "Load your orders" / "Load P&L inputs", but one click performs the same broad set of authenticated reads: official spot catalog, balances, equity, fee rates, balance history, open orders, and the section dataset. A user consenting to "trades" is also fetching balances and fee tiers. That is a consent/expectation mismatch on private data.
**Evidence.** `apps/web/src/components/AccountAnalytics.tsx` — `loadLabel`, `load()` calling `account.fetchOfficialSpotCatalog`, `coordinator.loadAll`, `coordinator.loadBalanceHistory`, `coordinator.loadOpenOrders`; `apps/web/src/pages/Portfolio.tsx` `ACCOUNT_HEADERS` promises section-specific scope. Historical: `docs/audit/UX_AUDIT.md` UX-A1 (still current).
**Change (two acceptable options, owner decides):**
- **(a) Copy-only, safe:** one label everywhere — `Load account data` — plus one line: "This loads balances, trades, orders, and fees. Nothing loads until you press it."
- **(b) Behavioural, larger:** make each section request only its own dataset. **This changes authenticated request behavior and must be reviewed separately, with failure-independence tests.**
Recommend (a) in the first batch; treat (b) as its own project.
**Benefit.** Honest consent, fewer "why did my balances load?" moments.
**Complexity.** S (a) / L (b).
**Regression risk.** (a) Low. (b) High — touches account reads; explicitly out of scope for the first batch.
**Dependencies.** None for (a).
**Acceptance criteria.** (a) All five account sections show the same Load label and an explicit statement of what it loads; no label implies a narrower scope than the request performs.
**Tests.** SSR: assert identical button label across `overview|trades|orders|pnl|transfers`. SOURCE: assert the label constant is shared, not derived per view.

## P0-4 — SDK page offers copy-paste order code with no mutation warning and no input validation

**Problem / impact.** The generator interpolates quantity, price, and key ID into runnable snippets, formats live price with `toFixed(2)` regardless of tick size, and does not state that executing the snippet places (and then attempts to cancel) a real testnet order. A beginner can copy code that mutates exchange state without an in-product warning.
**Evidence.** `apps/web/src/pages/SdkGuide.tsx` — `generatedCode`, `syncLivePriceToOrder`, `subtitle` ("…ready-to-run code updates automatically"); historical `docs/audit/UX_AUDIT.md` UX-P7 (still current).
**Change.** Add one prominent, always-visible line above the generator: "PolyTools does not run this code. Running it places real orders on testnet." Validate qty/price against the selected pair's `stepSize`/`tickSize`/minimums before rendering the snippet, and show a disabled state with the reason when invalid.
**Benefit.** Prevents an accidental real (testnet) order; makes the page trustworthy for its stated audience.
**Complexity.** M.
**Regression risk.** Medium — code-string generation is asserted in existing tests; snapshots will need updating.
**Dependencies.** Pair metadata is already available from `useApp()`.
**Acceptance criteria.** The warning is visible without scrolling on desktop and mobile; invalid qty/price cannot produce a snippet; generated snippets never show more decimal places than the pair allows.
**Tests.** SSR: warning text present; generator renders a disabled state for an out-of-tick price. SOURCE: assert no `toFixed(2)` for symbol prices. MANUAL: copy a snippet and confirm the visible values match pair constraints.

## P0-5 — `/portfolio` redirects to the wrong destination

**Problem / impact.** A user arriving at `/portfolio` (a natural guess, and a historical alias) lands on **API setup**, not the account overview. Wrong destination for an obvious URL.
**Evidence.** `apps/web/src/App.tsx` — `<Route path="portfolio" element={<AccountRedirect to="/account/api" />} />`.
**Change.** Redirect to `/account` (Overview). Keep `/account/api` reachable through the existing tabs.
**Benefit.** Correct landing for a predictable URL; no navigation cost.
**Complexity.** S (one line + one test).
**Regression risk.** Very low. Only affects users who bookmarked the alias.
**Dependencies.** None.
**Acceptance criteria.** `/portfolio` renders the Overview section; `/account/api` still renders API setup.
**Tests.** ROUTE: render `/portfolio` with `MemoryRouter`, assert the Overview header and absence of the key-creation card.

---

# P1 — High-impact simplification

## P1-1 — Simplify navigation to 9 visible items with a collapsed "Learn & developers" group

**Problem.** 17 flat items, a one-item group, and six account items duplicated between sidebar and tabs. New users have no entry point; the first group requires a key.
**Evidence.** `apps/web/src/components/Layout.tsx` `NAV_GROUPS`; `apps/web/src/pages/Portfolio.tsx` `ACCOUNT_TABS`; `CURRENT_FRONTEND.md` §2.2.
**Change.** Implement §2 of `NAVIGATION_REDESIGN.md`: `Markets`, `Compare prices`, `Order book`, `Trades`, `Price chart`, `Depth heatmap`, `Calculators`, `Bridge routes`, `My account`, plus a collapsible `Learn & developers` (Start on testnet / Developers: SDK / Brand kit) and "Brand kit" also in the footer. No route changes.
**Benefit.** Faster scanning, clearer beginner path, less duplicated chrome; frees horizontal space at 960–1200 px.
**Complexity.** M.
**Regression risk.** Medium — all routes must still resolve; active-state logic (`end` prop on `/` and `/account`) must be preserved.
**Dependencies.** P1-3 (labels) should land together or just before.
**Acceptance criteria.** ≤10 visible rail items at ≥960 px; no single-item group; the six account sections appear only in the tab strip; every route in §4 of the redesign doc still resolves.
**Tests.** ROUTE for all 17 paths + 3 aliases. SSR: count nav links in `Layout`. SOURCE: assert no route path was deleted from `App.tsx`.

## P1-2 — One symbol selector per screen

**Problem.** Market pages render two identical `<select>`s bound to the same store; on mobile one of them squeezes the topbar.
**Evidence.** `apps/web/src/components/Layout.tsx` (`ROUTE_META.showSymbolSelector`) plus `SymbolSelect` inside `Book.tsx`, `Tape.tsx`, `Charts.tsx`, `Heatmap.tsx`, `Calc.tsx`, `SdkGuide.tsx`.
**Change.** Keep the topbar selector; remove page-level duplicates; where a page needs it inline (Heatmap toolbar), render it once and hide the topbar copy for that route via route meta.
**Benefit.** Removes a "which dropdown?" moment and ~150 px of duplicated chrome.
**Complexity.** S.
**Regression risk.** Low; symbol state is already global. Check that no test asserts the page-level selector.
**Acceptance criteria.** Exactly one `select[aria-label*="symbol" i]` per market route at any width.
**Tests.** SSR: count symbol selects per route. MANUAL: change symbol from the remaining control and confirm all panels follow.

## P1-3 — One heading per page; `<h1>` for page titles; plain nav labels

**Problem.** Account pages render their title twice with two different subtitles; the app has no `<h1>`; several nav/page titles use internal or marketing names.
**Evidence.** `Portfolio.tsx:407` + `AccountAnalytics.tsx:955`; `grep "<h1"` empty; `TEXT_SIMPLIFICATION.md` §1–§2.
**Change.** Make `PageHeader`'s title an `<h1>` (same visual), demote panel titles to `<h2>`, delete the `AccountAnalytics` `Card` title/subtitle, apply the approved title/subtitle batch from `TEXT_SIMPLIFICATION.md`.
**Benefit.** Clear hierarchy for all users and a usable heading outline for AT; removes duplicated reading.
**Complexity.** S.
**Regression risk.** Low; several existing tests assert exact copy and will need deliberate updates.
**Acceptance criteria.** Every route has exactly one `<h1>`; no route renders the same title twice; no banned term (`MCP`, `apiEnv`, `bookSeq`, `matchId`, `get_heatmap`, `SpotConfig`, `cursor`) appears in primary UI text.
**Tests.** SSR: one `h1` per route. SOURCE: banned-term scan over page modules. MANUAL: heading navigation in a screen reader.

## P1-4 — Dashboard: purpose first, prices immediately

**Problem.** The landing page leads with an intro banner, a feature-list subtitle, and four empty metric cells before any price.
**Evidence.** `Dashboard.tsx:303` (subtitle), `Layout.tsx:461` (intro bar renders on every route), `SSR` metric cells `—`.
**Change.** Move the intro out of `<main>` above content (into the sidebar or a first-visit `Dashboard`-only strip), replace the subtitle, hide the metric strip until the first response (or render skeleton cells at final size), and label the CSV action "Download CSV".
**Benefit.** Fastest possible time-to-first-price on the page every user sees first.
**Complexity.** S–M.
**Regression risk.** Low; the intro dismissal flag must keep working.
**Acceptance criteria.** First price row is visible without scrolling at 1280×800 and 390×844; the page shows at most one notice; the intro never appears above another route's content.
**Tests.** SSR: intro not rendered when `localStorage` flag is `dismissed`; metric cells not rendered before data. MANUAL: first-render screenshot at both sizes.

## P1-5 — Tape: trades first, alert setup collapsed

**Problem.** Configuration sits above the trade list, so the destination of the click is below the fold.
**Evidence.** `Tape.tsx:360-460` (alert card) precedes the "Time & Sales" card at `:462`.
**Change.** Reorder: header → metric strip → tape → collapsible "Alerts" panel (summary line: "Alerts off · size ≥ 10.00K USDT"). Keep the sound/notification toggles and test action inside.
**Benefit.** The page delivers what its name promises immediately.
**Complexity.** S.
**Regression risk.** Low; alert logic untouched.
**Acceptance criteria.** A trade row is visible without scrolling at 1280×800; alert controls remain reachable in one click and keep their `aria-pressed` state.
**Tests.** SSR: alert controls appear after the tape in DOM order. MANUAL: alerts still fire (sound/notification) after reordering.

## P1-6 — Account pages: replace the two always-on warnings with a status line + disclosure

**Problem.** Every account section shows two paragraphs of internals before the Load button, on all six sections, every visit. Users learn to skip warnings; the ones that matter (explicit consent, unverified compatibility) lose force.
**Evidence.** `AccountAnalytics.tsx:965-985` (both notices); `SSR` 2 notices per account route; also the 5-cell `kv` diagnostics grid at `:987-995`.
**Change.** One status line under the header: e.g. `Connection: locked · reads not verified on this device` + a `What this means` disclosure containing both current paragraphs **verbatim**. Replace the 5-cell grid with 2 status items and move the rest into Developer details. Show the "leaving clears loaded data" warning contextually on navigation (P1-8).
**Benefit.** Cuts 5 pre-data blocks to 2 without losing a single word of the caveats.
**Complexity.** M.
**Regression risk.** Medium — the caveats must remain word-for-word available; existing SSR copy tests will fail and need deliberate updates. Do not weaken any statement.
**Acceptance criteria.** No account section shows more than one notice before its primary action; every sentence of the current warnings is still present in the disclosure; lock/wipe/import behaviour unchanged.
**Tests.** SSR: one notice before the primary action; disclosure contains the exact historical sentences. MANUAL: open the disclosure at 390 px and confirm it does not clip.

## P1-7 — Shared focus management for dialogs and navigation

**Problem.** `ConfirmDialog` and `GlossaryDrawer` declare `aria-modal="true"` but neither traps focus nor restores it; background content is not inert.
**Evidence.** `ui.tsx:415-460`, `Glossary.tsx:150-215`; contrast with the correct implementation in `AccountAnalytics.tsx:430-470`.
**Change.** Extract `useDialogFocus()` from `OrderDetailsDrawer`; apply to both dialogs and the mobile sidebar (with P0-2). Use `useId()` instead of the hard-coded `confirm-dialog-title`.
**Benefit.** Correct modal behaviour across the app from one utility.
**Complexity.** S.
**Regression risk.** Low–medium; test Escape, backdrop click, nested overlays (export dialog inside account, glossary over account).
**Dependencies.** P0-2.
**Acceptance criteria.** Tab cycles inside open dialogs; focus returns to the opener; the background is not reachable; duplicate `id` cannot occur.
**Tests.** MANUAL (authoritative). SSR: `aria-labelledby` id is unique per render. SOURCE: assert all three surfaces use the shared hook.

## P1-8 — Warn before leaving account work

**Problem.** Switching account sections silently discards loaded snapshots, cursor imports, and manual P&L inputs. The only warning is a paragraph shown before the user has anything to lose.
**Evidence.** `AccountAnalytics.tsx` unmount/disposal on `view` change; `Portfolio.tsx` conditional mounts; historical `docs/audit/UX_AUDIT.md` UX-A2 (still current).
**Change.** When leaving a section with loaded or unsaved data, show the existing `ConfirmDialog`: "Leaving this section clears what you loaded. Continue?" Keep disposal behaviour unchanged.
**Benefit.** Prevents repeated long imports being lost by a stray click.
**Complexity.** S–M.
**Regression risk.** Medium — must not trap the user in a loop or block "Lock"/"Forget all" flows; must not persist private data.
**Acceptance criteria.** No prompt when nothing is loaded; prompt appears once per navigation attempt; confirming disposes exactly as today; no new storage.
**Tests.** SOURCE: assert disposal path unchanged. MANUAL: import → navigate → cancel/confirm.

## P1-9 — Copy batch B (public pages): titles, subtitles, buttons, statuses

**Problem.** 1,712 characters of page subtitles across 11 public pages, plus internal vocabulary in buttons and status labels.
**Evidence.** `TEXT_SIMPLIFICATION.md` §2–§6, §9 (excluding rows marked High risk).
**Change.** Apply the Low- and Medium-risk rows for public routes only.
**Benefit.** The single largest comprehension win per unit of code change; no logic touched.
**Complexity.** S.
**Regression risk.** Low, but many existing tests assert exact copy — update them deliberately, one commit per page group.
**Acceptance criteria.** No public page subtitle exceeds 120 characters; no banned term in public UI text; each limitation is stated once per page; units and warnings preserved.
**Tests.** SSR copy assertions per route (new, deliberate). SOURCE: banned-term scan; subtitle length assertion.

## P1-10 — Money Movements: make the public/private choice a real switch

**Problem.** A "choose a view" card, a notice repeating the page subtitle, and two buttons duplicate the same decision; deep links depend on `?scope=public` working.
**Evidence.** `Portfolio.tsx:121-140` (`AccountTransactions`), `App.tsx` `/flow` redirect, `lib/navigation.ts`.
**Change.** Two tabs (`My account` / `Public lookup`) with one-line descriptions; drop the duplicated notice; keep the `?scope=public` contract and `/flow` redirect byte-for-byte.
**Benefit.** One decision, one control; preserves the historical deep-link fix.
**Complexity.** S.
**Regression risk.** Low; URL contract is the risk — test it.
**Acceptance criteria.** `?scope=public` selects public lookup on first render; `/flow?...` still redirects with the query preserved; only one notice per scope.
**Tests.** ROUTE: `/flow?mode=tx&q=0x…` resolves to public lookup with params intact.

## P1-11 — Glossary discoverability

**Problem.** The best beginner asset in the product is a `hide-sm`-labelled button and a footer link.
**Evidence.** `Layout.tsx` Glossary button with `<span className="hide-sm">Glossary</span>`; `Glossary.tsx`.
**Change.** Keep the label at all widths (icon + label, or icon + `aria-label` plus a visible "?" affordance), link glossary terms from the `TermTip` popovers, and add a one-time pointer from the Dashboard header.
**Benefit.** Lowers the literacy barrier without adding a page.
**Complexity.** S.
**Regression risk.** Low; drawer already works.
**Acceptance criteria.** Glossary is reachable with a visible label at 390 px; opening it does not change route; terms opened from a tooltip return focus to that term (depends on P1-7).
**Tests.** SSR: Glossary button label present at all widths. MANUAL: focus return.

## P1-12 — Account tab labels must fit a phone

**Problem.** Six long labels in a horizontally scrolling strip; only two or three are visible at 390 px with no affordance that more exist.
**Evidence.** `Portfolio.tsx` `ACCOUNT_TABS`; `styles.css` `.account-tabs { overflow-x: auto }`.
**Change.** Adopt the shorter labels from `TEXT_SIMPLIFICATION.md` §1 and add a subtle edge fade / scroll cue. Do not change routes.
**Benefit.** Five of six tabs visible; users discover the sixth.
**Complexity.** S.
**Regression risk.** Very low.
**Acceptance criteria.** At 390 px, at least five tabs are visible; the active tab is always scrolled into view.
**Tests.** MANUAL. SSR: label list matches the approved set.

## P1-13 — Accessible text-token contrast for meaningful small text

**Problem.** Meaningful small text uses tokens measured below 4.5:1 (dark `muted` 3.83:1, dark `faint` 2.40:1, light `faint` 2.56:1, light `up` 3.77:1, light `warn` 3.19:1).
**Evidence.** `styles.css` tokens; measurements recorded in `docs/audit/TEST_AND_VERIFICATION.md`; `A11Y-2` still open.
**Change.** Introduce text *roles* (`--text-caption`, `--text-decorative`) and migrate meaning-carrying `.faint`/`muted` usages (metric sublabels, dataset footnotes, table captions) to a ≥4.5:1 token in both themes. Do not globally recolour semantic surfaces.
**Benefit.** Readability for low-vision users and in daylight; no change to up/down semantics beyond contrast.
**Complexity.** M.
**Regression risk.** Medium — the whole visual tone shifts slightly; needs owner sign-off on the new values.
**Acceptance criteria.** Every text role used for meaning passes 4.5:1 in both themes (deterministic calculation); decorative borders remain ≥3:1 where they convey state.
**Tests.** A contrast calculation script over the token table (extend `scripts/check-*.mjs`). MANUAL: visual review in both themes.

---

# P2 — Design polish, consistency, performance

| ID | Task | Problem + evidence | Change | Benefit | Complexity | Risk | Acceptance | Tests |
|---|---|---|---|---|---|---|---|---|
| P2-1 | **One `FreshnessBadge`** | Four implementations (`DataFreshness`, `PublicCacheStatus`, topbar pill, `WireSampleNotice`) with four vocabularies | Single component: `Live · 2s`, `Cached · 3m`, `Out of date`, `Sample`, with a details popover (store, timestamps, interval) | One mental model; removes ~120 lines of duplication | M | Medium — every page header changes | All pages use it; no page has two freshness indicators | SSR per route; SOURCE: no other freshness component imported |
| P2-2 | **`DataTable` wrapper** | 9 hand-written tables, 4 header treatments, missing `scope`/`caption`, one table not using `.data` at all (`Heatmap.tsx`) | Shared wrapper: caption, sticky header, numeric alignment, `scope="col"`, overflow container | Consistency + accessibility for free | M | Medium — touches dense markup | All tables render through `DataTable`; each has a caption | SSR: table count, `scope` attributes |
| P2-3 | **`ChartFrame` + heatmap keyboard** | Charts lack "as of", legend, keyboard hint, exact-values link; heatmap is pointer-only | Wrapper with title/timestamp/legend/hint/details; add arrow-key cell cursor + `tabIndex` to the heatmap, reusing the candle pattern | Charts become trustworthy and operable | M | Medium | Heatmap cells reachable by keyboard; every chart has an "as of" line | MANUAL keyboard sweep; SSR: `aria-label`/`tabIndex` |
| P2-4 | **Loading and empty-state consistency** | `Loading` inside table rows changes height; three "no data yet" behaviours; `Card`-wrapped empty states | Skeleton sized to real rows; metric cells always `—` + state; `EmptyState` in `Card variant="bare"` | Removes layout shift on every load | S–M | Low | No visible shift between skeleton and data at 1280/390 px | MANUAL (CLS); SSR: consistent markup |
| P2-5 | **Share the symbol overview poller** | `Book`, `Charts`, `Calc` each poll `/api/overview` on their own interval; store also fetches overview | One symbol-scoped overview cache in the store, consumed by all | Fewer requests, one source of truth for "last price" across a page | M | Medium — store change touches every consumer | Exactly one overview request per interval per open page | SOURCE: single call site; MANUAL: network panel |
| P2-6 | **Route-level code splitting** | Single 595 kB chunk, 12 static page imports | `React.lazy` for `/brand-kit`, `/sdk`, `/heatmap`, `/calc` behind the existing `Suspense`-less router (add a minimal fallback) | Smaller first load; the four heaviest low-frequency pages leave the critical path | M | Medium — router restructure; must not break hash links | Initial JS below the current 595 kB and within the existing performance budget; all routes still render | `check:performance`; ROUTE tests for lazy paths |
| P2-7 | **Cap metric strips at 4 cells** | 5-cell strips wrap unevenly (`Book`, `Compare`) | Move the 5th value into the adjacent panel header | Even rows at every breakpoint | S | Low | No strip has an orphan cell at 1080/600 px | MANUAL |
| P2-8 | **Notice and pill semantics** | Filled accent pills used for static labels (`ENV: PENDING`, `UTC Schedule`); bare `.notice` is warn-styled but unlabelled | Define 4 notice variants with matching roles; separate *state* pills (dot) from *category* pills (outline) | Status colouring becomes meaningful again | M | Medium | Every notice has a variant + role; no static label uses a filled accent pill | SOURCE: class/role audit |
| P2-9 | **Tabular numerals + table alignment everywhere** | `table.data td` lacks `tabular-nums`; headers right-aligned by default with opt-in left | Add `font-variant-numeric: tabular-nums` to numeric cells and `.mono`; document alignment convention | Stops live values shifting | S | Low | Column widths stable across a value change | MANUAL |
| P2-10 | **Theme polish** | Duplicate `class="dark"` + `data-theme`; no `prefers-color-scheme` default; two chart colours hard-coded | Remove the duplicate attribute, default to the OS preference when unset, move chart colours to tokens | Fewer flashes, correct light-theme charts | S | Low | No theme flash on load; SMA colours adapt | MANUAL |
| P2-11 | **In-page section nav for long pages** | `/brand-kit` (6 sections, 1,215 words), `/sdk` (6 cards), `/calc` (4 calculators) | Sticky section index at desktop, jump `<select>` at mobile | Navigation inside long pages | S–M | Low | Every section is reachable in one click | MANUAL; SSR: anchors exist |
| P2-12 | **Real 404 state** | `*` silently redirects to `/` | "We couldn't find that page" with links to Markets and Glossary | Broken links become visible | S | Low | Unknown hash shows the 404 state, not the dashboard | ROUTE: unknown path |

---

# P3 — Optional enhancements

| ID | Task | Why optional | Complexity |
|---|---|---|---|
| P3-1 | **Recent routes / resume** (`poly-tools:recent`, max 3, public routes only) | Genuinely useful on mobile, but a new persistence key and a UX preference decision | S |
| P3-2 | **Search / command palette** | Adds a dependency or a custom modal; the nav fix should come first and may remove the need | M |
| P3-3 | **Onboarding refinements** (guided first-run on `/` + `/hub`, progress tied to actual actions) | Nice, not required; risks adding the very text we are removing | M |
| P3-4 | **Micro-interactions** (price flash tuning, row hover, chart crosshair polish) | Cosmetic; the app already animates carefully and honours reduced motion | S |
| P3-5 | **Density preference** (comfortable / compact) | Only valuable once the type scale is consolidated (P2-9) | M |
| P3-6 | **SDK matrix accuracy** (Go column has no quickstart) | Content completeness for developers | S |

---

# Quick wins vs architectural change

## Quick wins — low risk, ≤ 1 day each, ship in the first batch

1. `<h1>` for page titles + demote panel titles (P1-3 part 1).
2. Remove the duplicated account `Card` title/subtitle (P1-3 part 2).
3. Remove page-level duplicate symbol selectors (P1-2).
4. Public-page copy batch: titles, subtitles, buttons, statuses (P1-9).
5. `/portfolio` → `/account` (P0-5).
6. "Retry" must not be styled as a destructive action (`.btn.danger` → neutral).
7. Never hide the provenance pill (P0-1).
8. `tabular-nums` on table cells (P2-9).
9. Remove the `PageHeader` eyebrow that repeats the topbar (part of P1-9).
10. Account tab labels (P1-12).
11. Remove `MCP`/`apiEnv`/`bookSeq`/`matchId` from primary UI text (part of P1-9).
12. `inert` + focus return for the closed mobile sidebar (P0-2) — small code, needs a manual keyboard check.

## Architectural changes — need staged review

1. Navigation restructuring (P1-1) — touches every route's first impression.
2. Account pre-data block consolidation (P1-6) — every caveat must survive.
3. Account load scoping (P0-3 option b) — authenticated request behaviour.
4. One freshness system (P2-1) — replaces four components.
5. Shared overview poller + context split (P2-5) — data-flow change.
6. Code splitting (P2-6) — router and bundle change.
7. Contrast token migration (P1-13) — whole-app visual change.
8. `DataTable` / `ChartFrame` adoption (P2-2, P2-3) — dense markup across 9 tables and 5 charts.

---

# Recommended first safe implementation batch

**Scope:** presentation only. No behaviour, no requests, no storage, no accounting, no custody.

| Step | Task | Files | Why it is safe |
|---|---|---|---|
| 1 | `<h1>` semantics + one heading per page (P1-3 part 1–2) | `ui.tsx`, `AccountAnalytics.tsx`, `styles.css` | Attribute/level changes only |
| 2 | Remove duplicate symbol selectors (P1-2) | `Book/Tape/Charts/Heatmap/Calc/SdkGuide.tsx` | Same store, one fewer control |
| 3 | Public copy batch (P1-9) with tests updated deliberately | 11 page modules | Text only; no numbers, units, or gate logic |
| 4 | Provenance never hidden (P0-1) | `PublicCacheStatus.tsx`, `styles.css` | Restores an existing signal |
| 5 | `/portfolio` → `/account` (P0-5) | `App.tsx` | One line |
| 6 | Retry is neutral, not danger (P2-8 part) | `Layout.tsx`, `PublicCacheStatus.tsx` | Styling only |
| 7 | `tabular-nums` on table cells (P2-9) | `styles.css` | Typography only |

**Batch 1 definition of done**

- `npm test`, `npm run typecheck`, `npm run build`, `npm run check:performance` all pass.
- New SSR assertions: one `<h1>` per route; one symbol selector per market route; no banned terms; subtitle length limits.
- A manual browser pass at 390/768/1280 px for: `/`, `/book`, `/tape`, `/account`, `/account/api`, `/account/trade` (record what was checked; this is the only way to earn "browser-confirmed").
- No change to any file under `packages/core/` or `backend/`.
- No new dependency.

**Deliberately excluded from batch 1:** navigation restructuring, account notice consolidation, account load scoping, the SDK mutation warning, contrast token migration, code splitting. Each needs either an owner decision or a browser verification loop that does not exist yet in this environment.

## Status after the owner-approved batch 1 (2026-10-26)

The owner approved an eight-item batch, five adjustments, and moved two tasks into it that this table did not list (the SDK mutation warning and the mobile drawer focus contract). Implementation detail, measurements, and the outstanding browser pass live in `BATCH1_IMPLEMENTATION.md`.

| Item | Roadmap task | Code | Automated checks | Browser-confirmed |
|---|---|---|---|---|
| 1 | P0-4 (warning half only; input validation stays separate) | done | source + SSR guard | n/a (copy) |
| 2 | P1-3 heading part | done | SSR: one `h1`, no `h1` in cards, no page-level `h1` | **pending** |
| 3 | P1-2 symbol selector | done | SOURCE: shell only | **pending** |
| 4 | P1-9 public copy batch | done | SSR: banned-term and retained-meaning guards | **pending** |
| 5 | P0-1 provenance on mobile | done | SSR: no `hide-xs`, store + age present | **pending** |
| 6 | P0-5 `/portfolio` redirect | done | SOURCE + helper unit check | **pending** |
| 7 | P2-8 retry styling, P2-9 numeric alignment | done | SOURCE: no `danger` retry, no `Retry now`; CSS: `tabular-nums` | **pending** |
| 8 | P0-2 closed navigation in the tab order (extended to the full focus contract) | done | SOURCE + CSS: `inert` only for `mobileNav && !navOpen`, off-canvas rule confined to the ≤960 px block | **required — this is the item that cannot be closed any other way** |

Batch-1 definition of done, as it stands:

- `npm test` 217/217, `npm run typecheck`, `npm run build`, `npm run check:performance`, `npm run check:whitespace` — all pass.
- New assertions exist (`tests/frontend-batch1.test.mjs`, 18 assertions) covering the five SSR-style checks the table asked for, plus source and stylesheet guards for the drawer.
- **The manual pass at 390/768/1280 px has not been done.** No browser was available, so no item is "browser-confirmed", and nothing in the tree claims otherwise.
- No change to any file under `packages/core/` or `backend/`; no new dependency; `docs/audit/` untouched.

Two things the pass must also look at, found while implementing item 8 and item 5 but deliberately not changed:

1. At ≤960 px the drawer is `position: fixed` with `height: 100vh` **and** `top: 0; bottom: 0`. On mobile browsers with a collapsing toolbar, `100vh` can exceed the visible viewport, so the last nav item may sit under browser chrome. Fixing it means choosing between `height: auto` and `100dvh`, which needs a real device/browser check.
2. The drawer does not lock background scrolling the way `OrderDetailsDrawer` does. Harmless at 390 px, but a scroll behind the backdrop is possible.

Still open from P0/P1 after this batch: P0-4 input validation and tick-size handling, P1-1 navigation restructuring, P1-6 account notice consolidation, P1-7 shared dialog focus management (`ConfirmDialog`, `GlossaryDrawer`), P1-8 unsaved-account-work warning, P1-11 glossary discoverability, P1-13 contrast tokens.

---

# Guardrails — do not do these while implementing any of the above

1. Do not remove or weaken: "testnet only / never send real funds", "not tax reporting", "not investment advice", "account reads not verified", "passphrase cannot be recovered", "export contains private data", "sample data" provenance.
2. Do not change `docs/audit/` files; add findings to this package instead.
3. Do not persist private account data, expand the public cache to private data, or add polling.
4. Do not change R2 import coverage/cancellation semantics or R3 gate logic to make the UI simpler.
5. Do not rename `reserved`/`available`/`realized`/`unrealized` or any financial label whose meaning is contractual.
6. Do not introduce a design-system dependency; extend `ui.tsx` and `styles.css`.
7. Do not claim browser or accessibility verification in any commit message, PR, or document unless a real browser/screen-reader pass was recorded.
