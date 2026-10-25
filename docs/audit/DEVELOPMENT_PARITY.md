# P2-8 development/production parity

**Date:** 2026-10-25
**Status:** implemented locally, uncommitted; review required before publication
**Scope:** public development wire-sample provenance and shared synthetic request-matrix tests only

## Existing behavior and gap

The Vite development middleware first invokes the same backend handler used by production adapters. Only an upstream `502` may fall back to local wire samples. The fixtures are useful for offline development, but some responses rewrite parameters, derive routes, or synthesize not-found behavior. They do not establish production validation, upstream schemas, latency, filtering, pagination, or live availability.

Before this change, the visible sample pill depended on the market-catalog response and was hidden on extra-small screens. A sample returned by another public endpoint did not necessarily set that indicator. Production validation errors already bypassed the fallback because only `502` entered it, but no shared request-matrix regression covered that boundary.

## Implemented changes

- Added shared provenance constants and response-header identification in `apps/web/src/lib/provenance.ts`.
- Development fallback responses now include `X-PolyTools-Data-Source: wire-samples` in addition to their existing body provenance.
- Exported the status-gated fallback helper so tests exercise the actual `502`-only decision used by Vite.
- The browser API client records sample use for success or error responses through the header, with body-provenance detection as a fallback. No credentials or private identifiers are included in this session flag.
- `AppProvider` retains sample use for the current app session and across route navigation. A validated cached sample also triggers the notice after reload. The flag is intentionally not persisted as a durable preference, which would risk a stale warning in a later live session.
- The shared Layout renders a non-dismissible `WireSampleNotice` above the active route. It states that captured/derived public fixtures are not live or production-compatibility evidence and that private account reads never use them.
- No private fallback route, account sample, financial mutation, service worker, or deployment change was added.

## Synthetic request matrix

`tests/development-parity.test.mjs` covers:

- **13 production validation/error cases:** missing/invalid order-book, candle, trade, heatmap, Zipper, Flow parameters, an unknown route, and a disallowed method. Each retains its production status and receives no sample fallback or sample header.
- **12 synthetic 502 fixture cases:** markets, overview, order book, candles, trades, heatmap, Zipper config/routes/compare, and Flow/by-tx/explain. Every response is labeled `wire-samples`; supported symbol/depth/timeframe/side/route parameter shaping is checked.
- **Private-path exclusions:** official spot config/fills and representative private API paths never resolve to fixtures. The official account catalog remains a separate direct `no-store` read.
- **Provenance propagation:** a synthetic response header sets the public API session flag without an Authorization header.
- **SSR/source UI evidence:** the notice is explicit, non-dismissible, and rendered by the shared Layout before the route outlet; cached sample provenance also feeds the session flag.

## Verification

- Focused P2-8 tests: **5/5 passed in 2 suites**.
- Full repository tests: **163/163 passed in 34 suites**.
- Root web/backend typechecks: **passed**.
- Production build: **passed**, 95 modules; the existing large-chunk warning remains (`588.59 kB`, `175.44 kB` gzip).
- `git diff --check`: **passed** on the final working tree.

## Remaining limitations

- No real browser, Vite middleware socket, production deployment, live upstream, or assistive-technology workflow was exercised. Header propagation and persistent route behavior have synthetic/SSR/source evidence, not browser evidence.
- Valid fixture checks do not claim complete production parity. Derived filtering, range handling, pagination, error timing, and upstream schema compatibility remain separately unverified.
- The session notice proves that sample data was used at least once; it does not claim every later response is synthetic. Current market provenance remains separately labeled.
- No PR commit/push, merge, deployment, dependency change, or private caching expansion occurred.

**Next roadmap item:** P2-9 deployment hardening, subject to owner evidence and platform-specific scope. It has not been started by this note.
