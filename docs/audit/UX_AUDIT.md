# UX and accessibility audit

## 1. Scope and confidence

This is a static review of every route, shared layout/UI, account state/action, responsive CSS, and reduced-motion CSS. It includes deterministic source checks and CSS contrast calculations. It is **not** a browser, device, screen-reader, or full WCAG conformance audit.

Priorities below are planning priorities, not claims of observed user harm:

- **P1:** address before broad release claims or when the affected workflow is promoted.
- **P2:** concrete correctness, comprehension, or accessibility follow-up.
- **P3:** lower-risk polish, consistency, or empty-state work.

All findings are **Confirmed** from current source unless explicitly marked **Likely** or **Unknown / Not verified**.

## 2. What already works well in the code

- Public and private destinations have distinct names: public Book/Tape versus private Orders/Your Trades. Money Movements makes private history and public exact-ID lookup separate choices.
- Locked, loading, denied, malformed, stale, partial, empty, and not-loaded account states have different copy; missing financial data is not presented as zero.
- Private reads require explicit activation, and the UI warns that live compatibility remains unverified.
- Actual execution fees are labeled separately from current fee-rate scenarios and from P&L.
- Exports require confirmation and show dataset, format, and coverage.
- `OrderDetailsDrawer` implements dialog labeling, Escape handling, initial focus, focus containment, and focus restoration; it is a useful reference for shared overlays.
- Global CSS includes a skip link, `:focus-visible` styling, 44 px account tabs, and `prefers-reduced-motion` handling.
- `CandleChart` has keyboard arrow inspection. Book also exposes a textual ladder alongside its depth visualization.
- Several controls have explicit `aria-pressed`, `aria-expanded`, `aria-sort`, `role="status"`, or `role="alert"`; the findings below are inconsistencies rather than an absence of all accessibility work.

## 3. Account workflow findings

### UX-A1 — View-specific Load labels hide broad request scope and a public-catalog dependency

**Priority:** P1
**Evidence:** `apps/web/src/components/AccountAnalytics.tsx` (`load`), `packages/core/src/account/data.ts` (`loadAll`, `loadBalanceHistory`, `loadOpenOrders`).

Every account analytics Load first retrieves and validates the unsigned official spot catalog and applies clock offset, then starts broad `loadAll()` plus separate balance-history/open-order reads. Consequently:

- “Load your trades” and “Load your orders” do not describe the actual request scope;
- an unrelated catalog failure can prevent balances or transfers from loading;
- users cannot tell from the button why unrelated datasets are requested.

**Recommendation:** either make request scope genuinely view-specific while preserving independent permission/coverage states, or rename the action and explain the shared load. Decouple non-fill views from catalog availability. Add failure-independence tests before changing behavior.

### UX-A2 — Account-section navigation discards imported history and R3 work

**Priority:** P2
**Evidence:** conditional `AccountAnalytics` mounts in `apps/web/src/pages/Portfolio.tsx`; coordinator disposal in `AccountAnalytics.tsx` and `data.ts`.

Switching account sections unmounts the active analytics component. Its coordinator, in-memory snapshot, cursor-import results, and component-local R3 inputs are not carried to another section. This is safe for privacy but can surprise a user who imports history, opens another account tab, and returns.

**Recommendation:** first add a lifecycle regression test and decide whether session-scoped retention is desired. If retained, lift state without weakening lock/wipe/account partitioning. If disposal is intentional, tell users before they leave a long import or manual R3 workflow. Do not add persistent private storage as a shortcut.

### UX-A3 — R2 cancellation is safe but silent

**Priority:** P3
**Evidence:** `AccountAnalytics.tsx` (`importHistory`, `cancelImport`).

Cancellation aborts the next-page chain and preserves the previous snapshot. Unlike an error, it has no explicit “Import cancelled; previous snapshot retained” status. Progress can simply stop being active.

**Recommendation:** add a non-error cancellation notice and a source/SSR test, then a browser test for the live control. Do not change the snapshot-preservation behavior.

### UX-A4 — Account copy has several concrete mismatches

**Priority:** P2
**Evidence:** `Portfolio.tsx`, `AccountCostBasis.tsx`, `components/Glossary.tsx`, `components/Layout.tsx`, `README.md`.

- The P&L header says profit is not calculated until current valuations are available, but realized P&L deliberately does not require a current mark.
- The glossary says read-only means only public market/bridge data, omitting authenticated read-only account views.
- The global footer applies `raw ÷ 10³` on exact-decimal account pages; that is the public-market wire conversion, not a universal account-amount rule.
- Trades and Orders omit the `PageHeader`—and therefore its “Lock now” action—while other account sections expose it.
- README describes P&L only as unavailable and does not mention the experimental R3 path.

**Recommendation:** make narrow copy/navigation consistency changes with SSR assertions. Keep the stronger statement that unrealized/total P&L need fresh marks and that all R3 outputs need their other gates.

### UX-A5 — R3 needs assisted-workflow clarity, not simpler gates

**Priority:** P1 before production/tax positioning
**Evidence:** `AccountCostBasis.tsx`, `packages/core/src/account/lots.ts`, R3 SSR/source tests.

The UI exposes opening lots, opening-zero attestation, transfer decisions, and manual marks, but current tests do not drive a complete successful browser workflow. Manual provenance is not independently reconciled to statements, and unified transfer rows are not automatically one-to-one fill/leg matches.

**Recommendation:** label the result “user-assisted estimate” until independently reconciled; add interactive successful and blocked workflows. Preserve all fail-closed accounting gates. Do not respond by auto-assigning basis, treating missing flows as zero, or manufacturing live marks.

## 4. Public-route correctness and comprehension findings

### UX-P1 — Dashboard Book opens private Orders

**Priority:** P2
**Evidence:** `apps/web/src/pages/Dashboard.tsx` (`openTool(m.symbol, "/account/order-book", e)`); `Portfolio.tsx` maps that alias to Orders.

The row action title says “Open … Order Book,” but it navigates to the private Orders section rather than public `/book`.

**Recommendation:** change the destination to `/book` and add a route-action regression test that also verifies the selected symbol. Keep `/account/order-book` as a private legacy alias unless separately reviewed.

### UX-P2 — Quote notionals are presented as dollars in several public tools

**Priority:** P2
**Evidence:** `Tape.tsx`, `Book.tsx`, `Heatmap.tsx`, `components/DepthChart.tsx`.

Several `price × quantity` values are formatted with `$` even though the listed market's quote asset can be something other than USD/USDT/USDC. Compare is more careful: it limits direct matching to USDT/USDC and labels other quote cases.

**Recommendation:** carry the actual quote asset into notional formatting. Reserve `$` and USD labels for values whose contract really is USD-denominated, such as an explicitly named `volume24hUsd` field. Add a non-USD-quote fixture.

### UX-P3 — Heatmap misclassifies a flat non-zero book as no liquidity

**Priority:** P2
**Evidence:** `apps/web/src/pages/Heatmap.tsx` decoding logic returns no decoded dataset when `maxPx <= minPx`.

A valid book whose non-zero levels all share one price can have `maxPx === minPx`. The UI can then say there is no non-zero resting liquidity even though non-zero points exist.

**Recommendation:** distinguish “no points/non-zero quantities” from “not enough price span to draw a multi-row heatmap.” Render a single-band view or a precise explanation. Add empty, zero-only, single-price, and normal fixtures.

### UX-P4 — Compare's Matched filter cannot show a true zero-match state

**Priority:** P3
**Evidence:** `apps/web/src/pages/Compare.tsx` (`visibleRows`).

When Matched is selected but `matchedRows` is empty, the table falls back to all rows. That makes the selected filter and displayed rows disagree. In development, “Live Match” wording also deserves caution when the global data source is labeled wire samples.

**Recommendation:** show an explicit zero-match empty state and include data provenance in match wording. Test matched, unmatched-only, malformed-price, and wire-sample states.

### UX-P5 — Calculator live sync can overwrite manual input

**Priority:** P2
**Evidence:** `apps/web/src/pages/Calc.tsx` converter `useEffect` depends on `live` and calls `setConvPrice(live)` on every live-price change, despite its “first arrives” comment.

A manually entered reference price can be replaced by the next poll. Other calculator copy also overstates precision/model certainty: “exact position size” uses JS numbers, and the toy liquidation sketch says actual liquidation occurs slightly closer without establishing a Polyester model.

**Recommendation:** sync only on explicit action or until the user edits the field; label floating-point estimates as estimates; keep the toy model free of directional claims about actual exchange liquidation. Add fake-timer/poll tests for manual override.

### UX-P6 — Hub diagnostics use defaults as if they were telemetry

**Priority:** P2
**Evidence:** `apps/web/src/pages/Hub.tsx`.

When data is missing, the page displays `19 pairs`, defaults testnet `mcpConfigured` to `true`, mainnet to `false`, and cache counts to `0`. Those values can look like current diagnostics even when `/api/env` or market metadata is unavailable.

**Recommendation:** use Pending/Unavailable/Unknown for absent telemetry and reserve numbers/booleans for actual responses. Add loading, error, empty, and partial-response SSR tests.

### UX-P7 — SDK generator is presented as ready-to-run without validating generated trading input

**Priority:** P1 before promoting the generator
**Evidence:** `apps/web/src/pages/SdkGuide.tsx` (`generatedCode`, `syncLivePriceToOrder`).

Quantity, price, and key ID are interpolated directly into snippets without decimal/tick/step/minimum validation. Live price uses `toFixed(2)` regardless of pair precision. The snippets are not compiled in tests. “Safe post-only” only describes one order constraint; running the copied code still places and then attempts to cancel a real testnet order.

**Recommendation:** state clearly that PolyTools does not execute the snippet and that running it externally causes testnet mutations. Validate/quote inputs, use pair constraints, and compile pinned examples in isolated tests. Do not add order execution to PolyTools itself.

### UX-P8 — Smaller copy and empty-state inconsistencies

**Priority:** P3

- **Zipper:** “Verified contract addresses” is stronger than the UI's loaded-config evidence; the illustrative net calculation is deposit-oriented while minimum-withdraw data is also shown. Evidence: `Zipper.tsx`.
- **Flow deep link:** `/flow?...` preserves the query but lands on private Money Movements by default, requiring an extra Public lookup selection. Evidence: `App.tsx`, `Portfolio.tsx`, `Flow.tsx`.
- **Brand filters:** zero token/avatar matches produce an empty grid rather than a useful empty state. Evidence: `BrandKit.tsx`.
- **Clipboard:** `CopyButton` swallows clipboard failure, so the visible state gives no failure explanation. Evidence: `components/ui.tsx`.

These should be small, testable content/state fixes, not new features.

## 5. Accessibility findings

### A11Y-1 — Shared modal and mobile-navigation focus management is incomplete

**Priority:** P1
**Evidence:** `components/ui.tsx` (`ConfirmDialog`), `components/Glossary.tsx`, `components/Layout.tsx`, responsive `.sidebar` CSS.

`ConfirmDialog` and Glossary use `aria-modal="true"` and Escape handling but do not trap focus or restore it to the opener. Glossary autofocuses its search input and ConfirmDialog autofocuses Cancel, which is only part of the requirement. Background content is not made inert by these components.

At mobile widths, the closed sidebar is moved off-screen with a transform but remains mounted without `inert`/hidden focus management; keyboard focus can therefore potentially enter off-screen navigation. The open mobile menu also lacks the focus containment/restoration found in the order drawer. Actual tab order remains **browser-unverified**, but the source does not establish the required behavior.

**Recommendation:** extract the proven order-drawer focus pattern into a tested shared utility; apply it consistently to dialogs, glossary, and mobile navigation. Test opener restoration, Escape, backdrop click, nested overlays, and route changes.

### A11Y-2 — Meaningful text tokens have measured contrast below 4.5:1

**Priority:** P1
**Evidence:** `apps/web/src/styles.css`; deterministic luminance calculation recorded in `TEST_AND_VERIFICATION.md`.

Examples include dark `muted` on surface at 3.83:1, dark `faint` on surface at 2.40:1, light `faint` on surface at 2.56:1, light `up` on surface at 3.77:1, and light `warn` on surface at 3.19:1. These tokens appear in meaningful small text, not only decoration.

**Recommendation:** introduce accessible text-token roles rather than globally recoloring every semantic surface without review. Verify normal text at 4.5:1, large text at 3:1, and control/focus boundaries at applicable non-text thresholds in both themes. Then run a real accessibility scan and manual review.

### A11Y-3 — Dashboard nests interactive controls

**Priority:** P2
**Evidence:** `Dashboard.tsx`.

A table row has `role="button"`, `tabIndex=0`, and keyboard activation while containing watchlist and action buttons. Its row key handler does not exclude bubbled key events from those controls. Sort buttons can also contain a `TermTip` button, producing nested button semantics.

**Recommendation:** use a real chart link in the market cell and keep row actions as independent controls, or strictly separate event/semantic regions. Put glossary triggers outside sort buttons. Test Enter, Space, screen-reader announcement, and watchlist/action activation.

### A11Y-4 — Visualization access is uneven

**Priority:** P2
**Evidence:** `Heatmap.tsx`, `components/DepthChart.tsx`, `components/CandleChart.tsx`.

Heatmap cell inspection is pointer/touch-oriented and its band table is only a partial alternative. Depth inspection is pointer-oriented but has a fuller ladder alternative. Candle arrows are implemented, but changing OHLC values are not explicitly managed as a live announcement.

**Recommendation:** provide keyboard inspection and a concise textual summary/table alternative appropriate to each visualization. Validate with keyboard-only and screen-reader users rather than adding ARIA alone.

### A11Y-5 — Tab/menu/live-region semantics need targeted cleanup

**Priority:** P2–P3
**Evidence:** `BrandKit.tsx`, `Portfolio.tsx`, `Layout.tsx`, `components/ui.tsx`.

- Brand section filters and key-creation mode use `tablist`/`tab` without associated tabpanels, roving tabindex, or arrow-key behavior. If these are simply action/filter groups, `role="group"` with pressed/current state may be more honest.
- The brand context menu has menu roles but no menu keyboard model or initial menu focus.
- `CopyButton` computes `aria-label={`Copy ${label}`}`; with the default `label="Copy"`, the accessible name is “Copy Copy.”
- The Hub countdown updates a polite live region every second, which can cause excessive announcements.

**Recommendation:** use semantics that match behavior, add keyboard tests, make copy names concise, and remove per-second live announcement or announce only meaningful milestones.

## 6. Responsive and motion review

**Confirmed:**

- Breakpoints at 960 px and 600 px change sidebar, tables, metrics, and visibility classes.
- Account tabs are horizontally scrollable and have 44 px minimum height.
- A global reduced-motion rule effectively disables animations/transitions.
- Tables use overflow containers in several dense views.

**Unknown / Not verified:**

- actual 320/375/768/960 px reflow, 200%/400% zoom, long translated strings, landscape mobile, touch target spacing, horizontal page overflow, and sticky drawer behavior;
- whether off-screen/transformed content is exposed to keyboard and assistive technology in each browser;
- forced-colors mode and color-independent interpretation of every status.

Do not claim mobile or WCAG certification from the CSS alone.

## 7. Suggested focused regression set

1. Dashboard Book destination and independent keyboard activation of row/star/action controls.
2. Non-USD quote notional labels across Tape, Book, Heatmap, and DepthChart.
3. Heatmap empty, zero-only, single-price, and ordinary books.
4. Compare zero-match and wire-sample provenance.
5. Calculator manual converter value across a live poll.
6. Hub loading/error telemetry without fallback facts.
7. Shared overlay focus trap/restore and mobile closed/open navigation tab order.
8. Both themes' text-token contrast and a screen-reader pass for countdowns, dynamic charts, and account statuses.
9. Account Load failure independence, R2 cancellation notice, section-state decision, and complete R3 browser workflow.
