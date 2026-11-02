# Review brief — ten-part handoff

Use this as the plain-English starting prompt for another reviewer. Every material statement is expanded in the linked audit files. The working tree is authoritative; this brief is not a replacement for reading it.

## 1. Assignment and source of truth

Audit target: `/home/user/polytools` on `arena/2679a49c-polytools`, local HEAD `eab1b24b5d7578d04a57e5110db6cd3d81f64b71`, including all dirty files.

PR #4 is open at different head `bcb55d6e03f39bc99ac12fffb5e7eada1b5471ee`. Its Pages SUCCESS and Workers Builds FAILURE do not verify the working tree. Workers failure cause is unknown.

Before the eight audit documents were added, the tree had 31 modified, 9 deleted, and 6 untracked entries. Preserve every one. Full inventory: [CURRENT_STATE.md](./CURRENT_STATE.md) §2.

## 2. What the product currently is

PolyTools is a hash-routed React/Vite terminal with:

- credential-free public markets, tape, book, candles, heatmap, venue comparison, Zipper configuration, calculators, onboarding, SDK examples, and brand assets;
- authenticated read-only account balances/history, actual fills/fees, open/completed orders/details, transfers, exports, and experimental cost-basis/P&L;
- a public serverless GET/OPTIONS facade with per-isolate cache, not a private proxy;
- a browser-local encrypted Ed25519 vault and direct registered GET signing to the official testnet REST origin.

Wallet authentication and financial mutations are intentionally absent. SDK snippets can mutate testnet orders only when a user copies and runs them externally. An optional Worker cron can POST public-mover notifications to Telegram.

Route-by-route state: [CURRENT_STATE.md](./CURRENT_STATE.md) §§3–5.

## 3. Verification that is actually fresh

Using Node `v22.22.3` and existing dependencies:

- `npm test`: **126/126 tests passed in 21 suites**, 0 failed/skipped/todo;
- `npm run typecheck`: web and backend **passed**;
- `npm run build`: **passed**, with one 571.80 kB minified chunk warning;
- `git diff --check`: **passed for tracked changes** when run.

No install, browser, live public/private API, real account, SDK execution, deployment, Wrangler dry-run, dependency audit, lint, coverage, or assistive-technology check was performed. Synthetic fixtures and old owner documents are not live proof.

Exact record: [TEST_AND_VERIFICATION.md](./TEST_AND_VERIFICATION.md).

## 4. Custody and public/private security posture

**Confirmed strengths:** PBKDF2-SHA256/AES-GCM IndexedDB vault entries; nonextractable generation-scoped signing keys; key-pair/registered-ID validation; monotonic timestamps; aborts and cross-tab invalidation; memory-only partitioned private snapshots; exact-origin registered GETs; omitted credentials; rejected redirects; safe errors; DTO validation.

**Confirmed boundaries:** no private backend proxy, shared private cache, public-trade fallback, or in-app financial mutation was found. Account exports are explicit and coverage-labeled.

**Gaps/unknowns:** no code-owned request/import timeout; no repository-configured CSP/security-header set was found; deployed headers/rate limits are unknown; live CORS, permissions, schemas, account isolation, and server acceptance are unverified. Encryption does not make unlocked XSS or a compromised device safe.

Details: [SECURITY_AND_ACCOUNTING_AUDIT.md](./SECURITY_AND_ACCOUNTING_AUDIT.md) §§2–5.

## 5. R2 cursor imports and account exports

**Confirmed:**

- selected orders/fills/transfers imports follow opaque cursor chains sequentially with caps and progress;
- complete coverage requires cursor exhaustion and clean row reconciliation;
- cap-only results merge as labeled partial data;
- operation errors preserve the entire previous snapshot;
- cancellation preserves it too, but has no explicit cancellation notice;
- exports include loaded validated rows and manifests, not guaranteed complete history or R3 P&L.

Real cursor completeness, eventual consistency, order-lineage settlement state, and transfer-leg reconciliation remain live-unknown. Do not treat order-detail cursors as settlement watermarks.

Details: [CURRENT_STATE.md](./CURRENT_STATE.md) §§6 and 8; [SECURITY_AND_ACCOUNTING_AUDIT.md](./SECURITY_AND_ACCOUNTING_AUDIT.md) §7.

## 6. R3 FIFO/weighted-average accounting

**Confirmed implementation:** exact FIFO and moving weighted average; actual base/quote fee handling; opening lots/opening-zero provenance; explicit acquisitions/disposals/internal transfers; underflow and unknown-kind rejection; mixed-quote separation; exact recurring rationals.

**Confirmed gates:** opening basis, complete clean fills, all relevant flows resolved, valid internal counterparts, supported inventory, and one quote model are mandatory as applicable. A fresh labeled mark is additionally required for unrealized P&L. Realized can display without a mark; unrealized/total cannot. Total requires both. Missing values are Unavailable, not zero.

**Classification:** experimental user-assisted accounting, not verified tax output. Manual decisions are not independently statement-reconciled; R3 inputs are not shared across account sections or exported. The withdrawn “zero required flows” P0 must not be restored.

Details: [SECURITY_AND_ACCOUNTING_AUDIT.md](./SECURITY_AND_ACCOUNTING_AUDIT.md) §§8–9.

## 7. Most important UX/accessibility findings

- **P1:** account Load labels hide broad request scope and a catalog dependency; catalog failure can block unrelated views.
- **P1:** shared ConfirmDialog/Glossary/mobile-navigation focus containment/restoration is incomplete; measured meaningful-text tokens fall below 4.5:1 in both themes.
- **P1 before promotion:** SDK trading snippets are unvalidated/uncompiled and need explicit external-mutation warnings.
- **P2:** Dashboard Book opens private Orders instead of public `/book`; rows/sort headers nest interactive controls.
- **P2:** Tape/Book/Heatmap/DepthChart sometimes label quote notionals with `$` without a USD basis.
- **P2:** Heatmap can label a single-price non-zero book as having no non-zero liquidity.
- **P2:** Calculator polling can overwrite manual conversion prices; Hub defaults can masquerade as current telemetry.
- **P2/P3:** account copy drift, R2 silent cancellation, section-switch state loss, Compare zero-match fallback, keyboard visualization gaps, tab/menu/live-region inconsistencies.

Full evidence and positive existing behavior: [UX_AUDIT.md](./UX_AUDIT.md).

## 8. Backend, configuration, and maintenance risks

- Public handler: open CORS, GET/OPTIONS allowlists, per-isolate bounded TTL/single-flight cache; no app-level rate limiter found.
- Vite-only 502 fallback returns labeled wire samples and synthesizes some responses; production does not use it.
- Root build covers web only; root typecheck covers web/backend. Vercel runs Vite-only build and omits `build:all`'s typecheck.
- Two Wrangler deployment shapes plus Pages/Vercel/Node adapters require target-specific validation.
- Optional Worker cron has a separate Telegram side effect.
- Large modules and repeated formatting/focus patterns increase conflict risk; refactor only at tested change seams.
- Fresh bundle warning exists; real performance is unmeasured.
- No fresh dependency audit or Node version matrix was run.

Details: [TECHNICAL_DEBT.md](./TECHNICAL_DEBT.md).

## 9. Priority roadmap

**P0 — verification/release gates, not confirmed defects:**

1. Establish the exact release tree and sanitized evidence boundary.
2. Complete owner-run live CORS/permission/schema/cursor/account-isolation/fee/flow verification.
3. Keep R3 experimental and out of tax/production claims pending independent review and interactive proof.

**P1:** request/import timeouts; honest/narrow account loading; shared focus and contrast; SDK generator safety; browser regression suite; evidence-based Workers diagnosis and aligned CI.

**P2:** Dashboard route/controls; quote units; heatmap flat books; Calculator/Hub states; account copy/lock consistency; R2 cancellation and section lifecycle; visualization semantics; sample parity; deployment headers/rate limits; Compare empty state.

**P3:** small copy/empty states; Worker wording; external freshness checks; measured bundle work; narrow tested extraction; runtime/dependency checks; documentation lifecycle.

Acceptance criteria and guardrails: [ROADMAP.md](./ROADMAP.md).

## 10. Instructions for the next reviewer

1. Read the working tree and dirty inventory before trusting this or any earlier summary.
2. Do not reset, clean, overwrite, commit, push, merge, rebase, deploy, install dependencies, or modify PRs without explicit user direction.
3. Do not use real credentials or make authenticated/financial requests. Keep owner evidence sanitized.
4. Preserve exact decimals, cursor coverage, session invalidation, safe errors, independent permissions, and R2/R3 fail-closed gates.
5. Never turn missing financial data into zero, public trades into private fills, current fee rates into historical fees, or unresolved transfers/marks into P&L.
6. Keep wallet auth and financial mutations out of scope.
7. Do not delete files based on apparent non-use; verify references/history and record proposals first.
8. Mark each material conclusion Confirmed, Likely, or Unknown / Not verified and cite a path, symbol, test, or command.
9. Run only authorized verification and report exactly what was and was not executed.
10. Prefer narrow testable fixes over speculative features, decorative dashboards, broad cleanup, or style-only R2/R3 refactors.

Document map: [audit README](./README.md).
