# Account connection and security specification

**Status:** implementation specification, not implemented  
**Applies to:** personalized, read-only PolyTools account analytics  
**Evidence legend:** [00 §2](./00_CURRENT_STATE.md#2-evidence-language-used-by-all-eight-reports)  
**Primary official contract:** [Ed25519 API keys](https://testnet.polyester.com/docs/developer-docs/authentication-security/ed25519-api-keys), pinned TypeScript transport, and pinned protobuf authentication/policy options.

## 1. Security objectives

1. A PolyTools account connection can perform only officially supported reads.
2. Private keys are generated/imported and used locally; neither Polyester nor PolyTools needs the private key in a request.
3. No persistent plaintext/decrypted private key, secret in a URL/log/error, shared global credential, or unpartitioned private-response cache.
4. Lock, wipe, account switching, and tab closure stop signing and remove private account state.
5. Every denied, stale, partial, or unverified dataset is visible as such.
6. Public market tools continue to work without an account or credential.
7. The implementation does not create trades, transfers, withdrawals, keys, policies, deposit addresses, or interactive sessions.

A read-only API key still grants access to sensitive financial activity. “Read-only” reduces mutation risk; it does not make the key or responses safe to publish.

## 2. Non-negotiable permission boundary

The owner creates and manages the key in Polyester's official account UI. PolyTools must not call key/policy/session mutation endpoints.

- Core candidate actions: `read-balances` and `read-spot`.
- Optional activity candidate: `read-internal-transfers`, only after its grant to unified transfers is verified.
- Never request: `trade-spot`, `internal-transfer`, `external-withdraw`, address-book writes, API-key/policy management, or interactive JWT session credentials.
- Do not request a write action as a workaround for a denied read. Record the read as unavailable.
- API keys cannot list/get their policy templates through the session-only policy API. `Me` is not a permission list. Verify capabilities by safe read probes, not by guessing from a label.

Policy action definitions are official; exact per-RPC grants for holds, unified transfers, and fee rates remain unverified. See [01 §4](./01_OFFICIAL_API_CAPABILITY_MATRIX.md#4-authentication-policy-and-pagination-matrix).

## 3. Current PolyTools security audit

The existing implementation is **not approved for real-key account analytics unchanged**.

| Area | Current behavior | Decision |
| --- | --- | --- |
| Persistence | `packages/core/src/keys.ts` stores extractable PKCS#8 private keys as plaintext hex in `localStorage` under `poly-tools:vault:v1`. | Replace; do not merely encrypt the existing JSON with a hardcoded key. |
| Unlock | No passphrase, vault lock, idle timeout, or memory-only session. | Add authenticated encryption and explicit unlock/lock. |
| Tabs | No coordinated lock/wipe across tabs. | Add secret-free cross-tab control messages. |
| Identity | Registered IDs are insufficiently validated; a local label can remain where a registered key ID is expected. | Strict key-ID validation and server-verified identity. |
| Secret lifecycle | Secret inputs and signed output are not consistently cleared. | Clear on lock/wipe/account change and after import/migration. |
| Canonicalization | `Portfolio.tsx` path and `SdkGuide.tsx` duplicate related logic. | One audited signing module; remove/redirect duplicates during implementation. |
| Hash fallback | SDK-guide code can return the empty-body hash for a nonempty body when WebCrypto is unavailable. | Fail closed if required WebCrypto operations are unavailable. |
| Authenticated execution | None; `/portfolio` only displays signing output. | Add a separate private REST client after the vault/signer gates. |
| Backend | Public routes and a global public TTL cache only. | Do not add private payloads to this cache. |
| Headers/dependencies | No deployed CSP/security-header policy was found; dependency advisories remain. | Remediate and test before real-key use. |

These findings are **repository-inspected**. The current 12 tests, typecheck, and production build pass, but no real-key security behavior is demonstrated.

## 4. Release gates before any real key is entered

All are mandatory:

- [ ] Production-like HTTPS secure context; required Ed25519, SHA-256, AES-GCM, PBKDF2, and secure random WebCrypto operations pass feature tests.
- [ ] Plaintext vault is migrated or quarantined; no real key remains in `localStorage`.
- [ ] Dependency advisories are triaged, upgrades are tested, and no real key is used in Vite development/Arena preview until development-server findings are resolved.
- [ ] CSP and host-appropriate security headers are deployed and tested with existing TradingView/public integrations.
- [ ] One canonical signer passes official and independent vectors, including repeated/reserved query parameters and opaque cursors.
- [ ] Browser preflight/CORS diagnostics pass from the exact deployment origin using synthetic invalid credentials where possible. Final authenticated CORS is then verified during the owner-controlled connection before any live dataset is enabled.
- [ ] Synthetic fixtures cover denied/partial/stale/empty states and prove no fake account metrics.
- [ ] Secret scanning confirms no credentials/account identifiers in source, test snapshots, reports, URLs, logs, or error telemetry.

Until every gate passes, the UI may be developed and tested only with synthetic fixtures clearly labeled `FIXTURE` in development/test—not displayed as live data.

## 5. Proposed connection experience

### 5.1 Setup outside PolyTools

Show a short official-documentation link and this owner-controlled sequence:

1. In Polyester's official testnet account UI, create a dedicated key for PolyTools analytics.
2. Attach only the read policies needed for the selected features. A new key without a policy is expected to have no data permissions.
3. Prefer a subaccount-bound key when analytics should be limited to that subaccount.
4. Optionally configure an IP allowlist only when the owner understands their browser IP and lockout implications. Direct-browser calls originate from the user's connection, not a PolyTools server.
5. Copy the key ID and locally held 32-byte secret into the local PolyTools vault over HTTPS. Never send them through chat, a ticket, a URL, or a remote form.
6. Revoke the key in the official UI when no longer needed or if compromise is suspected. PolyTools offers a local “forget” action, not remote revocation.

The application must not instruct the user to make a trade or transfer to test the connection. Empty accounts are valid test accounts.

### 5.2 Local onboarding states

`Disconnected → Vault locked → Unlocking → Verifying identity → Capability check → Connected / Partially connected / Denied / Blocked`

- **Disconnected:** no key selected; all public tools still available.
- **Vault locked:** encrypted entries may exist, but no signing key or private response is in memory.
- **Verifying identity:** only `/v1/auth/me` is attempted first.
- **Connected:** identity and all required core capabilities succeeded.
- **Partially connected:** identity succeeded and at least one enabled dataset is denied/unavailable; show each capability separately.
- **Denied:** identity or every requested data capability is denied; do not show zeros.
- **Blocked:** CORS, unsupported browser, invalid vault, or security gate prevents a safe attempt; do not mislabel it as a permission denial.

Display only a masked key label in the UI. Do not put the raw key ID, root account ID, subaccount ID, public key, secret, signature, cursor, or private response in the **PolyTools app route, query, or hash**. Documented API scope/cursor query parameters are constructed in memory for the direct official request and are never copied into the app URL or logs.

## 6. Vault architecture

### 6.1 Persistent format

Use versioned IndexedDB records, not `localStorage`, for encrypted vault entries. A logical record should contain:

```text
format = "polytools-account-vault"
version = 2
entryId = cryptographically random UUID (local, not a Polyester identifier)
kdf = { name: "PBKDF2", hash: "SHA-256", salt, iterations, version }
cipher = { name: "AES-GCM", iv, additionalDataVersion }
ciphertext = authenticated encryption of {
  keyId,
  publicKey,
  privateKeyPkcs8OrSupportedImportFormat,
  userLabel,
  createdAt
}
```

Requirements:

- AES-GCM with a 256-bit data key, fresh cryptographically random 96-bit IV for every write, and a fresh at-least-128-bit salt for every new passphrase/vault entry.
- Derive the data key with PBKDF2-SHA-256 because it is available in WebCrypto. Start with a versioned work factor of at least 600,000 iterations and calibrate upward where the target devices permit; do not silently lower it for convenience. Record the actual iteration count per entry so future migration is possible.
- Bind format version, entry ID, and metadata to AES-GCM additional authenticated data. Ciphertext authentication failure is a wrong-passphrase/tamper error; never attempt to parse it.
- Keep key ID and other account metadata inside the ciphertext when practical. Outer storage should need only a random local entry ID and cryptographic parameters.
- Do not persist the passphrase, derived key, decrypted secret, nonextractable session `CryptoKey`, unlocked identity, private API response, or auth headers.
- Do not add a separate plaintext “password verifier.” Successful AEAD authentication is the verifier.
- There is no passphrase recovery. Offer explicit deletion/re-import, not a backdoor.

JavaScript cannot guarantee erasure of every copied string or garbage-collected buffer. Minimize copies, use byte arrays where possible, overwrite mutable buffers after use, and document this residual limitation rather than promising perfect memory wiping.

### 6.2 Unlock and use

1. Read only the selected encrypted entry.
2. Derive the AES key in memory and decrypt in a worker if doing so does not create additional persistent/remote copies.
3. Import the Ed25519 private key as a **nonextractable** `CryptoKey` for the session.
4. Immediately clear the decrypted byte buffer and passphrase input; retain no decrypted PKCS#8/raw secret in application state.
5. Keep the nonextractable key only in the account-session module's memory. UI components receive signing operations, not key material.
6. On lock, drop all references, abort requests, close private subscriptions, and clear private stores. New tabs always start locked.

If the target browser cannot import/sign with the required Ed25519 key nonextractably, fail the real-key gate. Do not silently fall back to keeping an extractable plaintext key in persistent storage. An alternative audited library may be considered later, but it requires a new security review.

### 6.3 Lock, wipe, and cross-tab behavior

- Auto-lock after 15 minutes of user inactivity by default; provide a shorter option. Activity means deliberate interaction, not ongoing polling.
- Immediate lock on explicit Lock, Forget, account removal, vault authentication failure limit/lockout, or fatal session integrity error.
- Locking aborts all private fetches and invalidates their session generation so late responses cannot repopulate state.
- Wiping deletes encrypted IndexedDB entries, legacy vault data after explicit confirmation, in-memory account data, pending signed output, and secret-bearing inputs.
- Use `BroadcastChannel` plus a storage-event fallback for `LOCK`, `WIPE`, and `VAULT_CHANGED`. Messages contain only a random local vault generation/event ID—no account IDs or secrets.
- A tab that missed a message must fail closed when its local vault generation no longer matches storage. Never treat another tab's unlocked state as authorization to unlock.
- On `pagehide`, abort private work and clear sensitive UI state. Do not rely on `beforeunload` as the only wipe mechanism.

### 6.4 Legacy migration

When `poly-tools:vault:v1` is detected:

1. Do not automatically use it for authenticated analytics.
2. Warn that the legacy entry is plaintext and offer **Migrate**, **Delete**, or **Leave unused**.
3. For Migrate, require a new passphrase, encrypt into v2, import/test the new nonextractable session key, and only then remove the legacy key with `localStorage.removeItem`.
4. Clear migration buffers and confirm no legacy key remains. If any step fails, do not claim migration or deletion succeeded.
5. Existing public preferences under other keys remain untouched.

Automated tests must use synthetic legacy keys and verify wrong-passphrase, tampered ciphertext, interrupted migration, deletion, and cross-tab lock behavior.

## 7. Exact Ed25519 request signing

### 7.1 Headers

Every API-key request requires:

```text
X-API-KEY-ID: <registered key ID>
X-API-TIMESTAMP: <Unix time in milliseconds>
X-API-SIGNATURE: <64-byte Ed25519 signature as hex or standard Base64>
```

`X-API-NONCE` is optional, outside the canonical string, and not needed for read-only MVP. The timestamp must be within 10 seconds of Polyester server time. Use one encoding consistently; lowercase hex is simplest and matches the official TypeScript helper.

### 7.2 Canonical string

UTF-8 encode exactly five newline-separated fields, with no trailing newline:

```text
<timestamp_ms>
<UPPERCASE_METHOD>
<exact_request_path>
<canonical_query>
<lowercase_SHA256_hex_of_exact_body_bytes>
```

For the read-only GET client, the body is empty and its SHA-256 is:

```text
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

The implementation must still hash the actual body bytes rather than special-casing GET; this prevents future drift. The private client should be allowlisted to `GET` only at both route and method levels.

- Build paths from fixed operation constants and validated path parameters; do not accept arbitrary user-supplied signing paths in account analytics.
- Preserve the exact request path and percent encoding; exclude scheme, host, query, and fragment.
- Sign exactly the bytes sent. A retry gets a fresh distinct timestamp, canonical string, and signature.
- Generate timestamps with a process-wide monotonic allocator equivalent to official TypeScript `lastTimestamp = max(lastTimestamp + 1, Date.now())`. Reserve the value for each attempt so concurrent calls cannot receive the same timestamp.
- On `TIMESTAMP_SKEW` or `SIGNATURE_INVALID`, stop automatic retries and show a safe diagnosis. Do not blindly reuse a signed request.

### 7.3 Query normalization conflict

Official documentation says: decode pairs, sort by decoded key then decoded value, RFC-3986 encode, and preserve repeats/empty values. The pinned official TypeScript helper instead creates `encodeURIComponent(key)=encodeURIComponent(value)` strings from `URLSearchParams` and lexicographically sorts the complete encoded pair strings. These can differ on prefix/reserved-character cases.

This is a real contract conflict, not freedom to choose per request. Required resolution:

1. Maintain one ordered pair list for the actual URL and canonical string; never independently reserialize the sent query.
2. Encode each key/value exactly once; preserve repeated keys, empty values, and opaque cursor bytes.
3. Port the pinned TypeScript behavior into a candidate vector set and also encode the documentation example exactly.
4. With the owner's read-only key, verify repeated keys, empty values, spaces, literal `+`, `%`, Unicode, prefix keys, and realistic opaque cursors. Record which behavior the server accepts.
5. Pin the accepted behavior behind a named contract version and regression-test it. Until then, queries requiring ambiguous ordering remain **blocked**, not “probably correct.”

The documentation's basic example must produce:

```text
Raw:       tag=z&q=hello+world&literal=%2B&tag=a&empty=
Canonical: empty=&literal=%2B&q=hello%20world&tag=a&tag=z
```

An implementation-generated expected value is not independent verification. Include at least one independently calculated Ed25519 vector verified with a second implementation or official SDK test.

## 8. Private REST client behavior

Use browser `fetch` directly to the explicit official testnet host. Proposed request defaults:

```text
method: GET only
credentials: "omit"
cache: "no-store"
redirect: "error"
referrerPolicy: "no-referrer"
mode: "cors"
```

Also:

- Use `AbortSignal` tied to the account-session generation, route visibility, and lock/wipe.
- Do not put secrets in query parameters. Signed headers are never copied into URLs or export files.
- Do not log request headers, canonical strings, signatures, raw private responses, cursors, full account IDs, or error objects that might contain them.
- Parse content type and schema before updating state. Reject unknown amount representations rather than silently applying a scale.
- Treat HTTP 401/403 and structured `UNAUTHENTICATED`/`PERMISSION_DENIED` separately from CORS/network failure.
- Respect rate limits with bounded exponential backoff and jitter only for idempotent GETs, and only after a fresh signature per attempt. Permission/authentication errors are not backoff-retryable.
- Stop polling when locked, denied, hidden (unless an explicit safe background mode is later approved), or the account scope changes.

## 9. CORS and proxy decision

Three custom auth headers normally trigger a browser preflight. No successful authenticated browser CORS check was made in this audit.

The exact origin must permit the signed GET and required headers. A public server-side GET succeeding is not evidence of browser support.

- If CORS works, direct browser REST is the baseline; no private backend is needed.
- If preflight or response CORS fails, mark the connection **Blocked by browser access policy** with a safe diagnostic.
- Do not use `no-cors`; it cannot expose the required response and is not a security workaround.
- Do not put the key on a PolyTools backend, use a shared signing key, or forward private responses through the existing public cache.
- A future per-user relay would require a separate design covering local signing versus server signing, credential custody, user isolation, authentication, encryption, rate limiting, logging, cache partition, and deployment cost. It is not an implicit fallback.

## 10. Cache, storage, and export privacy

### 10.1 Private responses

Initial implementation: **memory only**, partitioned by:

```text
local connection-session ID
+ verified root/account scope
+ dataset/operation
+ normalized filters/range
```

Additional rules:

- No Cache API, service-worker cache, IndexedDB private-response store, `localStorage`, shared backend TTL cache, or durable HTTP cache for private responses.
- `cache: "no-store"` is necessary but not a substitute for application isolation.
- A scope switch gets a new session generation and cannot read the previous scope's cached rows.
- Lock/wipe clears all partitions and invalidates in-flight responses.
- Persist only non-identifying UI preferences such as selected range, table density, or chosen cost-basis method. Default to root scope after reload rather than persisting raw account IDs.

### 10.2 Exports

- Export is an explicit user action with a warning that the file contains private financial activity.
- Never include private keys, public keys, auth headers, signatures, canonical strings, passphrases, session tokens, or pagination cursors.
- Prefer masked local scope labels over raw account IDs; raw IDs are not needed for beginner analytics exports.
- CSV cells must be escaped against spreadsheet formula injection (`=`, `+`, `-`, `@`, tab, CR/LF after leading whitespace) while preserving legitimate numeric columns as numeric-safe text.
- Export raw observed values plus a coverage manifest; do not label the file a tax statement or complete P&L report unless every gate in [03](./03_ANALYTICS_AND_FINANCIAL_FORMULAS.md) passes.

## 11. Error handling and safe diagnostics

| Condition | User-facing category | Automatic retry? |
| --- | --- | --- |
| `UNAUTHENTICATED`, `MISSING_HEADERS` | Connection could not authenticate; check key ID/local signer | No |
| `TIMESTAMP_SKEW` | Device clock/signing freshness issue | No blind retry; ask to sync clock |
| `SIGNATURE_INVALID` | Signature/key/replay check failed | No |
| `KEY_DISABLED`, `KEY_EXPIRED` | Key unavailable; use official key UI | No |
| `IP_NOT_ALLOWED` | Current browser IP is outside owner allowlist | No |
| `PERMISSION_DENIED` | This read is not granted by the current read-only policy/role | No; never suggest write access |
| CORS/preflight failure | Browser access blocked/unverified | No proxy fallback |
| 429 / rate limit | Temporarily rate-limited | Bounded fresh-signed GET backoff |
| 5xx / network failure | Temporary retrieval failure; retain labeled stale data if available | Bounded fresh-signed GET backoff |
| Schema/scale/unknown row | Dataset incompatible or incomplete | No; mark partial/unavailable |
| Abort/lock/account switch | Session ended | No |

Error messages must not echo server bodies indiscriminately. Map known codes to safe copy and keep only non-sensitive diagnostics such as operation name, status class, timestamp, and a random local correlation ID.

## 12. Deployment hardening

- Inventory current external resources before writing CSP. Required directives should start with `default-src 'self'`, a strict script policy without `unsafe-eval`, and narrowly scoped `connect-src`, `img-src`, `frame-src`, `style-src`, `font-src`, and `worker-src` for the exact official API/public integrations in use.
- Prefer HTTP headers for `Content-Security-Policy`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`, `Permissions-Policy` disabling unused powerful features, and an appropriate clickjacking policy (`frame-ancestors`). A meta CSP cannot enforce every directive, including `frame-ancestors`.
- GitHub Pages/static hosts that cannot set required headers remain public-only for real-key use until their limitations are explicitly resolved. Do not claim header protection that the host cannot deliver.
- Avoid runtime secret-bearing configuration and third-party analytics on account routes.
- Keep `NODE_ENV`/development wire samples out of private account code. Test production output, not only the Vite dev server.
- Review all new dependencies for necessity, maintenance, bundle execution, and lockfile reproducibility. Do not add a general cryptography/framework stack when WebCrypto suffices.

## 13. Safe live verification protocol

This is a procedure for the account owner, not a request for credentials in this conversation.

1. Complete synthetic/security gates and use a production-like origin controlled by the owner.
2. Create a disposable testnet key with **no policy**. Verify `Me` behavior and confirm that data reads are denied as documented. Record only safe status/code results.
3. Use separate owner-controlled keys or carefully isolated policy changes to test one read action at a time:
   - `read-balances`: balances, balance history, equity history; observe holds/fee behavior without assuming a grant.
   - `read-spot`: open orders, order history/details, fills; observe fee behavior.
   - `read-internal-transfers`: unified transfer list and exact covered transfer reasons.
4. Test root scope before subaccounts. No financial mutations are needed; empty pages are valid outcomes but do not prove reconciliation or schema coverage for nonempty rows.
5. Verify CORS, canonical query vectors, decimal/timestamp representations, pagination to an empty next token, and rate-limit/error handling.
6. Save sanitized synthetic fixtures manually only after removing all real identifiers, cursors, addresses, request IDs, and account-specific values. Never disguise them as a successful live test in reports.
7. Revoke test keys in the official UI when finished.

The safest next technical verification is `Me` + current balances with the owner's minimal key after CORS and vault gates. The safest next development step requires no credential: implement and test the vault/signer/client against synthetic fixtures.

## 14. Security acceptance tests

- Plaintext secret is absent from all persisted storage before and after import, unlock, refresh, lock, migration, and wipe.
- Wrong passphrase and modified ciphertext/AAD/IV/salt fail closed without parsing or signing.
- Unlocked key is nonextractable where WebCrypto supports the required operation; no decrypted key is exposed to React state or logging.
- Two concurrent requests have distinct monotonic timestamps; retries re-sign; clock skew stops retry.
- Canonical test vectors cover empty/repeated/reserved/Unicode/prefix-key queries and realistic opaque cursors; sent URL and signed query are identical.
- Ed25519 signature is independently verified; a one-bit body/path/query/timestamp change fails verification.
- Arbitrary methods/paths are rejected by the private client; only allowlisted read GETs can be signed.
- Lock/wipe/account switch aborts requests and a deliberately late response cannot update state.
- Two tabs lock/wipe together without broadcasting identifiers or secrets; a stale tab fails closed.
- Account A and B caches, filters, and in-flight responses cannot cross-read even when dataset names match.
- Denied, CORS-blocked, stale, empty, and partial results never become zero balances or successful connections.
- Exports contain no secrets/cursors/raw account identifiers and neutralize spreadsheet formulas.
- CSP/security headers and existing public tools pass production smoke tests; no credential is entered into the dev/preview environment.
