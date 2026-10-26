# Test and verification record

## 1. Verification policy

This file records checks actually performed during the 2026-10-25 working-tree audit. It does not recycle earlier handoffs as fresh evidence.

- **Target:** `/home/user/polytools`, branch `arena/2679a49c-polytools`.
- **Local HEAD:** `eab1b24b5d7578d04a57e5110db6cd3d81f64b71`.
- **Runtime:** Node `v22.22.3`, npm `10.9.8`.
- **Dependency action:** none. Existing dependencies were used; no install, update, audit, or lockfile change occurred.
- **Network/account action:** no live public API check, authenticated request, real key, account unlock, or financial mutation was used for verification.

A passing local check applies to the current working tree only. It does not describe PR #4's different head or any deployed service.

## 2. Fresh command results

| Check | Exact invocation | Result | Evidence boundary |
|---|---|---|---|
| Identity | `node --version`; `npm --version`; `git branch --show-current`; `git rev-parse HEAD` | Reported the versions, branch, and HEAD above. | Local environment only. |
| Full tests | `npm test` → `node --test tests/*.test.mjs` | **PASS:** 126 tests, 21 suites, 126 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo. Reported duration `12494.632558 ms`. | Synthetic/unit/SSR/source regression coverage; not live compatibility. |
| TypeScript | `npm run typecheck` | **PASS**, exit 0. Ran `tsc -p tsconfig.json` for `apps/web`, then `backend`. | Static types only; no browser or network behavior. |
| Production build | `npm run build` | **PASS**, exit 0. Ran web `build:all` (`tsc` + `vite build`), Vite `5.4.21`, 86 modules transformed. | Web build only; not a Worker dry-run or deployment. |
| Tracked whitespace | `git diff --check` | **PASS**, exit 0. | Git does not include untracked files in this check. |
| Dirty-state inventory | `git status --short`; `git diff --stat`; `git log -5 --oneline --decorate` | Before audit documents: 31 modified, 9 deleted, 6 untracked = 46 status entries. | Establishes tree state, not correctness or authorship. |
| PR metadata | Read-only `gh pr view 4 --json number,state,headRefOid,statusCheckRollup ...` | PR #4 OPEN at `bcb55d6e03f39bc99ac12fffb5e7eada1b5471ee`; Cloudflare Pages SUCCESS; Workers Builds FAILURE. | Remote metadata for another head; not local test or deployment proof. |

### Documentation-only final reconciliation

After the eight audit files were written, a local Python check verified the expected file set, all relative `./` document links, and absence of trailing whitespace: **PASS**. A final `git diff --check` also remained exit 0.

Final `git status --short` reconciliation showed the original 31 modified and 9 deleted entries plus 7 untracked status entries: the original 6 untracked files and one collapsed `?? docs/audit/` directory entry containing the 8 new documents. The tracked diff remained exactly `40 files changed, 2291 insertions(+), 3197 deletions(-)`, confirming that this documentation pass did not alter tracked application/test/configuration content.

### Build output and warning

The successful build emitted:

- `dist/index.html`: 1.03 kB, gzip 0.57 kB;
- `dist/assets/index-BSW-RUW2.css`: 33.81 kB, gzip 6.99 kB;
- `dist/assets/index-1yBI1jCl.js`: **571.80 kB**, gzip 170.00 kB; source map 1,935.88 kB;
- build completed in 2.77 s inside Vite.

Vite warned that a minified chunk exceeded 500 kB and suggested code splitting/manual chunks. This is a non-failing performance/maintenance warning, not evidence of a runtime defect.

## 3. What the passing tests actually cover

There are nine test files and 21 suites. The table summarizes intent, not line coverage.

| Test file | Current coverage evidenced by test names and implementation |
|---|---|
| `tests/account-coordinator.test.mjs` | Public catalog identity without credentials; independent synthetic private datasets; exact fees; coverage; balance history; open orders; order details; denials; malformed rows; stale generations; lock invalidation; selected cursor imports, caps, selection, progress, and abort. |
| `tests/account-data.test.mjs` | Exact decimal arithmetic; balance totals; actual base/quote fees and rebates; deduplication/conflicts; sampled equity; P&L eligibility gates; DTO validation; private memory partitions; opaque cursor ingestion. |
| `tests/account-export.test.mjs` | Transfer-reason labels; exact source decimals; derived fill fields; coverage manifests; selected transfer rows; CSV formula escaping; exclusion of credentials, IDs, cursors, addresses, and raw errors; empty-export behavior. |
| `tests/account-lots.test.mjs` | Hand-calculated FIFO and moving-weighted-average cases; exact recurring rationals; actual fees; opening basis; underflow; partial coverage; unresolved/unknown flows; non-trade disposals; internal counterpart invalidation; mixed quotes; fresh/stale/conflicting marks. |
| `tests/account-rest.test.mjs` | Registered serializers and dynamic paths; query/cursor encoding; scope rules; GET/origin restrictions; signed fake-fetch requests; safe errors; bounded temporary retries; schema/content failures; late-response invalidation. |
| `tests/account.test.mjs` | Synthetic-key encrypted vault; wrong passphrase/tamper failures; nonextractable session keys; signature verification; registered IDs; monotonic timestamps; idle/cross-tab lifecycle; legacy migration/rollback; wipe boundaries; server clock offset; WebCrypto failure. |
| `tests/account-cost-basis-ux.test.mjs` | SSR/source assertions for R3 input states, blocked missing basis, visible transfer decisions, denied/unavailable data, no opening-zero inference, and absence of credential/persistence/mutation/public-market fallback paths. |
| `tests/account-ux.test.mjs` | Source and SSR assertions for account/public route ownership, public-request header boundaries, private cache partitions, separate Flow lookup, view-specific empty/status rendering, and actual fee presentation. |
| `tests/polytools.test.mjs` | Public wire decoding; depth/spread/wall calculations; MCP error/session retry; backend validation and cache; Node path handling; MCP URL restrictions; canonical query/body/public-key primitives. |

### Important test limitations

- Transports, keys, responses, and account rows are synthetic. They do not prove server acceptance or current schemas.
- Account UI tests use SSR and source assertions. They are not full browser workflows with focus, pointer, keyboard, IndexedDB, downloads, or live locks.
- R2 coordinator abort/cap tests do not by themselves prove the React merge and cancellation experience.
- R3 arithmetic tests do not prove that a user's manual opening lots, flow choices, or marks reconcile to an external statement.
- No public Dashboard, Heatmap, Compare, Calc, Hub, SDK Guide, Brand Kit, shared dialog, or chart interaction suite was found. Tape/Book appear in route/source assertions, not comprehensive page tests.
- No browser automation configuration (Playwright/Cypress) or coverage/lint script was found in the reviewed package scripts and nearby config files.

## 4. Additional deterministic audit check: CSS contrast tokens

A local Python calculation applied the standard sRGB relative-luminance/contrast formula to literal tokens in `apps/web/src/styles.css`. This was a static token calculation, not a full WCAG audit.

Selected results:

| Theme / surface | Token ratio | Normal-text interpretation |
|---|---:|---|
| Dark `muted` on `surface` | 3.83:1 | Below 4.5:1. |
| Dark `muted` on `elevated` | 3.62:1 | Below 4.5:1. |
| Dark `faint` on `surface` | 2.40:1 | Below 4.5:1. |
| Light `faint` on `surface` | 2.56:1 | Below 4.5:1. |
| Light `up` on `surface` | 3.77:1 | Below 4.5:1 for normal text. |
| Light `warn` on `surface` | 3.19:1 | Below 4.5:1 for normal text. |
| Light `warn` on `canvas` | 2.97:1 | Below 4.5:1 and just below 3:1 large-text/non-text threshold. |

These tokens are used for meaningful small labels, hints, statuses, and values as well as decorative content. Each use still needs contextual review; the calculation does not establish sitewide conformance or failure of every component.

## 5. Checks explicitly not run

The following remain **Unknown / Not verified** unless source evidence is separately cited:

### Browser and accessibility

- No browser was opened; no responsive layout, pointer, keyboard, clipboard, notification, audio, download, IndexedDB, cross-tab, or focus workflow was exercised.
- No screen reader, accessibility tree, automated axe scan, zoom/reflow test, high-contrast/forced-colors test, or touch-device test was run.
- No manual visual comparison of light/dark themes was performed.
- No SDK-generated TypeScript, Python, or Rust snippet was compiled or executed.
- No external documentation, faucet, brand asset, CoinGecko, Telegram, or download link was fetched for freshness.

### Live service and account compatibility

- No real registered key, passphrase, account, subaccount, signature, or private response was used.
- No CORS preflight, permission matrix, real DTO/schema, cursor exhaustion, eventual-consistency, rate-limit, clock-skew, account isolation, order-lineage, transfer-leg, or execution-fee reconciliation check was performed.
- No live public market request was made as part of the fresh verification commands.
- `docs/account-live-verification.md` remains an owner checklist. `docs/live-testnet-verification-report.md` and `docs/api-key-automation.md` are guidance/historical material, not rerun evidence.

### Deployment, dependencies, and quality gates

- No Wrangler deploy, Wrangler dry-run, Pages preview, Vercel deployment, Node adapter server, cron, or Telegram post was run.
- The Workers Builds failure cause remains unknown; no owner-only Cloudflare build log was available.
- No `npm audit`, dependency upgrade, license scan, secret scan, SBOM, bundle budget check, or runtime Node version matrix was run.
- No lint, formatting, code-coverage, mutation-testing, fuzzing, accessibility-test, or end-to-end command exists in the root scripts reviewed, and none was run.
- `git diff --check` does not validate untracked audit documents or untracked R3 source/tests.

## 6. Evidence a reviewer should collect next

1. Owner-run, sanitized live verification using `docs/account-live-verification.md`, with no secrets or raw private responses committed.
2. Browser integration tests for account lock/unlock/load/import/cancel/export and R3 successful/blocked workflows.
3. Public-route regression tests for the concrete issues in `UX_AUDIT.md`.
4. Keyboard/focus/screen-reader and mobile review after shared accessibility fixes.
5. A backend/Worker dry-run and owner-accessible Workers Builds log for the exact intended commit and dirty-tree reconciliation.
6. SDK snippet compilation against explicitly pinned SDK versions, kept separate from PolyTools runtime tests.
