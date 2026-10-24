# Account analytics frontend specification

**Status:** design/implementation specification only  
**Target:** evolve the existing `/portfolio` route into a beginner-friendly, read-only account area while preserving all public tools.  
**Dependencies:** security gates in [02](./02_ACCOUNT_CONNECTION_AND_SECURITY.md), endpoint gates in [01](./01_OFFICIAL_API_CAPABILITY_MATRIX.md), and metric gates in [03](./03_ANALYTICS_AND_FINANCIAL_FORMULAS.md).

## 1. Product principles

1. **Read-only means read-only.** No order, cancel, transfer, withdrawal, key-management, or policy-management action appears in account analytics.
2. **Connection is optional.** Public markets, calculators, MCP/SDK documentation, and glossary remain usable without a key.
3. **Unknown is not zero.** Denied, unavailable, partial, stale, and genuinely empty states look and read differently.
4. **Cash flow is not profit.** Beginner copy distinguishes deposits, equity changes, observed quote flow, and cost-basis P&L.
5. **One scope at a time.** Root/subaccount selection is explicit; aggregation is offered only when every required scope is complete.
6. **Local and private.** The UI never asks for a session token or offers a shared hosted signer. Lock and Forget are always easy to find.
7. **Progressive disclosure.** A beginner sees plain-language summaries; advanced users can inspect exact source fields and coverage without exposing secrets.

## 2. Information architecture

Keep `/portfolio` for route compatibility and evolve its contents:

| Route | Tab / purpose | MVP |
| --- | --- | --- |
| `/portfolio` | **Overview** — connection, scope, sampled equity, balance highlights, coverage summary | Yes, after gates |
| `/portfolio/balances` | **Balances & equity** — current quantities and sampled history | Yes |
| `/portfolio/orders` | **Orders & fills** — open orders, terminal history, order details, user fills | Yes |
| `/portfolio/activity` | **Activity & fees** — finalized transfers, observed fee totals, current effective rates | Transfers after permission/coverage verification; fees after grant verification |
| `/portfolio/security` | **Connection & security** — vault, capabilities, lock/wipe, migration, documentation | Yes, first implementation area |

Use nested route paths only for these public tab names. Filters may remain in local memory. Never put key IDs, account/subaccount IDs, secrets, signatures, cursors, private raw responses, or opening-basis details in the **PolyTools app URL/query/hash**. Official API scope/cursor parameters remain in-memory request inputs and are never reflected into the app URL.

The current arbitrary request-signing workbench is not the account analytics client. If retained as an advanced SDK utility, it remains separate, gains the same vault protections, and never receives an “execute trade” capability. The new account client is GET-only.

### Global navigation

- Keep the existing `Layout` and public navigation order; label `/portfolio` as **Portfolio** with a small **Read-only** badge.
- Do not show private account labels or balances in the global header on unrelated public pages.
- Within `/portfolio`, show a persistent local connection bar with Lock and scope controls.
- `/sdk` may link to `/portfolio/security` for connection setup, but generated snippets remain text and are not executed.

## 3. Shared account connection bar

Visible on every account tab:

```text
[Locked / Verifying / Connected / Partial / Blocked]
[Scope: Main account ▾]   [Data as of …]   [Refresh]   [Lock]   [Security]
```

Behavior:

- **Scope selector:** “Main account” is the default. Add visible subaccounts only after the list operation and per-scope reads are verified. No “All accounts” option in the first MVP.
- **Refresh:** refreshes only the active tab's datasets, using fresh signatures. It is disabled while locked or while the same refresh is in flight; it does not repeatedly retry auth errors.
- **Lock:** immediately aborts private requests, clears private state, and returns to the locked screen. Late responses cannot repopulate the page.
- **Security:** navigates to `/portfolio/security` without logging the previous private state.
- **Data as of:** per-dataset details in a popover, not one misleading global timestamp. A successful refresh of balances does not make fills fresh.

## 4. Onboarding and connection screens

### 4.1 Disconnected / no vault

Headline: **“View your Polyester testnet account, read-only.”**

Show three short steps:

1. Create a dedicated testnet API key in the official Polyester account UI.
2. Attach only the required read policies; never trading, transfer, or withdrawal writes.
3. Store it in PolyTools' encrypted local vault and verify the connection.

Actions: **Set up read-only connection**, **Open official key guide**, **Continue to public markets**.

Do not show fake sample balances. In development/test only, a clearly separated **Load synthetic fixture** control may exist outside production builds; every fixture screen retains a `FIXTURE — NOT LIVE` banner.

### 4.2 Setup form

Sections:

1. **Environment:** fixed to explicit testnet base URL; no silent mainnet option.
2. **Credentials:** registered key ID and 32-byte secret input; password-style secret field, paste allowed, spellcheck/autocapitalize off, no value in DOM attributes/logs after submit.
3. **Vault passphrase:** new passphrase + confirmation, or unlock passphrase for an existing encrypted entry.
4. **Local label:** optional non-identifying label such as “Analytics key 1”; never reused as a key ID.
5. **Permission acknowledgement:** “PolyTools will only make signed GET requests for the datasets shown. It cannot revoke or change this key.”

Client validation occurs before signing: exact key format/length, supported WebCrypto, passphrase requirements, and explicit testnet host. Server identity still comes from `Me`, not from the form.

### 4.3 Verification sequence

Show actual sequential progress, not a timed fake progress bar:

1. Encrypt/unlock locally.
2. Verify auth context with `Me`.
3. Check balances capability.
4. Check spot-read capability when orders/fills are enabled.
5. Check optional transfer/fee capabilities independently.
6. Load active tab data.

A denied optional capability does not erase successful balances. The final state is **Partially connected** with a link to the capability checklist. No raw account identifiers appear in progress/error copy.

### 4.4 Locked screen

Show: **“Your encrypted vault is locked.”** Actions: **Unlock**, **Forget this key**, **Use public tools**.

- No private response remains visible behind the unlock dialog.
- Existing encrypted entries are identified only by non-identifying local labels while locked.
- Wrong passphrase/tamper errors are generic and safe; repeated failures can add a local delay but must not corrupt/delete the vault automatically.

## 5. Overview tab

Order of sections:

### 5.1 Coverage and freshness summary

A compact banner answers:

- Which scope is shown?
- Which datasets are fresh, stale, partial, denied, or unavailable?
- Is the view filtered?
- Are any P&L metrics unavailable because basis/completeness is missing?

Example:

> Balances updated 20 seconds ago. Orders are unavailable with this read-only connection. Equity is sampled history, not live profit.

### 5.2 Equity summary card

When valid:

- **Latest sampled equity:** value in USDT.
- **Sampled change:** absolute and percent for selected range.
- Exact sample start/end timestamps and range selector link.
- Info text: “Server-sampled valuation. Deposits, withdrawals, and market prices can change equity; this change is not necessarily profit.”

When unavailable: **“Sampled equity unavailable”** plus the actual reason. Never render `0 USDT` for denial/error/missing data.

### 5.3 Balance highlights

Show up to five nonzero assets by a defensible ordering:

- If a complete same-timestamp valuation vector exists, order by sampled USDT value and label it.
- Otherwise order by asset symbol and show quantities only; do not invent a USDT ranking.

Each row links to Balances and shows total = trading + funding. Reserved/available are available in the detail table, not added again.

### 5.4 Activity highlights

Show only covered, observed values:

- Open-order count only after all open-order pages are exhausted; otherwise “N loaded” with partial badge.
- Recent fills count and observed notional grouped by quote asset.
- Actual fees grouped by real fee asset.
- Recent deposits/withdrawals as activity, with “Capital flow, not profit” copy.

### 5.5 P&L placeholder / gated card

MVP copy:

> **P&L unavailable — cost basis not established.** PolyTools needs opening lots, complete fills, and resolved non-fill flows before calculating realized or unrealized P&L. Observed cash flow is shown separately.

It is not a `0.00` card and has no confetti/green-red performance implication. A later cost-basis phase can replace this with method, coverage, and timestamp details only after [03](./03_ANALYTICS_AND_FINANCIAL_FORMULAS.md) gates pass.

## 6. Balances & equity tab

### 6.1 Current balances table

Columns:

| Column | Beginner label / behavior |
| --- | --- |
| Asset | Symbol from verified catalog; unknown assets remain visible as unknown, not dropped |
| Total | Exact `trading + funding`; tooltip states formula |
| Trading | Returned trading bucket |
| Funding | Returned funding bucket |
| Reserved | Returned reservations; “included in trading, not extra” |
| Available | Returned available amount; “already accounts for reservations” |

Controls:

- **Hide zero balances** default on; response includes supported zero assets, so “all zero” can be distinguished from “no response.”
- Search by public asset symbol.
- Sort by user-selected column; initial sort follows server or symbol, clearly stated.
- Exact value toggle for advanced users; rounded display never changes underlying arithmetic.

Do not show a USDT value column until valid marks/valuation exist. Holds are excluded from MVP; a future holds section must say holds are pending reservations, not additive balances.

### 6.2 Equity history

Controls:

- Ranges: `1D`, `7D`, `30D`, `90D`, `180D`, `365D`.
- Grouping: **By account bucket** or **By asset**; never overlay both as additive totals.
- Quote label: USDT from response. BTC denomination is optional later and must use the supplied aligned BTC price vector.

Chart requirements:

- Line/area chart with exact sample start/end, bucket, point count, and retrieval time.
- Do not invent per-point timestamps until response interpolation is verified. Before that, show a table/range summary rather than a falsely precise time axis.
- Keyboard-accessible data table alternative and downloadable loaded samples.
- Empty series, mismatched lengths, unknown grouping, and invalid start/end produce explicit incompatibility states.

Below the chart: **Sampled change** and optional **Sampled max drawdown**, each linked to formula explanations. No Sharpe/ROI/annualized-return cards in MVP.

## 7. Orders & fills tab

Use three subtabs: **Open**, **History**, **Fills**.

### 7.1 Shared filter and pagination behavior

- Filters: public market symbol, side, and (where officially supported) status/time/trigger. Disabled filters explain if the friendly endpoint lacks them.
- Changing filters starts a new dataset generation and cursor chain; old responses cannot append.
- Keyset pagination uses **Load more**, not fabricated numbered pages.
- Display “N rows loaded” while a next cursor exists or more pages may remain.
- Display “All rows for this filter loaded” only after an empty next token and no dropped/unknown/conflicting rows. Add “Filter-complete, not lifetime history” where relevant.
- Continue through an empty intermediate page when a nonempty next token exists; the contract allows this for order history.
- On a later-page failure, retain already loaded rows with **Partial** and a retry action for the same cursor. Never mark the prefix complete.

### 7.2 Open orders

Columns: market, side, type, status, price, original quantity, cumulative filled, remaining, created time, lineage/generation (advanced).

Open means non-terminal as defined by the endpoint, not just `WORKING`. Pending and pending-cancel remain visible. No cancel or modify button.

### 7.3 Terminal order history

Columns add terminal status/reason and terminal time. Status filters are explicit. Replacement generations are not counted as independent cumulative filled volume; fills power execution aggregates.

### 7.4 Fills

Columns: execution time, market, side, price, quantity, notional in quote asset, actual fee/rebate with its real asset, maker/taker, physical order reference.

- Signed fee display: `−0.80 USDT fee` for a charge, `+0.01 USDT rebate` for a credit.
- Tooltip explains notional `quantity × price` and that it is not P&L.
- Optional summary: observed volume and net quote flow per quote asset, actual fees per fee asset, always scoped to the loaded/covered set.
- Settlement legs are not appended as additional fills or fees.

### 7.5 Order details drawer

Open from a row without placing raw IDs in the URL. Show order state, lineage/generation, quantities, timestamps, and execution pages. Include the contract warning that one execution page need not reconcile with cumulative order quantity. Retry temporary read-availability errors only according to the safe retry policy.

## 8. Activity & fees tab

### 8.1 Finalized transfer activity

Columns: time, friendly transfer reason, asset, signed amount, affected bucket, source/destination category, lifecycle link when publicly available.

Reason labels come from the contract: deposit, withdrawal, maker/taker fee, internal transfer, trade base/quote, rebate, funding↔trading, withdrawal reserve/request fee, funding user transfer. Unknown codes display **Unknown activity** and trigger partial/incompatible coverage.

- Use `isDebit` for the sign on the selected account row; do not infer it from the reason alone.
- Private counterparties remain “Private counterparty”; do not attempt to unmask them.
- External addresses/account identifiers are not shown by default. If a future detail view needs them, mask and require an explicit user action; never export them in the beginner report.
- Deposits and incoming transfers say **Capital/activity flow — not profit**.
- Client-side filters over loaded rows are labeled “Filter loaded rows.” They do not imply complete server-side time/code filtering, which friendly transfers lacks.

### 8.2 Actual fee summary

Use deduplicated fills, not current rates or double-counted settlement rows. Show gross charges, gross rebates, and net fees **per actual asset**. If the fill set is partial, title it “Fees observed in loaded fills.”

No “burned,” “burn rate,” or equivalent metric exists.

### 8.3 Current effective rates

A separate panel/table shows market, maker percent, taker percent, and the VIP tier used to resolve the rate as returned by the fee-rate response. This is not the session-only VIP-status endpoint.

Copy:

> Current effective rates for this account scope. Historical fills use the actual fee recorded on each fill; current rates are not applied backward.

Optional calculator estimates a scenario at current rates and labels it as an estimate. A negative maker rate is displayed as a potential rebate scenario, not guaranteed historical income.

## 9. Connection & security tab

Sections:

1. **Vault status:** locked/unlocked, auto-lock setting, non-identifying local label.
2. **Connection:** masked key label, explicit testnet host, last identity verification time.
3. **Capabilities:** per-dataset outcome—verified, denied, blocked, unknown, stale. Do not claim to enumerate the policy from `Me`.
4. **Data privacy:** “Private responses are memory-only in this version. Locking clears them. Public tools do not use this key.”
5. **Actions:** Lock now, Lock on all tabs, Forget encrypted key, Migrate legacy vault, Review official revocation guide.
6. **Security limitations:** browser memory erasure limits, device/XSS/shared-device risk, and the fact that read-only keys still expose private activity.

Never offer “Reveal private key,” “Copy signature,” or “Share connection” in account analytics. If a key is forgotten, explain that local deletion does not revoke it at Polyester; remote revocation occurs only in the official account UI by the owner.

## 10. Universal state matrix

| State | Presentation | Data behavior / action |
| --- | --- | --- |
| Initial disconnected | Setup explanation; public navigation intact | No private request |
| Locked | Locked screen; no private content behind it | Unlock or Forget; no polling |
| Unlocking/migrating | Spinner with truthful local operation label | Cancel safely; no partial migration claim |
| Unsupported browser/security gate | Blocking explanation and supported-browser/production guidance | No insecure fallback |
| Verifying identity | Skeleton/status row, not fake metrics | Only `Me` initially |
| Initial dataset loading | Table/chart skeleton with stable dimensions | No zero placeholders |
| Refreshing | Small inline spinner; previous data remains labeled with its timestamp | Abort/replace on scope change |
| Fresh | Text/icon badge + exact timestamp tooltip | Normal covered metrics |
| Stale/offline | Amber **Stale** badge and last success time | Keep old data if valid; manual retry; never call it live |
| Empty, complete | “No rows for this filter/scope” and filter reset option | Zero observed count is valid only for this query |
| Partial | Amber **Partial** with rows accepted/pages/errors | Loaded-row labels only; dependent totals/P&L blocked |
| Permission denied | Lock icon + “Not granted to this read-only key” | Other independent data remains; no elevation-to-write CTA |
| CORS blocked | “Browser access could not be verified” | No proxy/no-cors fallback |
| Rate limited | Retry-after/backoff status | Stop aggressive polling; fresh signature on allowed retry |
| Schema/scale incompatibility | “This response version is not supported yet” | Quarantine affected data; no silent conversion |
| Scope switching | Clear old view, show new-scope loading | New cache/session generation; no cross-account rows |
| Lock/wipe during fetch | Immediate locked/disconnected UI | Abort and ignore late responses |
| Fatal unexpected error | Safe generic message + local correlation ID | No raw secret-bearing error object |

Use `role="status"` for routine progress and `role="alert"` for actionable failures without repeatedly announcing every poll.

## 11. Refresh and polling behavior

Private websocket support is not required. Reuse `packages/core/src/poll.ts` only after it is wrapped in account-session abort/freshness logic.

Proposed starting behavior, subject to official rate-limit verification:

- Refresh balances/open orders/fills/activity no faster than every 60 seconds while their tab is visible.
- Load histories and current fee rates on tab/range/scope selection and manual refresh; avoid aggressive polling.
- Stop polling on hidden tab, lock, denial, offline state, or route exit. A manual refresh is always available when connected.
- Use one scheduler per account session, not one unmanaged timer per component.
- Mark data stale after a documented product threshold (for example, three missed refresh intervals); this is a UI heuristic, not a server freshness guarantee.
- No parallel full-history refreshes. Cursor imports have progress, cancellation, and a bounded explicit user-initiated page policy.

## 12. Beginner language and education

Reuse `Glossary` and inline info popovers for:

- **Total balance:** trading + funding; reserved/available are not extra.
- **Sampled equity:** server-estimated USDT value at sampled times.
- **Observed net quote flow:** sells minus buys with quote fees/rebates for the covered fills; not necessarily profit.
- **Cost basis:** what acquired inventory cost, needed for P&L.
- **Realized / unrealized P&L:** available only after coverage and basis gates.
- **Reserved / available / hold:** distinct reservation concepts, not additive totals.
- **Maker / taker / rebate / fee asset:** actual fill-level meanings.
- **Partial / filter-complete / stale / denied:** data-quality meanings.

Avoid financial advice, promises of accuracy beyond evidence, and tax terminology. Say “trading analytics,” not “tax report.”

## 13. Export interaction

Each table offers **Export loaded rows**; covered complete datasets may say **Export covered rows**. Overview can export a JSON/CSV bundle in a later phase.

Every export includes:

- Dataset, explicit testnet environment, non-identifying scope label, filters/window, retrieval/sample timestamps.
- Raw source decimal strings and derived values in separate columns where applicable.
- Coverage status, pages/rows, unknown/conflict counts, opening-basis and non-fill-flow status for P&L files.
- Formula/method labels such as `observedNetQuoteFlow`, `FIFO`, or `weighted-average` only when applicable.

Never include credentials, signatures, cursors, public/private keys, full account IDs, or secret-bearing raw errors. Warn before download that the file is private financial activity. Filenames use dataset and UTC time, not account identifiers. CSV formula injection defenses are mandatory.

A partial P&L export is not allowed; export observed fills/fees instead with their partial coverage manifest.

## 14. Responsive and accessible behavior

- Desktop: two-column overview cards and full tables. Mobile: single-column cards and horizontally scrollable tables with a visible scroll cue, or labelled row disclosures that retain every critical field.
- Minimum 44×44px touch targets for connection, refresh, lock, tabs, pagination, and export.
- Full keyboard navigation; visible focus; focus trap/return for unlock and order-detail dialogs; Escape does not accidentally erase input without confirmation.
- Color is never the only state indicator. Denied/partial/stale/success use text and icons with WCAG AA contrast.
- Charts have a text summary and data-table alternative; tooltips are keyboard/touch accessible.
- Respect reduced motion; no animated count-ups that could look like live value changes.
- Masked identifiers, if ever shown, are still accessible as “masked key ending …” rather than exposing the full value to assistive technology.
- Secret fields have explicit labels and no browser autocorrect; passphrase errors are announced without echoing input.

## 15. Existing PolyTools reuse map

| Existing asset | Frontend use |
| --- | --- |
| `components/Layout.tsx` | Existing shell/navigation; account-local connection bar only inside portfolio area |
| `components/ui.tsx` | Cards, badges, tabs, dialogs, buttons, skeletons, tables, error/freshness patterns |
| `components/Glossary.tsx` | Beginner explanations and formula links |
| `components/CandleChart.tsx` | Public-market reference only; do not force account series into candle semantics |
| `lib/hooks.ts` / `core/poll.ts` | Patterns for visible, abortable refresh after account-session wrapping |
| `core/format.ts` | Final display formatting only, after exact arithmetic |
| `core/config.ts` | Explicit public/testnet host configuration after alias verification |
| Existing public pages | Unchanged and credential-free |
| Existing `/sdk` guide | Documentation links; no account request execution |

## 16. Frontend acceptance scenarios

1. A visitor without a key uses every existing public route without a connection wall or private request.
2. A locked reload shows no prior balances, activity, account identifiers, or signatures before unlock.
3. A key with balances access but no spot access shows balances and a denied orders panel; it never displays zero orders as fact.
4. A later-page cursor failure keeps loaded rows partial and prevents complete totals/P&L.
5. A complete empty query says “No rows for this filter,” distinct from denied/loading/error.
6. Offline refresh retains old data with a stale badge and last success time.
7. Locking during a delayed response clears the view; the response cannot restore it.
8. Switching scope cannot briefly show the previous scope's rows.
9. Unknown fee asset/transfer code remains visible and blocks affected aggregates.
10. Deposit activity is never styled as profit; equity change always carries sampled/not-P&L copy.
11. Mobile and keyboard users can unlock, inspect every table field, change scope, load more, export, and lock without a pointer.
12. Production contains no synthetic-fixture control or fixture presented as live data.
