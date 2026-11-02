# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project aims to follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Renamed PolyTools to Polyap** ("Pol" + "yap") across the UI, docs, comments and metadata:
  page titles, web manifest, intro bar, footer, Brand Kit favicon download (`polyap-favicon.svg`),
  User-Agent strings, and MCP client names (`polyap`, `polyap-backend`).
- Package names: root `polyester-tools` → `polyap`; workspaces `@poly/core`, `@poly/backend`,
  `@poly/web` → `@polyap/core`, `@polyap/backend`, `@polyap/web` (imports, tsconfig paths, Vite
  alias and lockfile updated).
- Documentation consolidated from 56 files under `docs/` into seven maintained documents
  (`docs/ARCHITECTURE.md`, `POLYESTER_PROTOCOL.md`, `SECURITY.md`, `TESTING.md`, `DEPLOYMENT.md`,
  `ROADMAP.md`, `docs/README.md`) plus ADRs in `docs/decisions/`. All 41 surviving originals moved to
  `docs/archive/`; every pre-consolidation filename still exists somewhere under `docs/`, so the
  history is intact and the count is checkable.
- `tests/polytools.test.mjs` renamed to `tests/polyap.test.mjs`.

### Added

- `POLYAP_APP_ORIGINS` for the wallet sign-in proxy allowlist and `POLYAP_LIVE_TEST` for the live
  verification runner. The legacy names are still read as fallbacks.
- The client also accepts the `x-polyap-data-source` header when detecting wire-sample responses.
- `packages/core/src/persistedIdentifiers.ts`: one reviewed home for storage and export identifiers
  that must not change.
- Root `.env.example` documenting server-side and deployment variables.
- `tests/rename-compat.test.mjs` pinning persisted identifiers and env fallbacks.

### Deprecated

- `POLYTOOLS_APP_ORIGINS` and `POLYTOOLS_LIVE_TEST`. Set the `POLYAP_*` names; the old ones will be
  removed in a future major release.

### Unchanged on purpose

- Persisted and wire identifiers keep their old values so existing users keep their data: IndexedDB
  `polytools-account-vault` / `polytools-public-cache`, vault and cache format tags, the vault
  BroadcastChannel and key-pair challenge, `poly-tools:*` localStorage keys, export
  `schemaVersion` `polytools.account-export.v2` and `polytools-testnet-*` filenames, and the
  `x-polytools-data-source` header the dev server sends.
- Deployment names (`polytools-cc8.pages.dev`, Workers `polytools` and `poly-tools-backend`) and the
  GitHub repository name, pending a new Pages project.

### Fixed

- README and issue-template Discussions/Issues links pointed at `CryptoExplor/polyester`; they now
  point at `CryptoExplor/polytools`.
- The README feature table now includes `/#/fees` and the on-chain account view, and
  `docs/ARCHITECTURE.md` lists every backend route, including the wallet sign-in proxy.
