# 0002 — A connected wallet is not a login

- **Status:** Accepted
- **Date:** 2026-10-27 (recorded 2026-11-02)

## Context

Three different things get called "connect": an injected wallet exposing an address (EIP-1193 /
EIP-6963), an exchange session obtained by signing a server-issued challenge, and an API key.
Treating them as one caused most of the confusion in early work. A wallet address alone grants
nothing: Polyester binds a Safe smart account and the owner EOA in a server-issued SIWE challenge,
and only the returned token authorizes requests. Any extension can report any address.

## Decision

- Wallet connection is display-only. Connecting signs nothing and sends no exchange request.
- Exchange sign-in is a separate, explicit action: one `personal_sign` over the exact issued
  message, producing an in-memory token. Sign-out and reload drop it.
- The API-key vault is a third, independent mechanism; the two auth forms share no storage.
- The UI never calls a connected wallet "verified" or "signed in".

## Consequences

- Disconnecting only clears local state; wallets expose no site revocation, so users revoke in the
  wallet.
- Before session-backed private data ships, cache identity must bind auth form and account
  (AUTH-01…08 in [TESTING.md](../TESTING.md)).
- Wallet-first UX can grow without weakening the API-key path.
