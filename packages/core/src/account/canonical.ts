/**
 * Polyester canonical-request primitives.
 *
 * This module contains no key custody or network behavior. It deliberately
 * fails closed when WebCrypto is unavailable or when the documented and
 * pinned-SDK query orderings disagree.
 */

export const EMPTY_BODY_SHA256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export const CANONICAL_QUERY_CONTRACT = "polyester-docs-decoded-sort-v1";

export class CanonicalRequestError extends Error {
  readonly code:
    | "CRYPTO_UNAVAILABLE"
    | "INVALID_CANONICAL_INPUT"
    | "AMBIGUOUS_QUERY_CONTRACT";

  constructor(
    code: "CRYPTO_UNAVAILABLE" | "INVALID_CANONICAL_INPUT" | "AMBIGUOUS_QUERY_CONTRACT",
    message: string,
  ) {
    super(message);
    this.name = "CanonicalRequestError";
    this.code = code;
  }
}

export interface QueryPair {
  key: string;
  value: string;
}

export interface CanonicalQueryResult {
  canonicalQuery: string;
  pairs: QueryPair[];
  contract: typeof CANONICAL_QUERY_CONTRACT;
  ambiguousOrdering: boolean;
}

export function requireWebCrypto(): Crypto {
  const candidate = globalThis.crypto;
  if (!candidate?.subtle || typeof candidate.getRandomValues !== "function") {
    throw new CanonicalRequestError(
      "CRYPTO_UNAVAILABLE",
      "Secure WebCrypto is required. Use a supported browser in an HTTPS secure context.",
    );
  }
  return candidate;
}

export function ed25519Supported(): boolean {
  try {
    return (
      typeof globalThis.crypto?.subtle?.generateKey === "function" &&
      typeof globalThis.crypto?.subtle?.sign === "function" &&
      (typeof window === "undefined" || window.isSecureContext !== false)
    );
  } catch {
    return false;
  }
}

export function bytesToHex(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let output = "";
  for (const byte of bytes) output += byte.toString(16).padStart(2, "0");
  return output;
}

export function bytesToBase64(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  if (typeof globalThis.btoa !== "function") {
    throw new CanonicalRequestError(
      "CRYPTO_UNAVAILABLE",
      "This runtime cannot encode binary vault data.",
    );
  }
  return globalThis.btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  if (
    typeof value !== "string" ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new Error("Invalid base64 data.");
  }
  if (typeof globalThis.atob !== "function") throw new Error("Base64 decoder unavailable.");
  const binary = globalThis.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function normalizeHex(input: string, bytes: number): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  const stripped = /^0x/i.test(trimmed) ? trimmed.slice(2) : trimmed;
  const pattern = new RegExp(`^[0-9a-fA-F]{${bytes * 2}}$`);
  return pattern.test(stripped) ? stripped.toLowerCase() : null;
}

export function normalizePublicKeyHex(input: string): string | null {
  return normalizeHex(input, 32);
}

/** Normalize a raw 32-byte Ed25519 seed. This is never a vault label/key ID. */
export function normalizePrivateKeyHex(input: string): string | null {
  return normalizeHex(input, 32);
}

export function hexToBytes(input: string): Uint8Array {
  const clean = normalizePublicKeyHex(input);
  if (!clean) {
    throw new Error(
      "Expected 64 hexadecimal characters (32 bytes, with or without a 0x prefix).",
    );
  }
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function pubKeyB64ToHex(publicKeyB64: string): string {
  try {
    const bytes = base64ToBytes(publicKeyB64);
    return bytes.length === 32 ? bytesToHex(bytes) : "";
  } catch {
    return "";
  }
}

export function pubKeyHexToB64(publicKeyHex: string): string {
  return bytesToBase64(hexToBytes(publicKeyHex));
}

function rfc3986Encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/** Decode form-style query data without throwing on malformed percent escapes. */
function safeDecodeComponent(raw: string): string {
  const withSpaces = raw.replace(/\+/g, " ");
  try {
    return decodeURIComponent(withSpaces);
  } catch {
    const sanitized = withSpaces.replace(/%(?![0-9a-fA-F]{2})/g, "%25");
    try {
      return decodeURIComponent(sanitized);
    } catch {
      return withSpaces;
    }
  }
}

export function parseQueryPairs(rawQuery = ""): QueryPair[] {
  const raw = rawQuery.startsWith("?") ? rawQuery.slice(1) : rawQuery;
  if (!raw) return [];
  const pairs: QueryPair[] = [];
  for (const part of raw.split("&")) {
    if (!part) continue;
    const equals = part.indexOf("=");
    pairs.push({
      key: safeDecodeComponent(equals >= 0 ? part.slice(0, equals) : part),
      value: safeDecodeComponent(equals >= 0 ? part.slice(equals + 1) : ""),
    });
  }
  return pairs;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Produce the documented decoded-key/decoded-value ordering. The pinned
 * TypeScript SDK instead sorts complete encoded pair strings. When those
 * algorithms would choose a different order, signing is blocked until the
 * server contract is verified; callers must not silently choose per request.
 */
export function canonicalizePairs(
  inputPairs: QueryPair[],
  options: { rejectAmbiguous?: boolean } = {},
): CanonicalQueryResult {
  const pairs = inputPairs.map((pair) => ({ key: pair.key, value: pair.value }));
  if (pairs.some((pair) => typeof pair.key !== "string" || typeof pair.value !== "string")) {
    throw new CanonicalRequestError(
      "INVALID_CANONICAL_INPUT",
      "Query keys and values must be strings.",
    );
  }
  const indexed = pairs.map((pair, index) => ({ ...pair, index }));

  const documented = [...indexed].sort(
    (left, right) =>
      compareStrings(left.key, right.key) ||
      compareStrings(left.value, right.value) ||
      left.index - right.index,
  );
  const sdk = [...indexed].sort((left, right) => {
    const leftPair = `${encodeURIComponent(left.key)}=${encodeURIComponent(left.value)}`;
    const rightPair = `${encodeURIComponent(right.key)}=${encodeURIComponent(right.value)}`;
    return compareStrings(leftPair, rightPair) || left.index - right.index;
  });

  const ambiguousOrdering = documented.some(
    (pair, index) => pair.index !== sdk[index]?.index,
  );
  if (ambiguousOrdering && options.rejectAmbiguous !== false) {
    throw new CanonicalRequestError(
      "AMBIGUOUS_QUERY_CONTRACT",
      "This query has conflicting official documentation/SDK sort orders. Signing is blocked until the server contract is verified.",
    );
  }

  return {
    canonicalQuery: documented
      .map(
        (pair) =>
          `${rfc3986Encode(pair.key)}=${rfc3986Encode(pair.value)}`,
      )
      .join("&"),
    pairs,
    contract: CANONICAL_QUERY_CONTRACT,
    ambiguousOrdering,
  };
}

export function canonicalizeQuery(
  rawQuery = "",
  options: { rejectAmbiguous?: boolean } = {},
): CanonicalQueryResult {
  return canonicalizePairs(parseQueryPairs(rawQuery), options);
}

export function normalizeCanonicalQuery(rawQuery = ""): string {
  return canonicalizeQuery(rawQuery).canonicalQuery;
}

/** Hash the actual supplied bytes, including an empty body. No insecure fallback. */
export async function sha256Hex(body?: string | Uint8Array): Promise<string> {
  const crypto = requireWebCrypto();
  const bytes =
    typeof body === "string"
      ? new TextEncoder().encode(body)
      : body ?? new Uint8Array();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return bytesToHex(digest);
}

export function buildCanonicalString(params: {
  timestamp: string;
  method: string;
  path: string;
  query?: string;
  bodySha256Hex?: string;
}): string {
  const timestamp = params.timestamp.trim();
  const method = params.method.trim().toUpperCase();
  const path = params.path;
  const bodyHash = (params.bodySha256Hex ?? EMPTY_BODY_SHA256).toLowerCase();

  if (!/^\d{1,20}$/.test(timestamp)) {
    throw new CanonicalRequestError(
      "INVALID_CANONICAL_INPUT",
      "The signing timestamp must be Unix milliseconds.",
    );
  }
  if (!/^[A-Z][A-Z0-9_-]*$/.test(method)) {
    throw new CanonicalRequestError(
      "INVALID_CANONICAL_INPUT",
      "A valid uppercase HTTP method is required.",
    );
  }
  if (
    !path.startsWith("/") ||
    path.includes("?") ||
    path.includes("#") ||
    /[\u0000-\u001f\u007f]/.test(path)
  ) {
    throw new CanonicalRequestError(
      "INVALID_CANONICAL_INPUT",
      "The exact request path must start with / and exclude query, fragment, and control characters.",
    );
  }
  if (!/^[0-9a-f]{64}$/.test(bodyHash)) {
    throw new CanonicalRequestError(
      "INVALID_CANONICAL_INPUT",
      "A lowercase SHA-256 body digest is required.",
    );
  }

  return [
    timestamp,
    method,
    path,
    normalizeCanonicalQuery(params.query ?? ""),
    bodyHash,
  ].join("\n");
}
