# P2-10 Compare zero-match and provenance behavior

**Date:** 2026-10-25
**Status:** implemented and tested locally; no live-feed or browser verification

## Behavior

- **Matched no longer falls back to All Listed.** `apps/web/src/lib/compare.ts` derives rows and `selectVisibleCompareRows` returns an empty Matched list when there are no valid matches. The empty state offers an explicit **Show All Listed** action instead of silently changing the result set.
- **Empty states are distinct:** listed markets with zero matches show **No matched pairs**; a successfully received empty overview shows **No listed markets**; an unavailable overview shows **No comparison data available**. Initial reference loading does not flash a false zero-match result.
- **Match provenance is explicit:** normal current responses use **Live Match**, actual wire-sample payloads use **Sample Match**, and retained data accompanying either feed error uses **Stale Match**. Sample provenance takes precedence if sample data is also stale. The feed metric says **Sample data · Development wire sample · not live**, and matched-row titles identify the source and retained-data error state.
- **Unavailable values stay unavailable:** non-USD quotes, unmapped assets, missing/zero/negative/non-finite references, and invalid active Polyester prices do not become zero-priced matches. Difference and premium remain `null`/unavailable.
- **Polyester and reference failures are distinguished:** `poly_unavailable` preserves a valid CoinGecko reference while leaving difference/premium unavailable; `ref_unavailable` means no valid USD reference. Existing selected-basis fallback between index and last price is retained.
- **The non-executable disclaimer remains:** CoinGecko USD versus Polyester USDT/USDC testnet comparisons are reference-only and are not represented as executable arbitrage.

No wire sample was added to private account reads, and no live request was used for this work.

## Synthetic coverage

`tests/compare.test.mjs` covers:

1. USDT and USDC matches with exact dollar/basis-point calculations and index/last basis selection.
2. Non-USD quotes and unmapped base assets.
3. Missing, zero, negative, NaN, missing-field, and wrong-type CoinGecko references.
4. Zero/invalid Polyester prices, valid-reference preservation, and index-to-last fallback.
5. A strict zero-match selection versus the explicit All Listed view.
6. Live, wire-sample, stale, and sample-plus-stale labels plus source wiring.
7. SSR zero-match, empty-overview, and unavailable-feed empty states.

## Local verification and limits

- Focused Compare suite: **7/7 passed, 2 suites**.
- Full repository suite: **178/178 passed, 39 suites**.
- Root typechecks and production build passed; `git diff --check` passed.

These are pure-function, source, and SSR checks. No real browser interaction, screen-reader run, live CoinGecko/Polyester response, rate-limit event, or deployed behavior was tested.
