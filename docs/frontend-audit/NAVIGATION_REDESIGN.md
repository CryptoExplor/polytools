# Navigation and information architecture redesign

**Constraint set (non-negotiable):**

- Keep every existing URL working, including hash routes and legacy aliases. Routing is `HashRouter`, so deep links are the product's only bookmarking mechanism.
- Do not merge public market data with private account data.
- Do not remove a route, a tool, or a safety statement.
- No new dependencies.

---

## 1. Current navigation, measured

`SRC` `Layout.tsx` `NAV_GROUPS` + `AccountTabs`:

```
Account            (6)  Overview · API setup · Your Trades · Orders · Profit and Loss · Money Movements
Market Data        (6)  Markets · Recent Trades · Order Book · Price chart · Liquidity heatmap · Venue compare
Cross-Chain        (1)  Zipper routes
Toolkit & Docs     (4)  Calculators · Testnet hub · SDK quickstart · Brand kit
```

**17 flat items in 4 groups, one group with a single item, plus the same six account items repeated as tabs.**

Problems this creates:

| # | Problem | Evidence |
|---|---|---|
| 1 | A newcomer cannot tell which group is "start here" — the first group is the one requiring a key | `SRC` group order |
| 2 | Two nav surfaces disagree about hierarchy: sidebar nests account items under a group, tabs present them as peers of the page | `SRC` |
| 3 | A one-item group ("Cross-Chain") implies more depth than exists | `SRC` |
| 4 | "Toolkit & Docs" mixes a calculator (daily use), a testnet guide (once), an SDK guide (developer), and brand assets (never for most users) | `SRC` |
| 5 | No grouping signals beginner vs advanced; five of 17 items are developer/brand items | `SRC` |
| 6 | Mobile users see a 17-item drawer with no search and no recent items, then a second 6-item tab row inside account | `SRC` CSS `.sidebar` @960px |

---

## 2. Proposed structure

**Five top-level destinations, one persistent "Learn" affordance, one account area.**

```
OVERVIEW (no group label — first, ungrouped)
  Markets                      /              ← default landing page
  Compare prices               /compare

MARKETS
  Order book                   /book
  Trades                       /tape
  Price chart                  /charts
  Depth heatmap                /heatmap

TOOLS
  Calculators                  /calc
  Bridge routes                /zipper

MY ACCOUNT  (single entry; expands to tabs inside)
  My account                   /account

LEARN & DEVELOPERS  (collapsed group, one line summary)
  Start on testnet             /hub
  Developers: SDK              /sdk
  Brand kit                    /brand-kit   (also in footer)
```

Item count in the primary rail: **9 visible** (2 overview + 4 markets + 2 tools + 1 account), with 3 more behind a collapsible "Learn & Developers" section and 5 sections reachable through account tabs.

### Why this shape

| Decision | Reason | Tradeoff |
|---|---|---|
| Put public markets first and above everything | First question of a new user is "what is this about / what is the price", not "connect a key" | Existing users who live in account views take one extra click. Mitigation: remember the last visited account section and surface it in the rail as "My account · Overview" |
| Collapse the six account items into one | Eliminates the duplicate sidebar/tabs nav and the "which group am I in?" ambiguity | One extra click to reach Orders from another page; recovered by deep links and by the tab strip inside the account area |
| Merge "Cross-Chain" into Tools | A one-item group is pure overhead | "Zipper" loses a dedicated heading; the page title still contains it |
| Split "Learn & Developers" out and collapse it by default | Removes 3 of 17 items from a beginner's first scan; keeps them one click away | Developers need one extra click. Acceptable: they arrive with intent and the group is labelled with their role |
| Keep "Brand kit" in the footer as well | Users usually arrive to copy a logo, not to browse the app | None |
| Never mix account and market items in the same group | Preserves the public/private boundary the app has built carefully | Slightly less "flat" nav |

---

## 3. Before / after

### Before (17 items, 4 groups)

```
[PolyTools  Read-only · testnet]

Account
  Overview
  API setup
  Your Trades
  Orders
  Profit and Loss
  Money Movements
Market Data
  Markets
  Recent Trades
  Order Book
  Price chart
  Liquidity heatmap
  Venue compare
Cross-Chain
  Zipper routes
Toolkit & Docs
  Calculators
  Testnet hub
  SDK quickstart
  Brand kit

[19 pairs · 19 assets      testnet]
[Public analytics for Polyester. No wallet or login.]
```

### After (9 visible + 1 collapsible group)

```
[PolyTools  Read-only · testnet]

Markets
Compare prices
── Markets ──
Order book
Trades
Price chart
Depth heatmap
── Tools ──
Calculators
Bridge routes
── ──
My account  ⌄ (last: Overview)

▸ Learn & developers  (3)
     Start on testnet
     Developers: SDK
     Brand kit

[19 pairs · 19 assets]
[Testnet only · no wallet needed]
```

Account area (unchanged tabs, now the only place these six appear):

```
Overview | Trades | Orders | Profit and loss | Deposits & withdrawals | Key setup
```

---

## 4. Route and URL compatibility plan

**Nothing changes at the routing layer in batch 1.** Labels and grouping are presentation-only.

| Path | Today | After redesign | Compatibility note |
|---|---|---|---|
| `/` | Dashboard | Markets | Same path; page title changes; `#/` remains the landing page |
| `/book` `/tape` `/charts` `/heatmap` `/compare` `/calc` `/zipper` | pages | unchanged | no change |
| `/hub` | Testnet hub | Start on testnet | Path stays `/hub`; only the label changes. If a friendlier alias is ever wanted, add `/start` as an **additional** route and keep `/hub` |
| `/sdk` | SDK quickstart | Developers: SDK | unchanged |
| `/brand-kit` | Brand kit | Brand kit | unchanged |
| `/account` … `/account/transactions` | 6 tabs | unchanged | unchanged; these are already the canonical private URLs |
| `/account/order-book` | alias → Orders | keep as alias | do not remove; may appear in old links |
| `/flow` | redirect → `/account/transactions?scope=public` | keep exactly | preserves query params via `accountRedirectTarget` |
| `/portfolio` | redirect → `/account/api` | redirect → `/account` (**change**) | A user typing "portfolio" expects an overview, not key setup. Low risk: `/account/api` is reachable from the tabs and from any old link that carried the path directly |
| `*` | redirect to `/` | **404-style empty state** with links to Markets and Search | Silent redirects hide broken links; a small "We couldn't find that page" with two buttons is safer |

**Query-param contract to preserve:** `?mode=&q=` on the Flow/transactions lookup, `?scope=public` on Money Movements, and the symbol selection (currently stored in `localStorage`, not the URL).

**Recommendation (batch 2, optional):** put the selected symbol in the URL hash for market pages (`#/book?symbol=ETH-USDT`) so a user can share a specific market view. This is an addition, not a change — the store remains the source of truth when the param is absent. Do not do this until a URL-sync test exists, because today `/book` and `/tape` silently share the global symbol.

---

## 5. Mobile navigation

Current: burger → 17-item drawer with 4 headings → page → 6-item horizontally scrolling tab row on account pages.

Proposed for ≤ 960 px:

1. **Bottom-reachable primary nav is not proposed** (it would be a sixth navigation paradigm and a large change). Keep the drawer.
2. Drawer changes:
   - 9 primary items fit without scrolling on a 667 px-tall viewport (≈ 9 × 40 px + headers).
   - Add a **"Recent"** section at the top (last 3 visited routes, `localStorage`, public routes only). This is the single highest-value mobile addition: it makes returning users one tap from where they were.
   - Move "Learn & developers" behind a disclosure at the bottom.
   - Add `inert` + focus trap + focus restore (see `PAGE_BY_PAGE_AUDIT.md` G-7/G-8).
3. Account tabs: keep horizontal scroll, but shorten labels (see `TEXT_SIMPLIFICATION.md` §1) so five of six fit at 390 px instead of two.
4. Symbol selector: single instance in the topbar; on ≤600 px show it as a full-width row under the topbar instead of a squeezed select.
5. Keep the "Skip to main content" link (already present) and verify it is the first tab stop.

---

## 6. Grouping rationale for individual pages

| Page | Current home | Proposed home | Why |
|---|---|---|---|
| Markets (`/`) | Market Data | first, ungrouped | Landing page; also the index of every other market page |
| Compare prices | Market Data | first, ungrouped | It answers a top-three beginner question and is not a per-market tool |
| Order book / Trades / Chart / Heatmap | Market Data | Markets | These four are per-symbol views and share the symbol selector |
| Calculators | Toolkit & Docs | Tools | Daily-use utility, not documentation |
| Bridge routes | Cross-Chain | Tools | Comparison utility |
| Start on testnet | Toolkit & Docs | Learn & developers (collapsed) | Used once at the start, not daily |
| SDK quickstart | Toolkit & Docs | Learn & developers (collapsed) | Developer audience |
| Brand kit | Toolkit & Docs | Learn & developers + footer | Marketing/partner audience |
| Six account sections | Account (6 items) | My account (1 item + tabs) | Removes duplicate navigation; keeps fail-closed account state visible |

---

## 7. In-page IA changes that accompany navigation

1. **One heading per page.** Remove the duplicated `Card` title inside account sections; make `PageHeader`'s title the `<h1>`.
2. **One symbol control per screen** (topbar).
3. **One freshness control per screen** (see `DESIGN_SYSTEM_AUDIT.md` §6).
4. **Header order becomes:** title → one-sentence purpose → freshness badge + primary action → tool. Metric strip only when it answers a question the tool does not already show.
5. **Contextual cross-links instead of duplicated nav:** on `/tape` add "Open order book" and "Open chart" links; on account Trades add "Public trades are under Trades"; keep the existing `/sdk` ↔ `/account/api` cross-link.

---

## 8. What we are deliberately *not* proposing

| Idea | Why not |
|---|---|
| A tab bar inside every market page (Book/Tape/Chart/Depth as tabs of one page) | Tempting, but each tool has independent polling, independent controls, and independent empty states. Merging them means either four simultaneous pollers (more network) or losing state on switch. **Do not merge in batch 1.** Revisit only with a measured user complaint. |
| Removing the account sidebar items entirely | They are the only in-page nav on desktop today; they stay as tabs. |
| A command palette / search-everything | Adds a dependency and hides the nav instead of fixing it. P3 at most. |
| Bottom tab bar on mobile | A sixth paradigm for a 17-route app. |
| Renaming routes to prettier slugs | Breaks every existing link and every audit reference. Only additive aliases are acceptable. |

---

## 9. Acceptance criteria

Navigation work is done when:

1. The rail has ≤ 10 visible items at desktop width and no single-item group.
2. The six account sections appear in exactly one navigation surface (the account tab strip).
3. Every pre-existing path in §4 resolves to the same content it does today (verified by a route-render test for all 17 paths + 3 aliases).
4. Exactly one symbol selector is rendered per market route (assert by DOM count in an SSR test).
5. Every page has exactly one `<h1>`, and no page renders the same title twice.
6. At 960 px the drawer opens, receives focus, traps it, closes on Escape, and returns focus to the burger.
7. Keyboard-only navigation can reach every route in ≤ 3 actions from any page (rail item, or account tab, or Learn disclosure).
8. No new dependency, no new polling, no change to `localStorage` keys other than one additive `poly-tools:recent`.
