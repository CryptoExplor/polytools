# 04 — Target architecture

Target architecture for a wallet-first PolyTools dapp, expressed as **incremental boundaries**
that can each be adopted without breaking the verified baseline. Nothing here is implemented
yet.

Design constraints carried in from the brief and from the audit:

- `docs/build-reality-audit/` is user-owned and untouched.
- The existing API-key path stays fully functional until parity is proven.
- No backend proxy or database is introduced; none is needed (see `00` §3).
- No fabricated endpoints, methods, fields, or chains. Every SDK symbol named here exists in
  `@polyester/sdk@0.31.0` and is cited in `02_OFFICIAL_SDK_CAPABILITIES.md`.
- The SDK's `UNLICENSED` status and the absence of a mainnet environment are treated as hard
  gates, not footnotes.

---

## 1. Boundary map

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Browser (Vite + React SPA, static host)                                    │
│                                                                             │
│  ┌──────────────────────┐   ┌────────────────────────┐  ┌────────────────┐  │
│  │ WALLET LAYER         │   │ EXCHANGE-AUTH LAYER    │  │ KEY-MODE LAYER │  │
│  │ (new)                │   │ (new, flag-gated)      │  │ (existing)     │  │
│  │                      │   │                        │  │                │  │
│  │ WalletConnection     │   │ ExchangeSession        │  │ AccountVault   │  │
│  │  {status,address,    │──▶│  {status,accountId,    │  │ + Ed25519      │  │
│  │   chainId}           │   │   expiresAt,token}     │  │ + registeredId │  │
│  │                      │   │                        │  │                │  │
│  │ EIP-1193 provider    │   │ @polyester/sdk         │  │ hand-rolled    │  │
│  │ (viem / injected)    │   │ PolyesterBrowserClient  │  │ friendly REST  │  │
│  └──────────────────────┘   └───────────┬────────────┘  └───────┬────────┘  │
│            │                            │                       │           │
│            │  signMessage only          │                       │           │
│            └────────────────────────────┤                       │           │
│                                         ▼                       ▼           │
│                            ┌────────────────────────────────────────────┐   │
│                            │  ACCOUNT DATA LAYER  (shared)              │   │
│                            │  AccountReadClient interface               │   │
│                            │  ├─ SdkAccountReadClient     (new)         │   │
│                            │  └─ RestAccountReadClient    (existing)    │   │
│                            │                                            │   │
│                            │  AccountSessionOwner  (existing, extended) │   │
│                            │   per-range caches · 2-min freshness ·     │   │
│                            │   single-flight · stale guards · errors    │   │
│                            └────────────────────────────────────────────┘   │
│                                         │                                   │
│  ┌──────────────────────────────────────┼───────────────────────────────┐  │
│  │ PUBLIC DATA LAYER (unchanged)        │                               │  │
│  │  lib/api.ts → /api/* → backend facade → MCP                          │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                    ┌────────────────┴─────────────────┐
                    ▼                                  ▼
        api.testnet.polyester.com            polyester-mcp-testnet
        (ConnectRPC or friendly REST)        .fabriclabs.workers.dev (MCP)
```

**Key structural decision:** the account data layer talks to an **interface**, not to a
transport. That is what allows the vault path and the session path to coexist and be
differentially tested — and what makes rollback a one-line flag change.

---

## 2. Wallet and authentication

### 2.1 Two states that must never be conflated

```ts
type WalletState =
  | { status: "disconnected" }
  | { status: "connecting" }
  | { status: "connected"; address: `0x${string}`; chainId: number; provider: Eip1193 }
  | { status: "error"; reason: WalletErrorReason };

type ExchangeAuthState =
  | { status: "unauthenticated" }
  | { status: "authenticating" }
  | { status: "authenticated"; accountId: string; username: string;
      expiresAt: number; form: "session" | "api-key" }
  | { status: "expired" }
  | { status: "error"; code: string };
```

`WalletState.connected` **implies nothing about `ExchangeAuthState`.** Connecting a wallet
shows the address and enables the *option* to sign in. It must never unlock account data,
never populate a balance, never set a "logged in" affordance on its own. This follows directly
from the verified SDK contract: a server-issued SIWE challenge plus a bearer token is the only
proof (`02` §3). The app must not derive account identity from `address`.

### 2.2 State machine

```
                 connect()                    login()  [SIWE: challenge → sign → token]
disconnected ───────────────▶ connected ─────────────────────────────────────▶ authenticated
     ▲                            │  ▲                                              │
     │ disconnect()               │  │                                              │
     │                            │  └── accountsChanged / chainChanged ────────────┘
     │                            │         (see 2.3)                             │
     │                            │                                                │
     │                            └────────────────────────────────────────────────┘
     │                                    logout() / token rejected / expired
     └────────────────────────────────────────────────────────────────────────────────
```

### 2.3 Event obligations

Each event has an explicit, testable consequence. No event may leave stale private data
visible.

| Event | Source | Required consequence |
|---|---|---|
| `accountsChanged` | provider | Invalidate exchange session (the token belongs to the *previous* wallet). Wipe **all** private dataset caches. Reset `activated` to `false`. Abort in-flight loads. Require explicit re-login. |
| `chainChanged` | provider | Do **not** auto-relogin. The SIWE challenge binds a specific chain (Ethereum mainnet, chain 1, for signing) and the Polyester environment. Re-derive on next explicit login; invalidate session if the environment no longer matches. |
| `disconnect` (provider) | provider | Same as `accountsChanged` + clear `WalletState`. |
| `logout()` | user | Clear token, clear session state, wipe private caches, reset `activated`. |
| Token rejected (`UNAUTHENTICATED`) | SDK/backend | Mirror `handleRejectedToken()` semantics: end the session, clear caches, surface a single scoped error, do not retry blindly. |
| Session expired | `expiresAt` / `getSessionTimeToExpiry()` | Mark `expired`; keep the user on the page with an explicit "sign in again" action. Never auto-trigger a wallet prompt without a user gesture. |
| Vault boundary (`LOCK`/`WIPE`/`VAULT_CHANGED`/`IMPORT`/`UNLOCK`) | existing `vault.subscribe` | Existing behaviour preserved verbatim (`SESSION_BOUNDARIES` → `clearForVaultBoundary()`). |

**Rule:** `accountsChanged` must be treated exactly like `logout`. The SDK's own
`AuthSessionStore` is environment-fingerprinted but is **not** wallet-fingerprinted; a token
minted for wallet A will still be presented while wallet B is connected unless the app
invalidates it. This is a data-leak vector, and it is the single highest-severity logic risk in
the migration (see `06` R-02).

### 2.4 What the app must supply that the SDK does not

The SDK requires an `AccountSigner` but performs **no wallet discovery**:

1. Wallet detection/connection — recommend **viem** `createWalletClient` over an injected
   EIP-1193 provider, or a WalletConnect path if iframe wallets are required (CSP implications,
   `06` R-06).
2. Smart-account derivation — `createPolyesterAccountSigner({environment, owner})` gives
   `accountAddress` **offline, with no RPC**. Do not call the bundler for this.
3. Raw EIP-191 signing — `signMessage` must return the **owner EOA's raw 65-byte signature**,
   *not* the ERC-6492 wrapped form that `createPolyesterAccountSigner` produces. Build the
   `AccountSigner` by hand, as the official README shows.
4. Chain selection before signing — switch the wallet to Ethereum mainnet (1) if the provider
   requires it, and switch back afterwards.

### 2.5 Environment gating

Only `POLYESTER_TESTNET_ENVIRONMENT` is relevant. `POLYESTER_DEVNET_ENVIRONMENT` targets
different contracts and must not be reachable from a production build. Guard with an explicit
allowlist constant, not a `process.env` string, and assert `environment.fingerprint` equals the
expected value at boot. A wrong fingerprint silently invalidates sessions (`restoreSession`
validates environment) — which is safe, but confusing if unlabelled.

---

## 3. Data layer

Three sources, three lifetimes, **never mixed in one cache**:

| Source | Lifetime | Cache policy | Storage |
|---|---|---|---|
| **Public market** | minutes | existing `PublicDataCache` (IndexedDB) + backend TTL | durable, non-sensitive |
| **Private exchange-account** | seconds | `AccountSessionOwner` per-range, in memory | **memory only** |
| **On-chain** | n/a today | none | — |

### 3.1 `AccountReadClient` — the seam

Introduce an interface modelled on the datasets that already exist, so `AccountDataCoordinator`
(869 L) and every consumer stay unchanged:

```ts
interface AccountReadClient {
  readBalances(p, signal): Promise<AccountDataset<BalancesData>>;
  readBalanceHistory(p, signal): Promise<AccountDataset<BalanceHistoryData>>;
  readEquityHistory(p, signal): Promise<AccountDataset<EquityData>>;
  readOpenOrders(p, signal): Promise<AccountDataset<OpenOrdersData>>;
  readOrderHistory(p, signal): Promise<AccountDataset<OrdersData>>;
  readOrderDetails(p, signal): Promise<AccountDataset<OrderDetailsData>>;
  readFills(p, signal): Promise<AccountDataset<FillsData>>;
  readTransfers(p, signal): Promise<AccountDataset<TransfersData>>;
  readFeeRates(p, signal): Promise<AccountDataset<FeeRatesData>>;
  readAuthContext(p, signal): Promise<AccountDataset<AuthContextData>>;
}
```

- `RestAccountReadClient` — today's `AccountRestClient`, unchanged.
- `SdkAccountReadClient` — new; maps `balances.list` → `BalancesData`, `trades.list` →
  `FillsData`, `orders.listOpen`/`listHistory`/`getDetails`, `transfers.list`,
  `fees.getSpotRates`, `auth.me`-equivalent via `client.auth.me()`.

**Non-negotiable:** each mapping must populate `retrievedAtMs`, `coverage`, and exact decimal
strings. If an SDK field cannot be mapped faithfully, the dataset must be marked
`coverage.status = "unavailable"` — never coerced to zero or to an empty success.

### 3.2 Preserved safeguards (unchanged, re-pointed)

All PR #6 behaviour is preserved and now applies to **both** clients:

| Requirement | Mechanism (existing, reused) |
|---|---|
| Explicit first read | `activated` gate; `load({explicit:true})` only from a user gesture |
| Two-minute visibility freshness | `ACCOUNT_DATA_FRESHNESS_MS = 2 * 60 * 1000`; `isRangeStale`; `shouldRefreshOnVisibility` |
| Manual-refresh override | `explicit:true` bypasses age gates |
| Per-period P&L cache isolation | `state.periods` keyed by `AccountHistoryRange` |
| Shared data across tabs/views | one `AccountSessionOwner` per session, `useSyncExternalStore` |
| Stale-response guards | `isCurrent()` checks generation + entryId + abort |
| View-scoped errors | `errors: Partial<Record<datasetKey, SafeAccountError>>` |
| No duplicate requests | single-flight keyed `${generation}:${entryId}:${range}` |

**Extension required for the session path:** the current key includes vault `generation` and
`entryId`. For session mode, extend the identity tuple to
`${authForm}:${accountId}:${walletAddress}:${range}` so that a wallet or account change
*necessarily* invalidates in-flight work. The guard must fail closed.

### 3.3 Runtime validation

`lib/publicDtos.ts` validates public responses today. The session path needs the equivalent:
the SDK already uses **valibot** internally and returns typed results, but a version bump or a
backend change can still surprise the UI. Keep a thin adapter validator at the boundary —
cheap, and it preserves the existing `SCHEMA_INCOMPATIBLE` failure mode instead of letting
`undefined` reach a chart.

### 3.4 Pagination, cancellation, ordering

- Reuse `account/pagination.ts` `collectCursorPages()`: opaque tokens, repeated-cursor
  detection, 1…10 000 page cap, validated-prefix partial results.
- Pass `AbortSignal` into every SDK call (`PolyesterRequestOptions` accepts one) so the existing
  abort-on-lock/abort-on-range-change behaviour carries over.
- **Ordering is re-verified per method, not assumed** — the SDK's per-method ordering semantics
  are not fully documented in the shipped declarations (`02` §5.4). Until verified, no UI may
  claim "complete history".

### 3.5 Rate limits

`tradingRateLimits.getConfig()` / `.getTradingLimits()` give real limits; `RATE_LIMITED` is a
typed error. The existing bounded retry (`maxRetries`, `retryBaseDelayMs`, retry only
temporary GET failures) is retained. **Never retry** `UNAUTHENTICATED`, `PERMISSION_DENIED`,
`TIMESTAMP_SKEW`, `SIGNATURE_INVALID`, or schema failures — that rule already exists in the
REST client and must be mirrored.

---

## 4. Analytics

Every number on screen must be attributable. Four labels, and no silent promotion between them:

| Label | Meaning | Current examples |
|---|---|---|
| **Exchange-reported** | literally returned by the exchange | balances, open orders, fills, transfers, current fee rates, equity samples |
| **Calculated by PolyTools** | derived, with a visible method | FIFO / moving-weighted-average cost basis; portfolio valuation from marks; premium/discount bps |
| **Estimated / incomplete** | partial coverage, unresolved flows, carried-forward basis | any dataset with `coverage.status` in `partial`/`stale`, or `openingBasis` `carried-forward`/`unknown` |
| **Unsupported** | not computed, and why | verified P&L; historical fees; cross-chain unrealized P&L |

Rules:
- **Portfolio valuation** requires both quantity (exchange) and mark (public). If the mark is
  stale, the valuation is labelled estimated. Never mix a fresh mark with a stale quantity
  without a label.
- **Realized P&L** only after complete fills, opening basis, and resolved flows — the existing
  gates in `lots.ts` / `AccountCostBasis.tsx`. Unrealized additionally requires fresh marks.
- **Fee analytics** only from actual fill records (per fee asset) or a verified calculation.
  `fees.getSpotRates` is a *current rate*, never a historical fee. Do not multiply a current
  rate by past volume and present it as fees paid.
- **Historical charts** must state coverage: requested vs observed window, gaps, sample
  interval. Equity samples are 5-minute buckets with server-chosen bounds; do not interpolate
  as if continuous.
- **Cross-chain** only where a source exists (`zipper.getDepositWithdrawConfig`,
  `chainAnalytics.getUnifiedAssetBalances`). No cross-chain P&L until the records exist.

---

## 5. Transactions

**Read-only first. This audit recommends not implementing any mutation in this programme's
first phases**, and the SDK licence gate (`00` B1) plus unverified live behaviour make any
earlier mutation unsafe.

When it is eventually considered:

1. **Structural read-only guard.** Today `READ_ONLY_OPERATIONS` (10 GETs) makes mutation
   *impossible*. An SDK client can reach `orders.create`, `tradingWithdraws.createToExternalChain`,
   `triggers.*`, `internalTransfers.create`. Replacing the vault **removes that property**.
   Mitigation: a thin `TradingGate` module that is the only place SDK mutation methods are
   referenced, plus a lint/test rule asserting no mutation method name appears elsewhere in
   `apps/web`. Without this, "read-only mode" is a marketing claim, not an invariant.
2. `orders.preview()` before submit — show pair, side, quantity, price, estimated fee, and the
   wallet/environment the order will hit.
3. **Explicit confirmation** per order; no persisted "don't ask again".
4. **Duplicate-submission prevention** — a single in-flight submission lock keyed by an
   idempotency/`requestId`; disable the control while pending. The SDK notes auto-generated
   mutation request IDs need `crypto.randomUUID`/`getRandomValues`.
5. **Reliable states**: `pending` (submitted, unconfirmed) → `accepted` / `rejected` / `failed`,
   driven by `orders.subscribe()` **with reconciliation on reconnect** (Centrifuge explicitly
   does not guarantee delivery across gaps; `onOpen` may fire again).
6. Never auto-retry a mutation.

---

## 6. Security

| Concern | Design position |
|---|---|
| Session token exposure | Use the SDK default **in-memory** `createMemoryAuthTokenStorage()`. Do **not** opt into `createCookieAuthTokenStorage()` without a written threat analysis: it puts a bearer token in a cookie readable by any XSS, and there is no server to render it for (this is a static SPA). |
| Never in localStorage/URL/logs | Same rule the vault already follows. The token must not appear in `VITE_*`, telemetry, error boundaries, or `window.name`. |
| Display vs auth | `polyester_session_4` is unsigned display data; the backend verifies the bearer token. The app must never gate a view on the display cookie. |
| Logout/invalidation | `logout()` clears token + state; `accountsChanged` behaves as logout; vault boundaries unchanged. |
| Cross-wallet/account leakage | The single largest risk. Fail-closed guards + explicit cache wipe on every identity change (`06` R-02). |
| Server secrets | None in the frontend. `VITE_API_BASE` only. Telegram secrets remain Worker secrets. |
| Infrastructure | **No** new backend, proxy, or database. A proxy would put a bearer token in the server's hands and destroy the "user holds their own session" property. |
| CSP | Current `connect-src` permits `'self'`, `https://api.coingecko.com`, `https://api.testnet.polyester.com` and `https://*.workers.dev` — so of the SDK's named endpoints, **only the testnet API** is already allowed (and the wildcard is a CSP concession, not an approval list). The SDK additionally needs `rpc.polyester.live`, `bundler.polyester.live`, `paymaster.polyester.live`, and `wss://api.testnet.polyester.com` for realtime; WalletConnect needs relay + iframes (`frame-src 'none'` currently blocks it). Every addition is a security decision, not a build fix (`06` R-06). |

---

## 7. What deliberately does **not** change

- All 11 public routes and their MCP-backed data path, backend facade, TTL cache, DTO validation.
- The entire API-key vault: encryption, storage, lock/wipe, idle timeout, cross-tab control.
- `AccountDataCoordinator`, `lots.ts`, `export.ts`, coverage model, cursor discipline.
- The read-only operation allowlist as the enforcement point for the key path.
- Any file under `docs/build-reality-audit/` — untouched, and it should be added back to the
  repository before any further audit work depends on it.

---

## 8. Monetization (addendum — decoupled from authentication)

Full audit: [`09_MONETIZATION_AND_BUILDER_REVENUE.md`](./09_MONETIZATION_AND_BUILDER_REVENUE.md).

### 8.1 The design constraint that dominates

Polyester has **no builder-code or order-level fee mechanism**. Therefore the architecture must
contain **no order-path monetization at all** — no fee parameter, no attribution header, no
"commission" plumbing. Adding any would fabricate a capability that does not exist.

What remains is a single, small, indirect mechanism: **the official Referrals program**
(4% to the user, 15% of the discounted fee to the referrer), which is **console-only** and
**account-level** — not attributable from inside the dapp through any API.

**And it is not live yet.** The exchange developers report referral codes and builder codes are not
yet active (`09` §0). So this entire section describes a **boundary reserved for a future mechanism**,
not a component to build. The value of specifying it now is that a later launch requires **no
restructuring** of §2 (wallet/auth), §3 (data/cache) or §5 (trading).

### 8.2 Component boundaries

```
┌──────────────────────────────────────────────────────────────────────┐
│  MONETIZATION LAYER  (independent of wallet + auth + data layers)    │
│                                                                      │
│  M-1 monetizationConfig ─────  DOES NOT EXIST YET. Created with its  │
│                                own feature; default ALL OFF.         │
│       │                                                              │
│       ├─▶ M-2 ReferralDisclosure ── consent gate + "replaces your    │
│       │                              current referrer" warning       │
│       │        │                                                     │
│       │        └─▶ M-3 referralAttribution ── external link/code     │
│       │                                       only. NO API calls.    │
│       │                                                              │
│       ├─▶ M-4 FeeTransparency ── read-only actual fees from fills;   │
│       │                          states "PolyTools adds no fee"      │
│       │                                                              │
│       └─▶ M-5 BuilderConfig ── NOT DEFINED. No such mechanism        │
│                                exists; no interface invented.        │
│                                                                      │
│  M-6 RevenueReporting ── OUT OF SCOPE. Operator earnings live only   │
│                          in Polyester's console + Reward Ledger.     │
└──────────────────────────────────────────────────────────────────────┘
          ▲ independent: no edge to WalletConnection,
          │ ExchangeSession, AccountSessionOwner, or the backend
```

### 8.3 Hard rules

1. **No coupling.** Monetization reads no wallet state, no session state, and no account dataset.
   A user who never connects a wallet sees a fully functional, non-monetized app.
2. **Default off, and absent until needed.** Every mechanism ships disabled; enabling is an explicit
   build decision. **No flag exists before the feature it gates** — an inert config key is still
   shipped surface, still test surface, and still implies a capability that may be unspecified.
3. **Safe fallback.** Missing config, unavailable program, or a declined user ⇒ render nothing and
   keep every existing feature. Never a zero, never a broken route, never a blocked view.
4. **No new infrastructure.** No backend, no database, no payment code, no analytics pipeline.
5. **Three financial views never merge** (`09` §4.4): user P&L, user referral rewards, and
   PolyTools revenue. The last must not exist in the dapp at all.
6. **`referralShare` stays invisible.** The per-fill field (`analytics.ts:59`) is the *user's own
   referrer's* earnings — a third party's money. It is currently used only for fill-identity
   deduplication and is neither displayed nor exported. Preserve that. Add a regression test that
   fails if it appears in the UI or an export.
7. **Consent before action**, and an explicit warning that applying PolyTools' code **may replace an
   existing referrer and end that referrer's earnings** (`09` §4.2).
8. **Never auto-apply, never self-refer.**
9. **Account-keyed, never wallet-keyed.** If a future mechanism is ever wired in, the leaf receives
   **`{ accountId }` and nothing else** — no wallet address, no session token, no account dataset, no
   signer — and it imports nothing from `accountSessionOwner`, `packages/core/src/account/`, or the
   signer. This is what makes R-02 (cross-wallet leak) structurally unreachable from monetization, and
   what lets the auth/cache layer be refactored or re-keyed without touching monetization.
10. **One call site for any order-level parameter.** If `OrderIntent` ever gains a builder/fee field,
    the only permitted integration is one pure function applied at one call site inside the existing
    `gate.ts` boundary, with a test proving that "no builder" yields a **byte-identical** intent.

### 8.4 Why this doesn't disturb the wallet-first architecture

The wallet/session/data boundaries in §1–§7 are unchanged. Monetization is a leaf: it consumes
nothing from them and nothing consumes it. Because its only input is an opaque **account id**, the
wallet layer can be rewritten (including fixing R-02 by re-keying `AuthSessionStore`), the session
owner replaced, and the trading layer re-pointed — **none of which can break monetization, and none of
which monetization can break.** A future component can be developed, shipped, and removed entirely
independently of the wallet-first programme, and it needs no SDK, so it is **not gated by the licence
blocker (B1)**.

That property holds today **precisely because nothing has been built**. The preparation that matters
is the boundary — `{ accountId }` in, no imports either way — not a config key, a flag, or a stub.
The mechanism is also not live (`09` §0), so there is currently no component to place inside this
boundary at all.

---

## 9. Not part of this architecture: the AI analyst

The optional BYOK AI assistant is specified separately in
[`11_AI_ANALYST_ROADMAP.md`](./11_AI_ANALYST_ROADMAP.md) and is **not** a layer of this design.

- Nothing in §1–§8 may depend on it, and it may not depend on internals of §2 (wallet/auth) or §5
  (transactions).
- It is sequenced after this programme completes, and it must not gate the wallet-first release.
- Where it eventually attaches, it follows the same two structural rules already established here:
  a **one-way edge with the narrowest possible input** (§8.3 rules 9–10) and **no tool that can reach
  submission, signing, withdrawal, or arbitrary HTTP** (`11` §3.2).

Recording it here is a boundary, not a plan: an architectural note that this section is *closed* to AI
work until a separate approval exists.

