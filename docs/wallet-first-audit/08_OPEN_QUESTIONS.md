# 08 — Open questions requiring your decision

Ordered by how much they block. Each states the evidence, the options, my recommendation, and
what happens if we proceed without an answer.

---

## BLOCKING — the plan cannot start without these

### Q1. The brief's baseline does not match the repository. Which is authoritative? — **now fully diagnosed**

**Evidence.**
- Brief: *"Current PR: #6"*, *"Verified baseline commit: `6506e9f6e70a6d13ed5ccaeec378e4f1ad609ff1`"*.
- Reality: **PR #6 is merged** (`0981f91`, 2026-10-27T09:28Z). `6506e9f` is the **final commit of
  PR #6's head branch**, not a `main` tip. `main` has since advanced to
  `091a1b1803ce1fb672e5593c10b51fc0c4cbf23c` via the merge of **PR #7**.
- This checkout is a **shallow clone at depth 1**, so `6506e9f` is not even present locally
  (I fetched it from the remote to diff it: 25 files, +1426/−231).

**Options.**
1. Treat **`091a1b1` (current `main`)** as the baseline — it contains every PR #6 safeguard plus PR #7.
2. Treat `6506e9f` as the baseline and revert PR #7 — **not recommended**; it rewrites user work
   and discards merged functionality.
3. Pin a specific new commit after you've reviewed this audit.

**Recommendation: option 1.** All of PR #6's safeguards are verifiably intact at `091a1b1`
(`01_CURRENT_STATE.md` §6.1). Nothing needs reverting.

**If unanswered:** I proceed against `091a1b1`, which is what actually exists.

---

### Q2. F-07–F-11 are already merged and cannot be identified. What does "keep deferred" mean? — **mechanism now known**

**Evidence.** The brief says *"Keep F-07–F-11 and the combined activity feed deferred."* But:
- **PR #7 is merged**, titled *"Implement audit findings F-07 through F-11"*.
- The strings `F-07`…`F-11` appear **nowhere** in the repository. Their defining document would
  be `docs/build-reality-audit/`, which **does not exist** in this checkout.
- The **combined activity feed genuinely is not implemented** — `packages/core/src/account/activity.ts`
  contains only transfer-reason label maps.

**Options.**
1. You restore `docs/build-reality-audit/`, then I can map F-07–F-11 to code and tell you whether
   "deferred" is already satisfied, partially satisfied, or needs work.
2. You tell me what F-07–F-11 are.
3. Treat PR #7 as accepted and drop the deferral constraint.

**Recommendation: option 1, and do not revert PR #7 in the meantime.** I will not revert merged
work on a guess.

**If unanswered:** I do nothing about F-07–F-11 and will flag it as unresolved in any later phase.

---

### Q3. The SDK licence — now informally cleared. How should we record it? — **LARGELY RESOLVED 2026-10-27**

**Original evidence.** `@polyester/sdk@0.31.0` is `"license": "UNLICENSED"`. Its `LICENSE`: *"No
license is granted to copy, modify, distribute, sublicense, or use this work except under a separate
written agreement with Fabric Blockchain Labs Inc."* The repo already discloses this
(`apps/web/src/pages/SdkGuide.tsx:414`) and a test enforces the disclosure.

**New evidence (2026-10-27).** A Polyester team member ("Neon") replied in chat to the licence
concern:

> "You're fine to use it to build bots and trade on Polyester, which is what it's for."

**Assessment — this materially reduces the risk, but it is not the "separate written agreement"
the LICENSE text contemplates.** Specifically:

| Point | Status |
|---|---|
| Permission to build on Polyester with the SDK | **Given.** Direct statement from the team. |
| Corroborating signal | The package is publicly published (`publishConfig.access: "public"`, npm `latest`), which is consistent with intended third-party use. |
| Explicitly a *written agreement with Fabric Blockchain Labs Inc.* | **No.** A chat message is not a signed agreement, and the speaker's authority to bind the legal entity is unverified. |
| Explicitly covers *redistribution* of SDK code to third-party users' browsers | **No.** "Build bots" describes a first-party client. A public dapp ships and executes SDK code in strangers' browsers — a narrower reading would not cover that. |

**Practical conclusion: proceed.** The statement is a good-faith clearance from the party whose
permission matters, and the residual legal gap is narrow. The honest posture is *accepted risk*, not
*verified permission*. Recommended in parallel (not as a blocker):
1. Get the same statement somewhere durable and attributable — a GitHub issue comment on
   `Fabric-Labs/polyester-sdk-typescript` from an official account, or an email. Cheap, and it turns
   a chat quote into a citable record.
2. Keep the existing in-app disclosure; update its wording to cite the team statement instead of
   implying use may be prohibited. **That is a source change — not made in this audit.**
3. Re-check the licence text at each SDK version bump; it can change.

**Options.** (1) Proceed on this statement, record it, pursue durability in parallel →
**recommended**. (2) Wait for a signed agreement → safest, but open-ended. (3) Reimplement SIWE by
hand → materially larger, not recommended.

**Recommendation: option 1.** Stage 2b is no longer *blocked*; it becomes a decision you make with
documented, accepted risk.

---

### Q4. Is mainnet in scope at all?

**Evidence.** The SDK ships exactly two environments — devnet (chain 888168) and testnet
(chain 888169). **There is no mainnet environment, endpoint, chain, or contract address.**
`createPolyesterEnvironment()` exists but mainnet values would have to be supplied by the
operator, and none are public.

**Options.**
1. **Testnet-first** (matches the repo today) → the whole plan stands as written.
2. Wait for an official mainnet SDK release before starting.
3. Attempt mainnet via `createPolyesterEnvironment` → **not recommended**; it would require
   inventing contract addresses, which the brief forbids.

**Recommendation: option 1.** Make "wallet-first, testnet-only" explicit in the product copy.

---

## IMPORTANT — shapes the architecture

### Q5. Can you restore `docs/build-reality-audit/`? — **answered: it cannot be restored from git**

It is treated as protected and authoritative but is absent. I have taken no action on it and will
not recreate it from memory. Please add it back (or confirm it was intentionally removed).

**RESOLVED-IN-MECHANISM (2026-10-27).** The reason the directory is absent is now established, from
the handoff itself: those seven files were **untracked**. Git does not carry untracked files across a
workspace, a branch, or a **squash merge** — a squash merge takes the committed tree only. They
therefore exist **only in the sandbox where they were written**, are not in `origin`, and are not
recoverable from history.

**Practical consequence:** stop trying to restore it. Either (a) paste the five finding descriptions
and I will map them to PR #7's diff, or (b) accept PR #7's body — which describes all five changes
precisely — as the record. **I recommend (b):** zero cost, and the work is auditable in `main` even
without the F-numbers. See `12` §3.

### Q6. Should the API-key path be removed, demoted, or kept?

**Options.**
1. **Demote** — wallet-first default, keys kept on an "Advanced / automation" surface.
2. Remove once parity is proven.
3. Keep as-is (no wallet-first).

**Recommendation: option 1.** It is the only live-verified path; it is required for machine
clients (the SDK's own `api-key-ed25519` provider); and removing it isn't required for any
product goal. Full reasoning in `00_EXECUTIVE_RECOMMENDATION.md` §4.

### Q7. Which wallets must be supported at launch?

The SDK does not connect wallets, so this is entirely our choice — and it determines the CSP
work. Injected EIP-1193 (MetaMask, Rabby) needs **no CSP change**; WalletConnect needs a relay
plus iframes, and the current policy has `frame-src 'none'`.

**Recommendation:** injected only for now. Add WalletConnect only if mobile-first is a hard
requirement.

### Q8. Are `google` / `email` logins actually usable by a third-party app?

The SDK's `AuthLoginMethod` includes `"google"` and `"email"`, but **every** `login()` path
requires an `AccountSigner.signMessage`. It is **unknown** whether social login works from our
origin with only a host-supplied signer, or needs a Turnkey iframe/relay we don't have.

**Recommendation:** scope to wallet logins; revisit if you want email onboarding.

### Q9. Is Stage 7 (transactions) in scope for this programme?

The SDK supports orders, cancels, transfers, withdrawals, and triggers. Shipping any of them
requires replacing the current **structural** read-only guarantee (`READ_ONLY_OPERATIONS`
allowlist) with an enforced equivalent — see `06` R-03.

**Recommendation: out of scope** until Stage 6 verification is complete and the licence is
settled.

### Q10. Node version policy

`package.json` requires Node ≥24; this sandbox runs **v22.22.3** and npm emitted `EBADENGINE`.
Everything passes, but it is a latent CI/runtime divergence. Is Node 24 available in your CI,
or should the engine requirement be relaxed?

---

## MINOR — can be decided during implementation

### Q11. Should I commit and push these reports?

Per your instruction I have **not** staged or committed anything. All nine files are new and
untracked on `arena/609563ba-polytools`. Say the word and I'll commit them (docs only, no source).

### Q12. Should public market tools migrate from MCP to the SDK?

The SDK covers market overview, orderbook, candles, recent trades, heatmap, lifecycle and
Zipper config — but over **ConnectRPC with different DTOs**, and it has **no MCP equivalent and
no Zipper route-comparison**. Migrating would be a large re-validation project with a
feature-loss risk and **no wallet-first benefit**.

**Recommendation: do not migrate.** Keep the MCP backend.

### Q13. Should `@polyester/sdk` become a runtime dependency now?

No. It should stay a devDependency until Q3 is answered. Nothing in Stage 2a needs it.

### Q14. Do you want the richer equity endpoints?

The SDK exposes `balances.getPortfolioEquityHistory` and `getPortfolioEquitySnapshot`, which the
current friendly-REST path does not use. They may be strictly better for the Portfolio view —
but they are unverified and would be a scope addition.

**Recommendation:** evaluate in Stage 4, not before.

### Q15. Where should the audit directory live?

I created `docs/wallet-first-audit/`, deliberately separate from the protected
`docs/build-reality-audit/`. Rename it if you prefer a different convention.

---

## Summary of what I need from you

| Priority | Question | Status | Blocks |
|---|---|---|---|
| ~~1~~ | ~~**Q3** SDK licence agreement~~ | **Largely resolved 2026-10-27** — team clearance; proceed on accepted risk | Nothing blocks; pursue durable record in parallel |
| 1 | **Q1** accept `091a1b1` as baseline | Open | Everything |
| 2 | **Q2** + **Q5** restore audit dir / define F-07–F-11 | Open | Anything referencing them |
| 3 | **Q4** mainnet scope | Open | Product framing; all realizable revenue |
| 4 | **Q16** referral terms for third-party apps | Open — **now gated behind launch status first** | Stage M2 |
| 5 | **Q6** key-path fate | Open | Stages 3, 8 |
| 6 | **Q7** wallet list | Open | Stage 2a, CSP |
| 7 | **Q11** commit the reports? | Open | Housekeeping |
| 8 | **Q21** request referral primitive from Fabric Labs | Open | Would upgrade Stage M2 |
| 9 | **Q22** auto-attach referral code? | Open (recommend: no) | Ethics/consent |
| 10 | **Q23** which evidence counts as "launched"? (defined in `09` §7) | **Answered in doc** — needs your sign-off on the bar | Stage M1/M2 |
| 11 | **Q24** paid product under an `UNLICENSED` SDK | Open | Any premium tier |
| 12 | **Q25** BYOK transport: CSP widening / backend proxy / allowlisted only | Open | The whole AI phase (`11` §1.4) |
| 13 | **Q27** is the AI phase in scope at all? | Open (recommend: defer, no date) | Anything AI-shaped |

I can start **Stage 2a (wallet connection only)** as soon as Q1 is acknowledged. With Q3 reduced,
**Stage 2b (SIWE login) is also unblocked**, subject to your explicit go-ahead on accepted licence
risk.

---

# MONETIZATION — additional questions

Full audit: [`09_MONETIZATION_AND_BUILDER_REVENUE.md`](./09_MONETIZATION_AND_BUILDER_REVENUE.md).

### Q16. Do Polyester's terms permit a third-party app to direct users to its own referral code? — **BLOCKING (M2), and now gated on launch too**

**Evidence.** The official docs describe the Referrals program fully (4% to the referred user, 15%
to the referrer, console at `/account/referrals`, custom code at VIP 1, Reward Ledger, manual or
automatic claim). They describe the **feature**, not **third-party-app policy**. I can confirm the
mechanism exists and how it pays; I **cannot** confirm from documentation that a community-built
app like PolyTools is permitted to solicit its own code from users.

**Options.** (1) You confirm with Fabric Labs and record the answer. (2) Proceed on the docs alone →
**not recommended**; it is the kind of assumption the brief explicitly forbids. (3) Don't monetize.

**Recommendation: option 1.** Note this is a business/terms question, not an engineering one, and it
cannot be resolved by reading more code.

**Launch status (2026-10-27) — a prior question now exists.** The exchange developers report that
**referral codes and builder codes are not live yet**, and the official SDK capability matrix lists no
referral capability at all. So Q16 is no longer the first gate: **there is no live mechanism for the
terms to be about.** Sequence is now *is it live?* (`09` §7) → *is it permitted?* (this question).

### Q17. Given no mainnet, is any monetization worth building now?

**Evidence.** Testnet rewards settle in test/paper assets with no monetary value. Verified earnings
today: **$0.00**. The largest hypothetical monthly figure ($11,520 at $100M volume) is still $0 of
real money until mainnet exists.

**Options.** (1) Build M-2/M-3 now as a small, flag-gated, removable increment. (2) Defer all
monetization until mainnet. (3) Defer until referral terms are confirmed **and** mainnet is near.

**Recommendation: option 3 — now strictly deferred.** With the mechanism reported **not live**
(`09` §0), options 1 and 3 are not even reachable: there is nothing to build M-2/M-3 against. Revised
answer: **do nothing but draft the disclosure copy** — no component, no flag, no config (`09` §5.1),
and revisit when a launch trigger fires (`09` §7).

### Q18. Should I add a "no added fee" statement to the product?

Because Polyester has no builder-fee mechanism, PolyTools **cannot** inflate trading costs. That is a
trust asset worth stating explicitly ("PolyTools adds no fee to your trades"). But it is a factual
claim that must be re-audited if Polyester ever ships builder codes.

**Recommendation:** yes, once M2 exists, with the claim tied to the audit date.

### Q19. Do you want any independent (non-exchange) revenue — premium tier, donations, sponsorship?

Out of scope for this audit and **unverified**: no payment rail, no pricing evidence, no
implementation. It would also add real operational cost against $0 verified revenue.

**Recommendation:** not now. If wanted later, treat it as a separate product decision with its own
review — and keep it strictly separate from account data and the exchange session.

**New since this was written:** commercialising a product that *bundles* the `UNLICENSED` SDK is a
different licence posture from "build bots and trade on Polyester" (`00` B1). That is now its own
question — **Q24**.

### Q20. Should the per-fill `referralShare` field ever be surfaced?

It currently is **not** displayed or exported (`grep -rn "referralShare" apps/web/src/` → no hits;
`export.ts` → no hits) and is used only for fill-identity deduplication. It represents **the user's
own referrer's** earnings — a third party's money.

**Recommendation: keep it invisible**, and add the regression test in `05` Stage M2 so it cannot
leak into the UI or an export later.

### Q21. Should we ask Fabric Labs for a programmatic referral primitive? (Rabby/Hyperliquid pattern)

**Context.** [`10_RABBY_PATTERN_STUDY.md`](./10_RABBY_PATTERN_STUDY.md). On Hyperliquid, a wallet
can register a user against its own referral code by submitting a **wallet-signed `setReferrer`
action** — which is how wallets capture fee share. Polyester has the *program* (4%/15%) but **no
callable primitive**: verified zero referral RPCs, zero referral endpoints, and no referral field in
`proto/public/auth/`. PolyTools therefore cannot replicate the pattern; it can only deep-link.

**Options.** (1) Ask for it: a user-signed referral action + a read endpoint for current referrer and
accrued rewards + explicit permission for third-party apps to use their own code. (2) Deep-link only
and move on. (3) Don't monetize.

**Recommendation: option 1 in parallel with option 2.** The ask is cheap, well-precedented
(Polyester's console already allows *replacing* a code, so this is a policy simplification rather
than new state), and it converts Stage M2 from a fragile deep link into one-click user-signed
registration. **I have not filed it** — that is your call. It must come from you or the repo owner,
not an automated agent.

### Q22. Do we accept the ecosystem norm of auto-attaching a referral code?

**Context.** Widely used clients attach their own referral code "on accounts without one" by default.
The Hyperliquid primitive does require a wallet signature, so consent is nominal — but a generic
"sign this message" prompt is not meaningful disclosure of a 15% take.

**Recommendation: do not copy that norm.** Even if Polyester later exposes the primitive, PolyTools
should disclose the exact economics before the signature, never pre-select, never auto-apply, and
make it visibly reversible (`10` §6). Flagging it explicitly because "everyone does it" is the
likeliest way this project drifts into prohibited monetization.

### Q23. What counts as "launched" — and who adjudicates?

**Context.** The exchange developers say referral and builder codes are not live. The public user docs
describe referrals in the present tense with screenshots. Both can be true (testnet build vs
production launch), and I cannot resolve it from outside.

**Proposed bar** (`09` §7, five triggers, any one opens a review):
**L-1** appears in the SDK capability matrix · **L-2** appears in `polyester-proto` as an `rpc` or an
`OrderIntent` field · **L-3** first-party announcement naming the mechanism *and* its economics ·
**L-4** the console **observably** issues a link and records a reward against a real fill ·
**L-5** a mainnet environment ships in the SDK.

**Rule I'd apply:** L-1 **and** L-2 together for any *code*; L-3 alone only justifies drafting copy;
**L-4 overrides everything** — an observed working link is better evidence than any document.

**Recommendation:** accept this bar, and treat "a blog post exists" as *not* sufficient. Note that
none of L-1…L-5 can be satisfied by me without either a public artifact or a human observation; I
will not mark a gate as passed on the strength of a doc page.

### Q24. May PolyTools charge users for a product that bundles the `UNLICENSED` SDK?

**Context.** `00` B1 records a Polyester team member's statement — *"you're fine to use it to build
bots and trade on Polyester, which is what it's for"* — as accepted risk for **using** the SDK. A
**premium tier or subscription** is a different act: **commercial redistribution** of that code to
paying third parties. Nothing in the statement addresses selling access.

**Options.** (1) Don't build paid tiers while the licence is `UNLICENSED`. (2) Build a paid tier that
ships **no SDK code** (e.g. paid analytics computed server-side, or features served from the existing
MCP backend) — this may sidestep the redistribution question but needs legal review, not my
judgement. (3) Obtain a written commercial licence first.

**Recommendation: option 1 for now, option 3 before option 2.** This is not a decision an audit can
make, and it is a genuinely new dependency that the earlier "monetization needs no SDK" reasoning does
**not** cover. Flagging it because "premium analytics" is the most plausible non-exchange revenue idea
and its licence cost is invisible until you try to charge for it.

---

# AI ANALYST — additional questions (proposal only, see `11`)

### Q25. How would a user-supplied provider endpoint be reached at all?

**Evidence.** The production CSP is a closed allowlist (`apps/web/public/_headers:3`):
`connect-src 'self' https://api.coingecko.com https://api.testnet.polyester.com https://*.workers.dev`.
A user's arbitrary base URL (`https://api.openai.com`, or any compatible host) **cannot be called from
the browser** under this policy. Three options, each with a real cost (`11` §1.4):

| Option | Cost |
|---|---|
| A — widen `connect-src` | This **is** risk **R-06** (`06`). Any injected script could exfiltrate to any host. Only defensible with a named-provider allowlist, which contradicts "compatible endpoint". |
| B — backend BYOK proxy | The backend currently has **no auth, no storage, no secrets** (verified in `backend/src`). It would become custodian of user keys — which the standing "never collect or retain secrets" constraint argues against — plus an SSRF surface (T-AI-04). It is also on the existing roadmap's non-goals list. |
| C — allowlisted / local endpoints only | Narrow and honest; excludes most hosted providers, includes `*.workers.dev`. |

**Recommendation: none selected — do not decide this now.** Option C is the only one compatible with
today's security posture without new decisions, and it is worth noting that the cheapest correct
answer may be "defer the phase". This is a security-architecture decision, not an implementation
detail.

### Q26. Should the AI phase ever see portfolio data in Phase 2, or ship public-data only?

**Context.** Private-class tools (T9–T12) make the assistant far more useful and also mean private
account aggregates are transmitted to a third-party provider. The egress model (`11` §1.3) makes this
a per-tool decision, so both are buildable.

**Recommendation: public-data only in the first release**, with U-class tools behind an explicit,
separately consented switch — and only after the provider/transport question (Q25) is settled. This
keeps the first AI surface's worst-case failure at "bad market analysis", not "leaked portfolio".

### Q27. Is the AI phase in scope for this programme at all?

**Options.** (1) In scope after Stage 4, as a gated phase. (2) Explicitly deferred with no date.
(3) Dropped.

**Recommendation: option 2 — recorded and bounded, no target date.** It keeps the idea from being lost
and keeps it from competing with the wallet-first work. `11` exists so that "we'll think about AI
later" has a concrete starting point and a threat model already written; it is **not** a queue entry.

---

# WALLET / EXCHANGE AUTHENTICATION — added 2026-10-27 (see `12` §4)

### Q28. Stage 2a scope: wallet connection alone, or connection + SIWE login in one release?

**Context.** `12` §4 establishes that these are three separate things: (1) wallet connection proves an
origin can see an address; (2) exchange authentication is a server-issued SIWE challenge exchanged for
a **bearer token**; (3) account authorization is whatever that token may read. PolyTools has **none of
the three** today — the only match for "wallet" in the tree is a marketing link card describing the
*exchange's* sign-in options (`Hub.tsx:36`).

**Options.** (1) Ship connection alone as its own increment, login behind a flag. (2) Ship both
together. (3) Defer both until after browser/mobile validation.

**Recommendation: option 1**, with login in the same release train behind a flag. Connection alone is
cheap, reversible, and gives the wallet-first shell without touching the licence question or the
origin-binding problem. Option 3 is defensible if NBA-3 (browser validation) has not been done.

### Q29. Which origin(s) may request a SIWE challenge?

**Evidence.** `createWalletChallenge({ smartAccountAddress, signerAddress, uri })` requires `uri` to be
a bare HTTP(S) origin — no path, query, fragment or userinfo, ≤2048 chars. The message is
**origin-bound**, so a preview host, a staging host, and a custom domain are different origins.

**Options.** (1) One canonical production origin only. (2) An explicit allowlist including preview
and staging. (3) Per-deployment configuration.

**Recommendation: option 2, written down before Stage 2b starts** — otherwise login cannot be tested
anywhere except production, which is the worst place to discover it does not work.

### Q30. Do you accept EOA-only wallet support for launch?

**Evidence.** `AccountSigner.signMessage` must return the **owner EOA's raw 65-byte EIP-191
signature**; *"login rejects Safe/ERC-6492 wrapped signatures"*. Smart-contract and some embedded
wallets cannot satisfy this. Any promise of "Google/email embedded wallet" sign-in is therefore
**not** supported by the login path.

**Options.** (1) EOA-only, stated plainly in the UI. (2) Add a supported embedded-wallet provider that
can produce a raw EOA signature. (3) Keep API keys as the only private-data path for now.

**Recommendation: option 1 for launch**, with the limitation surfaced *before* the user connects —
a wallet that connects but cannot log in is worse than no wallet option.

