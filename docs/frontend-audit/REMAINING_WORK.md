# Frontend simplification — what is still open

Three things remain: a browser pass that no automated check can replace, seven roadmap items the owner has not approved, and four known defects found but deliberately not patched.

---

## 1. Browser pass — required to close the implementation

Nothing in batches 1–3 is browser-confirmed. No browser was available while the work was done, so the suite proves markup, copy, arithmetic, and wiring only. Record the browser name/version and the commit tested next to each row.

Widths: **390**, **768**, **1280** px.

### Headings and names

1. On `/`, `/book`, `/charts`, `/hub`, `/account`: exactly one visible `<h1>`, matching the sidebar and breadcrumb; card titles read as sub-headings; no repeated page title.
2. The `Read-only · Testnet` eyebrow no longer appears beside any title.
3. Sidebar label, breadcrumb, and heading agree on every route.

### Symbol control

4. On `/book`, `/tape`, `/charts`, `/heatmap`, `/calc`, `/sdk`: exactly one symbol selector, and it is the shell's; changing it updates the heading and the page data.

### Copy and provenance

5. `Cached metadata · Ns ago` is visible and unclipped at 390 px in the fresh, stale, and error states; the retry control reads **Try again** and is not red.
6. On `/` and `/account`, right-aligned numbers share one digit grid, with no per-row jitter.

### Mobile drawer

7. 390 px: tapping the burger slides the drawer in and focus lands inside the nav; Tab does not reach the page behind it; Escape closes it and focus returns to the burger; the backdrop does the same; following a link closes it and moves focus into the new page.
8. 390 px, closed: tabbing from the topbar skips the hidden nav entirely.
9. 390 px: the last nav item is reachable when the browser toolbar is collapsed. The drawer is `position: fixed` with both `height: 100vh` and `top: 0; bottom: 0`; if `100vh` overshoots, choose `height: auto` or `100dvh` in the browser rather than guessing here.
10. 390 px: scrolling behind the open drawer. The drawer does not lock body scroll (the dialogs do). Record whether the page moves behind the backdrop.
11. 1280 px: the sidebar is visible with the drawer closed, every nav item is focusable, the burger is hidden, and **no `inert` attribute sits on the sidebar** (check in devtools).
12. 768 px: off-canvas behaviour matches 390 px; nothing overlaps the topbar; no horizontal scrollbar on `/book`, `/tape`, `/account`.

### Dialogs

13. 1280 px, API setup → *Delete all keys*: Tab cycles Cancel → Delete → Cancel, Shift+Tab mirrors it, Escape closes, focus returns to the opener, the page behind does not scroll.
14. 390 px: the glossary button shows the word "Glossary"; opening it focuses the search field; Tab stays inside; Escape returns focus to the button; the route does not change.
15. Stacked overlays: from inside the order-details drawer trigger a confirmation — Tab must stay in the confirmation, Escape must close only it, and closing must leave the drawer open, scroll still locked, and focus back on the triggering button.
16. Logout / "Forget all" / export flows still complete (all three use `ConfirmDialog`).

### Account tabs and routing

17. 390 px: count the visible tabs (six expected with the short labels); after navigating between sections the active tab is scrolled into view and announced via `aria-current`.
18. `#/portfolio` lands on the account overview; `#/portfolio?x=1` keeps its query string.
19. 768 px and 390 px: full Tab-only pass over `/`, `/book`, `/account` — no trap, no invisible focus, skip link still targets the main workspace.

### SDK order validation

20. 390 px and 1280 px, step *4. Place & Cancel Order*: the warning sits above the inputs and the reason list is readable without horizontal scrolling.
21. Type `0.001` on `AVAX-USDT` (minimum `0.1`): the notice appears, copy is disabled, and the announcement is sensible.
22. **Use Live price** on a `0.00001`-tick market (e.g. `DOGE-USDT`): the price lands on the tick grid and the notice clears.
23. Copy a valid snippet: pasted values match the inputs exactly and carry no more decimals than the pair allows.

---

## 2. Unimplemented roadmap items — each needs an owner decision

| ID | Item | Why it is waiting |
|---|---|---|
| P1-1 | Navigation: ≤10 visible rail items, collapsible *Learn & developers*, no one-item group, the six account sections only in the tab strip | Changes the information architecture and every visible label. No route would be removed. |
| P1-4 | Dashboard: move the intro out of `<main>`, hide the metric strip until the first response (or render skeletons at final size) | Partly done — subtitle and **Download CSV** shipped in batch 1. The rest changes the landing page's first paint. |
| P1-5 | Tape: trades first, alerts collapsed below with a summary line (`Alerts off · size ≥ 10.00K USDT`) | Reorders a working page; alert logic must stay untouched and `aria-pressed` preserved. |
| P1-6 | Account: replace the two always-on warnings with one status line plus a `What this means` disclosure holding both paragraphs **verbatim**; 5-cell diagnostics grid → 2 status items | Risks weakening security wording. The rule is that not one sentence may be lost. |
| P1-8 | Warn before leaving an account section that has loaded or unsaved data | Touches the disposal path; needs a definition of "work worth warning about" and must not block Lock / Forget all. |
| P1-10 | Money Movements: make the public/private choice two tabs with one-line descriptions; drop the duplicated notice | Changes the `?scope=public` deep-link contract that an earlier fix depends on. `/flow` must redirect identically. |
| P1-13 | Contrast: introduce text roles (`--text-caption`, `--text-decorative`) and migrate meaning-carrying `.faint`/`.muted` text to a ≥4.5:1 token in both themes | Needs sign-off on the new colour values; the whole visual tone shifts. |

Measured ratios today (dark theme): muted **3.83:1**, faint **2.40:1**; light theme: faint **2.56:1**, up **3.77:1**, warn **3.19:1**. All below 4.5:1.

Explicitly out of scope for all of the above: changing which private requests run on **Load account data**, consolidating the four freshness implementations, shared polling or context architecture, table/chart refactors, and large-scale contrast migration in one step.

## 3. Known defects found and not fixed

1. **`Book` and `Tape` hide their Notional column at ≤680 px** (`hide-xs`). A data column disappearing on mobile is the same class of problem as the hidden cache badge. Fixing it needs a layout decision (stacked row vs. narrower column), not a class swap.
2. **Drawer height and scroll.** See checks 9 and 10 above; both need a real viewport.
3. **The SDK page's canonical-string inspector has no input validation.** It hashes user-supplied text and never mutates exchange state, so it was deliberately left out of the order-validation work.
4. **Bundle headroom is thin.** 178,861 B gzip against a 185,000 B ceiling — about 6.1 kB. Code splitting should be considered before the next module-scale addition, not after the budget check fails.
