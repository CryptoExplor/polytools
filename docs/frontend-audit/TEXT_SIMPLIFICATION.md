# Text simplification — current → proposed copy inventory

**Rules applied**

1. Short, everyday English. Say what the user gets, not how it works.
2. Button labels are verbs: "Refresh", "View trades", "Load history".
3. Internal vocabulary (`coordinator`, `snapshot partition`, registered GET, cursor exhaustion, `MCP`, `apiEnv`, `SpotConfig`, `bookSeq`, `matchId`, `get_heatmap`) never appears in ordinary UI copy.
4. Precision is kept where correctness depends on it (units, dates, limitations, "not verified", "not tax reporting") — shortened, never removed.
5. One prominent statement of a limitation beats six scattered ones.
6. Nothing that changes a number, unit, formula, or financial meaning is proposed below.
7. Proposed copy is **shorter or equal** wherever a warning is involved. No warning is deleted; several are consolidated or moved to progressive disclosure.

**Risk column:** `Low` = wording only. `Medium` = wording plus a layout/placement change, or a warning relocates (must be re-tested for visibility). `High` = touches financial/security meaning — requires owner sign-off before implementation, and none of these are recommended for the first batch.

**Measured baselines** (character counts from the server render; see `README.md` §6): the 11 public page subtitles total **1,712 characters**. Proposal target for the same 11 subtitles: **under 900**.

---

## 1. Navigation labels

| Location | Current text | Proposed text | Reason | Risk |
|---|---|---|---|---|
| Sidebar group | `Account` | `My account` | Distinguishes private data from public market data at a glance | Low |
| Sidebar group | `Market Data` | `Markets` | Shorter; the group holds market pages only | Low |
| Sidebar group | `Cross-Chain` (1 item) | remove the group; place `Zipper routes` under `Tools` | A one-item group costs a heading and a divider | Low |
| Sidebar group | `Toolkit & Docs` | `Tools` (+ a separate `Learn` entry point) | "Toolkit & Docs" mixes three audiences | Low |
| Sidebar item | `Markets` | `All markets` | Distinguishes the index page from the "Markets" group | Low |
| Sidebar item | `Order Book` | `Order book` | Sentence case consistency | Low |
| Sidebar item | `Price chart` | `Charts` | Matches the tab users expect; singular "chart" hides the timeframe switcher | Low |
| Sidebar item | `Liquidity heatmap` | `Depth heatmap` | "Liquidity heatmap" is three concepts; "depth" is the term the page actually visualises | Low |
| Sidebar item | `Venue compare` | `Compare prices` | "Venue" is exchange jargon | Low |
| Sidebar item | `Zipper routes` | `Bridge routes` | "Zipper" is a product name; keep it inside the page title | Low |
| Sidebar item | `Testnet hub` | `Testnet start` | "Hub" is meaningless to newcomers | Low |
| Sidebar item | `SDK quickstart` | move under `Developers` → `SDK quickstart` | Not a market tool | Medium |
| Sidebar item | `Brand kit` | move to footer only | Brand assets are not part of the daily workflow | Medium |
| Sidebar item | `API setup` | `Connect account` | Describes the outcome, not the mechanism | Low |
| Sidebar item | `Your Trades` | `Trades` (keep "Your" in the page title) | Nav consistency; the page title carries the possessive | Low |
| Sidebar item | `Profit and Loss` | `P&L` **or** keep full form | "P&L" is shorter but less plain; recommend keeping the full form for beginners | Low |
| Sidebar item | `Money Movements` | `Deposits & withdrawals` | "Money movements" is an internal category name; the page covers deposits, withdrawals, transfers | Low |
| Account tabs | `Overview / API setup / Your Trades / Orders / Profit and Loss / Money Movements` | `Overview / Trades / Orders / Deposits & withdrawals / P&L / Key setup` | Tabs must fit six across at 960 px; current labels overflow horizontally (`overflow-x: auto`) | Medium |
| Topbar breadcrumb | `Market Data / Markets` | `Markets` (drop the group label for top-level pages) | Repeats the sidebar group | Low |
| Topbar eyebrow | `Read-only · testnet` | keep (single global placement) | It is the right place for the guarantee | Low |
| Topbar button | `Glossary` | `Glossary` (unchanged) but also add it to the mobile header without the `hide-sm` label | It is the best beginner asset and currently icon-only on mobile | Medium |
| Footer link | `Brand Kit` | `Brand kit` | Casing | Low |

---

## 2. Page titles

| Location | Current text | Proposed text | Reason | Risk |
|---|---|---|---|---|
| `/` header | `Spot Market Overview` | `Markets` | The word "Spot" is exchange vocabulary; "Overview" duplicates the sidebar group name | Low |
| `/book` | `Public Order Book · BTC-USDT` | `Order book · BTC-USDT` | "Public" is a qualifier nobody needs on a page with no account context; the read-only pill covers it | Low |
| `/tape` | `Recent Market Trades · BTC-USDT` | `Trades · BTC-USDT` | Three words where one suffices | Low |
| `/charts` | `Candlestick Chart · BTC-USDT` | `Price chart · BTC-USDT` | "Candlestick" is a chart type, not a task | Low |
| `/heatmap` | `Order Book Liquidity Heatmap` | `Depth heatmap` | Names the visualisation, not four concepts | Low |
| `/compare` | `Cross-Venue Price Comparison` | `Compare prices` | "Cross-venue" is jargon | Low |
| `/zipper` | `Zipper Cross-Chain Route Comparator` | `Bridge routes` (subtitle names Zipper) | 38 characters of product taxonomy | Low |
| `/calc` | `Trading & Risk Calculators · BTC-USDT` | `Calculators · BTC-USDT` | "Trading & risk" narrows an educational tool | Low |
| `/hub` | `Testnet Hub & Onboarding Guide` | `Start on testnet` | A guide title implies a document to read | Low |
| `/sdk` | `Beginner SDK & Trading Bot Quickstart Studio` | `Developers: SDK quickstart` | "Studio" and "Beginner" are marketing, and the page contains expert tools | Low |
| `/brand-kit` | `Polyester Brand Kit & Token Assets` | `Polyester brand kit` | Shorter; "assets" is implied | Low |
| `/account` | `Account overview` | `Overview` | Duplicates the tab label directly above it | Low |
| `/account/orders` | `Your Orders` | `Orders` | Tab already says Orders | Low |
| `/account/pnl` | `Profit and Loss` | `Profit and loss` | Sentence case | Low |
| `/flow` (embedded) | `Track a Deposit or Withdrawal` | `Track a transfer` | Simpler verb + noun | Low |
| All account pages | duplicated `Card` title equal to the page title (`Account overview` renders twice) | remove the inner `Card` title; keep the page header | One page, one heading | Medium |

---

## 3. Subtitles

| Location | Current text | Proposed text | Reason | Risk |
|---|---|---|---|---|
| `/` | "Real-time top-of-book prices, 24-hour volume, basis-point spreads, and live session tick sparklines across all listed Polyester spot pairs." (139) | "Prices and 24-hour stats for every Polyester spot market. Updates every 3 seconds." (88) | Replaces four feature nouns with the user's question | Low |
| `/book` | "Public buy orders (bids) and sell orders (asks) waiting to be matched. No account key is used. These orders are not necessarily yours." (134) | "Buy and sell orders waiting to be matched. These are other people's orders, not yours." (86) | Keeps the essential distinction, drops "public/account key" framing | Medium |
| `/tape` | "Public trades for everyone on this market, newest first. No account key is used. These are not necessarily your trades." (119) | "Every trade on this market, newest first. Not just yours." (57) | Same meaning, third of the length | Medium |
| `/charts` | "Price history in time buckets. Each bar shows open, high, low, close, and volume. Hover or press Left/Right arrow keys to inspect individual OHLCV bars." (152) | "Price history. Each bar is one time period with open, high, low, close, and volume." (82) | The keyboard hint belongs beside the chart (it is already repeated there) | Low |
| `/heatmap` | "Historical resting bid and ask liquidity buckets from `get_heatmap`. Brighter green and red bands highlight price zones where large limit orders rested over time." (161) | "Where buy and sell orders rested over time. Brighter bands mean more size at that price." (85) | Removes an internal API name from user copy | Low |
| `/compare` | "Compares Polyester testnet prices with public CoinGecko USD reference prices. CoinGecko USD vs Polyester USDT/USDC testnet prices — differences are not executable trades." (170) | "Polyester prices next to CoinGecko USD prices for the same asset. Reference only — you cannot trade this difference." (118) | Same warning, one clause; removes the repeated source names | Medium |
| `/zipper` | "Which blockchains can send or receive each token on Polyester, with published minimum amounts, network fees, and confirmation times. Public route list — no deposit address is created here." (188) | "Compare deposit routes for each token: network fee, minimum amount, and confirmation time." (89) | Answers the page's actual question | Medium |
| `/calc` | "Scratchpads for trade size, profit/loss after fees, and unit conversion. These numbers are yours to type. Nothing is sent to Polyester." (135) | "Work out trade size, fees, and profit. Everything stays in your browser." (72) | "Scratchpad" is not a product concept | Low |
| `/hub` | "Track the daily 00:00 UTC paper-asset reset window, work through the local onboarding checklist, and access verified Polyester testnet faucets and documentation." (161) | "A checklist to get started on Polyester testnet, plus the daily reset time and official links." (94) | Leads with the user's goal | Low |
| `/sdk` | "Step-by-step interactive guide for building on Polyester with the official TypeScript, Python, and Rust SDKs — from zero-credential public market reads to Ed25519 authenticated orders." (184) | "Copy-paste code for the TypeScript, Python, and Rust SDKs, starting with public data and then authenticated requests." (117) | "Zero-credential" and "Ed25519" are jargon | Low |
| `/brand-kit` | "Official logos, favicons, color specifications, 15 market token packshots (front, side, low-angle), 3D imagery loops, Polybot avatars, and Scan / Zipper partner lockups." (169) | "Logos, token images, colours, and type for Polyester and PolyTools." (66) | Asset counts belong in section headers, not the page subtitle | Low |
| `/account` | "Your balances, orders, trades, money movements, and current fee rates. Each section reports its own loading, permission, and data-coverage status." (146) | "Your balances, orders, trades, and fees. Each section loads separately." (71) | The second sentence exists to explain a technical design; keep only the useful consequence | Medium |
| `/account/api` | "Connect a registered read-only account key. Your key is encrypted in this browser and can sign only approved read requests." (123) | "Connect a read-only key so PolyTools can request your account data. The key stays encrypted in this browser." (113) | One clause shorter, same guarantees | Low |
| `/account/trade` | "Only executions belonging to your connected account. Public market trades are available under Market Data → Recent Trades." (122) | "Your own fills, with the fees you actually paid." (45) | The public/private distinction already exists on the public page | Medium |
| `/account/orders` | "Open and completed orders from your connected account. This is not the public order book." (89) | "Your open and completed orders." (31) | The nav and page context already establish ownership | Medium |
| `/account/pnl` | "User-assisted cost-basis estimates require complete fills, opening basis, resolved flows, and method provenance. Realized P&L does not require a current mark; unrealized and total P&L also require a fresh labeled valuation." (223) | "Profit and loss from your own trades. Needs complete history, your opening cost, and a current price. We show 'Unavailable' instead of a guess." (139) | Five accounting terms → three plain conditions; the mark/realized distinction moves to the result card where it is actionable | **High** (financial meaning — owner review) |
| `/account/transactions` | "Review deposits, withdrawals, and transfers from your account, or look up a public transaction by its exact ID." (111) | "Your deposits, withdrawals, and transfers — or look up a public transaction by ID." (86) | Minor | Low |
| `/flow` | "Paste a public transaction hash or Polyester flow ID to see what stage a deposit or withdrawal is in." (110) | "Paste a transaction hash or flow ID to see where a deposit or withdrawal is." (79) | "Polyester flow ID" is defined in the field help | Low |

---

## 4. Buttons

| Location | Current text | Proposed text | Reason | Risk |
|---|---|---|---|---|
| Intro bar | `Browse markets` | `View markets` | Matches nav noun "All markets" | Low |
| Intro bar | `Testnet setup` | `Start on testnet` | Verb-first, matches page title | Low |
| Intro bar | `Dismiss` | `Dismiss` (unchanged) | Clear | Low |
| Dashboard card | `Export CSV` | `Download CSV` | Users are downloading a file, not "exporting" | Low |
| Data freshness | `Refresh` / `Retry` | `Refresh` + `Try again` | "Retry" is fine; keep consistency with ErrorBox | Low |
| ErrorBox | `Retry now` | `Try again` | Consistency; "now" adds urgency without information | Low |
| Compare banner | `Sync CoinGecko` | `Refresh reference prices` | "Sync" implies a device relationship | Low |
| Hub diagnostics | `Refresh Diagnostics` | `Refresh` (inside a "Connection details" panel) | Two words where one works | Low |
| Tape | `Test Alert` | `Test alert` (and only enabled when Sound is on) | Sentence case; also fixes a confusing no-op | Low |
| Tape | `Clear Whale Log` | `Clear log` | "Whale log" is unexplained | Low |
| Calc | `Try a sample` | `Use example numbers` | Says what it does | Low |
| Calc | `⇩ Sync Live Price (82,132.47)` | `Use current price (82,132.47)` | "Sync" again; arrow glyph is noise | Low |
| Hub header | `Open SDK Quickstart (TS · Python · Rust)` | `Open developer docs` | Three languages in a button label | Low |
| Flow | `Trace Lifecycle` | `Track transfer` | "Lifecycle" is internal | Low |
| Account | `Load account data` / `Load your trades` / `Load your orders` / `Load P&L inputs` / `Load money movements` | `Load account data` (all sections) **or** make each load genuinely scoped | The broad load is the same in all five cases today (`docs/audit/UX_AUDIT.md` UX-A1) | Medium |
| Account | `Import full history (capped)` | `Load all history` + cap in details | "(capped)" reads as a limitation of quality | Medium |
| Account | `Cancel import` | `Stop` | Shorter, obvious | Low |
| Account | `Export validated rows` / `Export loaded rows` | `Download CSV` / `Download JSON` | The distinction is invisible to users; the confirmation dialog already explains coverage | Medium |
| API setup | `Generate & Encrypt` | `Create key` | The encryption is a guarantee, not a feature name | Low |
| API setup | `Verify, Import & Encrypt` | `Add existing key` | Three verbs → one task | Low |
| API setup | `Forget All` | `Delete all keys` | "Forget" is soft language for a destructive action | Low |
| API setup | `Migrate & Remove Plaintext` | `Convert and delete old key` | Plain language for a rare, dangerous action | Medium |
| API setup | `Delete Legacy Record` | `Delete old key` | Same | Medium |
| API setup | `Sign Locally — Do Not Send` | `Create signature (does not send)` | The current label is a warning, not an action | Medium |
| API setup | `Re-encrypt` | `Save` | Users are saving a key ID, not re-encrypting | Low |
| Money movements | `Use public lookup` | `Search a public transaction` | Matches the tab label | Low |
| Transfers | `Reset loaded-row filters` | `Clear filters` | Four words of jargon | Low |
| Order drawer | `Retry` / `Close` | `Try again` / `Close` | Consistency | Low |
| Empty states | `Reset filters` (Dashboard) | `Clear filters` | Consistency with the transfers filter | Low |

---

## 5. Tooltips and term tips (`TermTip`, `title=`)

| Location | Current text | Proposed text | Reason | Risk |
|---|---|---|---|---|
| Dashboard Last Price | "Last public trade on Polyester, decoded from the testnet feed (scaled integer ÷ 10³)." | "The most recent trade price." | Decoding belongs in Developer details | Low |
| Dashboard Index Price | "Exchange reference index price (scaled integer ÷ 10³)." | "The exchange's reference price (an average), not a trade." | Explains the useful difference | Low |
| Dashboard Spread | "Top-of-book (Best Ask − Best Bid) ÷ Mid in basis points (1 bps = 0.01%)" | "Gap between the best buy and sell price, as a percentage (1 bps = 0.01%)." | Formula → meaning, keeps the unit | Low |
| Book Top Spread | "(Best Ask − Best Bid) ÷ Mid Price expressed in basis points (1 bps = 0.01%)" | Same as above | Consistency | Low |
| Book `bookSeq` | "Exchange monotonic order book sequence identifier" | Remove from UI; keep in Developer details | Nobody can act on a sequence number | Low |
| Book imbalance | "Share of displayed bid qty vs ask qty. Not a prediction." | "More size on the buy or sell side right now. Not a prediction." | Plain words, keeps the caveat | Low |
| Tape VWAP | "Volume-weighted average price of trades this browser session has seen, not the exchange daily VWAP." | "Average price of trades you have seen since opening this page — not the daily average." | Second person | Low |
| Tape largest print | "Single matched trade notional (price × qty) above your chosen threshold." | "The biggest single trade above your alert size." | Plain words | Low |
| Charts SMAs | "Simple moving average of candle closes over 7 bars." | "Average closing price over the last 7 bars." | Removes "SMA" recursive definition | Low |
| Compare premium | "((Polyester Price − CoinGecko USD) ÷ CoinGecko USD) × 10,000 bps" | "How far Polyester's price is from CoinGecko, in bps." | Formula in Developer details | Low |
| SymbolSelect | "Tick size: … · Step size: … · Min notional: …" | "Smallest price step: … · Smallest order size: … · Minimum order value: …" | Plain names, same data | Low |
| API setup key ID | "Use only the server-issued ak_... ID. A local label is never accepted as an authentication fallback." | "Paste the ID Polyester gives you (starts with `ak_`)." | Second person; the fallback rule is implementation detail | Low |
| API setup raw query | "Decoded key/value sorting follows the documented contract. A conflicting SDK sort order blocks signing pending server verification." | "Query parameters are sorted before signing. Mismatched ordering blocks signing." | Shorter, same rule | Low |
| Metric cell tooltips (API setup) | "A saved key is an encrypted local entry. It is not a live account balance or a connection to another user." | "A saved key is stored in this browser. It is not a balance." | Two clauses removed | Low |
| Metric cell tooltips (API setup) | "The app uses AES-GCM encryption and PBKDF2 passphrase stretching. These protect stored keys; they do not grant account permissions." | "Stored keys are encrypted with your passphrase." | Algorithm names belong in the security section | Low |

---

## 6. Status labels

| Location | Current text | Proposed text | Reason | Risk |
|---|---|---|---|---|
| Freshness | `No data yet` | `Waiting for data` | "No data" reads like an error | Low |
| Freshness | `Syncing…` | `Loading…` | One word for one idea | Low |
| Freshness | `Updated 3s ago` | `Live · 3s ago` | Adds the state the user wants, not just the age | Medium |
| Freshness | `Paused` | `Paused` (unchanged) | Fine | Low |
| Topbar | `Live MCP` | `Live` | "MCP" is infrastructure | Low |
| Topbar | `Sample data` | `Sample data` (unchanged, keep) | Correct and important | Low |
| Cache | `Cached metadata · 3m ago` | `Cached · 3m ago` | "Metadata" is internal | Low |
| Cache | `Stale metadata` / `Stale sample` | `Out of date · 3m ago` / `Out of date · sample` | "Stale" is a data-engineering word | Low |
| Cache | `Fresh cached copy` / `Stale cached copy awaiting revalidation` (title) | `Cached copy, up to date` / `Cached copy, out of date — refresh pending` | Plain | Low |
| Hub | `ENV: PENDING` | `Environment: unknown` | "Pending" hides an unknown state and `ENV:` is a variable name | Low |
| Hub | `Serving Environment (apiEnv)` | `API environment` | Variable names in labels | Low |
| Account | `Live compatibility remains unverified.` | `Account connection not verified yet.` | Same meaning, fewer abstractions | Low |
| Account | `Not live-verified` (kv value) | `Not verified` | Consistent with the above | Low |
| Account | `Required before fills` | `Needed before loading trades` | What it blocks, in user terms | Low |
| Account | `SpotConfig validated` | `Ready` | Internal schema name | Low |
| Account | `Unlocked · Memory Only` | `Unlocked (this tab only)` | Plain | Low |
| Account | `WebCrypto Unavailable` | `Browser not supported` | Browser API name → user consequence | Low |
| Account | `Scoped · Read-only` | `Read-only` | "Scoped" is unexplained | Low |
| Dataset | `Data loaded` / `Filtered data loaded` / `Partial data` / `May be out of date` / `Permission needed` / `Unavailable` / `Loading` / `Not loaded` | Keep this set nearly as-is; only change `May be out of date` → `Out of date` and `Not loaded` → `Not loaded yet` | This vocabulary is already good and fail-closed | Low |
| Dataset | `Refreshing` | `Updating` | Consistency | Low |
| Zipper | `Est. Avg Notional` | `Approx. value` | Abbreviation stack | Low |
| Heatmap | `Bucket Persistence` | `Time at this price` | "Bucket" is internal | Low |
| Flow | `Identifier Handling: Exact Verbatim` | `Exact ID match` | Simpler | Low |

---

## 7. Warnings and notices

| Location | Current text | Proposed text | Reason | Risk |
|---|---|---|---|---|
| Shell (×6) | `Read-only · Testnet` in PageHeader, topbar, sidebar brand, plus "No wallet or login." and the footer sentence | Keep **topbar** and **sidebar subline** only; delete the PageHeader eyebrow and the footer repetition | One guarantee, stated once, is believed; six times is wallpaper | Medium |
| Intro bar | "PolyTools is a read-only map of Polyester. Watch live prices, order book depth, trades, and bridge fees without connecting a wallet. It never places orders or touches funds." | "PolyTools shows Polyester market data. No wallet, no trading." | Two sentences → one | Low |
| Wire sample | "Development wire samples used in this session. Some public responses are captured or derived fixtures, not live data or production-compatibility evidence. This notice remains visible across tools; private account reads never use these samples." | "Sample data: some values on this page are saved test fixtures, not live prices." | Keeps the essential claim, drops deployment commentary | Medium |
| Compare | 3 statements of "not executable" (subtitle, banner, footer) | 1 line above the table: "Reference only — this difference is not tradeable." | Repetition weakens the warning | Medium |
| Compare | "Asynchronous Reference Notice: Polyester prices poll every 5s while CoinGecko USD reference prices poll every 35s to respect public rate limits…" | Move the intervals into the freshness popover; keep "Updated at different times." | Cadence detail is implementation | Medium |
| Zipper | "Estimation Notice: Fees and minimums come from the currently loaded public Zipper configuration, which may be cached, stale, or a labeled development sample. Illustrative Deposit Net subtracts the listed network fee from the entered amount and checks the deposit minimum only; it is not a withdrawal or executable transfer quote. Confirm final parameters in the official Polyester app before initiating a transfer." | Above the table: "Estimates only. Confirm in the Polyester app before sending funds." + Developer details: full method | The warning gets closer to the number and shorter | **High** (transfer instructions — owner review) |
| Account (×6 pages) | "Live compatibility remains unverified. Authenticated GET reads are enabled, but each operation still succeeds or fails independently. Browser CORS, origin, and owner-controlled read-policy checks determine whether a real response is available; a response is not evidence of another permission." | One status line: "Account reads are not verified on this device." + details block with the rest | Must remain visible; only the mechanism moves | **High** (security/compat claim — owner review) |
| Account (×6 pages) | "Section-scoped memory. Changing account sections intentionally discards this section's in-memory snapshots, cursor imports, and manual P&L inputs…" | Show **only when leaving a section with unsaved work**, as a confirmation: "Leaving this section clears what you loaded. Continue?" | Contextual instead of always-on | Medium |
| Account API | "Use real account keys only in a deployment you control. Do not enter a real key in a development server or shared preview…" | Keep (safety-critical), trim to 2 sentences | Shortening only | Medium |
| Account P&L | "No profit number appears until every required gate passes." | Keep | It is the correct promise | Low |
| Calc | "Toy textbook 1/L math — Polyester's public product is unified-asset spot + lending, not isolated-margin perpetuals." | "This is a simplified textbook model. Polyester spot does not liquidate like a perpetual futures exchange." | Plain, same meaning | **High** (product claim) |
| Hub | "Testnet Safety Notice: The Polyester testnet only accepts paper assets and external testnet coins (tBTC, tETH, etc.). Never send real mainnet funds to any testnet deposit address. Testnet state, balances, and order history may be reset by the exchange team at any time." | Keep the "never send real funds" sentence verbatim; move the reset clause to the countdown card | Protects the critical instruction | Medium |
| SDK | (absent) | Add: "PolyTools does not run this code. Running it places real orders on testnet." | A missing safety warning, not a shortening | **High** (new safety copy — owner review) |
| Transfers | "Filter loaded rows. These client-side filters do not change server coverage, request a time/code partition, or prove complete history." | "Filters only apply to rows already loaded." | Same meaning | Low |

---

## 8. Error messages

| Location | Current text | Proposed text | Reason | Risk |
|---|---|---|---|---|
| ErrorBox heading | `Cannot reach Polyester MCP right now:` | `Can't reach the market data service.` | "MCP" is internal; colon reads like a log line | Low |
| ErrorBox heading | `Invalid input — check format:` | `That ID doesn't look right.` | Plain | Low |
| ErrorBox heading | `No public record indexed:` | `No public record found.` | "Indexed" is internal | Low |
| ErrorBox heading | `Tool error:` | `Something went wrong.` | Plain | Low |
| ErrorBox helper | "Check that the identifier matches the expected format (e.g. 0x-prefixed 64-character hex hash or UUID flow ID) and try again." | "A transaction hash starts with 0x and has 64 characters after it. A flow ID looks like 123e4567-…" | Example beats description | Low |
| ErrorBox helper | "Polyester has no public flow for this identifier. That is not the same as a failed transfer." | "Polyester has no public record for this ID. That does not mean the transfer failed." | Plain | Low |
| ErrorBox helper | "Showing last known data snapshot while automatic background retry continues." | "Showing the last data we received. Retrying automatically." | Second person | Low |
| Account | `PERMISSION_DENIED: Your account key does not have permission to read this information. No rows were inferred.` | `Your key can't read this data.` + code in tooltip | Codes are for support, not users | Low |
| Account | `CORS_BLOCKED: Your browser could not reach the account service. No proxy or public-data fallback was used.` | `Your browser could not reach the account service. No substitute data is shown.` | Second sentence is the useful part | Low |
| Account | `SCHEMA_INCOMPATIBLE: The account service returned a format this app does not understand. Affected numbers are blocked.` | `The account service returned an unexpected format, so these numbers are hidden.` | Plain | Low |
| Account | `CONTRACT_CONFLICT: The request could not be made safely because the account API formats disagree. The read was stopped.` | `Two account data formats disagree, so this read was stopped.` | Plain | Low |
| Account | `SIGNATURE_INVALID: The account service rejected the request signature. Automatic signing retries are stopped.` | `The account service rejected the signature. Retries are stopped.` | Plain | Low |
| Account | `TIMESTAMP_SKEW: The account service rejected your device clock. Check the date and time before retrying.` | `Your device clock is off. Fix the date and time, then try again.` | Action first | Low |
| API setup | `The passphrase confirmation does not match.` | Keep | Clear | Low |
| Flow API | `validation error: invalid flowId format (expected UUID or flow identifier)` (server message passed through) | Map in UI: "That flow ID format isn't right." | Server text leaks | Low |
| Calc | `Equity must be greater than 0` / `Risk % must be between 0.01% and 100%` / `Stop price must differ from entry price` | Keep | Field-level and clear | Low |

---

## 9. Empty states

| Location | Current text | Proposed text | Reason | Risk |
|---|---|---|---|---|
| Dashboard | "No market overview data available / Verify the backend MCP connection or click Refresh to retry." | "No market data yet / Check your connection, then refresh." | User-actionable | Low |
| Dashboard | "No markets match your filter / Try clearing the search query or switching the quote/direction filter." | "No markets match / Clear the filters to see everything." | Verb-first | Low |
| Book | "No order book snapshot loaded / Could not retrieve order book levels for this market." | "No order book data / This market may have no resting orders." | Two different causes conflated today; the proposal names the visible one | Low |
| Tape | "No trades match current view / Try switching the tape filter back to All or lowering the whale threshold." | "No trades match / Show all trades, or lower the alert size." | Plain | Low |
| Heatmap | "No non-zero resting liquidity in this window / The response was empty or contained only zero-quantity levels. Try another market or increase the lookback window." | "No resting orders in this window / Try a longer window or another market." | Removes "zero-quantity levels" | Low |
| Compare | "No matched pairs / No listed USDT/USDC market currently has a valid CoinGecko USD reference match. Unavailable references, unmapped assets, non-USD quotes, and invalid prices are not counted as matches." | "No matches right now / These markets have no usable CoinGecko USD price." + "Why?" details | Four enumerated causes → one sentence | Low |
| Account | "No account data loaded / Unlock a registered read-only key, then choose Load account data. Nothing is shown as empty or zero when a read is denied or unavailable." | "Nothing loaded yet / Unlock your key, then choose Load account data." + one line: "We never show a denied read as zero." | Action first, guarantee second | Medium |
| Account | "This does not mean your account is empty. We could not validate this information, so no numbers or public-market substitute are shown." | Keep | Essential anti-misreading copy | Low |
| Account | "Your Trades are not loaded / …you will see that status instead of public trades." | "Your trades aren't loaded yet / Unlock your key, then choose Load account data." | Removes the second clause (covered by the status pill) | Medium |
| Flow | "Ready to trace a transaction or flow / Paste a deposit/withdrawal transaction hash from any supported Zipper chain or a Polyester flow ID above to inspect its settlement lifecycle." | "Enter an ID to track a transfer / Paste the transaction hash or flow ID above." | Plain | Low |
| API setup | "No encrypted entries / Create or explicitly migrate a key above. An empty vault is not an account connection and shows no balances." | "No keys saved yet / Create a key above to connect an account." | Simpler | Low |
| Brand kit | "No token match" (`BrandFilterEmptyState`) | Keep | Clear | Low |

---

## 10. Account and financial terminology

| Term | Where | Current treatment | Proposed treatment | Risk |
|---|---|---|---|---|
| `notional` | Book, Tape, Calc, Zipper | Used bare | "order value" for beginners, `notional` only in tables with the existing term tip | Low |
| `bps` | Dashboard, Book, Compare, Calc, Zipper | Tooltips exist | Keep the unit; add "0.01%" inline the first time per page | Low |
| `maker` / `taker` | Calc, account fees | Used bare | "fee you paid as a maker/taker" with a one-line explanation | Low |
| `rebate` | Account trades (`ExecutionFee`) | "+ X USDT rebate" | Keep; add a glossary link | Low |
| `reserved` / `available` | Account balances | Column headers | Keep — they map to the API and change meaning if renamed | **High** (do not rename) |
| `equity` | Account overview | "Sampled valuation only — never live equity or P&L" | Keep the caveat; rename the metric label "Account equity (sampled)" | Medium |
| `cost basis`, `opening lot`, `opening zero`, `non-fill flows`, `method provenance` | P&L | Used as primary labels | Keep the concepts; lead with plain questions: "What did you pay?" / "What happened to the rest?" / "Which costing method?" and keep the precise term as the secondary label | **High** (accounting meaning — owner review) |
| `coverage` | Account datasets | "Data loaded: 12/14 rows…" | "Data loaded" + details; drop the word "coverage" from visible copy | Low |
| `snapshot` | Account, cache | "snapshot synced", "Snapshot" | "last update" | Low |
| `partition` | (internal only today) | — | Never surface | — |
| `validated` | Account statuses | "Data loaded" (already good) | Keep | Low |
| `legacy plaintext vault` | API setup | "Legacy Plaintext Vault Quarantined" | "Old unencrypted key found" — and keep the destructive-action confirmation exactly as strong | **High** (security copy — owner review) |
| `execution` / `fill` | Account trades | Both used | Pick one: "trade" in the UI, `fill` only in Developer details | Low |
| `transfer leg` | Account transfers | "Read-only transfer legs" | "deposits and withdrawals" | Low |

---

## 11. Developer copy shown to ordinary users

| Location | Current text | Proposed text | Reason | Risk |
|---|---|---|---|---|
| Heatmap subtitle | `get_heatmap` | remove | Internal tool name | Low |
| Dashboard footer | "Wire prices are decoded from scaled integers (`raw ÷ 10³`)… zero extra API calls." | remove → Developer details | Only relevant to integrators | Low |
| Shell footer | "Prices decoded via `raw ÷ 10³`" | "Testnet data · not investment advice" **or** nothing | The decoding rule appears on account pages too, where it is wrong | Medium |
| Hub diagnostics | "Telemetry from /api/env and /api/markets" | "Connection details" | Endpoint names in a subtitle | Low |
| Hub diagnostics keys | `Serving Environment (apiEnv)`, `Testnet MCP Configured` | `API environment`, `Data service configured` | Variable names | Low |
| Compare | "Via backend MCP facade" | remove | Infrastructure | Low |
| Charts footer | "MCP marks past bars as open on some intervals…" | "Only the newest bar is still forming." | User-level fact, no protocol name | Low |
| Book metric | `bookSeq #12345` | remove from strip; keep in Developer details | Opaque identifier | Low |
| Tape | "Triggered once per unique matchId on newly arriving trades." | "Each trade alerts once." | `matchId` is internal | Low |
| Account API | "Nonextractable", "AEAD", "PBKDF2 iterations", "KDF parameters", "authenticated ciphertext" | Keep in the security section; the primary labels become "Encrypted key", "Passphrase", "Unlock time" | Terms are correct but belong one level down | Medium |
| Account API | "Read-only Canonical Request Signer" | "Signature preview (advanced)" | Note: the existing warning "this creates a local signature for inspection; it does not execute fetch" must **stay** | Medium |
| SDK | "Ed25519 canonical string", "ConnectRPC + WS Protobuf" | Keep — this is a developer page, but gate behind the "Developers" area | Audience mismatch, not wording | Low |
| Flow | "Explain transaction", "Lifecycle Trace Payload", "Not Indexed" | "What happened", "Full details", "No record found" | Plain | Low |
| Zipper | "Zipper Protocol Smart Contracts" | "Bridge contracts (advanced)" | Audience gating | Low |

---

## 12. Consolidation plan (what moves where)

Progressive disclosure, applied consistently:

**Primary (always visible)**

1. Page purpose — one sentence, ≤ 90 characters.
2. Current freshness state — one badge.
3. The tool itself.
4. The one limitation that changes a decision ("Reference only", "Estimates only", "Not your trades", "Unavailable until …").

**Secondary (`<details>` "How this works", closed by default)**

1. Poll interval and cache store.
2. Calculation method (spread formula, VWAP definition, route ranking).
3. What the columns mean.

**Advanced (Developer details page or a "Developers" section)**

1. `raw ÷ 10³` decoding, `bookSeq`, `matchId`, MCP/API endpoint names, canonical-string construction, coverage internals, KDF/AEAD parameters.

Warnings that must **never** move behind disclosure: testnet-only funds, "not tax reporting", "not investment advice", account-read not verified, passphrase unrecoverable, export contains private data, sample-data banner.

---

## 13. Copy rules for future work (short version)

1. A page subtitle answers "what can I do here?" in one sentence and never lists features.
2. If a sentence explains *how* the system works, it belongs in Developer details.
3. Each limitation is stated once, in the closest possible position to the number it qualifies.
4. Numbers keep their unit and their source, always.
5. Every button label is a verb a first-time user would say out loud.
6. If a word would not appear in a support conversation with a beginner, it does not appear in the primary UI.
