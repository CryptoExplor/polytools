# Owner-controlled R1 live-read verification

This checklist is a **manual release gate**, not a record of completed live verification. The coding environment did not use a private key or make an authenticated request.

> Run the credential-free checks first: `npm run probe:polyester`. Details and the
> full staged plan are in `wallet-first-audit/19_CONNECTION_AND_ONCHAIN_MODEL.md`.

## Safety boundaries

- Use only your own disposable Polyester **testnet** key, created and revoked in the official UI.
- Never put a private key, passphrase, signature, or private response in chat, tickets, source, CI, URLs, logs, or a shared preview.
- Do not create a key with trading, cancellation, transfer, withdrawal, key-management, or policy-management permission for analytics.
- Keep automated tests synthetic. Run this checklist only in a reviewed local/owner-controlled browser deployment.
- A denied read is a valid verification result. Do not work around it with a proxy, credential relay, `no-cors`, or broader policy.

## Deployment preparation

1. Build the production app and serve it from the exact intended HTTPS origin. Do not use the Arena preview or a shared development server for a real key.
2. Confirm the deployment CSP permits only the required `connect-src` destination: `https://api.testnet.polyester.com`. Confirm no third-party analytics or private-response logging is present on the account route.
3. Authenticated reads are enabled in every build, but no request is sent until the user explicitly selects **Verify & load read-only data**. Use a separate reviewed, owner-controlled HTTPS deployment for real keys; never use the Arena preview or a shared development server.
4. Create/import the key only in that owner-controlled browser. Save the server-issued `ak_...` ID in the encrypted entry. A local label is never an authentication identity.

## Browser protocol checks

1. Open browser developer tools before selecting **Verify & load read-only data**. Check that the browser sends the required CORS preflight for the custom signing headers and that the actual origin is allowed. A readable CORS error is not proof of authentication success.
2. Confirm every request is a GET to the intended friendly REST path, with no request body and no private material in the URL. The client uses `credentials: "omit"`, `cache: "no-store"`, `redirect: "error"`, and `mode: "cors"`.
3. Confirm the request headers are exactly `X-API-KEY-ID`, `X-API-TIMESTAMP`, and `X-API-SIGNATURE`. Timestamp is Unix milliseconds; each attempt receives a fresh monotonic value. The optional nonce is not required or emitted by this client.
4. Confirm authentication, permission, signature, timestamp, and schema failures are not blindly retried. Only bounded temporary GET failures (rate limit/server) are eligible for retry.
5. Lock the vault while a request is delayed. Verify the request aborts and no late response appears in any table or metric. Repeat from a second tab for cross-tab lock/wipe invalidation.

## Per-operation verification

Record only sanitized status/code, operation, browser origin, timestamp, and schema/coverage outcome. Do not copy private response bodies into the record.

1. Confirm the unsigned public `GET /v1/spot/config` catalog succeeds and contains the pair IDs needed for fill mapping. Private reads do not start if this validation fails.
2. Start with current balances and the owner-selected minimal read policy.
3. Verify sampled equity history separately; retain actual server bounds and do not invent point timestamps.
4. Verify terminal order history and fills independently, including an empty result if available and an opaque-cursor continuation if available.
5. Verify transfers only with the separately approved transfer-read permission. Do not treat a transfer as profit or a fee as a burn.
6. Verify current fee rates separately from actual execution fees. Actual fee totals must come from fills and remain grouped by their real fee asset.
7. Confirm each dataset shows its own freshness, cursor/page coverage, unknown/conflicting-row state, and permission error. A successful balance response does not prove fills or transfers are granted.
8. Revoke the disposable key in the official UI after testing.

Until these checks are completed from the intended browser origin, the application must continue to describe live compatibility as **unverified** and must not claim live balances, fees, equity, or P&L.

## Separate headless evidence

See [the sanitized local-agent testnet report](./live-testnet-verification-report.md) for a reported headless API-key run. That evidence is attributed to the local agent and does not replace the browser-origin, CORS, vault, pagination-completeness, or P&L gates above.
