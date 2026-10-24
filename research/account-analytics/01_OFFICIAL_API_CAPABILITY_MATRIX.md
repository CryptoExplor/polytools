# Official Polyester API / SDK / MCP capability matrix

**Audit date:** 2026-10-23  
**Contract:** `polyester-proto@b34853cb14366c9a64d53a20f6b09496a3c09fc4`  
**SDKs:** TypeScript `0.31.0` at `f80711678d7944d1ce990d455e0f63d8f3013f2e`; Python `0.1.0a55` at `27bf356e56c3f1fe5e35cac09eb8eed358895125`; Rust `0.1.0-alpha.49` at `610db7d72fb81c7958ad4904b0534253879b05d9`  
**Evidence legend:** see [00 §2](./00_CURRENT_STATE.md#2-evidence-language-used-by-all-eight-reports). Every private row below is **schema/SDK-source-verified, authenticated call unverified** unless explicitly stated otherwise.

## 1. How to read this matrix

There are three different official surfaces:

1. **Friendly REST** — operations in `openapi/rest.openapi.json`. It returns human-friendly decimal strings and uses operation-specific JSON/query names. This is the proposed PolyTools browser baseline.
2. **ConnectRPC / generated HTTP annotations** — fully qualified RPCs in `.proto`; some also have `google.api.http` GET/POST annotations in `openapi/polyester.openapi.json`. Connect payloads use compact/scaled integers unless a friendly SDK decodes them.
3. **MCP** — PolyTools currently wraps 12 public, read-only market/lifecycle tools. No official private account MCP tool was found or called. “Not verified” below is not a claim that a private tool can never exist; it means this audit found no basis to use one.

A generated GET annotation is not silently treated as part of friendly REST. An SDK method is not proof of permission or a successful endpoint call. A policy enum is not a per-RPC grant annotation.

**Primary pinned evidence files:** [friendly REST OpenAPI](https://github.com/Fabric-Labs/polyester-proto/blob/b34853cb14366c9a64d53a20f6b09496a3c09fc4/openapi/rest.openapi.json), [ledger reads](https://github.com/Fabric-Labs/polyester-proto/blob/b34853cb14366c9a64d53a20f6b09496a3c09fc4/proto/public/ledger/read/v1/ledger_read.proto), [order/fill reads](https://github.com/Fabric-Labs/polyester-proto/blob/b34853cb14366c9a64d53a20f6b09496a3c09fc4/proto/public/orders/v1/orders_read.proto), [fees](https://github.com/Fabric-Labs/polyester-proto/blob/b34853cb14366c9a64d53a20f6b09496a3c09fc4/proto/public/fees/v1/fees.proto), [auth](https://github.com/Fabric-Labs/polyester-proto/blob/b34853cb14366c9a64d53a20f6b09496a3c09fc4/proto/public/auth/v1/auth.proto), [policies](https://github.com/Fabric-Labs/polyester-proto/blob/b34853cb14366c9a64d53a20f6b09496a3c09fc4/proto/public/auth/v1/policies.proto), [subaccounts](https://github.com/Fabric-Labs/polyester-proto/blob/b34853cb14366c9a64d53a20f6b09496a3c09fc4/proto/public/auth/v1/subaccounts.proto), [deposit addresses](https://github.com/Fabric-Labs/polyester-proto/blob/b34853cb14366c9a64d53a20f6b09496a3c09fc4/proto/public/chain/deposit/v1/deposit.proto), and [TypeScript signing transport](https://github.com/Fabric-Labs/polyester-sdk-typescript/blob/f80711678d7944d1ce990d455e0f63d8f3013f2e/src/shared/transports.ts).

## 2. Read-only API-key policy actions

Pinned `auth/v1/policies.proto` defines these relevant actions:

| Action | Official semantic boundary | PolyTools use |
| --- | --- | --- |
| `READ_BALANCES` (`read-balances` in SDK docs) | Read balances and equity. | Required candidate for balance/equity reads; live per-endpoint verification remains. |
| `READ_SPOT` (`read-spot`) | Read spot orders, trades, subscriptions, and cancel-all dry-run; strictly non-mutating. | Required candidate for orders/fills. Never substitute `TRADE_SPOT`. |
| `READ_INTERNAL_TRANSFERS` (`read-internal-transfers`) | Read internal-transfer history. | Candidate for transfer activity; exact coverage of the unified finalized-transfer RPC is not annotated. |

A new API key with no policy has no permissions. Official TypeScript authentication documentation says `auth.me` still works while order/ledger/trading reads fail until a policy is attached. Policy-management reads/writes require an interactive session; an API key cannot use them to enumerate or change its own policies. **Documentation- and schema-source-verified.**

For protected RPCs with no `authentication_methods` option, the pinned contract documentation defaults to both session tokens and API keys. That option metadata itself “does not enforce runtime authorization.” Therefore the matrices distinguish **credential type accepted by contract metadata** from **resource/policy grant**, which must be tested.

## 3. Feature-to-endpoint and SDK matrix

“Friendly REST: —” means absent from the pinned friendly REST OpenAPI, not that an RPC is nonexistent. Method names are the high-level methods in the pinned SDK source.

| Capability | Friendly REST | ConnectRPC / generated GET | TypeScript SDK | Python SDK | Rust SDK | Private MCP |
| --- | --- | --- | --- | --- | --- | --- |
| Auth identity/context | Not in friendly spec; generated `GET /v1/auth/me` | `auth.v1.AuthService/Me` | `auth.me()` | `auth.me()` | `auth.me()` | Not verified |
| Current balances | `GET /v1/balances` | `ledger.read.v1.LedgerReadService/GetBalances` | `balances.list()` | `balances.list()` | `balances.list(req)` | Not verified |
| Balance history | `GET /v1/balances/history` | `.../GetBalanceHistory` | `balances.getBalanceHistory()` | `balances.get_balance_history()` | `balances.get_balance_history(req)` | Not verified |
| Equity history | `GET /v1/equity/history/series` | `.../GetEquityHistorySeries` | `balances.getEquityHistory()` | `balances.get_equity_history()` | `balances.get_equity_history(req)` | Not verified |
| Pending holds | **No friendly operation** | `.../ListHolds`; no friendly GET annotation | **No high-level holds method** | `balances.list_holds()` | `balances.list_holds(req)` | Not verified |
| Finalized unified transfers | `GET /v1/transfers` | `.../ListTransfers` | `transfers.list()` | `transfers.list()` with compatibility gaps | `balances.list_transfers(req)` with decoder gap | Not verified |
| Open orders | `GET /v1/orders/open` | `orders.v1.OrdersReadService/GetOpenOrders` | `orders.listOpen()` | `orders.list_open()` | `orders.list_open()` / `list_open_with()` | Not verified |
| Terminal order history | `GET /v1/orders/history` | `.../GetOrderHistory` | `orders.listHistory()` | `orders.list_history()` | `orders.list_history()` / `list_history_with()` | Not verified |
| One order + execution page | `GET /v1/spot/orders/{order_id}` | `.../GetOrder` | `orders.getDetails()` | `orders.get()` | `orders.get()` / `get_with()` | Not verified |
| Authenticated user fills | `GET /v1/spot/trades` | `.../GetUserTrades` | `trades.list()` | `trades.list()` | `trades.list()` / `list_with()` | Not verified |
| Effective spot fee rates | `GET /v1/spot/fee-rates` | `fees.v1.FeeService/GetSpotFeeRates` | `fees.getSpotRates()` | `fees.get_spot_fee_rates()` | `fees.get_spot_fee_rates()` | Not verified |
| Visible subaccounts | Not in friendly spec; generated `GET /v1/auth/subaccounts` | `auth.v1.SubaccountService/ListSubaccounts` | `subaccounts.list()` | `sub_accounts.list()` | `sub_accounts.list()` | Not verified |
| Known deposit addresses | Not in friendly spec; generated `GET /v1/chain/deposit-addresses` | `chain.deposit.v1.DepositAddressService/ListDepositAddresses` | `deposit.listAddresses()` | `deposit.list_addresses()` | `deposit.list_addresses()` | Not verified |
| Root portfolio equity history | `GET /v1/equity/portfolio/history/series` | `.../GetPortfolioEquityHistorySeries` | `balances.getPortfolioEquityHistory()` | Session-only RPC is not a valid API-key path | Session-only RPC is not a valid API-key path | Not verified |
| Root current portfolio snapshot | `GET /v1/equity/portfolio/snapshot` | `.../GetPortfolioEquitySnapshot` | `balances.getPortfolioEquitySnapshot()` | Session-only RPC is not a valid API-key path | Session-only RPC is not a valid API-key path | Not verified |

**Important path corrections for implementers:**

- Use `/v1/balances`, not the current PolyTools signer example `/v1/account/balances`.
- Friendly open/history paths are `/v1/orders/open` and `/v1/orders/history`, not `/v1/spot/orders/open` or `/v1/spot/orders/history`.
- Subaccount listing is `/v1/auth/subaccounts`; deposit-address listing is `/v1/chain/deposit-addresses`.
- Order details and user fills really do use `/v1/spot/orders/{order_id}` and `/v1/spot/trades` in friendly REST. Do not “normalize” all paths into one naming convention.

## 4. Authentication, policy, and pagination matrix

The **policy mapping** column is deliberately precise about confidence. No recursive search of the pinned public proto found a per-RPC `PolicyAction` annotation for these reads. “Semantic mapping” means the action definition names the resource; it is not a successful grant test.

| Operation | Credential metadata | Policy / authorization finding | Pagination and coverage |
| --- | --- | --- | --- |
| `Me` | Protected RPC; session/API-key default | Docs explicitly say it works for a new key with no policy. It returns identity/session context, **not an action grant list**. | One response; no pagination. |
| `GetBalances` | Session/API-key default | `READ_BALANCES` semantic mapping; root or authorized subaccount role also applies. Exact grant call unverified. | One response containing every supported unified asset, including zero balances. |
| `GetBalanceHistory` | Session/API-key default | `READ_BALANCES` semantic mapping. | Fixed ranges, not cursor history. Default proto range `1d`; `1d/7d/30d/90d/180d/365d`. |
| `GetEquityHistorySeries` | Session/API-key default | `READ_BALANCES` semantic mapping. | Fixed ranges and server-selected buckets; no cursor. |
| `ListHolds` | Session/API-key default | **No exact policy mapping found.** Do not assume `READ_BALANCES` suffices without a probe. | Opaque exclusive `page_token`; default 100, max 1000; `reversed` selects newest/oldest. |
| `ListTransfers` | Session/API-key default | `READ_INTERNAL_TRANSFERS` names internal-transfer history, but the unified RPC also represents other finalized ledger reasons. Exact grant is **unknown**. | Opaque exclusive `page_token`; default 100, max 1000; default oldest-first, `reversed=true` newest-first. |
| `GetOpenOrders` | Session/API-key default | `READ_SPOT` semantic mapping; account/subaccount scope still applies. | Opaque exclusive cursor; default 100, allowed 1–1000; newest-first. |
| `GetOrderHistory` | Session/API-key default | `READ_SPOT` semantic mapping. | Opaque exclusive cursor; default 100, 1–1000; newest-first; terminal orders only. |
| `GetOrder` | Session/API-key default | `READ_SPOT` semantic mapping. | Bounded lineage execution page with its own opaque cursor. It is not an order-state or settlement watermark. |
| `GetUserTrades` | Session/API-key default | `READ_SPOT` semantic mapping. | Opaque exclusive cursor; default 100, 1–1000; descending by timestamp/symbol/match/physical order. Empty page alone is not reconciliation. |
| `GetSpotFeeRates` | Session/API-key default; generated GET also present | **No exact policy mapping found.** Test with minimal read-only policies; never request trading merely to make this succeed. | Finite non-paginated snapshot of requested or all currently listed, non-disabled markets; max 100 requested IDs. |
| `ListSubaccounts` | Session/API-key default | Role/ownership/share checks apply; no single API-key action annotation found. A viewer role can read permitted metadata, but live key behavior is unverified. | One complete visible set ordered by subaccount ID; no cursor. `total_created` includes soft-deleted accounts and is not a row count. |
| `ListDepositAddresses` | Session/API-key default | Subaccount role permission `READ_DEPOSIT_ADDRESSES` exists, but that is not an API-key `PolicyAction`. Exact grant unverified. Not required for analytics MVP. | All known addresses for selected scope, ascending chain ID; no cursor. |
| Portfolio history/snapshot | **`SESSION_TOKEN` only** | API keys explicitly unsupported. Do not acquire an interactive JWT just to bypass this product boundary. | Fixed history ranges / one current snapshot; excluded from API-key MVP. |
| API policy list/get | **`SESSION_TOKEN` only** | API key receives interactive-session-required error. | Cannot be used by the connected key to prove its grants. |
| Profile / username history / VIP status | **`SESSION_TOKEN` only** | Not available to the read-only API-key connection model. | Excluded; do not fabricate profile, tier status, or VIP metrics. |

### Least-privilege conclusion

The proposed key asks for **only the read actions needed by enabled datasets**. Start with `read-balances` + `read-spot` for the core MVP. Add `read-internal-transfers` only when transfer activity is enabled and its grant is confirmed. Never request `trade-spot`, `internal-transfer`, `external-withdraw`, address-book management, key/policy management, or a session token for this feature.

If an operation remains denied under that key, its UI state is “Unavailable with current read-only connection,” not a prompt to elevate to a write permission.

## 5. Friendly REST query/filter fidelity

Friendly REST is not a one-to-one rename of ConnectRPC. Its serializer must be generated or reviewed per operation.

| Operation | Friendly REST filters observed in pinned OpenAPI | Material difference from ConnectRPC |
| --- | --- | --- |
| Balances/history/equity | `subaccount_id`; history adds `range`, `ledger`, `account_code`; equity adds `group_by`, `account_code` | Snake-case query names. Empty account-code behavior means all/default buckets per RPC. |
| Transfers | `subaccount_id`, `ledger`, `limit`, `page_token`, `reversed` | **No friendly `ts_min_us`, `ts_max_us`, or `transfer_code` filters**, although ConnectRPC has them. Friendly filtering alone cannot prove a complete arbitrary time/code partition. |
| Open orders | `subaccountId`, repeated `symbol`, `side`, `triggerId`, `limit`, `pageToken`, attached-risk flags | CamelCase names; friendly symbols differ from Connect numeric `symbol_id`. |
| Order history | Open-order filters plus `status`, `startTime`, `endTime` | Friendly times use OpenAPI string representation; validate actual response/request format live. |
| Order details | Path `order_id`; `subaccountId`, execution history/page controls, attached-risk flags | Connect also supports client-order-ID lookup; do not assume the friendly path supports it identically. |
| User fills | `subaccountId`, `symbol`, `side`, `startTime`, `endTime`, `afterMatchId`, `orderId`, `lineageId`, `throughGeneration`, `includeTransfers`, `limit`, `pageToken` | `afterMatchId` requires a symbol; order/lineage scopes are mutually exclusive; generation cutoff requires lineage. |
| Fee rates | `subaccountId`, repeated `symbol` | Friendly repeated `symbol` differs from generated Connect `symbolId`; max 100 markets at contract level. |

Opaque cursors must be copied **byte-for-byte as strings** into the next request with the identical account, filters, bounds, and sort direction. Never parse, trim, decode, re-encode, or convert one to a number. Cursor values may contain reserved URL characters and must be encoded exactly once.

## 6. Response schema and accounting-relevant fields

| Dataset | Contract facts that implementation must preserve |
| --- | --- |
| Balances | Per-asset `trading`, `funding`, `reserved`, `available`; REST renders decimal strings and resolves symbols. `available` already accounts for reservations. Trading/funding revisions are opaque monotonic freshness tokens, not timestamps. |
| Balance history | Columnar `series` by asset/account bucket; `range`, `bucket`, `start_ts_sec`, `end_ts_sec`, `points`. Connect balance chart values use scale `1e7`; REST renders decimals. |
| Equity history | Columnar account or asset groupings; quote asset is USDT; Connect equity uses `1e4`; BTC conversion vector uses price scale `1e9`. It is sampled valuation history, not a cash-flow or P&L ledger. |
| Transfers | Finalized rows only; `asset_id`, `amount_e18`, `transfer_code`, `account_code`, `ts_us`, `balance_after_e18`, `is_debit`, `link_id`, `flow_id`, source/destination. Private counterparties intentionally omit identifiers. REST renders friendly values. |
| Holds | `hold_id`, reserved amount, asset ID, `expires_at_ns`. A hold is not another balance to add to total. |
| Orders | Physical `order_id`, logical `lineage` + generation, per-order `version`, status, quantities, average price, created/terminal times. Replacement generations preserve logical lineage but retain physical order IDs. |
| Fills | `symbol_id`, per-symbol `match_id`, physical `order_id`, side, maker flag, price, quantity, exact fee magnitude, fee asset, referral share, timestamp, `fee_is_rebate`, and lineage/generation. |
| Settlement legs | Optional on fill/order-detail responses; `tx_id`, match/symbol, asset, amount, debit flag, transfer code/account, timestamp. They can repeat across pages. |
| Fee rates | Effective maker/taker **decimal percentage strings without `%`**, plus VIP tier used for rate resolution. Maker can be negative; taker is non-negative. This is a current effective-rate snapshot, not fee history. |
| Subaccounts | Visible owned/shared accounts, role/label/status metadata. Existence of a row does not prove every dataset grant for that scope. |
| Deposit addresses | Chain ID + assigned address for the selected account. These are sensitive account metadata and unnecessary for core analytics. |

### Deduplication identities supported by the contract

- **Fill:** account scope + `(symbol_id, match_id, order_id)`; official comments explicitly require this for overlapping replay.
- **Order state:** physical `order_id`, retaining the higher `version`; equal versions should be identical. Preserve `lineage.id` and `generation` separately.
- **Settlement leg:** `tx_id`, explicitly documented for repeated legs across execution pages.
- **Unified transfer row:** the current `TransferRow` has no single documented unique row ID. `link_id` groups related legs and `flow_id` identifies a lifecycle flow; neither should be presented as a unique leg key without further official verification. Rely on exclusive cursors, detect suspicious duplicates, and mark coverage unknown rather than deleting potentially legitimate rows.

## 7. SDK coverage and fidelity caveats

### 7.1 TypeScript `0.31.0`

- Browser/session flows are supported; package is ESM-only, expects Node 20+ for Node use, modern `fetch`/WebCrypto, and TS 5 bundler/nodenext settings. Installation docs still suggest `^0.26.0`; the inspected repository is `0.31.0`. Pin and audit the exact artifact selected.
- Covers balances, balance/equity history, transfers, order reads/details, fills, fee rates, subaccounts, deposit addresses, and private subscriptions.
- Does **not** expose a high-level holds read in `BalancesService`, despite generated `ListHolds` contract support.
- `orders.getDetails()` is the high-level single-order read; `fees.getSpotRates()` is the fee-rate method.
- Order list methods filter out orders whose symbols are unknown to the hydrated catalog. A raw ingest must not copy this behavior silently: unknown rows must make coverage partial/explicit.
- SDK methods for session-only portfolio history/snapshot exist, but API-key authentication still cannot use them.
- The SDK includes trading and other mutations. PolyTools must never expose those paths in account analytics; least-privilege server policy remains essential even if tree-shaking removes client code.

### 7.2 Python `0.1.0a55`

- `balances.list_holds()` exists but has no `page_token` argument, so its high-level API cannot continue all hold pages.
- `transfers.list()` lacks `page_token`, asset/code/time-bound filters and uses a legacy `since` request field not present in the pinned current `ListTransfersRequest`; its decoded model exposes `next_cursor` rather than preserving `next_page_token`.
- High-level order list wrappers omit several current filters (for example side/status/time range and multiple symbols); fills support page tokens but not every current side/time input.
- These are source compatibility findings, not claims that raw generated protobuf clients cannot issue the fields.

### 7.3 Rust `0.1.0-alpha.49`

- Raw request structs expose holds and transfers, but `transfers_list_from_proto` parses the opaque `next_page_token` as `i64` and returns `next_cursor`. Non-numeric opaque tokens become `None`, which can falsely look like end-of-history.
- High-level order wrappers similarly omit some current filters; use raw request/response support only after fixing token fidelity.
- Like Python, its default testnet host alias differs from TypeScript (see §9).

### 7.4 MCP

PolyTools' `packages/core/src/tools.ts` wraps public `spotMarkets`, `marketOverview`, `orderbook`, `candles`, `recentTrades`, `heatmap`, deposit/withdraw configuration and route comparison, and lifecycle lookup/explanation tools. None takes an API key or returns private balances/orders/fills/transfers. The proposed account client must not send Ed25519 secrets or signed private requests to this public MCP endpoint.

## 8. Numeric scale and timestamp contract

| Surface | Rule |
| --- | --- |
| Friendly REST | Amounts/prices are already human-friendly decimal strings. **Do not divide them by 1e18, 1e9, 1e7, or 1e4.** Parse exact decimals for arithmetic. |
| Connect balances/transfers/holds/fees on fills | Fixed ledger scale `1e18` with U128 where specified. |
| Connect balance history | `balance_q` scale `1e7`. |
| Connect equity | `equity_q` scale `1e4`; signed values. |
| Connect execution/order price | Current pinned contract and TypeScript SDK use `1e9` ticks. |
| Connect base quantity | Pair-specific `base_quantity_scale` from current spot config, not a universal 1e9. |
| Times | Connect transfer rows use microseconds; holds/orders/fills generally use nanoseconds; history series bounds use seconds. Friendly REST may render RFC3339 strings. Normalize only through the selected schema. |

The official scaled-integer guide currently says six-decimal price ticks in one place while the pinned contract, live public config, and current TypeScript source use nine. This is an official-artifact conflict. Do not choose six based on the guide. REST consumers should skip scaled-integer decoding entirely, as that guide itself recommends.

Some generated order/trade REST schemas and proto fields differ on RFC3339 `date-time` versus epoch nanoseconds. Preserve the raw value, validate against the pinned friendly schema, and add live fixtures before computing ordering or durations. History responses provide aligned points and start/end/bucket metadata, but the exact per-index timestamp interpolation was not established by a live private response; do not invent timestamps.

## 9. Contract drift and unresolved verification register

| Item | Finding | Implementation consequence |
| --- | --- | --- |
| REST host | Current TypeScript environment uses `api.testnet.polyester.com`; Python/Rust use `api-testnet.polyester.com`. Public live verification used the dotted host. | Configure one explicit tested base URL; do not silently fail over between aliases or to production. |
| Canonical query ordering | Documentation describes sorting decoded keys/values; official TypeScript transport sorts encoded query pairs. | Build the sent URL and canonical query from the same encoded pair list; test repeated/reserved/cursor cases. |
| Price scale | Six in one guide versus nine in current contract/config/SDK. | Use friendly REST decimals; pin generated artifacts and test drift. |
| SDK docs version | Docs suggest `^0.26.0`; inspected source is `0.31.0`. | Pin exact package and commit; record upgrades as contract changes. |
| Friendly transfer filters | Fewer than ConnectRPC filters. | Do not claim filtered friendly REST is since-inception complete. |
| Opaque transfer cursors | Python/Rust decoders treat them as integers. | Do not use those decoders for complete-history claims. |
| Policy annotations | No per-RPC action map for every read. | Capability probes with owner's minimal read-only key are a release gate. |
| CORS | No authenticated browser preflight/request demonstrated. | Direct-browser architecture remains conditional on this gate. |
| Historical P&L | No single endpoint supplies complete opening cost basis and all non-fill flows with a proven complete export. | P&L stays unavailable until [03](./03_ANALYTICS_AND_FINANCIAL_FORMULAS.md) gates pass. |

## 10. Public reference calls completed

Only these live calls succeeded during the audit, all unauthenticated on `https://api.testnet.polyester.com` on 2026-10-23:

- `GET /v1/spot/config`
- `GET /v1/spot/markets/BTC-USDT/overview`
- `GET /v1/spot/markets/BTC-USDT/candles?...`
- `GET /v1/spot/markets/BTC-USDT/orderbook?depth=2` returned the documented-style structured 400 `INVALID_DEPTH` because depth 2 is unsupported.

They verify public REST representation and validation only. They do **not** upgrade any private matrix row to endpoint-call-verified.

## 11. Recommended supported surface for PolyTools

**MVP, after security/CORS/policy gates:**

1. `GET /v1/auth/me` for identity verification, using the generated official contract/documentation path.
2. Friendly REST balances, balance history, and equity history.
3. Friendly REST open orders, terminal order history, order details, and user fills.
4. Friendly REST unified transfers only after permission and coverage behavior are verified.
5. Friendly REST effective fee rates as a separate “current rates” panel, not historical fee accounting.
6. Root scope first. Add subaccount selection only after list/access behavior is verified for each scope.

**Not MVP:** holds, deposit addresses, profile/VIP, root session-only portfolio snapshot/history, private websockets, authenticated MCP, write operations, or a backend private proxy. These can be reconsidered only with new official evidence and an explicit requirement.
