# Frontend simplification — status

PolyTools explains itself several times before showing the tool or the data. This work removes the repetition without removing information.

**Implemented:** batches 1–3 on branch `arena/793e90ca-polytools` (PR #5), branching from `main` at `62a7518`.
**Verification:** automated checks pass · **browser pass outstanding** — no visual or keyboard claim is made anywhere below.

The audit findings, copy inventory, navigation proposal, journey maps, and the per-batch implementation records have been retired now that the work they described is merged into the tree. They remain in git history and in the PR description. What is *not* finished lives in [REMAINING_WORK.md](./REMAINING_WORK.md): the browser pass, seven unimplemented roadmap items, and four known defects.

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
| Account tabs | six long labels, horizontally scrolling | `Overview · Key setup · Trades · Orders · P&L · Deposits`, active tab scrolled into view |
| Account load action | five different verbs implying five different scopes | one label; the requests themselves are unchanged |
| SDK snippets | copy-paste code that could place a real testnet order, never validated | always-visible warning, plus order drafts validated against `tickSize`/`stepSize`/minimums before a snippet or copy is offered |

## Verification

| Check | Result |
|---|---|
| `npm test` | 253/253, 57 suites |
| `npm run typecheck` | pass (web + backend) |
| `npm run build` | 599.67 kB JS / 179.19 kB gzip |
| `npm run check:performance` | 4/4 budgets — gzip headroom ~6.3 kB of 185,000 B |
| `npm run check:whitespace` | 179/179 files, 0 violations |
| `npm run check:runtime` / `check:dependencies` / `check:external` | pass / 0 licence or version gaps / 0 SDK pin mismatches |

Region map of the implementation, if something needs changing later:

- `apps/web/src/lib/orderConstraints.ts` — order-draft validation and exact decimal maths
- `apps/web/src/lib/dialogFocus.ts` — the shared modal contract
- `apps/web/src/components/{ui,Layout,Glossary,PublicCacheStatus}.tsx` — headings, shell, dialogs, provenance
- `apps/web/src/pages/*.tsx` — copy and layout per route
- `tests/frontend-batch1.test.mjs`, `tests/sdk-order-constraints.test.mjs`, `tests/dialog-focus.test.mjs` — the guards that keep all of the above true
