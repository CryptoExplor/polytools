# 13 — NBA-3 browser/mobile validation of the API-key path

**Validation task, not a feature task. No source, dependency, or configuration change was made.**

**Verdict: BLOCKED for the browser/mobile validation as specified.** No browser exists in this
environment and no test credentials were supplied, so the specified checks — real rendering, layout at
viewport sizes, console errors, keyboard and touch behaviour, live API-key setup — **could not be
performed**. What *was* performed is recorded below as three narrower things: automated build/test
gates, a DOM-level render harness (SSR, no browser), and a dev-server smoke test. None of them is a
substitute for the blocked checks, and none is reported as one.

---

## 0. What was tested

| Item | Value |
|---|---|
| Branch | `arena/609563ba-polytools` |
| Commit tested | **`92d7fd4a0d0006f1c699779436a788b273712363`** |
| Working tree at start | clean (`git status --short` → empty) |
| PR | **#8**, `OPEN`, `MERGEABLE` |
| Node | v22.22.3 (repo engine requires `>=24`) |
| Install | `npm install` → 153 packages; `package-lock.json` restored afterwards |
| Environment | headless Linux sandbox, **no display server, no browser binary** |

---

## 1. Why the browser checks are blocked (with evidence, not assertion)

| Probe | Result |
|---|---|
| `command -v chromium / google-chrome / firefox` | **none found** |
| `/usr/lib/chromium*`, `/opt/google`, `/usr/local/bin/*chrom*` | **absent** |
| `find / -name headless_shell -o -name chrome -type f` (maxdepth 4) | **no results** |
| `~/.cache/ms-playwright` | **absent** |
| `node_modules` → playwright / puppeteer | **not installed** |
| `curl https://cdn.playwright.dev` | **`000`** (unreachable) |
| `curl https://storage.googleapis.com` | **`000`** (unreachable) |
| `curl https://playwright.azureedge.net` | **`000`** (unreachable) |

Installing a browser is therefore impossible in two independent ways: no binary is present, and every
Chromium distribution host is unreachable from this sandbox. `npm` and `pypi` are reachable, but the
Playwright/Puppeteer packages fetch the *browser* from a separate CDN, which is not.

**Consequence:** no real rendering, no CSS layout, no paint, no viewport simulation, no console
capture, no network-panel inspection, no keyboard traversal, no touch targets, no screenshots. Any
claim about how the app *looks* or *behaves* in a browser would be fabricated, so none is made.

**Second blocker: credentials.** No testnet API key or test account was supplied. Every private-data
flow — setup with a real key, live validation, 401/403 handling, unlock against a real account,
refresh, stale markers — is **BLOCKED** for the same reason. No key was invented, and no request was
made to any account endpoint.

---

## 2. What was actually run, and what it proves

### 2.1 Automated gates — all pass at `92d7fd4`

| Gate | Result | Proves |
|---|---|---|
| `npm test` | **318 / 318 pass, 71 suites, 0 fail** (31.6 s) | Unit + SSR-level behaviour of the account core, vault, DTO validation, UX copy |
| `npm run typecheck` | **pass** | No type errors across web + backend |
| `npm run build` | **pass** (3.97 s) | The app compiles and bundles; 37 build files |
| `npm run check:performance` | **pass** (after build) — initial JS 309,749 B / 98,374 B gzip ≤ 625,000 / 185,000; CSS 36,279 B / 7,377 B gzip ≤ 40,000 / 10,000 | Budgets hold; 1 static + 11 dynamic page imports |
| `npm run check:contrast` | **pass** | Token contrast ratios meet the configured thresholds |
| `npm run check:whitespace` | **pass** — 197 files, 0 violations | Hygiene |
| `npm run check:dependencies` | **pass** | Dependency budget intact (root `{}`, web 3, backend `{}`) |
| `npm run check:external` | **pass** | External-content inventory unchanged |
| `npm run check:runtime` | **pass on every probe**; reports `Node v22.22.3; engine >=24: FAIL` | Web Crypto, Ed25519, fetch/streams all available; the Node mismatch is this sandbox only |

> **Environment note.** `node_modules` is not preserved between sessions. In a fresh workspace the
> suite fails with `ERR_MODULE_NOT_FOUND: vite` until `npm install` runs. That is not a regression.
> `package-lock.json` must be restored (`git checkout -- package-lock.json`) after installing.

### 2.2 DOM-level render harness — 16 / 16 pass

This repository already renders components without a browser (`tests/*.test.mjs` uses
`vite.ssrLoadModule` + `renderToStaticMarkup`). I reused that approach in a **throwaway script outside
the repo**, deleted afterwards, to render each route and the locked account states and inspect the
returned markup.

*What this proves:* the component tree for each route mounts without throwing, and the expected
user-facing strings are present in the output.
*What it does not prove:* layout, styling, interactivity, focus order, or anything that requires
`window`, timers, or events after mount.

| ID | Check | Result |
|---|---|---|
| R-Dashboard | `/` renders, 5,470 B | **PASS** |
| R-Book | `/book`, 5,420 B | **PASS** |
| R-Tape | `/tape`, 6,446 B | **PASS** |
| R-Charts | `/charts`, 4,502 B | **PASS** |
| R-Heatmap | `/heatmap`, 2,622 B | **PASS** |
| R-Compare | `/compare`, 4,851 B | **PASS** |
| R-Zipper | `/zipper`, 5,923 B | **PASS** |
| R-Calc | `/calc`, 10,395 B | **PASS** |
| R-Hub | `/hub`, 21,212 B | **PASS** |
| R-SdkGuide | `/sdk`, 21,449 B | **PASS** |
| R-BrandKit | `/brand-kit`, 90,271 B | **PASS** |
| R-Portfolio | `/account`, 4,336 B | **PASS** |
| S-overview / trades / orders / transfers | Locked state renders in all four views | **PASS** (4/4) |

Observed locked-state copy (verbatim from the rendered markup, which is the onboarding surface a
first-time user sees):

```
Account locked · HTTPS required · Private reads: Testnet only
[time period selector] · [Load account data] · Read scope, se…
```

Portfolio route additionally renders: `Overview · Key setup · Trades · Orders · P&L · Deposits ·
Account overview`.

### 2.3 Dev-server smoke test — 5 / 5 pass

Started the real Vite dev server (`--host 0.0.0.0 --port 5199`) and exercised it with HTTP requests.

| Check | Result |
|---|---|
| `GET /` | **200**, 1,194 B `text/html` |
| `GET /#/calc`, `/#/account`, `/#/sdk` | **200**, same shell (hash routing — deep links resolve client-side) |
| `GET /#/nonexistent` | **200** shell (client redirects to `/`) |
| `GET /api/markets`, `/api/overview`, `/api/candles` | **200** from the dev wire-sample fallback, `apiEnv: "testnet"` |
| `GET /api/bogus` | **404** `{"error":"Unknown route: /api/bogus"}` |

> **Important for interpretation:** in dev, public data comes from the **checked-in wire samples**
> (`docs/wire-samples/`), not from a live exchange. Any statement about data correctness made from this
> preview is invalid. Provenance is expected to be flagged in the UI by `WireSampleNotice.tsx` —
> **verifying that banner actually appears is a browser check and is part of the blocked set.**

### 2.4 Static inspection (inspection, not verification)

Recorded to make the blocked browser pass cheap for whoever runs it — these are *testable hypotheses*,
not results.

| Area | Observation |
|---|---|
| Viewport | `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` present |
| Breakpoints | 7 media queries: 1080, 960, 680 (×2), 640, 600, plus `prefers-reduced-motion` |
| Overflow guards | **2** `overflow-x: auto` rules, against **10+ wide tables** (up to 11 columns in the orders/executions tables) |
| Fixed geometry | `.sidebar { width: 232px; flex: 0 0 232px }`; shell `max-width: 1380px` |
| Accessibility signals | 152 `aria-*` attributes, 78 `role=` attributes, 4 `:focus-visible` rules, skip link (`Layout.tsx:331` → `#main-workspace`) |
| Error copy | 13 distinct account error codes mapped to distinct user sentences (`AccountAnalytics.tsx:55–69`), e.g. `TIMESTAMP_SKEW`, `CORS_BLOCKED`, `RATE_LIMITED`, `SCHEMA_INCOMPATIBLE`, `ACCOUNT_STALE` |
| Onboarding surface | `Portfolio.tsx` holds create/unlock/update/migration passphrase fields, `accountVault.unlock()`, `accountVault.lock()` (`:420`), `deleteEntry()` (`:1045`) |
| Passphrase floor | Unlock button disabled until `unlockPassphrase.length >= 12` (`:837`) |

---

## 3. Checklist of tested flows

Legend: **V** verified · **F** failed · **B** blocked · **NT** not tested.

| # | Flow | Status | Evidence / reason |
|---|---|---|---|
| 1 | App builds and all routes mount | **V** | §2.1 build, §2.2 12/12 routes |
| 2 | 318 unit/SSR tests | **V** | §2.1 |
| 3 | Dev server serves app shell and hash deep links | **V** | §2.3 |
| 4 | Public-data path returns `testnet`-scoped payloads | **V** (dev only, wire samples) | §2.3 |
| 5 | Locked/unsigned state shows onboarding, not account data | **V** (markup level) | §2.2 — "Account locked", no data rows |
| 6 | **API-key setup with a real key** | **B** | No test account or key supplied; no browser |
| 7 | **Key validation / registry check against the exchange** | **B** | Requires credentials + live endpoint |
| 8 | **Invalid-key and malformed-key error handling (live)** | **B** | Requires credentials; copy path inspected only |
| 9 | **Passphrase create / unlock / re-unlock / delete entry** | **B** | Requires browser (IndexedDB, Web Crypto in-page) |
| 10 | **Lock behaviour and "no private request while locked"** | **B** | Requires browser + network panel |
| 11 | **Portfolio load / refresh / per-period caches** | **B** | Requires credentials |
| 12 | **Empty / loading / stale / unauthorized / network-error states (rendered)** | **B** | Requires browser or a live owner instance; copy mapping inspected (§2.4) |
| 13 | **Desktop layout at 1280–1920 px** | **B** | No browser |
| 14 | **Mobile layout at 360–430 px, orientation change** | **B** | No browser |
| 15 | **Horizontal overflow on wide tables** | **B** | No browser; hypothesis raised as F-02 |
| 16 | **Console errors / failed requests** | **B** | No browser to capture them |
| 17 | **Keyboard traversal, focus order, skip link activation** | **B** | No browser; skip link exists in source |
| 18 | **Touch target sizes** | **B** | No browser |
| 19 | **CSP / security headers as served** | **B** in dev | `_headers` is applied by Cloudflare Pages, not the dev server; file content is covered by `deployment-security.test.mjs` |
| 20 | Wire-sample provenance banner visible | **B** | No browser |
| 21 | Order placement, signing, mutations | **NT by design** | Out of scope; none attempted |

**Totals: 5 verified, 0 failed, 15 blocked, 1 not tested.**

---

## 4. Findings

No functional defect is asserted. Every finding below is either a tooling/environment fact or an
**unverified hypothesis** for the browser pass to confirm or reject.

| ID | Severity | Finding | Evidence | Status |
|---|---|---|---|---|
| **F-01** | Low | `check:performance` exits **1** when `apps/web/dist` is absent ("run npm run build first"). It is a build-ordering dependency, not a perf regression, but a fresh checkout run out of order shows a red gate. | `npm run check:performance` → `exit=1` with no `dist`; `exit=0` after `npm run build` | **Verified** |
| **F-02** | Medium *(hypothesis)* | **Horizontal overflow risk on narrow viewports.** Only 2 `overflow-x: auto` rules guard a set of tables with up to 11 columns (orders, executions, transfers, equity series). At 360 px, `.table-wrap` may not be applied on every table. | `grep -c "overflow-x" styles.css` → 2; `AccountAnalytics.tsx:308,376,470,1014,1041,1056` | **Unverified** — needs a browser at 360 px |
| **F-03** | Low *(hypothesis)* | `.sidebar` is fixed at `232px / flex: 0 0 232px`. Collapse behaviour at ≤680 px exists in CSS but its actual result is untested. | `styles.css:225–227`; media queries at 1080/960/680 | **Unverified** |
| **F-04** | Info | **Dev server sends no CSP or security headers**; they are produced by `apps/web/public/_headers` at the Pages layer. CSP therefore cannot be validated in dev — only on a Pages preview. | `curl -D -` → no `content-security-policy` | **Verified** |
| **F-05** | Info | **Dev public data is synthetic** (wire samples), `apiEnv: "testnet"`. Any data-accuracy conclusion drawn from a preview is invalid. | `/api/markets` → `{"apiEnv":"testnet",…}` from `docs/wire-samples` | **Verified** |
| **F-06** | Info | 13 account error codes each map to a distinct, specific user sentence — including `CORS_BLOCKED` ("No proxy or public-data fallback was used") and `ACCOUNT_STALE`. This is inspection evidence only; **no live 401/403 was exercised**. | `AccountAnalytics.tsx:55–69` | **Inspected, not exercised** |
| **F-07** | Info | Runtime reports `Node v22.22.3; engine >=24: FAIL`. Sandbox-only; every API probe passes. CI uses Node 24. | `npm run check:runtime` | **Verified (environmental)** |

---

## 5. What is needed to clear the blocked checks

**To unblock the browser pass — either works:**

1. **A live preview of this branch.** A dev server is currently running from this checkout on
   port **5199** (labelled *"PolyTools app (validation preview)"*). It renders the real app with
   wire-sample public data, which is enough for layout, keyboard, overflow, console and responsive
   checks — **but not** for real account data. Any modern browser, plus one mobile viewport
   (360×640 and 390×844 suggested), would clear items 13–20.
2. **Or a sandbox with a browser.** Chromium plus reachable CDN access (`cdn.playwright.dev` or
   `storage.googleapis.com`). Neither is available here.

**To unblock the credential-dependent checks (items 6–12):**

- An **authorized testnet** API key and its **registered key ID**, with testnet scope
  (`888169`), used only for read-only operations. Supply it through the app's own onboarding form in a
  browser session — **do not paste it into chat or into any file in this repository.**
- Confirmation that use of that key for a read-only validation pass is authorized.
- Without these, the private path remains **unverified by execution**, and no claim to the contrary
  should be made. The 318 tests exercise the signing, vault, and state machinery with synthetic
  fixtures — that is strong but it is **not** evidence of live API compatibility (`02` §7).

---

## 6. Release-readiness verdict

> ### **BLOCKED** — not "pass with limitations".

The distinction matters. "Pass with limitations" would mean the specified validation ran and produced
known gaps. It did not run: the two things it needs — a browser and an authorized test account — are
both absent. What ran is a strong *build-and-render* validation, which is a different question from
"does this work in a browser on a phone".

| Claim | Supportable today? |
|---|---|
| The branch builds, typechecks, and passes 318 tests | **Yes** — verified |
| Performance and contrast budgets hold | **Yes** — verified |
| Every route mounts and the locked state is honest | **Yes** — verified at markup level |
| The app renders correctly on desktop | **No** — blocked |
| The app is usable on a phone | **No** — blocked |
| Keyboard and screen-reader behaviour is sound | **No** — blocked (source signals only) |
| There are no console errors at runtime | **No** — blocked |
| API-key onboarding works against the exchange | **No** — blocked |
| Error states behave correctly with a live failure | **No** — blocked |

**No source, dependency, configuration, or PR scope was modified to produce this report.** All
findings are reported for separate decision; none was fixed during the pass.

---

## 7. Proposed fixes (not applied)

Offered as separate recommendations, per the brief's instruction to report rather than fix.

| For | Proposal |
|---|---|
| F-01 | Make `check-build-performance.mjs` emit a clear *"prerequisite: run build first"* skip rather than exit 1, or have the npm script depend on `build`. Low risk, tooling only. |
| F-02 | Add `overflow-x: auto` to `.table-wrap` variants and wrap the remaining wide tables; verify at 360 px before/after. |
| F-03 | Verify sidebar collapse at 680 px; if it overlays content, add a drawer with a focus trap (reuse `dialogFocus.ts`). |
| F-04 | Note in the validation guide that CSP is Pages-only; validate on the Pages preview URL, not `vite dev`. |
| F-06 | When a key is available, add one recorded read-only 401 fixture from the exchange to lock the error mapping to reality rather than to our assumption of it. |

---

## 8. Status at completion

| Item | Value |
|---|---|
| Commit tested | `92d7fd4a0d0006f1c699779436a788b273712363` |
| Checks run | `test`, `typecheck`, `build`, `check:performance`, `check:contrast`, `check:whitespace`, `check:dependencies`, `check:external`, `check:runtime`, SSR render harness, HTTP smoke |
| Results | **all pass** (F-01 noted); 318/318 tests, 16/16 render, 5/5 HTTP |
| Working tree | clean before and after (this document excepted) |
| PR #8 | **OPEN**, mergeable — not merged, not deployed |
| Merge/deploy | not performed |

**Next executable step:** with a browser available (either the live preview or a browser-capable
sandbox), re-run items 13–20 and record viewport-specific evidence. Items 6–12 stay blocked until an
authorized testnet key is supplied through the app's own form.
