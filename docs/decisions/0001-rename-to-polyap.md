# 0001 — Rename PolyTools to Polyap; keep persisted identifiers

- **Status:** Accepted
- **Date:** 2026-11-02

## Context

The project started as "PolyTools", a set of read-only tools for the Polyester exchange. It is
becoming a Polyester dApp, and the name should say so: **Polyap = "Pol" + "yap"**. The old name is
spread across UI copy, package names (`polyester-tools`, `@poly/*`), environment variables, and —
critically — identifiers written into users' browsers and exported files.

## Decision

- Rename every user-facing and developer-facing name: UI, docs, package names (`polyap`,
  `@polyap/core`, `@polyap/backend`, `@polyap/web`), User-Agent strings, MCP client names, the Brand
  Kit download, and test fixtures.
- **Keep every persisted identifier byte-for-byte**, gathered in
  `packages/core/src/persistedIdentifiers.ts` with a DO NOT RENAME note:
  IndexedDB databases `polytools-account-vault` and `polytools-public-cache`, their format tags,
  the `polytools-account-vault-control` BroadcastChannel, the vault key-pair challenge string,
  `poly-tools:*` localStorage keys, the cache relative-base URL, the export `schemaVersion`
  `polytools.account-export.v2` and filename prefix `polytools-testnet`.
- Keep wire identifiers: the `x-polytools-data-source` header is still sent; the client also
  accepts `x-polyap-data-source` when reading.
- Environment variables gain new names with fallback: `POLYAP_APP_ORIGINS` (falls back to
  `POLYTOOLS_APP_ORIGINS`) and `POLYAP_LIVE_TEST` (falls back to `POLYTOOLS_LIVE_TEST`). Blank counts
  as unset; the new name wins when both are set.
- Leave deployment names (`polytools-cc8.pages.dev`, Worker names `polytools` and
  `poly-tools-backend`) and the GitHub repository name alone for now.

## Consequences

- Renaming a storage key or database would make existing users' encrypted vault look empty, break
  cross-tab locking with older tabs, discard cached data, and make earlier exports fail schema
  checks. Keeping them costs a few old strings in one reviewed file.
- `tests/rename-compat.test.mjs` pins the persisted values and the env fallbacks.
- Any future change to a persisted value needs a tested migration (read old → write new → delete
  old), not a find-and-replace.
- Follow-ups: rename the GitHub repo, create a new Pages project/domain and update the deploy origin,
  remove legacy env names in a major release ([ROADMAP.md](../ROADMAP.md)).
