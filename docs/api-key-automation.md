# Polyester API keys and headless automation

- **Status:** documentation clarification; not a live-verification result
- **Applies to:** owner-controlled, read-only PolyTools verification and future local-agent tooling
- **R1 source:** unchanged
- **Live authenticated reads:** still unverified in this workspace

## 1. Short answer

Yes. **Polyester API keys are specifically intended to let a bot, script, or backend service authenticate non-interactively.** An API-key client does not need a wallet signature, JWT login, or browser session for each request.

The official TypeScript authentication guide describes an API key as an Ed25519 keypair for authenticating a **“bot, script, or backend service”** and shows the SDK reading the key ID and secret from `process.env`. REST is also documented as a production-supported interface for direct HTTP integrations and scripts.

Therefore, requiring a person to click through every read request would be unnecessarily restrictive. The correct model is:

1. The owner performs the one-time key registration and policy setup required by Polyester.
2. A local agent or backend automates the permitted requests with local Ed25519 signing.
3. Browser CORS is checked separately **only if the browser-hosted PolyTools UI is also a target**.

This report does not authorize key/policy mutations, financial mutations, credential sharing, or real-key use in CI, source, Arena, or a shared preview.

## 2. What an API key is

A Polyester Ed25519 API key has two related but different parts:

| Part | Purpose | Handling |
| --- | --- | --- |
| Public key | Registered with Polyester so it can verify signatures. | Safe to register through the official flow; not a signing secret. |
| Server-issued key ID, normally `ak_...` | Identifies which registered key is signing a request. | Required as `X-API-KEY-ID`; it is not sufficient to authenticate by itself. |
| Private Ed25519 secret | Proves possession of the registered key by signing each request locally. | Never sent over the network; keep in the local signing environment. |

The private key is **not** a bearer token and is not supposed to appear in an HTTP request. Instead, each request carries:

```text
X-API-KEY-ID: <registered key ID>
X-API-TIMESTAMP: <Unix time in milliseconds>
X-API-SIGNATURE: <64-byte Ed25519 signature, hex or standard Base64>
```

The signature covers the timestamp, uppercase method, exact request path, canonical query, and SHA-256 hash of the exact body bytes. The timestamp must be within the documented server-time window, and every retry needs a fresh timestamp and signature.

### Authentication is not authorization

A newly created key has no policy. The official guide says `auth.me` can work while trading, order reads, and ledger reads fail until a policy is attached. A successful signature therefore does not prove that balances, fills, transfers, or fee rates are permitted.

Policies can restrict actions and spot-market scope. For PolyTools analytics, request only the verified read permissions needed for the selected datasets. Never add trading, cancellation, transfer, withdrawal, key-management, or policy-management permissions as a workaround for a denied read.

## 3. What can be automated without a browser

With an owner-provisioned key and the required read policies, a headless local agent can automate the following **read-only** checks:

1. Load and validate the unsigned official `GET /v1/spot/config` catalog.
2. Authenticate with the API-key signing flow and check `auth.me` separately from data permissions.
3. Read balances, sampled equity history, order history, fills, transfers, and current fee rates independently.
4. Validate response shapes and decimal representations before calculating anything.
5. Follow opaque cursors exactly as returned and record page/cursor coverage.
6. Classify safe outcomes such as success, permission denied, authentication failure, timestamp/signature failure, network failure, or schema incompatibility.
7. Aggregate actual execution fees only from fill records, grouped by their actual fee asset.
8. Keep current maker/taker fee rates in a separate snapshot; never substitute them for historical fees.
9. Emit a sanitized report and stop at an unresolved authentication, permission, signing, schema, or contract failure.

The request automation must remain GET-only for this R1 scope. It must not place or cancel orders, transfer funds, withdraw, create keys, attach policies, create sessions, or perform other mutations.

### Illustrative sanitized result shape

The following is a **format example, not a result** and contains no account data:

```json
{
  "operation": "fills",
  "outcome": "success|denied|blocked|schema_incompatible",
  "httpStatus": 200,
  "schemaValidated": true,
  "pagesFetched": 1,
  "cursorExhausted": true,
  "unknownOrConflictingRows": 0
}
```

Do not include private response bodies, keys, secrets, signatures, canonical strings, passphrases, session tokens, or sensitive account identifiers in the report.

## 4. What still cannot be inferred or automated away

### One-time key and policy setup

API keys skip JWTs for subsequent API requests; they do not eliminate every interactive account-administration step. The official documentation says:

- Key creation uses an already authenticated session or existing authorized key and may require MFA/step-up.
- A new key has no policy.
- Policy list/create/apply and certain account operations require an interactive session; a new key cannot manage its own policies.

PolyTools should leave that administration in Polyester's official UI. This is a one-time owner setup step, not a reason to make every subsequent balance or fill request manual.

### Browser CORS and browser key custody

A Node/local-agent success proves that the request worked from that process and network environment. It does **not** prove that:

- the browser's CORS preflight accepts the custom signing headers;
- the intended Pages/HTTPS origin is allowed;
- the browser can import and use the key nonextractably; or
- the deployed web bundle has the required security headers and deployment gates.

Those are separate browser-release checks. They are unnecessary for a purely headless local agent, but remain necessary before enabling authenticated reads in the browser UI.

Do not respond to a browser CORS failure with `no-cors`, an unreviewed proxy, a shared signing service, or a public private-response cache.

### Financial completeness

Successful authentication and valid fill records do not establish complete opening basis, complete non-fill cash flows, or fresh valuation marks. P&L remains unavailable until those independent coverage gates pass. A fee-rate snapshot is not fee expenditure, and net quote flow is not profit.

## 5. `.env`: precise security guidance

My earlier blanket warning against using an API key in `.env` was too broad for a **local Node/headless SDK process**. The official TypeScript guide itself demonstrates environment-based configuration with:

- `POLYESTER_API_KEY_ID`
- `POLYESTER_API_SECRET_HEX`

Environment injection is not inherently the same as exposing a secret in a browser bundle. The safety boundary depends on where the file lives and which process loads it.

For an owner-controlled local agent, the following rules are mandatory:

- Use only a local, gitignored environment file or an approved secrets manager/ephemeral secret injector. Never commit it.
- Do not use a `VITE_` prefix for a private secret. Vite variables with that prefix are intended for public browser configuration and can be inlined into JavaScript.
- Do not place the file in a deployed web root, upload it to a ticket/chat, or include it in a build artifact.
- Do not use real secrets in CI, automated synthetic suites, Arena, shared previews, or public Workers/Pages environment settings.
- Do not log environment contents, request headers, signatures, raw errors, or private response bodies.
- Restrict the key to the minimum read policies and revoke the disposable test key when finished.
- A plaintext `.env` is not an encrypted vault. If the deployment requires no persistent plaintext secret, use a secrets manager or ephemeral runtime input instead; gitignore alone does not provide encryption or access control.

Example **variable names only** for a local headless process (not a file to commit and not a request to put credentials in this conversation):

```bash
POLYESTER_API_KEY_ID=<server-issued-ak-id>
POLYESTER_API_SECRET_HEX=<owner-supplied-0x-prefixed-secret>
```

These variables belong to a local Node/agent process, not to the Vite browser configuration. The browser app should continue to use its reviewed encrypted-vault flow. No real `.env` was created or read for this report.

## 6. Recommended local-agent verification flow

This is a proposed automation procedure, not a claim that it has already run:

1. **Owner provisions once:** create a disposable testnet key and attach only the required read policies through official Polyester controls. Do not ask the local agent to perform key/policy administration.
2. **Inject secrets locally:** provide the key ID and private secret through the approved local secret channel. Keep them out of Vite, Git, CI, logs, and reports.
3. **Run headlessly:** use the official SDK or the audited PolyTools signer/REST client with the fixed official testnet origin. No wallet login or browser click is needed for the API requests.
4. **Check identity first:** record only the safe `auth.me` outcome; do not treat it as a permission list.
5. **Check datasets independently:** retain operation, safe error category, HTTP status class, schema result, freshness, and cursor coverage. A denied dataset remains denied, not an empty successful dataset.
6. **Check financial semantics:** actual fees come from executions; current rates remain separate; incomplete/conflicting rows block affected aggregates; P&L stays gated.
7. **Clean up:** clear process state and revoke the disposable key according to the owner's procedure. Do not persist decrypted account snapshots.
8. **Run browser checks separately if needed:** verify exact-origin CORS/preflight and the web vault before enabling browser reads.

A local headless run can therefore automate almost all request/schema/permission verification. It cannot honestly be reported as a successful **browser** compatibility test unless the browser checks also pass.

## 7. Impact on the current PolyTools checkpoint

- R1 source changes remain frozen while the owner-controlled live test is completed.
- `docs/account-live-verification.md` is a browser release checklist; it should not be interpreted as evidence that Polyester API-key authentication itself requires browser interaction.
- No live API-key request was made while preparing this report.
- No live balance, fee, equity, permission, schema, pagination, or P&L result is claimed.
- Any demonstrated live incompatibility should be addressed from sanitized evidence rather than by adding permissions, proxies, or financial mutations.

## 8. Official sources read

Accessed 2026-10-23:

- [Ed25519 API keys](https://testnet.polyester.com/docs/developer-docs/authentication-security/ed25519-api-keys) — keypair registration, required headers, canonical signing, timestamp window, retries, policies, and key handling.
- [TypeScript SDK: API keys](https://testnet.polyester.com/docs/sdk/typescript/guides/authentication) — bot/script/backend use, environment-based key configuration, local signing, and the no-policy behavior of new keys.
- [TypeScript SDK: Authentication model](https://testnet.polyester.com/docs/sdk/typescript/concepts/authentication-model) — API keys skip JWTs; interactive-session-only administration remains distinct.
- [REST: Getting started](https://testnet.polyester.com/docs/developer-docs/rest/getting-started) — production-supported REST, private-request signing, opaque pagination, and retry discipline.
- [Connectivity matrix](https://testnet.polyester.com/docs/developer-docs/getting-started/connectivity-matrix) — REST for direct HTTP integrations, scripts, and operational tooling.
