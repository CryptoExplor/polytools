# PolyTools — modular toolkit for the Polyester exchange

Community-built, **read-only** tools for [Polyester](https://testnet.polyester.com) (non-custodial
cross-chain spot exchange). Works on **testnet today** and is **mainnet-ready** — when the mainnet
endpoint is announced, update the network configuration or deployment override.

💬 [Discussions](https://github.com/CryptoExplor/polyester/discussions) ·
🐛 [Issues](https://github.com/CryptoExplor/polyester/issues) ·
📖 [Official docs](https://testnet.polyester.com/docs/developer-docs/getting-started) ·
📦 [Wire samples](docs/wire-samples/) ·
🤝 [Contributing](CONTRIBUTING.md)

> Not affiliated with Polyester / Fabric Labs. Not financial advice. Testnet data may reset.

---

## What's inside

The SPA uses hash routes so deep links work on static hosts. Account features are grouped under
`/account`; the older `/book`, `/flow`, and `/portfolio` links redirect to their account sections.

| Area | Route | What it provides |
|---|---|---|
| Account overview | `/#/account` | Read-only balances, sampled equity, execution activity, transfer coverage, current rates, and explicitly confirmed exports |
| API setup | `/#/account/api` | Passphrase-encrypted IndexedDB key vault, nonextractable local Ed25519 sessions, and read-only request signing |
| Trade | `/#/account/trade` | Public matched-trade tape for the selected market; no order placement or cancellation |
| Order book | `/#/account/order-book` | Public resting liquidity and depth; no account key or order action |
| Profit & loss | `/#/account/pnl` | Explicit unavailable state until opening basis, complete flows, and fresh valuation marks are established |
| Tx explorer | `/#/account/transactions` | Public lifecycle lookup; account-wide retrieval is not presented as a verified live feed |
| Markets | `/#/` | Market overview, prices, 24-hour stats, sparklines, watchlist, and CSV export |
| Recent trades | `/#/tape` | Live public tape and configurable whale alerts |
| Price chart | `/#/charts` | Candle timeframes, volume, crosshair, and live refresh |
| Liquidity heatmap | `/#/heatmap` | Order-book depth density and imbalance over time |
| Venue compare | `/#/compare` | Polyester index versus CoinGecko, with premium/discount in basis points |
| Zipper routes | `/#/zipper` | Chains, fees, minimums, and route comparison |
| Calculators | `/#/calc` | Position sizing, margin sketches, PnL/fee examples, and conversion |
| Testnet hub | `/#/hub` | Faucet links, onboarding checklist, and daily claim countdown |
| SDK quickstart | `/#/sdk` | TypeScript, Python, and Rust SDK code generator |
| Brand kit | `/#/brand-kit` | PolyTools brand assets and usage guidance |

## Architecture — modular and reusable

```text
polytools
├── packages/core/                 @poly/core — zero-dependency TypeScript core
│   └── src/
│       ├── config.ts               networks, MCP endpoint resolution, and tool names
│       ├── mcp.ts                  MCP streamable-HTTP client and session handling
│       ├── tools.ts                typed wrappers for public MCP data tools
│       ├── normalize.ts            scaled prices, depth, spread, and wall calculations
│       ├── poll.ts                 bounded, visibility-aware polling
│       ├── index.ts                public exports, including the account namespace
│       └── account/                encrypted vault, signer, REST reads, exact decimals,
│                                 coverage, analytics, exports, and public catalog access
│
├── backend/                       @poly/backend — one pure Web-API handler
│   ├── src/handler.ts              api(Request) → Response, public GET routes, TTL cache, CORS
│   ├── src/mcpServer.ts            server-side MCP session pool
│   ├── adapters/                   Cloudflare Pages/Worker, Vercel Edge, and Node adapters
│   ├── functions/ and api/         deployment entry points
│   └── tsconfig.json               backend/core typechecking project
│
└── apps/web/                      @poly/web — Vite + React SPA
    ├── src/components/             reusable UI and account analytics panels
    ├── src/pages/                  market tools and account sections
    └── vite.config.ts              development mount for the same backend handler
```

**Why a backend at all?** The public read-only MCP endpoint does not answer browser CORS
preflights. The backend facade speaks MCP server-side and re-exposes clean, CORS-open GET JSON.
It also adds a bounded hot TTL cache so users do not hammer the origin. It is not a private-account
proxy and must not receive account private keys.

### Public backend routes

All application API routes are GETs (with OPTIONS for CORS): `/api/health`, `/api/env`,
`/api/markets`, `/api/overview`, `/api/orderbook`, `/api/candles`, `/api/trades`, `/api/heatmap`,
`/api/zipper/config`, `/api/zipper/routes`, `/api/zipper/compare`, `/api/flow`,
`/api/flow/by-tx`, and `/api/flow/explain`. Query allowlists and bounded cache keys are enforced in
`backend/src/handler.ts`.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173 — frontend + backend in one process
npm test             # synthetic unit/regression tests; no live account credentials required
npm run typecheck    # web + backend TypeScript projects (including core)
npm run build        # web typecheck + static production build → apps/web/dist
```

The account tests use synthetic keys and fake transports only. They are not evidence of live
private API access, permissions, CORS, or schema compatibility.

## Deploy (pick one)

### Cloudflare Pages (frontend + backend together)

1. Import the repo in Pages. Build command `npm run build`, output `apps/web/dist`.
2. Add `backend/functions` as the Functions directory (or mirror `functions/` at the configured
   Pages root). `/*` falls through to `_redirects` → SPA; `/api/*` hits the function.
3. Optionally set `MCP_URL` to override the primary MCP endpoint. A deployment with only
   `MCP_URL_MAINNET` also resolves that endpoint; HTTPS is required except for local development.

### Standalone Cloudflare Worker / GitHub Pages

1. Deploy the worker once: `cd backend && npx wrangler deploy`.
2. In the frontend repository settings, set `VITE_API_BASE` to the Worker origin.
3. Enable Pages from GitHub Actions; the included workflow builds and deploys on every push.

### Vercel

Import the repo. `vercel.json` already configures the web build and `backend/api` Edge function;
`/api/*` serves from that function.

### Alert bot (Telegram)

`backend/adapters/worker.ts` has a scheduled handler (cron every 15 minutes in `wrangler.toml`):

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```

Alerts are sent when a market's 24-hour move exceeds `ALERT_MIN_BPS` (default 300 = 3%). These
secrets are for the optional notification bot, not for account custody or signing.

## Mainnet switch

1. When mainnet MCP/REST endpoints are announced, set `mcpUrl` in `packages/core/src/config.ts`
   and/or `MCP_URL_MAINNET` on the backend. `MCP_URL` remains the primary override when both are set.
2. Redeploy. The UI environment badge is data-driven (`apiEnv` in payloads), so it reports the
   serving environment returned by the API rather than assuming a network from the route.
3. Private account reads remain read-only and require an unlocked registered key, a secure context,
   and an explicit load action. Do not treat a public endpoint, a successful signature, or a
   synthetic test as proof of private permissions or complete account coverage.

## Data and custody notes

- Public wire prices are scaled integers (`"82132470"` → `82,132.47`); quantities and volumes are
  plain decimals. `packages/core/src/normalize.ts` owns that public-market transformation.
- Account amounts retain exact decimal strings and exact arithmetic. Display rounding never changes
  the underlying values, and opaque IDs/cursors are passed without decoding or normalization.
- Coverage is explicit: denied, blocked, partial, stale, conflicting, and unavailable data are not
  silently converted to zero or successful empty history. Current fee rates are not historical fees;
  deposits, equity changes, and net quote flow are not profit.
- The account vault uses passphrase-derived encryption and nonextractable in-memory signing keys.
  Lock, wipe, idle timeout, and cross-tab invalidation discard unlocked sessions and private cached
  snapshots. Never put real private keys in source, tests, CI, URLs, logs, or shared previews.
- Public tools do not require credentials. Live account reads are enabled in every build but still
  require an unlocked registered key, a secure context, and an explicit load action. Owner-controlled
  CORS, permission, and schema checks remain necessary; no order placement, cancellation, transfer,
  or withdrawal is provided by this repository.
