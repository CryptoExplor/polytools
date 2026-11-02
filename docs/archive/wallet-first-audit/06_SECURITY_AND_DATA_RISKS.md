# 06 — Security and data risks

Risk register for the wallet-first migration. Severity reflects impact × likelihood **given
the target architecture**. Every risk names a mitigation that can be tested, and states what
cannot be mitigated by code (those need a human decision).

| ID | Risk | Sev | Likelihood | Owner |
|---|---|---|---|---|
| R-01 | SDK licence restricts redistribution — **reduced to Medium 2026-10-27** (team statement; not a written agreement) | **Medium** | Low | Business/legal |
| R-02 | Account data leaks across wallet/account switch | **Critical** | Medium | Engineering |
| R-03 | Structural read-only guarantee lost | **High** | High if unaddressed | Engineering |
| R-04 | XSS becomes session/account takeover | **High** | Low–Medium | Engineering |
| R-05 | Session token persisted where it should not be | **High** | Medium | Engineering |
| R-06 | CSP must widen; widens attack surface | **Medium** | Certain if SDK ships | Engineering |
| R-07 | No mainnet environment → testnet-only claims | **High** (product) | Certain | Product |
| R-08 | Schema drift between SDK and friendly REST | **Medium** | Medium | Engineering |
| R-09 | Silent zeroing / incomplete history presented as complete | **High** | Medium | Engineering |
| R-10 | Wallet provider spoofing / phishing-shaped UI | **Medium** | Medium | Engineering |
| R-11 | Realtime gaps misread as live truth | **Medium** | Medium | Engineering |
| R-12 | Clock skew and replay | **Low** | Low | Engineering |
| R-13 | Credential leakage in logs/telemetry/preview | **High** | Low | Engineering |
| R-14 | Verification evidence is second-hand | **Medium** | Certain today | Process |

---

## R-01 — SDK licence restricts redistribution · Medium (was Critical)

`@polyester/sdk@0.31.0` declares `"license": "UNLICENSED"`; its `LICENSE` reads: *"No license
is granted to copy, modify, distribute, sublicense, or use this work except under a separate
written agreement with Fabric Blockchain Labs Inc."*

Bundling it into a publicly served SPA is distribution and is unlicensed use. The repository
already discloses this (`apps/web/src/pages/SdkGuide.tsx:414`) and a test enforces the
disclosure (`tests/sdk-typescript-examples.test.mjs:23`), which shows the team is aware but
does not constitute permission.

**Update 2026-10-27.** A Polyester team member stated: *"You're fine to use it to build bots and
trade on Polyester, which is what it's for."* Severity reduced from Critical to **Medium**: good-faith
clearance exists, so this is now **accepted risk** rather than a blocker.

- **Mitigation:** (a) obtain a durable attributable record — official GitHub account or email;
  (b) keep the in-app licence disclosure and reword it to cite the statement; (c) re-read the
  `LICENSE` on every SDK version bump; (d) never vendor/fork the SDK source.
- **Residual (not code-mitigable):** a chat message is not the "separate written agreement" the
  `LICENSE` contemplates, and it does not explicitly cover redistributing SDK code to third-party
  browsers (a public dapp, unlike a bot). Accepted, not eliminated.
- **Note:** the wallet-connection stage (2a) and all referral monetization need no SDK at all, so
  they were never affected.

## R-02 — Account data leaks across wallet/account switch · Critical

The highest-severity engineering risk. Three compounding facts:

1. `AccountSessionOwner` caches private datasets **in memory** for the whole session and
   deliberately retains completed data when a view is left (`setActive(false)` only cancels
   in-flight work). That is correct for one identity.
2. The SDK's `AuthSessionStore` is bound to an **environment fingerprint**, not to a wallet.
   A token minted for wallet A remains valid while wallet B is connected.
3. `accountsChanged` is a provider event that, if unhandled, silently changes the displayed
   address while wallet A's balances remain on screen.

Result without mitigation: user switches wallet, sees the previous wallet's balances, orders,
fills, transfers and P&L.

- **Mitigation (must all ship):**
  - `accountsChanged` ⇒ treat as `logout()`: clear token, wipe **all** `periods`, reset
    `activated`, abort in-flight.
  - Extend the in-flight identity key to include `accountId` and `walletAddress`
    (`05` Stage 3).
  - `isCurrent()` must compare the full tuple and fail closed.
  - A regression test that mocks a wallet switch mid-flight and asserts **zero** previous-wallet
    rows are rendered and the in-flight response is discarded.
- **Residual:** a future feature that caches private data durably would reopen this.

## R-03 — Structural read-only guarantee lost · High

Today read-only-ness is *structural*: `READ_ONLY_OPERATIONS` is a 10-entry GET allowlist and
`AccountVault.signReadRequest()` throws `OPERATION_NOT_ALLOWED` for anything else. There is no
code path that can mutate.

An SDK client can reach `orders.create`, `orders.cancel`, `internalTransfers.create`,
`tradingWithdraws.createToExternalChain`, `triggers.*`, `subaccounts.*`. Swapping the vault for
an SDK client **removes an invariant** and replaces enforcement-by-construction with
enforcement-by-convention.

- **Mitigation:** a single `TradingGate` module, plus an automated test/lint asserting no SDK
  mutation method name appears outside it and that `apps/web` never imports mutation-bearing
  services directly. Add the assertion **in the same PR** that introduces the SDK client.
- **Residual:** reviewer discipline for new files; mitigated but not eliminated.

## R-04 — XSS becomes session/account takeover · High

A live bearer token changes the blast radius of any XSS from "someone can read public market
data" to "someone can read and (once Stage 7 exists) act on the account". The app currently has
a strong CSP (`script-src 'self'`, no inline scripts) and no third-party analytics — preserve
both. Adding any third-party script is a security regression.

- **Mitigation:** keep `script-src 'self'`; keep third-party embeds at zero; if a wallet
  iframe/relay is required, allowlist the exact origin, never `*`; render untrusted strings
  (usernames, labels, symbols) as text, never HTML.
- **Residual:** dependency compromise (`@connectrpc`, `viem`, `centrifuge`, `permissionless`)
  — all become production dependencies with the SDK.

## R-05 — Session token persisted where it should not be · High

- **Mitigation:** use the SDK default `createMemoryAuthTokenStorage()`. Do **not** call
  `createCookieAuthTokenStorage()`: this is a static SPA with no SSR, so the only benefit is
  surviving reload, and the cost is a bearer token exposed to any XSS and to any subdomain
  cookie-sharing misconfiguration.
- Never in `localStorage`, `sessionStorage`, `window.name`, URL, `VITE_*`, telemetry, error
  reports, or console output.
- A test asserting "no cookie named `polyester_auth_token` exists after login" is cheap and
  worth having.
- **Residual:** in-memory tokens are lost on reload — an accepted UX cost, not a bug.

## R-06 — CSP must widen · Medium

Current policy (`apps/web/public/_headers`, `packages/core/src/deploymentSecurity.ts`):
`connect-src 'self' https://api.coingecko.com https://api.testnet.polyester.com https://*.workers.dev`
and `frame-src 'none'`, `script-src 'self'`.

Wallet-first needs, depending on stage:

| Addition | Needed for | Stage |
|---|---|---|
| (none) | injected EIP-1193 provider — CSP does not govern extension injection | 2a |
| `https://api.testnet.polyester.com` | already allowed | 2b |
| `wss://api.testnet.polyester.com` | Centrifuge realtime | 3/7 |
| `https://rpc.polyester.live`, `bundler…`, `paymaster…` | smart-account ops | 7 only |
| `frame-src` + `connect-src` for a WalletConnect relay | iframe/mobile wallets | only if required |

- **Mitigation:** widen **only** per stage, only for the exact hosts observed, and record why in
  the security doc each time. Prefer injected providers (no CSP change) over WalletConnect
  (relay + iframe allowlist). Avoid `https://*.polyester.live` wildcards where a hostname will do.
- **Residual:** each added origin is a new trust relationship.

## R-07 — No mainnet → misleading product claims · High (product)

The SDK ships only devnet (888168) and testnet (888169). There is no mainnet environment,
endpoint, or chain. A "full dapp" on mainnet cannot be delivered on this SDK today, and
`createPolyesterEnvironment` would require operator-supplied contract addresses that do not
exist publicly.

- **Mitigation:** the UI must say testnet, everywhere, derived from data (the existing
  `apiEnv` badge pattern) rather than hardcoded optimism. Do not use the word "mainnet" in any
  wallet-first surface.
- **Residual:** cannot be fixed by code.

## R-08 — Schema drift between SDK and friendly REST · Medium

Two different contracts now describe the same account data:

- friendly REST: `/v1/balances` etc., `ACCOUNT_CONTRACT_VERSION = "friendly-rest@b34853cb…"`
  (`packages/core/src/account/rest.ts:13`), validated by `account/normalize.ts` (614 L).
- SDK: ConnectRPC, valibot-validated protobuf messages.

Neither proves the other. Field names, nullability, decimal representation, and cursor
semantics may differ (the repo already discovered one real drift: live fills returned a pair
string `BTC-USDT` in `symbol` rather than only `symbolId` —
`docs/live-testnet-verification-report.md` §3).

- **Mitigation:** boundary validation at the adapter; `SCHEMA_INCOMPATIBLE` on mismatch;
  never `?? 0`. Add the same class of fixture tests that already exist for the REST path.
- **Residual:** only live verification closes this.

## R-09 — Silent zeroing / incomplete history as complete · High

The repository has an unusually strong honesty model (`coverage.ts`, `coverage.status` ∈
`complete|filter-complete|partial|stale|denied|blocked|unavailable`, `cursorExhausted`,
`stoppedAtCap`, `openingBasis`, `nonFillFlows`). A new adapter that returns `null`/`0` instead
of `unavailable` would quietly break it — and an incomplete fill set silently corrupts P&L.

- **Mitigation:** the `AccountReadClient` contract requires a populated `Coverage`; a test per
  dataset asserting `unavailable` (not `0`) on a missing field; the P&L gate refuses to compute
  on `partial` coverage (existing behaviour — keep it).
- **Residual:** none if the contract is honoured; it is a discipline risk.

## R-10 — Wallet provider spoofing / phishing-shaped UI · Medium

An injected provider object can report any address; a malicious extension can imitate a wallet.
Since Stage 2a displays an address but authorizes nothing, impact is bounded — **provided** the
UI never implies "verified" from connection alone.

- **Mitigation:** connection is labelled as connection, not sign-in; the signed-in state is only
  ever set by a successful SIWE exchange; show `accountId`/username from the server, not from
  the wallet; never display a truncated address as an identity credential.

## R-11 — Realtime gaps misread as live truth · Medium

The SDK's own docs state the subscription return value "does not mean the channel is open",
`onOpen` may fire again after reconnect, and delivery across a disconnect is **not** guaranteed
— applications "must reconcile after connection gaps".

- **Mitigation:** any streaming UI must reconcile with a full fetch on every `onOpen` after the
  first, and display last-updated time. Never assume a gap-free timeline. Stage 7 only.

## R-12 — Clock skew and replay · Low

Existing protections are sound: monotonic timestamp allocator, skew derived from the *unsigned*
catalog `tsSec`, bounds-checked, `TIMESTAMP_SKEW` typed error. Wallet/session path inherits the
same server-side check.

- **Mitigation:** keep the monotonic allocator for the key path; do not introduce a second,
  independent clock source for the session path.

## R-13 — Credential leakage in logs/telemetry/preview · High

`lib/telemetry.ts` exists; previews are shared and proxied. A token or signature in a log is a
compromise.

- **Mitigation:** never log request headers, tokens, signatures, message bodies, or raw private
  responses; keep the existing `SafeAccountError` shape (code/operation/correlationId only, no
  values); do not use the Arena preview or a shared dev server for any real testnet key
  (`docs/account-live-verification.md` §1).

## R-14 — Verification evidence is second-hand · Medium

The only live evidence in the repository (`docs/live-testnet-verification-report.md`) is
attributed to a local agent, was not re-run here, and references a commit (`3f179d5`) that does
not resolve. Browser-origin CORS, permission scope, and pagination completeness remain
**unverified**.

- **Mitigation:** treat all live claims as unverified until Stage 6 produces first-party
  evidence; keep the UI's "unverified" language until then.

---

## Deliberate non-mitigations (things I recommend *not* doing)

| Tempting fix | Why not |
|---|---|
| Add a backend proxy to hold the session token | Destroys the property that the user holds their own session; puts a bearer token on a server; adds infrastructure with no demonstrated need. Explicitly rejected by the brief. |
| Move the token to `localStorage` for convenience | Direct contradiction of the brief's non-negotiable rule. |
| Cache private responses in IndexedDB for speed | Would create durable, unauthenticated-at-rest copies of account data and reopen R-02 permanently. |
| Widen CSP to `https://*.polyester.com` | Unnecessarily broad trust. Use exact hosts. |
| Ship Stage 7 early "because the SDK supports it" | Removes the read-only invariant before it has a replacement (`R-03`). |
| Delete the API-key vault once login works | Removes the only live-verified path; breaks machine clients; violates the brief's parity precondition. |
