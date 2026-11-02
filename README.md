# Polyap — a dApp for the Polyester exchange

**Polyap** (*Pol* + *yap*) is a community-built companion dApp for [Polyester](https://testnet.polyester.com),
a non-custodial cross-chain spot exchange. Today it is **read-only**: market research, live order
books, trades and charts, plus private account analytics — without ever signing a transaction or
moving funds. Trading is on the [roadmap](docs/ROADMAP.md), gated on capabilities the exchange does
not expose yet.

💬 [Discussions](https://github.com/CryptoExplor/polytools/discussions) ·
🐛 [Issues](https://github.com/CryptoExplor/polytools/issues) ·
📖 [Polyester docs](https://testnet.polyester.com/docs/developer-docs/getting-started) ·
📚 [Polyap docs](docs/README.md) ·
🤝 [Contributing](CONTRIBUTING.md)

> Not affiliated with Polyester / Fabric Labs. Not financial advice. Testnet data may reset.

## Status

| | |
|---|---|
| Public market data | testnet; mainnet can be configured once an official endpoint exists |
| Realtime | order book, trades and candles stream over public WebSockets, with polling as the fallback |
| Private account analytics | **testnet only**, via a passphrase-encrypted API-key vault; live browser verification still owner-pending |
| Wallet | connect any EIP-1193/EIP-6963 wallet; optional exchange sign-in (one `personal_sign`, memory-only token) |
| Trading, transfers, withdrawals | **not provided** — the app is read-only by design ([ADR 0003](docs/decisions/0003-read-only-first.md)) |

**A connected wallet is not a login.** Connecting signs nothing and proves nothing about your
exchange account. Private data still needs an API key in the vault or an explicit sign-in.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173 — frontend + backend in one process
npm test             # synthetic tests; no credentials needed
npm run typecheck    # web + backend TypeScript projects
npm run build        # production build → apps/web/dist
```

Requires Node ≥ 24. Offline maintenance checks (`check:runtime`, `check:whitespace`,
`check:contrast`, `check:dependencies`, `check:external`, `check:performance`) are described in
[docs/TESTING.md](docs/TESTING.md).

## Features

Hash routes, so deep links work on static hosts.

| Area | Route | What it provides |
|---|---|---|
| Markets | `/#/` | Market overview, 24 h stats, sparklines, watchlist, CSV export |
| Order book | `/#/book` | Public L2 book and depth, streamed with polling fallback |
| Trades | `/#/tape` | Live public tape and configurable whale alerts |
| Price chart | `/#/charts` | Candles, volume, crosshair, live bars |
| Depth heatmap | `/#/heatmap` | Order-book depth density and imbalance over time |
| Compare prices | `/#/compare` | Polyester index vs CoinGecko, premium/discount in bps |
| Bridge routes | `/#/zipper` | Chains, fees, minimums, route comparison |
| Calculators | `/#/calc` | Position sizing, margin sketches, P&L/fee examples, conversion |
| Fees | `/#/fees` | Public VIP fee tiers (maker/taker, VIP0–VIP10) |
| Start on testnet | `/#/hub` | Faucets, onboarding checklist, daily claim countdown, on-chain account view |
| Developers: SDK | `/#/sdk` | TypeScript, Python and Rust snippets validated against the pair; API surface panel |
| Brand kit | `/#/brand-kit` | Official Polyester brand assets and usage guidance |
| Account overview | `/#/account` | Balances, sampled balance/equity history, current fee rates, confirmed exports |
| Key setup | `/#/account/api` | Encrypted key vault, nonextractable signing sessions, read-only requests |
| Your trades | `/#/account/trade` | Your executions and actual execution fees |
| Orders | `/#/account/orders` | Open and completed orders, read-only details |
| Profit and loss | `/#/account/pnl` | Experimental, user-assisted exact FIFO or moving-weighted-average cost basis after complete fills, opening basis and resolved flows; realized output is independently gated, while unrealized/total also require fresh marks. Not verified tax output |
| Money movements | `/#/account/transactions` | Your transfers, plus a separate public transaction lookup |

`/#/flow` and `/#/portfolio` redirect to their account sections.

## Repository layout

```text
packages/core/   @polyap/core     shared TypeScript: MCP client, wire decoding, account core, streams
backend/         @polyap/backend  one Web-API handler + Cloudflare / Vercel / Node adapters
apps/web/        @polyap/web      Vite + React SPA
docs/                             documentation (start at docs/README.md)
scripts/, tools/                  maintenance checks, exchange probe, deployment checks
tests/                            node --test suites
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md) — data paths, adapters, realtime, caching
- [Polyester protocol](docs/POLYESTER_PROTOCOL.md) — order model, connection modes, API keys, API surface
- [Security](docs/SECURITY.md) — custody, origin gate, headers, risks
- [Testing](docs/TESTING.md) — gates, manual browser pass, live verification
- [Deployment](docs/DEPLOYMENT.md) — targets and environment variables
- [Roadmap](docs/ROADMAP.md) and [decisions](docs/decisions/README.md)
- [Changelog](CHANGELOG.md)

## Data and custody, in short

- Public prices are scaled integers (`"82132470"` → `82,132.47`); account amounts stay exact
  decimal strings.
- Missing, denied, partial or stale data is labelled, never shown as zero.
- API keys never leave your browser unencrypted and never reach the backend. Never put real keys in
  source, tests, CI, URLs, logs, or shared previews.
- When configured, the optional root/standalone Worker performs public-mover reads and
  **POSTs notifications to Telegram every 15 minutes**. That is a separate outbound side effect with
  its own secrets, not an exchange-account mutation. Account reads remain read-only.
