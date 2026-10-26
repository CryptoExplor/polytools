# Review brief — independent review of the PolyTools frontend audit

**Audience:** ChatGPT, another AI reviewer, or a human owner.
**Purpose:** let you check this audit's work without re-reading 1,700 lines of findings, and tell the owner where you disagree.

---

## 1. What was reviewed

| Item | Value |
|---|---|
| Repository | `CryptoExplor/polytools` |
| Commit | `62a7518b2ccdbb7ddf5610ac83db78d41af46427` (`main`, PR #4 merge, merged 2026-10-26T10:22:51Z) |
| Working copy | `arena/793e90ca-polytools` at the same commit, clean tree |
| Frontend under review | `apps/web/src/` — 13 page modules (8,502 lines), 10 shared components (4,526), 16 libs (2,058), 1 stylesheet (2,278); 18,051 lines total |
| Routes | 15 `<Route>` entries (2 are legacy redirects), `account/*` rendering 6 sections, plus `/account/order-book` alias and a wildcard |
| Out of scope | `packages/core` accounting/custody internals, `backend/` behavior, deployment changes |

## 2. What the audit actually did

1. Read all frontend source listed above.
2. Re-checked every UX finding in `docs/audit/UX_AUDIT.md` against this commit and classified it remediated / still current.
3. Ran `npm test` (202 tests, 44 suites, pass), `npm run typecheck` (pass), `npm run build` (pass), `npm run check:performance` (pass), and started the Vite dev server (serves `/`, `/api/env`, `/api/markets` with `x-polytools-data-source: wire-samples`).
4. Rendered every route with `react-dom/server` and extracted visible text, control counts, and notice counts — used for the density table in `README.md` §6.
5. Wrote nine documents. No application code, test, dependency, or config was changed.

## 3. Evidence rules this audit claims to follow

- **Confirmed in source** — readable in the commit.
- **Confirmed in browser** — **never used**. No browser existed in the audit environment. If any document appears to claim visual verification, that is a defect in the document.
- **Confirmed by server render** — explicitly labelled; proves which strings/markup are produced, not appearance.
- **Likely / needs verification**, **Unknown** — used for layout, contrast, focus order, and rendering.

**Please falsify this first:** search the package for any sentence that implies a screenshot, device test, screen-reader run, or user study. There should be none.

## 4. The ten claims most worth checking

| # | Claim | Where to verify | How it could be wrong |
|---|---|---|---|
| 1 | There is no `<h1>` anywhere in `apps/web/src` | `grep -rn "<h1" apps/web/src` | A component may inject one at runtime |
| 2 | The closed mobile sidebar is focusable (no `inert`) | `Layout.tsx` sidebar, `styles.css` `@media (max-width: 960px)`, `grep -r inert` | Browser may exclude transformed off-screen content from the tab order (that is exactly why the finding is marked Likely, not Confirmed) |
| 3 | Market pages render two symbol selectors | `Layout.tsx` `ROUTE_META` + page modules' `SymbolSelect` | A mobile-only conditional could hide one (none was found) |
| 4 | Account sections render their title twice | `Portfolio.tsx:407` + `AccountAnalytics.tsx:955-963` | The `Card` title could differ enough to read as a section label — the SSR text shows identical titles |
| 5 | "Load your trades" performs a broad load including balances/fees | `AccountAnalytics.tsx` `load()` | The coordinator might partition internally in a way that makes the label honest — `loadAll` is called, so scope is broad |
| 6 | Provenance pill is hidden at ≤600 px when fresh | `PublicCacheStatus.tsx` conditional `hide-xs` | CSS cascade could override `.hide-xs` (it uses `!important`) |
| 7 | Two always-on warnings precede every account Load | `AccountAnalytics.tsx:965-985` | Counted from SSR: 2 notices on all six account routes |
| 8 | Page subtitles total 1,712 characters and the longest is 223 | `README.md` §6 (SSR measurement) | Only true for the empty state; loaded pages render more |
| 9 | Single 595 kB initial JS chunk, 12 static page imports | build output / `check:performance` | Would change if a build config changed since the audit |
| 10 | GitHub Pages deployment fails on `main` | `gh run view 40306963041` | Repository settings may have been fixed after 2026-10-26 |

## 5. Judgement calls a reviewer should challenge

1. **Is P0-3 (Load label vs actual read scope) really P0?** The audit argues it is a consent/expectation defect on private data. A reviewer could reasonably call it P1 and keep P0 purely for the provenance/mobile issues.
2. **Is the navigation restructuring worth the churn?** The audit proposes 9 visible items + a collapsed group and no route changes. A reviewer may argue that a first-run "start here" panel would achieve more with less disruption.
3. **Should `/book`, `/tape`, `/charts`, `/heatmap` become tabs of one market page?** The audit deliberately says no (independent pollers, independent state, would add network or lose state). A reviewer may disagree; if so, the argument must address polling and state loss.
4. **How far should copy shortening go on P&L and account security?** The audit marks several proposals **High risk** and excludes them from the first batch. A reviewer should confirm nothing financial was shortened into ambiguity.
5. **Is the density measurement (words per route) a fair proxy for cognitive load?** It is a proxy, not a metric; `/brand-kit` is asset-heavy but simple.
6. **Is a design-system extension sufficient, or does the app need a component library?** The audit argues extension, because the existing tokens and primitives are coherent and a library would add a dependency the repo deliberately avoids.

## 6. Open questions for the owner (blocking design decisions)

1. Should account "Load" become genuinely section-scoped (behaviour change with test work), or is a single honest label enough for now?
2. Are the account caveats ("not verified on this device", memory-discard) required to stay above the fold, or may they move into a disclosure with identical text?
3. Which mobile viewports matter for acceptance (390 px only, or 320 px too)?
4. Is `24hVolumeUsd` genuinely USD-normalised? The audit refuses to change the label without that answer.
5. Should `/sdk` and `/brand-kit` remain in the primary navigation at all?
6. Is the GitHub Pages deployment intended to be live, or is Cloudflare Workers the only real target?

## 7. What would change the audit's conclusions

- A **browser pass** showing the mobile sidebar is correctly excluded from tab order → P0-2 drops to P3.
- A **screenshot** showing the provenance pill visible at 390 px → P0-1 withdrawn.
- Confirmation that `Load your trades` is scoped internally → P0-3 withdrawn.
- Evidence that a **user study** shows the current navigation is learnable → P1-1 loses priority (the audit has no user data either way).
- A decision that testnet-only code execution is acceptable without a warning → P0-4 reduces to P2.

## 8. What a good review of this package looks like

1. **Check evidence**: pick 10 claims and verify them in the source. Report any that do not hold.
2. **Check internal consistency**: do the route counts, nav counts, and copy tables agree across the nine files?
3. **Check scope discipline**: does any proposal change accounting, custody, imports, gates, polling, or dependencies without saying so?
4. **Check copy safety**: does any proposed replacement drop a unit, a limitation, or a warning?
5. **Check the plan**: are acceptance criteria testable? Are "tests" achievable with the repo's existing `node:test` + SSR harness, or are they secretly browser-only?
6. **State a verdict** on the first batch: safe to implement / safe with changes / not safe.

## 9. Deliberate limits to repeat in any downstream summary

- No browser was used; no visual claim is verified.
- No assistive technology was used; no accessibility conformance is claimed.
- No live account, credential, or authenticated request was used.
- The testnet API was unreachable from the audit environment; public data came from labelled wire samples.
- No user research was conducted; journeys are source-derived scenarios.
