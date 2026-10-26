# Frontend simplification — status

PolyTools explains itself several times before showing the tool or the data. This work removes the repetition without removing information.

**Implemented:** batches 1–3, plus the four roadmap items that were waiting on a decision (P1-5, P1-6, P1-10, P1-13), on branch `arena/793e90ca-polytools` (PR #5), branching from `main` at `62a7518`.
**Verification:** automated checks pass · **browser pass outstanding** — no visual or keyboard claim is made anywhere below.

The audit findings, copy inventory, navigation proposal, journey maps, and the per-batch implementation records have been retired now that the work they described is merged into the tree. They remain in git history and in the PR description. What is *not* finished lives in [REMAINING_WORK.md](./REMAINING_WORK.md): the 29-step browser pass, three roadmap items that still need an owner decision, and one defect that is fixed in code but unconfirmed (drawer height and scroll).

---

## What changed

| Area | Before | After |
|---|---|---|
| Page headings | no `<h1>`; titles rendered as `<h2>`; a static `Read-only · Testnet` eyebrow above every title | one `<h1>` per page, card titles `<h2>`, badge-only eyebrow |
| Names per destination | sidebar, breadcrumb, and heading each used a different name | one short name shared by sidebar and breadcrumb; the heading contains it |
| Symbol selector | two identical selects on six market pages | one, owned by the shell |
| Public copy | 1,712 characters of page-header description | 1,397 (−18.4%), with every stated limit retained |
| Freshness words | `Syncing…` / `No data yet` / `Retry now` / internal error prefixes | `Updated … ago` / `Loading…` / `Waiting for data` / `Try again` / plain-language error headings |
| Cache provenance | hidden below 600 px when fresh | visible at every width |
| `/portfolio` | redirected to API setup | redirects to the account overview |
| Retry controls | `danger`-styled | neutral; only destructive actions are red |
| Table figures | proportional digits | `tabular-nums` alignment |
| Mobile drawer | closed menu stayed in the tab order; no focus handling | `inert` only when the layout is narrow **and** closed (desktop sidebar never disabled), focus enters and returns |
| Dialogs | two overlays declared `aria-modal` with no trap, no restore, duplicate ids | one `useDialogFocus` hook for all three, `useId()` ids, stacked-overlay aware |
| Glossary | label hidden on phones | visible label plus explicit `aria-label` |
| Mobile tables | `Book`/`Tape` dropped the Notional column below 680 px; Match ID and age crowded the price row | every column stays; the match metadata restacks onto its own line; the ladder keeps four columns; the `Read-only · <network>` badge wraps rather than disappearing |
| Mobile drawer | fixed `100vh` with page scroll still live behind it | `height: auto` capped at `100%`, `overscroll-behavior: contain`, and a body-scroll lock while open |
| Text contrast | meaning-carrying `.faint`/`.muted` text at 2.40:1–4.20:1 | text roles `--text-muted` and `--text-caption`; all 54 token×surface pairs ≥4.5:1 in both themes, gated by `check:contrast` |
| Tape alerts | an always-open control panel above the tape | trades first; alerts collapsed below with a summary line that reports the live threshold, sound, and desktop state |
| Account warnings | two always-on notices above every account view | one status line plus a `What this means` disclosure holding both paragraphs word for word |
| Money movements | a choice card with a notice plus a second notice | one card, the choice in its header, one-line description, `?scope=` contract unchanged |
| SDK inspector | hashed whatever was typed, valid or not | `canonicalRequest.ts` reports one issue per field and never rewrites the input |
| First paint | every page and its dependencies in one 179 kB-gzip bundle | landing route only, every other page a lazy chunk behind `Suspense` (96.94 kB gzip initial) |
| Account tabs | six long labels, horizontally scrolling | `Overview · Key setup · Trades · Orders · P&L · Deposits`, active tab scrolled into view |
| Account load action | five different verbs implying five different scopes | one label; the requests themselves are unchanged |
| SDK snippets | copy-paste code that could place a real testnet order, never validated | always-visible warning, plus order drafts validated against `tickSize`/`stepSize`/minimums before a snippet or copy is offered |

## Verification

| Check | Result |
|---|---|
| `npm test` | 284/284, 63 suites |
| `npm run typecheck` | pass (web + backend) |
| `npm run build` | initial 304.73 kB JS / 96.93 kB gzip-9, 35.13 kB CSS / 7.20 kB gzip-9; 609.30 kB across all chunks |
| `npm run check:performance` | 4/4 budgets — JS gzip headroom ~88 kB of 185,000 B; CSS bytes 35,133 of 40,000 |
| `npm run check:contrast` | 54/54 token×surface pairs ≥4.5:1, both themes |
| `npm run check:whitespace` | 173/173 files, 0 violations |
| `npm run check:runtime` / `check:dependencies` / `check:external` | pass / 0 licence or version gaps / 0 SDK pin mismatches |
| relative Markdown links | 40 checked, 0 broken |

These numbers describe the tree, not the screen. No browser was available, so no visual, pointer, or
keyboard claim is made here — that pass is §2 of [REMAINING_WORK.md](./REMAINING_WORK.md).

Region map of the implementation, if something needs changing later:

- `apps/web/src/lib/orderConstraints.ts` — order-draft validation and exact decimal maths
- `apps/web/src/lib/canonicalRequest.ts` — canonical-string inspector validation (display only)
- `scripts/check-contrast.mjs` — the contrast gate; `tests/contrast-tokens.test.mjs` keeps it honest
- `apps/web/src/lib/dialogFocus.ts` — the shared modal contract
- `apps/web/src/components/{ui,Layout,Glossary,PublicCacheStatus}.tsx` — headings, shell, dialogs, provenance
- `apps/web/src/pages/*.tsx` — copy and layout per route
- `tests/frontend-batch1.test.mjs`, `tests/sdk-order-constraints.test.mjs`, `tests/dialog-focus.test.mjs`, `tests/canonical-request.test.mjs` — the guards that keep all of the above true
