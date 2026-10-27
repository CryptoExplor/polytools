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

### A. Desktop — 1440 × 900 (or your default)

| # | Check | Expected | Result |
|---|---|---|---|
| A1 | `/` Dashboard loads, no blank shell | Content, no console red | |
| A2 | `/book`, `/tape`, `/charts`, `/heatmap`, `/compare`, `/zipper` each render | Tables/charts populated from fixtures | |
| A3 | `/calc` calculators accept input and update | Numbers recompute on type | |
| A4 | `/sdk`, `/brand-kit` render | Content present | |
| A5 | `/account` while locked | Shows **"Account locked"**, key-setup entry, **no** account rows | |
| A6 | `/account` → "Load account data" while locked | Refuses, explains unlock needed, **no** private network request | |

### B. Mobile — 360 × 640 (primary), then 390 × 844

DevTools → toggle device toolbar → **iPhone SE / 360×640**. This is the priority viewport.

| # | Check | Expected | Result |
|---|---|---|---|
| B1 | **No horizontal page scroll** — `document.documentElement.scrollWidth <= window.innerWidth` | True; if false, record which element overflows | |
| B2 | **Sidebar becomes a drawer** (breakpoint is **960 px**, not 680) | Sidebar off-canvas by default | |
| B3 | **Burger button opens the drawer**; backdrop dims the page | Drawer slides in; backdrop visible | |
| B4 | **Drawer scroll lock** — page behind does not scroll while open | Body fixed | |
| B5 | **Drawer closes** via backdrop tap / nav link / Escape | Returns to content; focus not lost | |
| B6 | **Wide tables scroll inside their container** — `/account`, `/zipper`, `/compare` | Table scrolls horizontally **within** `.table-wrap`; the page does not | |
| B7 | **Tap targets ≥ ~40 px** on primary nav and buttons | Comfortable; note any cramped ones | |
| B8 | Text legible at 360 px; no clipped labels | No truncation without ellipsis | |
| B9 | Rotate to landscape (640 × 360) | Layout holds; no overlap | |

> **B1/B6 note.** F-02 was **retracted**: all 21 tables use `.table-wrap { overflow-x: auto }`. The only
> open question is whether that wrapper scrolls correctly *inside* its parent at 360 px. If a table
> pushes the whole page wide, that is a **genuine Low finding** — capture the element.
> Likewise F-03 was retracted: the drawer exists with focus management
> (`styles.css:2054–2090`, `Layout.tsx:164–280`). B2–B5 test *the rendered result*, not a missing feature.

### C. Provenance banner

| # | Check | Expected | Result |
|---|---|---|---|
| C1 | Banner appears after the first public response | *"Development wire samples used in this session."* with `role="note"` | |
| C2 | Banner persists when navigating between tools | Still visible on other routes | |
| C3 | Banner **not** shown before any public fetch | Absent on first paint | |
| C4 | Private/account reads do not *use or trigger* wire-sample data | Account figures are not fixtures. The banner may **remain visible** from an earlier public fetch — `WireSampleNotice` states it "remains visible across tools", so a persisting banner is **not** a failure here; do not assert that it disappears | |

### D. Keyboard navigation

Unplug the mouse (or ignore it).

| # | Check | Expected | Result |
|---|---|---|---|
| D1 | First `Tab` reveals **"Skip to main content"** | Visible on focus, jumps to `#main-workspace` | |
| D2 | Tab through the full nav — every item focusable | Visible focus ring throughout | |
| D3 | Focus order matches visual order | Left→right, top→bottom | |
| D4 | No keyboard trap outside the drawer | Can always tab out | |
| D5 | Drawer **is** a managed region (mobile): focus moves in, Escape closes, focus returns | Focus enters on open, returns to burger on close | |
| D6 | Closed drawer is unreachable by Tab and hidden from AT | Skipped entirely | |
| D7 | All interactive controls reachable and operable with `Enter`/`Space` | Buttons, toggles, period selectors | |
| D8 | Visible focus indicator on every control | Not suppressed | |

### E. Console and network

Open DevTools → Console **and** Network before loading. Keep them open for all of §3.

| # | Check | Expected | Result |
|---|---|---|---|
| E1 | **Zero console errors** on a clean load | No red | |
| E2 | No React warnings (keys, controlled inputs, hydration) | No yellow React noise | |
| E3 | **No failed requests** except the dev-only HMR socket (see note) | All `/api/*` → 200 | |
| E4 | No request to any account/private endpoint while locked | Only `/api/*` public routes | |
| E5 | No request carries credentials, tokens, or signatures | Headers clean | |

> **E3 note — expected noise, not a defect.** Vite's HMR client opens a WebSocket. Through the preview
> proxy it may fail and log one `WebSocket connection failed` message. That is the **dev server**, not
> the app. **Ignore exactly that one**; anything else is a finding. If it makes E1/E3 hard to judge, say
> so — a production build served statically has no HMR socket, but it also loses the fixture data that
> makes populated tables testable, so the dev server is the right tool here.

### F. Private API-key flow — **BLOCKED, do not run yet**

Keep blocked until you have an authorized testnet key. When you do, use the app's **own onboarding
form** in the browser. **Never paste the key into chat, a commit, a screenshot, or a log.**

| # | Check | Status | To be run when |
|---|---|---|---|
| F1 | Create vault entry (passphrase ≥ 12 chars, confirmation must match) | **BLOCKED** | Key available |
| F2 | Unlock → one private read succeeds | **BLOCKED** | Key available |
| F3 | Exact sanitized error on a bad key (record code + one-line message, no key material) | **BLOCKED** | Key available |
| F4 | Refresh: manual bypasses the 2-minute gate; visibility refresh respects it | **BLOCKED** | Key available |
| F5 | Lock → no further private requests; cached data not served | **BLOCKED** | Key available |
| F6 | Stale marker appears after the freshness window | **BLOCKED** | Key available |

---

## 4. What to send back

For each **FAIL**, this is the minimum that makes it actionable:

1. Check ID (e.g. `B6`)
2. Viewport (e.g. `360×640`)
3. What you saw vs what §3 says to expect
4. The overflowing/misbehaving element — DevTools → right-click → *Copy → Copy selector*
5. Console/network line **with any query string or header values from a private request removed**

For **PASS** rows, the check IDs alone are enough (`A1–A6, B1–B9, C1–C4, D1–D8, E1–E5 pass`).

---

## 5. What this pass can and cannot establish

| After a clean pass, you may claim | You still may **not** claim |
|---|---|
| The app renders correctly at 360 px and desktop | That live exchange behaviour is correct |
| The drawer opens, closes, and manages focus | That API-key onboarding works against the exchange |
| Tables scroll inside their containers | That error states behave correctly on a real failure |
| Keyboard traversal is complete | That the app is release-ready |
| No console errors at runtime | That wallet-first work can build on a verified UI baseline |

A clean pass clears checklist items **13–18 and 20** in `13` §3. Item **19 (CSP/security headers as
served) is not clearable from a Vite dev server** — it needs a Pages preview or the
`deployment-security.test.mjs` source check. A clean pass plus item 19 moves the verdict from
**BLOCKED** to **pass with limitations**, with the private path still blocked. It does not make the
product release-ready.

---

## 6. State of the deliverables

| | |
|---|---|
| Validation verdict | **BLOCKED**, unchanged (`13`) |
| Hypotheses retracted | **F-02, F-03** — source contradicts both (`13` §4.1) |
| Findings verified | F-01, F-04, F-05, F-07 |
| Findings inspected-only | F-06 |
| NBA-5 | **on hold** pending this pass |
| PR #8 | open, unmerged; this runsheet is documentation |
| Source / dependencies | unchanged |
