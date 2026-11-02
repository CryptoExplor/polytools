# 0006 — Realtime streams refine polling, never replace it

- **Status:** Accepted
- **Date:** 2026-10-31 (recorded 2026-11-02)

## Context

Polyester publishes anonymous Centrifugo channels for order-book deltas, trades and candles, and the
socket accepts a browser origin. Delivery is at-least-once with no guarantee across disconnects, and
sockets die when tabs are suspended. A stream that silently stops while the UI says "Live" is worse
than polling.

## Decision

- The browser connects directly to `wss://api.testnet.polyester.com` for public channels only; the
  CSP lists exactly that socket origin, pinned to `defaultRealtimeUrl()` by a test.
- Polling remains the source of truth. A dead stream falls back to fresh polled data; it never
  freezes the last frame.
- Merge rules are per channel: order-book deltas use SET semantics with gap detection and
  re-snapshot; trades dedupe by `matchId`; candles replace by `tsSec`.
- JSON framing is pinned; protobuf negotiation is refused.
- Retries never stop. Past the failure budget the session keeps a slow lane at the cap, and the
  budget is only restored by a connection that stays subscribed for 30 s. Stopping after five
  failures made any outage longer than about 31 s permanent until the user switched tabs — the pill
  read "Polling", which is indistinguishable from a healthy fallback.
- Every streaming page exposes `data-stream-status` so verification asserts on state, not prose.

## Consequences

- Authenticated traffic does not move to sockets; private channels would need a token and a new
  review.
- Deployments whose CSP lacks the `wss:` source cannot stream (the old root Pages deployment).
- A flapping backend is retried at escalating intervals from every open tab; there is no cross-tab
  coalescing. Three tabs open three sockets. Accepted deliberately — leadership election adds a
  failover path where a throttled background tab can strand a visible one — but it is a stated cost,
  and the line to revisit if the exchange ever documents a per-key socket limit.
