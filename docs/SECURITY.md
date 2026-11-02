# Security

Polyap's security posture, the risks it accepts, and what is still unverified. Report a
vulnerability privately to the repository owner rather than in a public issue.

## 1. Principles

1. **Read-only.** No order, cancel, transfer, withdrawal, or key/policy mutation exists in the app.
   Read-only is structural: account requests must match `READ_ONLY_OPERATIONS` (GET only) or the
   vault refuses to sign; `tests/api-surface.test.mjs` asserts no write method is called.
2. **A connected wallet is not a login.** Connection proves nothing about exchange authentication
   or account authorization ([ADR 0002](./decisions/0002-wallet-connection-is-not-a-login.md)).
3. **Keys stay in the browser, encrypted.** API keys live only in the passphrase-encrypted vault;
   the backend never receives a private key ([ADR 0005](./decisions/0005-api-keys-in-passphrase-encrypted-vault.md)).
4. **Testnet only for private data** ([ADR 0004](./decisions/0004-testnet-only-private-reads.md)).
5. **Honest data.** Denied, partial, stale, or unavailable data is never shown as zero or as a
   complete history.

## 2. Assets and trust boundaries

| Asset | Design | Residual risk |
|---|---|---|
| Ed25519 private key | AES-GCM-encrypted at rest in IndexedDB (`polytools-account-vault`); unlocked key is a nonextractable `CryptoKey` | malicious script while unlocked, compromised device, phishing, weak passphrase |
| Passphrase | PBKDF2-SHA256, 600,000 iterations; never stored; no recovery | strength is the user's; JS cannot guarantee erasure of every copy |
| Registered key id (`ak_…`) | validated, stored with the encrypted entry | holding it proves neither registration nor read policy |
| Wallet session token | memory only; a reload signs out; never in storage, URLs, or logs | XSS while signed in |
| Private responses | validated, memory-only, partitioned by session/entry/scope/operation/filters | live account isolation not yet verified |
| Exports | explicit confirmation; loaded validated rows plus a coverage manifest; CSV formula-escaped; no credentials, cursors, or raw errors | the downloaded file leaves vault protection |
| Public backend | credential-free GET/OPTIONS, open CORS, allowlisted queries | no app-level rate limiter (see §6) |
| Optional Worker cron | public mover reads + Telegram POST with separate secrets | outbound side effect, not an account action |

## 3. Vault and session controls

- Sessions carry generations and abort signals. Lock, wipe, unlock/import, idle timeout (15 min),
  and cross-tab control events (`BroadcastChannel` + storage fallback) invalidate them; a tab that
  misses a message fails closed on its next sign.
- Five failed unlocks lock the vault out for 30 s.
- Late responses after lock or a newer request are discarded.
- The retired v1 plaintext vault is migrated with encrypted read-back and is never used for signing.
- Lock/wipe does not revoke the key at Polyester; revoke it in Polyester's UI.

## 4. Request-signing boundary

- GET-only to the exact origin `https://api.testnet.polyester.com`, pinned contract label
  `friendly-rest@b34853cb…`. Arbitrary paths, methods, origins and malformed cursors are rejected.
- `credentials: "omit"`, `redirect: "error"`, `cache: "no-store"`.
- Bounded retries for temporary failures only, each with a fresh timestamp and signature;
  permission and signature errors are not retried. Per-attempt deadline: 30 s by default.
- Errors map to safe codes; raw private bodies are never echoed or logged.

## 5. Origin gate and the wallet sign-in proxy

- `POST /api/auth/challenge` and `/api/auth/login` proxy the exchange's wallet login, because the
  exchange refuses browser CORS for our origin.
- **Same-origin by default.** Cross-origin callers must be listed exactly in `POLYAP_APP_ORIGINS`
  (legacy `POLYTOOLS_APP_ORIGINS` is read when the new name is unset or blank). The origin is echoed,
  never `*`; unlisted origins get `403 origin_not_allowed` and no CORS headers.
- Upstream is restricted to `*.polyester.com` (plain HTTP only for loopback, for tests).
- The SIWE `uri` is the browser's `Origin`, not the backend host. `isCrossOrigin` reads the request
  URL only — keep these two separate (a circular comparison once disabled the allowlist).
- Address contract: the client sends the owner EOA; the server derives the Safe address. The EOA is
  never used as the smart-account address.
- Session tokens never enter the shared cache.

### Reading a 403 on `/api/auth/*`

| Body | Who refused | Fix |
|---|---|---|
| `{"error":"origin_not_allowed"}` | our proxy | add the app origin to `POLYAP_APP_ORIGINS` |
| `{"error":"upstream_403","detail":"…cf-ray=…"}` | the edge in front of Polyester (bot management) | run the backend on a non-Worker host (Node adapter), or have Polyester allowlist the egress |
| `{"error":"permission_denied", …}` | Polyester's API (e.g. `uri` not permitted) | Polyester must accept the origin |
| HTML or empty | the host or a WAF | fix hosting before debugging the app |

`node tools/check-deployment.mjs` asks a deployment these questions in one command.

## 6. Deployment hardening

`packages/core/src/deploymentSecurity.ts` is the single source for headers, applied by the Worker
adapter, the shared handler, `apps/web/public/_headers` (Pages), and `vercel.json`. A production
build also injects a CSP meta tag (a fallback only — `frame-ancestors` needs a real header).

- CSP: `default-src 'self'`, `script-src 'self'` (no inline scripts, no `unsafe-eval`),
  `style-src 'self' 'unsafe-inline'`, `img-src/media-src` add `https://assets.polyester.com`,
  `connect-src 'self' https://api.coingecko.com https://api.testnet.polyester.com wss://api.testnet.polyester.com https://*.workers.dev`,
  `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'none'`.
- `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `X-Frame-Options: DENY`, and a Permissions-Policy that disables unused capabilities.
- A custom `VITE_API_BASE` outside `*.workers.dev` requires a CSP update.
- Verified on a Cloudflare Pages branch preview: the socket opened with no violation and a foreign
  `wss:` origin was blocked (negative control). The older root deployment `polytools-cc8.pages.dev`
  predates the `wss:` source and cannot stream until redeployed.

Not done, and owner decisions: platform rate limits/WAF from measured traffic, log retention and
query-string redaction, HSTS per hostname, COOP/COEP/CORP.

## 7. Risk register (current)

| Risk | Severity | Mitigation / status |
|---|---|---|
| Account data leaks across wallet/account/auth-form switch | Critical | cache identity must bind auth form **and** account before session-backed private data ships (gates AUTH-01…08 in [TESTING.md](./TESTING.md)) |
| XSS becomes session/account takeover | High | strict CSP, no third-party scripts or analytics; adding one is a security regression |
| Session token persisted | High | memory-only token; never cookies, storage, URLs, `VITE_*`, or telemetry |
| Read-only guarantee lost if the SDK enters the browser | High | SDK stays out of the bundle; any future trading must go through one reviewed gate module |
| Silent zeroing / incomplete history shown as complete | High | coverage states, cursor discipline, fail-closed P&L gates |
| Credential leakage in logs, previews, CI | High | never log headers, tokens, signatures, or private bodies; real keys only on an owner-controlled HTTPS deployment |
| No mainnet → misleading claims | High (product) | say "testnet" everywhere it applies |
| Realtime gaps read as live truth | Medium | polling stays authoritative; re-snapshot on gaps; honest stream status |
| Wallet provider spoofing | Medium | connection is labelled as connection, never "verified" |
| SDK licence (`UNLICENSED`) | Medium | informal clearance only; SDK kept out of the browser |
| Schema drift (friendly REST vs SDK) | Medium | boundary validation; unknown rows quarantine coverage |
| Clock skew / replay | Low | server-derived offset, monotonic timestamps, typed `TIMESTAMP_SKEW` |

## 8. Accounting boundaries

Exact decimals; actual fees from fills only, grouped by fee asset; current fee rates are a separate
snapshot. Cost basis (FIFO / moving weighted average) is **experimental and user-assisted**:
realized P&L needs complete clean fills, opening basis with provenance, and every non-fill flow
resolved; unrealized and total P&L also need one fresh mark (default 5 minutes). Manual inputs are
user attestations, not reconciliation, and are not exported. It is not tax output.

## 9. Owner verification still required before live reliance

From an owner-controlled HTTPS origin with a disposable testnet key: CORS/preflight, least-privilege
policies and independent denial, real schemas and decimals, cursor exhaustion and caps, cross-account
isolation and lock invalidation, execution-fee reconciliation, transfer-leg correlation, and export
contents. The checklist is in [TESTING.md](./TESTING.md#6-live-account-verification-owner-run).

## Security rules for contributors and agents

- Never accept or request a private key or seed phrase; never call the guard-signer export.
- No API secret in source, `VITE_*`, CI, shared previews, URLs, logs, error reports, or screenshots.
- Do not work around a CORS failure with `no-cors`, an unclaimed proxy, or a shared signing service.
- Never widen key permissions to make a test pass.
- Persisted identifiers in `packages/core/src/persistedIdentifiers.ts` are not renamed without a
  tested migration.
