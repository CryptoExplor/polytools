# 10 — The Rabby/Hyperliquid pattern vs. what Polyester actually exposes

**Study requested during audit. No implementation.** This document asks one question: *the
Rabby/Hyperliquid pattern is that a wallet client registers a user's wallet against its own referral
code and earns a fee share — can PolyTools do the same on Polyester?*

**Scoping note:** the *mechanism* is documented by Hyperliquid and is real. **Rabby's own
participation is not verified from primary sources** (§1) — treat it as the illustration you
described, not as a confirmed fact about that wallet.

**Short answer: no — and the reason is precise and fixable.** Hyperliquid exposes the referral
registration as a **wallet-signed action that any client can invoke**. Polyester exposes referral
management **only through its own web console**, with no API, RPC, or signed action. The gap is a
missing API primitive, not a UX choice or a missing feature.

> **Status note (2026-10-27).** The exchange developers report that **referral codes are not live
> yet** (`09` §0). That sits *behind* this study's conclusion and does not weaken it: the finding here
> is about a **missing primitive**, which would remain missing even once the console is live. It does
> change the *ordering* of the ask — Q21 (request the primitive) is now lower priority than "is the
> programme live at all?", because a callable action would currently have nothing live to authorize.

---

## 1. What I verified, and what I did not

| Claim | Status |
|---|---|
| Hyperliquid exposes `setReferrer` as a user-signed action any client can submit | **Verified** — Hyperliquid docs + multiple SDKs (`@nktkas/hyperliquid` `setReferrer`, Python `set_referrer`, Go `SetReferrer`, CLI `referral set`) |
| Hyperliquid exposes a *separate* `approveBuilderFee` + per-order builder parameter | **Verified** — Hyperliquid builder-codes docs |
| Hyperliquid referral terms: 4% to referee / referrer earns 10% less discount, $25M / $1B caps, $10k volume to create a code | **Verified** — Hyperliquid referral docs |
| Wallets commonly auto-attach builder-fee approval and set their own referral code on accounts without one | **Verified as an ecosystem pattern** — a widely used client's own documentation states it "by default also tries to approve a 0.01% builder fee for its own builder address … and to set its own referral code on accounts without one" |
| **Rabby specifically** auto-registers its own referral code on Hyperliquid | **Not verified from primary sources.** Rabby is the wallet most commonly recommended for Hyperliquid, and a fee comparison page lists "Rabby charges 0.02%" (consistent with a builder fee). I could not find Rabby's own documentation stating it sets its referral code. Treat your description as **plausible and consistent with the verified pattern**, not as something I confirmed. |

That distinction matters: the *mechanism* is certainly real and widely used. Whether Rabby is one of
the clients doing it is unconfirmed.

---

## 2. How the pattern actually works on Hyperliquid

Two **independent** mechanisms, both requiring a signature from the user's own wallet:

### 2.1 Referral (account-level, one-time)

```
action = { "type": "setReferrer", "code": "RABBYCODE" }
signed = sign_l1_action(wallet=user_wallet, action=action, timestamp=now)
POST https://api.hyperliquid.xyz/exchange
```

- Signed by the **user's main wallet**; costs no gas and moves no funds.
- Binds the code to that **wallet address** permanently.
- Tight window: only settable while the account has no/negligible trading history — sources
  variously state "before your first trade" or "while cumulative volume is under $10k".
- One code per account; not retroactively changeable.
- Referrer earns **10% of referred users' fees, less the discount** ⇒ ≈6% of gross. Discount 4% to
  the referee for their first $25M; referrer rewards run to the referee's first $1B.

### 2.2 Builder fee (order-level, separate)

```
# once, signed by the user's MAIN wallet
{ "type": "approveBuilderFee", "builder": "0x…", "maxFeeRate": <tenths of bps> }

# then on every order
{ "b": "0x…builder…", "f": <fee in tenths of bps> }
```

- User approves a **maximum** fee once; the builder then attaches a fee to each order up to that cap.
- Collected through the same referral-reward claim path.

So Hyperliquid gives a client **two** ways to earn, and — critically — **both are client-invocable
API actions**, not console features. That is what makes the Rabby-style integration possible.

---

## 3. What Polyester exposes instead

| Primitive needed for the Rabby pattern | Hyperliquid | **Polyester** |
|---|---|---|
| Referral program exists | Yes | **Yes** — 4% referee / 15% referrer |
| Referral registration callable by a third-party client | **Yes** — `setReferrer` action | **No** |
| Referral write endpoint in the public API | Yes | **No** — verified below |
| Referral write RPC in the ConnectRPC surface | Yes | **No** |
| Order-level builder fee | **Yes** — `approveBuilderFee` + `b`/`f` | **No** |

### 3.1 Evidence for the "No" column

Run against the canonical public contract bundle (`Fabric-Labs/polyester-proto`, HEAD `b34853c` — the
same version PolyTools pins in `rest.ts:13`):

| Check | Result |
|---|---|
| `grep -rnE "rpc .*[Rr]eferr"` across **all** protos | **NO referral RPC anywhere** |
| Parse both OpenAPI specs; list any endpoint whose path or operation mentions "referr" | **NO referral endpoints** (`rest.openapi.json`, `polyester.openapi.json`) |
| `grep -rniE "referr" proto/public/auth/` | **none** — no referral field in profile/registration/auth |
| `grep -rni "referral"` across the whole bundle | **one** functional hit: `referral_share_amount_e18`, a **read-only output** on fills (`orders_read.proto:300`) |
| `OrderIntent` fields (`orders.proto:161-228`) | **no builder, extra-fee or referral parameter.** It does carry `fee_asset = 21` (*"asset charged for fees, defaults to QUOTE"*) — that selects which asset pays the **standard** fee; it cannot add, redirect or share a fee |

And the official documentation confirms referral management is a **web-console** flow: codes are
created on `/account/referrals`, and a user applies a code by entering it there or arriving via a
link. There is no documented programmatic path.

### 3.2 One place Polyester is *more* permissive than Hyperliquid

Polyester allows **replacing** an existing referral code: *"If their account already has a different
referral code, they can replace it with yours."* Hyperliquid locks at first touch and permits no
changes.

Ironically this makes Polyester's mechanism more flexible — but only for a human in a browser. The
flexibility does not help a client, because there is still no callable action.

---

## 4. Why PolyTools cannot replicate the Rabby pattern today

The blocker is not competence, budget, or wallet access. **PolyTools can already get the user's
signature on arbitrary messages** (the SDK's `AccountSigner.signMessage` is exactly a
wallet-signature primitive, and Stage 2b builds a signer around it). The blocker is that **Polyester
has nothing for that signature to authorize.**

To replicate Rabby against Polyester, all four of these would have to be true, and only the first is:

1. ✅ PolyTools can obtain a wallet signature — **true**.
2. ❌ Polyester defines a signed "set my referrer to X" action — **does not exist**.
3. ❌ Polyester accepts that action from a third-party client — **no such endpoint**.
4. ❌ Polyester permits a third-party app to direct users to its own code — **unverified** (`08` Q16).

The only ways to bridge the gap without Polyester changing:

| Workaround | Verdict |
|---|---|
| Deep-link the user to `/account/referrals` and ask them to paste the code | **Potentially legitimate; terms unverified.** Manual, unmeasurable, high drop-off — but honest, and it collects no credential. Labelling it "ToS-safe" is **not** supported until Fabric Labs confirms the policy in writing (`08` Q16). This is component M-3 in `09` §5. |
| Browser automation / puppeteer driving the console | **Rejected.** Fragile, almost certainly against terms, and would require handling the user's session — a credential risk. |
| Ask the user to sign a message and replay it somewhere | **Rejected.** There is no endpoint to replay it to. Fabricating one would invent an API. |
| Have users set the code once and PolyTools simply *report* nothing | **Allowed but useless** — you can't measure it without the referral analytics API, which also doesn't exist. |

---

## 5. The useful conclusion: this is a concrete feature request

The gap is well-defined, and asking for it is cheap. The ask to Fabric Labs:

> **Expose referral management programmatically, mirroring Hyperliquid's `setReferrer`.**
> Specifically: (a) a user-signed action that binds a referral code to the signer's account,
> (b) a read endpoint returning the authenticated account's current referrer + accrued rewards,
> (c) explicit terms permitting third-party apps to direct users to their own code.
>
> Polyester's existing console flow already permits *replacing* a code, so (a) is a policy
> simplification rather than new state. Hyperliquid's model proves the design works at scale.

If (a)–(c) landed, the Rabby pattern becomes directly implementable — PolyTools already has the
signature primitive — and component M-3 would upgrade from "deep link" to "one-click, disclosed,
user-signed registration."

I have **not** filed this request. That is your call (`08` Q21).

---

## 6. Consent: the part I would not copy from the ecosystem

Several clients set their own referral code "on accounts without one" **by default**. The
Hyperliquid primitive requires a wallet signature, so the user does technically consent — but a
signature prompt that says *"Sign this message"* is not meaningful disclosure that the app has just
taken 15% of their fee spend.

For PolyTools, regardless of what peers do:

- **Never auto-apply.** No "silent" default, no pre-selected code, no auto-signing.
- **Disclose the exact economics before the signature**: "PolyTools earns 15% of the trading fees you
  pay. You get 4% off. You can change this in Polyester's console."
- **Surface the replacement consequence** if Polyester's replaceable-code behaviour is in play: the
  user's current referrer stops earning.
- **Make it visibly reversible** and say so.
- Keep the user's 4% discount framed as **their** benefit, and PolyTools' 15% as the cost of the app.

Any implementation that hides the 15% behind an unlabelled signature prompt is exactly the kind of
monetization the brief prohibits — and it would be trivially auditable anyway, since the referrer is
shown in the user's own console.

---

## 7. Net effect on the plan

| Item | Change |
|---|---|
| `09` builder-fee conclusion | **Unchanged** — still unavailable. Hyperliquid's builder codes do *not* imply Polyester has them; this study reinforces that they are a separate, absent primitive. |
| `09` referral conclusion | **Unchanged in economics**, but the *ceiling* is now precisely explained: not "console-only by policy" but "no callable primitive". |
| Stage M2 | **Deferred, not merely unchanged** — the mechanism is reported not live (`09` §0), so there is nothing to deep-link *to* until a launch trigger fires (`09` §7). The rationale for "not one-click" stands and will still apply after launch. |
| New item | **Q21**: request the referral write action + analytics endpoint + third-party-app permission from Fabric Labs. |

**Bottom line:** you are right that this is how the money is actually captured on Hyperliquid, and
it is the correct model to want. PolyTools already has the half it controls — the wallet signature.
It is missing the half only the exchange can provide: first a live programme, then a callable action.
