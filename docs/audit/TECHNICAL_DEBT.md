# Technical debt and maintenance risks

## 1. Review stance

This file identifies maintenance risk, not permission for broad cleanup. R2/R3 accounting, validation, pagination, and lifecycle code should not be refactored merely for style. Useful public features and tests should remain. No file should be deleted based only on apparent non-use.

All items are **Confirmed** from current source/configuration unless marked otherwise.

## 2. Priority map

| ID | Priority | Risk | Primary evidence |
|---|---|---|---|
| TD-01 | P1 | Live/deployment claims can outrun the actual tree and verification. | Git/PR metadata; `TEST_AND_VERIFICATION.md` |
| TD-02 | P1 | Account loading is broadly coupled and has no code-owned deadline. | `AccountAnalytics.tsx`, `account/data.ts`, `account/rest.ts` |
| TD-03 | P1 | Browser-critical workflows rely mostly on unit, SSR, and source assertions. | `tests/*.test.mjs`, package scripts |
| TD-04 | P2 | Development fallback and production handlers can diverge. | `apps/web/vite.config.ts`, `backend/src/handler.ts` |
| TD-05 | P2 | Build/deploy paths do not run identical checks and have multiple configuration sources. | `package.json`, `vercel.json`, both Wrangler files |
| TD-06 | P2 | Large route/account modules concentrate unrelated states and make safe review expensive. | Web/core file inventory |
| TD-07 | P2 | Public formatting and interaction patterns are duplicated with unit/accessibility drift. | Dashboard/Tape/Book/Heatmap/DepthChart/shared UI |
| TD-08 | P2 | Static external SDK/resource content can stale without compile/link checks. | `SdkGuide.tsx`, `brand.ts`, `Hub.tsx` |
| TD-09 | P3 | Single large static bundle and limited performance budgets. | Fresh Vite build; `App.tsx` |
| TD-10 | P3 | Repository hygiene/attribution is currently difficult. | 46-entry baseline dirty tree, deleted research files |

## 3. TD-01 — Source-of-truth and release drift

Local HEAD is `eab1b24b5d7578d04a57e5110db6cd3d81f64b71`; PR #4 is `bcb55d6e03f39bc99ac12fffb5e7eada1b5471ee`; the audited working tree contains additional modified/deleted/untracked files. PR checks therefore do not verify the audit target.

**Risk:** a reviewer may test one tree, document another, and deploy a third. A Pages success can be mistaken for full deployment health even while Workers Builds fails.

**Recommended direction:**

1. Preserve the current tree and produce a reviewable inventory/ownership decision for each mixed change.
2. Reconcile the intended commit/PR only with explicit user direction; this audit does not commit or push.
3. Run checks on the exact intended deployment tree and record commit hashes with sanitized owner evidence.
4. Treat Workers failure cause as unknown until owner logs are available.

## 4. TD-02 — Account request orchestration combines unrelated concerns

`AccountAnalytics.load` handles public catalog setup, clock offset, broad private snapshot loading, balance history, open orders, detail requests, import state, errors, and visibility refresh. A view-specific button consequently triggers unrelated operations and inherits catalog failure.

Neither REST requests nor the overall cursor import has a code-owned timeout.

**Risk:** unrelated outages block useful private views; pending states can persist; changes to one view can affect all account operations.

**Recommended direction:**

- First characterize request scope and failure independence with tests.
- Separate catalog-dependent fill normalization from non-catalog datasets without weakening validation.
- Add safe bounded deadlines with previous-snapshot preservation.
- Only then consider extracting orchestration hooks. Do not make open orders part of `loadAll()` merely to simplify the UI or hide an empty state.

## 5. TD-03 — Verification gap at the browser boundary

The fresh suite passes 126 tests/21 suites, but there is no browser automation configuration and almost no public-page behavioral coverage. R2/R3 UI tests are SSR/source assertions; no successful interactive R3 resolution or R2 import/cancel/export workflow is exercised.

No root lint, coverage, accessibility, or end-to-end script was found. `git diff --check` does not cover untracked files.

**Risk:** invalid nested controls, focus loss, route-action mistakes, clipboard failures, responsive overflow, and poll/timer overwrite behavior can survive typechecks and SSR tests.

**Recommended direction:**

- Add a small browser suite around existing critical flows rather than replacing useful unit tests.
- Prioritize route actions, overlays, account lifecycle, cursor import, R3, exports, and the concrete public bugs in `UX_AUDIT.md`.
- Add coverage reporting for visibility, but do not turn a percentage target into a substitute for financial invariants.
- Keep synthetic tests and live owner verification clearly separate in scripts and documentation.

## 6. TD-04 — Development wire samples simulate more than static replay

The Vite middleware falls back only in development after an upstream 502. It labels responses as `wire-samples`, but also rewrites symbol/depth/timeframe parameters, filters trades, derives Zipper route responses, and synthesizes flow validation/not-found behavior.

**Risk:** a developer can see a polished “working” route that does not prove production parameter handling, upstream schemas, latency, error shape, or not-found semantics. Compact provenance pills may be missed.

**Recommended direction:**

- Add contract tests comparing fallback and production handler validation for the same request matrix.
- Make sample mode persistently obvious in development.
- Avoid extending synthetic behavior to private account reads.
- Do not remove useful offline fixtures; clarify and test their boundary instead.

## 7. TD-05 — Build and deployment checks differ by target

- Root `npm run build` runs only web `build:all`; backend typecheck is a separate root `typecheck` step.
- `vercel.json` runs `npm -w apps/web run build`, which is Vite only and omits the `tsc` included in `build:all`.
- Root Wrangler and backend Wrangler define different deployment shapes, while Pages Functions, standalone Worker, Vercel Edge, and Node adapters add further entry points.
- The optional cron exists in the Worker path, not as a universal behavior of every adapter.

**Risk:** one target can build while another fails typechecking or runtime validation; documentation can overgeneralize adapter behavior. The existing Workers Builds failure has no proven cause.

**Recommended direction:**

- Define one CI gate that always runs tests, root typecheck, and the intended build.
- Align Vercel's build with the typechecked path where practical.
- Add adapter-specific dry-run/smoke scripts without deploying during ordinary tests.
- Document cron and static-asset support per target.
- Obtain the actual Workers log before changing Node/Wrangler/configuration as a speculative fix.

## 8. TD-06 — Large modules increase review concentration

Current approximate source sizes from `wc -l` include:

- `apps/web/src/components/AccountAnalytics.tsx`: 1,221 lines;
- `packages/core/src/account/vault.ts`: 1,160 lines;
- `apps/web/src/pages/SdkGuide.tsx`: 1,138 lines;
- `apps/web/src/pages/Portfolio.tsx`: 1,023 lines;
- `packages/core/src/account/data.ts`: 871 lines;
- `apps/web/src/pages/Calc.tsx`: 850 lines;
- `packages/core/src/account/lots.ts`: 774 lines;
- `apps/web/src/components/ui.tsx`: 780 lines.

**Risk:** unrelated UI, network, accounting, and lifecycle changes conflict; reviewers miss state transitions; source-assertion tests become coupled to large strings.

**Recommended direction:** do not start a broad decomposition. Extract only when a concrete fix needs a seam—for example, shared overlay focus management, quote-aware formatting, or a tested account-load orchestration boundary. Preserve public exports and financial behavior with characterization tests.

## 9. TD-07 — Repeated formatting and interaction patterns have drifted

Examples:

- `$` is manually attached to quote notionals in several tools instead of using a quote-aware formatter.
- Dashboard combines custom row keyboard behavior, nested buttons, sort buttons, and tooltip buttons.
- Order details has robust focus handling, while ConfirmDialog/Glossary/mobile navigation implement different partial overlay patterns.
- Tabs, segmented controls, menus, live regions, and copy buttons have inconsistent semantics.

**Risk:** future pages copy the wrong unit or accessibility pattern; a fix in one component does not reach the others.

**Recommended direction:** introduce narrow shared primitives only with regression tests: quote-aware notional formatting, overlay focus utility, and honest segmented/tab semantics. Avoid a design-system rewrite.

## 10. TD-08 — External content and generated SDK snippets lack freshness gates

`SdkGuide.tsx` contains pinned package versions, capability matrices, and generated TypeScript/Python/Rust code. Quantity/price/key ID interpolation is not validated, and snippets are not compiled. Hub and Brand Kit contain external links/assets whose current availability was not checked.

**Risk:** “ready-to-run,” “official,” or “verified” copy can become stale; a pair's actual tick/step can differ from hardcoded formatting; copied trading snippets can fail or have unintended testnet effects.

**Recommended direction:**

- Put generated examples behind explicit version/provenance labels.
- Compile/test read-only snippets and safely inspect trading snippets without executing mutations in CI.
- Validate user inputs against catalog constraints and escape them for each target language.
- Add an external link/asset check as a separate, non-financial scheduled check with clear network provenance.
- Keep wallet authentication and in-app trading out of scope.

## 11. TD-09 — Bundle and polling performance need measurement, not guesses

The fresh production build succeeds but emits one 571.80 kB minified JavaScript chunk (170.00 kB gzip), above Vite's 500 kB warning. `App.tsx` statically imports all pages. Multiple pages poll at different intervals; Compare also depends on CoinGecko.

**Risk:** slower initial load and parsing, especially on mobile; more simultaneous requests across mounted tools; cache benefits vary by deployment isolate.

**Unknown / Not verified:** real Web Vitals, memory use, low-end device behavior, origin quota consumption, and whether route splitting improves the user experience enough to justify it.

**Recommended direction:** measure first. If needed, add route-level lazy imports with suspense/error boundaries and a bundle budget in CI. Do not remove useful public tools merely to silence the warning.

## 12. TD-10 — Dirty-tree and documentation lifecycle

The baseline tree includes 31 modified, 9 deleted, and 6 untracked entries, including deleted `research/account-analytics` documents and `packages/core/src/keys.ts`, plus untracked R3 source/tests. Mixed files have unclear PR/worktree attribution.

**Risk:** a later agent may overwrite work, restore deleted material without intent, delete untracked R3 files as “unused,” or assume PR checks cover them.

**Recommended direction:**

- Keep `docs/audit/CURRENT_STATE.md` as the baseline inventory for this review.
- Propose any deletion/restoration explicitly and verify references, scripts, tooling, docs, and history first.
- Reconcile ownership with the user before committing or changing the PR.
- Update README and live-verification wording only through reviewed, narrow changes; do not rewrite owner evidence.

## 13. Dependency and runtime assurance is incomplete

Only Node `v22.22.3` was used for fresh verification. The root package declares Node `>=18`, but no Node 18/20/22 matrix was run. No fresh dependency vulnerability audit, license scan, or SBOM was produced.

**Status:** **Unknown / Not verified.** Historical vulnerability counts are not reused as current evidence.

**Recommended direction:** after explicit authorization and without opportunistic upgrades, run a reproducible dependency audit and supported-runtime matrix in CI. Review account/WebCrypto/Worker compatibility separately from npm vulnerability severity.

## 14. Recommended maintenance order

1. Reconcile what tree is intended for release and complete owner/live verification without exposing secrets.
2. Fix request deadline/failure-independence issues with regression tests.
3. Add browser tests around existing high-risk workflows and concrete public defects.
4. Make small shared fixes for focus, quote units, and misleading unknown-state copy.
5. Align build/adapters and diagnose Workers from actual logs.
6. Measure bundle/runtime performance before code splitting or decomposition.
7. Consider larger module boundaries only when a tested behavioral change justifies the conflict risk.
