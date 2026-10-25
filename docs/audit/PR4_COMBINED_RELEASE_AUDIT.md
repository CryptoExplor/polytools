# PR #4 combined PR + local release audit

**Date:** 2026-10-25
**Audience:** ChatGPT, independent AI reviewers, and human release owners
**Branch:** `arena/2679a49c-polytools`
**Base:** `main` / `eab1b24b5d7578d04a57e5110db6cd3d81f64b71`
**PR head before this combined review:** `44ba0a3870362fe8aa7c593c736e9d974b472182`
**Review type:** static source/configuration review plus the local commands explicitly recorded below

## 1. Executive decision

**Merge decision: DO NOT MERGE PR #4 under the requested “nothing remains pending from `docs/audit`” condition.**

The combined tree is suitable to publish to PR #4 as a **review candidate**, with this report and its limitations. It is not approved for merge, live-account reliance, production accounting, tax reporting, deployment certification, or WCAG conformance.

The decisive open gates include:

1. owner-run, sanitized live account/browser verification remains incomplete;
2. R3 remains experimental/user-assisted and lacks independent accounting reconciliation and complete browser workflows;
3. account request/import deadlines and the broad Load/catalog coupling remain open;
4. shared focus, meaningful-text contrast, browser, and assistive-technology acceptance remain open;
5. SDK generated-code compilation/input acceptance remains open;
6. Workers Builds is failing on the pre-combined PR head, with no owner-log diagnosis or deployed verification;
7. deployed headers, platform rate limits/logging, Node 18/20/22 CI results, Web Vitals, and external-content coverage remain incomplete;
8. the current dependency audit is non-green; and
9. this fresh checkout has no installed JavaScript dependencies, so the current full tests, typechecks, build, performance check, and Vite-dependent inventory could not be reproduced locally.

No new confirmed P0 custody or accounting defect was established by this static review. That statement is not a proof of security or live correctness. The pending items above are sufficient to block the requested conditional merge even where source implementations and synthetic regressions are strong.

## 2. Exact review scope and repository identity

This review covers both:

- the committed PR #4 diff from `main` through `44ba0a3`; and
- every later local modification, addition, and deletion in the combined working tree.

The pre-report combined inventory was **102 changed files vs `origin/main`**, with **11,119 insertions and 3,715 deletions**. The increment beyond `44ba0a3` was **66 changed files**, with **8,855 insertions and 493 deletions**.

Final combined diff including this report: `103 files changed, 11560 insertions(+), 3715 deletions(-)`.
Final increment beyond the prior PR head including this report: `67 files changed, 9296 insertions(+), 493 deletions(-)`.

The real Git index was empty when this review began. A temporary index at `/tmp/polytools-release-audit.index` was used only to inventory the complete tracked + untracked tree without changing the user's real staging state. The working branch and repository root were not switched, reset, rebased, cleaned, renamed, or force-updated.

The current checkout is a fresh clone whose local HEAD is the base commit while the fetched PR branch is `44ba0a3`. A normal commit directly on the base would not fast-forward the PR branch. Publication therefore requires a commit whose parent is the fetched PR head while preserving this exact reviewed tree. No force-push or rebase is authorized or needed.

Former backup directories, stash entries, and earlier `/tmp` verification logs are not present in this clone. They are not claimed as available recovery points or independently inspectable current evidence.

### Deletions explicitly retained for review

The combined tree intentionally retains the pre-existing deletion of `packages/core/src/keys.ts` and eight `research/account-analytics/` documents. No deleted file was restored or hidden. The active core export now maps `vault` to `./account/index`; no active source reference to the removed `keys.ts` path or deleted research directory was found outside historical audit documentation.

## 3. Audit method and evidence rules

Review activities included:

- complete changed-file/name-status inventory against `origin/main` and the prior PR head;
- direct review of security-, custody-, network-, accounting-, cache-, deployment-, CI-, and documentation-sensitive diffs;
- source searches for credential patterns, private persistence, backend account proxying, financial mutations, unsafe request behavior, and stale deleted-path references;
- JSON configuration parsing and source inspection of the GitHub Actions workflow;
- dependency vulnerability, license/version, runtime, whitespace, and dependency-free maintenance checks; and
- attempted fresh full tests, typecheck, build, and external inventory, with failures reported rather than replaced by historical success.

Evidence labels in this report are deliberately different:

| Label | Meaning |
| --- | --- |
| **Source-confirmed** | Established from current source/configuration or deterministic static inspection. |
| **Current local result** | A command ran in this fresh checkout; its exact result and limits are recorded. |
| **Earlier session result** | A prior run was reported for the same accumulated work, but its log is absent here and it was not reproduced in this checkout. |
| **PR metadata** | A remote check attached to a specific PR head; never substituted for local or deployed evidence. |
| **Unknown / Not verified** | Evidence is absent or insufficient. Neither success nor failure is inferred. |

No real credential, account unlock, authenticated request, financial mutation, SDK/trading example execution, deployment, dependency installation/upgrade, or `npm audit fix` was used.

## 4. Security, custody, and data-boundary review

### 4.1 Credential and sensitive-artifact scan

A pattern scan covered 93 changed added/modified text files in the initial combined tree. It looked for private-key blocks, GitHub/AWS tokens, Telegram literals, bearer literals, literal 64-hex keys/hashes, and registered-key-ID-shaped strings.

Only four registered-key-ID patterns matched, all explicit synthetic fixtures:

- `ak_synthetic_coordinator`;
- `ak_synthetic_rest`;
- `ak_synthetic`; and
- `ak_synthetic_read_only`.

No real private-key block, bearer token, GitHub/AWS token, Telegram token, or literal 64-hex private key was found by those patterns. `apps/web/.env.example` contains comments and a placeholder public backend URL only. This is a targeted pattern scan, not a formal guarantee that no secret exists in every possible encoding.

### 4.2 Vault and signing controls

Source review confirms that the combined tree retains the intended controls:

- encrypted vault records, authenticated encryption, verified Ed25519 key pairs, and nonextractable unlocked `CryptoKey` sessions;
- generation/abort invalidation on lock, wipe, unlock/import changes, idle timeout, and cross-tab lifecycle events;
- encrypted read-back verification and rollback/quarantine behavior for legacy migration;
- best-effort mutable-buffer clearing without claiming perfect JavaScript memory erasure;
- validated server clock offset applied only to signing timestamps;
- registered read-only GET operations on the exact official testnet origin;
- validated dynamic order-detail paths rather than arbitrary caller paths;
- signed path/query equality checks against the actual request target;
- omitted credentials, rejected redirects, no-store requests, bounded temporary GET retries, and safe error mapping; and
- validation before private responses enter account datasets.

The vault update path now reuses one authenticated decrypt and clears the serialized private payload in `finally`; ordinary unlock does not retain that serialized key in the session. These are source invariants, not live server permission evidence.

Residual risks remain: hostile JavaScript while unlocked, compromised devices, phishing, weak passphrases, and the difference between nonextractable keys and an abusable unlocked signing capability. PolyTools also cannot infer a key's server-side read policy from its `ak_...` identifier.

### 4.3 Public/private separation and persistence

The review found no new private backend proxy, shared private response cache, or public-trade substitution for private fills.

- Account datasets use generation/scope/operation/filter-partitioned memory and are invalidated with the vault lifecycle.
- The persistent cache pilot is deliberately public-only and bounded to validated public market metadata.
- `PublicCacheStatus` exposes provenance rather than presenting cached public data as private or live-account evidence.
- The public backend remains credential-free GET/OPTIONS; no signed account headers or private account responses should be sent to it.
- Public wire samples remain development fixtures and are not live evidence.
- Account exports require explicit confirmation and contain loaded validated rows/manifests rather than credentials, raw errors, or a completeness guarantee.

Browser IndexedDB behavior, cross-tab behavior, downloads, and actual origin isolation still require browser verification.

### 4.4 Backend and browser security configuration

Repository-controlled CSP and related headers are defined for static hosting, Vercel, and shared backend responses. Source tests were added for this policy. No deployed response was inspected in this review, so duplicate/conflicting platform headers, HSTS, SPA fallbacks, API errors, OPTIONS behavior, and actual enforcement remain unknown.

The public facade intentionally has open public CORS and no application-owned request-rate limiter. Platform WAF/rate limits, upstream quotas, cache behavior, logging, retention, alerting, and query-string redaction require owner review. Adding wallet authentication or routing private keys through this backend would be the wrong remediation.

The optional standalone Worker cron can POST a public-mover notification to Telegram. That is a separate non-financial outbound side effect, not an account trading path; no Telegram secret or post was used.

## 5. Financial and accounting review

### 5.1 Exact values, fees, and coverage

Source-confirmed invariants include:

- exact decimal strings and exact rational arithmetic rather than float-based accounting;
- total balance as trading + funding, without adding reserved/available again;
- actual fill fee/rebate assets and amounts driving base/quote movements;
- current fee rates kept separate from historical execution fees;
- conflicting/unknown financial rows blocking affected aggregates rather than disappearing;
- denied, malformed, capped, stale, partial, and unavailable states remaining distinct from empty success; and
- unavailable financial values remaining `null`/Unavailable rather than becoming zero.

The updated observed-fill eligibility combines transport and normalized-summary counters without allowing one counter set to erase conflicts, duplicates, unknown rows, or dropped rows from the other.

### 5.2 R2 cursor and lifecycle behavior

The selected cursor-import implementation remains sequential and explicit. Opaque cursors are encoded once, empty intermediate pages do not fabricate exhaustion, repeated cursors/caps/aborts remain incomplete, and previous UI snapshots are preserved on import failure/cancellation. Cap-only results remain partial. Order-detail execution cursors are not treated as settlement/order-state reconciliation watermarks.

Synthetic regression files cover many of these paths, but current full-suite reproduction is blocked in this checkout. Real cursor completeness, eventual consistency, repeated settlement-leg identity, transfer/fill correlation, and live account isolation remain unverified.

### 5.3 R3 cost basis and P&L

The R3 implementation is real arithmetic, not a placeholder:

- FIFO and moving weighted average use exact values;
- buys acquire post-base-fee inventory and actual quote cost;
- sells remove established lots and calculate realized movement minus removed cost;
- opening basis requires explicit evidence or a complete-since-inception zero attestation;
- unresolved/unknown relevant flows, underflow, unsupported negative basis, and invalid internal counterparts block affected outputs;
- quote models remain separate rather than inventing FX; and
- realized, unrealized, and total P&L have independent availability gates.

A fresh labeled mark is required for unrealized/total values, not for an otherwise eligible realized value. Missing opening basis or flows is never converted into zero-cost inventory.

R3 remains **experimental, user-assisted accounting**. Manual opening lots, zero attestations, flow decisions, and marks are not independently reconciled to owner statements or wallet evidence. No complete successful browser workflow, qualified accounting review, live fee/leg reconciliation, or tax-lot/filing verification was performed. No tax, filing-ready, universally accurate, or production-reporting claim is authorized.

## 6. UX, public tools, and accessibility disposition

The combined tree contains source fixes and synthetic/SSR regressions for the Phase 1–3 work, including:

- Dashboard public Book routing and independent controls;
- quote-aware public notionals;
- flat-book heatmap handling;
- calculator manual-price preservation and honest estimate/telemetry states;
- Compare zero-match and sample/stale provenance;
- account copy, lock access, R2 cancellation notice, and section-state disclosure;
- development sample notices and public-cache provenance;
- selected visualization/control semantics;
- Zipper/Flow/Brand/clipboard empty or failure states; and
- build, runtime, dependency, and whitespace maintenance tooling.

These implementations do not close browser or assistive-technology acceptance by themselves. The current checkout could not rerun their React/Vite suites. No browser, screen reader, accessibility tree, keyboard/pointer workflow, zoom/reflow, forced-colors, touch-device, or visual theme review was performed.

Shared modal/mobile focus management, meaningful-text contrast, full keyboard/AT visualization behavior, SDK generator input/compile acceptance, and complete account/R2/R3 browser workflows remain open. No mobile or WCAG certification is made.

## 7. Tests, build, dependencies, and external-content evidence

### 7.1 Current fresh-checkout results

| Check | Current result | Evidence boundary |
| --- | --- | --- |
| `npm test` | **Could not run the full suite; exit 1.** `vite` and `react` are absent. The runner reported module-resolution failures; only dependency-free tests executed. | Not a valid full-suite pass and not evidence of a code assertion regression. |
| `npm run typecheck` | **Blocked; exit 127.** `tsc` is absent. | No current typecheck claim. |
| `npm run build` | **Blocked; exit 127.** `tsc` is absent. | No current build or deployment claim. |
| `npm run check:performance` | **Not run.** No current build output exists. | No current bundle measurement. |
| `npm run check:external` | **Blocked; exit 1.** The inventory imports missing `vite`. | No current external inventory result. |
| `node --test tests/maintenance-scripts.test.mjs` | **PASS: 7/7 tests, 2 suites.** | Dependency-free synthetic helper tests only. |
| `npm run check:runtime` | **PASS** on Node `v22.22.3`; root engine `>=18` and listed Web APIs/Ed25519 probes passed. | Current runtime only; not Node 18/20 or CI-matrix proof. |
| `npm run check:dependencies` | **PASS:** 110 external package paths, 3 workspace links, no missing license metadata or workspace version mismatch. | Lockfile metadata inventory, not legal or vulnerability clearance. |
| `npm run check:whitespace` | **PASS:** `160/160 Git tracked + untracked/non-ignored files checked; 0 binary and 0 large files skipped`. | Includes tracked + untracked/non-ignored text files. |
| Combined `git diff --check origin/main` using the temporary index | **PASS** after removing eight trailing-space Markdown hard breaks from the new audit notes. | Complete combined diff, including untracked files staged only in the temporary index. |
| JSON parsing | **PASS** for package/lock, backend package/tsconfig, Vercel config, and performance budget. | Syntax only. YAML workflow was source-inspected; no YAML parser was installed. |
| Credential pattern scan | **PASS with four reviewed synthetic key-ID fixtures.** | Targeted patterns, not a formal secret-scanning guarantee. |

No packages were installed to repair the missing local dependency environment. Doing so would violate the task constraint. CI uses `npm ci` in its own isolated runner and must provide the fresh exact-head verification instead.

### 7.2 Earlier session results — not reproduced here

The immediately preceding Phase 3 work reported:

- **191/191 tests across 43 suites**;
- web/backend typechecks and a 98-module production build passing;
- initial JS **592,841 bytes / 176,435 gzip-9** and CSS **34,086 / 6,987**, within the configured budgets;
- offline external inventory of 13 links, 89 assets, and 3 SDK entries;
- opt-in npm/PyPI registry checks with 2 checked and 0 failed;
- 159/159 whitespace files passing; and
- Node 22 runtime probes passing.

Those results remain useful historical session evidence, but their `/tmp` logs are absent in this fresh checkout and the dependency-dependent commands could not be reproduced now. They must not be described as fresh verification in this checkout or as checks on a future PR head.

### 7.3 Dependency vulnerability audit

Current registry-backed audits ran without changing dependencies:

| Audit | Exit | Findings |
| --- | ---: | --- |
| `npm audit --json` | 1 | **7:** 2 high, 5 moderate |
| `npm audit --omit=dev --json` | 1 | **2 moderate production findings** |

Full-audit package nodes reported by npm: `esbuild`, `miniflare`, `react-router`, `react-router-dom`, `undici`, `vite`, and `wrangler`. Production findings are the React Router nodes. npm proposed major-version fix paths; none was applied.

This audit does not claim exploitability in PolyTools, nor does it silently dismiss severity. Remediation needs a separately reviewed compatibility/security change with lockfile and regression evidence. The dependency findings remain an open P3-6/release-assurance item.

The combined dependency-file edits add backend typechecking, maintenance scripts, and development-only `@types/node`/`undici-types` lock entries. No new production dependency was identified in that diff.

### 7.4 CI and external checks

The new GitHub Actions workflow configures Node 18/20/22 with `npm ci`, runtime/whitespace/offline-external/dependency checks, tests, typecheck, build, and performance budgets. It contains no live-account runner, deployment, credential, or trading command. Configuration is not execution evidence: the matrix must run on the exact published head.

Crates registry freshness, external link/asset availability, generated SDK compilation/browser compatibility, Web Vitals, request behavior, and deployed service behavior remain unverified. Earlier npm/PyPI registry success does not close those gaps.

## 8. PR and deployment evidence

Pre-combined PR #4 metadata:

- open, non-draft, base `main`, head `44ba0a3`;
- mergeable but `UNSTABLE`, with no review decision;
- Cloudflare Pages: **SUCCESS**; and
- Workers Builds: **FAILURE**.

Those checks belong to `44ba0a3`, not to the later local increment. The Workers failure has no available owner-log diagnosis here. Its cause remains unknown; no Node, Wrangler, or configuration root cause is inferred. Pages success is not Worker fetch, cron, static-header, exact-origin account, or full deployment verification.

After publication, all remote checks must be read again for the new head. A green Pages or CI result would not close the owner/live/browser/accounting/dependency gates by itself.

## 9. Roadmap acceptance disposition

The roadmap remains the acceptance source. “Implemented” below means source exists; it does not mean every acceptance test or evidence gate is closed.

| Item | Disposition in this combined review |
| --- | --- |
| **P0-1 Exact release candidate** | **Open pending exact-head verification.** The full tree is inventoried and can be published as one fast-forward commit, but the current local full verification is blocked and new-head PR checks must be attributed correctly. |
| **P0-2 Owner live account verification** | **Open.** Existing headless handoff is attributed and incomplete for browser/CORS, every permission/schema, cursor completeness, isolation, fee/leg reconciliation, and R3 evidence. |
| **P0-3 R3 independent review/claims** | **Open for any production/tax/real-data reliance.** Experimental/user-assisted labeling and fail-closed gates are retained. |
| **P1-1 Request/import deadlines** | **Open.** No code-owned registered-read or whole-import deadline was added. User/lifecycle abort is not a deadline. |
| **P1-2 Load scope/catalog independence** | **Open.** View-specific labels still trigger broad shared loads and catalog setup; unrelated non-fill independence is not accepted. |
| **P1-3 Shared focus and contrast** | **Open.** Source findings and browser/AT acceptance remain. |
| **P1-4 SDK generator** | **Open.** No generated-example compile/input acceptance was completed; no snippets were executed. |
| **P1-5 Critical browser regressions** | **Open.** SSR/synthetic tests do not replace production-like browser workflows. |
| **P1-6 Workers/deployment checks** | **Open.** Owner logs, adapter/runtime evidence, and exact-head deployment distinctions remain. |
| **P2-1 Dashboard destination/controls** | **Source implemented; final exact-head and keyboard/AT acceptance pending.** |
| **P2-2 Quote-aware notionals** | **Source and non-USD synthetic coverage implemented; browser/visual acceptance pending.** |
| **P2-3 Flat-book heatmap** | **Source and fixtures implemented; browser visualization/AT acceptance pending.** |
| **P2-4 Calculator/Hub states** | **Source and synthetic coverage implemented; live-poll/telemetry browser acceptance pending.** |
| **P2-5 Account copy/lock consistency** | **Source implemented; exact-head regression verification required after the blocked local rerun.** |
| **P2-6 R2 cancellation/section lifecycle** | **Source notice/disclosure implemented; interactive workflow acceptance pending.** |
| **P2-7 Visualization/control semantics** | **Source improvements implemented; actual keyboard/screen-reader validation pending.** |
| **P2-8 Development/production parity** | **Sample provenance and request-matrix tests implemented; complete production/upstream parity remains unverified.** |
| **P2-9 Deployment hardening** | **Repository headers/tests implemented; deployed headers, platform limits/logs/HSTS, and Workers evidence pending.** |
| **P2-10 Compare behavior** | **Zero-match/provenance source and tests implemented; live-feed/browser verification pending.** |
| **P3-1 Small copy/empty states** | **Source implemented; real clipboard/navigation/filter browser checks pending.** |
| **P3-2 Worker wording** | **Documentation-level item satisfied; no cron/Telegram runtime claim is made.** |
| **P3-3 External content freshness** | **Open/partial.** Current inventory is blocked; links/assets/crates and SDK compile/browser checks remain incomplete. |
| **P3-4 Performance** | **Open/partial.** Earlier byte budgets passed; current build and real Web Vitals/request behavior are not established. |
| **P3-5 Tested extraction at seams** | **No standalone broad refactor is required.** Future extraction remains restricted to concrete tested change seams. |
| **P3-6 Runtime/dependency assurance** | **Open.** CI matrix has not run on the combined head, current local dependency-dependent checks are blocked, and npm audit is non-green. |
| **P3-7 Documentation lifecycle** | **This report, README linkage, deletion inventory, and reference scan provide the current handoff. Future changes must continue synchronizing evidence.** |
| **SEC-04 operational abuse review** | **Open.** Owner-controlled platform rate-limit/quota/log evidence is absent. |

This matrix alone proves that “nothing remains pending” is false. A remote green build would not change the other open rows.

## 10. Documentation and deletion review

The original audit files intentionally preserve historical heads, test counts, and findings. Later Phase 1–3 notes record remediation separately. This combined report is the current release handoff; readers must not quote an old resolved finding as current code behavior without checking the follow-up evidence.

The audit README now links this report and labels the earlier material historical. Eight trailing-space Markdown hard breaks were removed from five new audit notes so the complete combined Git diff check passes. No application behavior changed in that cleanup.

The deleted research documents and legacy `keys.ts` remain deleted, as present in the supplied combined work. Active exports/references were checked. This review does not claim authorship of the pre-existing deletions and does not use their deletion as evidence of a defect.

## 11. Instructions for ChatGPT or another independent reviewer

1. Treat this file as an evidence map, not a certification. Verify consequential claims against the exact PR head and source.
2. Reproduce the complete diff from `origin/main` and confirm that the published commit is a fast-forward child of `44ba0a3` with no missing local files.
3. Run the lockfile-based CI checks in a clean Node environment. Separate dependency/setup failures from test assertion failures.
4. Review any suspected defect with file/line evidence, an exploitation or correctness scenario, and a focused synthetic regression. Do not speculate a Workers root cause without logs.
5. Preserve exact accounting, registered GET signing, safe errors, memory-only private partitions, public-only persistent caching, and fail-closed R2/R3 behavior in any recommendation.
6. Require owner-run sanitized evidence for live operations. Never request real keys, raw private responses, or financial mutations for review.
7. Require browser/AT and qualified accounting evidence where the roadmap calls for it. Do not convert SSR tests into interactive proof.
8. Triage npm audit findings separately with compatibility and regression evidence; do not run an opportunistic `npm audit fix`.
9. Re-read PR checks for the new head and distinguish Pages, Workers, CI, local, browser, live, and deployed evidence.
10. Keep the merge blocked until every applicable roadmap acceptance row is genuinely closed, not merely implemented in source.

A useful independent-review prompt is:

> Review `docs/audit/PR4_COMBINED_RELEASE_AUDIT.md` and the exact PR #4 head. Identify any missed concrete security, custody, financial-invariant, deployment, or test defect with file/line evidence. Distinguish static, synthetic, CI, browser, live, and deployed evidence. Do not infer merge readiness while any documented acceptance item remains open.

## 12. Final release conclusion

- **Static review:** no new confirmed P0 custody/accounting defect; critical safety boundaries remain present.
- **Publication:** appropriate to push the complete reviewed tree to PR #4 for independent review, with the blocked local verification explicitly disclosed.
- **Merge:** **not approved** under the user's condition.
- **Live/accounting/deployment/accessibility claims:** not certified.
- **Next required evidence:** exact-head CI, owner live/browser verification, independent R3 review, P1 reliability/accessibility/SDK work, Workers/deployment owner evidence, external/runtime gaps, and dependency disposition.

## Appendix A — Complete final changed-file inventory

Status is relative to `origin/main`: `A` added, `M` modified, `D` deleted. This list includes this report.

```text
A	.github/workflows/ci.yml
M	README.md
M	apps/web/.env.example
A	apps/web/public/_headers
M	apps/web/src/App.tsx
M	apps/web/src/components/AccountAnalytics.tsx
A	apps/web/src/components/AccountCostBasis.tsx
M	apps/web/src/components/DepthChart.tsx
M	apps/web/src/components/Glossary.tsx
M	apps/web/src/components/Layout.tsx
A	apps/web/src/components/PublicCacheStatus.tsx
A	apps/web/src/components/WireSampleNotice.tsx
M	apps/web/src/components/ui.tsx
M	apps/web/src/lib/api.ts
A	apps/web/src/lib/clipboard.ts
A	apps/web/src/lib/compare.ts
A	apps/web/src/lib/converter.ts
A	apps/web/src/lib/format.ts
A	apps/web/src/lib/heatmap.ts
M	apps/web/src/lib/hooks.ts
A	apps/web/src/lib/marketMetadataCache.ts
A	apps/web/src/lib/navigation.ts
A	apps/web/src/lib/provenance.ts
A	apps/web/src/lib/publicCache.ts
M	apps/web/src/lib/store.tsx
A	apps/web/src/lib/telemetry.ts
M	apps/web/src/pages/Book.tsx
M	apps/web/src/pages/BrandKit.tsx
M	apps/web/src/pages/Calc.tsx
M	apps/web/src/pages/Compare.tsx
M	apps/web/src/pages/Dashboard.tsx
M	apps/web/src/pages/Flow.tsx
M	apps/web/src/pages/Heatmap.tsx
M	apps/web/src/pages/Hub.tsx
M	apps/web/src/pages/Portfolio.tsx
M	apps/web/src/pages/Tape.tsx
M	apps/web/src/pages/Zipper.tsx
M	apps/web/src/styles.css
M	apps/web/vite.config.ts
M	backend/adapters/worker.ts
M	backend/package.json
M	backend/src/handler.ts
A	backend/tsconfig.json
M	docs/account-live-verification.md
A	docs/audit/COMPARE_BEHAVIOR.md
A	docs/audit/CURRENT_STATE.md
A	docs/audit/DEPLOYMENT_HARDENING.md
A	docs/audit/DEVELOPMENT_PARITY.md
A	docs/audit/LOCAL_CACHE_PILOT.md
A	docs/audit/PHASE3_MAINTENANCE.md
A	docs/audit/PR4_COMBINED_RELEASE_AUDIT.md
A	docs/audit/README.md
A	docs/audit/REVIEW_BRIEF.md
A	docs/audit/ROADMAP.md
A	docs/audit/SECURITY_AND_ACCOUNTING_AUDIT.md
A	docs/audit/TECHNICAL_DEBT.md
A	docs/audit/TEST_AND_VERIFICATION.md
A	docs/audit/UX_AUDIT.md
M	package-lock.json
M	package.json
M	packages/core/src/account/analytics.ts
M	packages/core/src/account/data.ts
M	packages/core/src/account/index.ts
A	packages/core/src/account/lots.ts
M	packages/core/src/account/normalize.ts
M	packages/core/src/account/rest.ts
M	packages/core/src/account/signer.ts
M	packages/core/src/account/vault.ts
A	packages/core/src/deploymentSecurity.ts
M	packages/core/src/index.ts
D	packages/core/src/keys.ts
D	research/account-analytics/00_CURRENT_STATE.md
D	research/account-analytics/01_OFFICIAL_API_CAPABILITY_MATRIX.md
D	research/account-analytics/02_ACCOUNT_CONNECTION_AND_SECURITY.md
D	research/account-analytics/03_ANALYTICS_AND_FINANCIAL_FORMULAS.md
D	research/account-analytics/04_ACCOUNT_ANALYTICS_FRONTEND_SPEC.md
D	research/account-analytics/05_BACKEND_AND_DATA_ARCHITECTURE.md
D	research/account-analytics/06_IMPLEMENTATION_ROADMAP.md
D	research/account-analytics/07_CODING_AGENT_MASTER_HANDOFF.md
A	scripts/check-build-performance.mjs
A	scripts/check-dependencies.mjs
A	scripts/check-external-content.mjs
A	scripts/check-runtime.mjs
A	scripts/check-whitespace.mjs
M	scripts/live-test.mjs
A	scripts/performance-budget.json
M	tests/account-coordinator.test.mjs
A	tests/account-cost-basis-ux.test.mjs
M	tests/account-data.test.mjs
A	tests/account-lots.test.mjs
M	tests/account-rest.test.mjs
A	tests/account-ux.test.mjs
M	tests/account.test.mjs
A	tests/compare.test.mjs
A	tests/deployment-security.test.mjs
A	tests/development-parity.test.mjs
A	tests/maintenance-scripts.test.mjs
A	tests/phase2-ux.test.mjs
A	tests/phase3-ux.test.mjs
M	tests/polytools.test.mjs
A	tests/public-cache.test.mjs
A	tests/public-phase1.test.mjs
M	vercel.json
```

## Appendix B — Current command evidence artifacts

Current ephemeral logs are under `/tmp/polytools-release-audit-*-20261025.*` in the authoring sandbox. They are not committed evidence and may not persist for another reviewer. The tables above record the relevant outcomes and limitations; the exact PR head and reproducible commands are the durable review anchors.
