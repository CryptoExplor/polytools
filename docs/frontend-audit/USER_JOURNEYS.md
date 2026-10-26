# User journey review

Eight task-based walkthroughs derived from **source + server-rendered markup**. No users were observed; nothing here is user research. Each journey lists the actual controls and copy a person would meet, the friction points, and a proposed flow.

**Friction scale** (audit judgement, not a metric): 🟢 smooth · 🟡 noticeable · 🔴 likely blocker for a beginner.

---

## J1 — First-time visitor wants to understand what PolyTools offers

**Start:** lands on `#/` (or a shared link to `#/book`).

| Step | What happens | Evidence |
|---|---|---|
| 1 | Sidebar with 17 items and 4 group headings, brand subline "Read-only · testnet" | `SRC` `Layout.tsx` |
| 2 | Topbar breadcrumb "Market Data / Markets", cache pill, Glossary, theme toggle | `SRC` |
| 3 | Intro bar: "Read-only toolkit · Testnet" / "**PolyTools is a read-only map of Polyester.** Watch live prices, order book depth, trades, and bridge fees without connecting a wallet. It never places orders or touches funds." + 3 buttons | `SRC` `:461-490` |
| 4 | Page eyebrow "Read-only · Testnet", `h2` "Spot Market Overview", 139-char subtitle | `SSR` |
| 5 | Four metric cells reading `—` | `SSR` |
| 6 | Price table with 19 rows and 4 buttons per row | `SSR`/`SRC` |

**Confusing moments**

- 🟡 Six separate statements that the app is read-only (intro, page eyebrow, topbar eyebrow, sidebar subline, sidebar disclaimer, footer). By the fourth, the message stops registering — including where it matters.
- 🟡 Two navigation surfaces are visible at once (sidebar groups + topbar breadcrumb + the intro bar's own buttons). Nothing says "start here".
- 🔴 The four most prominent numbers on the landing page are em-dashes. A newcomer sees "—" four times and 17 menu items before seeing a price.
- 🟡 "Plan your day" style framing is missing: nothing says "this is testnet data, prices are simulated" until they open Compare or Hub.
- 🟢 The Glossary is genuinely excellent — 17 plain-English terms — but it is labelled only by icon at ≤960 px.

**Unnecessary clicks/text:** the intro bar costs three buttons and two sentences on every session until dismissed; the subtitle is a feature list.

**Missing feedback:** none — no state is broken. The gap is prioritisation, not feedback.

**Proposed flow**

1. Land on `/` with: one global read-only pill in the topbar; **no** intro bar above the table; one-sentence page purpose; prices immediately visible.
2. A single optional "New here? Start on testnet →" link in the page header (not a banner).
3. Sidebar reduced to 9 visible items with "Learn & developers" collapsed.
4. Keep the Glossary visible with its label at all widths.

**Success test:** a first-time visitor can name the product's purpose and find a price without opening any menu.

---

## J2 — Beginner checks a market price and recent trades

**Start:** `/` → wants BTC-USDT price and what people are trading.

| Step | What happens | Friction |
|---|---|---|
| 1 | Read "Last Price" column (row 1 by default, sorted by volume) | 🟢 |
| 2 | Click the row's `Tape` button, or the symbol (which goes to the **chart**, not the tape) | 🟡 The symbol button opens the chart; the tape is a separate 11.5 px button labelled "Tape" |
| 3 | Arrive at `/tape`: full page header + 5 metric cells + alert configuration card **above** the trade list | 🔴 The tape — the thing they clicked for — is below the fold |
| 4 | Scroll to "Time & Sales" | 🟡 |
| 5 | To change symbol: two symbol selectors exist (topbar and page header) | 🟡 |
| 6 | To check the order book: back to Markets, or the row's `Book` button | 🟡 No cross-link from the tape |

**Copy burden:** the alert card's subtitle ("Alerts are local. They are not orders. Triggered once per unique matchId on newly arriving trades.") is read before the first trade, and mentions `matchId`.

**Proposed flow**

1. Symbol text in the table opens the **chart**; keep explicit `Order book` / `Trades` links, but put them in one row menu so the tape is reachable in two taps.
2. On `/tape`: trades first; an "Alerts" collapsible panel underneath with an off/on summary.
3. One symbol control.
4. Cross-links in each market page header: `Order book · Trades · Chart · Depth` as a segmented switch that preserves the symbol.

**Success test:** from landing to a visible trade row in ≤ 2 actions.

---

## J3 — Compare markets or use the calculator

**3a. Compare prices** (`/compare`)

| Step | What happens | Friction |
|---|---|---|
| 1 | Page header + 170-char subtitle + 1 warning banner + 5 metric cells + 1 info banner before the table | 🔴 The same "not tradeable" warning appears three times |
| 2 | Table of 8 columns; "Matched 0 / All Listed 19" toggle | 🟡 Two of the metrics report plumbing ("Polyester Feed Status", "CoinGecko Reference Feed") rather than a comparison result |
| 3 | Per-row provenance text inside a table cell | 🟡 Long prose in a numeric grid |

**3b. Calculator** (`/calc`)

| Step | What happens | Friction |
|---|---|---|
| 1 | Four metric cells show results for inputs the user has not entered (`Sized Position Qty 0.005 BTC`, `Simulated Net PnL +958.00 USDT`) | 🔴 Looks like the page already answered a question |
| 2 | Four numbered calculators in a 2×2 grid, 14 inputs | 🟡 No indication which one a beginner should use for "what's my profit" |
| 3 | `Sync Live Price` fills every calculator at once, overwriting anything typed | 🟡 Destructive to manual input; the button label does not say "overwrites" |
| 4 | Fee default 10 bps explained as "a placeholder. Polyester VIP fees are not on this MCP" | 🟡 Jargon in a beginner tool |

**Proposed flow**

- Compare: one banner, feed status collapsed into the freshness popover, per-row provenance behind an expandable row.
- Calculator: start with calculator 1 expanded and the other three collapsed; empty result cells; "Use current price" per calculator (not global), with a confirm if a field already contains a user edit.

**Success test:** a beginner can produce one profit estimate without touching more than 4 inputs.

---

## J4 — Returning user wants to continue where they left off

**What persists today** (`SRC`): selected symbol, theme, watchlist, intro-dismissed flag, Hub checklist, public metadata cache. **Not persisted:** last route, scroll position, account section, loaded account data (deliberately memory-only).

| Step | What happens | Friction |
|---|---|---|
| 1 | Opens the app root | 🟡 Always lands on `/`, never the last page |
| 2 | Symbol is remembered (good) | 🟢 |
| 3 | Watchlist stars persist (good), but the "★ Watchlist (3)" filter is off by default | 🟡 A returning user with a watchlist still sees all 19 markets |
| 4 | Account users must re-unlock (by design) and re-load (by design) — but the UI does not say that on the way in | 🟡 They meet "Section-scoped memory" only after arriving |
| 5 | Intro bar does not reappear (good, persisted) | 🟢 |

**Proposed flow**

1. Add `poly-tools:last-route` (public routes only) and offer it in the sidebar as a "Recent" section with up to 3 entries. Do **not** auto-redirect — a surprising redirect is worse than a click.
2. If `watchlist.length > 0`, default the Dashboard filter to "All" but pin watchlist rows to the top with a subtle divider (no hidden state).
3. On account pages, show the lock state as the first element ("Locked — unlock to load data") rather than as a warning after two notices.

**Success test:** a returning user reaches their last public page in one click.

---

## J5 — User connects an account and views their own trades

**Start:** `/account` or the sidebar "Overview".

| Step | What happens | Friction |
|---|---|---|
| 1 | Six account tabs + page header + 3 actions (`Official API Keys`, `SDK Quickstart`, `Lock now` when unlocked) | 🟡 Three equally weighted buttons, one of which leaves the app |
| 2 | Two warning notices before anything actionable | 🔴 "Live compatibility remains unverified…" and "Section-scoped memory…" — both before the Load button |
| 3 | A 5-cell diagnostics grid ("Registered key ID: Required", "Secure browser context: No", "Official pair catalog: Required before fills"…) | 🟡 Reads as an error state; it is just pre-conditions |
| 4 | Click `Open API setup` → 4 metric cells → a warning notice → "Create an Encrypted Key Entry" card with 4 fields and a mode toggle | 🟡 The page is long; the primary action ("Generate & Encrypt") is below the fold at 800 px |
| 5 | Generate → passphrase (≥12 chars, unrecoverable) → `Generate & Encrypt` | 🟢 Clear, and honestly warns about recovery |
| 6 | Enter the registered `ak_…` ID: either in the optional field at creation, or later in a separate card lower on the page whose button is labelled `Re-encrypt` | 🟡 The ID can be supplied at creation (good), but the later path is labelled `Re-encrypt`, which reads as a passphrase operation rather than "save key ID", and it sits far below the creation card |
| 7 | Go to `Trades` → `Load your trades` | 🟡 Label implies trades-only; the load also fetches catalog, balances, equity, fees, history, open orders |
| 8 | See results with per-dataset status pills | 🟢 Excellent fail-closed clarity |

**Confusing moments:** "Re-encrypt", "nonextractable", "KDF parameters", "canonical request signer", and "GET · /v1/balances" are all on the page where a beginner is asked to create their first key.

**Proposed flow**

1. Split `/account/api` into two visual zones: **"Connect"** (create/import → save key ID, one linear 3-step wizard) and **"Advanced"** (signer, vault internals, registration boundary) collapsed.
2. Do not require a page round-trip: after creating a key, keep the user in the same card and ask for the `ak_…` ID in step 2.
3. Remove the two always-visible warnings from the top and replace with one status line + a "What can go wrong" disclosure (content preserved verbatim inside).
4. Rename `Load your trades` → `Load account data`, or make the read genuinely scoped. (Behaviour change: needs the owner and tests.)

**Success test:** a first-time key setup completes without leaving the card, and the user knows why they must supply an `ak_` ID.

---

## J6 — User wants to understand why account history is incomplete

**Start:** `/account/trades` after a load, or `/account/transactions`.

| Step | What happens | Friction |
|---|---|---|
| 1 | Per-dataset pill: "Partial data" / "Permission needed" / "Unavailable" | 🟢 Clear, honest |
| 2 | Warning notice: "Only part of the requested data is loaded. Shown figures use validated loaded rows only and are not a complete history." | 🟢 Correct |
| 3 | Footer line: "Data loaded: 12/14 rows · 2 pages · more pages may remain · 1 duplicate row · 3 conflicting rows · 1 unrecognized row · page limit reached" | 🔴 A machine diagnostic string is the only explanation of *why* |
| 4 | A "Need every cursor page?" notice with a page-cap select (100…10 000) and `Import full history (capped)` | 🔴 The remedy exists but is buried inside an explainer, uses "cursor page", and is the most expensive action on the page |
| 5 | Leaving the section discards the import | 🔴 Not warned at the moment of leaving |

**Proposed flow**

1. A short "Why is this incomplete?" explanation next to the status pill, with two sentences per state (`partial` / `cap reached` / `permission`).
2. Move the row-level counts into that explanation, formatted as a list, not a monospace string.
3. Promote "Load all pages" to a normal secondary button with the cap in a small select beside it; keep the existing cancel and "previous data retained" messaging.
4. When the user navigates away with loaded/imported data, show a one-line confirmation ("Leaving clears what you loaded. Continue?") — navigation is already intercepted by React Router, so this is a `NavLink` onClick guard, not a browser dialog.

**Success test:** a user can state in one sentence why their history is incomplete, without reading a diagnostic string.

---

## J7 — User reviews P&L and understands which numbers are unavailable

**Start:** `/account/pnl`.

| Step | What happens | Friction |
|---|---|---|
| 1 | Header title "Profit and Loss" + **223-char** subtitle with five accounting terms | 🔴 Highest text burden in the app on the page with the most sensitive numbers |
| 2 | Two warnings, five-cell diagnostics grid, period select (`1d`…`365d` raw tokens), `Load P&L inputs` | 🔴 Eight blocks before data |
| 3 | After load: "Choose a cost-basis ledger" → opening lot form (qty, cost, time, provenance) or "establish opening zero" | 🟡 Correct but form-heavy; "provenance" is unexplained |
| 4 | "Resolve relevant non-fill flows" with per-row selects (`fill` / `bucket` / `acquisition` / `disposal` / `quote-neutral`) | 🔴 Expert accounting vocabulary presented as a table of dropdowns with no task framing |
| 5 | "Fresh valuation mark" (price, source, kind, timestamp) | 🟡 Explains it is only needed for unrealized/total — good |
| 6 | Result strip: Realized / Unrealized / Total / Remaining cost, each with "Unavailable" and a gate description | 🟢 **This is excellent.** It states the missing input instead of guessing |

**Proposed flow**

1. Subtitle: "Profit and loss needs your opening cost, complete trades, and a current price. We show 'Unavailable' rather than a guess." (Keep the mark/realized distinction on the result card, where it is actionable.)
2. Frame the three inputs as steps: **1 Opening cost → 2 Explain unusual transfers → 3 Current price**, with a progress indicator ("2 of 3 ready").
3. Translate the five flow decisions into questions, keeping the exact labels as secondary text. **Do not change the gate logic.**
4. Keep every "Unavailable" and every gate reason exactly as they are.

**Success test:** a user can tell which single input is blocking each of the four numbers.

---

## J8 — Mobile user navigates between tools

**Situation:** 390 × 844 phone, one hand. Source-level analysis only — **no device testing performed.**

| Step | What happens | Friction |
|---|---|---|
| 1 | Topbar: burger, breadcrumb (group label hidden), symbol select, freshness, Glossary icon, theme icon | 🟡 Five controls in ~200 px of space; the freshness pill and cache pill are flex-wrapped, `LIKELY` producing two rows |
| 2 | Open the drawer: 17 items in 4 groups, scrolling required | 🔴 Long list, no recents, no search |
| 3 | Closed drawer remains in the tab order (no `inert`) | 🔴 Keyboard/SR users can tab into invisible links (`UNK` exact behaviour) |
| 4 | Pick `Order book`: page header + depth segmented control + freshness + symbol select again | 🟡 Header wraps to 3–4 rows before any price |
| 5 | Ladder shows 3 columns instead of 4 (`Notional` hidden at ≤600 px) | 🟡 A number disappears instead of reflowing |
| 6 | Tape hides `Notional` and `Match ID / Age` | 🟡 Can't copy a match ID on a phone |
| 7 | Account pages: 6 tabs scroll horizontally; estimated 2–3 visible at 390 px (six labels plus padding exceed 390 px) | 🟡 Reaching "Money Movements" needs a horizontal scroll with no visual cue beyond clipping |
| 8 | `ConfirmDialog` max-width 440 px, fits; `GlossaryDrawer` `min(420px, 92vw)`, fits; order drawer stacks at ≤640 px | 🟢 |
| 9 | Toasts bottom-right, `max-width: 360px` | 🟡 `LIKELY` overlaps the freshness controls on small screens |

**Proposed flow**

1. Cap the topbar to: burger, title, one status badge, one overflow menu (Glossary, theme, refresh).
2. Drawer with 9 items + "Recent" + collapsed Learn group; `inert` when closed; focus in/out handled.
3. Symbol select becomes a full-width row under the topbar at ≤600 px.
4. Replace hidden columns with stacked secondary lines in the ladder and tape rows (keep the number, lose the column).
5. Account tabs: shorter labels so five of six fit; add a fade/scroll indicator.

**Success test:** from any page, reaching any other tool takes ≤ 3 taps; no numeric column is silently dropped.

---

## Cross-journey findings

| # | Finding | Journeys | Severity |
|---|---|---|---|
| 1 | Purpose/limitation text precedes the tool on 6 of 8 journeys | J1, J2, J3a, J5, J6, J7 | P0/P1 |
| 2 | Duplicate navigation and duplicate controls create "which one?" moments | J1, J2, J5, J8 | P1 |
| 3 | Expert vocabulary used as primary labels (`Re-encrypt`, `cursor page`, `non-fill flows`, `bucket`, `matchId`) | J3b, J5, J6, J7 | P1 |
| 4 | Results shown before input, or "—" shown as the first impression | J1, J3b | P1 |
| 5 | Mobile removes information instead of re-flowing | J2, J8 | P0 (data loss of meaning) |
| 6 | Persistence is good (symbol/theme/watchlist) but there is no "resume" affordance | J4 | P2 |
| 7 | The strongest UI in the product (per-dataset fail-closed status, P&L gates, order drawer) is under-promoted relative to the weakest (matrix tables, diagnostics grids) | J5, J6, J7 | P1 (design attention misallocated) |
