# Batch 1 implementation record

Status: **implemented and mechanically verified; browser verification still outstanding.**
Branch: `arena/793e90ca-polytools` (uncommitted working tree).
Base commit: `62a7518b2ccdbb7ddf5610ac83db78d41af46427`.
Source of the work: `docs/frontend-audit/` plus the owner's five adjustments.

This file is the bridge between "the code changed" and "a person has looked at it".
Nothing below claims visual or assistive-technology verification.

---

## 1. What shipped

| # | Batch item | Files | What changed |
|---|------------|-------|--------------|
| 1 | SDK testnet-order warning | `pages/SdkGuide.tsx` | Always-visible `notice warn` above the first snippet card: "PolyTools does not run this code." States that the order examples place real testnet orders and may cancel them, and that nothing executes on the user's behalf. |
| 2 | One page heading, no duplicate titles | `components/ui.tsx`, `components/Layout.tsx`, `styles.css`, all 13 page modules | `PageHeader` renders the page title as `<h1>`; the static `Read-only · Testnet` eyebrow is gone (badges still render when a page passes one); `Card` panel titles are `<h2>`. No page module hand-rolls an `<h1>`. |
| 3 | One symbol control | `components/Layout.tsx` (owner), `pages/{Calc,Book,Tape,Charts,Heatmap,SdkGuide}.tsx` (removed) | The shell keeps the only `SymbolSelect`. Six pages lost their duplicate selector and unused imports. |
| 4 | Shorter titles, descriptions, buttons, statuses | 11 page modules, `components/ui.tsx`, `components/Layout.tsx`, `components/AccountAnalytics.tsx`, `pages/Portfolio.tsx` | See §2 for what was deliberately kept. Freshness vocabulary is now `Updated … ago` / `Loading…` / `Waiting for data` / `Paused`; retry actions say **Try again**; error headings are de-internalised (`That ID does not look right.`, `No public record found.`, `Something went wrong.`, `Cannot reach the market data service.`). Account load/refresh actions read **Load account data** / **Refresh account data** for every view. Sidebar labels and topbar breadcrumbs now share one short name per destination, and each page heading contains that name (`Trades`, `Order book`, `Depth heatmap`, `Compare prices`, `Bridge routes`, `Start on testnet`, `Developers: SDK`, `Brand kit`), and the account Trades subtitle no longer points at the retired `Recent Trades` label. No route, grouping, or item count changed — only the label text. |
| 5 | Cache provenance visible on mobile | `components/PublicCacheStatus.tsx` | The fresh-state badge no longer carries `hide-xs`, so `Cached metadata · 5s ago` stays on screen at every width. Label wording was not shortened at the cost of the store name or the age. |
| 6 | `/portfolio` redirect | `apps/web/src/App.tsx`, `components/Layout.tsx` | `/portfolio` → `/account` (was `/account/api`); the `ROUTE_META` entry now reads `Overview`. Query strings are still preserved by `accountRedirectTarget`. |
| 7 | Neutral retry styling, numeric alignment | `components/Layout.tsx`, `components/PublicCacheStatus.tsx`, `components/AccountAnalytics.tsx`, `pages/Compare.tsx`, `styles.css` | The topbar connection-failure control and the cache-refresh control lost the `danger` styling. The last three user-facing `Retry` labels (order-details drawer, compare empty states, order-details description) now say **Try again** too. `table.data td` uses `tabular-nums` so right-aligned figures line up. |
| 8 | Mobile sidebar focus and hidden state | `components/Layout.tsx` | `matchMedia("(max-width: 960px)")` drives a `mobileNav` flag. `inert` + `aria-hidden` are applied **only** when the layout is narrow *and* the drawer is closed, so the desktop sidebar stays focusable while `navOpen` is false. Opening moves focus to the first `.nav-item`; closing without navigating (button, Escape, backdrop) returns focus to the burger, and resizing from desktop into the mobile layout moves focus out before the drawer is made inert; following a link hands focus to the new page's main workspace instead of the burger. The burger exposes `aria-expanded` and `aria-controls="primary-navigation"`, and its label flips between "Open navigation menu" and "Close navigation menu". |

## 2. Copy that was shortened without dropping meaning

The owner's constraint was explicit: shorten wording and rearrange layout, never hide data provenance, age, limits, or financial definitions. Where a shorter string would have removed a real statement, the statement was kept — sometimes restored after the first pass:

- **Public pages keep the no-key statement.** `Book` and `Tape` both still say "No account key is used". The Tape subtitle lost it in the first pass and got it back.
- **Order-book terms stay explicit.** `Book` keeps "Bids (buy orders) and asks (sell orders)" rather than only "buy and sell orders".
- **Chart keyboard affordance stays discoverable.** `Charts` keeps "Hover or use Left/Right arrow keys to inspect a bar."
- **Empty-state reasons stay explicit.** `Compare` keeps "missing references, unmapped assets, non-USD quotes, and invalid prices"; `Heatmap` keeps "no levels, or every level had zero size".
- **The SDK caveat stays.** Precision/decoding notes (`scaled integer ÷ 10³`) remain in the Dashboard column tooltips; the footer now states provenance (`public Polyester testnet feed`) and the sparkline source instead.
- **Account copy avoids implying per-section loading.** The label is now generic because one click still performs the whole view load — the request path (`account.fetchOfficialSpotCatalog` → the same reads) was not touched.
- **Cache provenance is never hidden.** Only the fresh-state `hide-xs` was removed; nothing else about the badge's content changed.
- **Two service strings remain deliberately specific.** `Compare` still distinguishes `Rate-Limited / Error` from `Unavailable`, because collapsing them would hide the reason.

Measured on server-rendered empty states (13 routes, page-header descriptions only):

- before: **1,712** characters total
- after: **1,397** characters total (−18.4%)
- page-body word counts moved the same way (e.g. Heatmap 68 → 37, Dashboard 134 → 117, Tape 203 → 172); Calculator, Hub, SDK, and Brand Kit bodies are unchanged apart from their headers.

The audit's <900-character aspiration is **not** met. The remaining length sits mostly in the account overview (146), the bridge routes (126), the SDK page (117), and the compare page (116), where trimming further would have removed either a section list or a stated limit.

## 3. Automated checks — what they actually prove

All of the following were run against the modified tree:

| Check | Result |
|-------|--------|
| `npm test` | **222 tests / 52 suites, 222 pass, 0 fail** (was 202/44 before this batch) |
| `npm run typecheck` | pass (web + backend) |
| `npm run build` | pass — 594.88 kB JS / 177.34 kB gzip, 34.11 kB CSS / 7.02 kB gzip |
| `npm run check:performance` | pass — JS 595,527 B ≤ 625,000 · gzip 176,986 B ≤ 185,000 · CSS 34,107 B ≤ 40,000 · CSS gzip 6,990 B ≤ 10,000 · 12 static page imports, 0 dynamic |
| `npm run check:whitespace` | pass — 173/173 files, 0 violations |
| `npm run check:runtime` | not run in this batch |

New coverage in `tests/frontend-batch1.test.mjs` (20 assertions), each labelled as a source- or markup-level guard:

- exactly one `<h1>` per `PageHeader`, no `<h1>` inside cards, no page module hand-rolling a heading;
- `SymbolSelect` appears in the shell and in no page module;
- every sidebar label equals its route's topbar name, and each page heading contains that same short name;
- the SDK warning is rendered above the first snippet card;
- the shortened copy still contains the no-key statement, the compare/heatmap empty-state reasons, the order-book terms, and the chart keyboard hint;
- the account action uses one label and still goes through the same read path;
- `DataFreshness` says `Loading…` / `Updated …` / `Waiting for data`;
- `ErrorBox` says `Try again`, and no retry control is `danger`-styled;
- the fresh cache badge has no `hide-xs` and still shows store + age;
- `/portfolio` redirects to `/account`;
- the drawer's `inert` condition is `mobileNav && !navOpen`, with trigger wiring, Escape, backdrop dismissal, focus entry, focus restore, and the link-followed handoff present in source;
- no user-facing `Retry` wording survives anywhere in pages or shared components;
- stylesheet contract: the off-canvas transform, the open state, the backdrop, and the burger live only inside the `max-width: 960px` block, while the base `.sidebar` rule keeps the desktop sidebar in flow and the burger hidden.

Existing tests were updated only where a label legitimately changed: `tests/public-cache.test.mjs` (fresh badge no longer `hide-xs`, retry label), `tests/account-ux.test.mjs` (single load label), `tests/compare.test.mjs` (new zero-match title).

**What these checks cannot prove.** They cannot show that the sidebar is off-canvas at 390 px and visible at 1280 px, that `inert` keeps a closed drawer out of the tab order in a real engine, that focus actually lands on the first nav item, that Escape and the backdrop really dismiss the drawer, that focus returns to the burger, or that `tabular-nums` aligns digits as intended. Those are browser facts.

## 4. Browser pass — required, not yet recorded

No browser was available in this environment, so **batch item 8 is not complete** and no visual claim should be made about any page. The pass below is the minimum needed to close batch 1.

Widths: **390 px**, **768 px**, **1280 px**. Record the browser name/version and the commit or working-tree state in the result.

1. **Heading hierarchy (all widths).** On `/`, `/book`, `/charts`, `/hub` and `/account`: exactly one visible `<h1>`, matching the sidebar/topbar name; card titles read as sub-headings; no duplicated page title above and inside the content.
2. **Duplicate titles gone.** Confirm the page name appears in the topbar breadcrumb and once as the `h1`, and that the `Read-only · Testnet` static eyebrow no longer appears next to the title.
3. **One symbol control.** On `/book`, `/tape`, `/charts`, `/heatmap`, `/calc`, `/sdk`: exactly one symbol selector, and it is the one in the shell (changing it updates the title and the page data).
4. **Drawer at 390 px.** Tap the burger → drawer slides in, focus lands inside the nav; tab through the items and confirm focus does not escape into the page behind while the canvas is covered; press **Escape** → drawer closes and focus returns to the burger; reopen and tap the backdrop → same; tap a nav item → route changes, drawer closes, and focus lands in the new page rather than back on the burger.
5. **Closed drawer at 390 px.** With the drawer closed, tab from the topbar and confirm the hidden nav is skipped entirely.
6. **Desktop at 1280 px.** Sidebar is visible while `navOpen` is false, all nav items are focusable, the burger is hidden, and no `inert` attribute sits on the sidebar (check the element in devtools).
7. **Tablet at 768 px.** Off-canvas behaviour matches 390 px; nothing overlaps the topbar; no horizontal scrollbar appears on `/book`, `/tape`, `/account`.
7b. **Drawer height at 390 px.** Scroll to the bottom of the open drawer on a phone browser with a collapsing toolbar: confirm the last nav item is reachable. The drawer is `position: fixed` with both `height: 100vh` and `top: 0; bottom: 0`, so `100vh` may overshoot the visible viewport; if it does, the fix is `height: auto` or `100dvh`, chosen in the browser rather than guessed here.
7c. **Scroll behind the drawer.** With the drawer open at 390 px, try to scroll the page behind the backdrop. The drawer does not lock body scroll today (unlike `OrderDetailsDrawer`); record whether the page moves.
8. **Cache provenance at 390 px.** On a page that shows the public cache badge, confirm `Cached metadata · Ns ago` is visible (not clipped) in the fresh, stale, and error states, and that the retry control reads **Try again** without red/destructive styling.
9. **Numeric alignment.** On `/` and `/account`, right-aligned numbers use one digit grid; no jitter between rows.
10. **`/portfolio` redirect.** Open `#/portfolio` → lands on the account overview (`#/account`), and `#/portfolio?x=1` keeps its query string.
11. **Keyboard-only sanity.** Full pass with Tab/Shift+Tab and Enter/Space at 390 px: no focus traps, no invisible focus, and the skip link still targets the main workspace.

Record the outcome per item; anything that fails becomes a follow-up entry in `docs/frontend-audit/FRONTEND_ROADMAP.md` rather than being silently patched.

## 5. Deliberately not in this batch

Unchanged, as agreed: navigation structure, which private requests run on **Load account data**, the four separate freshness implementations, polling/context plumbing, table and chart refactors, and the contrast-token migration (dark muted 3.83:1, dark faint 2.40:1, light faint 2.56:1, light up 3.77:1, light warn 3.19:1 all remain below 4.5:1).

Also still open from the audit and not started here: `ConfirmDialog` and `GlossaryDrawer` focus trapping (only the mobile sidebar got the focus contract), chart keyboard interaction beyond the retained hint, section switching that discards history (UX-A2), and unvalidated SDK snippet inputs (UX-P7 — a separate, tested change).

One new observation while doing item 5: `Book` and `Tape` still hide their **Notional** column at ≤680 px via `hide-xs`. That is a data column disappearing on mobile, which is the same class of problem the owner flagged for the cache badge. It was left alone because it needs a layout decision (stacked row vs. narrower column), not a class swap.
