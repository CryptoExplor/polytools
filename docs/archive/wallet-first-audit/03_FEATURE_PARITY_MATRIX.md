# 03 — Feature parity matrix

Every current route and tool, with data source, credential requirement, SDK coverage, and what
wallet-first integration changes. Route/component facts come from `apps/web/src/App.tsx`,
`components/Layout.tsx`, `pages/*`, `lib/api.ts`, `backend/src/handler.ts`,
`packages/core/src/{config,tools,mcp}.ts`, and `packages/core/src/account/*`.

**Column meanings**
- **Key?** — does it need the Ed25519 API-key vault today?
- **SDK?** — does `@polyester/sdk@0.31.0` expose an equivalent? (`None` = no equivalent method.)
- **Type** — R = read-only, M = mutation, B = both.
- **Preserve?** — can current behaviour survive wallet-first integration unchanged?

---

## 1. Master matrix

| # | Route | Feature | Current data source | Key? | SDK equivalent | Type | Preserve? |
|---|---|---|---|---|---|---|---|
| P1 | `/` | Markets overview, prices, 24h, sparklines, watchlist, CSV | MCP `get_market_overview`, `get_spot_markets` via `/api/overview`, `/api/markets` | No | `marketOverview.list` ✅ | R | Yes |
| P2 | `/tape` | Public trade tape, whale alerts | MCP `get_recent_trades` via `/api/trades` | No | `marketData.listTrades` ✅ | R | Yes |
| P3 | `/book` | Order book, depth chart | MCP `get_orderbook` via `/api/orderbook` | No | `orderbook.get` ✅ | R | Yes |
| P4 | `/charts` | Candles, volume, crosshair, live refresh | MCP `get_candles` via `/api/candles` | No | `candles.list` ✅ | R | Yes |
| P5 | `/heatmap` | Depth density / imbalance over time | MCP `get_heatmap` via `/api/heatmap` | No | `heatmap.getOrderbookHeatmap` ✅ | R | Yes |
| P6 | `/compare` | Polyester index vs CoinGecko, bps | MCP overview + **CoinGecko** REST | No | partial (Polyester side only) | R | Yes |
| P7 | `/zipper` | Bridge chains, fees, minimums, **route comparison** | MCP `get_deposit_withdraw_config`, `list_asset_routes`, `compare_deposit_routes` | No | **partial**: config only ✅❌ | R | Yes |
| P8 | `/calc` | Position sizing, margin, PnL/fee, conversion | Pure client-side math (+ marks from P1) | No | n/a | R | Yes |
| P9 | `/hub` | Faucet links, onboarding checklist, claim countdown | Static config + `NETWORKS` | No | none | R | Yes |
| P10 | `/sdk` | TS/Python/Rust SDK snippets, order-input validation | Static snippets; `lib/orderConstraints.ts` | No | n/a (documentation) | R | Yes |
| P11 | `/brand-kit` | Brand assets | Static | No | n/a | R | Yes |
| P12 | `/fees` | Full VIP0–VIP10 maker/taker catalog, thresholds, trade-cost arithmetic | **Public REST** `GET /v1/vip/tiers` via `/api/fees/tiers` | No | `vip.listTiers` ✅ | R | Yes (new) |
| A1 | `/account` | Balances, sampled balance/equity history, current fee rates, exports | friendly REST: `balances`, `balanceHistory`, `equityHistory`, `feeRates` | **Yes** | `balances.list`, `.getBalanceHistory`, `.getEquityHistory`, `fees.getSpotRates` ✅ | R | Yes |
| A2 | `/account/api` | **Key setup** — vault, key creation/import, `ak_…` registration, unlock/lock/wipe | Local vault + out-of-band `testnet.polyester.com/account/api-keys` | **Yes** (it *is* the key UI) | `apiKeys.*` partially | R | Yes |
| A3 | `/account/trade` | Account fills + actual execution fees | friendly REST `fills` (`/v1/spot/trades`) | **Yes** | `trades.list` ✅ | R | Yes |
| A4 | `/account/orders` | Open + completed orders, order details/lineage | friendly REST `ordersOpen`, `ordersHistory`, `orderDetails` | **Yes** | `orders.listOpen`, `.listHistory`, `.getDetails` ✅ | R | Yes |
| A5 | `/account/pnl` | Experimental FIFO / moving-weighted-avg cost basis | Derived client-side from A1+A3+A4 data | **Yes** (inherits) | inherits | R | Yes |
| A6 | `/account/transactions` | Transfers + credential-free public lookup (`?scope=public`) | friendly REST `transfers`; public side via MCP lifecycle | **Yes** for own rows | `transfers.list` ✅; `lifecycle.*` ✅ | R | Yes |
| L1 | `/flow` | Legacy redirect → `/account/transactions?scope=public` | — | No | — | R | Yes |
| L2 | `/portfolio` | Legacy redirect → `/account` | — | — | — | R | Yes |
| — | (none) | **Combined activity feed** | — | — | — | — | **Not implemented** |

**No route performs a mutation.** Every operation is a GET. `READ_ONLY_OPERATIONS` in
`packages/core/src/account/signer.ts` is the complete set of signable operations, and
`AccountVault.signReadRequest()` rejects anything outside it. The public backend serves only
GET + OPTIONS.

---

## 2. Per-feature detail

### P1–P5 — Public market data

- **UI:** `pages/Dashboard.tsx`, `Tape.tsx`, `Book.tsx`, `Charts.tsx`, `Heatmap.tsx`, with
  `components/CandleChart.tsx` (496 L) and `DepthChart.tsx` (313 L).
- **Path:** browser → `lib/api.ts` (`${API_BASE}/api/...`) → `backend/src/handler.ts` → MCP
  session pool (`src/mcpServer.ts`) → `https://polyester-mcp-testnet.fabriclabs.workers.dev/mcp`.
- **Why the backend exists:** the MCP endpoint does not answer browser CORS preflights. The
  backend re-exposes CORS-open GET JSON and adds a bounded hot TTL cache.
- **Runtime validation:** every response passes `lib/publicDtos.ts` `decodePublicApiResponse()`
  (306 L, added in PR #7) — a runtime DTO validator, with `PublicApiSchemaError` on mismatch.
- **Wallet-first changes needed:** **none.** No credentials, no account context. Leave exactly
  as is.
- **Caveat:** the SDK's equivalents are **ConnectRPC on a different transport with different
  DTOs**. Swapping them is a separate project with its own re-validation cost and is **not**
  required by wallet-first.
- **What is lost by removing key config:** nothing.

### P6 — Compare prices

- **UI:** `pages/Compare.tsx`; logic `lib/compare.ts` (102 L).
- **Sources:** Polyester index price (MCP overview) vs **CoinGecko** `api.coingecko.com`
  (`lib/coingecko.ts`). CoinGecko is a third-party dependency with its own rate limits.
- **SDK:** covers only the Polyester side. CoinGecko stays.
- **Wallet-first changes:** none.

### P7 — Bridge routes (`/zipper`) — **the real SDK gap**

- **UI:** `pages/Zipper.tsx` (88 L, `usePollData(..., 120_000, [])`).
- **Sources:** three MCP tools — `get_deposit_withdraw_config`, `list_asset_routes`,
  `compare_deposit_routes`.
- **SDK coverage:** `zipper.getDepositWithdrawConfig` ✅ **only**. For `list_asset_routes` and
  `compare_deposit_routes` there is **no SDK method** (`dist/services/zipper/zipper.d.ts` has
  exactly two members). `chainAnalytics.getZippedAssetSupply*` returns *supply*, not routes.
- **Conclusion:** route listing and fee comparison must **stay on the MCP backend**. Any plan
  that "replaces the backend with the SDK" would silently delete this feature. Do not.
- **Wallet-first changes:** none.

### P8 — Calculators · P9 — Hub · P10 — SDK guide · P11 — Brand kit

- Pure client-side or static. `lib/orderConstraints.ts` (255 L) validates order *inputs* against
  the selected pair for the SDK snippets — it does not place orders.
- `P10` explicitly renders: *"PolyTools does not run this code."* and carries the SDK licence
  disclosure.
- **Wallet-first changes:** none. `P10` becomes **more** important — it will need to document
  the wallet-login flow if that ships.

### A1 — Account overview

- **UI:** `Portfolio.tsx` overview section + `components/AccountAnalytics.tsx` (1178 L).
- **Datasets:** balances, balance history, equity history, fee rates — plus orders/fills/transfers
  from `coordinator.loadAll()` in the same consented bundle.
- **Current auth:** Ed25519 headers from the vault.
- **SDK equivalent:** yes, all four (`balances.list`, `.getBalanceHistory`, `.getEquityHistory`,
  `fees.getSpotRates`). Note `balances` also offers `getPortfolioEquityHistory` /
  `getPortfolioEquitySnapshot` — richer than the current friendly-REST equity series, and worth
  evaluating later.
- **Honesty constraints to preserve:** current fee rates are **not** historical fees; deposits,
  equity changes, and net quote flow are **not** profit. Coverage status is displayed per dataset.
- **Wallet-first changes:** introduce a session-based `AccountReadClient` implementation
  alongside the vault one, selectable behind a flag. Keep the vault path intact.
- **Lost if keys removed:** the only live-verified path (see §3).

### A2 — Key setup (`/account/api`) — the item the migration targets

- **UI:** `Portfolio.tsx:384–1028`. Shows vault entries, create/import forms, `ak_…` field
  (`placeholder="ak_..."`, `:876`), lock/wipe, "Verify & load read-only data" gate,
  idle-lock note (`:1028`), link to official key management (`:490`) and to the Ed25519 docs
  (`:1014`).
- **Flow today:** create/import keypair locally → register it in Polyester's own UI (external
  tab) → paste back only the `ak_…` **ID** → unlock → explicit read.
- **Wallet-first changes:** in wallet mode this page becomes a *connection* page
  (connect / address / session status / disconnect). In key mode it stays as-is.
- **Lost if removed:** the ability to use a machine-style key without a browser wallet;
  headless/automation users; and — critically — the currently verified live path.

### A3 — Your Trades

- **Datasets:** `fills` (`/v1/spot/trades`), with `account/*`**actual execution fees** per fill,
  grouped by their real fee asset (never assumed to be one currency).
- **UI:** "never the public trade tape" — explicitly separate from `/tape`.
- **SDK:** `trades.list` (user fills) exists. Fee-per-fill fields must be re-verified; the SDK
  and friendly REST are different schemas.
- **Wallet-first changes:** data-source swap behind the same dataset interface.

### A4 — Orders

- **Datasets:** `ordersOpen`, `ordersHistory`, `orderDetails` (incl. lineage executions).
- **SDK:** `orders.listOpen`, `.listHistory`, `.getDetails` — plus `preview()` which the current
  key path does **not** use and which would be valuable for a future order-confirmation UI.
- **Wallet-first changes:** data-source swap; keep per-dataset coverage + cursor reporting.

### A5 — P&L

- **Nature:** computed **by PolyTools**, not reported by the exchange. FIFO or
  moving-weighted-average, user-assisted, with explicit opening-basis status and flow resolution.
  Realized output is independently gated; unrealized/total also need fresh marks.
  `lib/../components/AccountCostBasis.tsx` (505 L), `packages/core/src/account/lots.ts` (774 L).
- **Explicitly "not verified tax output."**
- **Wallet-first changes:** none to the algorithm. It consumes datasets; the source swap is
  transparent if dataset shapes are preserved.

### A6 — Money Movements

- **Two modes in one route:** authenticated transfers (`scope=mine`) and a credential-free public
  transaction lookup (`scope=public`, via MCP lifecycle tools). The public mode must keep
  working with no session at all.
- **SDK:** `transfers.list` ✅ and `lifecycle.listFlows`/`getFlow`/`listFlowsByTx` ✅.
  `flowExplain` (`explain_transaction`) has **no** direct SDK method — `getFlow` returns
  "summary, factual steps, timeline, and live-state detail", which *may* cover it. **Unknown.**
- **Wallet-first changes:** data-source swap for own rows only.

### Not implemented — combined activity feed

Confirmed absent. `packages/core/src/account/activity.ts` contains only
`TRANSFER_REASON_LABELS`, `resolveTransferReason()`, `transferSideLabel()`,
`transferBucketLabel()` — display helpers, no feed. No route, component, or merged timeline.
Deferring it is consistent with the brief.

---

## 3. Parity consequences of removing API-key configuration

| Capability | Depends on | Lost if keys removed | Mitigable with SDK? |
|---|---|---|---|
| All account reads | Server-registered `ak_…` + local Ed25519 | Yes — the **only live-verified** private path | Partially: SDK session path exists but has **never** been live-verified here |
| Machine / headless use | API key | Yes | No — machine clients *require* `api-key-ed25519` in the SDK too |
| Use without a browser wallet | API key | Yes | No — every SDK login requires `AccountSigner.signMessage` |
| Out-of-band key registration UX | Vault | Yes (and its friction, which is a benefit to remove) | Yes — wallet login removes the external tab step |
| Read-only guarantee | `READ_ONLY_OPERATIONS` allowlist | Would be replaced by "whatever the session token permits" | Needs deliberate replacement: the SDK client exposes all 29 services including mutation APIs |

**The last row is the most important architectural risk in the whole migration.** Today,
read-only-ness is enforced *structurally*: the signer refuses any operation not in a 10-entry
GET allowlist. An SDK-based client, by construction, can reach `orders.create`,
`tradingWithdraws.createToExternalChain`, `transfers`, triggers, etc. Replacing the vault with
an SDK client **removes a structural safety property** unless an equivalent guard is built.
See `04_TARGET_ARCHITECTURE.md` §5.

---

## 4. Feature-parity verdict

| Question | Answer |
|---|---|
| Any feature removed by this migration? | **No.** Public features are untouched; private features gain a second data source. |
| Any feature that *cannot* be migrated to the SDK? | **Zipper route listing/comparison** (no SDK method), **CoinGecko comparison** (third-party), **MCP docs search** (none). These stay on the current backend. |
| Any feature that must stay key-only? | Only if a required SDK operation turns out to be permission-blocked for session tokens — **Unknown**, to be settled in Stage 6. |
| Is parity provable before key removal? | Yes, but only with live verification from a real browser origin, which has never been done. |

---

## 5. Matrix summary for the dapp restructure

Existing tools map cleanly onto the intended dapp sections; nothing needs to be deleted.

| Proposed dapp section | Existing routes |
|---|---|
| **Portfolio** (wallet-gated) | A1 `/account`, A5 `/account/pnl` |
| **Trading activity** (wallet-gated) | A3 `/account/trade`, A4 `/account/orders`, A6 `/account/transactions` |
| **Markets** (public) | P1 `/`, P2 `/tape`, P3 `/book`, P4 `/charts`, P5 `/heatmap`, P6 `/compare` |
| **Bridge** (public) | P7 `/zipper` |
| **Toolkit** (public) | P8 `/calc`, P9 `/hub`, P10 `/sdk`, P11 `/brand-kit` |
| **Settings / Connect** | A2 `/account/api` → becomes *Connection & keys* |

The only structural change the dapp needs is promoting A2 from a deep account sub-page to a
first-class **Connect** entry point that appears when no wallet is connected — and keeping it
reachable afterwards for key-mode users.
