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
| 1 | App builds and all routes mount | **V** | §2.1 build; §3.1 — 17/17 routes render in Chromium |
| 2 | Unit + gate tests | **V** | §2.1; `npm test` 370/370 |
| 3 | Dev server serves app shell and hash deep links | **V** | §2.3; every §3.1 run deep-links directly |
| 4 | Public-data path returns `testnet`-scoped payloads | **V** (dev only, wire samples) | §2.3 |
| 5 | Locked/unsigned state shows onboarding, not account data | **V (browser)** | `#/account`, `/trade`, `/orders`, `/pnl`, `/transactions`: locked/onboarding copy present, **0 `tbody tr`** in all five |
| 6 | **API-key setup with a real exchange key** | **B** | No authorized testnet key — unchanged. The *local* key vault path was exercised instead (§3.1 E) |
| 7 | **Key validation / registry check against the exchange** | **B** | Requires an authorized testnet key + live endpoint |
| 8 | **Invalid-key and malformed-key error handling (live)** | **B** | Requires credentials; copy path inspected only |
| 9 | **Passphrase create / unlock / re-unlock / delete entry** | **V (browser)** | §3.1 E1–E10 |
| 10 | **Lock behaviour and "no private request while locked"** | **V (browser)** | §3.1 E3, E8: **0 `/v1/` requests** across create → lock → wrong unlock → unlock |
| 11 | **Portfolio load / refresh / per-period caches** | **B** | Requires credentials |
| 12 | **Empty / loading / stale / unauthorized / network-error states (rendered)** | **V (partial)** | Browser: network-error (blocked reference feed → explicit `role="alert"`, no page error, no blank screen), wallet error states, vault error alert. **Stale re-auth and live 401/403 still need an owner instance → B** |
| 13 | **Desktop layout at 1280–1920 px** | **V (browser)** | 1280, 1440, 1920: `scrollWidth == innerWidth`, sidebar `display:flex` |
| 14 | **Mobile layout at 360–430 px, orientation change** | **V (browser)** | 360×640 and 390×844 clean; 390×844 → 844×390 resize keeps `scrollWidth == innerWidth`, burger stays reachable. **430 px not swept** |
| 15 | **Horizontal overflow on wide tables** | **V (browser)** | Every table sits inside `.table-wrap` at 360/390/768/1440 and the document never exceeds the viewport — the §4.1 residual risk is **closed** |
| 16 | **Console errors / failed requests** | **V (browser)** | 17 routes: **0 app-origin console errors, 0 page errors**. All failed requests attributed to blocked `assets.polyester.com` CDN and the deliberately blocked CoinGecko feed (§3.1 F) |
| 17 | **Keyboard traversal, focus order, skip link activation** | **V (browser)** | 21 Tabs to "Connect wallet" at 1440, 3 at 390, **no repeated identity** (no trap); skip link visible on focus (`outline 2px`, top 8) and moves focus to `main`; drawer focus/scroll-lock/return verified |
| 18 | **Touch target sizes** | **F** | **Measured, not assumed.** `Disconnect` 92×24; app-wide smallest controls 17–30 px against the repo's own **44 px** standard (`docs/audit/UX_AUDIT.md:23`). Pre-existing, app-wide — **F-08** |
| 19 | **CSP / security headers as served** | **B** in dev | `_headers` is applied by Cloudflare Pages, not the dev server; file content is covered by `deployment-security.test.mjs`. Needs a Pages preview |
| 20 | Wire-sample provenance banner visible | **V (browser)** | Rendered on every data route: "Development wire samples used in this session. Some public responses are captured or derived fixtures…" |
| 21 | Order placement, signing, mutations | **NT by design** | Out of scope; none attempted |

**Totals: 13 verified, 1 partial, 1 failed, 5 blocked, 1 not tested** (21 items).
Findings: F-01, F-04, F-05, F-07 verified; F-02, F-03 retracted; **F-08 measured (Low, pre-existing)**;
F-06 inspected-only.

### 3.1 Browser evidence — how these were produced

Executed, not inferred. Chromium (headless) against the running preview on
`http://127.0.0.1:5199`, driven by `puppeteer-core`. All non-app requests were intercepted and
aborted so that a sandbox network restriction could never be mistaken for an app defect, and every
aborted request was recorded and attributed (§3.1 F). Harnesses: `final.mjs` (35 checks, 35 pass),
`gate2.mjs` + `errprobe.mjs` (vault, 7 checks), `last.mjs` (6 checks).

| Group | Checks | Result |
|---|---|---|
| A — wallet: no provider, idle, connect, `accountsChanged`, `chainChanged`, `accounts → []`, disconnect, page errors, `4001`, `-32002` | A1–A10 | **10/10 pass** |
| B — keyboard: Tab to Connect @390, Enter connects, skip link focus + activation, drawer open/Escape/return/scroll-lock | B1–B6 | **6/6 pass** |
| C — 17 routes render, no app console errors | C1 | **pass** — see F below for the one non-app host |
| D — 360/390/768/1440: no overflow, wallet fits, tables wrapped | D×8 | **8/8 pass** |
| E — API-key vault, locally generated key: create/encrypt, no plaintext echo, lock, **wrong passphrase**, error alert, field cleared, correct unlock, no `/v1/`, delete dialog, removal | E1–E10 | **10/10 pass** |
| L — desktop 1280/1440/1920, orientation change, locked routes, provenance banner | L×6 | **6/6 pass** |

**Two harness defects found and fixed** (worth recording, because both produced *false* results
earlier in this pass):

1. **The "60 tabs and never reaches the wallet button" result was a harness artefact.** The sweep
   identified each control by `classList[0]`, and the wallet button's first class is not
   `.wallet-connect`. Using class *membership* plus a stamped `data-tabi` identity gives 21 tabs at
   1440 and 3 at 390 with **zero identity repeats**. There is **no focus trap and no tab-order
   defect**. The earlier observation is withdrawn.
2. **The apparent "unlocks with a wrong passphrase" was an unlocked entry, not a bypass.** Entries
   are **unlocked in memory immediately after creation**, so a wrong-passphrase probe on a
   freshly-created entry proves nothing. Locking first and then submitting a wrong passphrase on the
   dedicated `aria-label="Passphrase to unlock selected entry"` field: heading stays **"Vault
   locked"**, a `role="alert"` reads "The entry could not be unlocked. The passphrase may be wrong or
   the encrypted record may have changed.", the field is cleared, and only the correct passphrase
   unlocks. **No bypass.** (The first failing assertion was my own regex missing "could not be
   unlocked", not a missing message.)

### 3.2 What the browser pass did *not* establish

- No exchange key was used, so **items 6, 7, 8, 11 and the stale/401/403 half of item 12 remain
  blocked** by credentials, not by tooling.
- CSP (item 19) is still a Pages-layer property; the dev server cannot show it.
- The 430 px breakpoint was not swept (360, 390, 768, 844×390 landscape, 1280, 1440, 1920 were).
- `assets.polyester.com` could not be fetched from the sandbox, so **real brand image rendering is
  unverified** — layout was measured with those requests aborted.

---

## 4. Findings

The browser pass of §3.1 has now run. What it changed: the two hypotheses (F-02, F-03) were
**retracted**, and one **measured** defect (F-08) replaced them. No wallet, keyboard, layout or
vault defect was found; the defects below are a build-ordering quirk, an environment fact, and an
app-wide CSS convention.

| ID | Severity | Finding | Evidence | Status |
|---|---|---|---|---|
| **F-01** | Low | `check:performance` exits **1** when `apps/web/dist` is absent ("run npm run build first"). It is a build-ordering dependency, not a perf regression, but a fresh checkout run out of order shows a red gate. | `npm run check:performance` → `exit=1` with no `dist`; `exit=0` after `npm run build` | **Verified** |
| ~~**F-02**~~ | ~~Medium~~ → **retracted** | ~~Horizontal overflow risk: only 2 `overflow-x` rules for tables up to 11 columns~~ **Retracted — see §4.1.** The rule count was the wrong metric: one reusable `.table-wrap { overflow-x: auto }` class is applied to **all 21 tables in the app (21/21)**. | `styles.css:1097–1098`; per-file counts in §4.1 | **Hypothesis retracted** — Low residual, §4.1 |
| ~~**F-03**~~ | ~~Low~~ → **retracted** | ~~`.sidebar` fixed at 232px; collapse at ≤680 px untested; may overlay content~~ **Retracted — see §4.1.** The drawer breakpoint is **960 px**, not 680; a complete off-canvas drawer with backdrop, transform, `overscroll-behavior: contain` and real JS focus/scroll-lock management already exists. | `styles.css:2054–2090`; `Layout.tsx:164–280,382,486` | **Hypothesis retracted** — see §4.1 |
| **F-04** | Info | **Dev server sends no CSP or security headers**; they are produced by `apps/web/public/_headers` at the Pages layer. CSP therefore cannot be validated in dev — only on a Pages preview. | `curl -D -` → no `content-security-policy` | **Verified** |
| **F-05** | Info | **Dev public data is synthetic** (wire samples), `apiEnv: "testnet"`. Any data-accuracy conclusion drawn from a preview is invalid. | `/api/markets` → `{"apiEnv":"testnet",…}` from `docs/wire-samples` | **Verified** |
| **F-06** | Info | 13 account error codes each map to a distinct, specific user sentence — including `CORS_BLOCKED` ("No proxy or public-data fallback was used") and `ACCOUNT_STALE`. This is inspection evidence only; **no live 401/403 was exercised**. | `AccountAnalytics.tsx:55–69` | **Inspected, not exercised** |
| **F-07** | Info | Runtime reports `Node v22.22.3; engine >=24: FAIL`. Sandbox-only; every API probe passes. CI uses Node 24. | `npm run check:runtime` | **Verified (environmental)** |
| **F-08** | Low (pre-existing, app-wide) | **Touch targets are below the repo's own minimum.** Measured in a 360 px viewport: `Disconnect` is **92×24 px**; the app-wide smallest interactive controls are `th-sort-btn` 17 px, `star-btn` 18×21, footer links 17, `row-action-btn` 22, `.btn.sm` 24, `.seg-btn` 24, `.btn.primary` 29, `.burger` 30. `docs/audit/UX_AUDIT.md:23` states a **44 px** minimum for account tabs, and `styles.css` uses `min-height:44px` in three places — but small buttons are consistently 24 px. **The wallet controls follow the existing `.btn.sm` convention, so this is not a regression introduced by wallet work**; it is a pre-existing gap between the documented standard and the stylesheet. | `styles.css` `.btn.sm`; measured geometry in §3.1 | **Measured, not fixed** (see §4.2) |

### 4.1 Correction — F-02 and F-03 are retracted (2026-10-27, post-commit review)

Both were raised as **unverified hypotheses**. On re-inspection against the source, **both are
contradicted by evidence**, so they are withdrawn rather than left standing. Recording the mechanism of
the error, because the same mistake is easy to repeat.

**F-02 — wrong metric.** I counted `grep -c "overflow-x" styles.css` → **2** and inferred sparse
coverage. But 2 is the number of *rules*, not the number of *guarded tables*. The relevant rule is a
single reusable class:

```css
.table-wrap { overflow-x: auto; border: 1px solid var(--border-subtle); … }
```

and it is applied to **every table in the application**:

| File | `<table>` | `table-wrap` wrappers |
|---|---|---|
| `AccountAnalytics.tsx` | 10 | 10 |
| `AccountCostBasis.tsx` | 2 | 2 |
| `Zipper.tsx` | 3 | 3 |
| `SdkGuide.tsx` | 2 | 2 |
| `Compare.tsx` / `Dashboard.tsx` / `Heatmap.tsx` / `Portfolio.tsx` | 1 each | 1 each |
| **Total** | **21** | **21** |

21 tables, 21 wrappers, **100 % correspondence**. The wide-table overflow risk I described is **not
supported by the source**. A residual risk remains — whether `overflow-x: auto` on `.table-wrap` is
sufficient *within* a flex/grid parent that itself lacks `min-width: 0` is a real CSS subtlety, and only
a 360 px render can settle it. That residual is **Low**, not Medium.

**F-03 — wrong breakpoint, and the feature exists.** I asserted the sidebar "collapses at ≤680 px" and
that its behaviour was untested. Both parts were wrong:

- The drawer breakpoint is **960 px** (`@media (max-width: 960px)`), not 680. The 680 px block only
  changes `.grid` column counts.
- Inside that block the sidebar becomes a proper off-canvas drawer: `position: fixed`,
  `transform: translateX(-100%)` → `translateX(0)` on `.open`, a `.sidebar-backdrop.open` overlay,
  `overscroll-behavior: contain`, and `height: auto; max-height: 100%` with a comment explaining it
  avoids overshooting phones whose browser toolbar collapses.
- The JS beside it is more careful than my hypothesis assumed: focus moves into the opened drawer and
  is handed off on close; the closed drawer is hidden from focus **and** assistive technology;
  `document.body.style.overflow` is locked while open and restored afterwards; resizing out of the
  mobile layout does not strand focus in a subtree about to become inert. A `.burger` button exists at
  `Layout.tsx:382,486`.

So there is **no evidence** that the sidebar overlays content or lacks mobile handling. What remains
untested is whether the *rendered result* matches the intent — a browser question, not a code question.

**Net effect:** the browser pass should **not** go hunting for these two bugs. Priority shifts to
confirming that the (already-implemented) drawer opens and that `table-wrap` scrolls at 360 px. If
either fails, that is a genuine finding — with the source above as the expected behaviour.

---

### 4.2 Why F-08 is recorded but not fixed in this change

F-08 is a **real** measured deviation from a documented standard, but fixing it is not a
wallet-connection change:

- The 24 px height comes from the shared `.btn.sm` class, used across markets, account, Compare and
  the wallet cluster alike. Raising it changes control geometry on every page — a design decision
  with visual-regression consequences, not a bug fix.
- The wallet-first scope for this phase is wallet connectivity; a global density change would widen
  the diff well beyond it and could not be validated per-page in the same pass.
- `docs/audit/UX_AUDIT.md` already contains the standard, so the gap is **documented**, not silent.

Recommendation for a follow-up change (not this one): raise `.btn.sm` (and `th-sort-btn`,
`star-btn`, `row-action-btn`) to a ≥44 px hit area — usually via padding or a `::after` overlay so
visual density on desktop is preserved while the touch area grows.

## 5. What is needed to clear the remaining blocked checks

The browser is **no longer** the blocker: the pass ran headless in this sandbox (§3.1). What remains
blocked is blocked on **credentials and deployment surface**, not on tooling.

| Item | Blocked on | Who can clear it |
|---|---|---|
| 6, 7, 8, 11, part of 12 | An **authorized Polyester testnet API key**, entered by you through the app's own onboarding UI. Do not send the key; paste it into the app yourself. | You, with a testnet key |
| 12 (stale / 401 / 403) | A live owner instance with a key that can be made invalid, or an expired session | You, same session |
| 19 (CSP as served) | A **Cloudflare Pages** preview of this branch — headers do not exist on the Vite dev server | A Pages deploy (**not authorised; do not deploy**) |

Everything that a browser could settle has been settled. Re-running §3.1 requires nothing from you.
