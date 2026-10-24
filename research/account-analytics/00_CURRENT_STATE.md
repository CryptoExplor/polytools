# PolyTools account analytics — current-state audit

**Audit date:** 2026-10-23 (UTC)  
**Repository:** `CryptoExplor/polytools`  
**Audited revision:** [`171aa84a8753243dc75c9938db7d7e61dc187fa7`](https://github.com/CryptoExplor/polytools/tree/171aa84a8753243dc75c9938db7d7e61dc187fa7)  
**Research branch:** `arena/0dc32768-polytools`  
**Change type:** research and specification only; no application feature is implemented by these reports.

## 1. Executive answer

PolyTools is a **public, read-only Polyester testnet toolkit**. It has no working personalized account analytics and no authenticated request executor. Its existing `/portfolio` page is a local Ed25519 key vault and interactive request-signing tool; `/sdk` generates SDK source snippets. Neither page retrieves a private balance, order, fill, transfer, fee rate, or equity history.

The public product is substantial and reusable: market discovery, TradingView, pairs/markets, order books, candles, calculators, MCP examples, a glossary, and deployment adapters already exist. Account analytics should extend this shell rather than create a second application.

The highest-priority work is not a chart. It is to fix the current key-storage and signing design, establish one contract-tested private REST client, and verify browser access and least-privilege policies using synthetic fixtures first and only the owner's own disposable testnet key later. Deposits, current balances, and equity changes are **not profit**. Realized/unrealized P&L must remain unavailable unless cost basis and record completeness are proven.

## 2. Evidence language used by all eight reports

These labels describe **what was actually checked**. They must not be collapsed into a generic “verified” claim.

| Label | Meaning |
| --- | --- |
| **Repository-inspected** | The cited PolyTools file was read at the audited revision. This is not a live application demonstration. |
| **Documentation-verified** | The cited official Polyester documentation was retrieved. Documentation can conflict with generated/source artifacts. |
| **SDK-source-verified** | The cited official SDK source was read at the pinned commit. This is not proof that a call succeeded. |
| **Schema-source-verified** | A field, RPC, HTTP annotation, authentication restriction, or comment was checked in the pinned public protobuf/OpenAPI source. |
| **Endpoint-call-verified: public** | An unauthenticated public request returned content during this audit. This says nothing about private endpoints or browser CORS. |
| **Endpoint-call-verified: authenticated** | An authenticated request succeeded. **No private endpoint has this label in this audit.** |
| **Schema-verified, call unverified** | The contract was inspected, but no successful live call was made for that operation. |
| **Application-demonstrated** | A PolyTools behavior was exercised in the application or its automated test harness. The only application-level executions here are tests, typecheck, and production build. |
| **Blocked / unknown** | A required credential, CORS result, permission result, or other observation is unavailable. It is not inferred to work. |

Unless stated otherwise, “official” means Polyester/Fabric Labs public documentation or the pinned public repositories below—not an invented endpoint or a third-party description.

## 3. Sources and revision control

### 3.1 Application

- PolyTools at the revision linked above. Relevant local files are cited by repository-relative path throughout this report.
- The web manifest declares React/React DOM `^18.3.1`, `react-router-dom` `^6.26.2`, Vite `^5.4.8`, and TypeScript `~5.6.2`; the backend declares Node `20.x` (`apps/web/package.json`, `backend/package.json`). In the no-lockfile audit environment, installed versions included React/React DOM `18.3.1`, React Router DOM `6.30.6`, Vite `5.4.21`, and TypeScript `5.6.3`. Manifest declarations are **repository-inspected**; installed versions were checked with `npm ls --depth=0`.

### 3.2 Official contract and SDK sources

All four were shallow-cloned and inspected; none was treated as a successful API call.

| Source | Pinned revision | Inspected version / role |
| --- | --- | --- |
| [`Fabric-Labs/polyester-proto`](https://github.com/Fabric-Labs/polyester-proto/tree/b34853cb14366c9a64d53a20f6b09496a3c09fc4) | `b34853cb14366c9a64d53a20f6b09496a3c09fc4` | Public protobuf and generated REST OpenAPI contract |
| [`Fabric-Labs/polyester-sdk-typescript`](https://github.com/Fabric-Labs/polyester-sdk-typescript/tree/f80711678d7944d1ce990d455e0f63d8f3013f2e) | `f80711678d7944d1ce990d455e0f63d8f3013f2e` | Package `0.31.0`; browser-capable TypeScript SDK |
| [`Fabric-Labs/polyester-sdk-python`](https://github.com/Fabric-Labs/polyester-sdk-python/tree/27bf356e56c3f1fe5e35cac09eb8eed358895125) | `27bf356e56c3f1fe5e35cac09eb8eed358895125` | Package `0.1.0a55`; API-key SDK |
| [`Fabric-Labs/polyester-sdk-rust`](https://github.com/Fabric-Labs/polyester-sdk-rust/tree/610db7d72fb81c7958ad4904b0534253879b05d9) | `610db7d72fb81c7958ad4904b0534253879b05d9` | Package `0.1.0-alpha.49`; API-key SDK |

Generated REST OpenAPI and checked-in TypeScript protobuf output do not always match the authoritative `.proto` comments or friendly SDK transforms. Implementation must pin one artifact set and add drift tests; see [01](./01_OFFICIAL_API_CAPABILITY_MATRIX.md) and [03](./03_ANALYTICS_AND_FINANCIAL_FORMULAS.md).

### 3.3 Principal official documentation

- [Authentication and security](https://testnet.polyester.com/docs/developer-docs/authentication-security/ed25519-api-keys): Ed25519 headers, canonical request, timestamp window, and signing rules.
- [REST getting started](https://testnet.polyester.com/docs/developer-docs/rest/getting-started): production-supported REST and Ed25519 private calls.
- [Connectivity matrix](https://testnet.polyester.com/docs/developer-docs/getting-started/connectivity-matrix) and [SDK capability matrix](https://testnet.polyester.com/docs/developer-docs/getting-started/sdk-capability-matrix).
- [TypeScript installation](https://testnet.polyester.com/docs/sdk/typescript/get-started/installation), [authentication](https://testnet.polyester.com/docs/sdk/typescript/guides/authentication), and [accounts/balances](https://testnet.polyester.com/docs/sdk/typescript/guides/accounts-and-balances).
- TypeScript references for [balances](https://testnet.polyester.com/docs/sdk/typescript/reference/balances), [transfers](https://testnet.polyester.com/docs/sdk/typescript/reference/transfers), [orders](https://testnet.polyester.com/docs/sdk/typescript/reference/orders), [trades](https://testnet.polyester.com/docs/sdk/typescript/reference/trades), [fees](https://testnet.polyester.com/docs/sdk/typescript/reference/fees), [deposit](https://testnet.polyester.com/docs/sdk/typescript/reference/deposit), [subaccounts](https://testnet.polyester.com/docs/sdk/typescript/reference/subaccounts), and [API keys](https://testnet.polyester.com/docs/sdk/typescript/reference/api-keys).
- [Scaled integers](https://testnet.polyester.com/docs/developer-docs/connectrpc/scaled-integers) and [trading fees](https://testnet.polyester.com/docs/user-docs/fees-and-vip).

These are **documentation-verified**. Conflicts and unverified items are explicitly listed rather than silently resolved.

## 4. Application inventory

### 4.1 Runtime shape

| Layer | Current behavior | Evidence |
| --- | --- | --- |
| Web | React 18 + TypeScript + Vite SPA; Tailwind-style utilities; hash-based public-state snapshots in the URL. | `apps/web/src/App.tsx`, `main.tsx`, `vite.config.ts`; repository-inspected |
| Core | Browser-compatible public configuration, MCP client/tools, normalization, formatting, polling, key generation/import, canonicalization, and signing. | `packages/core/src/*`; repository-inspected |
| Backend | Node/Hono-like fetch handler plus Vercel, Netlify, and Cloudflare adapters. All delegate to the same public GET facade. | `backend/src/handler.ts`, `backend/adapters/*`; repository-inspected |
| Public data | Direct browser REST for most public data; public MCP for order-book depth and trades; optional CoinGecko comparison prices. | `apps/web/src/lib/{api,hooks,coingecko}.ts`; repository-inspected |
| Persistence | Preferences, recent markets, dismissals, calculator state, and the current private-key vault use browser `localStorage`. | `apps/web/src/lib/store.tsx`, `packages/core/src/keys.ts`, page files; repository-inspected |
| Deployment | GitHub Pages static app, Vercel static + functions, Netlify static + functions, or Cloudflare Worker serving static assets and API. | `vercel.json`, `_redirects`, `wrangler.toml`, `backend/wrangler.toml`, `.github/workflows/pages.yml`; repository-inspected |

There is no database, private account ingestion worker, account session service, private websocket consumer, or private-response store.

### 4.2 Existing routes

| Route | Existing component / actual function | Account analytics? |
| --- | --- | --- |
| `/` | `Dashboard`: market categories and lifecycle summaries. | No |
| `/markets` | `Markets`: searchable market table and lifecycle filters. | No |
| `/markets/:symbol` | `MarketDetail`: market overview, TradingView, order book, trades, and related data. | No |
| `/tokens` | `Tokens`: asset catalog and per-asset navigation. | No |
| `/tokens/:asset` | `TokenDetail`: asset details and related markets. | No |
| `/tokens/:asset/lifecycle` | `TokenLifecycle`: public token-lifecycle view. | No |
| `/analytics` | `Analytics`: public market/lifecycle analytics, not account analytics. | No |
| `/heatmap` | `Heatmap`: public market visualization. | No |
| `/portfolio` | `Portfolio`: local key vault and request-signing workbench. | **Signing only; no retrieval or analytics** |
| `/calc` | `Calc`: public converters/calculators and CSV export helpers. | No |
| `/mcp` | `Mcp`: public MCP examples/connection guidance. | No |
| `/sdk` | `SdkGuide`: SDK code generator and documentation links; snippets are text. | No execution |
| `/glossary` | `Glossary`: reusable searchable educational content. | No |

**Repository-inspected:** `apps/web/src/App.tsx` and all listed page files. There is no account-specific route, account switcher, authenticated provider, or account API state.

### 4.3 Public backend surface

`backend/src/handler.ts` exposes only these public GET routes:

| Route | Purpose | Current cache behavior |
| --- | --- | --- |
| `/api/health` | Health response | Public operational response |
| `/api/spot/config` | Public spot catalog | Shared TTL cache |
| `/api/spot/orderbook` | Public order book | Shared TTL cache |
| `/api/spot/trades` | Public recent trades | Shared TTL cache |
| `/api/spot/klines` | Public candles | Shared TTL cache |
| `/api/lifecycle/assets` | Public lifecycle list | Shared TTL cache |
| `/api/lifecycle/assets/:asset` | Public lifecycle detail | Shared TTL cache |

`backend/src/cache.ts` is a global in-memory TTL cache suitable only for public data. `backend/src/mcpServer.ts` maintains shared public MCP sessions. No route accepts an API key, signed account request, or private response. **Repository-inspected.**

The Vite development server can fall back to checked-in public wire samples when live public access fails (`apps/web/vite.config.ts`). That fallback must never be extended with synthetic private data presented as live account data.

## 5. Existing account/key functionality

### 5.1 `/portfolio`: what exists

`apps/web/src/pages/Portfolio.tsx` currently provides:

1. Generate an Ed25519 keypair locally.
2. Import an existing hex secret.
3. Persist vault entries in browser storage.
4. Show public/secret key material and copy controls.
5. Register/select a local key identifier.
6. Choose a method, path, query/body, and signature encoding.
7. Build a canonical request, sign it, and display the resulting headers.

It does **not** call `fetch` with those headers, verify the key against `/v1/auth/me`, retrieve balances, enumerate subaccounts, or calculate account metrics. Its sample/default balance path is `/v1/account/balances`, which does not match the official `/v1/balances` endpoint. **Repository-inspected; schema comparison.**

### 5.2 `/sdk`: what exists

`apps/web/src/pages/SdkGuide.tsx` generates copyable TypeScript/Python/Rust examples and contains a second canonical-string implementation. Trading snippets are documentation text, not app capabilities. No generated order, transfer, withdrawal, or trade is submitted by PolyTools. **Repository-inspected.**

The duplicate signer is a maintenance and security risk: account work should use one audited signing implementation, not add a third.

## 6. Security findings that block real-key analytics

Severity below is for the proposed use with real account-read credentials. It is not a claim that a remote exploit was demonstrated.

| Priority | Finding | Current evidence | Required disposition |
| --- | --- | --- | --- |
| **P0** | Extractable private keys are persisted as plaintext PKCS#8 hex in `localStorage` key `poly-tools:vault:v1`. There is no passphrase, encryption, lock, idle lock, or coordinated cross-tab wipe. | `packages/core/src/keys.ts` | Replace with versioned encrypted IndexedDB vault and memory-only unlocked material before real-key use. |
| **P0** | The same broad vault API exposes secret material and signing helpers to any script running in the origin; current hosting has no Content Security Policy or related hardening headers. | `keys.ts`, `index.html`, deployment configs | Minimize secret exposure, add CSP/security headers, audit dependencies, and avoid real keys in dev/preview. |
| **P0** | Registered key IDs are not robustly validated or checked against authenticated identity. A missing registered ID can leave a local label in the signing UI/headers. | `Portfolio.tsx`, `keys.ts` | Strictly validate `ak_...` shape; authenticated `/v1/auth/me` must establish context; never treat a label as identity. |
| **P0** | Signing output and imported secret text are not consistently cleared from UI/state on lock/wipe/navigation. | `Portfolio.tsx`, `SdkGuide.tsx` | Clear secret inputs, canonical bodies, signatures, private responses, and cached account state on lock/wipe/account change. |
| **P1** | Two signing/canonicalization implementations exist, with edge-case drift risk. The SDK-guide fallback can produce an empty-body hash for nonempty content when WebCrypto is unavailable. | `keys.ts`, `SdkGuide.tsx` | One WebCrypto-only implementation; fail closed; official and independent test vectors. |
| **P1** | The existing signer is an interactive tool, not a freshness-controlled private client. Retries and concurrent requests need monotonic timestamps. | `keys.ts`, official TS transport source | Port monotonic timestamp behavior; never reuse a stale signed attempt blindly. |
| **P1** | The production build does not define a CSP, `Referrer-Policy`, `X-Content-Type-Options`, or permissions policy in the inspected static/deployment files. | `index.html`, `_redirects`, `vercel.json`, worker configs | Add host-appropriate headers and test TradingView/CoinGecko/MCP compatibility. |
| **P1** | Dependency audit reports known advisories. | `npm audit --json` with a temporary lockfile on 2026-10-23 | Triage and upgrade/test before handling real keys; do not claim fixes from this report. |

### 6.1 Dependency audit result

The temporary lockfile-only audit reported **four vulnerabilities: three moderate and one high**:

- Direct `vite <=6.4.3` aggregates high/moderate/low advisories, primarily around development-server request handling; installed version is `5.4.21`.
- Transitive `esbuild <=0.24.2` has a moderate development-server advisory.
- Direct `react-router-dom` and transitive `react-router <7.18.0` have a moderate advisory; installed direct version in this audit environment is `6.30.6`.
- npm offered semver-major upgrades to Vite `8.3.5` and React Router DOM `7.18.4`. **No upgrade was applied.**

The app is an SPA, so a server-side-rendering-only advisory is not automatically an exploitable production path. Conversely, the Vite configuration exposes a development preview, so development-server advisories cannot be dismissed. Use synthetic credentials only in that environment until triage is complete. The temporary `package-lock.json` was deleted after the audit; the repository intentionally remains without a new lockfile.

## 7. What can be reused safely

| Existing module/component | Reuse decision | Boundary |
| --- | --- | --- |
| `Layout`, navigation, responsive shell | Extend with account navigation/status. | Keep all current public tools credential-free. |
| UI primitives in `components/ui.tsx` | Reuse cards, badges, tabs, tables, dialogs, skeleton/error/freshness patterns. | Add explicit denied/partial/incomplete states. |
| `Glossary` | Link beginner explanations for equity, cost basis, realized P&L, holds, maker/taker, and rebates. | Educational copy must not imply unavailable metrics exist. |
| `CandleChart` and chart conventions | Reuse public market charts only where appropriate. | Do not repurpose candle timestamps as account-history timestamps. |
| `packages/core/src/config.ts` | Extend environment/base-host handling carefully. | Resolve dotted vs hyphenated testnet aliases; no silent production fallback. |
| `format.ts`, `normalize.ts` | Reuse display formatting only after exact-decimal normalization. | Never run exact ledger arithmetic through JavaScript `Number`. |
| `poll.ts` | Reuse for visible-tab, abortable private polling after CORS is proven. | Partition by account and stop on lock/wipe/denial. |
| Public API/MCP clients | Leave unchanged for public tools. | Do not infer private MCP support from public MCP methods. |
| Public backend/cache/adapters | Reuse deployment patterns, not the global cache. | Private responses must never enter `backend/src/cache.ts`. |
| Test harness | Extend Node tests with Vite SSR module loading and synthetic storage. | Use independent expected values, not implementation-generated snapshots alone. |

The existing vault may inspire UX and migration detection, but **its current storage and validation must not be reused unchanged for real keys**.

## 8. Verification performed

### 8.1 Repository/application checks

| Check | Result on 2026-10-23 |
| --- | --- |
| `npm test` | **12/12 tests passed**, across four suites. |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed; production web output generated. |
| Initial test/typecheck without dependencies | Could not start; resolved by installing existing manifest dependencies with `npm install --no-package-lock --ignore-scripts`. |
| Initial `npm audit --json` | Failed with `ENOLOCK`; later temporary lockfile-only audit succeeded and was removed. |

These are application/build demonstrations only. They do not demonstrate an authenticated screen or a private API call.

### 8.2 Live public Polyester checks

Using the official dotted testnet REST host `https://api.testnet.polyester.com`:

| Request | Observed result | What it proves |
| --- | --- | --- |
| `GET /v1/spot/config` | Successful public JSON catalog; observed server timestamp `2026-10-23T15:14:58Z`; current config exposed nine-decimal price scaling and pair/asset constraints. | Public REST reachability and response representation on that date. |
| `GET /v1/spot/markets/BTC-USDT/overview` | Successful public decimal-valued market overview. | Public overview representation only. |
| `GET /v1/spot/markets/BTC-USDT/candles?...` | Successful public decimal-valued candles. | Public candles representation only. |
| `GET /v1/spot/markets/BTC-USDT/orderbook?depth=2` | Structured HTTP 400 `INVALID_DEPTH`, with supported depths in the error. | Structured public validation behavior; not a private error contract. |

No credentials were used. No order, trade, transfer, withdrawal, key mutation, or other financial mutation was attempted.

### 8.3 Blocked or unverified

- **No authenticated endpoint call was made.** No other person's credential was created or used.
- **Browser CORS for private REST is unknown.** A successful server-side/public fetch does not prove browser access with three custom auth headers.
- **MCP authenticated account coverage is unknown.** Existing PolyTools MCP tools are public-only.
- **Private realtime subscriptions are schema/SDK-source-verified only.** No browser private websocket was demonstrated.
- **Per-RPC policy grants are not completely annotated in the pinned public protobuf.** Policy enum semantics are known; exact grants for balances holds, unified transfers, and fee rates still need minimal-policy probes.
- **Complete historical coverage and exact cost-basis inputs are not established.** No accurate historical P&L claim is permitted.
- Direct sandbox `curl` to the public REST/MCP hosts failed with TLS `SSL_ERROR_SYSCALL`; the page-fetch path succeeded for public GETs. This is a sandbox transport limitation, not evidence that the services are down.

## 9. Current-state gap to the requested product

| Capability | Today | Target disposition |
| --- | --- | --- |
| Read-only account connection | Local signer only | Authenticated REST probe matrix with strict read-only policy |
| Balances | None | Current balances with explicit scope/freshness |
| Equity | None | Sampled history only, labeled as sampled—not live equity/P&L |
| Orders/fills | None | Cursor-complete retrieval, deduplication, status/scope filters |
| Transfers | None | Finalized unified activity with flow-code labels and coverage |
| Holds | None | Contract exists; friendly SDK/REST path and permission need verification |
| Fees | None | Effective current rates plus actual per-fill fees; never equate with burns |
| Cost basis/P&L | None | Gated, optional second phase; unavailable on incomplete records |
| Multi-subaccount | None | Explicit account scope; aggregate only when every required scope is complete |
| Export | Public calculator export only | Safe raw-data/coverage export; no misleading “tax report” |
| Secure persistence | Plaintext local vault | Encrypted, locked, wipeable vault; private responses memory-only initially |
| Backend privacy | Public global cache only | Direct browser private calls; no shared private cache/proxy by default |

## 10. Safest next verification step

1. Land no analytics until the P0 vault/signer findings have an accepted remediation design and synthetic tests.
2. In a local production-like build on an HTTPS origin the user controls, the **owner** creates a disposable testnet key in Polyester's official account UI. The owner attaches only the minimum read policies; PolyTools never creates or mutates the key.
3. Use a key with no policy first, if the owner elects to test: verify `/v1/auth/me` behavior and confirm private data reads are denied. Then attach one read policy at a time and record exact HTTP/RPC errors for each endpoint. Do not ask for or transmit the secret in chat, tickets, URLs, logs, or source control.
4. Verify CORS/preflight from the actual browser origin. If blocked, report it; do not silently add a credential-bearing proxy or weaken `fetch` security.
5. Record endpoint, request shape, policy set, response schema, pagination behavior, and timestamp representation. Synthetic fixtures remain the default automated-test input.

See [02](./02_ACCOUNT_CONNECTION_AND_SECURITY.md) for the full gate and [07](./07_CODING_AGENT_MASTER_HANDOFF.md) for implementation order.

## 11. Report map

1. [Current state](./00_CURRENT_STATE.md) — this audit.
2. [Official API capability matrix](./01_OFFICIAL_API_CAPABILITY_MATRIX.md) — endpoints, SDKs, permissions, pagination, and contract drift.
3. [Connection and security](./02_ACCOUNT_CONNECTION_AND_SECURITY.md) — vault, signing, CORS, privacy, and verification gates.
4. [Analytics and formulas](./03_ANALYTICS_AND_FINANCIAL_FORMULAS.md) — exact arithmetic, cost basis, and incomplete-data rules.
5. [Frontend specification](./04_ACCOUNT_ANALYTICS_FRONTEND_SPEC.md) — beginner-friendly pages, states, navigation, and exports.
6. [Backend/data architecture](./05_BACKEND_AND_DATA_ARCHITECTURE.md) — direct-client design, coverage ledger, caching, and tests.
7. [Implementation roadmap](./06_IMPLEMENTATION_ROADMAP.md) — phases, priorities, risks, and release gates.
8. [Coding-agent master handoff](./07_CODING_AGENT_MASTER_HANDOFF.md) — concise executable work plan and definition of done.
