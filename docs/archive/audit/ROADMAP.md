# Prioritized review roadmap

## How to use this roadmap

This is a proposal, not work performed by the audit. Priorities reflect release risk and evidence gaps, not a request to begin broad refactoring.

**There is no confirmed P0 code/accounting defect in the current evidence.** P0 below contains release/verification gates. A gate is not proof that the live system is broken; it means the repository must not claim the corresponding assurance without evidence.

Confidence labels and detailed evidence are in the linked audit documents. Fresh local baseline: 126/126 tests, web/backend typechecks, production build, and tracked `git diff --check` passed; live/browser/deployment behavior remains unverified.

## P0 — Gates before live-compatible or real-data claims

### P0-1 — Establish the exact release candidate and owner evidence boundary

**Evidence:** `CURRENT_STATE.md` §§1–2; `TECHNICAL_DEBT.md` TD-01.

**Why:** local HEAD, PR #4 head, and dirty working tree differ. Existing PR checks do not verify this audit target.

**Proposed work:**

- With explicit owner direction, reconcile which mixed/deleted/untracked changes belong in the release candidate. Do not reset or discard work to make the tree convenient.
- Record the exact commit and remaining dirty state for every verification report.
- Keep owner live artifacts sanitized and separate from source changes.

**Done when:** a reviewer can reproduce tests/build on the exact intended tree and no check is attributed to a different commit or working tree.

### P0-2 — Complete sanitized owner-run live account verification

**Evidence:** `SECURITY_AND_ACCOUNTING_AUDIT.md` §§4, 10–11; `TEST_AND_VERIFICATION.md` §5.

**Why:** synthetic tests do not establish CORS, permissions, real schemas, cursor coverage, account isolation, fee/leg reconciliation, or current server behavior.

**Proposed work:** run the existing owner checklist using a controlled test account and least-privilege read key. Cover every registered read independently, denial behavior, lock/wipe, cursor exhaustion/caps, account scopes, actual execution fees, order lineage, transfers, and R3 inputs. Never commit keys, signatures, raw private responses, or sensitive identifiers.

**Done when:** sanitized results support each claimed operation and failure state. Any failure receives an evidence-based priority; absent evidence remains Unknown rather than being called success.

### P0-3 — Keep R3 out of tax/production reporting claims until independently reviewed

**Evidence:** `SECURITY_AND_ACCOUNTING_AUDIT.md` §§8–9; `UX_AUDIT.md` UX-A5.

**Why:** exact arithmetic and fail-closed gates are implemented, but manual provenance and flow decisions are not independently reconciled, and no complete interactive workflow was verified.

**Proposed work:** retain the experimental/user-assisted label. Have a qualified accounting reviewer validate method semantics and owner-provided evidence for the intended use case. Add successful and blocked browser workflows.

**Done when:** supported claims match the reconciliation actually performed. Until then, no tax-output, filing-ready, or universally accurate P&L claim.

## P1 — High-value reliability, safety, and accessibility work

**Implementation status (2026-10-26).** The underlying findings in `UX_AUDIT.md` are left as
written; what has since shipped is recorded in
[../frontend-audit/README.md](../frontend-audit/README.md) and
[../frontend-audit/REMAINING_WORK.md](../frontend-audit/REMAINING_WORK.md).

- **P1-1** — unchanged.
- **P1-2** — the copy half is done: one action label, and the description states that one click
  loads every dataset for the view. Narrowing which private reads run, and decoupling the catalog,
  are **still open**.
- **P1-3** — the focus half is done: one shared `useDialogFocus` utility now backs both dialogs and
  the order drawer, and the mobile sidebar is inert only when narrow *and* closed. Contrast-token
  migration (A11Y-2) is **still open**.
- **P1-4** — done for validation, tick/step/minimums, the always-visible mutation warning, and the
  removal of "safe"/"ready-to-run" wording. Compiling pinned examples in isolated tests is **not**
  done; `npm run check:external` only pins versions.
- **P1-5 and beyond** — unchanged.

### P1-1 — Add bounded account request/import deadlines

**Evidence:** `SECURITY_AND_ACCOUNTING_AUDIT.md` SEC-02.

**Change narrowly:** add explicit timeouts around registered reads and selected cursor imports, preserving previous snapshots and exact coverage. Distinguish timeout, cancellation, denial, malformed data, and empty success. Invalidate late responses.

**Regression proof:** stalled first page, stalled later page, user cancel, lock during timeout, cap-only success, temporary stale-data behavior, and no additional page after abort.

### P1-2 — Make account Load scope and catalog dependencies honest

**Evidence:** `UX_AUDIT.md` UX-A1.

**Change narrowly:** characterize current requests, then either narrow each view or explain a shared load. Allow balances/transfers to proceed without a fill catalog where the contract permits. Keep operations independently permissioned and validated.

**Regression proof:** catalog failure does not block unrelated non-fill views; “Load your trades” matches its requests; no open orders are silently folded into `loadAll()`; missing data never becomes zero/empty success.

### P1-3 — Repair shared overlay/mobile focus and meaningful-text contrast

**Evidence:** `UX_AUDIT.md` A11Y-1 and A11Y-2; measured ratios in `TEST_AND_VERIFICATION.md`.

**Change narrowly:** reuse the order drawer's focus pattern for ConfirmDialog, Glossary, and mobile navigation; manage inert/off-screen focus and opener restoration. Introduce accessible text tokens for both themes without erasing semantic state cues.

**Regression proof:** keyboard tab/shift-tab/Escape tests, route-change cleanup, mobile open/closed navigation, 200%/400% zoom review, normal/large/non-text contrast checks, and screen-reader smoke tests.

### P1-4 — Harden SDK generator claims and inputs without executing trades

**Evidence:** `UX_AUDIT.md` UX-P7; `TECHNICAL_DEBT.md` TD-08.

**Change narrowly:** label snippets as unexecuted external code, explain testnet mutations, validate/escape inputs, honor pair tick/step/minimums, and remove unqualified “safe/ready-to-run” claims. Pin and compile suitable examples in isolated tests; never submit orders in PolyTools CI.

**Regression proof:** malicious/invalid quote strings cannot break generated syntax, low-price/non-USD pairs retain precision, missing env secrets fail safely in example code, and generated read-only snippets compile against their stated SDK versions.

### P1-5 — Add critical browser regression coverage

**Evidence:** `TEST_AND_VERIFICATION.md` §§3–5; `TECHNICAL_DEBT.md` TD-03.

**Change narrowly:** add a small browser suite, retaining all current unit/regression tests. Cover account lock/load/import/cancel/export, a complete R3 success and each major blocked state, Dashboard actions, dialogs, calculator polling, Hub telemetry, and heatmap edge cases.

**Regression proof:** tests run against production-like assets with sample/network provenance explicit; no real credentials or live financial actions are required.

### P1-6 — Diagnose Workers Builds from evidence and align required checks

**Evidence:** `TECHNICAL_DEBT.md` TD-05; PR metadata in `TEST_AND_VERIFICATION.md`.

**Change narrowly:** obtain owner-accessible Cloudflare logs for the exact intended commit. Do not assume Node 20, Wrangler syntax, or any other root cause. Make CI run tests + root typecheck + intended build; align Vercel with the typechecked build where practical.

**Regression proof:** adapter-specific dry-run/smoke checks pass on the release candidate and the deployment report distinguishes Pages, Worker fetch, assets, and cron.

## P2 — Confirmed correctness, UX, and operational improvements

| Item | Proposed change and acceptance evidence |
|---|---|
| **P2-1 Dashboard destination and controls** (`UX-P1`, A11Y-3) | Point Book to `/book`; remove nested button/row activation conflicts and bubbled-key activation. Test mouse, Enter, Space, watchlist, every row action, and selected symbol. |
| **P2-2 Quote-aware notionals** (`UX-P2`) | Use actual quote assets in Tape/Book/Heatmap/DepthChart; retain `$` only for explicit USD fields. Add non-USD-quote fixtures and screenshot/SSR assertions. |
| **P2-3 Heatmap flat-book state** (`UX-P3`) | Separate no-liquidity from insufficient price span; render or explain a single-price non-zero book. Test empty, zero-only, flat, and normal data. |
| **P2-4 Calculator/Hub factual states** (`UX-P5`, `UX-P6`) | Do not overwrite manual converter prices; replace toy-model certainty and absent Hub telemetry defaults with estimates/Unknown. Test subsequent polls and failed/partial telemetry. |
| **P2-5 Account copy and lock consistency** (`UX-A4`) | Correct P&L mark wording, glossary read-only scope, global scaling footer, README R3 state, and Trades/Orders lock access. Add narrow SSR/source assertions. |
| **P2-6 R2 cancellation and section lifecycle** (`UX-A2`, `UX-A3`) | Add a cancellation notice. Decide whether section switches intentionally discard state; either disclose it or retain state with tested session/lock partitioning. Do not persist private R3 inputs by default. |
| **P2-7 Visualization and control semantics** (A11Y-4, A11Y-5) | Add keyboard/text alternatives for heatmap, honest tab/group/menu semantics, concise copy names, and less chatty countdown announcements. Validate with actual assistive technology. |
| **P2-8 Development/production parity** (`SEC-06`, TD-04) | Add a persistent sample-mode indicator and shared request-matrix tests. Never extend samples to private reads or treat them as live evidence. |
| **P2-9 Deployment hardening** (`SEC-03`, `SEC-04`) | Inventory and test CSP/security headers per platform; review public rate limits, quotas, logs, and cache behavior. Do not add wallet auth or private backend proxying. |
| **P2-10 Compare behavior** (`UX-P4`) | Show a real zero-match state and make wire-sample versus live provenance explicit in match labels. Test USDT, USDC, other quotes, and unavailable CoinGecko data. |

## P3 — Lower-risk polish and measured maintenance

Local implementation response and remaining evidence gaps: [PHASE3_MAINTENANCE.md](./PHASE3_MAINTENANCE.md).
The table remains the original acceptance roadmap; the follow-up distinguishes code/configuration
completed locally from browser, deployment, external-network, and other-runtime checks not performed.

| Item | Proposed change and acceptance evidence |
|---|---|
| **P3-1 Small copy/empty states** (`UX-P8`) | Clarify Zipper loaded-config versus verified addresses and deposit-oriented estimates; add Brand filter empty states, clipboard failure feedback, and a clearer public Flow deep-link path. |
| **P3-2 Worker “read-only” wording** (`SEC-05`) | Keep account-read-only claims while documenting optional public-mover Telegram POSTs and their separate secrets/cron. |
| **P3-3 External content freshness** (TD-08) | Add separately identified link/SDK-version/asset checks; do not turn network availability into unit-test flakiness or execute trading examples. |
| **P3-4 Performance measurement and possible route splitting** (TD-09) | Measure Web Vitals and request behavior first. If justified, lazy-load routes with tested loading/error states and a bundle budget; do not remove features just to silence Vite. |
| **P3-5 Tested extraction at change seams** (TD-06, TD-07) | Extract shared focus/formatting/load helpers only when needed for a concrete fix. Preserve APIs, exact arithmetic, and regression coverage; no broad R2/R3 style refactor. |
| **P3-6 Runtime/dependency assurance** (TD-10 and dependency section) | With authorization, add supported Node runtime checks, dependency/license review, and untracked-file-aware whitespace/format checks. Report current results rather than reusing historical counts. |
| **P3-7 Documentation lifecycle** | Keep README, audit state, owner checklist, and deployment docs synchronized after reviewed behavior changes. Record proposed deletions/restorations before acting. |

## Explicit non-goals for this roadmap

Unless the user separately approves a new scope, do **not**:

- add wallet authentication, trading, cancellation, transfer, withdrawal, or a backend private proxy;
- put account responses in a shared/private persistent cache;
- substitute public trades for private fills or missing values with zero;
- reconstruct execution fees from current rates or invent FX/marks/basis;
- weaken cursor, schema, permission, lifecycle, or independent P&L gates;
- delete apparently unused files or useful tests/public features;
- perform a broad design-system, account-core, or repository cleanup;
- deploy, commit, push, merge, rebase, or modify PRs as part of this audit follow-up without explicit direction.
