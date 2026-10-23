# Account analytics and financial formulas

**Status:** normative calculation specification; no implementation yet  
**Evidence legend:** [00 §2](./00_CURRENT_STATE.md#2-evidence-language-used-by-all-eight-reports)  
**Primary inputs:** friendly REST decimal strings and the source-verified fields in [01](./01_OFFICIAL_API_CAPABILITY_MATRIX.md). Private response schemas and completeness remain live-verification items.

## 1. Metric truth levels

Every metric belongs to one of these levels in code, UI, and exports:

| Level | Meaning | Examples |
| --- | --- | --- |
| **Observed** | Directly returned by an endpoint or exact arithmetic within explicitly loaded rows. | Asset balance components, fill notional, observed quote cash flow, actual fee by asset. |
| **Sampled valuation** | Server-computed equity at sampled times; not a transaction ledger. | Equity history, sampled equity change, sampled drawdown. |
| **Cost-basis derived** | Requires complete fills, opening lots, and resolved non-fill inventory flows. | FIFO/average realized P&L, remaining cost, unrealized P&L. |
| **Unavailable / blocked** | Inputs, permission, coverage, quote consistency, basis, or mark are insufficient. | Historical P&L on partial history; consolidated mixed-quote fees without FX. |

A lower level cannot be promoted by renaming it. In particular:

- Deposits are capital flows, **not profit**.
- Equity change is **not automatically P&L**.
- Net quote cash flow is **not automatically P&L**.
- Trading fees are protocol/transaction costs, **not token burns**.
- Current effective fee rates are not historical fee rates.
- Current balances prove quantities, not cost basis.

## 2. Exact decimal arithmetic

### 2.1 Internal representation

Friendly REST already returns human-friendly decimal strings. Never apply ConnectRPC scale divisors to them.

Use an exact decimal parser and arbitrary-precision arithmetic:

- Accept only contract-valid base-10 decimal strings; reject empty, `NaN`, infinity, locale separators, and unexpected exponent notation rather than using `parseFloat`.
- Preserve the original string for export/audit.
- Represent values as an integer numerator and positive integer denominator (`BigInt` rational), or as exact decimal integers with a common scale where no division has occurred.
- Addition, subtraction, and multiplication remain exact. For recurring division—especially weighted-average lot removal—retain a rational result rather than rounding an intermediate unit cost.
- Normalize zero (including negative zero), reduce fractions periodically, and impose explicit resource limits so malicious/huge responses cannot exhaust memory.
- Convert to JavaScript `Number` only for non-financial display approximations after calculation. Never use it for lot state, fee accounting, dedup identity, cursor values, or aggregate totals.
- Round once at presentation using a documented mode (recommended: half-even), and keep unrounded exact values in the calculation session/export.

Timestamps and 64-bit IDs also require lossless handling. Preserve nanosecond/microsecond timestamps and base58/string IDs as strings or `BigInt`; a JavaScript `Date` is display-only and cannot retain nanoseconds.

### 2.2 Scale rules

- REST amounts/prices/fees: decimal strings as returned; no `1e18`, `1e9`, `1e7`, or `1e4` division.
- Connect-only data, if ever added: ledger `1e18`, balance history `1e7`, equity `1e4`, current contract price ticks `1e9`, pair-specific base quantity scale.
- Fee-rate response values are decimal **percent** strings without `%`: `rate = percent / 100` exactly.
- The official six-versus-nine price-scale conflict does not affect friendly REST decimals. Do not “fix” REST values using either number.

## 3. Coverage and freshness contract

Every dataset and derived metric carries a coverage record conceptually like:

```text
scope: verified local connection session + root/subaccount scope
operation and contract version
requested window and filters
actual earliest/latest observed timestamp
status: complete | filter-complete | partial | stale | denied | unavailable
pages fetched; next cursor exhausted yes/no
rows received / accepted / duplicate / conflicting / unknown / dropped
schema or scale errors
opening-basis status: proven-zero | supplied | carried-forward | unknown
non-fill-flow status: resolved | unresolved | not-required
source timestamps and local retrieval time
```

### 3.1 “Complete” has a narrow meaning

A dataset can be called **complete** only for a stated scope, operation, filter set, and window when:

1. Every page was requested with identical scope/filters/bounds/sort and the opaque cursor was followed until the server returned an empty next token.
2. No row was dropped, silently filtered, unknown, malformed, duplicated with conflicting content, or rejected for scale/timestamp reasons.
3. All required dependent datasets also satisfy their required coverage.
4. The result is fresh enough for its label, and known eventual-consistency/reconciliation checks have not failed.

A response with no rows and no next token can be a complete empty result **for that query**. It does not prove that an order projection has reconciled or that the account has never traded.

**Filter-complete is not since-inception complete.** A completed 30-day BTC-USDT query says nothing about other markets, earlier fills, other subaccounts, or opening cost basis.

A cursor cap, time cap, page cap, aborted request, unknown catalog symbol, denied scope, or failed page makes the result partial. Do not silently return a total from the loaded prefix. If a descriptive subtotal is useful, label it “Observed in N loaded rows” and retain the partial badge.

### 3.2 Deduplication before arithmetic

- Fill key: account scope + `symbol + matchId + orderId`. Repeated identical rows collapse; repeated keys with different financial fields are conflicts and block affected calculations.
- Order key: physical `orderId`; retain higher `version`, require equal versions to be financially identical, and preserve lineage/generation. Do not sum cumulative quantities across replacement generations as new fills.
- Optional settlement legs: deduplicate by `txId`; conflicts block reconciliation.
- Unified transfer rows have no single documented unique leg ID. Do not invent one from display fields or delete repeated amounts automatically. Cursor exclusivity, link/flow semantics, and any duplicate detection need fixture/live verification.
- Use fills as the source for fill cash flows and actual fill fees. Do not add the same trade settlement/fee again from unified transfers or `includeTransfers` responses.

## 4. Balances and allocation

For each asset `a`:

```text
totalBalance[a] = trading[a] + funding[a]
```

`reserved` and `available` are displayed as separate returned attributes. They are **not added again**:

- `reserved` describes reservations within the trading bucket.
- `available` already accounts for active reservations.
- Holds are not another asset balance to add.

**Example:** trading `2.5`, funding `1.25`, reserved `0.5`, available `2.0` gives total `3.75`, not `4.25`, `5.75`, or another combination.

### 4.1 Valuation and allocation weights

Balances alone do not provide USDT value. For an allocation chart, use one complete, consistently timed value vector:

```text
allocationWeight[i] = value[i] / Σ(value[j])
```

Requirements:

- All values use the same quote asset and timestamp/sample.
- The denominator is positive and all groups are present, including an `OTHER` group when supplied.
- Choose account-bucket grouping **or** asset grouping, never sum both.
- Label server equity-history allocation as “Latest sampled allocation,” with the sample timestamp.
- If using current public marks instead, label mark source/type/time and compute each value as `quantity × mark`; unavailable/stale marks make the affected total and weights unavailable.

Do not treat the latest history sample as live current equity.

## 5. Equity-history metrics

Let `E[i]` be total sampled equity in the response's USDT quote at aligned index `i`, using one complete grouping.

```text
sampledEquityChange = E[end] - E[start]
sampledEquityChangePercent = (E[end] - E[start]) / E[start] × 100%
```

The percent is unavailable when `E[start] <= 0` or either point is missing/incompatible. Do not divide by zero or substitute the first nonzero point without labeling a different interval.

**Example:** `1000 → 1100` USDT is `+100 USDT` and `+10%` sampled equity change. A 200 USDT deposit during the window means neither 100 nor 10% can be called trading profit. Simply subtracting deposits is not a generally valid historical P&L algorithm: all capital/inventory flows, their timing, and their valuation must be known.

### 5.1 Sampled drawdown

For available samples in chronological order:

```text
runningPeak[i] = max(E[0], …, E[i])
drawdown[i] = (runningPeak[i] - E[i]) / runningPeak[i]
sampledMaxDrawdown = max(drawdown[i])
```

Require `runningPeak[i] > 0`; otherwise that point's percentage drawdown is unavailable. Also show absolute drawdown `runningPeak[i] - E[i]` in USDT when meaningful.

**Example:** samples `100, 120, 90` have running peak 120 at the last point and sampled drawdown `(120-90)/120 = 25%`.

Label this **sampled maximum drawdown**. It can miss intrabucket highs/lows and is not continuous or tick-level maximum drawdown.

### 5.2 Metrics not justified by equity history alone

Do not launch Sharpe ratio, volatility-based annualized returns, time-weighted return, money-weighted return/IRR, or “ROI” from these samples without a separately reviewed model. They require defensible sampling, external-flow timing, annualization, and missing-point rules. They are outside the MVP.

## 6. Fill-level observed calculations

For fill `f` on a market with base asset `B`, quote asset `Q`:

```text
quantity q[f] ≥ 0
execution price p[f] ≥ 0
notional N[f] = q[f] × p[f]       [units: Q]
```

Resolve actual fee magnitude `m[f] ≥ 0`, actual fee asset (`BASE` or `QUOTE`), and `feeIsRebate`. Define signed fee cash effect in its own asset:

```text
signedFee[f] = +m[f]  if feeIsRebate = true   (credit)
signedFee[f] = -m[f]  otherwise               (charge)
```

An unknown/unspecified fee asset on an actual fill blocks affected lot accounting and fee-by-asset aggregates; do not guess it. Contract order defaults do not justify rewriting an anomalous historical row.

### 6.1 Exact base and quote cash-flow deltas

```text
dBase[f]  = (BUY ? +q[f] : -q[f]) + (feeAsset = BASE  ? signedFee[f] : 0)
dQuote[f] = (SELL ? +N[f] : -N[f]) + (feeAsset = QUOTE ? signedFee[f] : 0)
```

Thus:

- Buy + quote charge: base increases by `q`; quote decreases by `N + fee`.
- Buy + base charge: base increases by `q - fee`; quote decreases by `N`.
- Sell + quote charge: base decreases by `q`; quote increases by `N - fee`.
- Rebate in either asset is a credit with the opposite sign to a charge.
- A base-asset fee on a sell contradicts the current contract boundary (sell fees use quote) and must be flagged, not silently accepted.

### 6.2 Observed aggregates

Within one account scope, one market/quote asset, and an explicitly covered fill set:

```text
observedVolume[Q]       = Σ N[f]
observedBaseFlow[B]     = Σ dBase[f]
observedNetQuoteFlow[Q] = Σ dQuote[f]
                       = sells(N) - buys(N) - quoteCharges + quoteRebates
```

`observedNetQuoteFlow` is a **cash-flow metric, not P&L**. It equals cumulative realized P&L only in special proven circumstances—for example a complete ledger with known zero opening and ending inventory and no other relevant quote flows. Until those conditions are proven, use the cash-flow label.

Do not sum notionals, quote flows, or P&L across USDT, USDC, BTC, or other quote assets without a documented historical FX conversion. “All markets” volume must be grouped by quote asset.

## 7. Actual fees, rebates, referrals, and rates

For each actual fee asset `a` independently:

```text
grossFeesCharged[a] = Σ m[f] where not feeIsRebate and feeAsset = a
grossRebates[a]     = Σ m[f] where feeIsRebate and feeAsset = a
netFees[a]          = grossFeesCharged[a] - grossRebates[a]
```

Keep assets separate. `0.8 USDT + 0.000008 BTC` is not `0.800008` of anything. Conversion requires a labeled historical price at each fee timestamp; current prices are not valid historical fee conversion.

Referral-share magnitude on a fill is an allocation associated with the fee/referral program, not an additional credit to the trader whose fill is being analyzed. Do not add it to user income, subtract it from the actual fill fee a second time, or count it as a rebate. Only actual signed fee/rebate fields drive the trader's cash flows.

Current effective fee-rate responses support scenario display only:

```text
scenarioMakerFee[N] = N × makerFeeRatePercent / 100
scenarioTakerFee[N] = N × takerFeeRatePercent / 100
```

Label these “Estimate at current effective rate.” Never reprice historical fills with these rates. A negative maker rate is a rebate scenario; actual historical signs still come from each fill.

There is no basis to call these fees **burns**. No burn metric is specified.

## 8. Cost-basis ledger (gated, post-MVP)

### 8.1 Required ledger boundary

Run a separate lot ledger for:

```text
verified account scope + base asset + one quote asset + cost-basis method
```

The simplest initial boundary is one spot symbol per ledger. Combining the same base across different quote assets requires historical FX for every acquisition/disposal and is unavailable without an official/documented FX source. Combining subaccounts requires resolved internal-transfer basis movement; do not net them implicitly.

Process deduplicated fills in exact execution order using full-precision timestamp plus symbol/match/order tie-breakers. Preserve original identifiers for audit.

### 8.2 Universal gates

Realized P&L is unavailable unless **all** are true:

1. Opening inventory and opening cost are known at ledger start, or opening zero is proven from account inception with complete history.
2. Every fill affecting the ledger is complete for the required interval and deduplicated.
3. Every non-fill base/quote flow that affects inventory/cost is resolved, including deposits, withdrawals, internal transfers, bucket transfers, rebates, and unknown transfer codes.
4. No unknown side, fee asset, amount, timestamp, conflicting duplicate, or unsupported market exists.
5. All values use one quote asset or a fully documented historical FX model.
6. The selected method (FIFO or weighted average) is applied consistently from the opening state.

Unrealized P&L additionally requires remaining quantity/cost from that valid ledger and a fresh, labeled valuation mark.

A current balance is not opening cost basis. A deposit's current value is not automatically its historical basis. An arbitrary 30-day fill export cannot establish opening lots.

### 8.3 Acquisition and disposal interpretation

After applying actual fees:

- If `dBase[f] > 0`, the fill acquires `dBase[f]` base units with total lot cost `-dQuote[f]`.
- If `dBase[f] < 0`, the fill disposes `-dBase[f]` base units and supplies disposal proceeds `dQuote[f]`.

If an acquisition has negative cost, a disposal has negative proceeds, quantity is zero with nonzero consideration, or inventory would become negative, flag an anomalous ledger and block P&L. Do not clamp values to zero.

### 8.4 FIFO

For an acquisition, append a lot:

```text
lot.quantity = dBase[f]
lot.cost     = -dQuote[f]
lot.unitCost = lot.cost / lot.quantity   [exact rational]
```

For a disposal of quantity `s = -dBase[f]`, remove oldest lots first. For each taken amount `t[j]`:

```text
removedCost[j] = lot[j].remainingCostBeforeTake × t[j] / lot[j].quantityBeforeTake
realizedP&L[f] = dQuote[f] - Σ removedCost[j]
```

Reduce each lot quantity and cost proportionally with exact rational arithmetic. If total available lot quantity is less than `s`, basis is incomplete and the ledger stops; do not realize the uncovered portion at zero cost.

### 8.5 Moving weighted average

Maintain exact total remaining quantity `Q` and remaining cost `C`.

Acquisition:

```text
Q' = Q + dBase[f]
C' = C - dQuote[f]
```

Disposal with `s = -dBase[f]`, requiring `Q >= s > 0`:

```text
averageCostBefore = C / Q
removedCost       = s × C / Q
realizedP&L[f]    = dQuote[f] - removedCost
Q'                = Q - s
C'                = C - removedCost
```

Do not round average cost before applying it. If `Q = 0` and a disposal arrives, opening basis/history is incomplete.

### 8.6 Remaining cost and unrealized P&L

After a valid ledger reaches valuation time:

```text
remainingQuantity = Σ openLotQuantity        [or Q for weighted average]
remainingCost     = Σ openLotRemainingCost   [or C]
marketValue       = remainingQuantity × freshMark
unrealizedP&L     = marketValue - remainingCost
totalP&L          = cumulativeRealizedP&L + unrealizedP&L
```

`totalP&L` is available only when both components pass their gates. Show the mark's source, type (last/mid/other officially defined value), quote asset, and timestamp. If the mark is stale, label the result stale or suppress it according to the freshness policy; never call it current.

### 8.7 Resolving non-fill flows

Use unified transfers for reconciliation, not as a second copy of fill accounting.

| Flow | Required treatment |
| --- | --- |
| Funding ↔ trading bucket in the same combined account scope | No change to combined total inventory; track bucket views separately if needed. |
| Base-asset deposit from outside the analyzed scope | Adds inventory but needs documented cost basis/source. Current price is not an acceptable silent substitute. Unresolved basis blocks future P&L. |
| Base-asset withdrawal outside the analyzed scope | Removes inventory under the selected lot method but is not automatically a zero-proceeds sale. Record a non-trade disposal; tax treatment is out of scope. Unresolved destination/basis transfer blocks consolidated accounting. |
| Internal transfer between analyzed subaccounts | Link both legs and carry lots/basis between scope ledgers; cancel it only in a complete aggregate that includes both sides. Unlinked legs remain unresolved. |
| Trade base/quote legs and maker/taker fee legs | Reconcile against fills; never count twice. |
| Rebate | Identify whether already represented by a fill's `feeIsRebate`; otherwise record the actual asset flow and determine whether it affects basis before enabling P&L. |
| Withdraw request/network fee | Actual asset cost/flow, distinct from principal and trading fee. Do not call it a burn or silently include it in spot realized P&L without a reviewed model. |
| Unknown/unspecified code or side | Mark coverage incomplete and block dependent P&L; never drop the row. |

Tax lots, chain-specific taxable events, and jurisdiction-specific disposal treatment are explicitly not claimed. The feature is trading analytics, not a tax engine.

## 9. Worked examples

### 9.1 Quote-fee buy then sell (FIFO and average coincide with one lot)

1. Buy `0.01 BTC` at `100,000 USDT`; quote fee charge `0.8 USDT`.

```text
N = 1,000
dBase = +0.01 BTC
dQuote = -(1,000 + 0.8) = -1,000.8 USDT
opening lot = 0.01 BTC costing 1,000.8 USDT
```

2. Sell `0.01 BTC` at `110,000 USDT`; quote fee charge `0.88 USDT`.

```text
N = 1,100
dBase = -0.01 BTC
dQuote = 1,100 - 0.88 = 1,099.12 USDT
removed cost = 1,000.8
realized P&L = 1,099.12 - 1,000.8 = 98.32 USDT
```

Here observed net quote flow is also `98.32`, because this complete example starts and ends flat with no other flows. That equality must not be generalized to partial/open-position accounts.

### 9.2 Base-fee buy

Buy `0.01 BTC` for `1,000 USDT`, with a `0.000008 BTC` charge:

```text
dBase = 0.01 - 0.000008 = 0.009992 BTC
dQuote = -1,000 USDT
new lot = 0.009992 BTC costing 1,000 USDT
```

Using `0.01 BTC` as acquired quantity would overstate inventory. Adding a USDT value for the BTC fee without a historical BTC mark would be invalid.

### 9.3 Maker rebate

Sell `0.02` base for notional `100 USDT`; fee magnitude `0.01 USDT`, `feeIsRebate = true`:

```text
dBase = -0.02
dQuote = 100 + 0.01 = 100.01 USDT
```

The rebate increases proceeds. It is not a positive fee charge and not a burn.

### 9.4 Missing-basis example

Suppose a loaded window contains one buy and one sell, but an earlier base deposit is missing or has unknown basis. Even if the two loaded fills net to zero quantity, FIFO/weighted-average realized P&L is unavailable: the disposal may consume an earlier lot. Display observed volume, actual fees, and net quote flow for the loaded rows, with a clear “not P&L” explanation.

### 9.5 Mixed-asset fees

Two fills charge `0.8 USDT` and `0.000008 BTC`. Report separate fee cards. A consolidated USDT fee total requires a historical BTC/USDT price for the BTC-fee timestamp and an explicit conversion model; otherwise it is unavailable.

## 10. Incomplete-data decision table

| Condition | Allowed display | Forbidden display |
| --- | --- | --- |
| Cursor not exhausted / page cap / aborted page | “Observed in loaded rows” with partial badge | Complete volume, complete activity, since-inception totals, P&L |
| Filtered query fully exhausted | Filter-complete observed metrics naming filter/window | Account-wide or inception-complete claim |
| Permission denied for a dependent dataset | Other independent datasets; denied state | Zero balance, zero fills, successful complete account |
| Empty result with complete query coverage | Zero observed rows for that query | Proof of no lifetime activity or reconciled order state |
| Unknown asset/side/fee/transfer code or scale | Raw/quarantined row and incompatibility warning | Silently dropped row or affected aggregate/P&L |
| Same identity, conflicting financial payload | Conflict error; retain evidence in memory | “Latest wins” without documented version semantics |
| Missing opening lots/cost | Observed fill cash flows and fees | Realized, unrealized, total P&L, ROI |
| Unresolved non-fill inventory flow | Raw activity and unresolved-flow warning | Subsequent lot-based P&L |
| Mixed quote assets without historical FX | Totals grouped by quote asset | One consolidated volume/fee/P&L number |
| Missing/stale mark | Remaining quantity/cost if otherwise valid; stale state | Current market value or current unrealized P&L |
| Latest equity sample only | Latest sampled equity and timestamp | Live equity, realized return, profit |
| Deposit/transfer activity | Capital/activity flow by actual asset | Deposit as income/profit |
| Current effective fee rates | Current scenario estimate | Historical fee recomputation |
| Only a current balance | Quantities and returned buckets | Cost basis, gains, historical performance |

## 11. Required calculation tests

All fixtures are synthetic and independently calculated:

1. Decimal precision beyond IEEE-754, very large/small values, trailing zeros, negative rebates, and no exponent/NaN acceptance.
2. Balance total never adds reserved/available twice.
3. Buy/sell with quote fee, base fee, zero fee, and rebate; exact `dBase`/`dQuote` assertions.
4. Multiple FIFO lots, partial disposal, multiple acquisitions, weighted-average recurring unit cost, and inventory-underflow blocking.
5. Opening-basis absence, arbitrary-window start, unresolved deposit/withdrawal/internal transfer, and unknown flow code all block P&L.
6. Pagination gaps, cursor caps, unknown symbols, conflicting duplicates, replacement generations, and repeated settlement `txId` values.
7. Mixed quote assets and mixed fee assets remain grouped; no silent conversion.
8. Deposits do not increase P&L; equity change and net quote flow are never relabeled automatically.
9. Sampled drawdown with flat, rising, falling, zero/negative starting equity, missing points, and unsorted input.
10. Rounding occurs only at presentation; exported raw values retain exact source strings and coverage metadata.

No test may generate its expected value by calling the same formula being tested. Include hand-calculated vectors such as those above and independent reference calculations where practical.
