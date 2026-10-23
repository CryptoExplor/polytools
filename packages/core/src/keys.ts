/**
 * Compatibility boundary for the former plaintext localStorage vault.
 *
 * All active key custody, migration, canonicalization, and signing now lives in
 * account/. There is intentionally no plaintext save/load/sign compatibility
 * wrapper: legacy v1 data is quarantined and can only be explicitly migrated or
 * deleted through AccountVault.
 */
export * from "./account/index";
