/**
 * Ed25519 API-key vault — the foundation of the Portfolio tool.
 *
 * Design rules:
 *  - Keys are generated with WebCrypto Ed25519 and NEVER leave the browser.
 *  - Private key material is exported to localStorage only (pkcs8, base64)
 *    and can be wiped with one click.
 *  - Public keys are exposed in both 64-character lowercase hex (matching
 *    https://testnet.polyester.com/account/api-keys -> "Bring your own key":
 *    "Paste 64 hex characters (with or without 0x)") and Base64.
 *  - Signing implements the 5-field newline-separated canonical string from
 *    Polyester developer-docs → authentication-security → ed25519-api-keys:
 *      <timestamp_ms>\n<UPPERCASE_METHOD>\n<path>\n<canonical_query>\n<body_sha256_hex>
 *  - Local vault labels are distinct from Polyester server-issued `ak_...` keyIds;
 *    headers will only authenticate after the public key is registered on Polyester.
 */

export interface VaultKey {
  keyId: string;           // user-chosen local vault label (e.g. "Trading Bot")
  publicKeyHex: string;    // raw 32-byte public key as 64 lowercase hex chars (for Polyester "Bring your own key")
  publicKeyB64: string;    // raw 32-byte public key, base64
  privateKeyB64: string;   // pkcs8, base64 — localStorage ONLY (empty string if public-only import)
  registeredKeyId?: string; // optional Polyester server-assigned keyId (e.g. "ak_...")
  createdAt: number;
}

export interface CanonicalSignInput {
  method: string;
  path: string;
  query?: string;
  body?: string | Uint8Array;
  timestamp?: string;
  /** Optional Polyester-registered keyId (e.g. "ak_..."). Falls back to entry.registeredKeyId or local vault label. */
  apiKeyId?: string;
}

export interface SignedRequestResult {
  keyId: string;
  label: string;
  isRegisteredKeyId: boolean;
  timestamp: string;
  canonicalString: string;
  bodySha256Hex: string;
  signatureB64: string;
  signatureHex: string;
}

const STORAGE_KEY = "poly-tools:vault:v1";

export const EMPTY_BODY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export const POLYESTER_API_KEYS_URL =
  "https://testnet.polyester.com/account/api-keys";

function b64encode(buf: ArrayBuffer | Uint8Array): string {
  let s = "";
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function b64decode(b64: string): ArrayBuffer {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes.buffer;
}

export function bytesToHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Validate and normalize a 32-byte Ed25519 public key in hex format
 * ("Paste 64 hex characters (with or without 0x)").
 * Returns 64 lowercase hex characters (without 0x), or null if invalid.
 */
export function normalizePublicKeyHex(input: string): string | null {
  const trimmed = input.trim();
  const stripped = trimmed.startsWith("0x") || trimmed.startsWith("0X")
    ? trimmed.slice(2)
    : trimmed;
  if (!/^[0-9a-fA-F]{64}$/.test(stripped)) return null;
  return stripped.toLowerCase();
}

export function hexToBytes(hexInput: string): Uint8Array {
  const clean = normalizePublicKeyHex(hexInput);
  if (!clean) {
    throw new Error(
      "Expected 64 hexadecimal characters (32-byte Ed25519 key, with or without 0x prefix).",
    );
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function pubKeyB64ToHex(publicKeyB64: string): string {
  try {
    return bytesToHex(b64decode(publicKeyB64));
  } catch {
    return "";
  }
}

export function pubKeyHexToB64(publicKeyHex: string): string {
  return b64encode(hexToBytes(publicKeyHex));
}

function rfc3986Encode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * Safely decode percent-encoded query components without throwing URIError
 * when a user enters a bare `%` or incomplete escape sequence.
 */
function safeDecodeComponent(raw: string): string {
  const withSpaces = raw.replace(/\+/g, " ");
  try {
    return decodeURIComponent(withSpaces);
  } catch {
    // Sanitize lone/malformed `%` signs into `%25` before decoding valid escapes
    const sanitized = withSpaces.replace(
      /%(?![0-9a-fA-F]{2})/g,
      "%25",
    );
    try {
      return decodeURIComponent(sanitized);
    } catch {
      return withSpaces;
    }
  }
}

/**
 * Normalize a raw query string per the Polyester Ed25519 specification:
 *  1. Parse all query pairs, including repeated keys and empty values.
 *  2. Decode `+` as space, then percent-decode each key and value.
 *  3. Sort pairs by decoded key, then by decoded value.
 *  4. RFC 3986 percent-encode each key and value (spaces as %20, + as %2B).
 *  5. Join as `key=value` with `&`.
 */
export function normalizeCanonicalQuery(rawQuery = ""): string {
  const cleaned = rawQuery.trim().replace(/^\?/, "");
  if (!cleaned) return "";
  const pairs: Array<{ k: string; v: string }> = [];
  for (const part of cleaned.split("&")) {
    if (!part) continue;
    const eqIdx = part.indexOf("=");
    const rawK = eqIdx >= 0 ? part.slice(0, eqIdx) : part;
    const rawV = eqIdx >= 0 ? part.slice(eqIdx + 1) : "";
    const k = safeDecodeComponent(rawK);
    const v = safeDecodeComponent(rawV);
    pairs.push({ k, v });
  }
  pairs.sort((a, b) =>
    a.k !== b.k ? (a.k < b.k ? -1 : 1) : a.v < b.v ? -1 : a.v > b.v ? 1 : 0,
  );
  return pairs
    .map((p) => `${rfc3986Encode(p.k)}=${rfc3986Encode(p.v)}`)
    .join("&");
}

/** Lowercase hexadecimal SHA-256 digest of request body bytes (empty body still hashed). */
export async function sha256Hex(body?: string | Uint8Array): Promise<string> {
  if (body === undefined || body === null) return EMPTY_BODY_SHA256;
  const bytes =
    typeof body === "string" ? new TextEncoder().encode(body) : body;
  if (bytes.byteLength === 0) return EMPTY_BODY_SHA256;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(digest);
}

/**
 * Build the 5-field newline-separated canonical string required by Polyester:
 *   <timestamp_ms>\n<UPPERCASE_METHOD>\n<path>\n<canonical_query>\n<body_sha256_hex>
 */
export function buildCanonicalString(params: {
  timestamp: string;
  method: string;
  path: string;
  query?: string;
  bodySha256Hex?: string;
}): string {
  const ts = params.timestamp.trim();
  const method = (params.method.trim() || "GET").toUpperCase();
  const rawPath = params.path.trim() || "/";
  const path = rawPath.startsWith("/") ? rawPath : `/${rawPath}`;
  const canonicalQuery = normalizeCanonicalQuery(params.query ?? "");
  const bodyHash = (params.bodySha256Hex ?? EMPTY_BODY_SHA256).toLowerCase();
  return [ts, method, path, canonicalQuery, bodyHash].join("\n");
}

export function ed25519Supported(): boolean {
  try {
    return (
      typeof crypto !== "undefined" &&
      typeof crypto.subtle?.generateKey === "function" &&
      (typeof window === "undefined" || window.isSecureContext !== false)
    );
  } catch {
    return false;
  }
}

export function loadVault(): VaultKey[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<Partial<VaultKey>>;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((k): k is VaultKey => Boolean(k && typeof k.keyId === "string" && k.publicKeyB64))
      .map((k) => ({
        keyId: k.keyId,
        publicKeyB64: k.publicKeyB64,
        publicKeyHex: k.publicKeyHex || pubKeyB64ToHex(k.publicKeyB64),
        privateKeyB64: typeof k.privateKeyB64 === "string" ? k.privateKeyB64 : "",
        registeredKeyId: k.registeredKeyId,
        createdAt: typeof k.createdAt === "number" ? k.createdAt : Date.now(),
      }));
  } catch {
    return [];
  }
}

function saveVault(keys: VaultKey[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
}

export async function generateVaultKey(
  keyId: string,
  registeredKeyId?: string,
): Promise<VaultKey> {
  const kp = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const pub = await crypto.subtle.exportKey("raw", kp.publicKey);
  const priv = await crypto.subtle.exportKey("pkcs8", kp.privateKey);
  const entry: VaultKey = {
    keyId,
    publicKeyHex: bytesToHex(pub),
    publicKeyB64: b64encode(pub),
    privateKeyB64: b64encode(priv),
    registeredKeyId: registeredKeyId?.trim() || undefined,
    createdAt: Date.now(),
  };
  saveVault([...loadVault().filter((k) => k.keyId !== keyId), entry]);
  return entry;
}

/**
 * Save a user-supplied 32-byte Ed25519 public key (64 hex chars, with or without 0x)
 * into the local vault directory (public-only entry; no private key stored).
 */
export function importPublicVaultKey(
  keyId: string,
  publicKeyHexInput: string,
  registeredKeyId?: string,
): VaultKey {
  const cleanHex = normalizePublicKeyHex(publicKeyHexInput);
  if (!cleanHex) {
    throw new Error(
      "Invalid public key: paste 64 hex characters (with or without 0x).",
    );
  }
  const entry: VaultKey = {
    keyId,
    publicKeyHex: cleanHex,
    publicKeyB64: pubKeyHexToB64(cleanHex),
    privateKeyB64: "",
    registeredKeyId: registeredKeyId?.trim() || undefined,
    createdAt: Date.now(),
  };
  saveVault([...loadVault().filter((k) => k.keyId !== keyId), entry]);
  return entry;
}

export function setVaultKeyRegisteredId(
  keyId: string,
  registeredKeyId: string,
): VaultKey[] {
  const updated = loadVault().map((k) =>
    k.keyId === keyId
      ? { ...k, registeredKeyId: registeredKeyId.trim() || undefined }
      : k,
  );
  saveVault(updated);
  return updated;
}

export function deleteVaultKey(keyId: string): void {
  saveVault(loadVault().filter((k) => k.keyId !== keyId));
}

export function wipeVault(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Sign a private REST request using the official 5-field canonical format:
 *   <timestamp_ms>\n<UPPERCASE_METHOD>\n<path>\n<canonical_query>\n<body_sha256_hex>
 */
export async function signRequest(
  entry: VaultKey,
  input: string | CanonicalSignInput,
  opts?: { timestamp?: string; apiKeyId?: string },
): Promise<SignedRequestResult> {
  if (!entry.privateKeyB64) {
    throw new Error(
      "This entry is a public-key-only record (imported via 'Bring your own key') and has no private key in localStorage to sign with.",
    );
  }
  const key = await crypto.subtle.importKey(
    "pkcs8",
    b64decode(entry.privateKeyB64),
    { name: "Ed25519" },
    false,
    ["sign"],
  );

  let timestamp: string;
  let canonicalString: string;
  let bodySha256Hex: string;
  let explicitKeyId =
    opts?.apiKeyId?.trim() || entry.registeredKeyId?.trim() || "";

  if (typeof input === "object" && input !== null) {
    timestamp = (input.timestamp ?? opts?.timestamp ?? Date.now().toString()).trim();
    bodySha256Hex = await sha256Hex(input.body);
    if (input.apiKeyId?.trim()) explicitKeyId = input.apiKeyId.trim();
    canonicalString = buildCanonicalString({
      timestamp,
      method: input.method,
      path: input.path,
      query: input.query,
      bodySha256Hex,
    });
  } else {
    const lines = input.split("\n");
    if (lines.length === 5 && /^\d+$/.test(lines[0].trim())) {
      timestamp = lines[0].trim();
      bodySha256Hex = lines[4].trim() || EMPTY_BODY_SHA256;
      canonicalString = lines.join("\n");
    } else {
      timestamp = (opts?.timestamp ?? Date.now().toString()).trim();
      bodySha256Hex = EMPTY_BODY_SHA256;
      const m = input.trim().match(/^(GET|POST|PUT|DELETE|PATCH)\s*(.*)$/i);
      const method = m ? m[1].toUpperCase() : "GET";
      const rawTarget = (m ? m[2] : input).trim() || "/";
      const qIdx = rawTarget.indexOf("?");
      const pathPart = qIdx >= 0 ? rawTarget.slice(0, qIdx) : rawTarget;
      const queryPart = qIdx >= 0 ? rawTarget.slice(qIdx + 1) : "";
      canonicalString = buildCanonicalString({
        timestamp,
        method,
        path: pathPart || "/",
        query: queryPart,
        bodySha256Hex,
      });
    }
  }

  const sig = await crypto.subtle.sign(
    { name: "Ed25519" },
    key,
    new TextEncoder().encode(canonicalString),
  );

  const isRegisteredKeyId = Boolean(explicitKeyId);
  return {
    keyId: explicitKeyId || entry.keyId,
    label: entry.keyId,
    isRegisteredKeyId,
    timestamp,
    canonicalString,
    bodySha256Hex,
    signatureB64: b64encode(sig),
    signatureHex: bytesToHex(sig),
  };
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
