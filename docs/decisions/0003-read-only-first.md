# 0003 — Read-only first; trading deferred

- **Status:** Accepted
- **Date:** 2026-10-25 (recorded 2026-11-02)

## Context

Polyap is useful today as market and account research. Trading from a third-party app would need a
delegated, trading-scoped key authorised by one wallet signature and, to earn anything, a per-order
fee field. Polyester exposes neither (its guard signer covers funding whitelists only, and no
builder/integrator fee exists in the contracts). Shipping a control that cannot work has been the
project's most expensive failure mode.

## Decision

- No order placement, cancellation, transfer, withdrawal, or key/policy mutation in the app.
- Read-only is structural: account requests must match the GET allowlist `READ_ONLY_OPERATIONS` or
  the vault refuses to sign; `tests/api-surface.test.mjs` asserts no SDK write method is called.
- No "coming soon" trade buttons and no fee plumbing.

## Consequences

- Trading stays on the roadmap, gated on exchange capabilities and a separate approval. When it
  comes, mutations go through one reviewed gate module, and the read-only guard is replaced
  deliberately, not removed.
- The optional Telegram alert cron is an outbound side effect, documented as such; it is not an
  account action.
