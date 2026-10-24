# Local-agent live testnet verification report

- **Evidence status:** sanitized local-agent handoff; not independently rerun in this workspace
- **Target reported:** `https://api.testnet.polyester.com`
- **Mode:** headless, authenticated, read-only GET requests
- **Secrets:** no private key, signature, `.env` contents, raw response body, or balance amount is included
- **Browser CORS:** not established by this headless run
- **P&L:** remains unavailable and unverified

## 1. Provenance

A separate owner-controlled local agent reported that it used its own Ed25519 keypair and registered `ak_...` key ID from a local `.env` to execute the checks below. This workspace did not receive or read those credentials and did not make a competing authenticated request.

The local agent named commit `3f179d5`, but that commit could not be resolved in this repository or on GitHub when the handoff was reviewed. This document therefore records the **reported outcomes**, not an independent attestation about that unseen commit. The corresponding compatibility fixes in this branch were reviewed and tested separately with synthetic fixtures.

## 2. Reported sanitized results

The local agent reported HTTP 200 and schema validation for all eight exact requests listed below.

| Operation | Endpoint | Reported HTTP | Reported outcome | Sanitized schema/row detail |
| --- | --- | ---: | --- | --- |
| `authMe` | `GET /v1/auth/me` | 200 | Success | 5 top-level properties validated; no identity value retained here |
| `balances` | `GET /v1/balances` | 200 | Success | 28 asset-balance rows validated; no amounts retained here |
| `feeRates` | `GET /v1/spot/fee-rates` | 200 | Success | 18 current fee-rate structures validated |
| `ordersOpen` | `GET /v1/orders/open` | 200 | Success | Validated empty result: 0 open orders |
| `ordersHistory` | `GET /v1/orders/history` | 200 | Success | 100 historical-order rows validated |
| `fills` | `GET /v1/spot/trades` | 200 | Success | 100 execution-fill rows validated; 0 quarantined in the tested response |
| `transfers` | `GET /v1/transfers` | 200 | Success | Validated empty result: 0 transfers |
| `equityHistory` | `GET /v1/equity/history/series?range=1d` | 200 | Success | 289 sample points validated; USDT quote and 5-minute buckets reported |

These are evidence for the exact tested headless requests. A successful `authMe` response is not a permission list, and success for one operation does not establish permission or schema compatibility for another.

## 3. Reported compatibility findings

### Signing clock

The local agent reported an initial `401 TIMESTAMP_SKEW` when the client clock exceeded Polyester's documented 10-second acceptance window. Its fix used the unsigned official SpotConfig `tsSec` as a server reference and applied the server-minus-local offset to subsequent signing timestamps.

The corresponding branch implementation:

- keeps the offset in memory only;
- applies it only to signing timestamps, not vault metadata or lock timers;
- retains the process-wide monotonic timestamp allocator;
- rebuilds and signs the same canonical request contract; and
- rejects invalid adjusted clocks rather than emitting a malformed timestamp.

### Fill response representation

The local agent reported that the live friendly REST fill response used a pair string such as `BTC-USDT` in `symbol`, rather than only the numeric catalog `symbolId`. It also reported that an empty settlement-leg `transfers` field could be omitted.

The corresponding validator accepts either catalog alias only when exactly one official market matches. It stores the canonical catalog key for deduplication, retains the friendly pair for display, and treats omitted settlement legs as an omitted empty repeated field. Unknown or ambiguous markets remain quarantined and block affected aggregates.

### Coordinator clock

The local agent also reported forwarding the coordinator's injected clock to its default REST client so response freshness uses the same deterministic clock in synthetic tests.

### Equity range behavior

The local agent reported gateway timeouts for some larger ranges:

| Requested range | Reported result |
| --- | --- |
| `1d` | HTTP 200; 289 samples validated |
| `7d` | HTTP 502 gateway timeout |
| `30d` | HTTP 502 gateway timeout |

The `1d` success must not be generalized to `7d` or `30d`. Those failures remain visible server-availability results; no hidden fallback or silent range substitution is authorized.

## 4. Coverage limits and remaining gates

1. **Pagination completeness is not established by the handoff.** The order-history and fills results each contained 100 rows, but the handoff did not state whether cursors were exhausted, additional pages were fetched, or a page cap was reached. Do not call either result complete history from the row count alone.
2. **Empty results have limited schema coverage.** Zero open orders and zero transfers validate the empty response path, not every possible nonempty row shape.
3. **Only `range=1d` equity succeeded.** Larger-range compatibility remains unresolved after the reported 502 responses.
4. **No numerical fee reconciliation is claimed.** The report validates fill rows but supplies no independently checked execution-fee total. Current fee rates remain a different dataset from actual execution fees.
5. **Browser compatibility remains separate.** A headless success does not prove browser CORS/preflight, exact-origin deployment behavior, nonextractable browser signing, or lock/cross-tab behavior in the target browser.
6. **P&L remains gated.** Authentication and fill schema success do not provide opening basis, complete fills, resolved non-fill flows, or fresh valuation marks.
7. **No financial mutation is needed or authorized.** No order placement, cancellation, transfer, withdrawal, key/policy mutation, or interactive-session acquisition is part of this verification.

## 5. Branch verification separate from the live handoff

After recreating and reviewing the compatibility fixes in this branch, the local synthetic verification passed:

- **56/56 tests across 12 suites** with `npm test`;
- `npm run typecheck`;
- `npm run build`; and
- implementation diff checks.

These branch checks use synthetic keys, fixtures, and fake transport. They support the implementation but are not presented as additional live evidence.

## 6. Remaining evidence to record

For a stronger follow-up report, the owner-controlled agent should retain only sanitized values for:

- operation and exact request range/filter;
- HTTP status and safe error category;
- schema-validation outcome and accepted/quarantined row counts;
- pages fetched, whether the opaque cursor was exhausted, and whether any cap was reached;
- actual execution-fee reconciliation outcome without publishing private amounts; and
- separate browser-origin CORS/preflight results if the web UI is enabled.

The disposable test key should be revoked according to the owner's procedure when testing is complete.
