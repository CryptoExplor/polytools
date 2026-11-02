# 14 — Manual browser pass: run sheet

**For you to execute. No browser is available to the agent, so this is the handoff.** Companion to
[`13_BROWSER_MOBILE_VALIDATION.md`](./13_BROWSER_MOBILE_VALIDATION.md), which holds the findings and
the BLOCKED verdict. This file is only the procedure.

Estimated time: **15–20 minutes for sections A–E**. **A–E need no credentials.** Section F does: it is
blocked until an authorized **testnet** key is entered through the app's own onboarding form, and F2
performs one **private read**. Nothing here can place an order, sign, or change an account setting.

---

## 1. The preview

### Already running

A Vite dev server is live in this workspace:

| | |
|---|---|
| Port | **5199** |
| Bound to | `0.0.0.0` (so the platform's authenticated preview proxy can reach it) |
| Local URL | **http://localhost:5199/** |
| Startup command | `cd /home/user/polytools/apps/web && ../../node_modules/.bin/vite --host 0.0.0.0 --port 5199 --strictPort` |
| Label in your UI | **"PolyTools app (validation preview)"** |

**How to open it:** use the **live preview** for that process — it appears alongside the running
process in your interface, served over the platform's own authenticated proxy.

**What I deliberately did *not* do:** no public exposure, no tunnel (no ngrok / cloudflared / localtunnel /
serveo), no port forward to a third party. The only access path is the platform's normal preview
mechanism, which is scoped to your session.

**What I verified about reachability:** a request to the dev server with a foreign `Host` header in the
preview-proxy form returns **200** with the 1,194-byte app shell — so Vite does not reject proxied
hosts. If the proxy path itself fails, that is a platform-side issue, and `http://localhost:5199`
remains valid inside this environment.

### If it is not running

```bash
cd /home/user/polytools
npm install                       # only if node_modules is missing (fresh workspace)
git checkout -- package-lock.json # npm install rewrites it; this restores it
cd apps/web && ../../node_modules/.bin/vite --host 0.0.0.0 --port 5199 --strictPort
```

> Do **not** run `npm run dev` from the repo root without arguments — it resolves to
> `apps/web` but ignores `--port`, and silently serves on 5173 instead.

---

## 2. Before you start — set the data expectation

Public data in this preview is **synthetic**: `docs/wire-samples/` fixtures served by a dev-only
fallback, labelled `apiEnv: "testnet"`. This validates **presentation**, never live exchange behaviour.

A banner should appear confirming this (§3, check C1). If you see numbers, they are fixtures.

---

## 3. Checklist

Tick each. Record **PASS** / **FAIL** / **BLOCKED** and one line of evidence. Do not mark PASS because
something rendered — mark it PASS because you checked the specific claim.

### How to read the Result column

**PASS / FAIL** = the agent actually executed this check in headless Chromium against
`http://127.0.0.1:5199` and observed the stated result (`13` §3.1). **NOT RUN** and **NOT ASSERTED**
are honest gaps — they are not passes. **BLOCKED** means credentials are required. Anything still
marked NOT RUN is worth a human two minutes; nothing else needs re-testing.

### A. Desktop — 1440 × 900 (or your default)

| # | Check | Expected | Result |
|---|---|---|---|
| A1 | `/` Dashboard loads, no blank shell | Content, no console red | **PASS** — 17/17 routes render, 0 app console errors |
| A2 | `/book`, `/tape`, `/charts`, `/heatmap`, `/compare`, `/zipper` each render | Tables/charts populated from fixtures | **PASS** — all render |
| A3 | `/calc` calculators accept input and update | Numbers recompute on type | **NOT RUN** — input not exercised |
| A4 | `/sdk`, `/brand-kit` render | Content present | **PASS** — render; prose not reviewed |
| A5 | `/account` while locked | Shows **"Account locked"**, key-setup entry, **no** account rows | **PASS** — locked copy on `/account`, `/trade`, `/orders`, `/pnl`, `/transactions`; **0 data rows** in all five |
| A6 | `/account` → "Load account data" while locked | Refuses, explains, **no** private request | **NOT RUN** — no key held, button not clicked. The locked *view* is asserted (A5) |

### B. Mobile — 360 × 640 (primary), then 390 × 844

| # | Check | Expected | Result |
|---|---|---|---|
| B1 | **No horizontal page scroll** — `scrollWidth <= innerWidth` | True | **PASS** — exactly equal at 360, 390, 768, 1440 |
| B2 | **Sidebar becomes a drawer** (breakpoint **960 px**) | Off-canvas by default | **PASS** — closed drawer at `x = -232` |
| B3 | **Burger opens the drawer**; backdrop dims | Slides in; backdrop visible | **PASS** — opens to `x = 0`, backdrop present |
| B4 | **Drawer scroll lock** | Body fixed | **PASS** — `body.overflow = hidden` |
| B5 | **Drawer closes**; focus not lost | Returns to content | **PASS** — Escape → `x = -232`, focus returns to the burger, lock released |
| B6 | **Wide tables scroll inside `.table-wrap`** | Table scrolls within; page does not | **PASS (page-level)** — every table is wrapped and the page never exceeds the viewport. The *inner* scroll of an oversized table was not exercised (one table per route at 360 px) |
| B7 | **Tap targets ≥ ~40 px** | Comfortable | **FAIL → F-08** — `Disconnect` is **92×24**; app-wide smallest 17–30 px vs the repo's 44 px standard |
| B8 | Text legible at 360 px; no clipped labels | No silent truncation | **NOT RUN** |
| B9 | Rotate to landscape | Layout holds | **PASS** — 390×844 → 844×390, no overflow, burger reachable |

### C. Provenance banner

| # | Check | Expected | Result |
|---|---|---|---|
| C1 | Banner appears after the first public response | *"Development wire samples used in this session."* with `role="note"` | **PASS** — exact copy observed |
| C2 | Banner persists when navigating between tools | Still visible on other routes | **PASS (partial)** — present on each data route loaded directly; in-page navigation not separately asserted |
| C3 | Banner **not** shown before any public fetch | Absent on first paint | **NOT RUN** |
| C4 | Private reads do not use wire-sample data | Account figures are not fixtures | **BLOCKED** — needs a key |

### D. Keyboard navigation

| # | Check | Expected | Result |
|---|---|---|---|
| D1 | First `Tab` reveals **"Skip to main content"** | Visible on focus, jumps to `#main-workspace` | **PASS** — `top 8px`, `outline 2px`; Enter moves focus to `MAIN` |
| D2 | Tab through the full nav — every item focusable | Focus ring throughout | **PASS** — 21 Tabs to "Connect wallet" at 1440, 3 at 390 |
| D3 | Focus order matches visual order | Left→right, top→bottom | **NOT ASSERTED** — order not compared against geometry |
| D4 | No keyboard trap outside the drawer | Can always tab out | **PASS** — **0 repeated identities** across the sweep |
| D5 | Drawer is a managed region | Focus in, Escape closes, focus returns | **PASS** |
| D6 | Closed drawer unreachable by Tab / hidden from AT | Skipped entirely | **NOT ASSERTED** — closed-drawer links never entered the tab set, but this was not probed directly |
| D7 | Controls operable with `Enter`/`Space` | Buttons, toggles, selectors | **PASS (partial)** — Enter verified on the skip link and wallet Connect; not every control |
| D8 | Visible focus indicator everywhere | Not suppressed | **PASS (partial)** — verified on the skip link only |

> **Note on the earlier "60 tabs, never reaches the wallet button" result: withdrawn.** It was a
> harness artefact — the sweep identified controls by `classList[0]`, and the wallet button's first
> class is not `.wallet-connect`. With class membership + stamped identity there is **no focus trap
> and no tab-order defect** (`13` §3.1).

### E. Console and network

| # | Check | Expected | Result |
|---|---|---|---|
| E1 | **Zero console errors** on a clean load | No red | **PASS** — 17 routes |
| E2 | No React warnings | No yellow React noise | **NOT ASSERTED** — only `error`-type messages were captured |
| E3 | **No failed requests** except expected noise | All `/api/*` → 200 | **PASS** — every failure attributed: `assets.polyester.com` (blocked in sandbox) and `api.coingecko.com` (blocked on purpose). 0 app-origin failures |
| E4 | No account/private endpoint while locked | Only public routes | **PASS** — **0 `/v1/` requests** through the whole vault flow |
| E5 | No request carries credentials/tokens/signatures | Headers clean | **NOT ASSERTED** — request headers not captured |

> **E3 addendum — `api.coingecko.com` is expected, not a defect.** `#/compare` fetches reference
> prices from the free CoinGecko API (`apps/web/src/lib/coingecko.ts`), documented in `README.md:47`.
> When blocked it degrades correctly: page renders, `role="alert"` reads *"Cannot reach the market data
> service. CoinGecko reference feed: Failed to fetch"*, **no page error**.

### G. Wallet connection — NEW (the phase under test)

Synthetic EIP-1193 provider injected before load; every state below is the rendered result.

| # | Check | Expected | Result |
|---|---|---|---|
| G1 | No provider installed | "No wallet", no crash | **PASS** |
| G2 | Idle with provider | "Connect wallet" | **PASS** |
| G3 | Connect | address + chain + Disconnect | **PASS** — `0xabcd…ef01 / Ethereum / Disconnect` |
| G4 | `accountsChanged` | Displayed address updates | **PASS** |
| G5 | `chainChanged` | Chain badge updates | **PASS** — → Sepolia |
| G6 | Accounts revoked (`accountsChanged: []`) | Returns to "Connect" | **PASS** |
| G7 | Disconnect control | Returns to "Connect" | **PASS** |
| G8 | **Rejected connection** (`4001`) | Error state + Retry, no uncaught error | **PASS** — title "Connection request was declined in your wallet." |
| G9 | **Wallet already pending** (`-32002`) | Error state + Retry | **PASS** — title "Your wallet already has a pending request. Open it and finish that first." |
| G10 | Keyboard: Tab → Enter connects (390 px) | Works | **PASS** — 3 tabs |

> **Not in this pass:** a *real* wallet extension. You reported that a real wallet connected in the
> preview; that stays **user-reported** evidence for W-10/W-11, not agent-verified (`07`).

### F. Private API-key flow

| # | Check | Status | Note |
|---|---|---|---|
| F1 | Create vault entry (passphrase ≥ 12 chars, confirmation must match) | **PASS (local key)** | Created with a locally generated key; **exchange** key still blocked |
| F2 | Unlock → one private read succeeds | **BLOCKED** | Needs an exchange key. Local encryption/unlock verified |
| F3 | Exact sanitized error on a bad key | **BLOCKED** | Needs an exchange key |
| F4 | Refresh gate / visibility refresh | **BLOCKED** | Needs a key |
| F5 | Lock → no further private requests; cache not served | **PASS (local)** | **0 `/v1/`** while locked |
| F6 | Stale marker after the freshness window | **BLOCKED** | Needs a key |

### H. Vault behaviour on a local key — NEW

| # | Check | Expected | Result |
|---|---|---|---|
| H1 | Create + encrypt | Entry listed, unlocked in memory | **PASS** — heading "Unlocked: probe-key" |
| H2 | Plaintext passphrase never rendered | Absent from the DOM text | **PASS** |
| H3 | Lock | Back to "Vault locked" | **PASS** |
| H4 | **Wrong passphrase** | Does **not** unlock | **PASS** — stays "Vault locked" |
| H5 | Wrong passphrase feedback | A clear error | **PASS** — `role="alert"`: "The entry could not be unlocked. The passphrase may be wrong or the encrypted record may have changed." |
| H6 | Wrong passphrase clears the field | Field empty | **PASS** |
| H7 | Correct passphrase | Unlocks | **PASS** |
| H8 | No private request during create/lock/unlock | 0 `/v1/` | **PASS** |
| H9 | Delete requires confirmation | Dialog | **PASS** — "Delete encrypted entry?" |
| H10 | Entry removed | Gone from the list | **PASS** |

> **Correction to an earlier claim in this pass.** A freshly created entry is **unlocked in memory
> immediately**, so probing a wrong passphrase right after creation proves nothing. The "unlocks
> without the passphrase" observation was that state, not a bypass. Locked first, the wrong
> passphrase fails — **no vulnerability**.

---

## 4. What is still worth a human pass

Most of §3 is now executed. Only these remain, and none needs a wallet or an exchange key:

| Check | Why it is still open | Effort |
|---|---|---|
| A3 | Calculator input/recompute never exercised | ~1 min |
| A6 | "Load account data" while locked — no key held | ~1 min |
| B6 (inner scroll) | Only one table per route at 360 px, so the *inner* scroll of a wide table was never forced | ~2 min on `#/account` with data |
| B8 | Text clipping at 360 px not measured | ~1 min |
| C3 | Banner absence before the first fetch | ~30 s |
| D3, D6, D8 | Focus *order* vs geometry, closed-drawer reachability, focus ring on every control | ~3 min |
| E2, E5 | Console **warnings**, request **headers** | ~2 min |

Everything else in §3 carries a result. For a FAIL, give the check ID, the viewport, and the
misbehaving selector (DevTools → *Copy → Copy selector*), with any private header or query value
removed.

---

## 5. What this pass can and cannot establish

| Now supported by executed evidence | Still **not** established |
|---|---|
| The app renders at 360, 390, 768, 1280, 1440, 1920 px with no horizontal overflow | That live exchange behaviour is correct |
| The drawer opens, closes, locks scroll, and manages focus | That API-key onboarding works against the exchange |
| Tables are wrapped and the page never overflows | That stale/401/403 states behave on a real failure |
| Keyboard traversal is complete and untrapped (21/3 tabs, no repeats) | That touch targets meet the repo's own 44 px standard — they **do not** (F-08) |
| Wallet connect/disconnect/`accountsChanged`/`chainChanged`/rejection/pending all render correctly | That a real wallet extension behaves identically (user-reported only) |
| The local vault encrypts, locks, rejects a wrong passphrase with an alert, and deletes | That a real exchange key unlocks one private read |
| No app-origin console or page errors on 17 routes | That the app is release-ready, or that CSP is correct as served |

A clean pass clears items **5, 9, 10, 13–17 and 20** in `13` §3. It **cannot** clear item 19 (CSP is
applied at the Pages layer, not by the dev server) and it cannot clear the credential-bound items
6, 7, 8, 11 and part of 12. Touch targets are now a **measured defect (F-08)**, not a pass.

---

## 6. State of the deliverables

| | |
|---|---|
| Validation verdict | **BLOCKED** — reduced to credentials + CSP, not tooling (`13` §5) |
| Browser pass | **executed** — 35/35 checks, plus 7 vault and 6 layout checks (`13` §3.1) |
| Hypotheses retracted | **F-02, F-03** — source contradicts both; the 360 px render confirms it (`13` §4.1) |
| Findings verified | F-01, F-04, F-05, F-07 |
| Findings measured | **F-08** — touch targets, pre-existing and app-wide (`13` §4.2) |
| Findings inspected-only | F-06 |
| NBA-5 | wallet connection **works**; real-wallet evidence is user-reported only |
| PR #8 | open, unmerged; this runsheet is documentation |
| Source / dependencies | unchanged by this pass |
