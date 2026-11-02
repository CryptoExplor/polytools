# Security, custody, and accounting audit

## 1. Scope and release posture

This review covers the current working tree's key custody, signing, network boundaries, private-state lifecycle, public backend, exports, R2 cursor coverage, and R3 cost-basis/P&L behavior.

**No confirmed P0 accounting or custody defect was established by static review and the fresh synthetic suite.** That is not equivalent to live certification. Real-account compatibility is a **P0 verification gate before any production/live-compatible claim or real-data reliance**, because the necessary server/browser checks were not performed.

No real key, account, signature, private response, credential, authenticated request, or financial mutation was used. Owner evidence must remain sanitized.

## 2. Assets and trust boundaries

| Asset/boundary | Current design | Residual concern |
|---|---|---|
| Ed25519 private key | Encrypted at rest in IndexedDB; unlocked signing key is nonextractable and session-scoped. | Unlocked malicious JavaScript, a compromised device, phishing, and weak passphrases remain outside cryptographic guarantees. |
| Passphrase | PBKDF2 input; not stored; minimum-length UI guidance; no recovery. | Strength still depends on the user. JavaScript cannot promise erasure of every immutable copy. |
| Registered key ID | Validated and associated with an encrypted entry; local labels are not substituted for server IDs. | Local possession does not prove registration, read policy, or server acceptance. |
| Private responses | Validated and kept in generation/scope/operation/filter-partitioned memory. | Live account isolation and real schema behavior are unverified. |
| Browser → official account REST | Direct signed registered GETs to an exact official testnet origin. | Browser CORS, permissions, current server contract, rate limits, and eventual consistency are unverified. |
| Browser/backend → public data | Credential-free public market/catalog/flow routes. | Availability, sample fallback provenance, and third-party availability require runtime checks. |
| Public backend | No account private proxy and no shared private cache. | Open public CORS and lack of app-level rate limiting require deployment-level operational review, not private-key additions. |
| Exports/downloads | Explicit user action; loaded validated rows and manifests only. | A downloaded file leaves vault controls and must be handled as sensitive by the user. |
| Optional Worker cron | Public mover read plus optional Telegram POST. | Separate outbound side effect and secret configuration; not an account trading path. |

## 3. Custody and session controls

### Confirmed strengths

Evidence: `packages/core/src/account/vault.ts`, `vaultStorage.ts`, `canonical.ts`, `signer.ts`, `memoryStore.ts`, `data.ts`; synthetic tests in `tests/account.test.mjs`, `account-rest.test.mjs`, and `account-coordinator.test.mjs`.

- Vault version 2 entries use PBKDF2-SHA256 with 600,000 iterations and AES-GCM authenticated encryption.
- Unlocked Ed25519 signing keys are nonextractable `CryptoKey` objects; key-pair validation is required.
- Sessions have generations and abort signals. Lock, wipe, unlock/import/vault change, idle timeout, and cross-tab control paths invalidate use.
- A tab that misses a cross-tab message is designed to fail closed on its next sign.
- Legacy plaintext migration uses encrypted read-back verification and rollback/quarantine behavior; wipe can remove legacy and encrypted records without wiping unrelated public preferences.
- `MemoryDatasetStore` partitions by session/entry/scope, operation, and stable filters and clears on lifecycle events.
- Delayed responses after lock or newer requests are discarded instead of being returned as current private data.
- Server clock offset is validated and applied to signing timestamps; concurrent timestamp allocation is monotonic.
- Mutable buffers are overwritten where possible, and the UI correctly avoids claiming perfect JavaScript memory erasure.

### Residual risks and non-guarantees

- Encryption at rest does not make XSS or a compromised browser safe while unlocked. The application itself acknowledges this in `Portfolio.tsx`.
- The UI instructs users to attach only verified read policies. PolyTools cannot prove or enforce the key's server-side permissions merely by holding an `ak_...` ID.
- A nonextractable key prevents ordinary key export through WebCrypto; it does not prevent all abuse of an unlocked signing capability by hostile code in the same browser context.
- No wallet login was added. Public auth/wallet protocol documentation is not evidence that this repository implements wallet authentication.
- Account lock/wipe does not revoke the key at Polyester. The UI appropriately directs revocation to the official key UI.

## 4. Request-signing and REST boundary

### Confirmed code controls

Evidence: `packages/core/src/account/rest.ts` (`AccountRestClient`, `buildReadRequest`, `serializeReadOperation`), `signer.ts` (`READ_ONLY_OPERATIONS`, `Ed25519RequestSigner`), and `canonical.ts`.

- Only registered read operations and their exact paths/query names are accepted.
- Requests are GET-only to `https://api.testnet.polyester.com` with the pinned contract label `friendly-rest@b34853cb14366c9a64d53a20f6b09496a3c09fc4`.
- Dynamic order-detail paths are validated; arbitrary paths, methods, origins, conflicting scopes, unsupported filters, and malformed cursors are rejected.
- Fetch uses omitted credentials and rejects redirects. The signed target is checked against the request target.
- Canonical requests include timestamp, uppercase method, path, normalized query, and actual body hash. Prefix-key query ambiguity is blocked rather than guessed.
- Temporary retries are bounded and obtain a fresh timestamp/signature; permission failures are not retried as though transient.
- Structured/HTTP errors are mapped to safe errors without echoing raw private response bodies.
- JSON content and DTO schemas are validated before use. Unknown financial rows can quarantine coverage instead of disappearing.

### Unknown / Not verified

The reviewed OpenAPI artifact does not by itself prove runtime authentication or authorization behavior. In particular, static review does not establish:

- current CORS response/preflight behavior in supported browsers;
- acceptance of the signed headers by the live service;
- exact read policies for every operation, including balance history, open orders, order details, equity history, and current fee rates;
- current production/testnet response schemas and optional-field behavior;
- eventual-consistency lag across executions, orders, transfers, and settlement legs;
- server-side challenge/session revocation semantics (also not a PolyTools wallet-session implementation).

## 5. Security and reliability findings

### SEC-01 — Live account compatibility is an unresolved release gate

**Priority:** P0 before real-data reliance or live-compatible claims
**Confidence:** **Unknown / Not verified**, not a confirmed exploit or defect.

Synthetic tests cannot prove live CORS, permissions, schema compatibility, cursor completeness, account isolation, or fee reconciliation. A successful local signature also cannot prove server acceptance.

**Required response:** owner-run sanitized verification with least-privilege test keys and no committed raw private data. Any discovered failure should be triaged from actual sanitized evidence; do not speculate a root cause now.

### SEC-02 — No code-owned account request/import timeout

**Priority:** P1
**Confidence:** **Confirmed** from `rest.ts`, `data.ts`, and `AccountAnalytics.tsx`.

Abort signals support user cancellation and lifecycle invalidation, but no explicit transport or whole-import deadline was found. A stalled request can leave loading/import pending until the browser/network stack settles it.

**Required response:** add bounded deadlines that abort safely, retain previous snapshots, distinguish timeout from denial/empty data, and test late responses. Do not add retries that duplicate financial mutations; all current account operations are reads.

### SEC-03 — Repository security headers are not established

**Priority:** P2
**Confidence:** **Confirmed absence in reviewed repository configs; deployed state unknown.**

No Content-Security-Policy or common security-header set was found in `apps/web/index.html`, `vercel.json`, or Wrangler configuration. No deployed response headers were inspected.

**Required response:** define platform-appropriate CSP, frame-ancestors, MIME-sniffing, referrer, and permissions policies after inventorying required API, CoinGecko, brand-asset, inline-style, WebCrypto, and Worker needs. Test rather than pasting a policy that breaks the SPA. This is defense in depth, not a claim of an existing XSS.

### SEC-04 — Public facade needs operational abuse review, not private authentication

**Priority:** P2
**Confidence:** **Confirmed code boundary; deployment protection unknown.**

`backend/src/handler.ts` intentionally offers public GET/OPTIONS routes with open CORS. Cache/single-flight bounds reduce repeated origin work, but there is no application rate limiter in the reviewed handler.

**Required response:** check platform rate limiting, upstream quotas, cache cardinality, logging, and abuse controls. Do not respond by adding wallet authentication or sending account keys through this backend.

### SEC-05 — “Read-only” includes a separate optional notification side effect

**Priority:** P3 documentation/operations
**Confidence:** **Confirmed** in `backend/adapters/worker.ts` and Wrangler cron configuration.

The standalone/root Worker can read public movers every 15 minutes and POST to Telegram when configured. It does not mutate an exchange account, but it is an outbound non-financial side effect.

**Required response:** keep deployment docs precise and ensure Telegram secrets are used only for that bot. No Telegram secret or post was used in this audit.

### SEC-06 — Development fallback must never become live evidence

**Priority:** P2
**Confidence:** **Confirmed** in `apps/web/vite.config.ts`.

After an upstream 502, the Vite-only middleware can return `dataSource: "wire-samples"`, alter response parameters, and synthesize not-found flow results. Production handlers do not have this fallback.

**Required response:** retain explicit provenance, test fallback/production parity, and never use fallback success as API or deployment proof. Consider a persistent development banner rather than relying only on a compact topbar pill.

### Positive absence findings

Static searches and direct review did **not** find:

- a backend private-account proxy or shared private cache;
- public-trade substitution for private fills;
- order placement/cancellation/transfer/withdrawal implementation in PolyTools;
- wallet authentication added contrary to the deferred scope;
- remote/untrusted HTML passed to the Brand Kit's `dangerouslySetInnerHTML` fallback (its SVG strings are fixed repository constants);
- credentials or raw private errors intentionally included in the account export schema.

These are source-review observations, not a formal proof that no vulnerability exists.

## 6. Accounting model: observed activity versus profit

Evidence: `packages/core/src/account/decimal.ts`, `analytics.ts`, `coverage.ts`, and `normalize.ts`.

### Exact values and actual fees

- Account amounts remain exact decimal strings and exact rational arithmetic; display formatting does not feed back into accounting.
- Total balance is trading plus funding; reserved and available are not added again.
- Each fill's actual fee and fee asset drive its base/quote movement. Base fees reduce acquired inventory; quote rebates affect quote proceeds/cost.
- Maker rebates are supported; invalid negative taker rates are rejected.
- Current fee rates are used only for clearly labeled current-rate scenarios, never to reconstruct historical execution fees.
- Conflicting financial duplicates block aggregates; identical safe duplicates can be collapsed according to validated identity.
- Net quote flow, deposits, withdrawals, balance/equity changes, and sampled drawdown are activity/valuation metrics—not automatically profit.

### Coverage states

`Coverage` records pages, received/accepted/duplicate/conflicting/unknown/dropped rows, cursor exhaustion, cap state, requested/observed windows, opening basis, flow status, and retrieval time. `completeMetricEligibility` and `pnlEligibility` are intentionally stricter than observed-row display.

A denied, blocked, malformed, capped, or unavailable result must not become an empty successful account or a zero financial value. Fresh tests exercise many of these paths synthetically.

## 7. R2 cursor integrity

Evidence: `packages/core/src/account/pagination.ts`, `data.ts` (`importCursorHistory`), `AccountAnalytics.tsx`, and `tests/account-coordinator.test.mjs`.

### Confirmed invariants

- Opaque cursors are encoded exactly once; reserved/Unicode values are not decoded or reinterpreted.
- Empty intermediate pages do not end a valid cursor chain.
- Repeated cursors, caps, aborts, and later errors leave coverage incomplete.
- Selected imports request only selected operation families and run sequentially with page/row progress.
- A clean complete result requires cursor exhaustion and reconciled rows; a cap alone is partial.
- Import errors preserve the entire previous UI snapshot. Cancellation also preserves it. Cap-only success merges labeled partial results.
- Order details may retain a validated partial prefix after a later-page error, with partial coverage; its execution cursor is not treated as a settlement/order-state reconciliation watermark.

### Live limitations

Real cursor coverage, repeated settlement legs, eventual consistency, and actual transfer/fill correlation have not been tested. Official protocol review indicates repeated execution settlement legs may need `tx_id` deduplication and `link_id` is correlation metadata—not automatic proof that a unified transfer is a unique leg or belongs to a particular fill. Current R3 appropriately requires user resolution rather than guessing.

## 8. R3 arithmetic and independent output gates

Evidence: `packages/core/src/account/lots.ts` (`analyzeCostBasis`, lot acquisition/removal helpers), `AccountCostBasis.tsx`, and `tests/account-lots.test.mjs`.

### Calculation outline

For each account scope/base/quote ledger:

- **Buy:** acquire the actual post-base-fee quantity; cost is the quote debit including actual quote fee/rebate effects. Unsupported negative basis blocks.
- **Sell:** remove inventory by FIFO or moving weighted average; add `actual quote movement − removed acquisition cost` to realized P&L.
- **External acquisition:** requires explicit quantity, cost, time, and provenance.
- **Non-trade disposal:** removes cost without treating the flow as automatic zero-proceeds trading profit.
- **Internal transfer:** moves the exact carried lots only across a valid matched mapping; unmatched or invalid legs block affected sides.
- **Unrealized P&L:** `remaining quantity × fresh labeled mark − remaining exact cost`.
- **Total P&L:** realized plus unrealized only when both values are eligible.

The implementation uses exact rational recurring values for moving weighted average and has hand-calculated regression cases.

### Mandatory gates

| Gate | Failure behavior |
|---|---|
| Explicit analysis window | Missing/unordered window blocks. |
| Established opening basis | Unknown basis blocks; opening zero needs complete-since-inception attestation/provenance. |
| Complete clean fills | Partial, capped, conflicting, unknown, or dropped coverage blocks. |
| Resolved relevant flows | Missing, unknown, or invalid resolutions block. Zero relevant flows is valid only when actually zero—not a blanket bypass. |
| Valid inventory | Underflow and unsupported negative basis block. |
| One quote model per ledger | Mixed quotes stay separate; no silent FX/conversion. |
| Fresh single mark for current valuation | Missing/stale/conflicting/future mark suppresses unrealized and total. |

**Independent output behavior:** realized P&L can be shown without a fresh mark if all realized-input gates pass. Unrealized requires those underlying ledger gates plus a fresh mark. Total requires both. Missing values remain `null`/Unavailable rather than zero.

The earlier tentative “zero required flows” P0 concern was withdrawn after full-file inspection and must not be restored: current code constructs `requiredCount` from relevant transfers and checks resolved counts/issues.

## 9. R3 review boundary and non-claims

**Confirmed classification:** experimental, user-assisted accounting with strong fail-closed arithmetic.

- Manual opening-lot provenance, opening-zero attestation, flow mappings, and marks are user-provided evidence, not independently verified statements.
- The UI does not provide one-to-one, amount-reconciled statement/wallet/fill reconciliation for every manual decision.
- SSR/source tests do not exercise a complete successful interactive resolution workflow.
- No live fee reconciliation, transfer-leg reconciliation, account-scope isolation, or current-mark feed was tested.
- R3 values are not included in account exports and no tax-lot report is generated.
- No tax jurisdiction, tax lot disposal rule beyond the selected accounting method, historical FX, or filing correctness is claimed.

Do not simplify these limitations by treating missing basis/flows as zero, linking every `linkId` automatically, deriving historical fees from current rates, or using stale/public marks as verified account valuations.

## 10. Export and data-disclosure review

Evidence: `packages/core/src/account/export.ts`, `apps/web/src/lib/download.ts`, `AccountAnalytics.tsx`, and `tests/account-export.test.mjs`.

- Export is an explicit action with a confirmation dialog that names dataset, format, and coverage.
- Loaded rows are exported with a manifest; filtered transfers use only the selected filtered rows.
- Exact source decimals remain strings where required; derived fill values are identified separately.
- Spreadsheet formula prefixes are escaped without altering ordinary valid decimals.
- Reviewed exports omit credentials, key material, account/subaccount identifiers, cursors, addresses, and raw errors.
- Partial exports are not represented as complete statements; metadata-free empty CSV is refused.
- Once downloaded, file custody is the user's responsibility. Browser download behavior was not tested in this audit.

## 11. Required owner verification before live reliance

Use `docs/account-live-verification.md` as a checklist, not as completed evidence. A sanitized run should establish, per operation and account scope:

1. supported browser/secure context and CORS preflight;
2. least-privilege read policies and independent denial behavior;
3. real response schemas, optional fields, exact decimals, and malformed-row handling;
4. cursor exhaustion/caps/repeated cursors and row-count reconciliation;
5. cross-account/session isolation and immediate lock/wipe invalidation;
6. actual execution fee/rebate assets and amounts against owner records;
7. order lineage and repeated settlement-leg handling without assuming cursor settlement completeness;
8. transfer-leg identity/correlation and explicit R3 flow resolution;
9. opening-basis evidence, quote/FX requirements, and fresh-mark provenance;
10. export contents with sanitized inspection and no secrets/raw private identifiers.

Any owner artifact should redact keys, signatures, account IDs, subaccount IDs, addresses, transaction IDs where sensitive, raw responses, and personal/financial details. This audit did not create or modify owner verification artifacts.
