# PolyTools — modular toolkit for the Polyester exchange

Community-built, **read-only** tools for [Polyester](https://testnet.polyester.com) (non-custodial
cross-chain spot exchange). Works on **testnet today** and is **mainnet-ready** — when the mainnet
endpoint is announced you update one config slot, nothing else.

💬 [Discussions](https://github.com/CryptoExplor/polyester/discussions) ·
🐛 [Issues](https://github.com/CryptoExplor/polyester/issues) ·
📖 [Official docs](https://testnet.polyester.com/docs/developer-docs/getting-started) ·
📦 [Wire samples](docs/wire-samples/) ·
🤝 [Contributing](CONTRIBUTING.md)

> Not affiliated with Polyester / Fabric Labs. Not financial advice. Testnet data may reset.

---

## What's inside (10 tools, one codebase)

| # | Tool | Route | Data |
|---|------|-------|------|
| 1 | Market dashboard | `/#/` | overview (3s) — prices, 24h stats, sparklines, sortable |
| 2 | Order book & depth | `/#/book` | L2 ladder depth 50 + cumulative depth chart + wall detection |
| 3 | Trades & whale alerts | `/#/tape` | live tape, threshold alerts: sound / toast / desktop notification |
| 4 | Charts | `/#/charts` | all 11 candle timeframes, volume, crosshair, live refresh |
| 5 | Venue compare | `/#/compare` | Polyester index vs CoinGecko, premium/discount in bps |
| 6 | Zipper routes | `/#/zipper` | chains, fees, minimums, cheapest-route ranker |
| 7 | Calculators | `/#/calc` | position size, liquidation estimate, PnL & fees, converter |
| 8 | Testnet hub | `/#/hub` | daily claim countdown (00:00 UTC), onboarding checklist, faucets |
| 9 | Tx explorer | `/#/flow` | trace deposits/withdrawals by tx hash or flow id |
| 10 | Key vault | `/#/portfolio` | in-browser Ed25519 keypairs (WebCrypto) — Portfolio foundation |

## Architecture — modular & reusable

```
polyester-tools
├── packages/core/          @poly/core — zero-dep TypeScript core
│   ├── config.ts             networks + tool names (THE mainnet switch)
│   ├── mcp.ts                MCP streamable-HTTP client (sessions, SSE, retry)
│   ├── tools.ts              typed wrappers for all 13 read-only tools
│   ├── normalize.ts          scaled-integer prices (÷10³), bps, depth, walls
│   ├── format.ts poll.ts     display helpers, visibility-aware poller
│   └── keys.ts               Ed25519 vault (generate/sign/wipe, WebCrypto)
│
├── backend/                @poly/backend — ONE pure Web-API handler, 5 adapters
│   ├── src/handler.ts          api(Request) → Response: 13 GET routes, TTL cache, CORS *
│   ├── src/mcpServer.ts        MCP session pool (server side)
│   ├── adapters/
│   │   ├── cloudflare-pages.ts → backend/functions/api/[[path]].ts (Pages Functions)
│   │   ├── vercel.ts           → backend/api/[...path].ts (Edge)
│   │   ├── node.ts             → any VPS/container (npx tsx adapters/node.ts)
│   │   └── worker.ts           → standalone Worker = API + Telegram alert cron
│   └── wrangler.toml
│
└── apps/web/               @poly/web — Vite + React 18 SPA (static build)
    ├── src/components/         reusable UI: DepthChart, CandleChart (zero chart deps)
    ├── src/pages/              the 10 tools
    └── vite.config.ts          dev server MOUNTS the same backend handler → full-stack preview
```

**Why a backend at all?** The read-only MCP endpoint doesn't answer CORS preflights, so browsers
can't call it directly. The backend facade speaks MCP server-side and re-exposes clean,
CORS-open GET JSON. It also adds a hot TTL cache so thousands of users don't hammer the origin.

**Why HashRouter?** Every deep link (`#/book`) works on *every* static host with zero
server config — including GitHub Pages.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173 — frontend + backend in one process
npm run build        # typecheck + static build → apps/web/dist
```

## Deploy (pick one)

### Cloudflare Pages (recommended — frontend + backend together)
1. Import the repo in Pages. Build command `npm run build`, output `apps/web/dist`.
2. Add `backend/functions` as the Functions directory (or mirror `functions/` at the
   configured Pages root). `/*` falls through to `_redirects` → SPA; `/api/*` hits the function.
3. (Optional) set env var `MCP_URL` to override the MCP endpoint.

### Vercel
1. Import the repo — `vercel.json` is already configured (build `apps/web`, functions `backend/api`).
2. No other config. `/api/*` serves from the Edge function.

### GitHub Pages (static only)
1. Deploy the worker once: `cd backend && npx wrangler deploy` (free tier is fine).
2. In repo → Settings → Variables: `VITE_API_BASE = https://poly-tools-backend.<you>.workers.dev`.
3. Enable Pages from GitHub Actions; the included workflow builds and deploys on every push.

### Alert bot (Telegram)
`adapters/worker.ts` has a `scheduled` handler (cron every 15 min in `wrangler.toml`):
```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```
Alerts when any market's 24h move exceeds `ALERT_MIN_BPS` (default 300 = 3%).

## Mainnet switch (the whole point)

1. When mainnet MCP/REST endpoints are announced, set `mcpUrl` in
   `packages/core/src/config.ts` (and/or `MCP_URL_MAINNET` env on the backend).
2. Redeploy. The UI environment badge is **data-driven** (`apiEnv` in every payload),
   so it reports the true serving environment automatically.
3. Portfolio/private features: register a vault public key from `/#/portfolio`, then wire
   private REST paths per developer-docs → authentication-security (signing code is ready).

## Data notes

- Prices on the wire are **scaled integers** (`"82132470"` → `82,132.47`); quantities/volumes
  are plain decimals. `packages/core/src/normalize.ts` is the single place that knows this.
- Public IDs are opaque base58 strings — always store/pass them exactly as returned.
- Polling intervals are conservative; the backend caches hot routes (overview 2s, book 1.5s).
