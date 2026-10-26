# PolyTools — modular toolkit for the Polyester exchange

Community-built tools for **read-only market and account research** on [Polyester](https://testnet.polyester.com) (non-custodial
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
`/account`; the older `/flow` and `/portfolio` links redirect to account sections, while `/book`
remains a public market-data route.

| Area | Route | What it provides |
|---|---|---|
| Account overview | `/#/account` | Authenticated balances, sampled balance/equity history, current fee rates, and explicitly confirmed exports; no unsupported P&L |
| API setup | `/#/account/api` | Passphrase-encrypted IndexedDB key vault, nonextractable local Ed25519 sessions, and read-only request signing |
| Your Trades | `/#/account/trade` | Authenticated, validated account executions and their actual execution fees; never the public trade tape |
| Orders | `/#/account/orders` | Authenticated open and completed orders, with supported read-only order details |
| Profit and Loss | `/#/account/pnl` | Experimental, user-assisted exact FIFO or moving-weighted-average cost-basis estimates after complete fills, opening basis, resolved flows, and method provenance; realized output is independently gated, while unrealized/total also require fresh marks. Not verified tax output |
| Money Movements | `/#/account/transactions` | Authenticated transfers, with a clearly separate credential-free public transaction lookup |
| Markets | `/#/` | Market overview, prices, 24-hour stats, sparklines, watchlist, and CSV export |
| Trades | `/#/tape` | Live public tape and configurable whale alerts; no account key is used |
| Order book | `/#/book` | Public resting liquidity and depth; no account key or order action |
| Price chart | `/#/charts` | Candle timeframes, volume, crosshair, and live refresh |
| Depth heatmap | `/#/heatmap` | Order-book depth density and imbalance over time |
| Compare prices | `/#/compare` | Polyester index versus CoinGecko, with premium/discount in basis points |
| Bridge routes | `/#/zipper` | Chains, fees, minimums, and route comparison |
| Calculators | `/#/calc` | Position sizing, margin sketches, PnL/fee examples, and conversion |
| Start on testnet | `/#/hub` | Faucet links, onboarding checklist, and daily claim countdown |
| Developers: SDK | `/#/sdk` | TypeScript, Python, and Rust SDK snippets, with order inputs validated against the selected pair |
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

# Offline/local maintenance checks
npm run check:runtime
npm run check:whitespace
npm run check:external       # inventory only; no network
npm run check:dependencies   # lock/license metadata; no install
npm run check:performance    # after npm run build
npm run check:contrast       # text tokens >= 4.5:1 in both themes
```

The account tests use synthetic keys and fake transports only. They are not evidence of live
private API access, permissions, CORS, or schema compatibility.

External freshness checks are separate opt-in public-network commands, never part of `npm test`:
`npm run check:links:live`, `npm run check:assets:live`, and `npm run check:sdk:live`. They use
read-only HEAD/GET requests and do not execute generated SDK/trading examples. `npm audit` is a
separate registry review; do not run `npm audit fix` as an opportunistic maintenance step.
See `docs/audit/PHASE3_MAINTENANCE.md` for current measurements, findings, and unverified limits.
For the frontend specifically, `docs/frontend-audit/README.md` records what shipped and how it is
verified, and `docs/frontend-audit/REMAINING_WORK.md` lists the browser checks that automated tests
cannot replace and the interface items still awaiting a decision.

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

Alerts are sent when a market's 24-hour move exceeds `ALERT_MIN_BPS` (default 300 = 3%). When
configured, this standalone/root Worker performs public-mover reads and **POSTs notifications to
Telegram every 15 minutes**. That is a separate outbound side effect, not an exchange-account
mutation, and it is not a behavior of every deployment adapter. The Telegram secrets are only for
the optional notification bot, never for account custody or signing. Account reads remain read-only.

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
