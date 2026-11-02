# Executive recommendation — wallet-first migration

**Phase:** audit only. No migration code has been written. Nothing is staged or committed.
**Audit date:** 2026-10-27
**Audited HEAD:** `091a1b1803ce1fb672e5593c10b51fc0c4cbf23c`

---

## 1. Is a wallet-first dapp feasible with the current SDK?

**Technically yes for authentication and read-only account data. Not yet safe to build on, for two independent reasons that are yours to decide.**

The official SDK (`@polyester/sdk@0.31.0`) genuinely supports the flow the strategy
describes: wallet → SIWE challenge → signed session → authenticated account reads, with
no API key. Evidence in [`02_OFFICIAL_SDK_CAPABILITIES.md`](./02_OFFICIAL_SDK_CAPABILITIES.md).

But two blockers sit outside the SDK's technical capability:

| # | Blocker | Why it gates the whole programme |
|---|---|---|
| **B1** | **Licence — *reduced 2026-10-27*, no longer blocking.** The package is `UNLICENSED` and its `LICENSE` requires *"a separate written agreement with Fabric Blockchain Labs Inc."* A Polyester team member has since stated: *"You're fine to use it to build bots and trade on Polyester, which is what it's for."* | Good-faith clearance from the party that matters. Residual gap: a chat message is not the contemplated **written agreement**, and it does not explicitly cover **redistribution** of SDK code into third-party browsers (a public dapp, unlike a bot). Treated as **accepted risk, not verified permission**. Proceed; seek a durable written record in parallel. Detail: [`08` Q3](./08_OPEN_QUESTIONS.md). |
| **B2** | **No mainnet.** The SDK exports exactly two environments, `POLYESTER_DEVNET_ENVIRONMENT` (chainId 888168) and `POLYESTER_TESTNET_ENVIRONMENT` (chainId 888169). There is no mainnet environment, endpoint, or chain constant. | A "full dapp" on mainnet is not achievable on this SDK today. Wallet-first today means wallet-first **on testnet**, which is what the app already is. |

Neither blocker is fatal to the plan; both change what "done" means. Also note the
strategy brief's premise that PR #6 is open and HEAD is `6506e9f` is out of date — see
[`01_CURRENT_STATE.md`](./01_CURRENT_STATE.md) §1.

## 2. What can be migrated without additional services?

All of it runs **client-side, no backend, no database**:

- Wallet connection and exchange login (SIWE) — browser only.
- Balances, equity history, open orders, order history, order details, fills, transfers,
  current fee rates — all already read today via signed GETs; the SDK replaces the
  hand-rolled signer with a session token.
- Portfolio analytics and P&L that PolyTools already computes client-side.

The existing backend facade stays exactly as it is for public market data. It is a public
read-only MCP adapter and is **not** touched by wallet auth.

## 3. What still needs API keys, backend, RPC, indexer, or third-party providers?

| Need | Item | Verdict |
|---|---|---|
| **API keys** | None of the read features strictly require a key under the SDK. | Keys become optional/legacy, not mandatory. Keep until parity is proven. |
| **Third-party (already present)** | Public market data: `https://polyester-mcp-testnet.fabriclabs.workers.dev/mcp` (Fabric Labs hosted MCP) | Stays. **The SDK does not expose MCP**, so the public tools have no SDK equivalent today. Migrating them is a separate, larger project. |
| **Third-party** | CoinGecko (Compare prices) | Stays. |
| **RPC / bundler / paymaster** | `rpc.polyester.live`, `bundler.polyester.live`, `paymaster.polyester.live` | **Required** only if transactions ship. Read-only wallet login needs no RPC (address derivation is offline). |
| **Missing SDK coverage** | Zipper **route listing** and **route comparison** (`list_asset_routes`, `compare_deposit_routes`) have **no SDK method**. The SDK's `zipper` service only offers `getDepositWithdrawConfig`. | Either keep the MCP backend for these, or accept a feature gap. Do not fabricate endpoints. |
| **Backend** | Not needed for wallet auth. | Do not add one. There is no demonstrated need. |

## 4. Can API-key configuration be removed?

**Recommendation: remove it from the primary UX, keep it available as a fallback. Do not remove it entirely in this programme.**

Rationale, from evidence rather than preference:

- The key path (`packages/core/src/account/*`) is the **only** path whose live behaviour is
  documented as tested (`docs/live-testnet-verification-report.md` reports 8/8 endpoints
  returning 200 with validated schemas — attributed to a local agent, not re-run here).
- The SDK wallet path has **never been exercised against a live account** in this
  repository, and this audit deliberately made no authenticated request.
- The SDK path and the key path do not cover identical operation sets. The key path is a
  hand-rolled "friendly REST" contract (`ACCOUNT_CONTRACT_VERSION =
  "friendly-rest@b34853cb…"`, `packages/core/src/account/rest.ts:13`) on `/v1/…` GETs. The
  SDK speaks **ConnectRPC**, not those paths. They are different contracts with different
  schemas; neither proves the other.
- Removing the key path would also remove the only currently-working account read if the
  SDK path hits a permission or schema mismatch on first live use.

Removing keys entirely is a legitimate later goal, but it must be sequenced **after**
read-only parity is demonstrated — which is exactly Stage 8 in the plan.

## 5. Smallest safe first implementation

**Stage 2a — a wallet-connection-only slice, behind a flag, with zero account data.**

Concretely: add an EIP-1193/viem wallet connection provider that tracks
`{status, address, chainId}` for MetaMask/Rabby/Phantom, renders connect/disconnect, and
**stops there**. It performs no exchange login, requests no signature, reads no account
data, and does not touch the vault, the account routes, or the data layer.

Why this is the smallest safe slice:

- It is purely additive: new module + new UI surface, no modification of any existing file
  beyond a provider mount.
- It needs no SDK, so it is unaffected by the licence question entirely.
- It changes no CSP destination except the wallet's own injected provider (which CSP does
  not govern).
- It is fully reversible (delete two files).
- It proves the wallet-state model — including account change and chain change — against
  a thin surface, *before* any private data can leak across a wallet switch.

Stage 2b (SIWE login) now proceeds on **accepted licence risk** (Q3); 2a never needed the SDK.

## 6. Summary of what I would tell a stakeholder

> Wallet-first is real and supported by the official SDK on testnet. The blockers are a
> restrictive SDK licence (now informally cleared) and the absence of any mainnet environment —
> not missing capability. Public market tools should stay on the existing MCP backend because the SDK
> has no MCP equivalent. Start with wallet connection only; add SIWE login behind a flag
> now that the licence question is informally cleared; never delete the API-key vault until the SDK path
> has been proven against a live testnet account.

---

# Part 2 — Monetization addendum

Full evidence in [`09_MONETIZATION_AND_BUILDER_REVENUE.md`](./09_MONETIZATION_AND_BUILDER_REVENUE.md),
which was verified against the **canonical public API contracts**
(`Fabric-Labs/polyester-proto`, HEAD `b34853c` — the exact contract version PolyTools pins in
`rest.ts:13`) and the official Polyester documentation.

> **Status revision — 2026-10-27. Neither mechanism is live.** The exchange developers have indicated
> that **referral codes and builder codes are not live yet**. That matches what the developer surface
> shows: Polyester's own [SDK capability matrix](https://testnet.polyester.com/docs/developer-docs/getting-started/sdk-capability-matrix)
> lists 31 capabilities and **does not include referrals or builder codes**, and the public contracts
> contain no referral RPC, no referral endpoint, and no builder parameter. Part 2 therefore treats
> both as **planned / awaiting official launch** — see [`09` §0](./09_MONETIZATION_AND_BUILDER_REVENUE.md).
> Nothing in Part 2 has been implemented, and **no account was registered**.

## M1. Can PolyTools charge a builder/interface fee? **No — and no such mechanism exists yet either.**

There is **no builder-code, integrator-fee, or order-level fee mechanism anywhere in Polyester's
public API.** Verified exhaustively:

- `grep -rni "builder"` over the whole proto/OpenAPI bundle → **0 functional hits** (one false
  positive inside a Google `Timestamp` doc string).
- `affiliate|integrator|partner|commission|revenue_share` → **1 hit**, marketing prose only.
- `fee_bps|fee_ppm|extra_fee|builder_fee` over all protos → **0 hits**.
- `OrderIntent` (`orders.proto:161-228`) carries `symbol_id`, `side`, sizing, execution,
  `client_order_id`, `fee_asset`, `self_trade_prevention_mode`, `attached_risk` — **no fee field**.
  `fee_asset` only chooses which asset pays the *existing* exchange fee.
- The SDK has **0** occurrences of `builder`/`integrator`/`affiliate`.

Compare with Hyperliquid, dYdX, Polymarket, RISEx and BULK, which all ship order-level builder
parameters. **Do not assume Polyester has one because its peers do.**

The exchange's own developers now reference **builder codes** as a future thing. That is the first
evidence Polyester *intends* such a mechanism — and it is **only** evidence of intent. No parameter,
fee rate, eligibility rule, approval flow, payout path, or SDK method has been published. Intention
is not a specification, and there is nothing here to code against.

## M2. What is planned: the official Referrals program — **not live**

| | |
|---|---|
| Referred trader | **4% lower** eligible positive fees |
| Referrer (PolyTools) | **15% of the discounted fee** the user pays |
| Effective | PolyTools earns **14.4% of the standard fee** = 0.144 × tier rate of notional |
| Worked example (official) | $1,000 @ 0.08% → $0.80 fee → $0.032 saved → $0.768 paid → **$0.1152** to referrer |
| Claim | Reward Ledger → **Trading Account**; manual or automatic (interval in minutes, configurable payout asset) |
| Custom code | **VIP 1**; the code string is set once per link and cannot be changed |
| **Status** | **Documented, not live.** Absent from the SDK capability matrix and the public contracts; reported not live by the exchange developers. Treat every figure as **target** economics. |

## M3. Four limits that keep this small

1. **Not live.** Reported by the exchange developers and consistent with the developer surface
   (`09` §0). Until it launches there is nothing to integrate with, and verified revenue is **$0.00**.
2. **Console-only, no API** — so the Rabby/Hyperliquid "wallet registers itself against the app's
   code" pattern is **not replicable**: Hyperliquid exposes `setReferrer` as a wallet-signed action,
   Polyester exposes no callable action at all. See
   [`10`](./10_RABBY_PATTERN_STUDY.md). No referral endpoints exist — only `referral_share_amount_e18`
   (`orders_read.proto:300`), a read-only output. Attribution **cannot** be embedded in the dapp
   flow; it is a link/code the user applies in Polyester's own UI.
3. **Account-level, not flow-level.** PolyTools earns on a referred user's fees **regardless of
   which interface they trade on** — including Polyester's own. The honest framing is "referral
   revenue", never "a fee on trades through our interface".
4. **Testnet ⇒ no real money.** Rewards settle in test/paper assets with no monetary value. Real
   revenue needs mainnet, which the SDK does not support (`B2`).

## M4. Honest economics at a 0.08% reference fee

| Monthly eligible volume | PolyTools earns |
|---|---|
| $100,000 | **$11.52** |
| $1,000,000 | **$115.20** |
| $10,000,000 | **$1,152.00** |
| $100,000,000 | **$11,520.00** |

Hypothetical arithmetic, **not** a forecast and **not** PolyTools rates. Assumes every fill is
eligible and every user is referred. Zero-maker-fee fills and maker rebates earn **$0**. Confirmed
earnings today: **$0.00**. Operating cost: **$0** (no backend, no database, no paid infra), so
break-even is irrelevant — the binding constraints are that **the mechanism is not live** and mainnet
does not exist.

**What PolyTools can monetize today: no currently verified mechanism in the audited integration.**
Every exchange mechanism that could pay the app is either non-existent (builder codes), not live
(referrals), or pays the *user* instead (rebates, VIP, claims, campaigns). Verified revenue from that
integration: **$0.00**.

**That is not the same as "PolyTools cannot earn money."** This audit did not rule out an independent
paid product, an authorised partnership, or a future launch — it established only that there is
nothing verified to build against today. See `09` §0.5 for the exact scope, and use that narrower
phrasing in any external communication.

## M5. A useful side effect

**Referral monetization requires no SDK.** It is a link plus a disclosure. So monetization is
**not blocked by the licence gate (B1)** — unlike wallet login (Stage 2b). That makes it a
genuinely low-risk, independently valuable increment — *if* it launches **and** the terms question
(Q16) clears. Neither has happened.

**It is also not blocked by mainnet in the same way** as SDK trading: a referral link could in
principle exist before a mainnet SDK environment ships. But revenue on testnet is worth **$0**, so
the practical gate is the same.

## M6. Recommendation

1. **Do not build builder-fee scaffolding.** The mechanism does not exist; building for it would
   fabricate a capability, which the brief forbids.
2. **Wait for launch, then verify by observation.** Referral codes are reported not live and builder
   codes are unspecified. The bar is §7 of `09`: a real link issuing a real reward on a live
   deployment — **docs are not availability**. Note that a launch signal **opens a review**; it does
   not authorise implementation. Environment availability, written terms, meaningful consent and
   end-to-end behaviour are separate verifications (`09` §7.1a), each of which can fail on its own.
3. **Resolve mainnet and the terms question** (Q16). Until then, even a live mechanism pays in
   valueless test assets.
4. Then ship **disclosure + link surfacing only** (components M-2/M-3 in `09` §5): consent-gated,
   explicitly warning that applying the code may replace an existing referrer, no SDK, no backend,
   removable in one commit.
5. **Never auto-apply a referral code. Never self-refer.** Disclose the 15% before the user acts.
6. **Keep the three financial views separate.** PolyTools' own earnings must never appear in the
   dapp. The per-fill `referralShare` field already in `analytics.ts:59` belongs to *the user's own
   referrer* — a third party — and is correctly not displayed or exported. Keep it that way.

---

# Part 3 — Optional AI analyst: recorded, not started

| | |
|---|---|
| Document | [`11_AI_ANALYST_ROADMAP.md`](./11_AI_ANALYST_ROADMAP.md) — roadmap, threat model, tool inventory, estimates |
| Status | **Proposed future phase. Not approved, not scoped, not implemented.** No dependency added, no route added, no source file touched |
| Position | **After** a stable wallet-first dapp and reliable analytics — it must never become a dependency of that release |

**Priority order (yours, adopted without change):**

```
stable wallet-first dapp → reliable analytics → optional AI analyst
                        → user-confirmed AI-assisted trading → monetization when eligible
```

**The one finding worth carrying forward now:** the production CSP's `connect-src` is a closed
allowlist (`'self'`, CoinGecko, the testnet API, `*.workers.dev`). A user-supplied arbitrary provider
base URL **cannot be called from the browser** without widening it — which is exactly risk **R-06**.
So "just add a base-URL field" is not a viable design, and the BYOK transport (allowlist widening vs a
backend proxy vs allowlisted/local endpoints) is an open decision, not a detail. A backend BYOK proxy
would also be the first thing this backend ever holds that belongs to a user, and it sits on the
existing roadmap's non-goals list.

**On a paid AI tier:** it is one *possible* outcome and there is **no demand evidence** for it. It is
not counted as revenue anywhere in this audit.

---

# Part 4 — Handoff reconciliation, authentication, next steps

See [`12_CONTEXT_RECONCILIATION_AND_NEXT_STEPS.md`](./12_CONTEXT_RECONCILIATION_AND_NEXT_STEPS.md).

**Baseline, corrected.** The external handoff summary describes `6506e9f` (head of
`arena/cb53163e-polytools`) with PR #6 open. Since then **PR #6 merged 09:28Z** and **PR #7 merged
11:21Z**, the latter implementing F-07–F-11. Current baseline is **`main @ 091a1b1`**, re-verified at
**318/318 tests across 71 suites**. `6506e9f` is not an ancestor of `main` because PR #6 was
squash-merged.

**`docs/build-reality-audit/` is gone for a mundane reason** — those seven files were **untracked**,
and git does not carry untracked files across a workspace or a squash merge. They exist only in the
sandbox that wrote them. Q5 is answerable, and Q2/Q5 can be closed by decision rather than
restoration.

**Authentication, clarified.** Wallet connection, exchange authentication and account authorization
are **three separate things**. PolyTools has **none** of them today; private reads work by API key
only. Login is a server-issued SIWE challenge → raw 65-byte EOA signature → **bearer token**, and the
token — not the wallet — is the credential. Four consequences are recorded as Q28–Q30: origin binding,
EOA-only wallets, a forced Ethereum-mainnet signature, and keeping the API-key path intact alongside.

