# 11 — Optional BYOK AI analyst: proposed future phase

**Proposal only. Not approved, not scoped into the current programme, not implemented.**
No dependency was added, no route was added, no source file was touched.

This document exists so the idea is **recorded and bounded**, not so it can start. It is deliberately
sequenced *after* the wallet-first dapp and reliable analytics, and it must never become a dependency
of that release.

---

## 0. Position in the programme

Your stated priority order, which this document respects without reordering:

```
1. stable wallet-first dapp            ← current programme (02–05 of this audit set)
2. reliable analytics                  ← current programme (Stage 4)
3. optional AI analyst                 ← this document, read-only, separate approval
4. user-confirmed AI-assisted trading  ← this document §5 Phase 3, separate approval
5. monetization                        ← 09, when an eligible mechanism actually exists
```

**Hard sequencing rules**

| Rule | Why |
|---|---|
| The AI phase may not begin until the wallet-first dapp meets its own acceptance matrix (`07`) and PR #6 stabilization is closed | An AI surface on an unstable base compounds two failure modes |
| Nothing in `02`–`05` may depend on anything in this document | Reversing the dependency would let a speculative feature gate a real one |
| No production dependency is added for AI until this phase is approved | `check:dependencies` and the 8-prod-dependency budget in `01` stay as they are |
| AI is **off by default and route-gated** when it eventually ships | Same rule as monetization (`04` §8.3 rule 2) |

**Explicitly not a monetization claim.** A paid AI tier is *one possible* outcome, and this audit has
**no demand evidence** for it. Do not read this document as a revenue path — see `09` §0.5 for the
scope of the revenue conclusion.

---

## 1. Phase 1 — AI-readiness audit (the work this document contains)

### 1.1 What already exists and is reusable — verified in this tree

These are real, exported, deterministic functions. They are the natural first tool candidates
*because* they already exist, are already tested, and already encode the house rules about never
inventing values.

| Module | Exported capability | Determinism | Data class |
|---|---|---|---|
| `packages/core/src/account/analytics.ts` | `calculateFill`, `summarizeFills`, `deduplicateFills`, `observedFillEligibility`, `sampledEquityMetrics`, `currentRateScenario`, `totalBalance`, `sumExact`/`absoluteExact` | Pure, `ExactDecimal` throughout | **Private** (fills, balances) |
| `packages/core/src/account/lots.ts` | `analyzeCostBasis` (FIFO / weighted-average, opening lots, non-trade disposals, valuation marks) | Pure, deterministic | **Private** |
| `packages/core/src/account/coverage.ts`, `pagination.ts` | Coverage/honesty reporting for incomplete data | Pure | **Private** metadata |
| `packages/core/src/tools.ts` | `PolyesterData`: `spotMarkets`, `marketOverview`, `orderbook`, `candles`, `recentTrades`, `heatmap`, `depositWithdrawConfig`, `assetRoutes`, `compareRoutes`, `lifecycleFlow`, `lifecycleByTx`, `explainTransaction` — 12 read-only tools | Read-only, but **typed only** — `callTool<T>()` carries a TS generic with no runtime validation. `publicDtos.ts` validates the **HTTP facade** in `apps/web/src/lib/api.ts`; it does not validate these tool results | **Public** |
| `apps/web/src/lib/compare.ts`, `heatmap.ts`, `converter.ts` | Route comparison, depth-heatmap shaping, unit conversion | Pure | **Public** |
| `apps/web/src/lib/orderConstraints.ts` | `validateOrderDraft`, `roundToTick`, `isMultipleOf`, `compareDecimal`, `multiplyDecimal` | Pure, scaled-integer | **Neutral** (validation) |
| `apps/web/src/lib/publicDtos.ts`, `provenance.ts` | Runtime DTO validation + wire-sample provenance flagging | Pure | **Public** |
| `packages/core/src/format.ts` | `fmtNum`, `price`, `splitSymbol` | Pure | **Neutral** |

### 1.2 What does **not** exist — the gap, stated precisely

| Claim | Verification |
|---|---|
| No technical-analysis indicators | **Confirmed.** Repo-wide search for RSI/MACD/Bollinger/ATR/EMA/moving-average returns only a **glossary entry** (`Glossary.tsx:84`) and a **page-local session VWAP** (`Tape.tsx:233`, `totalNotional / totalQty`, "trades this browser session has seen, not the exchange daily VWAP"). Neither is a reusable indicator module. |
| No AI/LLM code, no provider SDK, no tool registry | **Confirmed.** No occurrences of OpenAI/Anthropic/provider SDKs; no dependency in `package.json`. |
| No candle-based backtesting | **Confirmed.** `CandleChart.tsx` renders; it does not compute indicators or simulate strategy performance. |
| No private-data boundary abstraction for third-party egress | **Confirmed.** There is no concept of "which fields may leave the app". This is the single largest new design burden (§7). |

So the honest framing: **PolyTools has a strong *public-data* substrate and a strong *deterministic
accounting* core, and essentially nothing for technical analysis or AI.** The AI phase would be
building indicators and a tool registry from near-zero, then putting a model on top.

### 1.3 Safe boundaries between public, private, and action

The only boundary that matters for AI is **egress**: what may enter a model context (which leaves the
browser for a third party). Proposed three-class model, to be enforced mechanically, not by prompt:

| Class | Contents | May enter model context? | Enforcement |
|---|---|---|---|
| **P** — public | Market data, candles, orderbook, trades, heatmap, route comparison, symbol/venue metadata | **Yes**, with source + timestamp + timeframe labels | Tool registry marks the tool `egress: "public"` |
| **U** — private aggregate | Portfolio totals, P&L, fee summaries, cost-basis results, coverage/honesty flags | **Only via tool results, never raw datasets**, and never with account identifiers | Registry marks `egress: "private-aggregate"`; response shape is a fixed, reviewed DTO |
| **X** — never | Session tokens, API keys, wallet addresses, private keys/seed phrases, raw fills/ledger dumps, other accounts' data | **Never** | No tool exists for these; registry has no `egress: "raw"` tier at all |

Design consequences:
- The model **never holds a raw fill feed, a ledger, or a token**. It receives computed results.
- Wallet addresses and account ids are stripped or replaced by a stable non-reversible alias per
  session *before* any tool result is returned to the model.
- `referralShare` stays invisible here too (`09` §4.4): it is a third party's money and must not be
  summarised into a model context.

### 1.4 The credential-path finding that constrains everything else

The production CSP is a **closed allowlist** (`apps/web/public/_headers:3`, mirrored in
`packages/core/src/deploymentSecurity.ts:23`):

```
connect-src 'self' https://api.coingecko.com https://api.testnet.polyester.com https://*.workers.dev
```

A user-supplied **arbitrary** base URL (`https://api.openai.com`, or any compatible endpoint)
**cannot be called from the browser** under this policy. The three options, with their real costs:

| Option | Requires | Verdict |
|---|---|---|
| **A. Direct browser → provider** | Widening `connect-src` to `https:` (or a per-user dynamic allowlist, which CSP cannot express without `report-only` gymnastics) | **Rejected as a default.** It is precisely the "CSP widening" risk already recorded as **R-06** in `06`, and it would let any injected script exfiltrate to any host. Worth revisiting only if the model is *strictly* allowlisted to named providers, which defeats "compatible endpoint". |
| **B. Backend proxy** | A new backend capability: receive a user secret, forward it, never persist it | **Most likely long-term shape — and it is a new capability class.** The existing backend is a **public-data facade with no auth, no storage, and no secrets** (verified: `backend/src/handler.ts` is a fixed route allowlist; no `authorization`/`cookie`/`database`/`secret` handling anywhere in `backend/src`). A BYOK proxy would be the first thing this backend ever holds that belongs to a user. It is also explicitly on the existing roadmap's non-goals list *("a backend private proxy", `docs/audit/ROADMAP.md`)*. |
| **C. Local-only provider** | Provider reaches the browser via an endpoint already allowed, or the user runs a local model | Narrow but honest. Covers `https://*.workers.dev` BYOK endpoints, not OpenAI's default host. **A CSP wildcard is not an approval list** — it matches *any* subdomain, so option C still needs an application-level approved-origin allowlist, and private-data consent must bind to that canonical origin rather than to a provider display name. |

**No option is selected here.** This is a decision that needs your approval and a documented security
design (`08` Q25). What this audit *does* fix is the constraint: **"just add a base-URL field" is not a
viable design under the current CSP**, and pretending otherwise would surface at implementation time as
a surprise.

### 1.5 Browser vs backend implications — summary

| Concern | Browser-direct (A) | Backend proxy (B) |
|---|---|---|
| Key exposure to page JS | Key lives in page memory; XSS or a malicious dependency reads it | Key transits once; never in page memory after setup |
| Key exposure to operator | None | Operator's proxy **sees plaintext keys** unless a per-request envelope scheme is built |
| CSP | Must widen (`R-06`) | `'self'`/`workers.dev` already allowed |
| SSRF risk | None (the user's own browser) | **High** — a custom base URL is attacker-controlled input to *your* infrastructure |
| Cost transparency | User sees their own usage | Operator could log usage; must not |
| Offline / local models | Natural | Awkward |
| Failure modes | CORS, CSP, opaque errors | Your uptime becomes the user's blocker |

Given the trusted-operator problem in (B) — a proxy that forwards plaintext keys makes the *operator*
a credential custodian, which the standing constraint ("never collect or retain secrets") argues
against — the realistic near-term answer may be **(C) narrow allowlist**, or **defer the phase**.
That is a judgement for you, not for this audit.

---

## 2. Minimal provider-adapter interface (design sketch — **not** to be added to the tree)

Deliberately tiny. Two operations, one capability description. It should be possible to implement it
for OpenAI and for a compatible endpoint without either leaking into call sites.

```ts
// DESIGN SKETCH — illustrative only. NOT for implementation in this phase.
// Deliberately provider-agnostic: no vendor names, no vendor SDK.

type ProviderConfig = {
  displayName: string;        // user label, never sent to a provider
  baseUrl: string;            // UNTRUSTED input (see §1.5 / §7 T-AI-04)
  modelId: string;
  // Credential is NOT part of config: it is supplied separately to connect() and
  // must never be serialised, logged, or placed in a URL.
};

type Capabilities = {
  toolCalling: boolean;       // required for any tool use
  streaming: boolean;         // optional
  authStyle: "bearer" | "other";
  notes?: string;             // surfaced verbatim to the user on mismatch
};

type ProviderAdapter = {
  describe(): Promise<Capabilities>;                       // connection test + compatibility report
  complete(req: {
    system: string;
    // Must be able to represent a tool-call round trip, not just chat turns:
    // an assistant turn that requested tools (with ids) and the tool results
    // answering them. Text-only turns cannot express the next request.
    messages: ReadonlyArray<
      | { role: "user"; content: string }
      | { role: "assistant"; content: string; toolCalls?: ReadonlyArray<ToolCall> }
      | { role: "tool"; toolCallId: string; content: string }
    >;
    tools: ReadonlyArray<ToolSchema>;                      // allowlisted only
    signal: AbortSignal;                                   // cancellation is mandatory
  }): Promise<{ text: string; toolCalls: ReadonlyArray<ToolCall>; usage?: Usage }>;
  // No streaming in v1. No file/vision inputs in v1.
};
```

Non-negotiables encoded above: cancellation is a parameter, not an afterthought; capabilities are
**discovered and reported**, not assumed; tool schemas come from the registry, never from the model.

**Explicit non-promise:** compatibility with "any OpenAI-compatible endpoint". Auth styles, tool-call
formats, streaming framing and error shapes vary. The adapter reports mismatches instead of guessing.

---

## 3. Tool inventory

Status legend: **EXISTS** (reuse as-is) · **WRAP** (thin adapter over existing code) · **NEW** (must be
built and tested) · **BLOCKED** (needs a decision first).

### 3.1 Phase 2 tools — read-only

| # | Tool | Status | Source | Egress | Notes |
|---|---|---|---|---|---|
| T1 | `get_spot_markets` | WRAP | `PolyesterData.spotMarkets` | P | Cache-friendly |
| T2 | `get_market_overview` | WRAP | `marketOverview` | P | 24h stats + top of book |
| T3 | `get_orderbook` | WRAP | `orderbook` | P | Depth-bounded |
| T4 | `get_candles` | WRAP | `candles` | P | Must carry timeframe + timestamp |
| T5 | `get_recent_trades` | WRAP | `recentTrades` | P | |
| T6 | `get_depth_heatmap` | WRAP | `heatmap` + `lib/heatmap.ts` | P | |
| T7 | `compare_routes` | WRAP | `compareRoutes` + `lib/compare.ts` | P | |
| T8 | `explain_transaction` | WRAP | `explainTransaction` | P | Public chain data |
| T9 | `summarize_fills` | WRAP | `analytics.summarizeFills` | U | Fixed DTO; no raw fills |
| T10 | `cost_basis` | WRAP | `analyzeCostBasis` | U | FIFO / weighted-average |
| T11 | `equity_metrics` | WRAP | `sampledEquityMetrics` | U | Sampling caveats must be returned |
| T12 | `coverage_report` | WRAP | `account/coverage.ts` | U | Honesty flags ride along |
| T13 | `validate_order_draft` | WRAP | `orderConstraints.validateOrderDraft` | Neutral | **Validation only** — no submission |
| T14 | `rsi` | NEW | — | P | Needs a reference implementation + tolerance test |
| T15 | `macd` | NEW | — | P | |
| T16 | `moving_average` (SMA/EMA) | NEW | — | P | |
| T17 | `bollinger_bands` | NEW | — | P | |
| T18 | `atr` | NEW | — | P | |
| T19 | `vwap` | NEW | — | P | Session VWAP in `Tape.tsx` is page-local; needs a tested reusable form |
| T20 | `volume_profile` | NEW | — | P | |
| T21 | `risk_reward` | NEW | — | Neutral | Pure arithmetic over caller-supplied numbers |
| T22 | `backtest` | BLOCKED | — | P | Needs a scoping decision: strategy DSL? walk-forward? fee model? Out of v1. |

**Every T14–T21 tool must be independently testable with no model in the loop** — the model is a
*consumer* of numbers, never a producer of them.

### 3.2 Phase 3 tools — action-adjacent, and the boundary

| # | Tool | Status | Constraint |
|---|---|---|---|
| T23 | `propose_order` | NEW, later | Returns a **proposal object only**. Cannot submit. Must run `validateOrderDraft` and surface every issue. |
| T24 | `submit_order` | **DOES NOT EXIST** | Never a tool. Submission stays a human action in existing UI. |
| T25 | `withdraw` / `transfer` / `cancel_all` | **DOES NOT EXIST** | Never tools. Not in scope at any phase. |
| T26 | `sign_message` / `sign_transaction` | **DOES NOT EXIST** | Never a tool. The signer must be unreachable from the AI layer by construction (`04` §8.3 rule 10 pattern). |
| T27 | arbitrary HTTP fetch | **DOES NOT EXIST** | Never a tool. This is the classic exfiltration primitive. |

---

## 4. Phase 2 — read-only AI analyst (proposed scope)

Triggered only after §0's sequencing rules pass. Scope:

- **Provider configuration**: display name, base URL, model id, API key — key handling per §1.4/§1.5.
- **Connection test** with clear compatibility errors (capability discovery, not assumption).
- **Adapters** for the supported tool-calling formats; unsupported ⇒ explicit message, never silent degradation.
- **Allowlisted tool registry** with **versioned JSON schemas** (T1–T21). Tools are registered, not discovered at runtime.
- **Deterministic indicators** computed in PolyTools (§3.1 T14–T21), with reference-value tests.
- **Authorised portfolio/account tools** (T9–T12) that respect existing session safeguards and are
  callable only when a session already exists — **the AI layer must not be able to trigger login**.
- **Provenance on every number**: source, timestamp, timeframe, and a missing-data indicator. Stale
  data is labelled stale, never smoothed into a clean answer.
- **Usage controls**: per-session call budget, cancellation, error surfacing, cost estimate, and an
  **audit panel listing exactly which tools were called with which arguments**.

Non-goals in v1: no streaming, no file/image input, no multi-provider routing, no memory across
sessions, no autonomous loops beyond a bounded tool-call budget.

---

## 5. Phase 3 — AI-assisted trading (proposal only)

The AI may **prepare**, never execute. A proposal must carry: market/instrument, side, order type,
quantity, limit price where applicable, estimated fees and available risk information, and any
stop-loss/take-profit **clearly labelled as orders, not as guarantees**.

Consent mechanics — mirroring the trading gate already designed in `05` Stage 7:

| Rule | Implementation consequence |
|---|---|
| The user confirms the **exact** action | Confirmation is bound to a hash of the rendered proposal |
| Any change invalidates the prior confirmation | Editing any field clears the confirm state — no silent re-arm |
| The app validates independently | `validateOrderDraft` + balance/permission/limit checks run in app code, not trusted from the model |
| The model cannot reach submission | No `submit_order` tool exists; submission is a human click in existing UI |
| No autonomous trading in the first release | No loop that proposes→confirms→submits |

This is the point where the AI phase stops being low-risk. It must not ship on the strength of a good
Phase 2.

---

## 6. Threat model

| ID | Threat | Vector | Impact | Mitigation | Residual |
|---|---|---|---|---|---|
| **T-AI-01** | Prompt injection via market data | A token name, venue label or trade "note" carries instructions | Model calls tools in an unintended order; skewed "analysis" | Tool **outputs are data, never instructions**; system prompt forbids following content; tool-call allowlist + argument schema validation; surface every call to the user | Model may still produce misleading prose — hence deterministic numbers and a visible tool log |
| **T-AI-02** | Model invents prices/indicators | Hallucinated values presented as fact | User trades on fabricated numbers | **Every number displayed must come from a tool result**, referenced by id; UI shows "computed by PolyTools" vs "model commentary"; no free-text numeric claims in the price/indicator band | Prose can still be wrong; the labelled data band is the mitigation |
| **T-AI-03** | Credential leakage | Key in logs, error reports, telemetry, URL, `localStorage` | Theft of user's paid API key | Key held in memory only; never in URL/query, never in `telemetry.ts` payloads, never in error strings; redaction test in suite; `sessionStorage` at most, **never** plaintext `localStorage`; explicit "disconnect & forget" control | Browser memory is readable by XSS — see T-AI-05 |
| **T-AI-04** | SSRF via custom base URL | User (or a phishing page) points the endpoint at `http://169.254.169.254`, `localhost`, an internal worker | Backend proxies requests into private space | Only relevant to option **B**. Requires scheme allowlist (https only), DNS/IP range denylist, no redirects, response size + timeout caps, no credential forwarding on redirect | Custom-URL proxies are a known-hard surface; a further reason to prefer C or defer |
| **T-AI-05** | XSS → key theft | Any injected script (supply chain, markdown render, ad) | Key exfiltration | No `dangerouslySetInnerHTML` for model output; render as text; keep CSP closed (**no widening — R-06**); dependency budget stays at 8 | Any key in page memory is reachable by same-origin script |
| **T-AI-06** | Tool-argument confusion | Model passes string where scaled int expected (`"1.5"` vs `1500000`), or wrong symbol | Wrong analysis; in Phase 3, a wrong proposal | Schemas are **versioned and strict**; all numeric inputs validated by existing decimal helpers; unknown fields rejected; failures returned to the model as errors, never coerced | Model may retry badly — bounded by call budget |
| **T-AI-07** | Over-broad tool scope | A "convenience" tool that returns everything | Private data egress | Registry enum has **no raw-egress tier** (§1.3); PR review rule: any new tool needs an egress class + a test | Discipline-dependent |
| **T-AI-08** | Confirmation replay / re-use | Stale approval applied to a modified order | Unintended trade | Proposal hash bound to confirmation; any field change clears it; single-use token | Requires disciplined state handling |
| **T-AI-09** | Cost blow-up | Runaway tool loop burning the user's credits | Financial harm to the user | Hard per-session call/token budget; visible meter; cancellation honoured mid-flight; no background loops | Budget must be enforced client-side, so a bug can exceed it |
| **T-AI-10** | Private account data to a third party | Portfolio/P&L sent to a provider the user didn't expect to see it | Privacy harm, possible regulatory exposure | Explicit, itemised consent naming the provider **before** the first private-class tool call; user can disable U-class tools entirely; per-session alias instead of account id | Users may consent without reading |
| **T-AI-11** | Malicious/auto-updating model behaviour | Provider changes model under a stable id | Silent behaviour drift | Record `modelId` + provider-reported version per session in the audit panel; no server-side model pinning possible | Provider-controlled |
| **T-AI-12** | Stale data presented as live | Cached candles, closed market, partial session | Wrong conclusion | Provenance mandatory in tool results; `provenance.ts` wire-sample flag propagated into the AI panel; staleness threshold surfaced | Cache TTLs differ per route |
| **T-AI-13** | Jailbreak to reach trading | Prompt asks the model to "just do it" | Autonomous action | Structurally impossible: no submission/signing/withdrawal tool exists (§3.2) | None, by construction |
| **T-AI-14** | Model output rendered as HTML/markdown with links | Injection into the app UI | Phishing inside the app | Render plain text; if markdown ever allowed, allowlist a minimal subset and strip links/HTML | Low if plain text only |

---

## 7. Dependencies, complexity, and estimates

Estimates are **relative effort, not commitments**, and assume the wallet-first base is stable. They
are deliberately round numbers so nobody treats them as a schedule.

| Workstream | Depends on | Complexity | Rough effort |
|---|---|---|---|
| Technical indicators T14–T21 + reference-value tests | nothing (pure) | Low–medium | **2–4 days** — the tests are the work, not the formulas |
| Tool registry + versioned schemas + egress classes | indicators | Medium | **3–5 days** |
| Provider adapter + capability discovery + connection test | registry | Medium | **3–5 days**, plus one adapter per provider family |
| Credential handling + redaction tests + audit panel | adapter | **High** (security-critical) | **4–7 days** |
| Transport decision (A/B/C) + security design | your approval | **High** | **1–2 days** of design, undetermined implementation |
| Phase 2 UI (workspace, provenance, tool log, budget) | all above | Medium | **5–8 days** |
| Phase 3 proposals + confirmation binding | Phase 2 shipped | **High** | **5–8 days** |
| Backend proxy (only if option B) | new backend capability | **High** | **Not estimated** — depends on auth/storage decisions the backend has never made |

**Dependency policy:** target **zero** new production dependencies for Phase 2. A provider SDK is not
needed to POST JSON; adding one for OpenAI-compatibility would put a third-party package inside the
credential path. Revisit only with an explicit exception.

---

## 8. Test strategy

| Layer | Test |
|---|---|
| Indicators | Reference values from trusted implementations, per timeframe, with tolerance; degenerate inputs (1 candle, all-flat, gaps, zero volume) |
| Registry | Every tool: schema validation, egress class declared, no raw-egress tier, argument-rejection cases |
| Adapter | Capability discovery against a stubbed endpoint; incompatible provider ⇒ explicit error; cancellation mid-call |
| Credentials | Redaction test asserting the key never appears in logs, telemetry, error strings, URLs, or storage dumps |
| Egress | A test that fails if any U-class field outside the approved DTO reaches a tool result |
| Confirmation (Phase 3) | Any field change invalidates confirmation; replay of a used confirmation rejected |
| Structural | A test asserting **no** submission/signing/withdrawal/HTTP tool exists in the registry |
| Data honesty | Stale/missing data is labelled, never defaulted to zero (`07` §6 rules carry over) |

---

## 9. Acceptance criteria before any implementation is proposed

Restating yours, with the verification each one implies:

1. **Wallet-first dapp stable**, existing tests pass → `07` §1–§5 green; PR #6 stabilization closed.
2. **Provider compatibility + credential handling documented as a security design** → §1.4/§1.5
   resolved into a chosen option, with the CSP consequence written down.
3. **Every AI-callable tool has a schema, a permission scope and a test plan** → §3 tables complete and
   reviewed; no tool ships without an egress class.
4. **Indicators match trusted reference calculations within stated tolerances** → §8 row 1 passing.
5. **Stale or missing data is clearly identified** → provenance present in every tool result.
6. **AI output cannot bypass authorisation or confirmation** → §3.2 verified structurally, not by prompt.
7. **Token usage, latency, failures and approximate cost observable without logging secrets** → audit
   panel + redaction tests; no private account data in any log.

Until 1–7 hold, this document remains a **proposal**.

---

## 10. Open questions (also in `08`)

| # | Question |
|---|---|
| **Q25** | Transport: accept CSP widening (A), build a backend BYOK proxy (B), or restrict to allowlisted/local endpoints (C)? |
| **Q26** | Are U-class (portfolio) tools in Phase 2 at all, or does Phase 2 ship public-data only? |
| **Q27** | Is the AI phase in scope for this programme, or explicitly deferred with no target date? |

---

## 11. What was and was not done

**Done:** audit of reusable modules (§1.1), gap analysis (§1.2), egress model (§1.3), the CSP/credential
constraint (§1.4), adapter sketch (§2), tool inventory (§3), phased scope (§4–§5), threat model (§6),
estimates (§7), test strategy (§8).

**Not done, deliberately:** no dependency added; no route or component added; no provider code; no
indicator implemented; no schema committed; no credential path built; no CSP change. The tree is
byte-identical to HEAD apart from this documentation set.
