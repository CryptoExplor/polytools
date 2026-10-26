# Batch 2 — SDK order validation and tick-size handling

Closes the second half of **P0-4** from `FRONTEND_ROADMAP.md`. Batch 1 shipped the mutation warning; this batch makes the generated order snippet legal before it can be copied.

**Evidence level:** Confirmed in source (this document quotes the changed symbols) · Verified by automated tests · **Not browser-tested**.

---

## 1. The defect

`apps/web/src/pages/SdkGuide.tsx` interpolated the quantity and price inputs straight into runnable TypeScript, Python, and Rust snippets. Three problems:

1. **No constraint checking.** `orderQty` and `orderPrice` were free text. `0.001 BTC` is legal on `BTC-USDT` (`stepSize 0.00000001`, `minQtyBase 0.00001`) and illegal on `AVAX-USDT` (`minQtyBase 0.1`), but the page generated the same snippet for both.
2. **Sub-tick prices.** `syncLivePriceToOrder` used `(livePx * 0.98).toFixed(2)` regardless of the pair, so on a `0.00001`-tick market the "safe" price carried three decimals the exchange would reject.
3. **Silent failure.** An invalid draft produced a snippet that looked authoritative and a `Copy snippet` button that happily copied it.

Constraints were already on screen in the card footer (`tickSize`, `stepSize`, `minNotional`), just not enforced.

## 2. What changed

| File | Change |
|---|---|
| `apps/web/src/lib/orderConstraints.ts` | **New.** Exact decimal helpers (`parseDecimal`, `decimalPlaces`, `compareDecimal`, `multiplyDecimal`, `isMultipleOf`, `roundToTick`) and `validateOrderDraft`, which returns every issue with the rule it breaks. Integer/BigInt arithmetic only — no float rounding, so `0.1 × 0.2` is `0.02`, not `0.020000000000000004`. |
| `apps/web/src/pages/SdkGuide.tsx` | `orderDraft` memo over the current inputs; `orderBlocked` on the order step; the code block is replaced by a `role="alert"` notice listing each reason when blocked; copy is refused; the live-price button snaps to the pair tick (round down for buys, up for sells) instead of `toFixed(2)`; `aria-invalid` / `aria-describedby` link each field to the reasons. |
| `apps/web/src/components/ui.tsx` | `CopyButton` gained an optional `disabled` prop (default `false`, so every existing call site is unchanged) and an accessible label that explains itself when disabled. |
| `tests/sdk-order-constraints.test.mjs` | **New**, 19 assertions: arithmetic, rounding both directions, every rejection path, and the page contract. |

### Rules enforced

- Quantity and price must be plain positive decimals (no sign, exponent, comma, or unit).
- Decimals may not exceed the pair's `stepSize` / `tickSize` precision.
- Values must be exact multiples of `stepSize` / `tickSize`.
- Quantity must meet `minQtyBase`; `qty × price` must meet `minNotionalQuote`.
- If the pair's constraints are not loaded, **nothing is generated**. The stated reason is that an order cannot be validated without them — the page does not fall back to a guess.

One message per field is shown; fields carry `aria-invalid`, and the notice is the `aria-describedby` target.

### What did not change

No request is made, nothing is stored, no accounting code is touched, and `packages/core/` and `backend/` are still untouched. The snippets themselves are character-identical when the draft is valid; only the gate around them is new. Input validation for the **canonical-string inspector** (the second interactive tool on the page) was deliberately left alone — it hashes user-supplied text and never mutates exchange state.

## 3. Verification

| Check | Result |
|---|---|
| `npm test` | **241 / 241**, 55 suites (was 222/52) |
| `npm run typecheck` | pass (web + backend) |
| `npm run build` | pass — 599.15 kB JS / 178.93 kB gzip |
| `npm run check:performance` | pass — JS 599,795 B ≤ 625,000 · gzip 178,583 B ≤ 185,000 · CSS 34,107 B ≤ 40,000 · CSS gzip 6,990 B ≤ 10,000 |
| `npm run check:whitespace` | pass — 175/175 files |

**Budget note.** The initial JS bundle grew from 595,527 B to 599,795 B (+4.3 kB raw, +1.6 kB gzip). The gzip ceiling is 185,000 B, so roughly **6.4 kB of headroom remains** for the whole app. This is the first change in the batch series that meaningfully consumed budget; the next feature that adds a module should check whether code splitting (deferred as P2 work) is now worth doing rather than assuming there is room.

## 4. Browser checks still required

Automated tests can prove the arithmetic and the gating logic. They cannot prove any of the following, so none of it is claimed:

1. At **390 px and 1280 px**, select *4. Place & Cancel Order*: the warning notice sits above the inputs (not below the fold) and the reason list is readable without horizontal scrolling.
2. Type `0.001` on `AVAX-USDT` (minimum `0.1`): the notice appears, `Copy` is disabled, and screen-reader focus/announcement is sensible.
3. Tap **Use Live price** on a `0.00001`-tick market (e.g. `DOGE-USDT`): the price lands on the tick grid and the notice clears.
4. Copy a valid snippet and confirm the pasted values match the inputs exactly and carry no more decimals than the pair allows.
5. Confirm the disabled copy button is not reachable by keyboard in a way that traps focus (it is a native `disabled` button, so it should be skipped).
