# PolyTools working-tree audit

**Audit date:** 2026-10-25
**Authoritative source:** the actual working tree on `arena/2679a49c-polytools`
**Local HEAD during the audit:** `eab1b24b5d7578d04a57e5110db6cd3d81f64b71`
**Purpose:** give the next reviewer a plain-English, evidence-linked snapshot without hiding uncertainty or overwriting existing work.

The original baseline was an audit/documentation pass, not a remediation or release. It added the first eight documents under `docs/audit/` and did not change application code, tests, dependencies, account data, deployment configuration, Git history, or pull requests.

## Latest combined PR/local review

Read [PR4_COMBINED_RELEASE_AUDIT.md](./PR4_COMBINED_RELEASE_AUDIT.md) for the current PR #4 + local-tree inventory, fresh evidence limits, complete roadmap disposition, and conditional merge decision. The original baseline and follow-up notes below remain historical evidence; do not use their old heads, counts, or resolved findings as the latest release state.

## Start here

1. Read [CURRENT_STATE.md](./CURRENT_STATE.md) for routes, implemented behavior, repository state, and public/private boundaries.
2. Read [TEST_AND_VERIFICATION.md](./TEST_AND_VERIFICATION.md) before trusting any “passed” statement. It separates fresh local checks from browser, live-account, and deployment unknowns.
3. Read [SECURITY_AND_ACCOUNTING_AUDIT.md](./SECURITY_AND_ACCOUNTING_AUDIT.md) before using real keys or interpreting P&L.
4. Use [UX_AUDIT.md](./UX_AUDIT.md), [TECHNICAL_DEBT.md](./TECHNICAL_DEBT.md), and [ROADMAP.md](./ROADMAP.md) to plan narrowly reviewed follow-ups.
5. Give [REVIEW_BRIEF.md](./REVIEW_BRIEF.md) to another AI or human reviewer as the ten-part handoff.

## Local implementation follow-ups

The documents above preserve the original audit baseline. Later working-tree remediation and its
fresh verification are recorded separately rather than rewriting that evidence:

- [LOCAL_CACHE_PILOT.md](./LOCAL_CACHE_PILOT.md) — bounded public-only metadata cache pilot.
- [DEVELOPMENT_PARITY.md](./DEVELOPMENT_PARITY.md) — P2-8 sample provenance and request parity.
- [DEPLOYMENT_HARDENING.md](./DEPLOYMENT_HARDENING.md) — P2-9 security headers and operational review.
- [COMPARE_BEHAVIOR.md](./COMPARE_BEHAVIOR.md) — P2-10 zero-match and feed-provenance behavior.
- [PHASE3_MAINTENANCE.md](./PHASE3_MAINTENANCE.md) — P3-1–P3-7 maintenance, measurements, and remaining findings.

These follow-ups were local and uncommitted when written. Consult the latest combined review and the actual Git/PR record for publication state.
Do not attribute their working-tree results to the historical audit HEAD or to PR checks for a different head.

## What was reviewed

Static inspection covered:

- every route in `apps/web/src/App.tsx`, account sub-routes in `Portfolio.tsx`, navigation, shared UI, responsive CSS, and reduced-motion rules;
- public Dashboard, Tape, Book, Charts, Heatmap, Compare, Zipper, Calc, Hub, SDK Guide, Brand Kit, and public Flow lookup;
- account vault, Ed25519 signing, registered REST reads, schema validation, exact decimals, memory partitioning, coverage, cursor pagination, exports, and lifecycle handling;
- R2 selected cursor imports and their UI merge/cancellation behavior;
- R3 exact FIFO and moving-weighted-average ledgers, opening basis, non-fill flows, actual fees, internal transfers, valuation marks, and independent output gates;
- public backend handlers, adapters, cache, MCP session pool, Vite development fallback, build scripts, and Wrangler/Vercel configuration;
- all nine `tests/*.test.mjs` files and their actual fresh test run.

No real credentials, accounts, financial mutations, or private network requests were used.

## Evidence vocabulary

| Label | Meaning in these documents |
|---|---|
| **Confirmed** | Directly established from current source, configuration, a fresh local command, or a cited deterministic calculation. It does not automatically mean browser- or live-verified. |
| **Likely** | A reasoned inference from code that still needs a targeted runtime check. The missing check is stated. |
| **Unknown / Not verified** | The audit does not have adequate evidence. No success or failure is inferred. |

Feature state vocabulary is deliberately separate:

- **Implemented:** a current code path exists and was statically reviewed.
- **Partial:** a useful path exists, but a material state, edge case, or workflow is incomplete.
- **Experimental:** useful accounting or developer tooling exists but requires assisted input or lacks production-grade validation.
- **Missing:** no current implementation was found; this may be an intentional safety boundary.
- **Unverified:** runtime, browser, live-service, or deployment behavior was not established.

Component existence, historical handoffs, CI metadata, and synthetic fixtures are not treated as live proof.

## Fresh local verification snapshot

These commands were run during this audit using already-present dependencies; no install occurred.

| Command | Fresh result |
|---|---|
| `npm test` | **PASS:** 126 tests, 21 suites, 0 failed, 0 skipped, 0 todo. |
| `npm run typecheck` | **PASS:** web and backend TypeScript projects. |
| `npm run build` | **PASS:** Vite production build; one chunk-size warning remains. |
| `git diff --check` | **PASS** for tracked changes at the time run. Untracked files are outside this Git check. |

See [TEST_AND_VERIFICATION.md](./TEST_AND_VERIFICATION.md) for exact versions, output details, static contrast measurements, and the much longer list of checks **not** run.

## Main conclusions

- **Confirmed:** public market data and authenticated account data have separate paths. The backend is a public read facade, not a private-account proxy or shared private cache.
- **Confirmed:** account reads use exact decimal strings, validated DTOs, explicit coverage, registered GET operations, an exact testnet origin, safe fetch defaults, and memory-only private snapshots.
- **Confirmed:** R2 imports follow selected cursor chains sequentially. Failure preserves the whole prior UI snapshot; cancellation also preserves it but has no distinct cancellation notice; cap-only completion merges labeled partial data.
- **Confirmed:** R3 implements real exact FIFO and moving-weighted-average arithmetic. It blocks missing basis, incomplete fills, unresolved flows, invalid internal counterparts, unsupported inventory, and missing/stale marks as applicable. Realized P&L can remain available without a mark; unrealized and total remain suppressed.
- **Confirmed limitation:** R3 is user-assisted and experimental. Manual provenance is not independent statement reconciliation, there is no interactive end-to-end browser proof, and outputs are not verified tax reports.
- **Confirmed:** fresh synthetic/regression tests pass, but live CORS, permissions, real response schemas, cursor completeness, account isolation, execution-fee reconciliation, and deployment behavior remain unverified.
- **Confirmed:** the public UX has several actionable issues, including a Dashboard Book link that opens private Orders, quote values sometimes labeled with `$`, a flat-book heatmap edge case, misleading Hub fallback telemetry, and accessibility gaps.
- **Unknown / Not verified:** the cause of the Workers Builds failure. PR #4 points to `bcb55d6e03f39bc99ac12fffb5e7eada1b5471ee`, not local HEAD or this dirty working tree. Its Pages success and Workers failure are metadata about that other head, not verification of this audit target.

## Safety and change discipline

The pre-existing working tree contained 31 modified files, 9 deleted files, and 6 untracked files before these audit documents were added. All are preserved. The complete inventory is in [CURRENT_STATE.md](./CURRENT_STATE.md).

No reset, clean, checkout, commit, push, merge, rebase, deploy, dependency installation, remote PR modification, account unlock, authenticated request, or financial action was performed. Larger fixes—especially accounting, API, security, state lifecycle, refactors, or deletions—remain proposals in [ROADMAP.md](./ROADMAP.md), not changes made by this audit.
