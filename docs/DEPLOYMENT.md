# Deployment

The SPA builds to static files (`apps/web/dist`); the backend is one Web-API handler with thin
adapters. Pick one target. Security headers come from `packages/core/src/deploymentSecurity.ts` on
every target ([SECURITY.md](./SECURITY.md#6-deployment-hardening)).

> **Deploy names are unchanged by the rename.** The live Pages project is still
> `polytools-cc8.pages.dev` (referenced by `scripts/polyester-probe.mjs` and
> `tools/auth-gate-probe.mjs`), the root Worker is still named `polytools` (`wrangler.toml`) and the
> standalone Worker `poly-tools-backend` (`backend/wrangler.toml`). Renaming them creates new
> deployments, so it is pending a new Pages project/domain — see [ROADMAP.md](./ROADMAP.md).

## Targets

| Target | Serves | Notes |
|---|---|---|
| **Cloudflare Worker + static assets** (root `wrangler.toml`) | SPA + `/api/*` + cron | `npx wrangler deploy` after `npm run build` (the `[build]` hook runs it). `ASSETS` binding, SPA fallback |
| **Cloudflare Pages** | SPA + Pages Functions | build `npm run build`, output `apps/web/dist`; Functions from `backend/functions` (or the root `functions/` mirror). `_headers` and `_redirects` ship in the build |
| **Standalone Worker + GitHub Pages** | API on `*.workers.dev`, SPA on Pages | `cd backend && npx wrangler deploy`; set repo variable `VITE_API_BASE` to the Worker origin; `.github/workflows/pages.yml` builds on push to `main` after CI. GitHub Pages cannot set HTTP headers — only the CSP meta fallback applies |
| **Vercel** | SPA + Edge function | `vercel.json` configures the build, headers, and `backend/api` (Edge runtime) |
| **Node host** (Render, Railway, Fly, VPS) | API | `backend/adapters/node.ts`; required for wallet sign-in today (see below) |

### Wallet sign-in needs a non-Worker backend

The exchange refuses browser CORS for its auth routes, and its edge returns an HTML 403 to
Cloudflare Worker egress, while ordinary servers are reachable. So the `/api/auth/*` leg must run on
a Node host:

```bash
# backend host
POLYESTER_API_ORIGIN=https://api.testnet.polyester.com   # default
POLYAP_APP_ORIGINS=https://your-frontend.example         # exact app origin(s), never "*"
PORT=8787
node --experimental-strip-types backend/adapters/node.ts

# static frontend build
VITE_API_BASE=https://your-backend-host
```

The Vercel adapter pins the Edge runtime, which may hit the same edge block; prefer Node until it is
tested. If `VITE_API_BASE` is outside `*.workers.dev`, add it to the CSP `connect-src`.

## Environment variables

Reference copy: [`.env.example`](../.env.example) (server-side) and
[`apps/web/.env.example`](../apps/web/.env.example) (build-time `VITE_*`).

| Variable | Where | Purpose |
|---|---|---|
| `VITE_API_BASE` | web build | origin of a remote backend; unset = same origin. Public, inlined into JS — never a secret |
| `MCP_URL` | backend | primary public MCP endpoint override; blank counts as unset; defaults to testnet |
| `MCP_URL_MAINNET` | backend | used only when `MCP_URL` is unset/blank |
| `POLYAP_APP_ORIGINS` | backend | comma-separated exact origins allowed to call `/api/auth/*` cross-origin; empty = same-origin only |
| `POLYTOOLS_APP_ORIGINS` | backend | **legacy** name, read when `POLYAP_APP_ORIGINS` is unset or blank |
| `POLYESTER_API_ORIGIN` | backend | upstream auth API origin; must be `*.polyester.com` (loopback allowed for tests) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Worker secrets | optional public-mover alert bot (`npx wrangler secret put …`) |
| `ALERT_MIN_BPS` | Worker | alert threshold, default 300 (3 %) |
| `PORT` | Node adapter | listen port |
| `POLYAP_LIVE_TEST` | local shell | opts in to `scripts/live-test.mjs`; refused in CI |
| `POLYTOOLS_LIVE_TEST` | local shell | **legacy** name, read when `POLYAP_LIVE_TEST` is unset or blank |

**Migrating from the PolyTools names:** set `POLYAP_APP_ORIGINS` alongside the old variable, deploy,
confirm, then remove `POLYTOOLS_APP_ORIGINS`. The new name wins when both are set. The legacy names
will be removed in a future major release (tracked in [ROADMAP.md](./ROADMAP.md)).

## Alert bot

`backend/adapters/worker.ts` has a scheduled handler (every 15 minutes in both Wrangler files). When
configured, it reads public movers and POSTs to Telegram when a 24-hour move exceeds
`ALERT_MIN_BPS`. That is an outbound side effect with its own secrets — not an exchange-account
action, and not present on every adapter.

## Mainnet switch (when an official endpoint exists)

1. Set `MCP_URL_MAINNET` (or `MCP_URL`) on the backend. Editing `NETWORKS.mainnet.mcpUrl` in
   `packages/core/src/config.ts` alone does **not** move the public service: the non-empty testnet
   default wins as the primary endpoint.
2. Redeploy. The UI badge reports the backend's `apiEnv`; it does not select the private API network.
3. Private account reads stay testnet-only until an official mainnet endpoint, signing contract, and
   permissions are separately verified ([ADR 0004](./decisions/0004-testnet-only-private-reads.md)).

## Checking a deployment

- `node tools/check-deployment.mjs <origin>` — routes, auth proxy answers, and which layer refuses.
- `npm run probe:polyester` — exchange reachability, CORS, realtime origin gate (override with
  `POLYESTER_BASE` / `POLYESTER_ORIGIN`).
- Inspect real responses for duplicate or conflicting headers; the dev and preview servers apply no
  CSP, so only a deployed host proves it.

Owner follow-ups that are not automated: platform rate limits/WAF, log retention and redaction,
HSTS per hostname, and the historical Workers Builds failure (needs Cloudflare logs).
