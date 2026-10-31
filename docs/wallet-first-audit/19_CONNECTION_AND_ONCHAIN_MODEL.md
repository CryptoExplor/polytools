# 19 — Connecting an account, and what is actually on-chain

**Purpose:** the single entry point for a local agent to (a) understand how an account
connection works, (b) run every check that is safe to run, and (c) report evidence.

**Status:** written from the published contracts and docs.

**Stage 0 has been run.** On 2026-10-31 the owner's local agent executed
`npm run probe:polyester` against `https://api.testnet.polyester.com` from commit
`c8d298a` on Windows, Node v24.18.0: **8 checks pass, 0 fail, 0 unknown.** The measured
values are recorded in §4a. This sandbox has no egress to the exchange, so those results
are the owner's, not this workspace's — and Stage 1 (wallet login) and Stage 2 (API-key
reads) remain unexecuted.

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

Whether a *direct* browser→exchange connection is possible was a **CORS question**. It has
now been measured, and the answer is yes for public data:

- `OPTIONS /v1/orderbook/BTC-USDT` → **204** with `Access-Control-Allow-Origin: *`
- the same GET with `Origin:` set → the header is present on the response
- `WS /connection/websocket` with `Origin: https://polytools-cc8.pages.dev` → **101**

So "direct" is now a real option rather than a blocked one. It is still **not** the default,
and the reason is no longer CORS — see §4b for what would actually have to change.

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

### 4a. Stage 0 results (2026-10-31, owner's machine)

| Check | Result | Measured |
| --- | --- | --- |
| `TLS + DNS` | PASS | first response byte in ~2.4s |
| `REST reachable` | PASS | `GET /v1/spot/config` 200 in ~2.6s |
| `Order book shape` | PASS | uncrossed, decimal strings, ~1.75s |
| `VIP catalog` | PASS | 11 contiguous tiers |
| `Rate-limit catalog` | PASS | JSON object |
| `Public CORS` | PASS | preflight 204, `Access-Control-Allow-Origin: *` |
| `Private CORS` | PASS | see the caveat in §5 |
| `Realtime origin gate` | PASS | **101 Switching Protocols** with our deploy origin |

### 4b. What these results do and do not change

**They do change this:** a browser can reach the exchange directly, and the public socket
accepts a browser origin. Both of the blockers named in the previous revision of this
document are gone.

**They do not change this:** the app still goes through `/api`, and that is still the right
default for everything authenticated. Three reasons, none of them CORS:

1. **The proxy is where the cache lives.** One shared cache absorbs every visitor's polling
   instead of each tab asking the exchange itself. On a page that refreshes every 2s, that
   is the difference between one upstream request per TTL and one per tab.
2. **`connect-src` stays small.** Direct calls mean listing the exchange in the CSP. That is
   a deployment security decision, not a free win, and it should be taken only for the calls
   that need it.
3. **Authenticated calls stay server-side regardless.** A wildcard allow-origin is fine for
   public reads and says nothing about whether a long-lived API secret belongs in a bundle —
   see §5.

**What is now built:** realtime for the public order book. The 2s polling on `/#/book` is
now refined by the published delta channel, with polling retained as the floor:

| Piece | Where |
| --- | --- |
| Centrifugo frame layer (connect/subscribe/push/heartbeat/error) | `packages/core/src/centrifuge.ts` |
| Delta parsing, SET semantics, sequence gap detection | `packages/core/src/orderbookStream.ts` |
| Browser transport, backoff, re-snapshot, give-up | `apps/web/src/lib/orderbookStream.ts` |
| UI status: Live / Connecting / Polling | `apps/web/src/pages/Book.tsx` (`StreamPill`) |
| CSP `wss:` source | `_headers`, `vercel.json`, `deploymentSecurity.ts` |
| Live verification of the delta flow | `npm run probe:polyester -- --stream` |

What it does **not** do: it never claims Live while the socket is down, it never merges a
delta across a sequence gap (it re-snapshots), and it stops retrying after five consecutive
failures. Polling stays the source of truth, so a dead socket degrades to a 2s book rather
than a frozen one.

The change set that was previously listed as a proposal:

| Required | Detail |
| --- | --- |
| CSP | add `wss://api.testnet.polyester.com` to `connect-src` (an `https:` source does not cover a `wss:` connection) |
| Client | either the `centrifuge` package (what the official TypeScript SDK uses) or a small protocol client; public channels need no token |
| Channel | `public:spot:orderbook:deltas:depth:{depth}:{symbolId}:json` — decimal-string payloads, `bookSeqStart`/`bookSeqEnd`/`reset` |
| Snapshot | unary `GET /v1/orderbook/{symbol}` first, then apply deltas; a `bookSeq` gap means re-snapshot |
| Fallback | polling must remain for browsers or networks where the socket fails |
| Bundle | the current initial-JS budget has ~80kB gzip of headroom, so this fits — but it is a budget change, not a silent one |

That is a scoped, testable change worth its own commit rather than being smuggled in with a
documentation update.

## 5. Decision gates

Measured on 2026-10-31 — the middle column is no longer hypothetical:

| Gate | Measured | Consequence |
| --- | --- | --- |
| `Public CORS` | **PASS** — `allow-origin: *`, preflight 204 | a browser **may** read public market data directly |
| `Realtime origin gate` | **PASS** — 101 with our deploy origin | a browser socket **is** possible; CSP must still list `wss://api.testnet.polyester.com`, because an `https:` source does not authorise `wss:` |
| `Private CORS` | **PASS** — but see the caveat below | not a reason to put a key in the browser |
| `TLS`, `REST`, `Order book`, `VIP catalog`, `Rate limit` | **PASS** | no contract drift; `/#/fees` and `/#/book` shapes are still valid |

**The `Private CORS` caveat is resolved.** The captured line was:

```text
[PASS] Private CORS — preflight 200, allow-origin *, allow-headers DNT,User-Agent,
X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range,Authorization,
X-API-KEY-ID,X-API-TIMESTAMP,X-API-SIGNATURE,X-API-NONCE
```

So the exchange **explicitly whitelists the API-key signing headers for browser origins**,
plus `X-API-NONCE`. That is a deliberate invitation, not an accident.

It still does not put a key in the browser. The credential is long-lived, the bundle is
public, and a leaked key is not scoped to the session that leaked it. The technical
permission removes a blocker for a *future* design in which the browser signs with an
ephemeral, memory-only key; it does not make a bundled secret safe today.

> **Open question worth one message to the exchange:** the CORS list names
> `X-API-NONCE`, but the documented API-key scheme in
> [`docs/api-key-automation.md`](../api-key-automation.md) and our implementation
> (`packages/core/src/account/signer.ts`) use `X-API-TIMESTAMP` with a freshness window
> and no nonce header. Either nonce is an optional stronger replay guard or the CORS list
> is wider than the contract. **Not assumed either way** — do not add a header the contract
> does not define.

| Outcome | Meaning | Action |
| --- | --- | --- |
| `Public CORS` FAIL | the browser cannot reach the exchange | keep the `/api` proxy; this is permanent, not a bug |
| `Realtime origin gate` FAIL | sockets are server-only or origin-gated | stay on polling; a WS proxy through our worker is a new moving part and needs its own review |
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

---

## 8. Verifying the stream, and what remains unproven

The delta path is tested at three levels, only one of which touches the real exchange:

| Level | What it proves | Ran here |
| --- | --- | --- |
| Unit (`tests/orderbook-stream.test.mjs`, 25 tests) | frame interpretation, SET semantics, zero-quantity removal, stale replay, gap detection, reset, backoff, clean stop | **yes** |
| Fixture server | the probe's `--stream` mode against a Centrifuged-shaped local server: 3 publications validated; a deliberately wrong payload (numeric levels) correctly FAILED | **yes** |
| Live (`npm run probe:polyester -- --stream`) | the real channel accepts our subscribe and publishes contract-shaped **and contiguous** deltas | **no here — run 2026-10-31 by the owner: PASS** |

Run the live one yourself before trusting the UI:

```bash
npm run probe:polyester -- --stream
```

Expected on success:

```text
[PASS] Realtime deltas — 3 publication(s), seq 1000→1003, 40 levels, subprotocol centrifuge-json
```

If the subprotocol negotiated is not a JSON variant, or the levels are not
`[price, qty]` decimal-string pairs, the check fails and the app's streaming path should be
treated as unverified for that environment — the polled book still works.

### 8a. The live run, and the two bugs it did not catch

The owner's live run on 2026-10-31 came back **9 pass, 0 fail, 0 unknown**, including 3 real
delta publications (`seq 10924726→10924728`) with decimal-string levels. The exchange
channel, the Centrifugo handshake, and the payload shape are therefore proven on the wire.

It did **not** prove the feature works, and two real bugs were found by reading the code
against that evidence:

1. **The stream never started.** The subscribe effect read `data?.symbolId` but did not
   list it as a dependency, so on first mount — when `data` is still `null` — the effect
   returned early and never re-ran once the first polled response arrived. Every unit test
   passed, because the transport is correct; only the *wiring* was dead. Fixed by hoisting
   the id to a primitive and depending on the value, which subscribes once when the id
   appears rather than once per poll.
2. **The first deltas were dropped.** Deltas arriving while the snapshot request was in
   flight hit `if (!book) return` and vanished, so the next delta looked like a sequence gap
   and forced a re-snapshot. Live traffic publishes within milliseconds of the subscribe
   reply, so this was the *common* path, not an edge case. Now buffered (bounded at 256) and
   replayed after the snapshot lands; a buffered delta the snapshot already covers is
   discarded as stale.

Both now have regression tests, and the wiring one was verified to fail when the fix is
reverted. The probe also gained a contiguity assertion, since counting publications only
proves traffic arrived — not that it is mergeable.

3. **A dead stream stayed dead.** After five consecutive failures the transport stopped
   permanently, which is wrong for the most common cause of a dropped socket: the tab was
   hidden and the browser suspended it. A user who left the page for a minute returned to a
   stream only a reload could revive. It now resumes when the page becomes visible again.
   Found while re-reading the transport, not from a probe.

Two reporting fixes came out of the same pass:

- **`spread 0.00bps` was ambiguous.** One-cent wide on BTC at 77k is 0.0013bp, which rounds
  to `0.00`, and a *locked* book (bid == ask) prints the same. The probe now states the
  spread in quote units with four decimal places, and names a locked book explicitly. A
  reader can no longer mistake a perfectly tight market for a defect.
- **Jitter was a flat 250ms**, which swamped short backoff delays. It is now proportional
  to the delay.

4. **A dead stream froze the ladder.** When the stream gave up, `liveBook` stayed in state
   and the render path read `liveBook ?? polled`, so the table showed a *frozen* book under
   a "Polling" pill — the label said refreshed, the numbers said otherwise. Now routed
   through `bookForDisplay(status, liveBook)`, which yields to polling once the stream is
   `unavailable` and keeps the last known book while it is `connecting` or `reconnecting`.

A reporting fix came from the owner's third live run:

- **`seq ...503→...505` read as a gap but was contiguous**, because that delta covered
  504–505. The passing and failing lines were therefore identical, which makes a green
  result impossible to audit. The probe now prints each publication's full range —
  `502-502 → 503-503 → 504-505` — so an extension and a hole are visibly different.

**Still unproven:** that the browser renders correctly under sustained deltas (needs a
human), and that the socket recovers from a real mid-stream network drop (a fixture cannot
inject one on the wire).

**One correction to the run report:** the channel is keyed by the exchange's **numeric**
symbol id, so it is `public:spot:orderbook:deltas:depth:50:1:json` — not `depth:50:BTC-USDT:json`
as the summary states. Subscribing with the ticker string is not the published channel name.

---

## 9. Browser pass — the exact commands

Ports differ by mode, and only one of them exercises the CSP. Both are stated so the result
is not misread.

| Mode | Command | URL | Applies the CSP? |
| --- | --- | --- | --- |
| Dev (HMR, `/api` proxied) | `npm run dev` | `http://localhost:5173/#/book` | **No** — `_headers`/`vercel.json` are static-host artifacts, and `index.html` carries no meta CSP |
| Preview (built bundle) | `npm run preview` | `http://localhost:4173/#/book` | **No** — same reason |
| Deployed (Pages / Vercel) | — | the deployed host | **Yes** — this is the only place the `wss:` allowance is actually enforced |

**Consequence:** a browser pass on `5173` or `4173` proves the socket, the merge and the UI.
It does **not** prove the CSP line, because nothing is enforcing it locally. The CSP is
covered separately by `tests/deployment-security.test.mjs`, which asserts the exact set of
websocket origins.

### What to look for

| Observation | Expected | If it is not |
| --- | --- | --- |
| Pill after load | `Connecting` → `Live` within a second or two | stuck on `Connecting` = socket never opened |
| Ladder under load | quantities mutate, no visible flicker | flicker → throttle `setLiveBook` to animation frames |
| Wi-Fi off for 10s | `Live` → `Polling` → back to `Live` on restore | stays `Polling` = give-up path, check `maxFailures` |
| Tab backgrounded >30s, then returned | resumes without a reload | dead until reload = the `visibilitychange` path regressed |
| Depth switch 50 → 10 → 50 | re-subscribes, book stays coherent, no cross-product levels | levels from another depth appearing = identity guard failed |

The last one matters most: switching depth changes the channel, and a delta from the old
depth applied to the new book would look plausible and be wrong.
