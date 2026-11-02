# Polyester protocol notes

What Polyap relies on from the Polyester exchange, and what Polyester does and does not expose.
Facts are from Polyester's published docs, the `Fabric-Labs/polyester-proto` contract bundle, and
`@polyester/sdk@0.31.0`; measurements are owner-run on testnet (2026-10). Re-check at every SDK bump.

Official sources: [developer docs](https://testnet.polyester.com/docs/developer-docs/getting-started),
[SDK capability matrix](https://testnet.polyester.com/docs/developer-docs/getting-started/sdk-capability-matrix),
[Ed25519 API keys](https://testnet.polyester.com/docs/developer-docs/authentication-security/ed25519-api-keys),
[REST getting started](https://testnet.polyester.com/docs/developer-docs/rest/getting-started),
API playground (`/docs/api-docs/{rest,connect}/<method>`), and `github.com/Fabric-Labs/polyester-proto`
(`nav.json` marks each operation public or authenticated; `streams.json` lists channels).

## 1. Environments

The SDK ships **devnet** and **testnet** only — no mainnet constant, endpoint, or chain.

| | Testnet |
|---|---|
| API | `https://api.testnet.polyester.com` (friendly REST `/v1/…` and ConnectRPC) |
| WebSocket | `wss://api.testnet.polyester.com/connection/websocket` (Centrifugo) |
| Chain id | `888169` (Polyester Chain Testnet); RPC `https://rpc.polyester.live` |
| Account abstraction | Safe smart accounts, ERC-4337 entry point v0.7, bundler/paymaster `*.polyester.live` |

Polyap's public data is testnet-first; private account reads are **testnet only**.

## 2. Order model — Polyester vs Hyperliquid

| | Hyperliquid | Polyester today |
|---|---|---|
| Order matching | in consensus (HyperCore); orders are chain state | **off-chain** matching engine; balances are ledger entries |
| Delegated trading key | agent wallet, approved once by the main wallet, cannot withdraw | **none.** API keys exist, but creating one needs an interactive session |
| Delegated on-chain signer | agent wallet | `GuardSignerWallet` — funding-whitelist actions only, never orders |
| Fee on routed orders | builder code per order (`{b, f}`), main-wallet approval | **none.** No `builder`/`integrator`/`fee_bps` field in the contracts |
| Referral | wallet-signed `setReferrer` | Referrals program documented but **reported not live**; no callable referral primitive |

Where things happen on Polyester:

| Action | On-chain? |
|---|---|
| Place / cancel / modify order; balances, holds, equity; open orders, fills, history | **No** — exchange ledger |
| Deposit into the platform | **Yes** (the token transfer to a deposit address) |
| Withdraw out | **Yes**, but client-signed intent (`POST /v1/chain/trading-withdraws[:wallet]`) executed by the platform (gasless relay) |
| Guard signer / whitelist approvals | **Yes** — smart-account contract state |

**Consequence for Polyap:** "trade from a third-party app and take a fee" is not buildable until
Polyester ships (1) a trading-scoped delegated key authorised by one wallet signature and (2) a
per-order fee field. Orders moving on-chain would help reads, not writes. Watch for an agent-key or
builder-fee announcement specifically. See [ROADMAP.md](./ROADMAP.md).

## 3. Connection modes

| | Wallet session (JWT) | API key (Ed25519) |
|---|---|---|
| Established by | `POST /v1/auth/wallet-challenge` → `personal_sign` → `POST /v1/auth/login/wallet` | key created in Polyester's **API** page (needs a session), `ak_…` id + 64-hex secret shown once |
| Per request | `Authorization: Bearer <jwt>` | `X-API-KEY-ID`, `X-API-TIMESTAMP`, `X-API-SIGNATURE` |
| Lifetime | session, expires | until revoked |
| Human needed | every login | first setup only |
| Used by Polyap | wallet sign-in (`/api/auth/*` proxy) | private account reads (browser vault) and `scripts/live-test.mjs` |

### Wallet login details (SDK 0.31.0)

- `smartAccountAddress` is the **counterfactually derived Safe** for the owner EOA, never the EOA
  itself; nothing is deployed to log in. Derivation is pure (`createPolyesterAccountSigner`), depends
  on the environment and `saltNonce` (default `0n`), and needs a checksummed address.
- Login needs the owner's **raw 65-byte EIP-191 signature** over the exact issued message;
  ERC-6492-wrapped Safe signatures are rejected. SIWE uses Ethereum mainnet chain id 1.
- `uri` must be a bare HTTP(S) origin. Polyap binds it to the browser's `Origin`.
- The SDK's default token storage is per-client memory; Polyap keeps the token in memory too.
- Still unverified against the real exchange: whether our origin is issued a challenge (C-1), and
  whether an undeployed counterfactual Safe is accepted (U-5).

### API-key signing

- The signature covers timestamp (Unix ms), uppercase method, exact path, canonical query, and the
  SHA-256 of the exact body bytes. The timestamp must be within the server window (~10 s); every
  retry re-signs. Polyap derives a clock offset from the unsigned `GET /v1/spot/config` `tsSec`.
- Canonical implementation: `packages/core/src/account/signer.ts` + `canonical.ts`. Do not write a
  second one.
- **Authentication is not authorization.** A new key has no policy; `auth.me` can succeed while
  balance or fill reads are denied. Attach only the read policies needed; never add trading,
  transfer, withdrawal, or key-management permissions to make a read work.
- Private CORS preflight lists `X-API-NONCE`. The documented scheme does not define it, so Polyap
  does not send it. Add it only if the exchange documents or demands it.

## 4. Headless automation with API keys

API keys are intended for bots, scripts and backends: no wallet or browser per request.

1. Owner creates a disposable testnet key and attaches minimal read policies in Polyester's UI
   (one-time; may need MFA). Polyap never administers keys or policies.
2. Secrets go in a local, gitignored env file or a secrets manager — **never** a `VITE_*` variable,
   CI, a shared preview, logs, or a committed file. The SDK's own variable names are
   `POLYESTER_API_KEY_ID` / `POLYESTER_API_SECRET_HEX`; Polyap's runner reads `PUBLIC_KEY`,
   `PRIVATE_KEY`, `KEY_ID` from `.env`.
3. Run `POLYAP_LIVE_TEST=1 node scripts/live-test.mjs` (legacy `POLYTOOLS_LIVE_TEST=1` still works).
   It refuses CI and performs fixed read-only GETs, printing a sanitized table.
4. Record operation, status class, safe error category and schema result. A denied dataset is
   denied, not empty.
5. Revoke the key afterwards.

A headless success says nothing about browser CORS, the deployed origin, or the browser vault.

## 5. Public API surface

From `nav.json` (2026-10-01): 177 ConnectRPC operations (23 public) and 171 REST operations
(22 public) — the same ~22 business operations over two transports. Public: market data, VIP tiers,
rate limits, currency conversion, chain lifecycle flows, zipper config, layout/share resolution,
subaccount role catalog, wallet login/challenge. Realtime: 22 channels, 8 anonymous (order-book
deltas, trades, candles, heatmap, market overview, lifecycle flows, zipped-asset supply, identity).
Order-book and trades channels have a `:json` variant; market overview and heatmap are protobuf-only.

| Public operation | Polyap use |
|---|---|
| Spot config, market overview, order book, candles, trades, heatmap, lifecycle flows, zipper config | used via `/api` (MCP or REST) |
| `GET /v1/vip/tiers` | used — `/api/fees/tiers`, `/#/fees` |
| Order-book, trades, candles channels | used — realtime streams |
| `GET /v1/rate-limits`, volume history, currency conversion, subaccount roles | unused |

Polyap's private allowlist (`READ_ONLY_OPERATIONS`, GET only): `auth.me`, balances, balance history,
equity history, current fee rates, open orders, order history, order details, fills
(`/v1/spot/trades`), transfers. Everything else — and all private channels — needs a session or key.
The `/#/sdk` "API surface" panel lists the installed SDK's read and write methods; Polyap calls none
of the write methods.

### Measured reachability (owner-run, 2026-10)

| Probe | Result |
|---|---|
| Public REST CORS | `Access-Control-Allow-Origin: *`, preflight 204 |
| Realtime socket with a browser `Origin` | `101 Switching Protocols` |
| Private API-key CORS preflight | allowed, lists the signing headers |
| Wallet-auth routes from the browser | **refused** (no CORS for our origin) → proxied via `/api/auth/*` |
| Wallet-auth routes from a Cloudflare Worker | HTML 403 from the edge (`cf-error=1020`) |
| Wallet-auth routes from an ordinary server | reachable → run the auth leg on a Node host |
| Headless API-key reads (8 operations) | 200 + schema-valid; equity `7d`/`30d` returned 502 |

Run `npm run probe:polyester` (add `-- --stream` for live channel checks) to re-measure; it is
read-only and needs no credentials.

## 6. Never automate

- `POST /v1/chain/guard-signer/wallets:export` — it returns a raw private key.
- Any order, cancel, transfer, withdrawal, guard-signer creation/rotation/approval, or key/policy
  mutation. Those need a separate written decision, not a test step.

## 7. SDK licence

`@polyester/sdk` is `UNLICENSED`. A Polyester team member said building bots and trading with it is
fine; that is informal clearance, not the written agreement the licence describes, and it does not
explicitly cover redistributing SDK code to browsers. Polyap keeps the SDK as a root
devDependency and out of the browser bundle.
