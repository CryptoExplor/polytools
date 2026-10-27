# 09 — Monetization and builder revenue audit

Addendum to the wallet-first audit. **Audit only — nothing registered, claimed, configured, or implemented.**

> **Revision 2026-10-27 — status downgrade.** The exchange developers have indicated that **referral
> codes and builder codes are not live yet**. Section **§0** records that statement, tests it against
> first-party public evidence, withdraws the previous "available (console)" classification, and
> answers the four required questions. Readers short on time: **§0.3**.

**Method.** Beyond the SDK introspection in `02`, this addendum inspected the **canonical public
Polyester API contracts** (`github.com/Fabric-Labs/polyester-proto` — public protobuf + OpenAPI,
the source from which the SDKs and API docs are generated) and the **official Polyester
documentation**. The proto repo's HEAD is `b34853c`, which matches
`ACCOUNT_CONTRACT_VERSION = "friendly-rest@b34853cb14366c9a…"` in
`packages/core/src/account/rest.ts:13` — corroborating that this is the exact contract version
PolyTools already speaks.

---

## 0. Launch status — revised 2026-10-27 (read this first)

**Trigger.** The exchange developers have indicated that **referral codes and builder codes are not
live yet.** That is a statement from the exchange team, relayed to this audit — **not** something I
can independently reproduce. This section records it as reported, tests it against first-party public
evidence, and revises the audit's conclusions accordingly.

### 0.1 What each source actually says

| Source | Type | What it establishes | Weight |
|---|---|---|---|
| Exchange developers' reported statement | **Second-hand** (relayed to this audit) | Referral codes and builder codes are **not live yet** | Authoritative for intent and schedule; **not independently verifiable by me** |
| [Official SDK capability matrix](https://testnet.polyester.com/docs/developer-docs/getting-started/sdk-capability-matrix) | **First-party, public** | The documented product surface for all four SDKs: **31 capabilities** (market data, order book, orders, balances, subaccounts, policies, guard signer, MFA, transfers, withdrawals, chain analytics, …). **Referrals: absent. Builder codes: absent.** The page's "intentionally out of scope" list names only *MFA enrolment* and *wallet login* — so referral/builder are not merely deprioritised for API-key SDKs; they are **not in the documented product surface at all**. | Strongest public evidence |
| Public Protobuf + OpenAPI contracts (`polyester-proto` @ `b34853c`) | **First-party, public** | **0** referral RPCs, **0** referral endpoints, **0** builder/fee parameters (§1) | Strong |
| Public user docs (`/docs/user-docs/referrals*`) | **First-party, public** | Describe a full Referrals console — 4% / 15%, link creation, Reward Ledger, auto-collect, payout assets — **in the present tense, with UI screenshots** | Describes a **feature**, not a **launch commitment** |
| Network status | **First-party, public** | The entire documentation site is served from **`testnet.polyester.com`**; testnet trades paper assets. No mainnet deployment exists (`02` §1.1, `00` B2) | Strong |
| Launch announcement for referrals, builder codes, or mainnet | — | **None found.** Searches surfaced only third-party airdrop trackers (May 2025) stating there is no token and no announced launch date — stale, low-reliability, and **not used as evidence here** | Absent |

### 0.2 The one apparent contradiction — and why it changes nothing

The **user docs describe the referral program in detail** while the **developer docs do not mention it
at all** and the **developers say it is not live**. Three readings:

1. The console exists in the testnet build, but referral **codes are not live as a production
   mechanism** — "live" means generally available on a real network.
2. The console is live **only on testnet**, which is exactly where those docs live and which pays
   nothing.
3. The docs run ahead of the deployment.

I **cannot distinguish these from public sources**, and the distinction does not change a single
recommendation in this audit: in every reading PolyTools' verified revenue today is **$0.00** and
there is nothing to integrate against. The correct posture is identical — **planned, not available;
verify at launch by direct observation, not by reading docs**.

> **Downgrade applied.** The previous revision classified referral monetization as *"verified and
> available (as a console feature)"*. **That classification is withdrawn.** Status is now
> **planned / awaiting official launch**.

### 0.3 Required conclusion — four answers

**1. What monetization can PolyTools use today?**
**No currently verified revenue mechanism exists in the audited exchange integration.** Verified
revenue is **$0.00**. No live exchange mechanism is available:
- **Builder codes** — no mechanism exists in any public contract. This is stronger than "not live":
  it is **not specified anywhere**.
- **Referral codes** — reported not live, and absent from the entire developer surface.
- **Maker rebates, VIP tiers, daily claims, reward campaigns** — all pay *the user*, never the app.
- **Zipper routing, partner revenue share, builder points** — no such programme is documented.
- **Grants / bug bounty** — **no first-party programme found** for Fabric Labs' exchange products
  (searched; results conflated unrelated companies of the same name; nothing first-party located).

The only revenue reachable *without any third party's permission* is a **PolyTools-owned product**
(paid tier, premium analytics, sponsorship, donations). It is **also not available today**: no payment
rail, no pricing evidence, no demand evidence, real operational cost, and a new licence question
(`08` Q19, Q24). It is the one path **not blocked by someone else's launch** — which is precisely why
it is the wrong thing to build in an audit, and the right thing to revisit only as a deliberate
product decision.

**Scope of that answer is important and is set out in §0.5.** "$0 verified revenue" is a statement
about *the audited integration*; it is **not** a proof that PolyTools cannot earn money by any route.

**2. What is waiting for referral / builder-code launch?**
Everything in this document:
- **Referral (planned).** Disclosure + deep link now (M-2/M-3), user-signed registration later if a
  callable primitive ever ships (`10`, Q21). Worth `0.144 × tier_rate × notional` of *referred*
  volume (§3), **account-level**, and **not attributable from inside the dapp**.
- **Builder code (anticipated, not specified).** The exchange's own developers reference builder codes
  as a future thing — the first evidence that Polyester *intends* such a mechanism. **Intention is not
  a specification:** no published parameter, fee rate, eligibility rule, approval flow, payout path,
  or SDK support exists. Nothing can be designed against it.

**3. What engineering preparation is useful now, without speculative functionality?**
Only **boundaries and invariants** — no code, no config keys, no methods, no flags (§5.1):
- **Account-keyed, wallet-free boundary.** Referral value is an *account* property, never a wallet
  property. Any future module receives **`accountId` and nothing else** — no wallet address, no
  session token, no account dataset, no signer.
- **One-way dependency.** Nothing in the wallet, auth, cache, or trading layers may import
  monetization; monetization may not import them.
- **Single-call-site rule** for any future order-level parameter, with a byte-identical-when-off test.
- **A launch-verification checklist** that must pass before any code is written (§7).
- **Drafted disclosure copy**, so consent language is never improvised under deadline.

**4. What should trigger a future implementation review?**
Any **one** of the following — each checkable without guessing (§7):
- the capability appears in the **SDK capability matrix**, the **OpenAPI spec**, or as an **`rpc`** in
  `polyester-proto`;
- a **first-party announcement** names the mechanism *and* its economics;
- the `/account/referrals` console **observably** issues a link and records a reward event for a real
  fill;
- a **mainnet environment** ships in the SDK, so revenue is denominated in real assets.

Until then: no implementation, no registration, no configuration, no fee plumbing.

### 0.5 Scope of the revenue conclusion — what this audit does and does not rule out

The narrow, defensible claim is:

> **There is no currently verified revenue mechanism in the audited exchange integration.**
> Verified revenue from that integration today: **$0.00**.

That is a claim about *mechanisms I could verify*, not a claim about *business models in general*.
The distinction matters, because an earlier revision of this document drifted into implying the
latter. Explicitly:

| Claim | Status |
|---|---|
| No usable builder-code or order-level fee mechanism exists in Polyester's public contracts | **Established** (§1, §2) |
| The referral programme is not live and has no developer surface | **Established** (§0) |
| Verified revenue from the audited integration today is $0.00 | **Established** |
| PolyTools currently has a working paid product or payment rail | **Not established — and there is none in the code** |
| **PolyTools can never earn revenue from any source** | **NOT ESTABLISHED. Do not claim this.** |

What this audit did **not** rule out, and does not attempt to:

- **An independent paid product** (premium analytics, a paid tier, a hosted offering) — no exchange
  permission needed. Unproven on demand, pricing, payment rail, and licence (`08` Q19, Q24); it is a
  product and legal decision, not an impossibility.
- **An authorised partnership or sponsorship** with different terms than the public docs — outside
  what public sources can confirm either way.
- **A future launch** of either mechanism, at which point this document is re-audited (§7).
- **Revenue from an entirely different product or audience** — out of scope for a dapp audit.

So the honest internal phrasing is: *"we have no verified revenue mechanism to build against today"* —
**not** *"PolyTools cannot make money."* Any external communication should use the first form.

## 0.4 Headline answer (retained — status amended by §0)

**PolyTools cannot charge a builder/interface fee on trades.** Polyester's public API has **no
builder-code, integrator-fee, or order-level fee mechanism** — verified by an exhaustive search of
the entire public contract bundle.

**PolyTools cannot earn from referrals today either.** The Referrals program is documented — a
referrer earns **15% of the discounted fee** a referred user pays, while the referred user gets
**4% off** — but the exchange developers report it is **not live**, and it is absent from the SDK
capability matrix and every public contract (§0). Treat it as **target economics, not current
earnings**.

**But four hard limits apply:**

1. **It is a web-console feature, not an API.** There are no referral endpoints in the public API.
   (Requested comparison: Rabby/Hyperliquid — [`10_RABBY_PATTERN_STUDY.md`](./10_RABBY_PATTERN_STUDY.md)
   explains precisely why the Rabby-style one-click registration cannot be replicated here:
   Hyperliquid exposes `setReferrer` as a wallet-signed action any client may submit, whereas
   Polyester exposes referral management only in its own console. PolyTools already owns the
   signature primitive; it lacks the action to authorize.)
   Attribution cannot be embedded in the PolyTools dapp flow; it is a link/code a user applies in
   Polyester's own UI.
2. **It is account-level, not flow-level.** PolyTools earns 15% of a referred user's fees **no
   matter where they trade** — including in Polyester's own UI, or a competitor's. It is *not*
   "revenue from trades executed through PolyTools."
3. **Testnet only ⇒ no realizable money today.** All of this settles in testnet/paper assets with
   no monetary value. Real revenue requires mainnet, which the SDK does not support (`00` B2).
4. **Not live.** The exchange developers report referral codes are not yet active (§0), which makes
   points 1–3 academic. This is the dominant fact.

---

## 1. Evidence base and search completeness

| Check | Scope | Result |
|---|---|---|
| `grep -rni "builder"` | full public proto + OpenAPI + generated docs | **0 functional hits.** The only match is the word "Builder" inside the `google.protobuf.Timestamp` documentation string in `openapi/polyester.openapi.json` — unrelated boilerplate. |
| `grep -rniE "affiliate\|integrator\|partner\|commission\|kickback\|revenue_share"` | same | **1 hit**, and it is marketing prose in the OpenAPI info block: *"Public trading API for market makers and integrators."* No such program is defined. |
| `grep -rni "referral"` | same | **1 functional concept**: `referral_share_amount_e18` on `orders_read.proto:300` — a **read-only output** field. No create/attribute/analytics endpoint. |
| `grep -rniE "fee_bps\|fee_ppm\|extra_fee\|fee_rate_bps\|builder_fee"` | entire `proto/` tree | **0 hits.** |
| `OrderIntent` field inventory (`orders.proto:161-228`) | order placement contract | `symbol_id`, `side`, sizing (`base_qty_scaled`/`max_quote_debit_scaled`), execution (`market_ioc`/`limit_*`), `client_order_id`, `fee_asset`, `self_trade_prevention_mode`, `attached_risk`. **No fee, builder, or referral parameter.** |
| SDK symbol search (`builder`, `integrator`, `affiliate`, `commission`) | `@polyester/sdk@0.31.0` `dist/**` | **0 hits.** |
| Official referral docs | `testnet.polyester.com/docs/user-docs/referrals*` | **Program documented**, 4% / 15%, console-only. Describes the feature — not a launch commitment. |
| Official SDK capability matrix | `docs/developer-docs/getting-started/sdk-capability-matrix` | **31 capabilities listed; no referral capability, no builder-code capability.** "Intentionally out of scope" names only MFA + wallet login. |
| Exchange developers (reported) | relayed to this audit | Referral codes and builder codes **not live yet**. |

`fee_asset` deserves a note because it is easily mistaken for a fee control: it selects **which
asset pays the existing exchange fee** (`QUOTE` default; `BASE` allowed only for BUY). It does not
change the rate and does not route anything to a third party. Confirmed in
`orders.proto:216-217` and the user docs' "Fee Source" section.

---

## 2. Monetization matrix

### 2.1 Main table

| Mechanism | Official source | Eligibility | Revenue model | User cost | Integration | Approval | Payout | Security | Priority | Evidence |
|---|---|---|---|---|---|---|---|---|---|---|
| **Builder / integrator fee on orders** | — | **None exists** | None possible | — | — | — | — | — | **Planned** — anticipated but unspecified (§0) | 0 hits for `builder`/`integrator`/`extra_fee`; `OrderIntent` has no fee field; developers reference builder codes as future |
| **Referral: referrer share** | [Referrals overview](https://testnet.polyester.com/docs/user-docs/referrals) · [Rewards](https://testnet.polyester.com/docs/user-docs/referrals/fees) | Any Polyester account; custom code needs VIP 1 | **15% of the discounted fee** paid by a referred user | None to the referrer | **Console only** — `/account/referrals`; no API | Account + link creation; VIP 1 for custom code | Reward Ledger → **Trading Account**; manual claim or auto-collect (interval in **minutes**, configurable payout asset) | Attribution is user-visible and user-reversible; must be disclosed | **Planned** — awaiting launch (§0) | User docs describe it; **absent** from the SDK capability matrix and all contracts; reported not live; `referral_share_amount_e18` (`orders_read.proto:300`) is a read-only output |
| **Referral: referred-user discount** | same | Any attributed trader | *User* benefit, not PolyTools revenue | **4% lower** positive fees | Console only | User enters/accepts code | n/a | Replacing an existing code is allowed but must be disclosed | Planned (retention lever) | User docs only; not live (§0) |
| **Maker rebates** | [Trading Fees](https://testnet.polyester.com/docs/user-docs/fees-and-vip) | Market-wide | *User* benefit | Negative maker fee credits the trader | Via order execution | none | n/a | **Rebate rates not yet published** ("coming soon") | Low | Fee schedule page; `feeIsRebate` already parsed in `analytics.ts:54` |
| **VIP tiers** | same | Volume/equity based | *User* discount; not PolyTools revenue | Lower maker/taker rates | `vip.listTiers()` / `getStatus()` | none | n/a | none | Low | VIP 0 = 0.10%/0.15% … VIP 10 = 0.005%/0.045% |
| **Daily claims / reward campaigns** | `proto/public/claims/v1`, `rewards/v1` | Authenticated root account | *Inbound* rewards to the user | none | `claims.claimDailyReward()`, `rewards.listAwards()` | Social linking for daily claims | Award destination address; `setDestination` needs step-up | **Session JWT only — API keys rejected** | Low (not builder revenue) | `rewards.d.ts`, `claims.d.ts` |
| **Zipper swap/bridge routing fee** | `proto/public/chain/zipper/v1/zipper.proto` | — | None exposed | — | `zipper.getDepositWithdrawConfig()` only | — | — | — | **Unavailable** | Config read only; no fee parameter anywhere |
| **Integrator / partner revenue share** | — | — | None documented | — | — | — | — | — | **Unavailable** | Only marketing prose; no program |
| **Builder points / incentive program** | — | — | None documented | — | — | — | — | — | **Unavailable** (no evidence) | 0 hits |
| **Market-data / API resale** | — | Not established | — | — | — | — | — | SDK is `UNLICENSED`; MCP endpoint is Fabric-hosted | **Unavailable** | `02` §1 licence text |
| **Independent paid product (premium analytics, subscription, donations)** | Not an exchange mechanism | Our own decision | Direct payment to PolyTools | Subscription price | Must be built | Payment provider + terms review | Off-platform | Unrelated to exchange custody; keep separate from account data | **Medium** (independent) | No implementation; `apps/web` has no payment code; commercial bundling raises a new licence question (`08` Q24) |

### 2.2 Classification — the brief's four bands, plus an explicit launch-status band

**Available and usable by PolyTools today**
- **Nothing in this table.** No *verified exchange-integration* mechanism can currently generate
  revenue (§0.5 explains what that does and does not imply).

**Existing for users, but never PolyTools revenue**
- Maker rebate *mechanism* (rates unpublished) — credits the trader.
- VIP tier rate structure — discounts the trader.
- Daily claims and reward-campaign awards — paid to the **user**.

**Planned — awaiting official launch (not usable today)**
- **Referral referrer share (15%)** — documented for users; absent from the SDK capability matrix and
  every public contract; reported **not live** (§0).
- **Referral referred-user discount (4%)** — same status.
- **Referral link/code creation** — console-only, human-only, **not automatable**; needs a live
  deployment, a Polyester account, and (for a custom code) **VIP 1**.
- **Builder codes / integrator fees** — anticipated by the exchange's developers, **entirely
  unspecified**: no parameter, fee schedule, eligibility, approval flow, payout path, or SDK method.

**Technically possible but not yet verified**
- Independent paid product (subscription / premium tier). No exchange dependency, no implementation,
  no payment rail chosen, no pricing evidence. Requires product, legal, and tax decisions — and a
  fresh look at the SDK licence for commercial redistribution (`08` Q24).
- Reading referral *share* amounts from fills — the field exists (`referralShare`) and the repo
  already parses it for deduplication, but it is **not** a route to earning.

**Unsupported**
- Order-level fee or referral attachment.
- Programmatic referral attribution or management.
- Zipper routing affiliate fees.
- Partner revenue-share programme.
- Builder points / incentive programme.
- Grants or bug bounty for exchange products (none found — absence of evidence, not proof).


---

## 3. Economics, modelled honestly

### 3.1 The formula — conditional on the mechanism launching

> **Not current earnings.** Every figure in §3 is arithmetic on a *documented* formula whose
> mechanism is **not live** (§0). It is here so that when a launch trigger fires (§7) there is a
> baseline to re-derive from — and so nobody re-invents the multiplier.

For a referred trader's eligible fill:

```
standard_fee = notional × tier_rate        (maker or taker, per fill)
discount     = standard_fee × 0.04
paid_fee     = standard_fee − discount = standard_fee × 0.96
referrer     = paid_fee × 0.15 = standard_fee × 0.144
```

So PolyTools earns **14.4% of the standard fee**, which is **0.144 × tier_rate** of notional.

**Revenue per $1,000 of eligible volume**

| Tier / role | Rate | Standard fee | Referred pays | PolyTools earns | As % of volume |
|---|---|---|---|---|---|
| VIP 0 taker | 0.15% | $1.50 | $1.44 | **$0.216** | 0.0216% |
| VIP 0 maker | 0.10% | $1.00 | $0.96 | **$0.144** | 0.0144% |
| VIP 3 taker | 0.105% | $1.05 | $1.008 | **$0.1512** | 0.01512% |
| VIP 3 maker | 0.05% | $0.50 | $0.48 | **$0.072** | 0.0072% |
| VIP 0 taker @ 0.08% (docs example) | 0.08% | $0.80 | $0.768 | **$0.1152** | 0.01152% |
| VIP 10 taker | 0.045% | $0.45 | $0.432 | **$0.0648** | 0.00648% |
| **Zero maker fee fill** | 0.00% | $0.00 | $0.00 | **$0.00** | 0% |

> The 0.08% row reproduces the official worked example exactly ($0.80 → $0.032 saved → $0.768 paid
> → **$0.1152** referrer). That is the only figure here confirmed against primary documentation.

**Revenue per $100,000 of eligible volume** — linear: **$11.52** (at 0.08%), **$21.60** (VIP 0
taker), **$14.40** (VIP 0 maker).

### 3.2 Monthly projections — hypothetical, clearly labelled

**These are arithmetic on hypothetical volumes with a blended 0.08% fee rate. They are not
forecasts and not PolyTools rates.** They assume every fill is eligible, every user is referred,
and no zero-fee or rebate fills occur — all of which overstate reality.

| Monthly eligible volume | Reference fee | Standard fees | Referred users save | **PolyTools earns** |
|---|---|---|---|---|
| $100,000 | 0.08% | $80.00 | $3.20 | **$11.52** |
| $1,000,000 | 0.08% | $800.00 | $32.00 | **$115.20** |
| $10,000,000 | 0.08% | $8,000.00 | $320.00 | **$1,152.00** |
| $100,000,000 | 0.08% | $80,000.00 | $3,200.00 | **$11,520.00** |

Exclusions that reduce every figure above:
- Maker rebates and zero-maker-fee fills earn **nothing** (documented explicitly).
- Only **referred** users count. Non-referred users (the likely majority) contribute **$0.00**.
- Attribution is **account-wide**, so a referred user trading elsewhere still credits PolyTools —
  the only factor that *increases* the number relative to PolyTools-routed volume.
- Deposit/withdrawal fees are **not** shareable.

### 3.3 Operating costs and break-even

| Cost | Current status |
|---|---|
| Hosting | Cloudflare Pages/Workers free tier; GitHub Pages; Vercel free tier — **$0** |
| Public data | Fabric-hosted MCP endpoint (`config.ts`) — no fee to PolyTools |
| CoinGecko | free tier |
| Backend / DB | **none** — no database exists |
| RPC / bundler / paymaster | **not used** (no transactions) |
| Real cost | **developer time only** |

**Break-even:** with no paid infrastructure, break-even is met at $0 revenue — the constraint is not
cost but **whether any revenue is realizable at all**. Three gates, in order:

0. **Launch gate.** The mechanism is reported **not live** (§0). Until it is, every number below is
   arithmetic on a formula with nothing to apply it to.
1. **Mainnet gate.** On testnet, rewards are test/paper assets with no monetary value. Even the
   $11,520/month row is **$0 of real money** until mainnet. This is the dominant economic fact.
2. **Attribution gate.** Revenue scales only with *referred* users. Without a way to attribute from
   inside the dapp, attribution depends on users following a link out and applying a code — a
   conversion step PolyTools cannot automate or measure through the API.

A paid infra proposal would be unjustifiable today: any monthly cost above ~$0 has no offsetting
verified revenue until mainnet exists.

### 3.4 Projected vs confirmed

| Category | Status |
|---|---|
| **Verified revenue, audited integration** | **$0.00.** No referral link exists, no user is attributed, nothing claimed. A statement about *mechanism*, not about business models in general (§0.5). |
| **Verified mechanism** | Referral 4%/15%, documented and exchange-operated. |
| **Usable today** | **Nothing.** Every mechanism is unavailable, non-existent, or not live (§0). |
| **Projected (hypothetical)** | The §3.2 table — *if* referrals launch on mainnet. |
| **Unavailable** | Builder fees — $0 by construction. |

---

## 4. User trust and fee transparency

Binding requirements for any implementation, drawn from the brief and the verified mechanics.

### 4.1 Because no builder fee exists, most fee-transparency obligations are already satisfied
PolyTools cannot add a fee to an order, so it cannot inflate trading costs, alter order parameters, or
route for commission. **This must be stated in the product**, not left implicit — it is a real
advantage worth advertising.

### 4.2 Referral disclosure (the obligation once the mechanism is live)

- PolyTools earning 15% of a user's fees is a **material relationship** and must be disclosed
  **before** the user applies the code.
- The user **must not** have an existing referral relationship silently replaced. The docs confirm
  a user can replace their existing code with ours — so PolyTools must ask, and must tell the user
  that switching **ends their current referrer's earnings**.
- **Never auto-apply** a referral code, and never at account creation without consent.
- The referral relationship is **reversible and user-visible** in Polyester's console. PolyTools
  must not imply otherwise.
- **The 4% discount belongs to the user.** Show it truthfully and never net it into a
  PolyTools-controlled number.
- Never call a referral code "free" or "cost-neutral" without qualification: the user's fee is 4%
  lower than it would otherwise be, but they still pay a fee, and 15% of it goes to PolyTools.
- **Self-referral is not permitted.** The developer must not trade through PolyTools with its own
  referral code to manufacture earnings. Do not suggest, script, or automate it.

### 4.3 Standing prohibitions
No hidden monetization; no order-parameter alteration; no routing for commission (not even possible);
never collect private keys/seed phrases; never auto-sign approvals or transactions; preserve all
existing functionality for users who decline monetization.

### 4.4 Separate financial views (explicit requirement)
Three distinct figures must never be merged:

| View | Whose money | Where it lives |
|---|---|---|
| User trading P&L / fees | the user's | `/account/pnl`, `/account/trade` |
| Referral rewards earned by the user | the user's | Polyester console only |
| **PolyTools' earned revenue** | **the developer's** | must **not** appear in the dapp at all |

Note a subtlety already in the code: fills carry `referralShare` (`analytics.ts:59`), which is the
share earned by **the user's own referrer** — a third party. It is currently used only in fill
identity for dedup/conflict detection and is **not displayed or exported** (verified:
`grep -rn "referralShare" apps/web/src/` → no hits; `export.ts` → no hits). **Keep it that way.**
Rendering it would expose a third party's earnings and confuse it with the user's own economics.

---

## 5. Reference implementation shape (design only — not built)

Per the brief, monetization must be **decoupled from wallet authentication**. Components:

| # | Component | Responsibility | Fails safely by |
|---|---|---|---|
| M-1 | `monetizationConfig` | Static, build-time allowlist: which mechanisms are enabled. Default **all off**. **Does not exist today** — created in the same commit as the feature it gates, never before (§5.1). | Rendering nothing |
| M-2 | `ReferralDisclosure` | Consent-gated disclosure before any referral action; explicit "this replaces your current referrer" warning | Showing an explainer instead |
| M-3 | `referralAttribution` | Surfaces PolyTools' referral link/code and deep-links to Polyester's console. **No API calls — none exist.** | Showing a plain external link |
| M-4 | `FeeTransparency` | Read-only display of actual fees from fills; states that PolyTools adds no fee | Hiding the panel |
| M-5 | ~~`BuilderConfig`~~ | **Not implemented — no such mechanism exists.** Reserved name only, so nobody invents one later. | n/a |
| M-6 | `RevenueReporting` | **Out of scope for the dapp.** Referral earnings are visible only in Polyester's console + Reward Ledger. | n/a |
| M-7 | Feature flags + fallback | Every mechanism independently disableable; no hard dependency on config | `status: "unavailable"`, never zeros |

Deliberate constraints:
- Monetization depends on **neither** the wallet layer **nor** the exchange session layer. A user who
  never connects a wallet still sees an honest, non-monetized app.
- There is **no order-level monetization integration**, because there is no order-level mechanism.
- No new backend, no database, no payment code until a mechanism is verified and approved.
- **No config exists before the feature it configures.** A flag that gates nothing is still shipped
  surface, still a thing to test, and still implies a capability. The flag lands with M-2/M-3, not
  ahead of them.

### 5.1 Integration boundary — the rules that survive a launch

This is the concrete answer to *"prepare now without building speculative functionality"*. These are
**design constraints**, not code. Nothing here is implemented in this audit.

**The one-way, account-keyed edge**

```
  Wallet ─▶ ExchangeSession ─▶ AccountSessionOwner ─▶ AccountReadClient ─▶ analytics / portfolio
   (address + token live and stay here; R-02 cache key lives here)

                     { accountId }   ← the ONLY thing monetization may receive
                          │
                          ▼
                    MONETIZATION (leaf)
                     no imports back, no wallet, no token, no dataset, no signer
```

| Rule | Reason |
|---|---|
| The leaf receives at most **`{ accountId }`** | Referral value is an **account** property. A wallet address is neither necessary nor sufficient. |
| It must **not import** `apps/web/src/lib/accountSessionOwner.ts`, anything under `packages/core/src/account/`, or the signer — and none of those may import it | Keeps the dependency edge one-way, so auth/cache/trading refactors cannot break it, and it cannot break them |
| It must **never** touch `AuthSessionStore` | That store's key `${form}:${accountId}:${walletAddress}:${range}` carries risk **R-02** (cross-wallet leak). Giving monetization access would create a second path to the leak |
| Resolution happens **after** the session owner settles, as a pure read | No coupling to login timing, no re-entrancy, no auth dependency |

**Why this survives any future refactor:** because the only thing crossing the boundary is an opaque
account identifier, PolyTools can rewrite wallet connection, SIWE login, or the account cache —
including fixing R-02 by re-keying `AuthSessionStore` — **without touching monetization**, and can
delete monetization **without touching any of them**. That is the whole point of the boundary, and
it is satisfied today by *not building anything*.

**If an order-level mechanism ever ships** (`OrderIntent` gains a fee/builder field):

| Rule | Reason |
|---|---|
| Exactly **one** pure function `applyBuilder(intent, config) => intent` | One place to audit; one place to delete |
| Called at **one** call site, inside the existing `gate.ts` mutation boundary | Reuses guard **T-01**; no new mutation path |
| `config = none` ⇒ **byte-identical** intent, proven by test | Turning it off restores today's behaviour exactly |
| Applied only with explicit, itemised user consent | `09` §4.2 |
| The fee shown in the preview must equal the fee submitted | No preview/submission divergence |

**Explicitly not prepared**, because preparing it would fabricate a capability: no `BuilderConfig`,
no fee parameter, no attribution header, no referral-attribution call, no payout logic, no dashboard,
no config keys, no placeholder SDK method, no "coming soon" flag.

---

## 6. Final recommendation

**1. Best revenue model — currently none is live**
The **Referrals program** is the only *documented* mechanism that would pay PolyTools: 15% of the
discounted fee paid by a referred user, 4% discount to that user. The exchange developers report it is
**not live** (§0). It is the **target** when it launches, not a current asset. Everything in the
"builder revenue" category does not exist on Polyester at all.

**2. Can PolyTools earn from trades executed through its interface?**
**Not per-order, and not today at all.** No builder code, integrator fee, or order-level revenue
attribution exists (verified across the full public contract bundle and the SDK). *If* referrals
launch, PolyTools could earn from trades by users it **referred** — account-level, and independent of
which interface they trade on.
The honest framing is "referral revenue", never "trading fee on our interface".

**3. Required registrations/approvals**
**Nothing available to register for today.** *When launched*, referral earnings would require a
Polyester **account** plus a referral link created in the console; a **custom code requires VIP 1**
(volume/equity) and the code string is **set once per link and cannot be changed**. (Separately, the
docs allow a *trader's* attribution to be replaced by a different code — that is a different thing
from the immutable code string, and both statements are true.) No developer programme, partner
agreement, or API approval exists to apply for. **No account was created and no link registered
during this audit.** The **SDK licence** (`00` B1) is required before bundling the SDK — but referral
monetization needs no SDK.

**4. Can referral attribution and builder fees coexist?**
**Architecturally yes; practically nothing exists to combine.** They are different layers — referral
is an **account** property, a builder fee would be an **order** property — so a future launch of both
would not conflict. But builder codes are **unspecified**, and if Polyester ships them `OrderIntent`
must change, so this matrix must be re-audited against the published contract. Do not design against
a signature that does not exist, and do not build on the assumption they are coming.

**5. Exact user-consent requirements**
Explicit, prior, revocable disclosure that (a) PolyTools earns 15% of the fees the user pays,
(b) the user gains a 4% discount, (c) applying the code **may replace an existing referrer and end
that referrer's earnings**, and (d) the relationship is visible and changeable in Polyester's
console. No auto-application. Self-referral prohibited.

**6. Which monetization features first**
**None of them yet.** Prerequisites, in order:
1. **Wait for launch** (§0). Referral codes are reported not live; builder codes are unspecified.
   There is nothing to integrate with.
2. **Verify by observation, not by docs** (§7) — a real link issuing a real reward on a live
   deployment.
3. Resolve the mainnet question (`00` B2) — without it, revenue is denominated in valueless test
   assets even once the mechanism is live.
4. Confirm the exchange's terms permit a third-party app to direct users to its own referral code
   (Q16) — the docs describe the feature, not third-party-app policy.
5. Only then build **M-2 + M-3** (disclosure + link surfacing), which need no SDK, no API, and no
   backend, and are removable in one commit.

Deliberately **not** recommended: building a payments system, a premium tier, or any "builder fee"
scaffolding in anticipation of a mechanism that does not exist.

**7. What remains unavailable or uncertain**
*Unavailable today:* **everything** that pays the app — referral codes (reported not live),
builder/integrator fees (no mechanism), order-level fees, Zipper routing fees, partner revenue share,
builder points, API-driven referral attribution, market-data resale, grants/bounty (none found).
*Uncertain:* whether the mechanism that is not live will ever pay a third-party app; whether
third-party apps may use referral codes under the exchange's terms (Q16); whether builder codes ship
and with what parameters; whether mainnet arrives with the same 4%/15% economics; exact maker-rebate
rates ("coming soon"); whether referral rewards will be payable in real assets to a dapp operator;
whether commercial use of a product that bundles the `UNLICENSED` SDK is permitted (Q24); and the
legal/tax treatment of referral income in the operator's jurisdiction.

---

## 7. Launch trigger — what justifies reopening this document

The audit stops here. Nothing below is a task; it is the **evidence bar** for a future review, so
that "is it live yet?" is answered by artifacts instead of impressions.

> **A trigger opens a review. It does not authorise implementation.** An SDK method appearing, or a
> field appearing in a proto, tells you that a *technical surface* exists — nothing about whether the
> environment is live, whether the terms permit your use, whether users can meaningfully consent, or
> whether the thing works end to end. Those are separate verifications (§7.1a), and each has its own
> evidence requirement. Treating a schema change as a green light is exactly the error this section
> exists to prevent.

### 7.1 The checklist — any single item opens a review

| # | Trigger | How it is verified | Why it justifies a *review* (not an implementation) |
|---|---|---|---|
| L-1 | Mechanism appears in the **SDK capability matrix** | Fetch the matrix; the capability is listed for at least one language | It becomes a documented product surface — still says nothing about whether it is live where we ship |
| L-2 | Mechanism appears in **`polyester-proto`** as an `rpc` or an `OrderIntent` field | `grep -rnE "rpc .*Referr\|builder_fee\|fee_bps" proto/`; parse both OpenAPI specs | Contract-level presence ⇒ an integration path exists |
| L-3 | **First-party announcement** naming the mechanism *and* its economics | Polyester/Fabric Labs blog, docs changelog, or Discord announcement — captured with URL and date | Removes the "docs describe a feature" ambiguity (§0.2) |
| L-4 | **Console observably works**: `/account/referrals` issues a link and the Reward Ledger records a reward against a real fill | A human performs it and records the result | Strongest possible evidence; closes every reading of §0.2 |
| L-5 | **Mainnet environment ships in the SDK** | `createPolyesterEnvironment` ships a non-testnet value; `02` §1.1 re-checked | Makes revenue denominated in real assets |

> L-1 and L-2 are **required together** merely to *begin a review*. L-3 alone justifies *drafting
> copy*. **None of L-1…L-5 authorise building anything** — they authorise looking.

#### 7.1a Verification required *at* the review — before any code

| # | Verification | Evidence that counts | Evidence that does **not** |
|---|---|---|---|
| V-1 | **Environment availability** | The feature observed working in the environment PolyTools actually ships to (per `02` §1.1), with date + build recorded | A docs page, a screenshot, "it's on testnet" |
| V-2 | **Program terms** | A written answer from Fabric Labs covering third-party apps using their own code (`08` Q16) | Inferring permission from the existence of a feature |
| V-3 | **User consent is meaningful** | Approved disclosure copy stating the exact economics, the replacement consequence, and reversibility (`09` §4.2) | A generic "sign this message" prompt |
| V-4 | **End-to-end behaviour** | A real referral link attributed to a real account, and a reward appearing in the Reward Ledger against a real fill | Unit tests, mocked APIs, "should work" |
| V-5 | **Economics re-derived** | Live fee schedule re-read; §3 recomputed; multiplier `0.144` re-checked | Carrying §3 forward |

Only when V-1…V-5 are all recorded does implementation get *proposed* — and it still needs your
explicit approval, as a separate decision.

### 7.2 The review this document must receive before any implementation

1. Re-run §1's greps against the then-current contract bundle; record the HEAD hash.
2. Re-derive the economics from the live fee schedule — **do not carry §3 forward**.
3. Re-check the licence posture for whatever the change actually ships (`08` Q3, Q24).
4. Confirm Q16 (third-party referral terms) **in writing**.
5. Re-check R-02 before any component is allowed near account data — the boundary in §5.1 is designed
   so that this is not needed for the referral path, and a proposal that *does* need it is a red flag.
6. Record a **written go/no-go** decision in `08`, with the V-1…V-5 evidence attached. A review that
   ends without a recorded decision is a review that did not happen.

**What the review may conclude:** proceed, defer again, or abandon. "A capability appeared, therefore
build it" is not among the permitted conclusions.

### 7.3 Standing state in the meantime

No referral attribution, no builder-fee parameter, no fee collection, no referral dashboard, no payout
logic, no configuration keys, no placeholder SDK methods, no registered account. Confirmed revenue:
**$0.00**.
