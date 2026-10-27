# 02 — Official SDK capability audit

**Exchange:** Polyester (non-custodial cross-chain spot exchange, operated by Fabric Labs /
Fabric Blockchain Labs Inc.)
**SDK package:** `@polyester/sdk`
**Installed / pinned version:** `0.31.0` (also npm `latest`)
**Official repository:** `Fabric-Labs/polyester-sdk-typescript`
**Official docs:** `https://testnet.polyester.com/docs/developer-docs/getting-started` (from `README.md`)

**Method:** the package was installed into a scratch directory **outside this repository**
(`/tmp/sdkaudit`) and its shipped `dist/*.d.ts`, `dist/*.js`, `README.md`, `LICENSE`, and
`SECURITY.md` were read. No private request was made. Where the SDK's own declarations are
the only evidence, that is stated. Where a live behaviour would be required to confirm
something, it is marked **Unknown** rather than assumed.

> **Evidence-level legend**
> **Verified** — direct, unambiguous code/type/test/doc evidence in the shipped package.
> **Partially verified** — supported, but an important constraint or unproven link remains.
> **Unsupported** — the shipped package contains no such capability.
> **Unknown** — shipped evidence is insufficient; would require a live account to settle.

---

## 1. Package identity and composition

| Item | Value | Source |
|---|---|---|
| Name / version | `@polyester/sdk@0.31.0` | `package.json` |
| Module format | ESM only (`"type": "module"`) | `package.json` |
| Licence | **`UNLICENSED`** — see note below | `package.json` |
| Licence text | *"No license is granted to copy, modify, distribute, sublicense, or use this work except under a separate written agreement with Fabric Blockchain Labs Inc."* | `LICENSE` |

> **Licence update (2026-10-27).** A Polyester team member stated in chat: *"You're fine to use it to
> build bots and trade on Polyester, which is what it's for."* This is good-faith clearance and is
> treated as **accepted risk** for Stage 2b onwards. It is not the "separate written agreement" the
> LICENSE contemplates, and it does not explicitly cover redistributing SDK code to third-party
> browsers. See [`08_OPEN_QUESTIONS.md`](./08_OPEN_QUESTIONS.md) Q3. **Re-check the licence text at
> every SDK version bump.** |
| Runtime deps | `@bufbuild/protobuf 2.13.0`, `@connectrpc/connect 2.1.2`, `@connectrpc/connect-web 2.1.2`, `@noble/ed25519 3.1.0`, `@noble/hashes 2.2.0`, `centrifuge 5.7.0`, `permissionless 0.3.7`, `valibot 1.4.2`, `viem 2.55.10` | `package.json` |
| Subpath exports | `.`, `./catalogs`, `./smart-account`, `./server-session`, `./account-signer`, `./services/*`, `./unstable/gen`, `./unstable/gen/*`, `./unstable/wired-services`, `./errors` | `package.json` |

**Interpretation that matters for architecture:** `@connectrpc/connect-web` means the SDK's
data plane is **ConnectRPC over HTTP**, not the `/v1/…` friendly REST that PolyTools
hand-rolls today. `permissionless` + `viem` mean **Safe smart accounts / ERC-4337**.
`centrifuge` means **WebSocket realtime** via a third-party protocol. A TypeScript SDK does
**not** eliminate HTTP APIs or the services behind them — it wraps ConnectRPC endpoints plus
an optional bundler/paymaster/RPC trio.

### 1.1 Environments — there is no mainnet

`dist/environment.d.ts` exports exactly two constants: `POLYESTER_DEVNET_ENVIRONMENT` and
`POLYESTER_TESTNET_ENVIRONMENT`. There is **no** mainnet constant, endpoint, chain, or export.

Resolved values (executed `import("./dist/environment.js")`):

| Field | DEVNET | TESTNET |
|---|---|---|
| `name` | `polyester-devnet` | `polyester-testnet` |
| `apiUrl` | `https://api.devnet.polyester.com` | `https://api.testnet.polyester.com` |
| `websocketUrl` | `wss://api.devnet.polyester.com` | `wss://api.testnet.polyester.com` |
| `rpcUrl` | `https://rpc.polyester.tech` | `https://rpc.polyester.live` |
| `chain.id` | `888168` | `888169` |
| `chain.name` | Polyester Chain Devnet | Polyester Chain Testnet |
| `accountAbstraction.bundlerUrl` | `https://bundler.polyester.tech` | `https://bundler.polyester.live` |
| `accountAbstraction.paymasterUrl` | `https://paymaster.polyester.tech` | `https://paymaster.polyester.live` |
| `entryPoint` | `0x59a4B77766509c4507D79eFF8089474eC3daC174` v0.7 | `0x35c524a72ffb4D348d616cDD340D176c8f3C8B2C` v0.7 |
| `contracts.tradingGatewayAddress` | `0xD3fecf5D39131e23b6B0f872cA0a21c8A5a30932` | `0x20ef1BCeE69D73Ce1649E688dAA9A7AcF441f0EE` |

Note `api.testnet.polyester.com` is the **same origin** PolyTools already calls directly —
but over a different protocol (ConnectRPC vs friendly REST).

`createPolyesterEnvironment(...)` exists for custom deployments, so a future mainnet *could*
be configured — but its contract addresses, entry point and Safe deployment would have to be
supplied by the operator. **No mainnet values are shipped: this is Unsupported, not Unknown.**

---

## 2. Capability matrix

The brief's required table, with evidence and verdicts.

| Capability | Verdict | Evidence |
|---|---|---|
| **Wallet connection** | **Partially verified** | The SDK does **not** connect wallets. It consumes an `AccountSigner` you supply (`dist/account-signer/types.d.ts`). Wallet discovery/injection/WalletConnect is entirely the host app's job. The SDK never touches `window.ethereum`. |
| **Wallet authentication** | **Verified** | SIWE challenge → signature → bearer session. `AuthService.createWalletChallenge`, `AccountSignerAuthService.login`. Full flow in §3. |
| **Session lifecycle** | **Verified** | `restoreSession`, `refreshSession`, `logout`, `handleRejectedToken`, `getSessionTimeToExpiry`, `hydrateAuthState`, `getState`. Details in §4. |
| **Public market data** | **Verified** | `marketOverview.list`, `orderbook.get`, `candles.list`/`listColumnar`/`listColumnarInts`, `marketData.listTrades`/`getSpotConfig`, `heatmap.getOrderbookHeatmap`, `zipper.getDepositWithdrawConfig`, `chainAnalytics.get*`. No auth required for these services (`PublicApiTransports`). |
| **Private account data** | **Verified** | `balances.list`, `balances.getBalanceHistory`, `balances.getEquityHistory` / `getPortfolioEquityHistory` / `getPortfolioEquitySnapshot`, `orders.listOpen`, `accounts.resolve`. |
| **Trading history** | **Verified** | `orders.listHistory`, `orders.getDetails`, `trades.list` (user fills), `balances.getBalanceHistory`. Pagination via opaque tokens — see §5.4. |
| **Fees** | **Partially verified** | `fees.getSpotRates` returns **effective current rates only** ("effective maker and taker spot fee rates … optionally filtered by market identifier"). Actual historical/executed fees must come from fills. Same limitation PolyTools already documents. |
| **Transfers** | **Verified** | `transfers.list` (read), `internalTransfers.create`, `tradingWithdraws.*`, `deposit.*`. `TRANSFER_REASON_LABELS` in the repo already mirror the SDK ledger codes. |
| **Trading actions** | **Verified (capability only — not exercised)** | `orders.preview`/`create`/`batchCreate`/`cancel`/`batchCancel`/`modify`/`batchReplace`/`cancelAll`/`cancelAllAfter`/`getDetails`/`getBatchReplaceStatus`; `triggers.*` (stop/take-profit/trailing/TWAP/ladder). |
| **Cross-chain tools** | **Partially verified** | `zipper.getDepositWithdrawConfig` returns chains, unified assets, chain-specific variants, network fees, min amounts, contract metadata. **No route listing or route comparison method** — PolyTools' `list_asset_routes` / `compare_deposit_routes` have no SDK equivalent. |
| **Rate limits** | **Partially verified** | `tradingRateLimits.getConfig()` (public VIP0+ quota catalog) and `.getTradingLimits()` (authenticated effective limits). Error surface includes `RATE_LIMITED`. **No documented numeric limits ship in the package** — values are fetched at runtime. |
| **API keys** | **Verified: optional** | Two auth providers: `JwtAuthProvider` (session) and `ApiKeyEd25519AuthProvider`. `apiKeys.list/get/create/delete/update/generateKeypair`. Machine clients use keys; browser users need not. |

### 2.1 Direct answers to the brief's specific warnings

- **"Do not infer private-account access from a wallet address alone."**
  Correct, and the SDK does not invite that mistake. The owner EOA address is **not** the
  account identity. Access is granted by a **server-issued SIWE challenge** that binds
  `smartAccountAddress` + `signerAddress` and a bearer token minted by the auth backend. See §3.

- **"Determine whether the exchange associates the connected wallet with an exchange account,
  and how."**
  Yes — established **server-side, in the challenge**. `CreateWalletChallengeInput` requires
  both `smartAccountAddress` and `signerAddress`; the server returns a SIWE `message`. The
  backend sets *SIWE Chain ID to Ethereum mainnet (1)* and binds the Polyester chain in
  `Resources`. Exchanging a valid signature returns `{accessToken, accountId, username,
  expiresAt}`. **The wallet→account association is therefore proven by the server, not
  asserted by the client.**

- **"Do not assume a TypeScript SDK eliminates HTTP APIs."**
  Confirmed: ConnectRPC over `api*.polyester.com`, plus optional RPC/bundler/paymaster, plus
  Centrifuge WebSocket for realtime. Explicitly not a local computation.

---

## 3. Wallet authentication — the exact verified flow

### 3.1 The primitive: `AccountSigner`

`dist/account-signer/types.d.ts`:

```ts
interface AccountSigner {
  readonly environmentFingerprint: string;   // binds signer to one PolyesterEnvironment
  readonly accountAddress: HexAddress;       // the Polyester SAFE smart account (auth + trading)
  readonly ownerAddress?: HexAddress;        // owner EOA; declared as LOGIN challenge signer
  signMessage(message: string): Promise<Hex>;// exact UTF-8 message, EIP-191
}
```

Two hard constraints, stated verbatim in the source:

1. For **login**, `signMessage` must return the **owner EOA's raw 65-byte EIP-191 signature** —
   *"login rejects Safe/ERC-6492 wrapped signatures."*
2. Login SIWE uses **Ethereum mainnet (1)**; wallet adapters must switch network before
   signing when required (the doc names Phantom explicitly). This does **not** change the
   Polyester environment used for Safe signing.

`createPolyesterAccountSigner({environment, owner: LocalAccount, saltNonce?})` derives the Safe
address **with no RPC calls**, but its own `signMessage` produces ERC-6492 **wrapped**
signatures — usable for subaccount creation, **rejected for login**. The README quickstart
therefore uses it only to obtain `accountAddress`, then hand-builds an `AccountSigner` whose
`signMessage` calls the owner directly:

```ts
const { accountAddress } = createPolyesterAccountSigner({ environment, owner });
const accountSigner: AccountSigner = {
  environmentFingerprint: environment.fingerprint,
  accountAddress,
  ownerAddress: owner.address,
  signMessage: (message) => owner.signMessage({ message }),  // raw owner EIP-191
};
```

### 3.2 The flow

| Step | SDK call | Evidence |
|---|---|---|
| 1 | `auth.login({ provider, uri?, loginMethod? })` | `dist/services/auth/account-signer-auth.js:84` |
| 2 | internally → `createWalletChallenge({ smartAccountAddress, signerAddress, uri })` → `{ message, expiresAt }` | `auth.js:84`; `auth.d.ts` |
| 3 | `accountSigner.signMessage(message)` — sign the **exact UTF-8 bytes** with `personal_sign`; do not hash or reconstruct | `auth.js:90` |
| 4 | internally → `loginWithWallet({ smartAccountAddress, message, signature, walletProvider, userAgent?, ip? })` → `{ accessToken, expiresAt, accountId, username }` | `auth.js:91`; `auth.d.ts` |
| 5 | `AuthSessionStore.commitLogin(...)` persists session state + token | `session.d.ts` |
| 6 | emits `authenticated: { accountId, username }` | `AccountSignerAuthEvents` |

- `uri` must be an **HTTP(S) origin with no path/query/fragment/userinfo**; ≤2048 chars.
  Defaults to `location.origin` in browsers; **required** outside browsers.
- Signature must be **65-byte hex**; message ≤4096 UTF-8 bytes.
- `loginWithWallet` is declared **`protected`** on `AuthService` — third parties must go
  through `login()`, not call the exchange step directly.

### 3.3 Supported login methods — and the ambiguity

```ts
type AuthLoginMethod = "google" | "email" | "metamask" | "rabby" | "phantom" | "walletconnect";
// LoginOptions.provider:
type provider = "metamask" | "phantom" | "turnkey" | "other";
```

Wallet-branded (`metamask`, `rabby`, `phantom`, `walletconnect`) and non-wallet
(`google`, `email`, `turnkey`) values coexist. **Every** `login()` path still requires an
`AccountSigner.signMessage`, so even social logins resolve to a signer (presumably
Turnkey-managed). **Unknown:** whether `google`/`email` logins are usable from a third-party
app with only a host-supplied `AccountSigner`, or require a Turnkey iframe/relay that the
host does not possess. This is an open question (Q4).

---

## 4. Session lifecycle

`AccountSignerAuthService extends AuthService` (`dist/services/auth/account-signer-auth.d.ts`):

| Concern | API | Verified behaviour |
|---|---|---|
| Restore on load | `restoreSession(): Promise<{accountId, username} \| null>` | Loads stored token, **validates it still belongs to this environment** (environment fingerprint), restores state if possible |
| Expiry | `getSessionTimeToExpiry(): number` (ms remaining); `LoginResult.expiresAt: Date` | Token is a JWT with `expiresAt` |
| Refresh | `refreshSession({uri?, provider?, loginMethod?})` | Re-signs an account-switch flow and re-persists auth state — **requires the signer**, i.e. a wallet prompt |
| Logout | `logout(): Promise<void>` | Clears stored auth state **and removes the persisted token** |
| Forced invalidation | `handleRejectedToken(token)` | Called when the backend rejects a token as unauthenticated (revoked, or expired despite local clock lag). Ignored if the token was replaced or a login/refresh is in flight. **Browser clients call this automatically.** |
| Account switching | `switchAccount(accountId, {smartAccountAddress?, label?})` | Signs the account-switch flow; returns `{accountId, isMain}` |
| Subaccounts | `createSubaccount({accountSigner \| factory, label?, uri?, ownerAddress?})` | Accepts **either** ERC-6492 or raw form; `challenge.smartAccountSaltNonce` may derive the signer (e.g. Turnkey) |
| Observability | `events`: `authenticated`, `loggedOut`, `error`, `servicesReady`, `stateChange`; `getState(): AuthState` | `AuthState = {isAuthenticated, accountAddress, ownerAddress, mainAccountId, activeAccount}` |
| SSR hydration | `hydrateAuthState(AuthHydrationData)` | Avoids flash of unauthenticated content |

### 4.1 Token storage — the security-relevant choice

`dist/services/auth/token-storage.d.ts` + `browser-core.d.ts`:

```ts
type PolyesterBrowserClientConfig = Omit<PolyesterClientBaseConfig,"auth"> & {
  accountSigner?: AccountSignerConfig;   // signer instance or async factory
  tokenStorage?: AuthTokenStorage;       // default: PER-CLIENT MEMORY
};
```

- **Default is `createMemoryAuthTokenStorage()`** — the bearer token lives in the client
  instance's memory, survives no reload. This is the safest default and matches the brief's
  "minimize session-token exposure".
- `createCookieAuthTokenStorage({cookieName?, path?, secure?, sameSite?})` opts into
  persistence for reload/SSR. Cookie constants: **`polyester_auth_token`** (bearer) and
  **`polyester_session_4`** (unsigned display data).
- The SDK's own README is explicit: the display cookie *"is not proof of authentication. The
  backend still verifies the bearer token and authorizes every call."* And `ServerSessionSnapshot`
  docs: *"Display-session fields are unsigned and must not be used for authorization."*
- `createMemoryAuthTokenStorage` / `createCookieAuthTokenStorage` / `parseServerSessionSnapshot`
  are all exported at the package root.

### 4.2 Client classes

| Class | Config | Purpose |
|---|---|---|
| `PolyesterBrowserClient` / `PolyesterBrowserCore` | `{environment, accountSigner?, tokenStorage?, interceptors?, wireFormat?, fetch?, catalog?}` | Browser. `get auth(): AccountSignerAuthService`; `setAccountSigner(signer \| null)`; no `auth` in config (it is derived) |
| `PolyesterClient` / `PolyesterCore` | `{environment, auth?: JwtAuthProvider \| ApiKeyEd25519AuthProvider, …}` | Base. Lazy memoized service getters |
| `PolyesterServerClient` | `createPolyesterServerClientFromRequest` / `…FromCookies` | SSR; reads cookies off an incoming request |

`PolyesterCore` builds everything **lazily and memoizes**, explicitly so per-SSR-request
construction stays cheap. `wireFormat` defaults to `binary` (`json` for debugging).
`catalog`/`catalogSnapshot`/`catalogCell` allow a client-owned or externally-hydrated catalog.

---

## 5. Service inventory (29 services) and methods

Extracted from `dist/client.d.ts` `POLYESTER_SERVICES` and each `dist/services/*/*.d.ts`.

| Service | Methods |
|---|---|
| `accounts` | `resolve({query, hint?, includeSubaccounts?})` → `{smartAccountAddress, kind: root\|sub, rootUsername?, subaccountLabel?, accountId}` |
| `apiKeys` | `list`, `get`, `create`, `delete`, `update`, `generateKeypair`, `subscribe` |
| `subaccounts` | create-challenge / create / update / list / members / invites / roles / permissions / activity / events |
| `candles` | `list`, `listColumnar`, `listColumnarInts`, `subscribe`, `subscribeInts` |
| `chainAnalytics` | `getZippedAssetSupply`, `getZippedAssetSupplyGroup`, `getUnifiedAssetBalances` |
| `marketData` | `listTrades`, `getSpotConfig`, `subscribeTrades` |
| `marketOverview` | `list`, `getSpotVolumeHistory`, `getCurrencyConversionConfig`, `getCurrencyConversionRates`, `subscribe` |
| `orderbook` | `get`, `subscribe`, `createSubscription` |
| `heatmap` | `getOrderbookHeatmap`, `subscribeLive` |
| `lifecycle` | `listFlows`, `getFlow`, `listFlowsByTx`, `subscribeOpenFlows`, `subscribeFlowDetail` |
| `trades` | `list` (**user** fills), `subscribe` |
| `orders` | `listOpen`, `listHistory`, `preview`, `create`, `batchCreate`, `cancel`, `batchCancel`, `modify`, `batchReplace`, `getBatchReplaceStatus`, `cancelAll`, `cancelAllAfter`, `getDetails`, `subscribe` |
| `triggers` | `create`, `get`, `list`, `cancel`, `modify`, `pause`, `resume`, `listEvents`, `subscribe`, `subscribeEvents` |
| `balances` | `list`, `getBalanceHistory`, `getEquityHistory`, `getPortfolioEquityHistory`, `getPortfolioEquitySnapshot`, `subscribe` |
| `transfers` | `list`, `subscribe` |
| `internalTransfers` | `create` |
| `tradingWithdraws` | `validateDestination`, `createToFunding`, `prepareToFunding`, `createToExternalChain`, `prepareToExternalChain` |
| `deposit` | `createAddress`, `listAddresses` |
| `addressBook` | list/create/update/delete entries, tags, views, whitelists, counterparties |
| `guardSigner` | status, approvals, rotate |
| `socialVerification` | start/verify/get |
| `whiteboard` | boards, ACL, join tokens, snapshots |
| `zipper` | `getDepositWithdrawConfig`, `subscribeZippedAssetSupply` |
| `mfa` | factors, enroll/verify TOTP & passkey, recovery codes, step-up |
| `claims` | claim flows |
| `rewards` | awards, destination |
| `vip` | status, tiers |
| `fees` | `getSpotRates` |
| `tradingRateLimits` | `getConfig`, `getTradingLimits` |

### 5.1 Treeshaking

`PolyesterCore` exposes **only** `realtime`, `catalog`, `auth`. Every other service is reached
either through `PolyesterClient`'s getters or, for smaller bundles, via
`@polyester/sdk/services/*` accessor functions (`ordersService(core)`, …). Relevant to the
Vite build-performance budget PolyTools enforces.

### 5.2 Realtime

Centrifuge-backed. `connect`/`subscribe` APIs; `onOpen` "can run again after a successful
reconnect"; **the subscription return value does not mean the channel is open**, and delivery
across a disconnect is not guaranteed — *"applications that require continuity must reconcile
after connection gaps."* This is a meaningful constraint on any "live" UI.

### 5.3 Error model

`@polyester/sdk/errors` exports a typed hierarchy with codes including: `UNAUTHENTICATED`,
`PERMISSION_DENIED`, `TIMESTAMP_SKEW`, `RATE_LIMITED`, `STALE_QUOTE`, `REVISION_CONFLICT`,
`SESSION_ELEVATION_REQUIRED`, `STEP_UP_REQUIRED`, `MFA_REQUIRED`, `MFA_ENROLLMENT_REQUIRED`,
`MFA_LAST_FACTOR_REQUIRED`, `POLICY_LOCKED`, `POLICY_IN_USE`, `POLICY_SCOPE_MISMATCH`,
`PRECONDITION_FAILED`, `RESOURCE_NOT_FOUND`, `ALREADY_EXISTS`, `TIMEOUT`, `NETWORK_ERROR`,
`SERVICE_UNAVAILABLE`, `TRANSIENT_FAILURE`, `NOT_IMPLEMENTED`, `INVALID_CONFIGURATION`,
`VALIDATION_FAILED`, `INTERNAL_SERVER_ERROR`, `REALTIME_ERROR`, `SUBACCOUNT_CHALLENGE_INVALID`.
Helpers: `errorFromHttpStatus`, `isRetryableError`, `isAbortError`, `formatUserFacingError`,
`isSessionElevationRequiredError`, `isMfaRequiredError`, etc.

This is a richer and more honest error taxonomy than the repo's current `AccountErrorCode`
union — a good source of coverage ideas, though the two are not interchangeable.

### 5.4 Pagination and ordering

The SDK returns **opaque page tokens** in its outputs (e.g. `lifecycle.listFlows` returns an
`output` that *"includes an opaque next page token"*, ordered by the selected timestamp).
**Partially verified:** the per-method ordering/cursor semantics for `orders.listHistory`,
`trades.list`, `balances.getBalanceHistory` and `transfers.list` are **not** individually
documented in the shipped declarations. PolyTools' existing cursor discipline
(`collectCursorPages`, repeated-cursor detection, caps) must be retained and re-verified
against whichever SDK method replaces each friendly-REST call. This is the exact gap the brief
flags for F-07–F-11.

### 5.5 API keys in the SDK

`ApiKeyEd25519AuthProvider`:
```ts
auth: { kind: "api-key-ed25519", getKeyId: () => string|null, getSecretKey: () => bytes }
```
This confirms API keys remain **first-class and optional**, and that the SDK's Ed25519 key
model is compatible in spirit with PolyTools' existing signer. `apiKeys.generateKeypair`
exists, which could later replace the repo's home-grown key generation — but it does not
remove the out-of-band server registration step.

---

## 6. Capability verdicts the brief specifically asked about

| Question | Answer | Verdict |
|---|---|---|
| Does the SDK connect wallets? | No. Host supplies `AccountSigner`. | **Unsupported** (connection) |
| Does the SDK authenticate a wallet? | Yes — SIWE challenge + signature + bearer token. | **Verified** |
| Is wallet address alone sufficient for account data? | No. Server-issued challenge binds smart account + signer; a token is required. | **Verified** |
| Does the SDK cover historical execution fees? | No — `fees.getSpotRates` is current rates only. Actual fees must be derived from fills. | **Partially verified** |
| Does the SDK cover Zipper route comparison? | No method exists. | **Unsupported** |
| Does the SDK expose referral codes or builder codes? | **No.** Neither appears in Polyester's published [SDK capability matrix](https://testnet.polyester.com/docs/developer-docs/getting-started/sdk-capability-matrix) (31 capabilities listed) nor anywhere in the contract bundle. The matrix's "intentionally out of scope" list names only MFA and wallet login, so these are not merely API-key-SDK exclusions — they are **not in the documented product surface**. Exchange developers report both are **not live yet**. | **Unsupported** |
| Does the SDK expose MCP? | No. PolyTools' public tools have no SDK equivalent. | **Unsupported** |
| Does the SDK support mainnet? | No environment is shipped. `createPolyesterEnvironment` allows supplying one. | **Unsupported** (shipped values) |
| Can the SDK be used in a public web app? | Technically yes. `UNLICENSED`, but a Polyester team member has stated third-party use is fine. | **Partially verified** (informal clearance; not a written agreement) |
| Are API keys optional? | Yes for browser users; required for machine clients by convention. | **Verified** |
| Does the SDK permit mutation? | Yes — orders, cancels, transfers, withdrawals, triggers, subaccounts. | **Verified (capability)** |

---

## 7. Explicit non-claims

This audit did **not** establish, and the plan must not assume:

1. That a real wallet can complete `login()` against testnet today (no live request was made;
   no browser origin was used).
2. That the SDK's ConnectRPC responses contain the same fields as the friendly-REST responses
   PolyTools already validates (`docs/wire-samples/`). They are different contracts.
3. That `google`/`email` login works from a third-party origin (see §3.3).
4. That any Zipper route-comparison data is reachable without the MCP backend.
5. That mainnet exists in any SDK-shipped form.
6. That referral codes or builder codes are live. The exchange developers state they are **not live
   yet**; that is a relayed statement, not a published announcement, and no first-party launch notice
   for either mechanism — or for mainnet — was found (`09` §0).
7. That a **written** licence agreement exists. A Polyester team member has stated third-party use
   is acceptable (Q3), but the LLC-level written agreement the `LICENSE` contemplates has not been
   produced, and redistribution wording remains unaddressed.
