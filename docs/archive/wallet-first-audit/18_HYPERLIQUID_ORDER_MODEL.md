# 18 — How Hyperliquid apps take orders and fees, and what that means here

Written because the question was: if Hyperliquid's orders are on-chain, why can't
PolyTools read Polyester's the same way — and how do other apps earn a fee?

Researched from Hyperliquid's own docs and the official Python SDK, not from memory.

## 1. Correction first

I told you open orders can *never* come from a chain, and that anyone saying
otherwise was describing a different architecture. **That was too strong, and
Hyperliquid is the counterexample.**

Hyperliquid's order book is genuinely on-chain. `HyperCore` runs the matching
engine inside consensus: every order, cancel, fill and liquidation is chain state,
finalised in one block at roughly 200k orders/second. There is no off-chain
matching engine with periodic settlement.

So if Polyester moved its book into consensus the same way, open orders *would*
become readable by address, with no login. Your hypothesis is sound.

The corrected statement: orders are on-chain **on Hyperliquid**, and off-chain
**on Polyester today** — because trading balances there are ledger entries, and the
trading interfaces explicitly do not move funds on-chain.

## 2. But on-chain orders are not how apps get orders

This is the part that matters, and it is easy to miss.

No working Hyperliquid app reads orders off the chain to trade. They do this:

```
user's main wallet  ──signs──▶  approveAgent        (once; ephemeral key may trade)
user's main wallet  ──signs──▶  approveBuilderFee   (once; sets a max fee rate)
                                          │
                    app signs each order locally with the agent key
                                          │
                                          ▼
                    order carries {"b": builderAddress, "f": feeTenthsOfBp}
```

Three facts from the official sources:

- **The agent key cannot withdraw.** It is authorised for trading actions only, and
  lives for a session or up to 180 days.
- **The agent key cannot approve the builder fee.** The SDK throws an explicit
  error for this: *"Only the main wallet has permission to approve a builder fee."*
  Approval is a main-wallet signature, and it is revocable.
- **The fee is per order**, in tenths of a basis point, capped at 0.1% on perps and
  1% on spot, with at most 10 active builder approvals per user. The builder needs
  ≥100 USDC of perps account value.

**The important consequence: there is no account login anywhere in that flow.**

Two wallet signatures replace it — one delegating a trading key, one approving a
fee ceiling. Everything after that is the app signing locally. That is precisely the
problem PolyTools has been fighting, and Hyperliquid solved it without a session at
all.

## 3. What Polyester has, and what it lacks

Measured against the protobuf contracts and the published developer docs.

| Piece | Hyperliquid | Polyester today |
| --- | --- | --- |
| Delegated trading key | agent wallet, trading-scoped | **no.** API keys exist, but creating one requires an interactive JWT session — so it needs login first |
| Delegated on-chain signer | agent wallet | **partial.** `GuardSignerWallet` signs whitelist mutations only — not orders |
| Fee on routed orders | builder code, per order | **no.** Zero `builder`/`integrator`/`fee_bps` fields in the contracts; `fee_asset` only picks which asset pays the existing fee |
| Order matching | in consensus | off-chain; `orders.v1.Orders` service, ledger balances |

So Polyester has the *shape* of delegated signing (guard signer, delegated Funding)
but scoped to whitelists and transfers, never to orders — and no fee mechanism at
all.

## 4. What this changes about the ask

The question to Polyester is no longer "can I log users in". It is two narrower,
concrete things, both of which they already do in a neighbouring area:

1. **A trading-scoped delegated key a user authorises with one signature**, not an
   interactive session. They already ship `GuardSignerWallet` for whitelist
   mutations and delegated Funding access; this is the same primitive pointed at
   `orders.v1.Orders`.
2. **A per-order fee field**, the way Hyperliquid's `builder` works. Without it
   there is no supported way to earn from routed orders, whatever the login story.

If neither appears, "let users trade from my app and take a fee" is not buildable —
not because of effort, but because the exchange exposes neither the delegation nor
the fee.

## 5. On waiting for a one-month-old exchange to add it

Plausible, and worth watching — but plan for the shape of the change, not a date:

- Orders moving on-chain is a **consensus-level** change. Hyperliquid built a
  purpose-built L1 to do it; Polyester runs on EVM chains with a smart-account
  model. This is not a sprint.
- Even after it lands, **placing** an order still needs a delegated key. On-chain
  visibility gives you reads, not writes.
- The fee mechanism is a **contract change**, independent of the matching engine.

So watch for an agent-key or builder-fee announcement specifically. Orders appearing
in an explorer would help the read-only view, and would not by itself make trading
from a third-party app possible.

## 6. What was not built, and why

No order placement, no fee plumbing, no "coming soon" trade button. Every part of
that path is gated on capability the exchange does not expose, and shipping a
control that cannot work is the failure mode this project has already spent several
rounds recovering from. The read-only product stands on its own until one of the two
items in §4 exists.
