# 0005 — API keys live in a passphrase-encrypted browser vault

- **Status:** Accepted
- **Date:** 2026-10-25 (recorded 2026-11-02)

## Context

Private account reads need an Ed25519 API key. A backend that holds users' keys would be a custodial
target and a shared private cache; a key in a bundle or `VITE_*` variable would be public.

## Decision

- Keys are generated or imported in the browser and stored only as encrypted vault entries in
  IndexedDB: PBKDF2-SHA256 (600,000 iterations) + AES-GCM; the passphrase is never stored.
- Unlocked keys are nonextractable `CryptoKey`s held in memory for a session that ends on lock,
  wipe, idle timeout (15 min), or a cross-tab control event.
- The browser signs requests itself and calls the exchange directly. The backend never receives a
  private key and never caches private responses.
- Private responses live in memory only, partitioned by session, entry, scope, operation and filter.

## Consequences

- Malicious script running while the vault is unlocked, a compromised device, or a weak passphrase
  remain outside cryptographic guarantees; the strict CSP and no third-party scripts matter.
- Locking does not revoke the key at Polyester; users revoke in Polyester's UI.
- Headless automation uses a local, gitignored env file instead
  ([POLYESTER_PROTOCOL.md §4](../POLYESTER_PROTOCOL.md#4-headless-automation-with-api-keys)).
- The vault's IndexedDB name and format are persisted identifiers ([0001](./0001-rename-to-polyap.md)).
