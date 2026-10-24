# Account analytics implementation roadmap

**Status:** prioritized implementation plan; no application source changes have been made  
**Current baseline:** PolyTools `171aa84a8753243dc75c9938db7d7e61dc187fa7`; 12/12 tests, typecheck, and production build pass. Private API calls, CORS, and account analytics remain undemonstrated.  
**Rule:** a phase can deliver synthetic tests and UI states, but no phase may represent blocked/unverified live behavior as working.

## 1. Release outcomes

| Release | Outcome | Explicitly not included |
| --- | --- | --- |
| **R0 — Secure foundation** | Encrypted vault, one signer, safe GET client, synthetic fixtures, state/coverage machinery | Real-key claim, analytics production release |
| **R1 — Core read-only analytics** | Owner-verified connection, current balances, sampled balance/equity history, open/historical orders, fills, observed fill/fee metrics | Guaranteed P&L, private backend, writes |
| **R2 — Activity and export** | Unified finalized activity after grant/coverage verification, current effective rates, safe data/coverage exports | Tax report, deposit-as-profit, fee-as-burn |
| **R3 — Gated cost basis (optional)** | Opening-lot/flow resolution plus FIFO or weighted-average realized/unrealized P&L only when eligible | Automatic historical P&L on partial data, tax advice |
| **Future** | Subaccount aggregation, holds, private realtime, alternative official transport | Any unreviewed credential relay or permission expansion |

R1/R2 may release a smaller clearly labeled dataset subset if an optional endpoint is blocked. They may not hide the gap or fill it with synthetic production data.

## 2. Priority summary

### Must have before real-key R1

- Versioned encrypted vault, migration/quarantine, memory-only unlock, auto-lock, cross-tab lock/wipe.
- One canonical Ed25519 signer with monotonic fresh timestamps and independent vectors.
- Strict GET operation allowlist, explicit testnet host, safe errors, no secret logs/URLs.
- Authenticated browser CORS verification and owner-controlled least-privilege policy probes.
- Memory-only, session/scope/filter-partitioned private store with late-response invalidation.
- Exact decimal arithmetic and opaque cursor handling.
- Coverage badges and all disconnected/locked/loading/empty/partial/stale/denied/blocked states.
- Current balances and sampled history labels that never imply live P&L.
- Dependency/CSP/security-header triage and production-like testing.
- Existing public routes remain credential-free; test/typecheck/build pass.

### Should have for R1/R2

- Orders/fills cursor-complete ingestion and order detail drawer.
- Actual fees/rebates grouped by asset; observed volume/net quote flow grouped by quote.
- Transfer activity after exact grant and coverage behavior are established.
- Safe CSV/JSON export with coverage manifest and spreadsheet-injection defenses.
- Keyboard/mobile/browser tests and production public-integration smoke tests.

### Could have later

- Subaccount selector after root scope, then carefully gated aggregation.
- Holds and deposit-address views only if a user requirement and official access are established.
- Private websocket updates after REST reconciliation and browser support are proven.
- Encrypted cost-basis persistence and additional accounting methods after review.

### Will not have in this work

- Trading, cancellation, transfer, withdrawal, key/policy mutation, or interactive-session acquisition.
- Shared global credentials, persistent decrypted keys, secrets in logs/URLs, or unpartitioned private caches.
- Fake live data, silent zero-filling, deposit-as-profit, fee-as-burn, or unsupported historical P&L.
- A generic proxy fallback merely because browser CORS is blocked.

## 3. Dependency graph

```text
Pinned contract + current-state audit
        │
        ├──────────────► Synthetic DTOs / fake-fetch contract tests
        │                           │
        ▼                           ▼
Vault + signer + deployment security ──► R0 secure foundation
        │                           │
        │                           ▼
        │                 Browser preflight / synthetic invalid-key CORS test
        │                           │
        └──────────────► Owner-controlled minimal-policy live gate
                                      │
                         ┌────────────┴─────────────┐
                         ▼                          ▼
               Balances/equity R1             Orders/fills R1
                         │                          │
                         └────────────┬─────────────┘
                                      ▼
                         Transfers/rates + safe export R2
                                      │
                                      ▼
                    Opening basis + resolved non-fill flows + marks
                                      │
                                      ▼
                            Optional gated P&L R3
```

A blocked live gate stops the corresponding production claim, not synthetic engineering work. It never triggers a proxy or write-permission workaround.

## 4. Phase plan

## Phase 0 — Research and evidence baseline (complete)

**Delivered:** eight reports under `research/account-analytics/`; official source revisions and current application behavior documented.

**Evidence established:**

- Actual public-only app/backend behavior and current vault/signer defects.
- Official friendly REST/ConnectRPC paths, SDK coverage, session-only boundaries, schema fields, scale/time conflicts, and pagination semantics.
- Public REST calls only; no authenticated calls or financial mutations.
- Formula and coverage rules that prevent false P&L.

**Remaining evidence gaps:** authenticated CORS, per-RPC grants, private response examples, history-point timestamps, complete transfer semantics, and real application account behavior.

**Exit:** reports cross-checked; no application source edited.

## Phase 1 — Security foundation

**Priority:** P0; blocks real credentials.

### Work

1. Introduce the versioned encrypted IndexedDB vault and storage adapter from [02](./02_ACCOUNT_CONNECTION_AND_SECURITY.md).
2. Detect/quarantine `poly-tools:vault:v1`; implement explicit migration/delete paths with synthetic keys.
3. Consolidate canonicalization/signing into one core module; preserve compatibility only through reviewed wrappers.
4. Add monotonic timestamps, exact-body hashing, fresh retry signing, strict key-ID/secret validation, and nonextractable session-key import.
5. Implement Lock, Forget, idle lock, cross-tab messages, abort/generation invalidation, and secret-input cleanup.
6. Inventory external resources; deploy/test CSP and security headers for each intended real-key host.
7. Triage dependency advisories. Upgrade/test Vite/React Router or document why a specific advisory is unreachable; real keys remain out of dev/preview until development-server issues are resolved.
8. Add secret/telemetry restrictions and ensure account routes have no third-party analytics.

### Tests

- Plaintext absence, wrong passphrase, tamper/AAD/IV/salt failure, interrupted migration, wipe, reload, cross-tab lock.
- Independent signature verification; canonical reserved/repeated/empty/Unicode/prefix-key/cursor vectors.
- Concurrent timestamp uniqueness and no blind auth retry.
- No decrypted key in React state/storage/logs; late response after lock is discarded.

### Exit gate

All synthetic security tests pass in supported real browsers and production build. No real key has been needed. If nonextractable Ed25519 or required headers cannot be supported safely, stop and revise the design rather than weakening it.

## Phase 2 — GET-only contract client and coverage engine

**Priority:** P0; can proceed with synthetic fixtures after Phase 1 interfaces are defined.

### Work

1. Implement explicit friendly REST operation registry and per-operation serializers from the pinned OpenAPI.
2. Add safe `fetch` defaults, `AbortSignal`, error mapping, conservative retry/backoff, and response content/schema validation.
3. Implement exact decimal/rational module and timestamp/ID-preserving normalization.
4. Implement opaque cursor state machine, repeated-cursor detection, page caps that produce partial status, dedup/conflict detection, and coverage records.
5. Implement `Me`/capability service and account-session/scope/filter-partitioned memory store.
6. Create synthetic fixtures for every dataset and all failure states; no real identifiers or credentials.
7. Add contract-drift checks against the selected pinned artifact during development/CI where feasible without exposing credentials.

### Tests

- Every endpoint method/path/query name, including friendly REST differences.
- Empty/nonempty/multi-page/empty-intermediate-page/later-error/repeated-cursor/page-cap/abort cases.
- Unknown financial fields, scale mismatch, timestamp representation, duplicate conflict, order version/replacement, settlement dedup.
- Two accounts with identical filters cannot share state; scope switch invalidates late responses.

### Exit gate

The client passes fake-fetch tests and never issues a non-GET or unregistered path. No metric can be marked complete without coverage. Cursors and decimal values survive losslessly.

## Phase 3 — Account UI shell and state-complete frontend

**Priority:** P0/P1; synthetic only until Phase 4.

### Work

1. Evolve `/portfolio` into Overview, Balances, Orders, Activity, and Security routes per [04](./04_ACCOUNT_ANALYTICS_FRONTEND_SPEC.md).
2. Build connection wizard, locked/unlocked screens, capability checklist, connection bar, scope control, Lock/Forget.
3. Add shared `CoverageBadge`, freshness, safe error, empty/partial/denied/blocked, and metric-availability components.
4. Implement responsive/accessible tables, chart alternatives, keyboard/focus behavior, and beginner glossary copy.
5. Add development-only fixture injection behind a non-production mechanism with permanent `FIXTURE — NOT LIVE` labeling.
6. Keep existing public pages and SDK snippets credential-free.

### Tests

- Every state in the universal state matrix; no unknown/denied state becomes zero.
- Lock during delayed response, reload while locked, scope switching, offline/stale behavior.
- Mobile/keyboard/screen-reader flows and production absence of fixture controls.
- Visual regression ensures loading skeletons do not look like numeric data.

### Exit gate

All UI behavior is demonstrated with synthetic data. Production displays a truthful unavailable/setup state until live gates pass; it never displays fixtures as account data.

## Phase 4 — Owner-controlled live verification gate

**Priority:** P0 release blocker; no credentials in chat, CI, source, tickets, or shared backend.

### Preparation without a real key

- Test preflight/browser behavior with synthetic invalid credentials where possible; an auth failure with readable CORS headers can help diagnose browser access but does not verify a private success.
- Verify exact deployment origin, HTTPS, host alias, CSP `connect-src`, and production build.
- Prepare sanitized result templates and synthetic key material. Do not ask the user to trade or transfer.

### Owner verification sequence

1. Owner creates a disposable testnet key in the official UI, with no policy initially.
2. Verify `Me`; confirm documented no-policy denials for data reads.
3. Isolate `read-balances`, `read-spot`, and optional `read-internal-transfers` tests using separate owner keys or carefully recorded policy changes.
4. Record safe status/code/schema results for every enabled read, including holds/fee-rate unknowns without elevating permissions.
5. Verify signed browser CORS, canonical query conflict cases, actual decimal/timestamp forms, empty and nonempty shapes available without financial mutations, cursor exhaustion, and rate-limit behavior.
6. Verify root scope first; subaccount listing/scope only afterward.
7. Revoke test keys in the official UI when finished.

### Exit gate

Update [01](./01_OFFICIAL_API_CAPABILITY_MATRIX.md) with exact evidence labels. Each R1 operation is either **authenticated endpoint-call-verified** from the actual browser origin or excluded/blocked with a documented reason. No unresolved ambiguity is hidden behind a happy-path UI.

## Phase 5 — R1 core analytics

**Priority:** P1 after Phase 4.

### Work

1. Connect current balances and highlights; exact total = trading + funding and zero-balance controls.
2. Connect balance/equity histories with fixed ranges/groupings, actual sample bounds, and no unverified point timestamps.
3. Implement sampled equity change/drawdown and explicit not-P&L explanations.
4. Connect open orders, terminal history, fills, and order details with cursor/coverage behavior.
5. Implement observed notional, volume/base flow/net quote flow by quote asset, and actual fee/rebate totals by fee asset.
6. Keep the P&L card unavailable unless the separate R3 gates are met.
7. Add conservative visible-tab refresh/manual refresh and per-dataset stale states.

### Exit gate

On the owner's verified testnet connection, every visible number has a source, scope, coverage, and freshness. No deposit/equity change/cash flow is called profit. Public tools and all existing checks still pass.

## Phase 6 — R2 activity, rates, and export

**Priority:** P1/P2; individual items depend on Phase 4 evidence.

### Work

1. Add finalized unified transfer activity with contract reason labels, debit/credit signs, unknown-code handling, and no double-counted trade/fee legs.
2. Clearly label client-side filters over loaded rows because friendly transfers lacks ConnectRPC time/code filters.
3. Add current effective maker/taker rates as a separate current panel; do not reprice history.
4. Add explicit export of loaded/covered rows plus a coverage manifest, exact raw decimals, safe filenames, and CSV formula defenses.
5. Add optional full-cursor import with progress/cancel/page policy; caps always produce partial status.

### Exit gate

Transfers are either verified and covered or visibly unavailable. Exports contain no credentials/cursors/raw account IDs and cannot be mistaken for complete P&L/tax statements.

## Phase 7 — Production hardening and rollout

**Priority:** P0 before broad real-key availability; work starts in Phase 1 and is rechecked here.

### Work

1. Re-run dependency audit, secret scanning, CSP/security-header checks, production build, typecheck, and all tests.
2. Browser-test supported Chrome/Firefox/Safari or explicitly narrow support based on actual WebCrypto/IndexedDB behavior.
3. Test TradingView/public MCP/CoinGecko integrations under the deployed CSP; avoid unnecessary third-party requests on account routes.
4. Verify refresh/rate behavior, memory growth on long histories, exact-rational resource limits, and large-table accessibility/performance.
5. Publish user documentation for key setup, read policies, lock versus revoke, data meanings, and incomplete-data states.
6. Roll out in stages: synthetic internal → owner testnet verification → limited read-only testnet availability → broader availability after no P0/P1 findings.

### Rollback

Disable account connection/account-data routes through a non-secret local/compile-time control while leaving public tools intact. Lock and clear local data. Local rollback/Forget does not revoke a Polyester key; user documentation must direct the owner to official revocation if compromise is suspected.

## Phase 8 — Optional R3 cost-basis analytics

**Priority:** P2; do not pull into R1 merely to fill a dashboard card.

### Work

1. Implement exact FIFO or weighted-average ledger per account/base/quote/method.
2. Add opening-lot input with quantity, exact cost, quote asset, acquisition time, and provenance note; never prefill current price as historical basis without explicit user choice/warning.
3. Add non-fill flow resolution and internal-transfer basis mapping. Unknown codes/destinations/basis remain blockers.
4. Add fresh labeled mark source for unrealized P&L; missing/stale marks suppress current unrealized values.
5. Add method/coverage/provenance displays and independent worked-example tests.
6. Only then consider encrypted basis persistence; memory-only remains valid for the first R3 iteration.

### Exit gate

Every P&L number is traceable to opening lots, complete fills, resolved flows, method, quote asset, and (for unrealized) mark. Partial accounts continue to show observed activity without P&L.

## 5. Verification matrix

| Area | Current evidence | Required before claim |
| --- | --- | --- |
| Existing app | Repository-inspected; tests/typecheck/build demonstrated | Regression checks after every phase |
| Public REST | Four live public outcomes, including structured invalid-depth error | Keep public smoke tests; no private inference |
| Private REST schemas | Pinned friendly OpenAPI/proto source | Browser authenticated calls and sanitized nonempty/empty fixtures |
| SDK methods | TS/Python/Rust pinned source | No call claim unless actually exercised |
| Policy grants | Enum semantics + no-policy docs | Owner minimal-policy per-operation results |
| CORS | Unknown | Exact-origin preflight and signed browser response |
| Signing | Docs + official TS transport source | Independent vectors and server acceptance for ambiguous queries |
| Balances/equity | Schema-source only | Successful private calls, scale/timestamp checks, app demonstration |
| Orders/fills | Schema/SDK-source only | Successful private calls, pagination/dedup/reconciliation tests |
| Transfers/rates | Schema/SDK-source only; grants unclear | Minimal-policy success or explicit unavailable state |
| MCP accounts | No private support established | Do not claim without official tool schema and successful authorized call |
| P&L | Formula design only | R3 data/basis/mark gates and application demonstration |

## 6. Risk register

| Risk | Impact | Mitigation / stop condition |
| --- | --- | --- |
| Legacy plaintext key persists | Secret theft | Quarantine/migrate/wipe; storage tests; no real-key use before gate |
| XSS/dependency/dev-server exposure | Key and private-data compromise | CSP, dependency triage, no third-party account telemetry, no real keys in dev/preview |
| CORS blocked | Browser client cannot connect | Report/exclude; no shared proxy or `no-cors` workaround |
| Policy mapping differs | Missing data or pressure to over-permission | Independent read probes; never add writes |
| Canonical query doc/SDK conflict | Signatures fail, pagination blocked | Same pair list for URL/signature; independent/live vectors; pin behavior |
| Host alias drift | Calls hit unintended/unverified environment | Explicit tested base URL; no silent failover/mainnet |
| REST/Connect scale confusion | Catastrophically wrong amounts | Friendly decimal schema; no scale divisors; drift tests |
| Timestamp representation drift | Misordered fills/lots | Preserve raw precision; verify per operation; block ambiguous ordering |
| Opaque cursor parsed/truncated | False complete history | String-only cursor, repeated-token detection, exhaustion/coverage tests |
| Eventual consistency | False reconciliation/completeness | Keep retrieval/freshness metadata; do not treat empty page as watermark |
| Unknown/dropped rows | Misleading totals/P&L | Quarantine and coverage failure; no SDK-style silent unknown-symbol drop |
| Missing opening basis/non-fill flows | Fabricated P&L | Hard eligibility gate; observed metrics only |
| Mixed quote/fee assets | Nonsensical aggregates | Group by asset; historical FX required for consolidation |
| Rate limiting/large history | Stale UI, memory pressure | Conservative scheduler, explicit user import, resource caps that mark partial |
| Cross-account cache leakage | Private data shown to wrong account | Mandatory generation/scope key, abort, isolation tests |
| Export leakage/spreadsheet injection | Private data exposure or code execution in spreadsheet | Explicit export, no IDs/secrets/cursors, formula escaping, coverage manifest |
| Scope creep to writes/backend | Security and mission failure | GET allowlist and non-goals; separate review required |

## 7. Test and release commands

Current commands (all passed at baseline after dependency installation):

```bash
npm test
npm run typecheck
npm run build
```

During implementation, extend `npm test` or add explicit package scripts for the new pure/browser suites; do not claim browser security from SSR tests alone. Before release also run the repository's chosen secret scan and a reproducible dependency audit. If a lockfile is introduced intentionally, review/commit it according to repository policy; the research audit's temporary lockfile was removed and is not a supplied fix.

Release evidence must distinguish:

- unit test with synthetic fixture;
- browser application demonstration with synthetic fixture;
- schema verification;
- public endpoint call;
- authenticated owner-controlled endpoint call;
- production application demonstration.

## 8. Definition of done by release

### R0

- Security/vault/signer/client tests pass in target browsers and Node harness as applicable.
- No plaintext real/legacy key, duplicate canonical implementation, or unsafe private storage remains in the new path.
- Real-key UI remains gated until live verification.

### R1

- Exact-origin authenticated calls and policy outcomes recorded.
- Core screens work with real owner-verified testnet data or clearly exclude unsupported operations.
- All metrics obey exact arithmetic, coverage, and freshness rules; no P&L claim.
- Public regression tests, typecheck, production build, security checks, and accessibility scenarios pass.

### R2

- Transfer/rate capabilities are evidence-backed or unavailable.
- Exports are safe, exact, coverage-labeled, and free of secrets/identifiers/cursors.

### R3

- Independent lot/fee examples and incomplete-data blocking pass.
- Every P&L figure has complete basis/flow/method/mark provenance; otherwise it is unavailable.

## 9. Immediate next actions

1. Review and approve the eight specifications, especially direct-browser/no-proxy and memory-only decisions.
2. Implement Phase 1 with synthetic keys; no credential is needed.
3. Implement Phase 2 fake-fetch/pagination/coverage tests in parallel where interfaces are stable.
4. Run browser preflight/synthetic-invalid-key CORS diagnostics from the intended origin.
5. Only after security gates, ask the owner to perform the Phase 4 minimal-policy procedure locally. Do not request the key in conversation.
6. Update evidence matrices, then enable only verified R1 datasets.

The concise execution checklist is in [07_CODING_AGENT_MASTER_HANDOFF.md](./07_CODING_AGENT_MASTER_HANDOFF.md).
