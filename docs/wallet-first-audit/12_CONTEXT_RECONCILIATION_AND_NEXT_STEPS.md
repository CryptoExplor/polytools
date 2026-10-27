# 12 — Handoff reconciliation, wallet vs. exchange authentication, and next steps

**Audit-only.** No implementation. This document reconciles the ChatGPT handoff summary against the
repository as it exists now, clarifies the single most consequential distinction in the programme
(**wallet connection is not exchange authentication**), and sets out explicit immediate next steps.

---

## 0. How to read this

The handoff summary is a **point-in-time snapshot**. It describes the repository at
`6506e9f` — the head of branch `arena/cb53163e-polytools`, i.e. the state **before PR #6 was merged**.
Two pull requests have merged since. Most of the summary is therefore *correct for its snapshot and
stale for `main`*; a few items are incorrect in a way that matters.

Three provenance buckets are used throughout:

| Bucket | Meaning |
|---|---|
| **[V]** | I verified it in this session, against this checkout, with a command or a file anchor |
| **[R]** | Reported by the handoff / another assistant; consistent with [V] evidence but not independently re-derived |
| **[X]** | Contradicted by [V] evidence |

The handoff's own framing invites exactly this discipline ("these results were reported… have not
been rerun"), and its advice to "distinguish reported claims from independently verified facts" is
preserved in that three-bucket scheme.

---

## 1. Baseline reconciliation

| # | Handoff claim | Status | Verified reality |
|---|---|---|---|
| 1 | Verified baseline `6506e9f6e70a6d13ed5ccaeec378e4f1ad609ff1` | **[V] real, [X] as *current* baseline** | `git ls-remote` shows `6506e9f6e70a6d13ed5ccaeec378e4f1ad609ff1` is the head of remote branch **`arena/cb53163e-polytools`**. It is **not an ancestor of `main`** — PR #6 was **squash-merged**, so the commit hash does not survive. **Current baseline is `main` = `091a1b1803ce1fb672e5593c10b51fc0c4cbf23c`.** |
| 2 | Branch `arena/cb53163e-polytools` | **[V]** | Exists on `origin`, frozen at `6506e9f`. It is a **different session's branch**, not this one (`arena/609563ba-polytools`, currently equal to `main`). |
| 3 | PR #6 "open, clean and mergeable; not merged or deployed" | **[X]** | PR #6 **merged 2026-10-27T09:28:08Z** — *"Trim repeated frontend copy across routes"*. |
| 4 | "F-07–F-11 deferred" | **[X]** | **PR #7 merged 2026-10-27T11:21:26Z**, titled *"Implement audit findings F-07 through F-11"*. The deferral instruction is moot against `main`. |
| 5 | 307/307 tests across 68 suites | **[V] as a historical figure** | I confirm **318/318 across 71 suites** at `091a1b1` today. 307/68 is consistent with the pre-PR-#7 snapshot (PR #7 adds tests). No contradiction — different points in time. |
| 6 | Whitespace 186/186 | **[V] historical** | Now **196 files** checked, 0 violations. Grew with added files. |
| 7 | Four commits in PR #6; `6506e9f` is the fourth | **[R]** | Consistent with #1; not re-derived (the branch is a stale remote ref). |
| 8 | Account setup form is in `Portfolio.tsx`, not `ApiSetup.tsx` | **[V]** | Confirmed: `Portfolio.tsx` holds the setup/vault UI and the `<details className="disclosure">` blocks. There is no `ApiSetup.tsx`. |
| 9 | Pages workflow configured for `main` or manual dispatch | **[V]** | `.github/workflows/pages.yml` was modified in PR #6. A green PR Pages status is **not** evidence of a production deployment — correct as stated. |
| 10 | Seven files in `docs/build-reality-audit/` untracked and untouched | **[V] they are not here — §3** | No such directory exists in this checkout, tracked or untracked. Explained below; **not** a discrepancy in the handoff's own terms. |
| 11 | Browser/mobile validation outstanding | **[V]** | Still true. Nothing in this session has run a browser. |
| 12 | Automated checks do not establish live API compatibility | **[V]** | Correct, and reinforced by `02` §7 (explicit non-claims). |

**Net:** the handoff's technical content is sound. Its **status fields** are two merges out of date,
and its **baseline commit** is now historical rather than current.

---

## 2. Preservation list — verified line by line

The handoff asks that the account-data reliability work be preserved. Before preserving anything, I
located it. Every item is present at `091a1b1` with an anchor, so a future change can be checked
against a real line rather than a memory.

| Behaviour to preserve | Verified anchor | Note |
|---|---|---|
| Explicit first-read activation | `accountSessionOwner.ts:194` — `refreshIfActivated()` returns early unless `state.activated`; comment: *"Explicit consent is required before visibility refresh can do any work"* | Activation gate is real and enforced in code |
| Shared account cache (no re-fetch across tabs) | `accountSessionOwner.ts` — single `AccountSessionOwner`, tab-local `setRange` *"without discarding other cached ranges"* | Confirmed |
| Two-minute visibility freshness | `accountSessionOwner.ts:16` — `ACCOUNT_DATA_FRESHNESS_MS = 2 * 60 * 1000`; used at `:187` and `:306` | Exact constant verified |
| Manual refresh bypasses the age gate | `accountSessionOwner.ts:205` — `load()`; *"Manual calls use explicit=true and bypass age gates"* | Confirmed |
| Per-period P&L caches | `getRangeState()` / `state.periods[range]` | Confirmed |
| Late-response / identity guards | `captureSessionIdentity()`, `isSessionIdentityCurrent()` | Confirmed |
| View-scoped errors | `AccountRangeState` carries per-range state, not a global error | Confirmed |
| F-02 broad reads + disclosure | `getRangeDatasets()` returns exactly **8** datasets per range (balances, equity, orders, fills, transfers, feeRates, balanceHistory, openOrders); guarded at `:184` by `datasets.length === 8`; disclosure UI in `Portfolio.tsx` `<details className="disclosure">` | Confirmed — 8 is the literal count |
| Read-only operation allowlist | `packages/core/src/account/signer.ts` — `READ_ONLY_OPERATIONS` = **10 GETs** (authMe, balances, balanceHistory, equityHistory, ordersOpen, ordersHistory, orderDetails, fills, transfers, feeRates) | Confirmed — exactly 10, all GET |

**Nothing on this list is at risk from the wallet-first programme**, because the wallet path is
additive: it introduces a second way to obtain *the same* datasets. The risk would only materialise if
someone re-pointed `AccountReadClient` while the wallet path was half-built — which is why Stage 3 in
`05` is gated.

---

## 3. The `docs/build-reality-audit/` question — now explained

This has been open as **Q2/Q5** since the first report. I can now give the mechanism, though not the
content:

1. The handoff says those seven files are **untracked**.
2. `git` does not carry untracked files across a workspace, a branch, or a **squash merge**. A squash
   merge takes the *committed tree* only.
3. Therefore the seven files exist **only in the sandbox where they were written**. They are not in
   this checkout, not in `origin`, and not recoverable from git history.

**Consequence:** I cannot read them, and no future session will be able to either unless someone
copies them out. That is not a failure of verification — it is what "untracked and untouched" means.

**Consequence for F-07–F-11:** PR #7's title asserts it implemented *"F-07 through F-11"*, and its body
describes the five changes precisely (order-agnostic equity metrics, public runtime validation,
testnet-only labelling, liquidation-claim removal, SDK pin + licence warning). So the *work* is in
`main` and I can audit it directly — I simply cannot map it to the F-numbers, because those
identifiers appear nowhere in the tree (`grep -rn "F-0[0-9]\|F-1[01]"` → only an unrelated
`DEF-03` comment and my own audit docs).

**Practical answer to Q2/Q5:** stop trying to restore the directory. Either (a) paste the five finding
descriptions, and I will map them to PR #7's diff, or (b) accept that PR #7's body is the record and
treat F-07–F-11 as closed-by-description. Option (b) costs nothing and I recommend it.

---

## 4. Clarification: wallet connection vs. exchange authentication

This is the distinction the whole programme turns on, and it is easy to blur because both look like
"the user signed in with their wallet". They are **three separate things**, and only the third grants
access to private account data.

### 4.1 The three things

| | **1. Wallet connection** | **2. Exchange authentication** | **3. Account authorization** |
|---|---|---|---|
| **What happens** | The page asks the wallet for an address | The exchange issues a challenge; the wallet signs it; the exchange returns a **bearer token** | The token is presented on each private read; the exchange decides what that token may see |
| **Who runs it** | PolyTools (host-supplied) | The **exchange** — PolyTools only relays bytes | The exchange |
| **Proof it provides** | "This origin can see this address" | "The holder of this EOA signed this server-issued message for this origin" | "This token may read these endpoints for this account" |
| **What it does *not* prove** | Anything about an exchange account | That the user *wants* PolyTools to read anything | That the token may trade, withdraw, or act |
| **Credential involved** | None (a public address) | A 65-byte EIP-191 signature | An opaque `accessToken` |
| **Where it lives in the SDK** | Host code — **the SDK does not connect wallets at all** (`02` §6) | `AuthService.createWalletChallenge()` → `AccountSignerAuthService.login()` | `AuthSessionStore` + per-request bearer header |

**The critical sentence, verified:** the SDK's `AccountSigner` doc comment says *"The SDK
authenticates the Polyester smart account address."* An address is an **input** to authentication, not
the result of it. Connecting a wallet produces the address and nothing else.

### 4.2 The exact verified flow (SDK v0.31.0)

Re-verified this session from the published declarations, not from docs:

```
1. host supplies AccountSigner {
     environmentFingerprint, accountAddress (smart account),
     ownerAddress? (EOA — the LOGIN signer),
     signMessage(message) -> raw 65-byte EIP-191 signature
   }
2. client.auth.createWalletChallenge({ smartAccountAddress, signerAddress, uri })
     -> server-issued SIWE message ("sign its exact UTF-8 bytes; do not hash or reconstruct")
3. accountSigner.signMessage(message)          // user approves in the wallet
4. accountSignerAuth.login({ provider, uri })  // wraps loginWithWallet, which is `protected`
     -> { accessToken, expiresAt, accountId, username }
5. every subsequent private read presents the bearer token
6. restoreSession() validates the stored token still belongs to this environment;
   handleRejectedToken() ends the session if the backend rejects it;
   getSessionTimeToExpiry() exposes remaining lifetime
```

### 4.3 Six things that are easy to get wrong — all verified, all consequential

| # | Detail | Why it matters to PolyTools |
|---|---|---|
| 1 | **`uri` must be a bare HTTP(S) origin** — no path, query, fragment, or userinfo; ≤2048 chars | The SIWE message is **origin-bound**. A preview host or a second deployment is a *different* origin and may be rejected. This is a deployment concern, not a UI detail. |
| 2 | **The signature must be the owner EOA's raw 65-byte EIP-191 signature** — login rejects Safe / ERC-6492 wrapped signatures | Smart-contract wallets that only produce wrapped signatures **cannot complete login**. Wallet support is therefore a hard filter, not a preference (`08` Q7). |
| 3 | **Login uses Ethereum mainnet Chain ID (1)**, set by the backend, with the Polyester chain bound in SIWE `Resources`. The switch is **conditional**: the reference says *"If a wallet requires the signing network to match, such as Phantom, select Ethereum mainnet before signing."* | Most EIP-191 signers sign regardless of the active chain, so **do not force a network switch categorically**. Prompt only when signing fails for that reason, and make it actionable (`08` NBA-4.3). |
| 4 | **The bearer token is the credential, not the wallet** | Any private read is authorized by the token. Losing/rotating it is a session concern; the wallet is irrelevant until re-login. This is also why `AuthSessionStore` is the security-critical object (risk **R-02**). |
| 5 | **API-key and session identities coexist** — `me()` returns `apiKeyId?` alongside `accountId` and `sessionLevel` | The API-key path and the wallet path are **two doors to the same account**, not two accounts. They must not be treated as separate users, and never merged into one cache entry keyed by the wrong identifier. |
| 6 | **Session assurance is graded** — `sessionLevel` ∈ `unspecified` / `primaryAuthenticated` / `mfaElevated` / `freshStepUp` | Graded assurance already exists. Any future transaction work must check the level rather than assume "logged in" is enough (`05` Stage 7). |

### 4.4 What PolyTools actually has today

| Component | Status at `091a1b1` |
|---|---|
| Wallet connection | **Absent.** Repo-wide search for `window.ethereum`, `connectWallet`, `wagmi`, `viem`, `walletconnect`, `AccountSigner` → **one** hit: a *marketing link card* in `Hub.tsx:36` describing the **exchange's** sign-in options. No wallet code exists. |
| Exchange authentication | **Absent.** No `createWalletChallenge`, no SIWE, no bearer-token session. |
| Account access | **Present, by API key only**: `READ_ONLY_OPERATIONS` (10 GETs), **Ed25519 request signing** (`Ed25519RequestSigner` over a SHA-256 body digest — a signature scheme, *not* an HMAC), sealed local vault (passphrase-protected), runtime DTO validation. |
| `@polyester/sdk` | **Not a dependency.** Root `dependencies: {}`, `apps/web` has 3 runtime deps (`react`, `react-dom`, `react-router-dom`) — the SDK is dev-pinned for typechecking examples only. |

So the honest summary of the target experience: **steps 1 and 2 of the vision do not exist yet.** The
app is a read-only analytics terminal authenticated by API key, and the wallet-first direction is a
plan, not a partially-built feature. That is consistent with "no implementation authorized".

### 4.5 What "clarify" means as a decision

The ambiguity is not technical — it is a product decision with a technical consequence. Two viable
readings of Stage 2a:

| Reading | What ships | What the user gets | Risk |
|---|---|---|---|
| **A. Wallet connect, no exchange auth** | Address display, watch-only, on-chain data. No private account data. | Wallet-first *feel*; the API-key path still does the real work | Low. But it can look like a half-feature |
| **B. Wallet connect + SIWE login** | Everything in A, plus a bearer session and private reads without API keys | The actual vision, step 2 included | Higher: licence (`B1`), origin binding, wallet filter, R-02 surface |

**Recommendation: A first, as its own shippable increment, with B behind a flag in the same release
train** — but only after the four questions in §5 (NBA-4) are answered, because two of them can
invalidate B's feasibility on a given deployment.

---

## 5. Explicit immediate next steps

Ordered. Each has an owner, the evidence that closes it, and what it unblocks. "Do not start" is
stated where a step has a hard prerequisite.

| # | Step | Owner | Closes when | Unblocks |
|---|---|---|---|---|
| **NBA-1** | **Re-baseline the handoff.** Accept `main @ 091a1b1` as authoritative; treat `6506e9f` as historical. | **You** (one line) | Q1 answered in writing | Every implementation stage |
| **NBA-2** | **Close Q2/Q5 by decision, not by restoration.** Either paste the five F-finding descriptions, or accept PR #7's body as the record. | **You** | Choice recorded | Removes the last "unknown unknowns" item |
| **NBA-3** | **Browser/mobile validation** of the current app, API-key path only. No wallet, no live private requests. | Me, on request | A written pass/fail list per route at desktop and one mobile viewport | Any claim of "production-ready"; Stage 5 work |
| | ↳ **attempted 2026-10-27 — BLOCKED.** No browser binary and no reachable Chromium CDN; no authorized test key. Automated gates and a DOM-level render harness pass. See [`13_BROWSER_MOBILE_VALIDATION.md`](./13_BROWSER_MOBILE_VALIDATION.md). | | Re-run when a browser and a testnet key are available | |
| **NBA-4** | **Answer the four pre-Stage-2a questions** (below). | **You** | Four written answers | Stage 2a; and it decides whether B is even feasible |
| **NBA-5** | **Stage 2a: wallet connection only.** Address display, network guard, no exchange call, no private data. | Me, after NBA-4 | Fails safe with no wallet; no network call on connect; contrast/whitespace/tests green | The wallet-first shell |
| **NBA-6** | **Verify SIWE feasibility on a real origin** — one challenge/response against testnet from an actual deployment origin, with one injected wallet. | Me + you (needs a wallet and a live origin) | Recorded request/response, including the `uri` used and the resulting `sessionLevel` | Stage 2b. **Not** a private-data read |
| | ↳ **feasibility investigated 2026-10-27 — gate REMAINS UNVERIFIED; no challenge was called.** No allowlist, origin-registration step or origin error code exists in SDK 0.31.0, the `auth.v1` proto or the official auth/wallet-login/client-configuration pages; `uri` is a per-request value bound into the message, and SDK token storage explicitly supports loopback/LAN origins. | Not provable from declarations, and not executable here (sandbox TLS egress is reset). Needs one approved origin + one browser; no wallet, key or deployment required. [`07` §4.1–4.2](./07_ACCEPTANCE_TEST_MATRIX.md) | Stage 2b, once the origin is accepted | the origin question itself |
| **NBA-7** | **Decide the wallet support matrix** (Q7) using §4.3 findings — EOA-only wallets work; wrapped-signature smart wallets fail login. | **You** | Named list, with the reason each is in or out | Stage 2b scoping, CSP changes (R-06) |
| **NBA-8** | **Settle the licence record** (B1) to whatever standard you accept: the chat statement is recorded and sufficient, or a written agreement is pursued. | **You** | Recorded decision | Bundling the SDK at all |
| **NBA-9** | **Resolve API compatibility** before any "live-compatible" claim: one authenticated read against a known-good API key, with the exchange's **exact error code and body** captured on failure. | Me + you (needs a key) | A recorded request/response pair | Stage 3; the whole reliability story |
| **NBA-10** | **Keep the monetization and AI work parked** exactly as specified — no code, no flags, no placeholders (`09` §5.1, `11` §0). | Me (discipline) | Nothing to do; monitored at each review | — |

**Status (2026-10-27): NBA-1, NBA-2 and NBA-4 have been decided — see §9.** NBA-3, NBA-5…NBA-9
remain open and unchanged. NBA-10 continues by discipline.

### NBA-4, expanded — the four questions that gate Stage 2a

1. **Which origin(s) will be allowed to request a SIWE challenge?** The message is origin-bound
   (§4.3 #1). Preview hosts, staging, and custom domains are different origins. *Without this, Stage
   2b cannot be tested anywhere but production.*
2. **Do you accept EOA-only wallet support for launch?** Login rejects Safe/ERC-6492 wrapped
   signatures (§4.3 #2). Embedded/smart wallets may be unable to sign in. This directly contradicts
   any promise of "Google/email embedded wallet" support.
3. **Is a "switch to Ethereum mainnet" prompt acceptable *when the wallet needs it*?** Login is
   bound to chain 1 regardless of the app's network (§4.3 #3), but the official reference makes the
   switch conditional on the wallet. Users who must switch should be told why and how to return.
4. **Does the API-key path stay fully functional alongside the wallet path** during the transition —
   i.e. two doors to one account, never merged into one cache key (§4.3 #5)?

Each of these is answerable in a sentence, none is answerable by reading more code, and all four
change what Stage 2a/2b actually build.

---

## 6. Forward plan (unchanged priorities, now with gates)

Your priority order, adopted without reordering:

```
stable wallet-first dapp → reliable analytics → optional AI analyst
                        → user-confirmed AI-assisted trading → monetization when eligible
```

| Phase | Gate to enter | Gate to exit |
|---|---|---|
| **1. Wallet-first dapp** | NBA-1…NBA-4 answered | `07` §1–§5 green with a wallet path behind a flag; API-key path untouched |
| **2. Reliable analytics** | Phase 1 exit | Per-period caches and identity guards preserved; no synthetic values (`07` §6) |
| **3. AI analyst** | Phase 2 exit **and** `11` §9 criteria 1–7 | Read-only, BYOK, allowlisted tools, provenance on every number |
| **4. AI-assisted trading** | Phase 3 shipped and stable | Proposal-only, hashed confirmation, no submission tool exists |
| **5. Monetization** | A launch trigger **and** the `09` §7.1a verifications, then a recorded review | Never automatic |

---

## 7. Current verified build state (`main @ 091a1b1`)

Re-run this session, in this checkout:

| Check | Result |
|---|---|
| `npm test` | **318 / 318 pass, 71 suites, 0 fail** |
| `npm run typecheck` | **PASS** |
| `check:whitespace` | **PASS** — 196 files, 0 violations |
| `check:external` | **PASS** |
| `check:dependencies` | **PASS** |
| `check:contrast` | **PASS** |
| `check:runtime` | **PASS on every API probe**; reports `Node v22.22.3; engine >=24: FAIL` — a sandbox-runtime mismatch only, not a code defect |

**Environment note for future sessions:** `node_modules` is **not** preserved between turns in this
workspace. The first test run in this turn reported 24 failures purely from
`ERR_MODULE_NOT_FOUND: vite`. After `npm install` (153 packages) and `git checkout --
package-lock.json`, the same suite ran 318/318. **Always reinstall before quoting a test number**, and
never read a missing-module failure as a regression.

---

## 8. What this document did not do

No source change. No dependency added (`dependencies` is still `{}` at the root; `apps/web` still has
three). No wallet code. No SIWE call. No private request. No registration. No merge, deploy, or fee
change. `git status --short` → only `?? docs/wallet-first-audit/`.

---

## 9. Recorded decisions (approved 2026-10-27)

**Status: decided.** The six items below were approved by the repository owner on 2026-10-27, with the
**NBA-4.1 amendment** proposed in review (test-origin escape hatch, gated on evidence).

> **Scope of these decisions.** They authorise **documenting the plan**. They do **not** authorise
> implementation, and they do **not** bypass any gate in `05`, `06`, `07` or `09`. Every stage below
> still requires its own evidence and, where `05` says so, its own approval. Nothing here changes the
> application, its dependencies, or its behaviour.

> **Unverified items stay unverified.** This document does not convert an assumption into a fact.
> §9.7 lists what remains unknown and what evidence would close each item. Chief among them: whether
> the exchange validates `uri` against a registered allowlist, or merely binds it into the signed SIWE
> message. **That is the whole of NBA-6 and it is not yet known.**

### 9.1 The six decisions

| # | Decision | Consequence |
|---|---|---|
| **NBA-1** | **Baseline** is `main @ 091a1b1` as the verified snapshot. The baseline advances when PR #8 merges — **verify the actual merge commit before updating it.** | Stages may be planned against `091a1b1`; no stage may cite a baseline it has not resolved |
| **NBA-2** | **F-07–F-11:** PR #7's description, **cross-checked against the diff**, is the record. Stop trying to recover the untracked audit directory. | Q2/Q5 closed. The five changes are auditable in `main`; the F-numbers are labels only |
| **NBA-4.1** | **SIWE origin:** production is the only approved **shipping** origin. Test on **one documented non-production origin only if the exchange accepts it**; NBA-6 establishes this with a real challenge request recording the exact `uri` and response. **If no non-production origin is accepted, Stage 2b stops** — production must not be used as a substitute test environment. | Stage 2b is shippable only if a test origin exists. This is a gate, not a formality |
| **NBA-4.2** | **Signature compatibility:** login needs the **account owner's raw 65-byte EIP-191 signature**. Some smart-wallet interfaces may not expose that signature. **Do not** claim that all smart-account users are unsupported. | UI copy describes the *signature requirement*, not a wallet-type exclusion |
| **NBA-4.3** | **Mainnet switch:** the Ethereum mainnet signing requirement is accepted, **subject to clear, actionable UX** explaining why the switch is required and how to return to the app's intended network. | A bare error is non-compliant with this decision |
| **NBA-4.4** | **API-key authentication is preserved.** Before a second auth form ships, cache isolation must be defined in `07`: identity binds **auth form AND account**, separate namespaces, never served across forms. Measurable parity must be defined before anyone proposes removing API keys. | Recorded in `07` §13 as AUTH-01…AUTH-12. The API-key path is not deprecated by this programme |

### 9.2 NBA-1 — baseline, and how it advances

- Verified snapshot: **`main @ 091a1b1803ce1fb672e5593c10b51fc0c4cbf23c`**.
- This branch (`arena/609563ba-polytools`) is **ahead** of that snapshot by the documentation commit(s)
  in PR #8. Those commits add files under `docs/wallet-first-audit/` only and change no source.
- **When PR #8 merges**, the baseline becomes **the merge commit**, not `091a1b1`. Resolve it with
  `git rev-parse` at that time and record the hash here; do not assume it.
- `6506e9f` remains **historical**: the frozen head of `arena/cb53163e-polytools`, not an ancestor of
  `main` (PR #6 was squash-merged). It must not be used as a baseline for any stage.

### 9.3 NBA-2 — the F-07–F-11 record

Closed by description. The five changes were verified in the tree at `091a1b1` rather than taken on
trust — anchors in §3 and in the PR #8 description:

| Claim in PR #7's body | Anchor |
|---|---|
| Order-agnostic equity metrics; no synthetic timestamps or drawdown | `analytics.ts:308–333`; label `sampled-valuation-order-unverified-not-pnl` |
| Account export schema v2 | `export.ts:60,378` → `polytools.account-export.v2` |
| Public runtime validation, fail-closed | `publicDtos.ts:23–56`; single decode point `api.ts:139` |
| Private reads labelled testnet-only, separately from the public badge | `AccountAnalytics.tsx:898`; `Portfolio.tsx:516` |
| SDK pinned + licence warning retained | `package.json:31`; `SdkGuide.tsx:379,414` |

**No attempt will be made to recover `docs/build-reality-audit/`.** Those files were untracked; git
does not carry them across a squash merge, and they exist only in the original sandbox (§3).

### 9.4 NBA-4.1 — the amendment, restated precisely

The original recommendation was "production origin only". That merged two different decisions and
would have had a bad consequence: because the SIWE message is **origin-bound**, and every Cloudflare
Pages PR gets a distinct preview origin, production-only would have made **Stage 2b testable only in
production** — the single worst place to discover a rejected `uri`, a rejected signature form, or a
wallet that cannot sign.

As amended:

| | Rule |
|---|---|
| **Shipping** | The confirmed production origin, and only it |
| **Testing** | **One** documented non-production origin, **only if the exchange accepts it** |
| **Establishing acceptance** | NBA-6: a real `createWalletChallenge` request from that origin, recording the exact `uri` sent and the full response |
| **If rejected** | **Stage 2b stops.** Production is not used as a test environment, and no workaround (host rewriting, tunnels, proxying through the backend) is permitted without a new decision |
| **Afterwards** | The test origin is retired and the result recorded here |

This converts an unknown into a gate. Stage 2b cannot be declared shippable on the strength of
production anecdote.

### 9.5 NBA-4.2 — the wording that must be used

The verified SDK constraint is about the **signature**, not the account type:

- `AccountSigner.signMessage` must return *"that EOA's raw 65-byte EIP-191 signature: login rejects
  Safe/ERC-6492 wrapped signatures."*
- `ownerAddress` is *"declared as the LOGIN challenge signer when present; otherwise accountAddress
  signs."* A smart-account user therefore logs in **by signing with their owner EOA** — the account
  type is not the obstacle.
- The real failure mode is a **wallet interface that cannot expose a raw EOA signature**.

Permitted copy: *"Sign-in requires a raw signature from the wallet that owns this account. Some
smart-wallet interfaces cannot produce one."*
Prohibited copy: *"Smart wallets are not supported"* — categorically false, and it would needlessly
exclude users who can sign.

### 9.6 NBA-4.3 — what "actionable UX" means here

Accepted, with the condition made testable. The flow must, at minimum:

1. State **before** the signature prompt that the wallet will be asked to sign on **Ethereum mainnet**,
   and why (the login message is bound to chain 1; the exchange binds its own chain in SIWE
   `Resources`).
2. Offer a **single** action to switch, and not silently switch for the user.
3. After login, offer a clear route **back** to the app's intended network.
4. Preserve the user's place — an abandoned login must not strand them on the wrong network.
5. Never present a rejected signature as a generic error; name the likely cause (wrong network,
   unsupported signature form, user cancellation).

A bare `"Login failed"` is **non-compliant** with NBA-4.3.

### 9.7 Unverified register — stays unverified until evidenced

| # | Unknown | Closes with | Do not assume |
|---|---|---|---|
| U-1 | Does the exchange validate `uri` against a **registered allowlist**, or only bind it into the signed message? | NBA-6 real challenge from a non-production origin | That preview origins work, or that any origin works |
| U-2 | Does any **specific wallet** produce a raw 65-byte EIP-191 signature in practice? | The wallet matrix (NBA-7) tested against a real origin | That a given wallet works because its docs say "EIP-191" |
| U-3 | Does the **API-key path** and the **session path** return identical shapes for the same account? | NBA-9 authenticated read | That two auth forms are interchangeable because they reach the same account |
| U-4 | Is a non-testnet environment reachable at all? | `02` §1.1 re-checked; `00` B2 | That mainnet exists because the docs discuss fees |
| U-5 | Will referral/builder revenue ever pay a third-party app? | `09` §7 triggers | Anything — see `09` §0.5 |
| U-6 | Does the exchange's SIWE implementation accept `sessionLevel` beyond `primaryAuthenticated` without MFA? | Not scheduled; only matters for `05` Stage 7 | That "logged in" implies authority to trade |

### 9.8 What these decisions change in the plan

| Artifact | Change |
|---|---|
| `07` | **New §13** — auth-form cache isolation gates (AUTH-01…AUTH-12), the enforcement of NBA-4.4 |
| `08` | Q28–Q30 marked **decided**; Q2/Q5 marked **closed** |
| `05` Stage 2a/2b | Unchanged in content; the entry conditions are now these decisions rather than open questions |
| `09`, `11` | Unchanged. Monetization and AI remain parked — no code, no flags, no placeholders |

### 9.9 Standing prohibitions reaffirmed

These decisions do **not** authorise: wallet connection code, SIWE implementation, private account
requests, trading, cancellation, transfers, withdrawals, monetization, or AI. They do not change
application source, dependencies, CSP, or configuration. They do not permit registration, deployment,
merging, or any fee or financial action.

**Next executable step remains NBA-3** (browser/mobile validation of the current API-key path), then
**NBA-5** (wallet connection only), then **NBA-6** (SIWE feasibility on a real origin — which is the
first step that could invalidate Stage 2b entirely).

---

## 10. Carry-forward register (2026-10-27)

Tracked so nothing in this handoff is silently dropped. None of these is closed by this turn.

| # | Item | State | Owner | Where |
|---|---|---|---|---|
| **C-1** | **Stage 2b origin gate (NBA-6)** | **Unverified** — needs one approved origin + one browser; no challenge called | You approve, then one call | `07` §4.1–4.2 |
| **C-2** | **Authorised live API-key tests** (items 6, 7, 8, 11, and stale/401/403 of 12) | **Blocked** — needs an authorised testnet key entered by you through the app's own UI | You | `13` §3, §3.2 |
| **C-3** | **Pages-level CSP as served** (item 19) | **Blocked** — dev server emits no CSP; needs a Pages preview | Deploy authorisation (not granted) | `13` §3 |
| **C-4** | **Outstanding browser sub-checks** — A3, A6, B8, C3, D3, D6, D8, E2, E5, B6-inner-scroll | **Not run** — honest gaps, none needs a key or wallet | Either of us, ~10 min total | `14` §4 |
| **C-5** | **44 px touch targets (F-08)** | **Measured, deliberately not fixed** — a **separate UX task**; no global styling change during this investigation | UX, separately | `13` §4.2 |
| **C-6** | **F-09 — SDK guide shows a host with no DNS record** | **Fixed.** `SdkGuide.tsx` printed `api-testnet.polyester.com` (3 places); the SDK and every other document use `api.testnet.polyester.com`, and the hyphenated name returns **no DNS record**. **Fixed** — 3 strings in `SdkGuide.tsx`, browser-verified | — | `13` §4 |
| **C-7** | **SDK not yet a web dependency** | Stage 2b would add `@polyester/sdk` to `apps/web` (currently only sits in example strings); licensing record NBA-8 still stands | Decision at Stage 2b start | `05` |
| **C-8** | **Multi-wallet selection (F-10)** — was one legacy `window.ethereum` only; now EIP-6963 discovery lets the user pick among announced wallets. Related to the user-reported Phantom `evmAsk.js` injection failure | **Implemented** — EIP-6963 discovery, per-wallet buttons, 22 tests, browser-verified (`13` §3.1b) | You decide at NBA-7 | `13` §3.1a, §4 |
| **C-9** | **CORS blocks browser-direct auth calls** — user-executed preflight from the preview origin was refused (*no `Access-Control-Allow-Origin`*). Stage 2b therefore needs a same-origin proxy (or a proven CORS allowance); production stays untested | **Evidence recorded; gate still unverified** — the POST was never sent, so `uri` acceptance is unknown. A same-origin proxy is the planned shape, and the SDK supports it through its `fetch` option without a fork | Test server-to-server (curl), not in the browser | `07` §4.1a |
| **C-10** | **Does the existing API-key path survive CORS?** It builds direct browser GETs to the same host with custom headers, so it preflights too. If CORS is refused origin-wide, that path fails in a browser regardless of the key | **Hypothesis only** — never exercised live | One preflight to the account REST route; no key needed | `07` §4.1a |
| **C-11** | **Mobile overflow (F-11)** — `#/book`, `#/hub`, `#/sdk` overflowed 360–390 px for four distinct reasons | **Fixed and re-verified** across 17 routes × 4 viewports | — | `13` §3.1c |
| **C-12** | **Verified API surface panel** — 22 Connect RPC methods, self-verifying against the installed SDK protos, read/write separated, auth stated only where documented | **Shipped**; `tests/api-surface.test.mjs` fails if the SDK drifts or a write RPC enters app code | Review the auth column as docs expand | `13` §3.1c |
