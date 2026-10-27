# 07 — Acceptance test matrix

Two audiences:
- **Automated** — must pass in CI for the relevant stage to be mergeable. No network, no credentials.
- **Manual / human-run** — requires a real browser origin and a disposable testnet account. Cannot
  be automated in this repository, and this audit did not perform any of it.

Legend: **A** = automated, **M** = manual. Status **Baseline** = already passing at HEAD.

---

## 1. Baseline regression (must never break)

| ID | Test | Type | Status |
|---|---|---|---|
| B-01 | Full suite `node --test tests/*.test.mjs` | A | **Baseline: 318/318 pass, 71 suites** |
| B-02 | `npm run typecheck` (web + backend) | A | **Baseline: pass** |
| B-03 | `npm run check:whitespace` | A | **Baseline: 184/184, 0 violations** |
| B-04 | `npm run check:runtime` (TextDecoder, Blob, URL, webCrypto, ed25519) | A | **Baseline: pass** |
| B-05 | `npm run check:contrast` (≥4.5:1) | A | **Baseline: 54/54** |
| B-06 | `npm run check:dependencies` (licence metadata, lock consistency) | A | **Baseline: pass; `UNLICENSED=1` is the SDK** |
| B-07 | `npm run check:external` (offline SDK pin inventory) | A | **Baseline: `@polyester/sdk 0.31.0`, 0 mismatches** |
| B-08 | `npm run build` + `npm run check:performance` | A | Not run this phase (budget) |
| B-09 | All 11 public routes render and fetch | A | Baseline (`public-phase1`, `frontend-batch1`) |
| B-10 | Both legacy redirects (`/flow`, `/portfolio`) resolve | A | Baseline |
| B-11 | CSP header text unchanged unless a stage explicitly amends it | A | Baseline (`deployment-security`) |

---

## 2. API-key path preservation (the fallback must stay whole)

| ID | Assertion | Type |
|---|---|---|
| K-01 | `READ_ONLY_OPERATIONS` still contains exactly 10 GET operations | A |
| K-02 | `signReadRequest()` rejects any non-registry or non-GET operation | A |
| K-03 | `normalizeRegisteredKeyId` accepts `ak_…` and rejects local labels | A |
| K-04 | Vault encrypts with PBKDF2 ≥600 000 iterations + AES-GCM-256 | A |
| K-05 | No localStorage key material; IndexedDB holds ciphertext only | A |
| K-06 | 5 failed unlocks → 30 s lockout | A |
| K-07 | 15-minute idle lock fires | A |
| K-08 | Cross-tab lock/wipe invalidates the other tab (`VAULT_STALE`) | A |
| K-09 | Canonical string + signature headers unchanged | A |
| K-10 | Monotonic timestamps strictly increase | A |
| K-11 | Full key-mode flow end-to-end | **M** |

Existing coverage: `account-rest` (14), `canonical-request` (14), `account-setup-secrets` (2),
`account` (15).

---

## 3. Wallet connection (Stage 2a)

| ID | Assertion | Type |
|---|---|---|
| W-01 | No provider ⇒ degraded UI, no crash | A |
| W-02 | `connect()` transitions `disconnected → connecting → connected` | A |
| W-03 | `disconnect()` clears address and chain | A |
| W-04 | `accountsChanged` updates the **displayed** address and **never** authenticates | A |
| W-05 | `accountsChanged` clears any existing exchange session | A |
| W-06 | `chainChanged` does not auto-relogin and does not loop | A |
| W-07 | Connection performs **no** request to any Polyester endpoint (spy on `fetch`) | A |
| W-08 | Connecting a wallet does not render balances/orders/fills | A |
| W-09 | Provider rejection (`4001`) surfaces a cancellable error, not a crash | A |
| W-10 | Connect/disconnect on MetaMask + Rabby on testnet | **M** |
| W-11 | Mobile browser with an in-app wallet | **M** |

### Stage 2a status (automated only — `tests/wallet-connection.test.mjs`)

| ID | Status | Evidence |
|---|---|---|
| W-01 | **Pass** | `unavailable` state renders a "No wallet" pill; `connect()` returns `NO_PROVIDER` without throwing |
| W-02 | **Pass** | Subscriber records exactly `connecting → connected` after a `disconnected` start |
| W-03 | **Pass** | `disconnect()` clears address **and** chain id |
| W-04 | **Pass** | `accountsChanged` updates the displayed address with a `fetch` spy at 0; state carries no token or signature |
| W-05 | **N/A by construction** | No exchange session exists yet. Guarded: the module exports no session/token/login surface and state keys are exactly `status, address, chainId, error, updatedAtMs`. **Must become a behavioural test at Stage 2b** |
| W-06 | **Pass** | `chainChanged` keeps the address, issues no provider request, notifies once for repeated identical events, and leaves exactly one handler per event |
| W-07 | **Pass** | `fetch` spy at 0 across start, connect, account switch, chain switch and disconnect; provider methods limited to `eth_accounts`, `eth_chainId`, `eth_requestAccounts` |
| W-08 | **Pass (view level)** | The connected view is exactly `address, chain, kind, short, title` and contains no balance/order/fill/equity/position text. A DOM-level assertion still needs the browser pass |
| W-09 | **Pass** | `4001` yields a recoverable `USER_REJECTED` error with no phantom address; the same instance retries to `connected` |
| W-10 | **Blocked** | Needs a real wallet extension |
| W-11 | **Blocked** | Needs a mobile browser with an in-app wallet |

The 2a gate is therefore **satisfied for every automated criterion** and **still blocked** on W-10/W-11
and on the DOM-level half of W-08. A green automated run is not browser verification.

---

## 4. Exchange authentication (Stage 2b)

| ID | Assertion | Type |
|---|---|---|
| S-01 | `login()` success sets `authenticated` with server-returned `accountId`/`username` | A |
| S-02 | The `AccountSigner` passed to the SDK returns a **raw 65-byte** signature, not ERC-6492 | A |
| S-03 | Rejected/invalid signature ⇒ `error`, no session | A |
| S-04 | `restoreSession()` returns `null` for a token from a different environment fingerprint | A |
| S-05 | `logout()` clears the token and all session state | A |
| S-06 | No `polyester_auth_token` cookie is written (in-memory storage) | A |
| S-07 | Token never appears in telemetry/log output (spy) | A |
| S-08 | Expiry surfaces `expired` without triggering a wallet prompt automatically | A |
| S-09 | `handleRejectedToken` ends the session and clears caches | A |
| S-10 | SIWE message is signed byte-exact (no re-hash, no rebuild) | A |
| S-11 | Chain switched to mainnet (1) before signing when the provider requires it | A |
| S-12 | Real sign-in from a testnet browser origin | **M** |
| S-13 | A denied/permission-limited session read is recorded as a valid result | **M** |

### 4.1 Stage 2b origin gate — feasibility investigation (NBA-6), 2026-10-27

**Verdict: the gate remains unverified.** No challenge was requested — this is a documentation and
declaration study only. Everything below was established **without** calling the exchange.

| # | Question | Evidence | Result |
|---|---|---|---|
| 1 | Is `uri` caller-supplied or registered in advance? | `CreateWalletChallengeInput` is a strict object of exactly `smartAccountAddress`, `signerAddress`, `uri` — SDK 0.31.0 `dist/services/auth/auth.d.ts` | **Caller-supplied, per request** |
| 2 | Is there a client-side allowlist? | `WalletChallengeUriSchema` (`wallet-challenge.schemas.js`): max 2048, regex `^https?://[^/?#\s\\]+$`, rejects userinfo. No other check | **Syntax only** |
| 3 | Does the environment object carry an origin? | `POLYESTER_TESTNET_ENVIRONMENT` = `name, apiUrl, websocketUrl, rpcUrl, chain, accountAbstraction, contracts` (`environment.js:182`). No web-host field | **No origin config exists** |
| 4 | Is there a declared origin-rejection error? | All 46 `AuthErrorCode` values (`0`–`45`) enumerated from `dist/gen/auth/v1/auth_pb.d.ts`. None is origin, URI or domain related; nearest is `AUTH_INVALID_REQUEST = 6` | **None declared** |
| 5 | What does the public contract call `uri`? | proto: *"Browser origin URI requesting the signature, including scheme and optional port but no path, query, fragment, or user information."* Guide: *"The challenge binds the requesting origin, owner EOA, …"* | **Bound into the message**, not checked against a list |
| 6 | Is a non-production origin an expected case? | Client config: *"Browser storage scopes the bearer and display-session cookies by port on loopback, `.localhost`, and RFC1918 private IPv4 hosts"* | **Yes — local/LAN origins are a supported scenario** |
| 7 | Does our own CSP already permit the call? | `apps/web/public/_headers` → `connect-src … https://api.testnet.polyester.com` | **Already permitted**; no CSP change needed for the API host |
| 8 | Can the agent's sandbox execute the test? | DNS resolves (`api.testnet.polyester.com`); TCP 443 opens; TLS handshake fails `SSL_ERROR_SYSCALL` (egress proxy resets). Docs are readable only through a separate reader | **No — must run in your browser** |
| 9 | Can a browser at a non-production origin call it directly? | **User-executed 2026-10-27** at `https://arena-609563ba-polytools.polytools-cc8.pages.dev`: `fetch` POST to `.../auth.v1.AuthService/CreateWalletChallenge` → *"blocked by CORS policy: Response to preflight request doesn't pass access control check: No 'Access-Control-Allow-Origin' header is present on the requested resource"*, then `net::ERR_FAILED` | **No — preflight refused** |

**What this narrows.** The gate is **not** an origin-registration, allowlist-application or
deployment-authorisation process: no such step appears in any official declaration, and the SDK
explicitly accommodates loopback and LAN origins for session storage. What remains genuinely unknown
is narrower than the record previously assumed — two things, both answered by the **same single
public call**:

1. whether the backend accepts `uri` set to a non-production origin, and
2. whether CORS permits a browser at that origin to read the response.

**What the gate needs — revised 2026-10-27.** A browser is **not** sufficient: the preflight is
refused (§4.1a), so the request never leaves the page. The acceptance question must be asked
**server-to-server**, where CORS does not apply. Still no wallet, key, account or deployment is
required — `createWalletChallenge` is public and takes any two syntactically valid addresses. The
*later* S-12 step — signature → JWT → `sessionLevel` — is separate and does need a real wallet.

### 4.1a CORS — the browser cannot call the auth API directly (evidence, 2026-10-27)

You ran the proposed probe from the deployed preview origin
`https://arena-609563ba-polytools.polytools-cc8.pages.dev`. The browser refused it **before the POST
was ever sent**:

```
Access to fetch at 'https://api.testnet.polyester.com/auth.v1.AuthService/CreateWalletChallenge'
from origin 'https://arena-609563ba-polytools.polytools-cc8.pages.dev' has been blocked by CORS
policy: Response to preflight request doesn't pass access control check: No
'Access-Control-Allow-Origin' header is present on the requested resource.
POST ... net::ERR_FAILED
```

**What this establishes:** a browser at that origin cannot call the auth RPC successfully today. The
preflight was answered without `Access-Control-Allow-Origin`, and the browser then refused to send
the request.

**What it does not establish — and this matters:**

1. **It does not answer the gate.** The POST never happened, so the question "does the backend accept
   a non-production `uri`" is untouched. CORS is a browser policy check on the *response*; it tells us
   nothing about what the server would have done with the request.
2. **It does not distinguish two different causes.** Either the exchange allowlists specific origins
   (and this one is not on the list), or the service emits no CORS headers for this route at all. The
   browser hides the status code and headers of a failed preflight, so we cannot tell which.
3. **It does not tell us about the production origin.** The shipping origin was never tested, and it
   will not be — production is not a test environment.

**Architectural consequence (recorded, not implemented).** Stage 2b must not assume browser-direct
calls to the auth API. Two viable shapes:

| Shape | Consequence |
|---|---|
| **Proxy through our own origin** (`/api/*` Pages Function → auth API) | Removes the CORS dependency entirely; the browser only talks to our own origin, which `connect-src 'self'` already covers. Also the only shape that can keep the session token out of script reach (HttpOnly cookie). **Recommended.** |
| Browser calls the API directly | Requires the exchange to allowlist our exact origin *and* the browser to pass preflight. Unproven, and unprovable on a non-production origin until it is tested. |

**The proxy shape is supported by the SDK without a fork** (verified in SDK 0.31.0).
`PolyesterClientCommonConfig` declares:

```ts
/** Custom fetch implementation for SDK HTTP requests. Defaults to the global
 *  `fetch`, resolved on each request. Ignored when `transports` is provided. */
fetch?: typeof fetch;
```

and `PolyesterBrowserClientConfig = Omit<PolyesterClientBaseConfig, "auth"> & { accountSigner?, tokenStorage? }`
— **only `auth` is removed**, so `fetch` is available on the browser client too. Passing a `fetch`
that rewrites `https://api.testnet.polyester.com/*` to `/api/*` routes every SDK call through our own
origin, which `connect-src 'self'` already covers. Three consequences worth recording:

- **Prefer `fetch` over `transports`.** `transports` is documented as skipping the built-in
  auth/error-mapping interceptors, which the `S1`–`S10` assertions rely on; overriding `fetch`
  leaves them in place.
- **The proxy must stay transparent.** The SDK speaks Connect (binary by default), so the Pages
  Function has to forward method, headers and body **bytes** unchanged and stream the response back
  — no re-serialisation.
- **`auth` is a credential option, not a transport one.** It decides *what* is sent
  (`JwtAuthProvider` / `ApiKeyEd25519AuthProvider`), never *where* it is sent, so it does nothing
  for CORS on its own.

Open decision for Stage 2b, not asserted: with a proxy, the session token could live in an
`HttpOnly` cookie set by our origin and never reach script. The SDK's own `tokenStorage` is
JS-reachable (memory or cookie), so "SDK-managed token" vs "proxy-managed `HttpOnly` session" is a
decision to take with the gate result, not now.

**A related question this raises, not asserted:** the existing API-key account path builds
**direct browser GETs** to the same host with Ed25519 headers — which also triggers a preflight
(`docs/account-live-verification.md`, `docs/audit/DEPLOYMENT_HARDENING.md`). If CORS is refused
origin-wide, that path would fail in a browser too, independently of the key. **This is a hypothesis,
not a finding**: the API-key path has never been exercised live (`13` item 6–8, still blocked), and
the observed refusal may be route-specific. The discriminating test is a preflight against the
account REST route from the same origin — cheap, and it needs no key.

### 4.2 The one origin to approve

| Candidate | Non-production? | Real HTTPS? | Notes |
|---|---|---|---|
| Existing Pages preview `https://5b3de73c.polytools-cc8.pages.dev` | Yes (preview deployment) | Yes | Represents a real deployed origin; already exists, needs no new deploy |
| `http://localhost:5199` | Yes | No (loopback, schema-valid) | The origin actually used by every check in `13` §3.1 |

Recommendation: approve the **Pages preview** as the single documented non-production origin, and
treat `localhost` as a development convenience only if the preview origin is also accepted. Do not
approve both as "production" claims.

---

## 5. Unified data layer (Stage 3) — the safeguard matrix

Each PR #6 safeguard must be re-proven **against the SDK client**, not just the REST client.

| ID | Safeguard | Assertion | Type |
|---|---|---|---|
| D-01 | Explicit first read | No private request until `load({explicit:true})`; `activated` gates visibility refresh | A |
| D-02 | Freshness | `ACCOUNT_DATA_FRESHNESS_MS === 2 * 60 * 1000`; a 121 s-old dataset is stale; a 60 s-old one is not | A |
| D-03 | Manual override | `explicit:true` bypasses the age gate | A |
| D-04 | Per-period isolation | Switching `1d → 30d → 1d` reuses the `1d` cache without refetching; caches are not cross-contaminated | A |
| D-05 | Shared across tabs | Two views mounting the same range issue **one** request (single-flight) | A |
| D-06 | Stale-response discard — wallet | Mid-flight `accountsChanged` ⇒ response discarded, zero rendering | A |
| D-07 | Stale-response discard — vault | Mid-flight lock ⇒ abort, no late render (existing behaviour) | A |
| D-08 | Account switch | Mid-flight `switchAccount`/subaccount change ⇒ discard + wipe | A |
| D-09 | Logout | Wipes all `periods`, resets `activated` | A |
| D-10 | Vault boundary | `LOCK`/`WIPE`/`VAULT_CHANGED`/`IMPORT`/`UNLOCK` clears private state | A |
| D-11 | View-scoped errors | One dataset failing leaves the other seven rendered | A |
| D-12 | Stale fallback | Only `TEMPORARY_ERRORS` may reuse previous data; `UNAUTHENTICATED`/`PERMISSION_DENIED` may not | A |
| D-13 | No durable private storage | No IndexedDB/localStorage write contains account data | A |
| D-14 | Coverage integrity | Missing field ⇒ `unavailable`, **never** `0` or empty-success | A |
| D-15 | Cursor discipline | Opaque tokens replayed exactly; repeated cursor detected; page cap enforced | A |
| D-16 | Retry policy | Never retry auth/permission/signature/schema errors; bounded retry on temporary | A |
| D-17 | Cancellation | `AbortSignal` passed to every SDK call; abort on lock/range change | A |
| D-18 | Runtime validation | Malformed SDK response ⇒ `SCHEMA_INCOMPATIBLE`, not `undefined` in a chart | A |
| D-19 | Ordering per dataset | Documented + asserted per method before any "complete history" label | A + **M** |
| D-20 | No duplicate requests across tabs | Two tabs share one session owner, no duplicate fetch | **M** (needs real tabs) |

---

## 6. Analytics honesty (Stage 4)

| ID | Assertion | Type |
|---|---|---|
| A-01 | Every displayed figure carries an attribution label | A |
| A-02 | "Estimated" reachable and asserted when marks are stale | A |
| A-03 | "Unsupported" rendered for verified P&L / historical fees / cross-chain P&L | A |
| A-04 | Fee analytics never derive historical fees from current rates | A |
| A-05 | P&L refuses to compute on `partial` coverage / unresolved flows | A |
| A-06 | Equity chart states requested vs observed window and 5-minute bucket interval | A |
| A-07 | No "complete history" string while `cursorExhausted === false` | A |
| A-08 | Cost-basis UI unchanged in behaviour (`account-cost-basis-ux`, 5 tests; `account-lots`, 18) | A |

---

## 7. Navigation and dapp structure (Stage 5)

| ID | Assertion | Type |
|---|---|---|
| N-01 | Every pre-migration route still resolves to the same component | A |
| N-02 | `/flow` → `/account/transactions?scope=public`; `/portfolio` → `/account` | A |
| N-03 | `ROUTE_META` covers every route (no blank header) | A |
| N-04 | Connect affordance appears when disconnected; keys remain reachable | A |
| N-05 | Mobile nav and focus trapping intact (`dialog-focus`, `frontend-batch1`) | A |
| N-06 | Deep links survive static hosting (HashRouter) | A |

---

## 8. Manual live verification (Stage 6) — human-run only

Cannot be automated here; no credentials will be created by this audit.

| ID | Check | Why it can't be automated |
|---|---|---|
| L-01 | SIWE sign-in from the intended HTTPS origin | Real wallet + real extension |
| L-02 | CORS preflight succeeds for the SDK's ConnectRPC requests | Browser-enforced |
| L-03 | Session-token permission scope (which reads are actually allowed) | Server-side policy |
| L-04 | Pagination completeness + ordering per dataset | Real datasets |
| L-05 | Wallet switch with data on screen | Needs two real wallets |
| L-06 | Session expiry mid-session | Requires waiting out a real TTL |
| L-07 | Cross-tab cache reuse and invalidation | Two real tabs |
| L-08 | Mobile browser behaviour | Real device |
| L-09 | A denied read recorded as a valid result | Policy-dependent |

---

## 9. Transaction workflows (Stage 7) — deferred

| ID | Assertion | Type |
|---|---|---|
| T-01 | No SDK mutation method referenced outside `gate.ts` | A |
| T-02 | Submission requires explicit confirmation + preview | A |
| T-03 | Duplicate submission blocked by an in-flight lock | A |
| T-04 | `pending → accepted/rejected/failed` states all reachable | A |
| T-05 | Reconnect triggers a full reconciliation fetch | A |
| T-06 | Read-only mode provably preserved (T-01 passes with the gate disabled) | A |

---

## 10. Gate summary

| Stage | Mergeable when… |
|---|---|
| 0 | Reports published; zero source files modified |
| 1 | F-07–F-11 record accepted from PR #7 (directory restoration optional, Q2/Q5 closed); docs corrected; suite green |
| 2a | W-01…W-09 pass (automated; W-05 N/A — no session exists yet); **no** Polyester request made on connect. W-10/W-11 need a real browser |
| 2b | S-01…S-11 pass; **G1 licence resolved**; in-memory token confirmed |
| 3 | D-01…D-19 pass with the flag on **and** off; K-01…K-10 still pass |
| 4 | A-01…A-08 pass |
| 5 | N-01…N-06 pass |
| 6 | L-01…L-09 evidenced from a real origin |
| 7 | T-01…T-06 pass; read-only invariant replaced, not removed |
| 8 | Stage 6 complete + parity + security sign-off + G1 |

---

## 11. Monetization (Stage M2) — see `09` and `05`

Scope is deliberately tiny: disclosure + an outbound link. There is **no order-path monetization** to
test, because Polyester has no builder-fee mechanism.

| ID | Assertion | Type |
|---|---|---|
| MO-01 | Flag off ⇒ nothing renders; behaviour byte-identical to baseline | A |
| MO-02 | Flag on ⇒ 15% referrer share disclosed **before** any action is offered | A |
| MO-03 | The 4% discount is presented as the **user's** benefit, not PolyTools' | A |
| MO-04 | "Applying this code may replace your current referrer and end their earnings" is shown | A |
| MO-05 | No auto-application; no code submitted to any endpoint | A |
| MO-06 | Zero network requests to any Polyester endpoint from the monetization surface | A |
| MO-07 | Declining leaves every existing feature working | A |
| MO-08 | `referralShare` never rendered and never exported (regression guard) | A |
| MO-09 | PolyTools revenue never displayed in any user-facing view | A |
| MO-10 | No self-referral tooling, no code that applies a code to the operator's own account | A |
| MO-11 | Referral link targets the documented console URL only (no look-alike domain) | A |
| MO-12 | Terms/eligibility confirmed in writing before M2 ships | **M** |
| MO-13 | **No monetization config key, flag, or `monetizationConfig` export exists** before M2 ships (`09` §5.1) | A |
| MO-14 | **No builder-fee parameter, attribution header, or placeholder SDK method exists anywhere** in the tree | A |
| MO-15 | Referral launch verified against `09` §7 (L-1…L-5) and the result recorded before any code | **M** |
| MO-16 | The monetization module imports nothing from `accountSessionOwner`, `account/`, or the signer — and is imported by none of them (dependency-direction check) | A |

**Gate:** Stage M2 is mergeable when MO-01…MO-11 and MO-13…MO-16 pass, **and** the launch bar
(`09` §7) is met and recorded, **and** Q16 is answered in writing.

**Correction (2026-10-27).** MO-13/MO-14 exist because nothing may be pre-built: a config key that
gates nothing is still shipped surface, and a placeholder builder parameter would fabricate a
capability the exchange has not specified. Until the mechanism is live, the correct state of this
whole section is **empty diff**.

---

## 12. AI analyst — **no tests, because there is no feature**

The optional BYOK AI assistant (`11`) is not implemented, so it contributes no rows here. When and if
it is approved, it inherits this matrix's rules and adds the ones in `11` §8 — in particular:

- indicator tools must match reference values within stated tolerances;
- every registered tool must declare an **egress class**, and no raw-egress tier may exist;
- a **structural** test asserting no submission, signing, withdrawal, or arbitrary-HTTP tool exists;
- a **redaction** test asserting a user-supplied key never reaches logs, telemetry, errors, URLs, or
  storage dumps.

Until then, the correct state of this document with respect to AI is **unchanged**.

---

## 13. Authentication-form cache isolation — required *before* a second auth form ships

**Origin:** decision **NBA-4.4** (2026-10-27, `12` §9). Today there is one auth form: an Ed25519
API-key vault. The wallet-first programme introduces a **second** form: a SIWE bearer session. This
section defines the gates that must pass before the second form is allowed to serve private data.

**Why this is a gate and not a nice-to-have.** Risk **R-02** (`06`) is Critical: `AccountSessionOwner`
retains completed private datasets in memory for the whole session, and the SDK's `AuthSessionStore`
is bound to an **environment fingerprint, not a wallet** — a token minted for wallet A stays valid
while wallet B is connected. One auth form is already at risk; two forms sharing a cache would make
cross-form and cross-account disclosure the default rather than the exception.

**Current identity is insufficient.** `AccountSessionIdentity` is `{ generation, entryId }`
(`accountSessionOwner.ts:42`). Both fields are vault-scoped. That is adequate for one form and
**inadequate for two**: it cannot express "which auth form produced this dataset".

| ID | Assertion | Type |
|---|---|---|
| AUTH-01 | Cache identity binds **authentication form** *and* **account identity**, not vault generation alone | A |
| AUTH-02 | Datasets are stored in **separate namespaces** per auth form; no read path can return a dataset produced under the other form | A |
| AUTH-03 | Switching auth form (API-key ⇄ session) **invalidates or shadows** the previous form's cached private data — it is never served, not merely hidden in the UI | A |
| AUTH-04 | Switching **account** within one form does not serve the previous account's datasets (`R-02` regression) | A |
| AUTH-05 | Switching **wallet** while a session token from a different wallet is live cannot expose that wallet's data (the `AuthSessionStore` fingerprint gap) | A |
| AUTH-06 | An in-flight load started under form/account A cannot publish into a view now bound to B (late-response guard, extended to the form dimension) | A |
| AUTH-07 | Session expiry or rejection (`handleRejectedToken`) clears the session form's namespace; the API-key path is unaffected | A |
| AUTH-08 | A test asserts **no** cache read path can be constructed without naming both form and account | A |
| AUTH-09 | Removal of the API-key path requires **measurable parity**: a named, passing test set covering every capability in `03` for both forms | **M** |
| AUTH-10 | Parity is recorded with the date and the evidence; "it feels equivalent" is not parity | **M** |
| AUTH-11 | The API-key path remains functional for every capability it supports today, with its own tests, until AUTH-09 and AUTH-10 are satisfied | A |
| AUTH-12 | Any document proposing API-key removal without AUTH-09/AUTH-10 attached is rejected on sight | G |

**Gate:** Stage 2b (SIWE) may serve **private** data only when AUTH-01…AUTH-08 pass. Public-data
rendering and wallet-connection UI (Stage 2a) are unaffected and may ship earlier.

**Non-goals.** This section does not authorise building the session path, and it does not weaken
AUTH-09 into an aspiration. If parity cannot be measured, the API-key path stays — that is the
decided outcome, not a failure.

