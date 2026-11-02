# Testing and verification

A green automated run proves the tree, not the screen or the live exchange. Every claim below says
which of the three it rests on.

## 1. Automated gates

```bash
npm test                    # node --test tests/*.test.mjs — synthetic, no credentials
npm run typecheck           # web + backend TypeScript projects (core included)
npm run build               # web typecheck + Vite production build → apps/web/dist

npm run check:runtime       # Node/WebCrypto/Ed25519 capabilities of the current runtime
npm run check:whitespace    # tracked + untracked files
npm run check:contrast      # 54 text-token × surface pairs ≥ 4.5:1, both themes
npm run check:dependencies  # lockfile licence/version inventory (no install, not an audit)
npm run check:external      # external-content inventory and SDK pins, offline
npm run check:performance   # bundle budgets; run after build (scripts/performance-budget.json)
```

CI (`.github/workflows/ci.yml`, Node 24) runs runtime, whitespace, external, dependencies, test,
typecheck, build and performance on every pull request. The repo targets Node ≥ 24.

Opt-in, network-touching checks — never part of `npm test`:

```bash
npm run check:links:live    npm run check:assets:live    npm run check:sdk:live
npm run probe:polyester     # credential-free exchange probe; add `-- --stream` for live channels
```

`npm audit` is a separate registry review; do not run `npm audit fix` opportunistically.

## 2. What the suite covers

| Area | Test files (examples) |
|---|---|
| Public wire decoding, MCP client, backend validation and cache | `polyap.test.mjs`, `public-api-dto.test.mjs`, `public-phase1.test.mjs`, `development-parity.test.mjs` |
| Vault, signer, canonical requests, REST client | `account.test.mjs`, `account-rest.test.mjs`, `canonical-request.test.mjs`, `request-identity.test.mjs` |
| Account data, cursors, coverage, exports, cost basis | `account-data.test.mjs`, `account-coordinator.test.mjs`, `account-export.test.mjs`, `account-lots.test.mjs`, `account-session-owner.test.mjs` |
| Wallet discovery, connection, sign-in proxy, on-chain view | `wallet-discovery.test.mjs`, `wallet-connection.test.mjs`, `wallet-signin.test.mjs`, `auth-proxy.test.mjs`, `onchain-account.test.mjs` |
| Realtime streams | `orderbook-stream.test.mjs`, `trades-candles-stream.test.mjs` |
| Realtime over time (outage, flapping, jitter, teardown) | `realtime-soak.test.mjs` |
| Read-only guarantee | `api-surface.test.mjs` |
| Security headers / CSP (real build) | `deployment-security.test.mjs`, `deploy-workflow-gate.test.mjs` |
| UI copy, accessibility wiring, SSR renders | `frontend-batch1.test.mjs`, `dialog-focus.test.mjs`, `phase2-ux.test.mjs`, `phase3-ux.test.mjs`, `account-ux.test.mjs`, `contrast-tokens.test.mjs` |
| SDK guide validation and examples | `sdk-order-constraints.test.mjs`, `sdk-typescript-examples.test.mjs` |
| Rename compatibility (persisted ids, env fallbacks) | `rename-compat.test.mjs` |

Limits: account tests use synthetic keys and fake transports — they are not evidence of live CORS,
permissions, schemas, or pagination. SSR and source assertions do not prove focus, layout, or
assistive-technology behaviour. The soak suite runs **compressed timings** (5 ms standing in for
1 s), which is correct for testing the backoff arithmetic and is not evidence about an hour-long
session, background-tab timer throttling, or memory growth under continuous deltas.

## 3. Acceptance gates (wallet-first programme)

| Stage | Done when |
|---|---|
| 2a Wallet connection | connection signs nothing and makes no Polyester request; rejected/pending/missing provider handled — **automated, passing** |
| 2b Wallet sign-in | challenge → one `personal_sign` → in-memory token; refusal asks for no signature — **passing against a mock; real exchange unverified** |
| 3 Session as a data source | every safeguard re-proven with the flag on and off; **requires AUTH-01…08 below** |
| 4 Analytics | every figure labelled exchange-reported / calculated / estimated / unsupported |
| 5 Navigation | no route removed; redirects unchanged |
| 6 Live read-only verification | human-run from a real origin (§6) |
| 7 Transactions | deferred; read-only guard replaced, not removed |
| 8 API-key deprecation | only after Stage 6 + measured parity + security sign-off |

**Auth-form cache isolation — must pass before session-backed private data ships:** cache identity
binds auth form **and** account (AUTH-01); separate namespaces per form (02); switching form (03),
account (04), or wallet (05) never serves the previous data; late responses cannot cross forms (06);
session expiry clears only the session namespace (07); no cache read path without both form and
account (08). Removing the API-key path additionally requires named, passing parity tests for both
forms, recorded with date and evidence (09–12).

## 4. Manual browser pass

Record browser/version and commit per row. Widths 390, 768, 1280 px. Use `npm run dev`
(`http://localhost:5173`) or `npm run preview` (`http://localhost:4173`); neither applies the CSP —
only a deployed host does.

**Headings and names** — 1. One `<h1>` per page on `/`, `/book`, `/charts`, `/hub`, `/account`,
matching sidebar and breadcrumb. 2. No `Read-only · Testnet` eyebrow beside titles. 3. Sidebar,
breadcrumb and heading agree on every route.

**Symbol control** — 4. On `/book`, `/tape`, `/charts`, `/heatmap`, `/calc`, `/sdk`: exactly one
symbol selector (the shell's), and changing it updates heading and data.

**Copy and provenance** — 5. `Cached metadata · Ns ago` visible at 390 px in fresh/stale/error;
retry reads **Try again**, not red. 6. Right-aligned numbers share one digit grid on `/` and `/account`.

**Mobile drawer** — 7. 390 px: focus enters the nav, Tab stays inside, Escape/backdrop close and
return focus to the burger. 8. Closed: Tab skips the hidden nav. 9. Last item reachable with the
toolbar collapsed (fallback: `100dvh`). 10. Page behind the open drawer does not scroll. 11. 1280 px:
sidebar visible, no `inert` on it. 12. 768 px: matches 390 px; no horizontal scrollbar on `/book`,
`/tape`, `/account`.

**Mobile tables** — 13. `/tape` at 390 px keeps Time, Side, Price, Qty, Notional; Match ID/age on a
second line. 14. `/book` ladder keeps four columns; mid row centred. 15. Tape alerts start collapsed
with an accurate summary line.

**Dialogs** — 16. *Delete all keys*: Tab/Shift+Tab cycle, Escape closes, focus returns, no scroll
behind. 17. Glossary: label visible, search focused, Escape returns focus. 18. Stacked overlays:
confirmation inside the order drawer traps focus and closes alone. 19. Logout / Forget all / export
still complete.

**Account tabs and routing** — 20. Six short tabs at 390 px; active tab scrolled into view with
`aria-current`. 21. `#/portfolio` → overview (query kept); `#/account/transactions?scope=public` opens
public lookup; `#/flow` redirects identically. 22. Tab-only pass over `/`, `/book`, `/account` at
768/390 px. 23. Overview status line fits at 390 px; *What this means* opens.

**SDK order validation and inspector** — 24. Warning above inputs, readable at both widths.
25. `0.001` on `AVAX-USDT` (min `0.1`) disables copy with a notice. 26. **Use Live price** on a
`0.00001`-tick market lands on the tick grid. 27. Copied values match inputs exactly. 28. Inspector:
empty path, 10-digit timestamp, `a=b&` each give one issue; input not rewritten.

**Navigating away** — 29. Every route lazy-loads with a placeholder; a hard reload of
`#/account/orders` lands there.

**Wallet** — W1. No provider → "No wallet". W2. Connect shows address + chain; account/chain
changes update; revocation and Disconnect return to "Connect". W3. Declined (`4001`) and pending
(`-32002`) show actionable errors. W4. **Sign in** requests exactly one `personal_sign`; the signed
bytes equal the issued message; no token in `localStorage`/`sessionStorage`; reload signs out.

**Streams** (`/book`, `/tape`, `/charts`) — S1. `[data-stream-status]` goes `connecting` → `live`.
S2. Network off ~10 s: `live` → `reconnecting`/`unavailable` → back to `live`. S3. Background the tab for
more than 30 s and return: resumes without reload. S4. Depth 50 → 10 → 50 re-subscribes with no foreign
levels. S5. A dead stream shows fresh polled data, never a frozen book.

Already covered by owner-run headless Chromium (`bb80b30`): S1, S3, S4 and drop recovery; the
deployed CSP was verified on a Pages branch preview. Checks 1–29 and W1–W4 on real devices remain
outstanding.

## 5. Live testnet verification (headless, owner-run)

A local-agent run with an owner key reported HTTP 200 and schema-valid responses for
`/v1/auth/me`, `/v1/balances`, `/v1/spot/fee-rates`, `/v1/orders/open` (empty),
`/v1/orders/history` (100 rows), `/v1/spot/trades` (100 rows), `/v1/transfers` (empty), and
`/v1/equity/history/series?range=1d` (289 points). `7d` and `30d` equity returned 502.

Compatibility fixes that came from it: server-derived signing clock offset (after
`401 TIMESTAMP_SKEW`); fills accept a pair string in `symbol` when exactly one market matches;
omitted settlement legs are treated as empty.

Still not established: cursor exhaustion beyond the first page, non-empty shapes for open orders and
transfers, larger equity ranges, fee reconciliation, and anything browser-side.

## 6. Live account verification (owner-run)

A manual release gate, run only on an owner-controlled HTTPS deployment with a disposable testnet
key. Never on a shared preview, CI, or the dev server with a real key.

1. Run `npm run probe:polyester` first (credential-free).
2. Confirm the deployed CSP `connect-src` includes `https://api.testnet.polyester.com` and nothing
   unexpected; no third-party scripts on account routes.
3. Create/import the key in that browser; store the server-issued `ak_…` id.
4. With devtools open, select **Load account data**: confirm the CORS preflight, GET-only
   requests with no body, exactly `X-API-KEY-ID`/`X-API-TIMESTAMP`/`X-API-SIGNATURE`, and no blind
   retries on auth/permission/signature/schema errors.
5. Lock during a delayed request: it aborts and nothing late renders. Repeat cross-tab.
6. Per dataset — catalog, balances, equity history, order history, fills, transfers, current fee
   rates — record sanitized status, coverage, freshness and denial separately. Actual fees come from
   fills; a balance success proves nothing about fills.
7. Revoke the key afterwards.

Record only sanitized status codes, operation names, origin, time, and schema/coverage outcome.
Until this is done the app must describe live compatibility as **unverified**.

## 7. Wire samples

`docs/wire-samples/` holds real public responses captured on testnet (2026-10-22). Tests and the
dev-server fallback read them; see its [README](./wire-samples/README.md) for the field rules
(prices `raw ÷ 10³`, quantities plain decimals, ids and cursors opaque).
