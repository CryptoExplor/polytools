# 05 — Migration plan

Staged, incremental, reversible. **Each stage is independently mergeable and independently
abandonable.** No stage requires a big-bang cutover.

| | |
|---|---|
| **Baseline** | `091a1b1803ce1fb672e5593c10b51fc0c4cbf23c` (green: 318/318 tests, typecheck clean) |
| **Hard gates** | G1 SDK licence — **reduced 2026-10-27 to accepted risk** (Q3); G2 no mainnet environment (all stages) |
| **Guiding rule** | The API-key path stays working until stage 8, behind a flag from stage 3 onward |
| **Out of scope** | Any mutation, any backend, any database, any history rewrite |

---

## Stage 0 — Baseline and capability audit *(this phase — complete)*

- **Files:** `docs/wallet-first-audit/*` only. No source change.
- **Blockers:** none.
- **Tests:** existing suite must stay green (it does: 318/318).
- **Acceptance:** eight reports published; baseline corrections documented; no source file modified.
- **Security risk:** none.
- **Rollback:** delete the directory.
- **User approval:** not required (no behaviour change).

---

## Stage 1 — Baseline reconciliation *(recommended first action)*

Three small, honest housekeeping items, because current documentation is misleading.

1. **Restore `docs/build-reality-audit/`.** It is absent from the repository while the brief
   treats it as protected and authoritative — including as the definition of F-07–F-11.
   Without it, "keep F-07–F-11 deferred" is unactionable.
2. **Correct the baseline record.** `README.md`/audit docs should state HEAD `091a1b1`, PR #6
   merged, PR #7 merged.
3. **Resolve the Node engine drift** (repo requires ≥24, CI/dev may run 22 → `EBADENGINE`).

- **Files:** `docs/**`, possibly `package.json`, `.github/workflows/ci.yml`.
- **Dependencies:** user must supply the missing directory (it is user-owned; I must not
  recreate it from memory).
- **Tests:** `npm run check:whitespace`, `npm test`, `npm run check:external`.
- **Acceptance:** the audit directory exists and is byte-identical to the user's copy; no
  source behaviour changes; tests unchanged.
- **Security risk:** none.
- **Rollback:** revert the docs commit.
- **User approval:** **required** (Q1, Q2, Q5).

---

## Stage 2a — Wallet connection only *(smallest safe first implementation)*

**Scope: connect, show address, disconnect. Nothing else.** No exchange login, no signature,
no account data, no SDK dependency.

- **Files (new):**
  - `apps/web/src/lib/wallet.ts` — `WalletConnection` store: EIP-1193 discovery,
    `eth_requestAccounts`, `accountsChanged`, `chainChanged`, `disconnect`; exposes
    `{status, address, chainId}` via `useSyncExternalStore`.
  - `apps/web/src/components/ConnectWallet.tsx` — minimal UI: connect button, address,
    chain badge, disconnect.
  - `tests/wallet-connection.test.mjs` — synthetic provider, no network.
- **Files (modified, minimal):** `apps/web/src/lib/store.tsx` (mount the store, or keep it
  separate), `apps/web/src/components/Layout.tsx` (one nav affordance).
- **Does NOT touch:** vault, account routes, data layer, backend, CSP, `package.json` deps
  beyond adding `viem` if required.
- **Dependencies:** none on the SDK → **not blocked by G1**. `viem` is MIT-licensed.
- **Tests to add:** connect/disconnect transitions; `accountsChanged` maps to disconnected-ish
  state and *never* authenticates; `chainChanged` handled without logout loops; no provider →
  degraded UI, not a crash; SSR/`window`-less safety.
- **Acceptance:** a user can connect MetaMask/Rabby on testnet and see their address; no request
  to any Polyester endpoint is made; existing 318 tests still pass; the account routes behave
  exactly as before.
- **Security risks:** provider spoofing (an injected object can lie about the address — it is
  display-only, so the impact is bounded because nothing is authorized); `accountsChanged`
  handling must exist from day one even though nothing depends on it yet.
- **Rollback:** delete two files + one nav line.
- **User approval:** recommended (it is the first visible change).

---

## Stage 2b — Exchange login (SIWE) — **G1 reduced to accepted risk; not blocked**

Adds wallet→session authentication and nothing else: no account data reads yet.

- **Files (new):**
  - `apps/web/src/lib/exchangeSession.ts` — wraps
    `PolyesterBrowserClient` + `AccountSignerAuthService`: `login()`, `restoreSession()`,
    `logout()`, `refreshSession()`, `getSessionTimeToExpiry()`, event wiring.
  - `apps/web/src/lib/accountSigner.ts` — derives `accountAddress` offline via
    `createPolyesterAccountSigner`, then **hand-builds** the `AccountSigner` whose
    `signMessage` returns the owner EOA's raw 65-byte EIP-191 signature (not ERC-6492).
  - `tests/exchange-session.test.mjs` — synthetic transports (`config.transports` injection
    exists precisely for this), no live call.
- **Files (modified):** `components/ConnectWallet.tsx` (add "Sign in to Polyester"),
  `apps/web/src/lib/store.tsx`.
- **Blockers:** **G1 — reduced 2026-10-27.** A Polyester team member stated third-party use is
  acceptable ("fine to use it to build bots and trade on Polyester"). Proceed on **accepted risk**.
  In parallel, obtain a durable attributable record (official GitHub account or email) and keep the
  in-app disclosure. Residual gap: redistribution of SDK code into third-party browsers is not
  explicitly covered. See [`08` Q3](./08_OPEN_QUESTIONS.md).
- **Dependencies:** Stage 2a.
- **Tests to add:** successful login sets `authenticated` + `accountId`; rejected signature →
  `error`, no session; `restoreSession` on a token from a **different environment fingerprint**
  returns `null`; `accountsChanged` → session cleared; `logout()` clears the token; expiry
  surfaces `expired` without auto-prompting the wallet.
- **Acceptance:** sign-in succeeds on testnet from a real browser origin; **no** balance,
  order, or fill is requested or rendered; token storage is in-memory (`getSessionTimeToExpiry`
  and reload behaviour confirm no cookie was written); the account routes are still key-only.
- **Security risks:** token leakage via devtools/telemetry; accidental cookie persistence;
  wrong-chain signing producing a confusing failure; XSS in an unrelated component becoming
  account takeover once a session exists (see `06` R-04).
- **Rollback:** feature flag off → 2a only.
- **User approval:** **required** (explicit go-ahead to bundle the SDK on accepted licence risk).

---

## Stage 3 — Unified data layer (session as a second source)

- **Files (new):**
  - `packages/core/src/account/sdkClient.ts` — `SdkAccountReadClient` implementing the
    existing `AccountReadClient` interface, mapping SDK results into `AccountDataset<T>` with
    `retrievedAtMs`, `coverage`, and exact decimal strings.
  - `apps/web/src/lib/accountSource.ts` — selects `rest` | `sdk` | `auto` from a flag.
  - `tests/account-sdk-client.test.mjs`.
- **Files (modified):** `apps/web/src/lib/accountSessionOwner.ts` — extend the identity tuple
  to `${form}:${accountId}:${walletAddress}:${range}`; **no other behaviour change**.
  `packages/core/src/account/data.ts` and `coverage.ts` only if a field needs a new enum value.
- **Dependencies:** Stage 2b. G2 constrains targets to testnet.
- **Tests to add:** each safeguard re-proven against the SDK client —
  explicit-activation gate, 2-minute freshness, per-period isolation, single-flight,
  stale-response discard on wallet change, per-dataset error scoping, abort-on-lock.
  These mirror `tests/account-session-owner.test.mjs` (11 tests) with the SDK transport faked.
- **Acceptance:** with the flag on, every account view renders from the SDK path with the same
  coverage labels; with the flag off, behaviour is byte-identical to baseline; no duplicate
  requests across tabs; a mid-flight wallet switch discards the response.
- **Security risks:** schema drift producing `undefined` in charts → mitigated by boundary
  validation; a mapping bug silently zeroing a balance → mitigated by "unavailable, never
  zero" rule.
- **Rollback:** flag default = `rest`.
- **User approval:** required (first change to the account data path).

---

## Stage 4 — Portfolio and analytics

- **Files:** `apps/web/src/components/AccountAnalytics.tsx`,
  `components/AccountCostBasis.tsx`, `pages/Portfolio.tsx`, `packages/core/src/account/analytics.ts`.
- **Scope:** only metrics with reliable data. Explicitly: no verified P&L claim, no historical
  fee analytics, no cross-chain P&L.
- **Dependencies:** Stage 3.
- **Tests to add:** attribution labels present for every figure; "estimated"/"unsupported"
  states reachable and asserted; P&L gates unchanged.
- **Acceptance:** every number carries an exchange-reported / calculated / estimated /
  unsupported label; no regression in `tests/account-cost-basis-ux.test.mjs` (5) or
  `tests/account-lots.test.mjs` (18).
- **Rollback:** component-level revert.
- **User approval:** required.

---

## Stage 5 — Dapp navigation

- **Files:** `components/Layout.tsx`, `App.tsx`, `lib/navigation.ts`, `pages/Portfolio.tsx`.
- **Scope:** promote Connect to a first-class entry point; group tools as in
  `03_FEATURE_PARITY_MATRIX.md` §5. Keep every existing route and both legacy redirects.
- **Dependencies:** Stage 2a (connection affordance must exist to be navigable).
- **Tests to add:** route table test — every pre-migration route still resolves to the same
  component; redirect targets unchanged; `ROUTE_META` covers every route.
- **Acceptance:** zero routes removed; deep links survive static hosting; mobile nav intact
  (`tests/frontend-batch1.test.mjs`, `tests/dialog-focus.test.mjs` still pass).
- **Rollback:** single commit revert.
- **User approval:** recommended.

---

## Stage 6 — Read-only verification (the real gate)

This is where claims become facts. It requires a **live** testnet account and a real browser
origin, and therefore a **human in the loop**.

- **Files:** `docs/account-live-verification.md` (append results), new
  `docs/wallet-first-verification.md`.
- **Checklist:** initial load; account switch mid-flight; cache reuse across tabs; pagination
  completeness and ordering per dataset; session expiry; token rejection; logout; mobile.
- **Dependencies:** Stages 2b–3. **Cannot be automated in CI** (no credentials, and this
  audit will not create any).
- **Acceptance:** every box ticked from the intended origin; a denied read recorded as a valid
  result; no claim of "complete history" for any dataset until its ordering is verified.
- **Security risks:** none beyond normal live testing if the disposable testnet account rule
  is followed (never a real key, never on a shared preview).
- **Rollback:** n/a (verification only).
- **User approval:** **required** — I must not run this, and will not.

---

## Stage 7 — Optional transaction workflows — **not recommended in this programme**

- **Files (new):** `packages/core/src/trading/gate.ts` (the **only** module allowed to
  reference SDK mutation methods), `components/OrderConfirm.tsx`.
- **Blockers:** G1; the read-only structural guarantee must be replaced (`04` §5); Centrifuge
  reconnect reconciliation must be solved; rate-limit and MFA/step-up paths
  (`STEP_UP_REQUIRED`, `SESSION_ELEVATION_REQUIRED`, `MFA_REQUIRED`) must be designed.
- **Tests to add:** confirmation required; duplicate-submit blocked; pending→terminal states;
  reconnect reconciliation; a lint/test asserting no mutation symbol outside `gate.ts`.
- **Acceptance:** read-only mode is provably preserved by the guard test; no order can be
  submitted without an explicit gesture and a preview.
- **Security risks:** highest in the programme — real asset movement, wrong-chain submission,
  duplicate orders, phishing-shaped confirmations.
- **Rollback:** delete the gate + UI; read-only paths unaffected.
- **User approval:** **required, explicitly, separately.**

---

## Stage 8 — API-key deprecation

- **Files:** `pages/Portfolio.tsx` (the `/account/api` section), `lib/store.tsx`,
  `docs/audit/*`.
- **Preconditions, all mandatory:**
  1. Stage 6 complete for every dataset, from a real origin.
  2. Feature parity demonstrated across both paths.
  3. Security review signed off.
  4. G1 residual closed or accepted in writing (session path is the primary path; a durable
     licence record should exist before the SDK becomes load-bearing for all users).
- **Recommendation:** move keys to a secondary "Advanced / automation" surface. **Do not
  delete the vault.** Machine clients need keys, and there is no wallet-free SDK path.
- **Acceptance:** key-based reads remain available; default UX is wallet-first; docs updated.
- **Rollback:** restore the primary surface.
- **User approval:** **required.**

---

## Dependency graph

```
Stage 0 (done)
   └─▶ Stage 1 (needs user: missing directory)
   └─▶ Stage 2a ──▶ Stage 2b ──[G1: accepted risk]──▶ Stage 3 ──▶ Stage 4 ──▶ Stage 6 ──▶ Stage 8
                          │                              │
                          └──────────▶ Stage 5 ◀────────┘   (5 may run after 2a alone)
                                                     Stage 7 (deferred, needs 6)
```

Stage 5 is independent of the SDK entirely and can be done in parallel with 2b/3.

## Testing strategy across stages

- Unit/regression: `node --test tests/*.test.mjs` — every new module gets a synthetic-transport
  test. **No test may require a credential or a network.**
- Type: `npm run typecheck` (web + backend, includes core).
- Guards: `check:whitespace`, `check:runtime`, `check:dependencies`, `check:contrast`,
  `check:performance` (after build).
- Live: manual, human-run, documented — never in CI.
- **Injection point convention:** the SDK takes `transports`, `fetch`, and `realtimeClient` in
  its config specifically for mocks. Use them; do not monkey-patch globals.

## Programme-level rollback

Every stage sits behind either a flag or an added module. The full programme reverts by:
1. `accountSource` flag → `rest`; 2. remove the Connect UI; 3. drop the `@polyester/sdk`
runtime dependency. No data migration, no schema change, no user data loss — private data is
never persisted.

---

## Monetization addendum — where it fits (and where it must not)

Audit: [`09_MONETIZATION_AND_BUILDER_REVENUE.md`](./09_MONETIZATION_AND_BUILDER_REVENUE.md).
Architecture: [`04_TARGET_ARCHITECTURE.md`](./04_TARGET_ARCHITECTURE.md) §8.

### Key scheduling fact

Polyester has **no builder/integrator fee mechanism**, so there is **no monetization stage that
touches the order path, the data layer, or the wallet layer**. Monetization is a leaf addition with
its own gates, and it needs **no SDK** — so it is entirely unaffected by the licence question.

**And nothing is live.** The exchange developers report that **referral codes and builder codes are
not live yet** (`09` §0). So every monetization stage below is *future* — the correct amount of work
today is **zero code**. What can be prepared safely now is the **boundary**, not an implementation:
`{ accountId }` in, nothing back, no imports either way (`09` §5.1).

### Stage M0 — Monetization groundwork *(audit — complete)*

- **Deliverable:** `09_MONETIZATION_AND_BUILDER_REVENUE.md`. No source change.
- **Acceptance:** mechanism matrix published; builder-fee absence verified against the canonical
  contract bundle; economics labelled hypothetical; consent rules specified.

### Stage M1 — Terms and eligibility verification *(blocks everything else)*

- **Files:** `docs/wallet-first-audit/09_…` (findings only).
- **Work:** (a) **observe whether the mechanism is live** — see the launch checklist in `09` §7
  (capability matrix, contract grep, first-party announcement, console actually issuing a link and
  recording a reward); (b) confirm with Fabric Labs whether a third-party app may direct users to its
  own referral code (Q16); (c) ask what builder-code parameters are *intended*, if any — as a question,
  **not** as a design input.
- **Dependencies:** human contact with the exchange, plus a deployment where the feature is on.
  **Cannot be automated.**
- **Blockers:** the mechanism not being live (dominant); mainnet (`B2`) for any *realizable* revenue.
- **Acceptance:** a written answer **and** an observed working link, both recorded. Absent either, M2
  does not start.
- **Security risk:** none (no code).
- **User approval:** **required.**

### Stage M2 — Disclosure and link surfacing *(the only code stage)*

Scope: components **M-2** (`ReferralDisclosure`) and **M-3** (`referralAttribution`) from `04` §8.2.
Deliberately minimal — an explainer, a consent gate, and an outbound link.

> **Why a deep link and not one-click registration?** Polyester exposes no callable referral action.
> Hyperliquid's wallets can do this because it publishes a wallet-signed `setReferrer` action; Polyester
> publishes nothing equivalent (verified: zero referral RPCs/endpoints). See
> [`10_RABBY_PATTERN_STUDY.md`](./10_RABBY_PATTERN_STUDY.md). If Q21 is granted, M-3 upgrades to a
> user-signed registration using the signer Stage 2b already builds.

- **Files (new):**
  - `apps/web/src/lib/monetization.ts` — `monetizationConfig` (M-1), default **all off**. **Created in
    this stage, never before it**: no flag, key, or placeholder may be merged ahead of the feature it
    gates (`09` §5.1).
  - `apps/web/src/components/ReferralDisclosure.tsx` — consent gate; explicit "this may replace your
    current referrer and end their earnings" warning; no auto-apply.
  - `tests/monetization-consent.test.mjs`.
- **Files (modified, minimal):** one clearly-labelled surface (e.g. an item in the Toolkit group),
  behind the flag.
- **NOT touched:** wallet layer, auth layer, account data layer, vault, backend, order path, CSP.
- **Dependencies:** Stage M1.
- **Tests to add:**
  - renders nothing when the flag is off;
  - the 15% is disclosed **before** any action is offered, and the 4% user benefit is stated as the
    user's, not PolyTools';
  - the "replaces your existing referrer" warning is present and not dismissible-by-default;
  - **no auto-application**, no code submitted anywhere;
  - no network request to any Polyester endpoint;
  - `referralShare` never rendered or exported (regression guard for `04` §8.3 rule 6);
  - declining leaves every existing feature working.
- **Acceptance:** flag off ⇒ byte-identical behaviour to baseline; flag on ⇒ disclosure + external
  link only; zero API calls; suite green.
- **Security risks:** phishing-shaped UI (mitigate: plain outbound link to the documented console
  URL, no credential prompts); accidental implication that PolyTools controls fees.
- **Rollback:** flag off (single line), or delete two files.
- **User approval:** required.

### Explicitly **not** in the plan

| Not doing | Why |
|---|---|
| `BuilderConfig` / order fee plumbing | No such mechanism exists; building it would fabricate a capability. |
| `RevenueReporting` in the dapp | Operator earnings must never appear in a user-facing app (`04` §8.3 rule 5). |
| Auto-applying a referral code | Violates consent; would silently end a user's existing referrer. |
| Self-referral tooling | Prohibited. |
| Payments / subscription infrastructure | Unverified mechanism, no pricing evidence, would add real ops cost for $0 verified revenue. |
| Any paid infrastructure | Unjustifiable while mainnet does not exist (`09` §3.3). |
| **Pre-building a builder-code interface or config keys** | The mechanism is unspecified (`09` §0). A placeholder would fabricate a capability and hard-code a guess. |
| **Any "coming soon" monetization flag** | Inactive configuration that implies a capability, changes test surface, and invites future code to depend on it. |
| **Registering for the referral programme now** | Explicitly excluded from this audit; pointless while the mechanism is not live. |
| **Any AI / LLM / BYOK work** | Separate proposed phase, sequenced **after** this programme (`11`). Not a dependency, not a stub, not a route. |
| **A backend provider proxy** | Would be the first user-secret-bearing capability in a backend that has no auth, no storage and no secrets today (`11` §1.4). Needs its own approval. |

### Updated dependency graph

```
Stage 0 (done)
   ├─▶ Stage 1 (needs user: missing audit dir)
   ├─▶ Stage 2a ─▶ 2b ─[G1: accepted]─▶ 3 ─▶ 4 ─▶ 6 ─▶ 8
   │                   └──────▶ 5 ◀──────┘        (5 may follow 2a alone)
   │
   └─▶ Stage M0 (done) ─▶ M1 ─[launch + terms + mainnet]─▶ M2   ← independent of all of the above;
                                                                   needs no SDK, so not gated by G1
```
