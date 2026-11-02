# Frontend simplification — what is still open

Batches 1–3 are implemented and guarded by tests. This round closed the four roadmap items that
were waiting on a decision plus three of the four known defects, and it added a contrast gate.

What is *not* closed is a browser pass: no browser was available here, so nothing below claims a
visual, pointer, or keyboard result. Every "verified" statement on this page is something a script
can prove from source, markup, arithmetic, or a build artifact.

| | Status |
|---|---|
| Automated gates | green — see §1 |
| Roadmap items P1-5, P1-6, P1-10, P1-13 | implemented, guarded by tests |
| Known defects 1, 3, 4 | fixed in code |
| Known defect 2 (drawer height and scroll) | fixed in code, **needs a viewport to confirm** |
| Browser pass (23 steps) | **outstanding** — §2 |
| Roadmap items P1-1, P1-4 (remainder), P1-8 | still need an owner decision — §3 |

---

## 1. What this round changed, and how it is checked

| Change | Guard |
|---|---|
| Contrast: text roles `--text-muted` / `--text-caption`; `.faint` moved to `--text-caption`; `--text-faint` now documented as decorative and used by exactly one separator | `scripts/check-contrast.mjs` (54 token×surface pairs, all ≥4.5:1 in both themes), `tests/contrast-tokens.test.mjs` |
| Tape: alerts collapsed below the tape behind *Set up alerts*; the summary line reports the live threshold, sound, and desktop state | existing tape tests, `npm run typecheck`, whitespace gate |
| Account copy: remove duplicate route/panel headings; keep compatibility, session-memory, and empty-data guidance in a collapsed `What this means` disclosure | account UX tests (single heading; safe empty/denied states retained) |
| Money Movements: one card, the choice in the card header, one-line description; the duplicated notice is gone; `?scope=` deep-link behaviour untouched | `tests/account-ux.test.mjs`, `tests/phase3-ux.test.mjs` |
| Mobile: Tape/Book keep Notional; Match ID/age restacks onto its own line; the ladder keeps four columns; the `Read-only · <network>` badge wraps instead of hiding; `.hide-xs` and `.hide-sm` deleted | `tests/frontend-batch1.test.mjs` (mobile data visibility block) and the shell/cache tests assert no width class hides content |
| Drawer: `height: auto; max-height: 100%; overscroll-behavior: contain` plus a body-scroll lock while open (restored on close) | `tests/dialog-focus.test.mjs`, shell tests |
| SDK inspector: `apps/web/src/lib/canonicalRequest.ts` validates timestamp/path/query/body and never rewrites input; the panel renders the issues with `aria-invalid` / `aria-describedby` | `tests/canonical-request.test.mjs` (14 cases) |
| Bundle: every page except the landing route is a lazy chunk behind `Suspense` | `npm run check:performance` — initial JS halved |

Measured, this commit: initial JavaScript **304,667 B / 96,910 B gzip-9** against a 185,000 B ceiling
(~88 kB headroom, previously ~6 kB); CSS **35,133 B / 7,198 B gzip-9**. Total JavaScript across all 13 emitted JS chunks is 601.66 kB / 189.10 kB gzip-9 — larger in total, smaller on first paint, which is the point.
The stylesheet is now at 88% of its 40,000 B budget: run `npm run check:performance` before adding
another sizable block, and prefer trimming a rule to raising the ceiling.

Contrast, measured per theme across `--bg`, `--bg-shell`, `--bg-panel`:
dark muted 5.49 / caption 6.65; light muted 5.18 / caption 5.67; light up 4.77, down 5.47, warn
5.04, info 5.16, accent-text 5.11; dark up 7.31, down 5.05, warn 8.63, info 8.65, accent-text 6.35.
Re-run with `npm run check:contrast`. These are computed ratios, not a visual judgement: they say
nothing about how the page looks, only that no meaning-carrying text falls below 4.5:1.

---

## 2. Browser pass — required to close the implementation

Record the browser name/version and the commit tested next to each row. Widths: **390**, **768**,
**1280** px.

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
9. 390 px: the last nav item is reachable when the browser toolbar is collapsed. The drawer is now `height: auto` capped at `100%` with `overscroll-behavior: contain`; confirm in the browser that no nav item is cut off and that nothing overshoots the viewport.
10. 390 px: scrolling behind the open drawer. The shell now locks `document.body.style.overflow` while the drawer is open and restores it on close; confirm the page behind the backdrop does not move and that the page scroll position survives closing it.
11. 1280 px: the sidebar is visible with the drawer closed, every nav item is focusable, the burger is hidden, and **no `inert` attribute sits on the sidebar** (check in devtools).
12. 768 px: off-canvas behaviour matches 390 px; nothing overlaps the topbar; no horizontal scrollbar on `/book`, `/tape`, `/account`.

### Mobile tables (new this round)

13. 390 px `/tape`: Time, Side, Price, Qty, **Notional** are all visible; Match ID and age sit on a second line under the row; no horizontal scrolling; the table header stays aligned with its cells.
14. 390 px `/book`: the ladder keeps four columns (Price, Size, Total, **Notional**) without clipping, and the mid-price row stays centred.
15. 390 px `/tape`: the Alerts panel starts collapsed below the tape, the summary line matches the current threshold/sound/desktop state, *Set up alerts* expands it, and the controls inside behave exactly as before (test alert, threshold select, sound, desktop).

### Dialogs

16. 1280 px, API setup → *Delete all keys*: Tab cycles Cancel → Delete → Cancel, Shift+Tab mirrors it, Escape closes, focus returns to the opener, the page behind does not scroll.
17. 390 px: the glossary button shows the word "Glossary"; opening it focuses the search field; Tab stays inside; Escape returns focus to the button; the route does not change.
18. Stacked overlays: from inside the order-details drawer trigger a confirmation — Tab must stay in the confirmation, Escape must close only it, and closing must leave the drawer open, scroll still locked, and focus back on the triggering button.
19. Logout / "Forget all" / export flows still complete (all three use `ConfirmDialog`).

### Account tabs and routing

20. 390 px: count the visible tabs (six expected with the short labels); after navigating between sections the active tab is scrolled into view and announced via `aria-current`.
21. `#/portfolio` lands on the account overview; `#/portfolio?x=1` keeps its query string; `#/account/transactions?scope=public` still opens the public lookup and `#/flow` still redirects identically.
22. 768 px and 390 px: full Tab-only pass over `/`, `/book`, `/account` — no trap, no invisible focus, skip link still targets the main workspace.
23. Account overview at 390 px: the status line (key/pair/verification) fits without wrapping awkwardly, and *What this means* opens to both original paragraphs, legible and scrollable.

### SDK order validation and inspector

24. 390 px and 1280 px, step *4. Place & Cancel Order*: the warning sits above the inputs and the reason list is readable without horizontal scrolling.
25. Type `0.001` on `AVAX-USDT` (minimum `0.1`): the notice appears, copy is disabled, and the announcement is sensible.
26. **Use Live price** on a `0.00001`-tick market (e.g. `DOGE-USDT`): the price lands on the tick grid and the notice clears.
27. Copy a valid snippet: pasted values match the inputs exactly and carry no more decimals than the pair allows.
28. Canonical-string inspector, both widths: enter an empty path, a 10-digit timestamp, and `a=b&` — each field shows one plain-language issue, the string is not silently rewritten, and the issue list is announced once; correct the fields and the notice disappears.

### Navigating away

29. Every route above loads as a lazy chunk: the page paints its loading placeholder, never a blank screen, and a hard reload of a deep link (`#/account/orders`) lands on that page.

---

## 3. Unimplemented roadmap items — each needs an owner decision

| ID | Item | Why it is waiting |
|---|---|---|
| P1-1 | Navigation: ≤10 visible rail items, collapsible *Learn & developers*, no one-item group, the six account sections only in the tab strip | Changes the information architecture and every visible label. No route would be removed. |
| P1-4 | Dashboard: move the intro out of `<main>`, hide the metric strip until the first response (or render skeletons at final size) | Partly done — subtitle and **Download CSV** shipped in batch 1. The rest changes the landing page's first paint. |
| P1-8 | Warn before leaving an account section that has loaded or unsaved data | Touches the disposal path; needs a definition of "work worth warning about" and must not block Lock / Forget all. |

Explicitly out of scope for all of the above: changing which private requests run on **Load account
data**, consolidating the four freshness implementations, shared polling or context architecture,
table/chart refactors, and large-scale contrast migration beyond the text roles above.

## 4. Known defects

1. ~~`Book` and `Tape` hide their Notional column at ≤680 px~~ — **fixed.** The column stays, the
   row restacks, and `.hide-xs` no longer exists in the stylesheet.
2. **Drawer height and scroll** — **fixed in code, unconfirmed.** `height: auto` with
   `max-height: 100%`, `overscroll-behavior: contain`, and a body-scroll lock while open. Checks 9
   and 10 in §2 are the confirmation; if `100%` misbehaves in a real viewport, `100dvh` is the fallback.
3. ~~The SDK page's canonical-string inspector has no input validation~~ — **fixed.**
   `apps/web/src/lib/canonicalRequest.ts` reports one issue per field and never rewrites the input.
4. ~~Bundle headroom is thin~~ — **fixed.** Lazy routes cut the initial payload from 179.22 kB to
   96.91 kB gzip-9, so the ceiling now has ~88 kB of room.

## 5. Running the gates

```sh
npm test                  # 285 tests, 63 suites
npm run typecheck
npm run build
npm run check:performance # 4/4 budgets
npm run check:contrast    # 54/54 pairs ≥ 4.5:1
npm run check:whitespace
npm run check:runtime
npm run check:dependencies
npm run check:external
```

A green run means the claims in §1 hold for the tree as committed. It does not mean any page has
been seen.
