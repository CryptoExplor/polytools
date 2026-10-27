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
| 3 | **Login uses Ethereum mainnet Chain ID (1)**, set by the backend, with the Polyester chain bound in SIWE `Resources` | A wallet on the wrong network cannot sign. Explicitly *"wallet adapters must select Ethereum mainnet before signing"*. This surprises users who expect the app's own network. |
| 4 | **The bearer token is the credential, not the wallet** | Any private read is authorized by the token. Losing/rotating it is a session concern; the wallet is irrelevant until re-login. This is also why `AuthSessionStore` is the security-critical object (risk **R-02**). |
| 5 | **API-key and session identities coexist** — `me()` returns `apiKeyId?` alongside `accountId` and `sessionLevel` | The API-key path and the wallet path are **two doors to the same account**, not two accounts. They must not be treated as separate users, and never merged into one cache entry keyed by the wrong identifier. |
| 6 | **Session assurance is graded** — `sessionLevel` ∈ `unspecified` / `primaryAuthenticated` / `mfaElevated` / `freshStepUp` | Graded assurance already exists. Any future transaction work must check the level rather than assume "logged in" is enough (`05` Stage 7). |

### 4.4 What PolyTools actually has today

| Component | Status at `091a1b1` |
|---|---|
| Wallet connection | **Absent.** Repo-wide search for `window.ethereum`, `connectWallet`, `wagmi`, `viem`, `walletconnect`, `AccountSigner` → **one** hit: a *marketing link card* in `Hub.tsx:36` describing the **exchange's** sign-in options. No wallet code exists. |
| Exchange authentication | **Absent.** No `createWalletChallenge`, no SIWE, no bearer-token session. |
| Account access | **Present, by API key only**: `READ_ONLY_OPERATIONS` (10 GETs), Ed25519 HMAC request signing, sealed local vault (passphrase-protected), runtime DTO validation. |
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
| **NBA-4** | **Answer the four pre-Stage-2a questions** (below). | **You** | Four written answers | Stage 2a; and it decides whether B is even feasible |
| **NBA-5** | **Stage 2a: wallet connection only.** Address display, network guard, no exchange call, no private data. | Me, after NBA-4 | Fails safe with no wallet; no network call on connect; contrast/whitespace/tests green | The wallet-first shell |
| **NBA-6** | **Verify SIWE feasibility on a real origin** — one challenge/response against testnet from an actual deployment origin, with one injected wallet. | Me + you (needs a wallet and a live origin) | Recorded request/response, including the `uri` used and the resulting `sessionLevel` | Stage 2b. **Not** a private-data read |
| **NBA-7** | **Decide the wallet support matrix** (Q7) using §4.3 findings — EOA-only wallets work; wrapped-signature smart wallets fail login. | **You** | Named list, with the reason each is in or out | Stage 2b scoping, CSP changes (R-06) |
| **NBA-8** | **Settle the licence record** (B1) to whatever standard you accept: the chat statement is recorded and sufficient, or a written agreement is pursued. | **You** | Recorded decision | Bundling the SDK at all |
| **NBA-9** | **Resolve API compatibility** before any "live-compatible" claim: one authenticated read against a known-good API key, with the exchange's **exact error code and body** captured on failure. | Me + you (needs a key) | A recorded request/response pair | Stage 3; the whole reliability story |
| **NBA-10** | **Keep the monetization and AI work parked** exactly as specified — no code, no flags, no placeholders (`09` §5.1, `11` §0). | Me (discipline) | Nothing to do; monitored at each review | — |

### NBA-4, expanded — the four questions that gate Stage 2a

1. **Which origin(s) will be allowed to request a SIWE challenge?** The message is origin-bound
   (§4.3 #1). Preview hosts, staging, and custom domains are different origins. *Without this, Stage
   2b cannot be tested anywhere but production.*
2. **Do you accept EOA-only wallet support for launch?** Login rejects Safe/ERC-6492 wrapped
   signatures (§4.3 #2). Embedded/smart wallets may be unable to sign in. This directly contradicts
   any promise of "Google/email embedded wallet" support.
3. **Is a hard "switch to Ethereum mainnet" prompt acceptable?** Login signs on chain 1 regardless of
   the app's network (§4.3 #3). Users will be asked to change network to sign in, then change back.
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
