# Roadmap

Current, deduplicated open work. Done items move to [CHANGELOG.md](../CHANGELOG.md); history is in
[archive/](./archive/README.md). Priority: **P0** gates any live or real-money claim, **P1** high
value, **P2** improvements, **P3** polish.

## Now — release and rename follow-ups

| # | Item | Notes |
|---|---|---|
| R1 | Rename the GitHub repository `CryptoExplor/polytools` → `polyap` | GitHub redirects old URLs; update README/issue-template links afterwards |
| R2 | New Cloudflare Pages project / domain for Polyap | then update the deploy origin in `scripts/polyester-probe.mjs` and `tools/auth-gate-probe.mjs`, and Worker names in both `wrangler.toml` files |
| R3 | Redeploy the root site | `polytools-cc8.pages.dev` predates the `wss:` CSP source, so streams are blocked there |
| R4 | Decide how the arena branch reaches `main` | `main` is behind the current work |
| R5 | Remove legacy env names (`POLYTOOLS_APP_ORIGINS`, `POLYTOOLS_LIVE_TEST`) | next major release, after deployments migrate |

## P0 — gates before live or real-data claims

- **Owner-run live account verification** from an owner-controlled HTTPS origin
  ([TESTING.md §6](./TESTING.md#6-live-account-verification-owner-run)): CORS, per-dataset
  permissions, real schemas, cursor completeness, isolation, fee reconciliation. Until then, live
  compatibility is "unverified".
- **Real-exchange wallet sign-in:** does Polyester issue a challenge for our origin (C-1), accept an
  undeployed counterfactual Safe (U-5), and need a network switch before signing (U-6)? Everything so
  far runs against a mock.
- **Cost basis stays experimental** until a qualified reviewer validates method semantics and
  owner evidence. No tax or "filing-ready" claim.

## P1

- **Auth-form cache isolation (AUTH-01…08)** before any session-backed private data is served
  ([TESTING.md §3](./TESTING.md#3-acceptance-gates-wallet-first-programme)).
- **Session as a second account data source** (Stage 3): an `AccountReadClient` over the session,
  behind a flag defaulting to the current REST path, with every safeguard re-proven.
- **Account load scope:** one click still loads every dataset for the view, and the public catalog
  can block unrelated non-fill views. Narrow requests per view or decouple the catalog.
- **Browser regression suite** for the critical flows (lock/load/import/cancel/export, dialogs,
  cost-basis success and blocked states, streams), against production-like assets. Until then, run
  the manual pass in [TESTING.md §4](./TESTING.md#4-manual-browser-pass).
- **SDK guide:** compile the pinned TypeScript examples in isolated tests (inputs are already
  validated; snippets are never executed).
- **Deployment evidence:** Workers Builds failure root cause (owner logs), platform rate limits/WAF,
  log redaction, HSTS decisions.

## P2

- **Information architecture** (needs an owner decision): ≤10 rail items, collapsible
  *Learn & developers*, account sections only in the tab strip; no route removed.
- **Dashboard first paint:** move the intro out of `<main>`; skeletons at final size.
- **Warn before leaving** an account section with loaded or unsaved work (must not block Lock /
  Forget all).
- **Accessibility validation** with real keyboard and screen-reader runs (heatmap alternatives,
  tab/menu semantics, countdown announcements).
- **Analytics labelling** (Stage 4): every figure marked exchange-reported / calculated /
  estimated / unsupported.
- **Public API gaps** worth using: `GET /v1/rate-limits`, 30-day volume history, currency
  conversion.
- **Public cache expansion** (proposals only): short in-memory sharing for overview, books, candles,
  trades, heatmap; 5-minute zipper config. Never for flow lookups, diagnostics, or private data.

## P3 / technical debt

- Large route and account modules (`Portfolio.tsx`, `AccountAnalytics.tsx`) concentrate state;
  extract only at a concrete, tested change seam.
- Duplicated formatting and interaction patterns across Dashboard/Tape/Book/Heatmap; four freshness
  implementations.
- Build/deploy paths run different checks (Vercel builds without the typecheck).
- Dev wire-sample fallback simulates more than replay; keep it labelled and dev-only.
- External content freshness (links, assets, crates) beyond the offline inventory.
- Web Vitals measurement before further bundle work.

## Later — each needs its own explicit approval

### Trading (deferred)

Not buildable today: Polyester has no delegated trading key authorised by one signature and no
per-order fee field ([POLYESTER_PROTOCOL.md §2](./POLYESTER_PROTOCOL.md#2-order-model--polyester-vs-hyperliquid)).
If those ship, trading would go through a single reviewed gate module (the only place allowed to
reference mutation methods), with explicit confirmation, previews, duplicate-submit protection,
reconnect reconciliation, and MFA/step-up handling — and the read-only guard replaced, not removed.

### API-key path

Keep it. Machine clients need keys. It may move to an "Advanced / automation" surface only after
live verification, measured parity (AUTH-09/10), and a security sign-off. Never delete the vault.

### Monetization

Verified revenue today is zero. Builder codes are not specified anywhere in Polyester's contracts;
the Referrals program (15 % of a referred user's discounted fee, 4 % user discount) is documented
but reported not live, and has no callable primitive. Rules for any future work:

- Start a review only when the mechanism appears in a published interface **and** in the contract,
  or the referral console observably issues a link and records a reward.
- Referral value is an **account** property: a future module receives `accountId` only, and nothing
  in wallet, auth, cache, or trading code imports it (or vice versa).
- Consent first: an explicit disclosure, never auto-attaching a code or silently replacing a
  referrer. Frame it as "referral revenue", never a fee on our interface.
- No flags, keys, or placeholders before the feature exists.

### AI analyst (proposal, not started)

Bring-your-own-key, read-only first, off by default and route-gated. Preconditions: stable
wallet-first base; a chosen credential transport with its CSP consequence written down; every tool
with a schema, permission scope, egress class and tests; indicators checked against reference
calculations; provenance on every result; AI output structurally unable to bypass confirmation;
cost/latency observable without logging secrets. Any AI-assisted trading is a separate, later
approval.

## Open questions for the owner

| Question | Blocks |
|---|---|
| Is mainnet in scope at all, given no mainnet SDK environment? | product framing, any realizable revenue |
| Durable written SDK licence (current clearance is informal) | bundling the SDK, any paid tier |
| Are `google`/`email` logins usable by a third-party app? | wallet list |
| Should public tools move from MCP to the SDK / direct REST? | backend scope |
| Do we want the richer equity endpoints? | analytics |
| May Polyap direct users to its own referral code; should we ask Fabric Labs for a referral primitive? | monetization |
| Any independent revenue (premium tier, sponsorship, donations)? | product |
| BYOK transport for an AI phase (CSP widening vs proxy vs allowlist), and is AI in scope at all? | AI phase |
