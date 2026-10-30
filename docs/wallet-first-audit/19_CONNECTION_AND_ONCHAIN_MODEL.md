# 19 — Connecting an account, and what is actually on-chain

**Purpose:** the single entry point for a local agent to (a) understand how an account
connection works, (b) run every check that is safe to run, and (c) report evidence.

**Status:** written from the published contracts and docs. Nothing in Stages 1–2 has been
executed here — this sandbox has no egress to `api.testnet.polyester.com`, so every
network result below is something your agent must produce, not something already proven.

---

## 1. Two claims to correct before anything else

The request that produced this document said the account path is **"direct connection and
write on chain"**. Both halves are worth stating precisely, because building on either
would waste a week.

### 1a. "Direct connection" is an open question, not a decision

Today the browser **never** calls `api.testnet.polyester.com` directly. Every request —
public market data and private account reads — goes:

```
browser  →  /api/*  (our backend)  →  api.testnet.polyester.com
```

That is deliberate: the CSP `connect-src` stays small, one shared cache absorbs poll
traffic, and the backend can hold things the browser should not.

Whether a *direct* browser→exchange connection is even possible is a **CORS question that
has never been answered**. It is not a preference we can simply adopt; if the exchange does
not return `Access-Control-Allow-Origin` for our origin, the browser throws before it sees
a byte. Stage 0 check **A4** answers it in one request.

Do not "just switch to direct" first and discover this. Test, then decide.

### 1b. Orders are never written on-chain

This is the part most likely to cause wasted work, so it is stated flatly:

| Action | Where it happens | On-chain? |
| --- | --- | --- |
| Place / cancel / modify an order | matching engine, written to the exchange ledger | **No** |
| Balances, holds, equity | exchange ledger | **No** |
| Open orders, fills, order history | exchange ledger | **No** |
| Deposit into the platform | a deposit address receives a token transfer | **Yes** (the transfer) |
| Withdraw out of the platform | signed intent → platform executes | **Yes** (the execution) |
| Guard signer / whitelist approvals | smart-account contract state | **Yes** |

The mechanics of a withdraw make the pattern clear. The client does **not** broadcast a
transaction; it signs an intent and posts it:

```text
POST /v1/chain/trading-withdraws          payload + payload_signature   (API-key signed)
POST /v1/chain/trading-withdraws:wallet   payload + signer_wallet + EIP-191 personal_sign
```

Both are described in the contract as *"client-signed withdraw details"*. The platform then
executes the on-chain movement (the SDKs pin bundler and paymaster endpoints, i.e. gasless
relayed execution). So even the truly on-chain flows are **signature-authorised, not
client-broadcast**.

Consequence: "write on chain" is not a route to placing trades. Orders have no chain
counterpart to write to. See `18_HYPERLIQUID_ORDER_MODEL.md` §3–4 for why the order path is
blocked on capability the exchange has not published, not on our effort.

---

## 2. The two connection modes

They are separate systems with separate lifetimes. Most confusion in this project came from
treating "connect" as one thing.

| | **Wallet session (JWT)** | **API key (Ed25519)** |
| --- | --- | --- |
| Established by | wallet signature, in-browser | key created in the web app, then used anywhere |
| Sequence | `POST /v1/auth/wallet-challenge` → sign the returned message → `POST /v1/auth/login/wallet` | create key in **API** page (needs a session), copy `ak_…` id + 64-hex secret once |
| Per-request proof | `Authorization: Bearer <jwt>` | `X-API-KEY-ID`, `X-API-TIMESTAMP`, `X-API-SIGNATURE` |
| Lifetime | session-scoped, expires | long-lived until revoked or policy-changed |
| Needs a human | every login | first setup only |
| Can create API keys | yes | no |
| Interactive MFA / step-up | yes, `X-Auth-Step-Up` on high-risk methods | no |

**The signature covers the exact serialized body.** Switching between JSON and binary
Protobuf changes those bytes and therefore invalidates a signature computed for the other
encoding — sign only after the body is final. Polyester's own docs are the authority on the
canonical string; the audited implementation in this repo is
`packages/core/src/account/signer.ts` + `canonical.ts` (`buildCanonicalString`,
`signedHeaders`). Do not hand-roll a second one.

**Practical recommendation for a local agent:** use the **API key** path. It was designed
for "bot, script, or backend service", needs no wallet interaction per run, and is the only
path a headless process can use. Wallet login exists for the browser UI.

---

## 3. The on-chain surface, precisely

Every operation below is authenticated. Paths are from `Fabric-Labs/polyester-proto`
(`proto/public/chain/**`).

### 3a. Read-only, safe

| Operation | Path | Notes |
| --- | --- | --- |
| List deposit addresses | `GET /v1/chain/deposit-addresses` | per-asset/chain deposit addresses |
| Guard signer status | `GET /v1/chain/guard-signer/status` | returns `signer_address` (stored) and `onchain_signer_address` (live chain read); `initialized` is true when they match |
| Lifecycle flows | `GET /v1/chain/flows` and `/v1/chain/flows/{id}` | **public**, no auth — chain activity as read-only records |
| Deposit/withdraw config | `GET /v1/chain/deposit-withdraw/config` | **public** — chains, minimums; already used by `/#/zipper` |

`initialized` is the honest on-chain indicator: it is the only field that compares what the
exchange *thinks* the signer is with what the contract *says* it is.

### 3b. Mutating, and out of scope for this pass

| Operation | Path | Why out of scope |
| --- | --- | --- |
| Create deposit address | `POST /v1/chain/deposit-addresses` | creates account state |
| Validate withdraw destination | `POST /v1/chain/withdraws:validate-destination` | read-only in effect, but it is part of the withdraw flow; treat as gate for the next row |
| Trading withdraw | `POST /v1/chain/trading-withdraws` | **moves money** |
| Wallet trading withdraw | `POST /v1/chain/trading-withdraws:wallet` | **moves money** |
| Create guard signer wallet | `POST /v1/chain/guard-signer/wallets` | changes account security posture |
| Sign protected action | `POST /v1/chain/guard-signer/approvals` | serverside signing of a protected action; changes whitelist state |
| Batch approvals | `POST /v1/chain/guard-signer/approvals:batch` | same |
| Rotate guard signer | `POST /v1/chain/guard-signer/wallets:rotate` | changes account security posture |
| **Export guard signer** | `POST /v1/chain/guard-signer/wallets:export` | **returns a raw private key — see below** |

> ### The one call that must never be automated
>
> `ExportGuardSignerWalletResponse` is literally:
>
> ```proto
> // Hex-encoded private key returned only after export authorization succeeds.
> string private_key = 1;   // len 66, ^0x[0-9a-fA-F]{64}$
> ```
>
> The contract calls this *"a high-risk sovereignty flow"*. A private key arriving over
> HTTP is the exact thing every rule in this project forbids collecting, logging, storing,
> or putting in a browser. **No script, test, or agent flow should call it.** The safe path
> already exists: `SignProtectedAction` signs server-side, so a client never needs the key.

### 3c. What guard signing actually covers — and does not

The `ProtectedAction` enum has exactly six values, all funding-whitelist management:

```text
FUNDING_SET_EXTERNAL_WHITELIST_REQUIRED
FUNDING_ADD_EXTERNAL_WHITELIST
FUNDING_REMOVE_EXTERNAL_WHITELIST
FUNDING_ADD_INTERNAL_WHITELIST
FUNDING_REMOVE_INTERNAL_WHITELIST
FUNDING_SET_INTERNAL_WHITELIST_REQUIRED
```

**There is no order-related action.** Guard signing is a withdrawal-safety feature. It is
not a delegated trading key, and it cannot be repurposed as one. That is the whole reason
the trade path in `18_HYPERLIQUID_ORDER_MODEL.md` is blocked.

---

## 4. Test plan

Run in order. Each stage has a go/no-go, and Stage 0 needs no credentials at all.

### Stage 0 — credential-free (start here)

```bash
node scripts/polyester-probe.mjs
```

Read-only by construction: `GET`, `OPTIONS` preflights, and one WebSocket **handshake**
(no frames sent, so no subscription and no data). No `.env` is read, no key is used. Exit
code 0 = all checks passed.

| Check | Question it answers | A FAIL means |
| --- | --- | --- |
| `TLS + DNS` | is the host reachable from this network at all | the machine, proxy, or DNS — not the exchange |
| `REST reachable` | does `GET /v1/spot/config` return 200 | basic reachability; stop |
| `Order book shape` | arrays, decimal strings, uncrossed, sane spread | contract drift — report it |
| `VIP catalog` | 11 contiguous tiers, VIP0 omission behaves | contract drift in `/#/fees` |
| `Rate-limit catalog` | `GET /v1/rate-limits` returns JSON | that endpoint changed |
| **`Public CORS`** | may a browser call the exchange **directly**? | **stay proxied** — this is the answer to §1a |
| `Private CORS` | would a browser be allowed to send API-key headers? | if allow-origin appears, that is *permission*, not *permission we should use* — see §7 |
| **`Realtime origin gate`** | does `wss://…/connection/websocket` accept a browser `Origin`? | **keep polling**; do not proxy WebSockets without review |

Two results are reported as `UNKNOWN` rather than `FAIL`, because neither is a finding
about the exchange: a transport error (network, DNS, proxy), and the case where the
handshake returns the *same* non-101 answer with and without an `Origin` header — that means
the path is not upgrading a socket at all, which is a path or proxy problem, not an origin
rejection.

Override for a custom, VPC, or local endpoint:
`POLYESTER_BASE=http://127.0.0.1:9101 node scripts/polyester-probe.mjs`. The REST base and
the socket target derive from the same URL, so the two cannot disagree about scheme or port.

The probe's own checks were exercised against a fixture server while it was written —
a crossed book, a missing `Access-Control-Allow-Origin`, and an absent socket endpoint were
each caught and reported as the correct category. What could **not** be exercised is the
real host: this environment has no egress to it, so every result against
`api.testnet.polyester.com` is yours to produce.

**Evidence to capture:** the whole summary table plus `node --version` and the timestamp.
That is enough to act on.

### Stage 1 — wallet login (browser, human present)

Only if you want to prove the session path. Requires a real wallet and a testnet account.

1. `POST /v1/auth/wallet-challenge` with the address(es) → returns a message to sign.
2. Sign it with `personal_sign` (EIP-191). The message must be shown to the human verbatim.
3. `POST /v1/auth/login/wallet` with the signature → returns a JWT.
4. `GET /v1/auth/me` with `Authorization: Bearer <jwt>` → identity.

**Capture:** step 1 request shape, step 3 status code, step 4 top-level key count.
**Never capture:** the JWT, the signature, or the full `/v1/auth/me` body.
**Do not:** auto-sign, reuse a token across accounts, or put a token in a URL.

### Stage 2 — API-key read-only

```bash
POLYTOOLS_LIVE_TEST=1 node scripts/live-test.mjs
```

Existing runner; refuses CI, needs a gitignored `.env` with `PUBLIC_KEY`, `PRIVATE_KEY`,
`KEY_ID`. It performs fixed read-only GETs (`/v1/auth/me`, `/v1/balances`,
`/v1/spot/fee-rates`, `/v1/orders/open`, `/v1/orders/history`, `/v1/spot/trades`,
`/v1/transfers`, `/v1/equity/history/series`) and prints a sanitized table.

A denied dataset is **denied**, never "empty and successful". Record the operation, safe
error category, HTTP status class, schema result.

### Stage 3 — not in this pass

No order placement, no cancel, no transfer, no withdraw, no guard-signer creation,
rotation, approval, or export. Reasons, in one line each: they move money, change account
security, or hand back a private key. If one of those is needed, it is a separate decision
made by you in writing, not a step in a test plan.

---

## 5. Decision gates

| Outcome | Meaning | Action |
| --- | --- | --- |
| `Public CORS` PASS with `*` or our origin | direct browser reads are technically possible | still optional — weigh against cache control and CSP simplicity |
| `Public CORS` FAIL | the browser cannot reach the exchange | keep the `/api` proxy; this is permanent, not a bug |
| `Realtime origin gate` PASS (101) | a browser socket is possible | would additionally need `wss://api.testnet.polyester.com` in CSP `connect-src` — an `https:` source does **not** authorise `wss:` |
| `Realtime origin gate` FAIL | sockets are server-only or origin-gated | stay on polling; a WS proxy through our worker is a new moving part and needs its own review |
| `Private CORS` PASS | a browser *may* send signing headers | **do not** put a key in the browser anyway (custody); this only removes a technical blocker, not the policy one |
| Stage 2 all-denied | the key's policies are too narrow | fix policies in the Polyester UI; do not widen scopes to make a test pass |

---

## 6. Security rules (non-negotiable)

1. **Never call `/v1/chain/guard-signer/wallets:export`.** It returns a private key.
2. **Never accept a private key or seed phrase from anyone**, including as a task.
3. No API secret in `VITE_*`, a committed file, CI, a shared preview, a log, a URL, an
   error report, or a screenshot.
4. Signatures and tokens are never printed. Report status codes and error categories.
5. Read-only unless you have authorised a specific mutation in writing.
6. Do not work around a CORS failure with `no-cors`, an unclaimed proxy, or a shared
   signing service. A CORS failure is an answer.
7. Keep the testnet key disposable and revoke it afterwards.

---

## 7. What is still unknown

- Whether the browser may call the exchange directly (**Stage 0 `Public CORS`**).
- Whether the public socket accepts a browser origin (**Stage 0 `Realtime origin gate`**).
- Whether authenticated reads work with a correctly scoped key on a funded testnet account
  (**Stage 2** — never executed here).
- Whether Polyester will ever expose order delegation or a per-order fee. Nothing in the
  published contracts does today; §3c is the evidence.
