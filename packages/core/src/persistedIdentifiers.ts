/**
 * DO NOT RENAME — persisted identifiers.
 *
 * The project was renamed from "PolyTools" to "Polyap" (see
 * docs/decisions/0001-rename-to-polyap.md), but every value below is written
 * to a user's browser storage, embedded in exported files, or used to verify
 * stored secrets. Changing any of them would silently orphan data people
 * already have: the encrypted API-key vault would look empty, cross-tab lock
 * events would stop reaching older tabs, cached public data would be thrown
 * away, and previously exported files would no longer match their schema.
 *
 * They are kept byte-for-byte and gathered here so the old brand only lives in
 * one reviewed place. A future rename of any value needs an explicit, tested
 * migration (read old → write new → delete old), not a find-and-replace.
 *
 * Related wire identifiers that also stay as-is but live elsewhere:
 *  - the `x-polytools-data-source` response header (apps/web/src/lib/provenance.ts);
 *  - the `/api/health` service name `poly-tools-backend` (backend/src/handler.ts),
 *    which uptime checks may match;
 *  - the deploy origin `polytools-cc8.pages.dev` and Worker names `polytools` /
 *    `poly-tools-backend` (deployment config; pending a new Pages project).
 */

// ---------------------------------------------------------------------------
// Encrypted account vault (packages/core/src/account/vault*.ts)
// ---------------------------------------------------------------------------

/** `format` field of every stored encrypted vault entry. */
export const PERSISTED_VAULT_FORMAT = "polytools-account-vault" as const;
/** IndexedDB database holding the encrypted vault. */
export const PERSISTED_VAULT_DATABASE_NAME = "polytools-account-vault";
/** BroadcastChannel used to propagate lock/wipe events across tabs. */
export const PERSISTED_VAULT_CHANNEL_NAME = "polytools-account-vault-control";
/** localStorage key of the retired v1 plaintext vault (only ever deleted, never read for signing). */
export const PERSISTED_LEGACY_VAULT_STORAGE_KEY = "poly-tools:vault:v1";
/** localStorage key used as a cross-tab vault control event fallback. */
export const PERSISTED_VAULT_CONTROL_STORAGE_KEY = "poly-tools:vault:v2:event";
/** Message signed and verified when a key pair is imported into the vault. */
export const PERSISTED_VAULT_KEYPAIR_CHALLENGE = "PolyTools vault key-pair verification v1";

// ---------------------------------------------------------------------------
// Public data cache (apps/web/src/lib/publicCache.ts, marketMetadataCache.ts)
// ---------------------------------------------------------------------------

/** Storage format tag of every cached public-data entry. */
export const PERSISTED_PUBLIC_CACHE_FORMAT = "polytools-public-cache@1" as const;
/** IndexedDB database holding cached public data. */
export const PERSISTED_PUBLIC_CACHE_DATABASE_NAME = "polytools-public-cache";
/** Base URL used to resolve a relative API base; it ends up inside cache keys. */
export const PERSISTED_PUBLIC_CACHE_RELATIVE_BASE = "https://relative.polytools.invalid";

// ---------------------------------------------------------------------------
// Account exports (packages/core/src/account/export.ts)
// ---------------------------------------------------------------------------

/** `schemaVersion` written into every export manifest and CSV column. */
export const PERSISTED_ACCOUNT_EXPORT_SCHEMA_VERSION = "polytools.account-export.v2" as const;
/** Export filename prefix, kept so users' existing file sorting and scripts keep working. */
export const PERSISTED_ACCOUNT_EXPORT_FILENAME_PREFIX = "polytools-testnet";

// ---------------------------------------------------------------------------
// Web UI preferences in localStorage (apps/web)
// ---------------------------------------------------------------------------

export const PERSISTED_WEB_STORAGE_KEYS = {
  /** Dismissed state of the intro banner (Layout.tsx). */
  intro: "poly-tools:intro:v1",
  /** Last selected market symbol (store.tsx). */
  symbol: "poly-tools:symbol",
  /** Light/dark theme (store.tsx). */
  theme: "poly-tools:theme",
  /** Market watchlist (store.tsx). */
  watch: "poly-tools:watch:v1",
  /** Testnet onboarding checklist (Hub.tsx). */
  hubChecklist: "poly-tools:hub-checklist",
} as const;
