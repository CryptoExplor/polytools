# Architecture

Polyap is a static React SPA, a small serverless backend, and a zero-dependency TypeScript core,
all in one npm workspace. Today it is **read-only**: it never signs a transaction, places or cancels
an order, or moves funds (`tests/api-surface.test.mjs` asserts this).

```text
packages/core   @polyap/core     shared TypeScript: MCP client, wire decoding, account core, streams
backend         @polyap/backend  one Web-API handler + platform adapters
apps/web        @polyap/web      Vite + React SPA (hash routes)
```

## Data paths at a glance

| Path | From → to | Credentials | Notes |
|---|---|---|---|
| Public market data | browser → `/api/*` → Polyester public MCP / REST | none | backend speaks MCP server-side (the MCP endpoint has no browser CORS) and adds a TTL cache |
| Realtime (book, trades, candles) | browser → `wss://api.testnet.polyester.com` | none | public Centrifugo channels; polling stays the source of truth |
| Private account reads (API key) | browser → `https://api.testnet.polyester.com` | Ed25519 API key in the encrypted vault | signed GETs from a fixed allowlist; testnet only; never proxied |
| Wallet sign-in | browser → `/api/auth/*` → Polyester auth API | wallet `personal_sign` | the exchange refuses browser CORS for these routes, so the backend proxies them |
| On-chain account view | browser → `/api/account/{address,balances}` | none | Safe address derived server-side; balances are public chain data |
| Compare | browser → `api.coingecko.com` | none | public USD reference prices |

## `packages/core` — `@polyap/core`

| Module | Responsibility |
|---|---|
| `config.ts`, `mcp.ts`, `tools.ts` | network config, MCP streamable-HTTP client (session-only retry), typed public tool wrappers |
| `normalize.ts`, `format.ts`, `poll.ts` | scaled-price decoding (`raw ÷ 10³`), depth/spread/walls, formatters, visibility-aware polling |
| `centrifuge.ts` | Centrifugo frame layer (connect, subscribe, push, ping/pong, errors) |
| `orderbookStream.ts`, `tradesStream.ts`, `candlesStream.ts` | per-channel parsing and merge rules (see Realtime) |
| `vipFees.ts` | public VIP fee-tier catalog parsing |
| `deploymentSecurity.ts` | the single source of the CSP and security headers |
| `persistedIdentifiers.ts` | storage/export identifiers that must never be renamed ([ADR 0001](./decisions/0001-rename-to-polyap.md)) |
| `account/*` | encrypted vault, Ed25519 signer, canonical requests, REST client, DTO validation, exact decimals, coverage, cursor pagination, analytics, FIFO / moving-average lots, exports |

Core is imported by both the SPA and the backend, so a wire-format change is fixed in one place.

## `backend` — `@polyap/backend`

- **One handler.** `backend/src/handler.ts` exports `api(Request) → Response`. Public routes are
  GET/OPTIONS with open CORS, query allowlists, clamped numbers, and safe error bodies.
- **Routes.** `/api/health`, `/api/env`, `/api/markets`, `/api/overview`, `/api/orderbook`,
  `/api/candles`, `/api/trades`, `/api/heatmap`, `/api/fees/tiers`, `/api/zipper/{config,routes,compare}`,
  `/api/flow`, `/api/flow/by-tx`, `/api/flow/explain`, `/api/account/address`, `/api/account/balances`,
  and the wallet sign-in proxy `POST /api/auth/challenge`, `POST /api/auth/login` (`authProxy.ts`).
- **Auth proxy.** Same-origin by default; cross-origin callers must be listed in
  `POLYAP_APP_ORIGINS` (legacy `POLYTOOLS_APP_ORIGINS` still read). The allowed origin is echoed
  exactly, never `*`. Upstream is constrained to `*.polyester.com` (loopback only for tests). The
  SIWE `uri` is the browser's `Origin`. Session tokens are never cached.
- **MCP pool.** `mcpServer.ts` pools one MCP client per URL per isolate.
- **Adapters** are thin: `adapters/worker.ts` (root Worker + static assets + cron),
  `cloudflare-pages.ts` (Pages Functions, entry points in `functions/` and `backend/functions/`),
  `vercel.ts` (Edge, `backend/api/`), `node.ts` (any Node host). See [DEPLOYMENT.md](./DEPLOYMENT.md).
- **Optional cron.** The Worker adapter can read public movers every 15 minutes and POST to
  Telegram. That is an outbound side effect with its own secrets, not an account action.

## `apps/web` — `@polyap/web`

- Hash-routed SPA (`App.tsx`); every page except the landing route is a lazy chunk.
- `Layout.tsx` owns the shell: navigation, one symbol selector, theme, wallet button, freshness.
- `lib/api.ts` is the public data client (`VITE_API_BASE` selects a remote backend).
- Account UI lives under `/account/*` (`pages/Portfolio.tsx`, `components/AccountAnalytics.tsx`,
  `AccountCostBasis.tsx`).
- Wallet layer: `walletDiscovery.ts` (EIP-6963), `walletConnection.ts` / `useWallet.ts`
  (connection only — proves nothing), `walletSigner.ts` (`personal_sign` over the exact issued
  bytes), `polyesterSession.ts` / `usePolyesterSession.ts` (challenge → sign → in-memory token).
  The `@polyester/sdk` package is **not** in the browser bundle; the Safe address is derived
  server-side.
- The dev server (`vite.config.ts`) mounts the same backend handler and can fall back to labeled
  `docs/wire-samples` when upstream fails. Production has no such fallback.

## Realtime streams

`apps/web/src/lib/realtimeSession.ts` owns the socket lifecycle for one public channel — connect,
subscribe, ping/pong, exponential backoff capped at 30 s with jitter of ±25 % of the delay,
visibility resume, and refusal of protobuf framing (JSON is pinned). Each feature is a thin layer
over `subscribeChannel`; each subscription opens its own socket.

Retry past the failure budget does **not** stop. It drops into a slow lane at the cap and keeps
trying, reporting `unavailable` meanwhile so the UI shows polled data rather than a frozen frame;
this is what makes an outage longer than ~31 s recover without a tab switch. A connection earns the
budget back only after staying subscribed for 30 s (`stableAfterMs`), so a server that accepts and
immediately drops escalates instead of being retried once a second forever. Measured before that
rule existed: 27 connections in a 300 ms window at a 5 ms base delay.

| Channel | Payload | Merge rule |
|---|---|---|
| `public:spot:orderbook:deltas:depth:{depth}:{symbolId}:json` | decimal-string level deltas with `bookSeqStart`/`bookSeqEnd` | snapshot first (`/api/orderbook`), buffer early deltas (≤256), SET semantics, `start ≤ prevEnd + 1` is contiguous, any gap re-snapshots |
| `public:spot:market:trades:{symbolId}` | one fill | dedupe by `matchId` (delivery is at-least-once) |
| `public:spot:market:candles:{timeframe}:{symbolId}` | the whole bar, republished | replace by `tsSec`, never append |

Rules that apply to every stream: the stream **refines polling, never replaces it**; a dead stream
falls back to fresh polled data (`bookForDisplay`, `seriesForDisplay`) instead of freezing; invalid
publications are dropped without tearing down the subscription; each page exposes
`data-stream-status="connecting|live|reconnecting|unavailable"`. Channels are keyed by the
**numeric** symbol id. The CSP must list the socket origin; a test pins `defaultRealtimeUrl()` to
`connect-src`.

## Caching

| Layer | What | Bounds |
|---|---|---|
| Backend TTL cache (`backend/src/cache.ts`) | public responses, per isolate | ≤200 keys, short per-route TTLs, same-key single-flight, candle ranges quantized to 60 s buckets. Not a global cache and not a rate limiter |
| Browser public cache (`apps/web/src/lib/publicCache.ts`) | `/api/markets` metadata only | memory + IndexedDB (`polytools-public-cache`), fresh ≤60 s and capped by `max-age`, visible stale fallback, honours `no-store`/`private`, per-key revisions against races |
| Private account data | memory only | partitioned by session generation, vault entry, scope, operation and filters; cleared on lock, wipe, idle timeout and cross-tab events. Never persisted, never cached by the backend |

Fresh hits skip the fetch; stale hits render first and revalidate. Cached metadata is labeled as
cached, never as live.

## Account data model (summary)

- Exact decimal strings end to end; display rounding never changes stored values.
- Explicit coverage: `complete | filter-complete | partial | stale | denied | blocked | unavailable`.
  Missing data is never shown as zero or as a successful empty history.
- Opaque cursors are replayed exactly, with page caps and repeated-cursor detection.
- Per-request deadlines (default 30 s) cover signing, fetch and body read; timeouts are reported as
  `TIMEOUT`, distinct from denial or cancellation.
- Current fee rates are not historical fees; execution fees come from fills only.
- Cost basis (FIFO / moving weighted average) is experimental and user-assisted: it needs complete
  fills, opening basis, resolved non-fill flows, and — for unrealized P&L — a fresh mark.

See [SECURITY.md](./SECURITY.md) for custody and [POLYESTER_PROTOCOL.md](./POLYESTER_PROTOCOL.md)
for the exchange side.
