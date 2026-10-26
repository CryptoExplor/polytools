# Phase 3 maintenance and measured polish

**Date:** 2026-10-25
**Status:** P3-1–P3-7 implemented locally with explicit evidence gaps; uncommitted
**Tree:** HEAD remained `44ba0a3870362fe8aa7c593c736e9d974b472182`; results apply to the dirty Phase 2 + Phase 3 working tree, not to that commit alone or to PR checks

## 1. Scope and change discipline

This pass follows the P3 roadmap without turning lower-risk maintenance into a broad refactor. It preserves all earlier account, cache, security-header, sample-provenance, and audit work. No files were deleted or restored, no dependencies were installed or upgraded, and no commit, push, merge, deployment, real credential, private live request, or financial mutation was used.

Browser/Web-Vitals, other-local-runtime, deployed CI, crates.io, external link/asset, and SDK compatibility evidence remains separate from deterministic local checks.

## 2. P3-1 — Small copy and empty states

### Zipper

- Contract addresses are now described as values returned by the loaded public `get_deposit_withdraw_config` response, not as independently verified by PolyTools.
- The estimate is named **Illustrative Deposit Net**. Copy says that it subtracts the listed network fee from the entered amount and checks only the deposit minimum; it is not a withdrawal or executable transfer quote.
- The notice no longer calls the loaded configuration unconditionally live. It identifies cached/stale/labeled-sample possibilities and retains the official-app confirmation instruction.

### Brand filters and clipboard

- Token-packshot and Polybot-avatar filters have distinct empty states, escaped query text, and a **Clear Filter** action.
- `apps/web/src/lib/clipboard.ts` provides tested copy outcomes and idle/copied/failed presentation. Copy failures now show **Copy failed**, a retry/manual-copy explanation, an alert icon, and a polite status update instead of being silently swallowed.
- Existing concise accessible copy names are preserved.

### Public Flow deep links

- `/flow` now redirects to `/account/transactions?scope=public` while preserving lookup parameters.
- Money Movement scope is URL-driven through `apps/web/src/lib/navigation.ts`; direct `?scope=public` opens the credential-free Flow UI rather than the default locked private view.
- Embedded Flow query updates retain `scope=public`. Switching back to My account removes only that scope marker and preserves other lookup parameters.
- Private transfers still require an unlocked account and explicit load. No private fallback or account request was added.

## 3. P3-2 — Worker read-only wording

The root README and Read-only glossary entry now distinguish account/market read guarantees from the optional standalone/root Worker cron. When separately configured, that Worker reads public movers and POSTs notifications to Telegram every 15 minutes using separate Telegram secrets. This is not an exchange-account mutation, is not universal to every adapter, and never uses account signing keys.

No cron, secret, or Telegram behavior was executed or changed.

## 4. P3-3 — External content freshness checks

`scripts/check-external-content.mjs` provides separate `links`, `assets`, and `sdk` commands. Network access is opt-in; `npm test` and the new CI workflow run only offline inventory/source checks.

- URL checks use HEAD with a range-GET fallback for HEAD rejection, redirect/status reporting, request timeouts, and bounded concurrency. They do not POST or execute downloaded content.
- Brand inventory is derived from the actual brand module, including all token angles, rather than checking only hardcoded examples.
- SDK source-pin checks compare the manifest with `SdkGuide.tsx` so a stale checker manifest fails visibly.
- Registry checks parse npm, PyPI, and crates response shapes without installing packages or running generated read/trade snippets.

### Current results

- Offline inventory: **13 concrete links, 89 brand assets, 3 SDK package entries**; all three source-pin checks matched.
- Opt-in live SDK check limited to the sandbox-approved npm/PyPI registries: **2 checked, 0 failed**.
  - npm `@polyester/sdk`: the source install is unversioned; registry latest was `0.31.0` at check time.
  - PyPI `polyester-sdk==0.1.0a55`: the pin was present and registry latest was also `0.1.0a55` at check time.
- crates.io was not checked. External links and brand assets were inventoried but not live-fetched.

Registry presence/latest metadata is not SDK API compatibility, generated-code compilation, link correctness, or asset-content verification. The unversioned npm install remains a reproducibility consideration, not a claim that `0.31.0` works with every snippet.

## 5. P3-4 — Performance measurement before splitting

`scripts/check-build-performance.mjs` measures built HTML request shape, local file bytes, gzip-level-9 bytes, and static/dynamic page imports. `scripts/performance-budget.json` supplies a regression budget; it does not silence Vite's warning or certify user experience.

Fresh production output and the independent measurement:

| Measurement | Result |
|---|---|
| Vite build | 98 modules; existing >500 kB chunk warning remains |
| Initial JS | 1 request; 592,841 bytes; 176,435 gzip-9 bytes |
| Initial CSS | 1 request; 34,086 bytes; 6,987 gzip-9 bytes |
| Other linked icon/manifest requests | 3 |
| App page imports | 12 static, 0 dynamic |
| Budget | JS raw/gzip and CSS raw/gzip all passed |

No route splitting was applied. Real Web Vitals, browser request timing, low-end device behavior, and proof that lazy routes improve those metrics were not measured. A static bundle warning alone is not treated as that proof. The budget is a guard against regression pending a reviewed measurement/splitting decision.

## 6. P3-5 — Narrow tested extraction only

Two concrete UI seams use small helpers:

- clipboard outcome/presentation for the shared CopyButton fix;
- redirect and Money Movement scope handling for the public Flow fix.

The external/build/runtime/dependency/whitespace scripts similarly export pure functions for synthetic tests. No account-core, R2/R3, formatting-system, route decomposition, or broad design-system refactor was performed.

## 7. P3-6 — Runtime, dependency, and repository assurance

### Runtime

`npm run check:runtime` passed on **Node v22.22.3**: declared `>=18` engine range, Fetch/Web API globals, WebCrypto, and a synthetic Ed25519 sign/verify probe.

`.github/workflows/ci.yml` adds a fail-independent Node **18/20/22** matrix for runtime, whitespace, offline inventory, dependency metadata, tests, typechecks, build, and build-budget checks. This is new configuration, not evidence that the matrix has run or passed on a PR. Only Node 22 was executed locally. Live freshness and npm audit are deliberately not blocking network steps in that workflow.

### Dependency and license inventory

`npm run check:dependencies` passed:

- lockfile v3;
- **110 external package paths:** 8 production and 102 development;
- **3 local workspace links**, reported separately rather than treated as missing third-party license metadata;
- no missing external license metadata and no workspace lock-version mismatches;
- all-license inventory: MIT=89, ISC=7, MIT OR Apache-2.0=3, Apache-2.0=7, LGPL-3.0-or-later=1, CC0-1.0=1, CC-BY-4.0=1, BSD-3-Clause=1;
- production-license inventory: MIT=8.

This is lockfile metadata inventory, not a legal compatibility opinion, SBOM, or vulnerability assessment.

### Current npm audit findings

Read-only `npm audit --json` completed with **exit 1**: **7 findings — 2 high, 5 moderate**. The named packages were `vite` and `undici` (high), plus `esbuild`, `miniflare`, `react-router`, `react-router-dom`, and `wrangler` (moderate).

`npm audit --omit=dev --json` also completed with **exit 1**: **2 moderate, 0 high**, for `react-router` and direct dependency `react-router-dom`.

No suggested major upgrade/downgrade or `npm audit fix` was applied. Registry severity and fix metadata do not by themselves establish exploitability in PolyTools or a safe migration path. These remain current findings for prioritized owner review, especially the production router advisories and development-server/Worker tooling exposure.

### Untracked-aware whitespace

`npm run check:whitespace` checks Git tracked plus untracked/non-ignored files, skips binary/oversized content, allows intentional two-space Markdown line breaks, and reports trailing whitespace, conflict markers, and missing final newlines. Final local run: **159/159 files checked, 0 violations, 0 skipped**. Ignored `dist` content is excluded; a test proves the otherwise-untracked checker itself is included.

## 8. P3-7 — Documentation lifecycle

- Root README now lists deterministic checks, opt-in network checks, and the Worker notification exception.
- The audit README indexes all local implementation follow-ups separately from the original baseline.
- `CURRENT_STATE.md` is explicitly marked as a historical baseline so its old Git hashes and resolved findings cannot be mistaken for current status.
- The P3 roadmap links to this response and its remaining evidence gaps.
- Owner live-verification instructions were not rewritten because account request behavior did not change.
- No deletion/restoration was proposed or performed.

## 9. Verification ledger

| Check | Current working-tree result |
|---|---|
| Phase 3 UI + previous Phase 2 UX focused run | **18/18 passed** |
| Maintenance-script focused suite | **7/7 passed, 2 suites** |
| Full offline suite | **191/191 passed, 43 suites** |
| Root typecheck | Web and backend passed |
| Production build | Passed; 98 modules; 592.19 kB JS / 176.77 kB gzip reported by Vite |
| Performance budget | All four raw/gzip JS/CSS checks passed |
| Offline external inventory | Passed; 13 links, 89 assets, 3 source-matched SDK entries |
| Live npm/PyPI SDK registry check | 2 checked, 0 failed; compatibility not tested |
| Current runtime | Node 22.22.3 passed all probes |
| Dependency metadata | Passed; no external license gaps or workspace-version drift |
| npm audit | Findings present: 7 full / 2 production-only; not a passing security gate |
| Whitespace | 159/159 files, 0 violations |
| `git diff --check` | Passed on final tree |

Existing SSR React `useLayoutEffect` warnings and the Vite chunk-size warning remain visible. No warnings were suppressed.

## 10. Remaining non-claims and follow-up

No real browser interaction, Web-Vitals capture, screen-reader run, Node 18/20 local execution, CI/PR check, deployment, external link/asset fetch, crates.io query, SDK compilation, or live account request was performed. Dependency audit findings are reported rather than hidden, but their exploitability and upgrade path were not researched or tested. These limitations should accompany any later Phase 3 completion or release claim.
