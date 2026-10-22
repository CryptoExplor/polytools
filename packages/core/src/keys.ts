/**
 * Ed25519 API-key vault — the foundation of the Portfolio tool.
 *
 * Design rules:
 *  - Keys are generated with WebCrypto Ed25519 and NEVER leave the browser.
 *  - Private key material is exported to localStorage only (pkcs8, base64)
 *    and can be wiped with one click.
 *  - Signing produces the three headers Polyester private REST endpoints
 *    expect: X-API-KEY-ID, X-API-TIMESTAMP, X-API-SIGNATURE.
 *    (See developer-docs → authentication-security → ed25519-api-keys.)
 *
 * On mainnet launch, register the exported public key in your Polyester
 * account, then point the Portfolio page at the private REST endpoints.
 */

export interface VaultKey {
  keyId: string;       // user-chosen label / id
  publicKeyB64: string; // raw 32-byte public key, base64
  privateKeyB64: string; // pkcs8, base64 — localStorage ONLY
  createdAt: number;
}

const STORAGE_KEY = "poly-tools:vault:v1";

function b64encode(buf: ArrayBuffer): string {
  let s = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64decode(b64: string): ArrayBuffer {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

export function ed25519Supported(): boolean {
  try {
    return (
      typeof crypto !== "undefined" &&
      typeof crypto.subtle?.generateKey === "function" &&
      // Ed25519 needs a secure context + modern engine; verified lazily by catch.
      typeof window === "undefined" || window.isSecureContext !== false
    );
  } catch {
    return false;
  }
}

export function loadVault(): VaultKey[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as VaultKey[]) : [];
  } catch {
    return [];
  }
}

function saveVault(keys: VaultKey[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}

export async function generateVaultKey(keyId: string): Promise<VaultKey> {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const pub = await crypto.subtle.exportKey("raw", kp.publicKey);
  const priv = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
  const entry: VaultKey = {
    keyId,
    publicKeyB64: b64encode(pub),
    privateKeyB64: b64encode(priv),
    createdAt: Date.now(),
  };
  saveVault([...loadVault().filter((k) => k.keyId !== keyId), entry]);
  return entry;
}

export function deleteVaultKey(keyId: string): void {
  saveVault(loadVault().filter((k) => k.keyId !== keyId));
}

export function wipeVault(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Sign a private REST request.
 * `canonicalString` is the exact signing string Polyester documents
 * (method + path + timestamp + body — assemble per the latest
 *  authentication-security docs before mainnet wiring).
 */
export async function signRequest(
  entry: VaultKey,
  canonicalString: string,
): Promise<{ keyId: string; timestamp: string; signatureB64: string }> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    b64decode(entry.privateKeyB64),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const timestamp = Date.now().toString();
  const sig = await crypto.subtle.sign(
    { name: "Ed25519" },
    key,
    new TextEncoder().encode(`${canonicalString}${timestamp}`),
  );
  return { keyId: entry.keyId, timestamp, signatureB64: b64encode(sig) };
}

/** Headers for a signed private REST call (per the public docs). */
export function signedHeaders(
  sig: { keyId: string; timestamp: string; signatureB64: string },
): Record<string, string> {
  return {
    "X-API-KEY-ID": sig.keyId,
    "X-API-TIMESTAMP": sig.timestamp,
    "X-API-SIGNATURE": sig.signatureB64,
  };
}
