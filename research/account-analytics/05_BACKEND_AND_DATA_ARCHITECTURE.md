# Backend and data architecture specification

**Status:** proposed implementation architecture; no feature code has been added  
**Baseline decision:** direct browser-to-Polyester friendly REST, local Ed25519 signing, memory-only private responses, and no new private backend infrastructure.  
**Gate:** authenticated browser CORS and minimal-policy behavior are unverified. Failure is reported, not bypassed with a shared proxy.

## 1. Architecture overview

```text
┌──────────────────────────── PolyTools browser origin ────────────────────────────┐
│                                                                                │
│  Existing public pages ───────► existing public REST/MCP/CoinGecko clients      │
│                                      │                                         │
│                                      ▼                                         │
│                           public data / public cache                           │
│                                                                                │
│  /portfolio                                                                    │
│    └─ React account UI ──► AccountSession (generation, abort, lock, scope)      │
│                              │             │                                   │
│                              │             └─► MemoryDatasetStore              │
│                              │                   (per session/scope/filter)     │
│                              ▼                                                 │
│                    PrivateReadClient (GET allowlist)                           │
│                              │                                                 │
│                    CanonicalSigner ◄── Nonextractable CryptoKey                 │
│                              │              ▲                                  │
│                              │              │ unlock only                      │
│                              │       Encrypted IndexedDB vault                 │
│                              ▼                                                 │
└──────────────────────────────┼─────────────────────────────────────────────────┘
                               │ HTTPS signed GET; credentials omitted
                               ▼
                Official Polyester testnet REST endpoint
```

The private path never enters the existing public MCP pool, backend handler, global TTL cache, `localStorage`, HTTP cache, or a third-party analytics service.

## 2. Architecture decisions

| Decision | Choice | Rationale / reversal condition |
| --- | --- | --- |
| Private transport | Friendly REST decimal strings | Avoids scaled Connect payloads and matches the current web `fetch` style. Reverse only after a reviewed SDK/Connect design proves browser support and equal fidelity. |
| Signing location | Browser-local nonextractable session key | Avoids server custody and shared credentials. No server-side signing fallback. |
| Private backend | None in MVP | Existing adapters are public-only; a proxy adds custody, privacy, deployment, and cache risk. CORS failure remains a blocker. |
| Private persistence | Memory only initially | Minimizes data retention and account-partition risk. Encrypted vault records are the only account-related durable secrets. |
| Numeric math | Exact decimal/rational arithmetic in zero-dependency core | JavaScript `Number` is not acceptable for lots/fees; avoid a large dependency when a bounded exact module suffices. |
| SDK adoption | Do not add full official SDK solely for MVP | A small GET-only client reduces mutation surface and preserves friendly REST fidelity. Official SDK remains a reference/oracle for signing and schemas. |
| Realtime | Polling/manual refresh first | Private websocket behavior is unverified and unnecessary for first read-only analytics. |
| Cost-basis persistence | None initially | Opening lots and coverage are sensitive; add only encrypted, versioned storage in a later reviewed phase. |

## 3. Proposed module boundaries

Names are implementation guidance, not existing files.

### 3.1 `packages/core/src/account/` — pure/zero-dependency core

| Proposed module | Responsibility | Must not do |
| --- | --- | --- |
| `types.ts` | Raw DTOs, normalized records, safe errors, dataset/coverage types | Contain React or storage side effects |
| `decimal.ts` | Strict decimal parsing, exact rational arithmetic, final display rounding | Use `Number` for financial state |
| `canonical.ts` | One canonical URL/query/body/timestamp implementation | Accept arbitrary private write operations |
| `signer.ts` | WebCrypto Ed25519 signing, monotonic timestamps, independent vector hooks | Persist/log decrypted keys or signatures |
| `vault.ts` | Versioned AES-GCM/PBKDF2 record format, encrypt/decrypt/migrate helpers | Know React; silently fallback to plaintext |
| `vaultStorage.ts` | Minimal IndexedDB storage interface plus in-memory test adapter | Store unlocked keys/private responses |
| `rest.ts` | Operation allowlist, per-operation query serializers, `fetch` defaults, safe error mapping | Support arbitrary method/path or automatic proxy fallback |
| `capabilities.ts` | `Me` and independent read probes; capability outcomes | Infer grants from key labels or `Me` |
| `pagination.ts` | Opaque cursor chains, abort, repeated-cursor detection, page/coverage counters | Parse cursors or silently stop at a cap |
| `normalize.ts` | Friendly REST DTO validation/normalization, timestamp and decimal preservation | Drop unknown financial rows or rescale REST |
| `coverage.ts` | Coverage merging and metric-eligibility gates | Treat filter-complete as inception-complete |
| `analytics.ts` | Observed balances/fills/fees/equity formulas | Calculate gated P&L without coverage proof |
| `lots.ts` | Post-MVP FIFO/weighted-average exact ledger | Run with unknown basis/unresolved flows |
| `export.ts` | Safe CSV/JSON serialization and coverage manifest | Export secrets/cursors/raw account IDs |

`packages/core/src/index.ts` can expose a namespaced account API rather than dozens of new top-level names. Existing `export * as vault from "./keys"` needs a compatibility/migration plan; do not leave two competing signers.

### 3.2 `apps/web/src/lib/account/` — browser orchestration

| Proposed module | Responsibility |
| --- | --- |
| `AccountSession.ts` | Own nonextractable `CryptoKey`, local session ID, monotonically increasing generation, root/scope, abort controller, capabilities, and lock/wipe |
| `AccountProvider.tsx` | Expose status/commands/dataset selectors to React, **not** key material |
| `memoryStore.ts` | Partition private datasets by session/scope/operation/filter and invalidate on generation changes |
| `useAccountDataset.ts` | Initial load, refresh, pagination, stale status, and abort behavior |
| `scheduler.ts` | One conservative visible-tab scheduler per session; no per-component timer explosion |
| `crossTab.ts` | Secret-free lock/wipe/vault-generation messages and stale-tab fail-closed behavior |
| `download.ts` | Explicit user-initiated export and private-file warning |

React state contains normalized account data and safe status only. `CryptoKey`, decrypted bytes, auth headers, canonical strings, and raw cursor chains stay in the session/client modules and are never passed through React props or developer tools.

### 3.3 `apps/web/src/components/account/` and pages

- `ConnectionBar`, `ConnectionWizard`, `CapabilityList`, `CoverageBadge`, `Freshness`, `ScopeSelector`.
- `EquitySummary`, `BalanceTable`, `EquityHistory`, `OrdersTable`, `FillsTable`, `ActivityTable`, `FeePanel`, `SecurityPanel`.
- `Portfolio.tsx` becomes the overview/shell; nested route components implement [04](./04_ACCOUNT_ANALYTICS_FRONTEND_SPEC.md).
- Shared `CoverageBadge` and `MetricAvailability` components make it difficult to render a number without its evidence state.

### 3.4 Backend

**No new backend account endpoint in the baseline.** Leave `backend/src/handler.ts`, `mcpServer.ts`, `cache.ts`, and adapters public-only. Add a code comment/test during implementation preventing accidental registration of private account routes in the public handler if useful.

## 4. Core data models

The following shapes are conceptual; exact field names can follow repository TypeScript style.

### 4.1 Safe dataset envelope

```ts
type CoverageStatus =
  | "loading"
  | "complete"
  | "filter-complete"
  | "partial"
  | "stale"
  | "denied"
  | "blocked"
  | "unavailable";

interface Coverage {
  operation: string;
  contractVersion: string;
  scopeKind: "root" | "subaccount";
  filters: Record<string, string | number | boolean | string[]>;
  requestedStart?: string;
  requestedEnd?: string;
  observedStart?: string;
  observedEnd?: string;
  pagesFetched: number;
  rowsReceived: number;
  rowsAccepted: number;
  duplicateRows: number;
  conflictingRows: number;
  unknownRows: number;
  droppedRows: number;
  cursorExhausted: boolean;
  stoppedAtCap: boolean;
  openingBasis: "proven-zero" | "supplied" | "carried-forward" | "unknown" | "not-required";
  nonFillFlows: "resolved" | "unresolved" | "not-required";
}

interface Dataset<T> {
  status: CoverageStatus;
  value?: T;
  coverage: Coverage;
  retrievedAtMs?: number;
  sourceStartTsSec?: number;
  sourceEndTsSec?: number;
  error?: SafeError;
  previousSuccessRetrievedAtMs?: number;
}
```

The store key contains a random local session generation and verified scope internally. The coverage shown/exported uses a non-identifying scope label, not raw IDs. `rowsAccepted + unknownRows + conflictingRows + droppedRows` must reconcile with received unique/raw rows according to a documented counting rule; tests should prevent silent disappearance.

### 4.2 Exact values

```ts
interface ExactDecimal {
  readonly raw: string;
  readonly numerator: bigint;
  readonly denominator: bigint; // strictly positive
}
```

Do not JSON.stringify `bigint` directly. Export canonical decimal strings or a deliberate rational representation. Normalized records retain both source raw values and exact values where needed.

### 4.3 Account session

```ts
interface AccountSession {
  readonly localSessionId: string; // random, not a Polyester ID
  readonly generation: number;
  readonly localVaultEntryId: string;
  readonly scope: VerifiedScope;
  readonly abort: AbortController;
  lock(reason: LockReason): void;
  wipe(reason: WipeReason): Promise<void>;
}
```

The concrete session privately holds the nonextractable signing key and verified key ID. UI-facing type declarations should omit them. Every request captures `generation`; response acceptance requires an exact match and an unlocked session.

### 4.4 Safe errors

```ts
type SafeErrorCode =
  | "VAULT_LOCKED" | "VAULT_INVALID" | "UNSUPPORTED_BROWSER"
  | "CORS_BLOCKED" | "NETWORK" | "RATE_LIMITED"
  | "UNAUTHENTICATED" | "TIMESTAMP_SKEW" | "SIGNATURE_INVALID"
  | "KEY_DISABLED" | "KEY_EXPIRED" | "IP_NOT_ALLOWED"
  | "PERMISSION_DENIED" | "SCHEMA_INCOMPATIBLE"
  | "COVERAGE_INCOMPLETE" | "ABORTED" | "UNKNOWN";

interface SafeError {
  code: SafeErrorCode;
  operation: string;
  localCorrelationId: string;
  httpStatus?: number;
  retryAfterMs?: number;
}
```

No raw request/response, headers, URL query, cursor, account ID, or secret-bearing cause chain is included in UI/logs. Detailed raw errors may exist only transiently in the client for mapping and must be discarded.

## 5. Request pipeline

1. UI requests an allowlisted operation with structured parameters.
2. The operation serializer validates account scope, public filters, range, limit, and cursor. It uses that operation's exact snake/camel-case fields.
3. Build a single encoded query-pair list and exact path. Reject arbitrary methods/paths and fragment/userinfo.
4. Verify session generation and unlocked state.
5. Allocate a fresh monotonic millisecond timestamp; hash the exact empty GET body; canonicalize and sign locally.
6. Call `fetch` with `credentials: "omit"`, `cache: "no-store"`, `redirect: "error"`, `referrerPolicy: "no-referrer"`, and the session/attempt abort signal.
7. Map transport/HTTP/structured errors to safe codes. Do not retry auth/permission/schema failures.
8. Validate response content type, required fields, decimal/timestamp representations, and financial enum values.
9. Normalize/deduplicate into a candidate dataset; calculate coverage before metrics.
10. Accept the result only if the captured session generation, scope, operation, and filter generation still match. Otherwise discard it without updating state.

Unknown **additive** response fields may be ignored for forward compatibility after being recorded as a non-sensitive schema note. Unknown required representations, financial enum values, scales, or conflicting known fields block the affected dataset. Do not use a validator that strips an unknown financial row and returns success.

## 6. Cursor ingestion state machine

```text
IDLE → REQUEST_PAGE → VALIDATE_PAGE → APPEND_PAGE
                         │                 │
                         │                 ├─ next token + allowed to continue → REQUEST_PAGE
                         │                 ├─ next token + user/page cap → PARTIAL
                         │                 └─ empty token → COVERAGE_CHECK
                         └─ error/abort/unknown/conflict → PARTIAL or UNAVAILABLE
```

Rules:

- The first request has no cursor. Every continuation uses the exact returned string and an otherwise identical serialized request.
- Maintain an in-memory set of seen cursors; a repeated token is an invariant failure, not end-of-history.
- Do not require `rows.length === limit` to continue. Continue whenever `nextPageToken` is nonempty, including an empty intermediate page.
- A nonempty token with a user-selected page cap produces `partial`, never `complete`.
- Keep page order and raw row counts for diagnostics without exporting cursors.
- On a later-page error, keep the already loaded candidate rows with partial status; do not combine them with an older complete dataset and call the union complete.
- A complete open-order refresh can replace the prior open-order snapshot only after its cursor chain and validation complete. Otherwise retain the previous successful snapshot separately as stale/partial.
- For order/fill historical exports, prefer a fixed upper time bound where friendly REST supports it so “as of” is meaningful. Friendly transfers lack time filters; label the retrieval window honestly.

### 6.1 Refresh and dedup

- Poll only the active dataset and a small first page where appropriate; do not re-download lifetime history every minute.
- Merge overlapping fills by account/symbol/match/order, orders by physical ID/version, and settlement legs by `txId`.
- Conflicting fill identity or financial content blocks the affected metric. For orders, only documented `version` semantics authorize replacement.
- Unified transfer rows are finalized but lack a documented unique leg key. Preserve cursor order and mark unexplained duplicates for review rather than hashing a possibly non-unique display row into an identity.

## 7. Coverage-driven metric pipeline

```text
raw response
  → DTO validation
  → normalized rows + raw source decimals
  → identity dedup/conflict detection
  → dataset coverage
  → observed metric eligibility
  → observed metrics
  → cost-basis eligibility (separate, stricter)
  → optional P&L metrics
```

Examples:

- Current balances require one valid response; no cursor is needed. Unknown assets remain visible and can block valuation but not necessarily exact quantity display.
- “Observed volume in loaded fills” can be computed on valid partial fills if explicitly labeled; “complete account volume” cannot.
- Equity change needs compatible first/last points from one complete sampled response; it does not require fill history but is never relabeled P&L.
- Realized P&L requires valid fills **plus** opening lots and resolved non-fill flows. A successful balances response cannot substitute for opening basis.
- Unrealized P&L additionally requires a fresh mark; if mark retrieval fails, remaining quantity/cost may remain available but current unrealized value is not.

Eligibility functions should be pure and tested independently from UI formatting.

## 8. Memory cache and partition design

Use separate maps for public and private data. A private key can be conceptually:

```text
session.generation
/ verifiedScope.internalId
/ operation
/ stableSerialization(publicFiltersAndRange)
/ datasetGeneration
```

Requirements:

- The previous generation is deleted before a new scope becomes visible.
- No method accepts only dataset/filter as a cache key; scope/session is mandatory by construction.
- Store immutable snapshots or disciplined replacements so React does not mutate financial records in place.
- Private raw responses and normalized values are cleared on lock/wipe. Persisted UI preferences contain no raw account IDs.
- Do not use `localStorage`, IndexedDB, Cache Storage, service workers, backend `cache.ts`, or cookies for private responses.
- A late response carries its generation and is discarded if the current key differs.

Tests must create two sessions with identical filters and different scopes, then prove reads, refreshes, late responses, and wipes cannot cross partitions.

## 9. Capability service

`Me` verifies authentication/identity but does not enumerate policy actions. Capabilities are independent outcomes cached only for the current local session:

| Capability | Probe | Dependent UI |
| --- | --- | --- |
| Identity | `Me` | Connection state |
| Balances | `GetBalances` | Balance table/highlights |
| Balance history | `GetBalanceHistory` | Balance-history view |
| Equity history | `GetEquityHistorySeries` | Equity summary/chart |
| Spot reads | Open orders + a bounded fills/order-history read | Orders/fills; record each operation separately if results differ |
| Transfers | Bounded `ListTransfers` | Activity |
| Fee rates | Bounded `GetSpotFeeRates` | Current rates |

A successful empty response can verify reachability/schema only for empty shape; it does not verify every nonempty field or complete accounting coverage. A denial remains visible until explicit re-verification, not retried every polling interval. Changing the key/scope resets all capabilities.

## 10. Refresh scheduler

- One scheduler per unlocked session; active tab registers dataset demand.
- Initial target no faster than 60 seconds for visible current datasets; histories/rates load on selection/manual refresh. Adjust only after official rate-limit observations.
- No private websockets in MVP.
- Stop on hidden, offline, locked, denied, unmounted, or scope-changed states.
- Coalesce manual refresh with an identical in-flight request; do not queue bursts.
- Retry only retryable GET failures with bounded exponential backoff/jitter and a fresh signature. Auth, permission, CORS, schema, and abort errors do not retry automatically.
- Each dataset has its own `retrievedAt` and stale threshold. Avoid a global “live” indicator.

## 11. Backend and deployment boundary

### 11.1 Existing public backend remains unchanged

The current handler exposes public health/spot/lifecycle GETs and a global TTL cache. It has no per-user authentication or partition model. It must not receive:

- API private keys, vault passphrases, Ed25519 signatures for proxied private calls, or session tokens.
- Private balances/orders/fills/transfers/fee responses for storage or caching.
- A generic `/proxy?url=` route, which would create SSRF and credential-forwarding risk.

### 11.2 If browser CORS fails

Preferred response: document the blocked capability and seek an official CORS solution or verified official browser SDK transport. Do not silently deploy a relay.

A future relay is a separate project requiring at least: local-versus-server signing decision, per-user authentication, encrypted credential custody if any, strict operation allowlist, tenant partitioning, no shared response cache, no secret logs, abuse/rate controls, CSRF/origin protections, deployment threat model, and deletion behavior. It is explicitly out of scope for this implementation plan.

### 11.3 Hosting

Static hosting is sufficient only after its CSP/security-header limitations are addressed. Development/preview servers are not approved for real keys until dependency/development-server findings are remediated. Production build output must be smoke-tested with public integrations and the exact private CORS origin.

## 12. Post-MVP cost-basis storage

Initially, opening lots and unresolved-flow decisions live only in the current memory session. If users later need persistence:

- Encrypt basis/coverage records with a versioned authenticated-encryption design separate from the key vault entry, so deleting a signing key does not silently destroy accounting records without explicit choice.
- Bind records to a non-identifying local portfolio profile, cost-basis method, contract version, and scope mapping.
- Store exact decimal strings/rationals and provenance notes; no floating-point snapshots.
- Support explicit export before deletion and clear migration/wipe behavior.
- Never store raw account IDs in filenames, URLs, logs, or analytics.

This additional persistence is not necessary for the first read-only release and should not be added merely to simplify state management.

## 13. Testing architecture

The current harness uses Node's test runner, Vite SSR module loading, and an in-memory `localStorage` shim. On 2026-10-23 it ran under Node `v22.22.3`; 12/12 tests passed. Preserve it and extend by layer.

### 13.1 Pure unit tests

- Decimal/rational arithmetic and hand-calculated financial vectors.
- Balance/equity/fill/fee formulas and coverage gates.
- FIFO/weighted-average post-MVP ledger and underflow/anomaly blocking.
- DTO validators, timestamp precision, scale rejection, unknown financial values.
- CSV/JSON escaping and no-secret/no-ID/no-cursor export checks.

### 13.2 Signer/vault tests

- Official documentation query example plus independent Ed25519 verification.
- Encoded/reserved/repeated/empty/Unicode/prefix-key/cursor cases; sent URL equals signed URL.
- Monotonic concurrent timestamps and fresh retries.
- In-memory vault-storage adapter tests for encryption, wrong passphrase, tamper, migration interruption, and wipe.
- Node WebCrypto tests where supported; real-browser tests remain necessary for IndexedDB, nonextractable Ed25519 keys, and cross-tab behavior.

### 13.3 Fake-fetch contract/integration tests

Inject `fetchImpl` into the private client. Assert operation/method/path/query/headers without using real secrets. Return synthetic responses for:

- Every dataset, empty and nonempty.
- Multi-page, empty intermediate page, repeated cursor, reserved-character cursor, later-page failure, page cap, and abort.
- 401/403/429/5xx/CORS-like rejection and malformed content type/schema.
- Duplicate/conflicting fills, order versions/replacements, repeated settlement legs, unknown transfer codes/assets.
- Late response after lock/scope switch and two-account cache isolation.

Use fixed synthetic key material only in tests and an independent public-key signature verification. Never place a real response with identifiers into fixtures.

### 13.4 Browser/UI tests

Add a browser-level harness only when implementation begins; jsdom alone cannot prove IndexedDB/WebCrypto/CORS/cross-tab behavior. Test:

- Vault lock/reload/wipe/migration and two-tab coordination.
- No private content before unlock or after lock.
- Every state in [04 §10](./04_ACCOUNT_ANALYTICS_FRONTEND_SPEC.md#10-universal-state-matrix).
- Keyboard/focus/mobile/table/chart alternatives and accessible announcements.
- Production build with no fixture controls and no accidental third-party account-route requests.

### 13.5 Optional owner-controlled live smoke

Never put credentials in CI or source. After all gates, the owner can run an explicit local smoke checklist with a disposable minimal-read testnet key. Record only sanitized status/schema results. Empty responses are not sufficient to validate every financial field; use synthetic nonempty fixtures for calculations and never ask the owner to trade for testing.

## 14. Observability without private telemetry

- Local diagnostics may count operation success/failure classes, page counts, duration, and safe error codes.
- Use random local correlation IDs, not account/key IDs.
- No remote account analytics, request/response logging, session replay, or browser error provider that could capture inputs/URLs/private state.
- A development debug view, if any, is fixture-only, tree-shaken out of production, and cannot dump vault/session/raw private objects.

## 15. Architecture acceptance checklist

- [ ] No account backend/proxy route or shared private cache exists.
- [ ] Private client accepts only explicit read GET operations.
- [ ] Secret and nonextractable key never enter React state, logs, URLs, or persistence.
- [ ] Private responses are memory-only and generation/scope/filter partitioned.
- [ ] Lock/wipe/scope switch aborts and invalidates late responses.
- [ ] Friendly REST decimals are never rescaled or converted to `Number` for accounting.
- [ ] Cursors remain opaque strings and coverage cannot be complete before exhaustion/validation.
- [ ] Unknown financial rows are visible and block affected aggregates rather than disappearing.
- [ ] Coverage gates are pure, independently tested, and required before P&L.
- [ ] Existing public routes/tests remain credential-free and pass.
- [ ] No real credential is needed for automated tests or development fixtures.
