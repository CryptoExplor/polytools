import {
  buildCanonicalString,
  bytesToBase64,
  bytesToHex,
  requireWebCrypto,
  sha256Hex,
} from "./canonical";

export const READ_ONLY_OPERATIONS = {
  authMe: { method: "GET", path: "/v1/auth/me", label: "Authentication context" },
  balances: { method: "GET", path: "/v1/balances", label: "Current balances" },
  balanceHistory: {
    method: "GET",
    path: "/v1/balances/history",
    label: "Sampled balance history",
  },
  equityHistory: {
    method: "GET",
    path: "/v1/equity/history/series",
    label: "Sampled equity history",
  },
  ordersOpen: { method: "GET", path: "/v1/orders/open", label: "Open orders" },
  ordersHistory: {
    method: "GET",
    path: "/v1/orders/history",
    label: "Terminal order history",
  },
  fills: { method: "GET", path: "/v1/spot/trades", label: "User fills" },
  transfers: { method: "GET", path: "/v1/transfers", label: "Finalized transfers" },
  feeRates: { method: "GET", path: "/v1/spot/fee-rates", label: "Current fee rates" },
} as const;

export type ReadOnlyOperation = keyof typeof READ_ONLY_OPERATIONS;

export interface SignedRequestResult {
  keyId: string;
  operation?: ReadOnlyOperation;
  timestamp: string;
  canonicalString: string;
  bodySha256Hex: string;
  signatureB64: string;
  signatureHex: string;
}

export function normalizeRegisteredKeyId(input: string): string | null {
  if (typeof input !== "string") return null;
  const value = input.trim();
  // A local label is never an authentication identifier. Keep validation
  // conservative while allowing the documented ak_... server-issued form.
  return /^ak_[A-Za-z0-9_-]{1,125}$/.test(value) ? value : null;
}

/** Process-wide allocator shared by every local signer/session. */
export class MonotonicTimestampAllocator {
  private lastTimestamp = 0;

  next(now: number): string {
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new Error("The device clock did not provide valid Unix milliseconds.");
    }
    this.lastTimestamp = Math.max(this.lastTimestamp + 1, now);
    return String(this.lastTimestamp);
  }
}

const processTimestamps = new MonotonicTimestampAllocator();

/**
 * Low-level Ed25519 canonical signer. Account code reaches this only through
 * AccountVault.signReadRequest(), which applies the fixed GET operation registry.
 */
export class Ed25519RequestSigner {
  private registeredKeyId: string | undefined;

  constructor(
    private readonly privateKey: CryptoKey,
    registeredKeyId: string | undefined,
    private readonly now: () => number = Date.now,
    private readonly timestamps: MonotonicTimestampAllocator = processTimestamps,
  ) {
    if (privateKey.algorithm.name !== "Ed25519" || !privateKey.usages.includes("sign")) {
      throw new Error("A WebCrypto Ed25519 signing key is required.");
    }
    this.setRegisteredKeyId(registeredKeyId);
  }

  get privateKeyExtractable(): boolean {
    return this.privateKey.extractable;
  }

  setRegisteredKeyId(registeredKeyId: string | undefined): void {
    if (registeredKeyId === undefined || registeredKeyId.trim() === "") {
      this.registeredKeyId = undefined;
      return;
    }
    const normalized = normalizeRegisteredKeyId(registeredKeyId);
    if (!normalized) {
      throw new Error("Registered key ID must use Polyester's server-issued ak_... form.");
    }
    this.registeredKeyId = normalized;
  }

  async signCanonical(input: {
    method: string;
    path: string;
    query?: string;
    body?: string | Uint8Array;
    operation?: ReadOnlyOperation;
  }): Promise<SignedRequestResult> {
    if (!this.registeredKeyId) {
      throw new Error(
        "A server-registered Polyester key ID is required. A local vault label cannot authenticate a request.",
      );
    }
    const timestamp = this.timestamps.next(this.now());
    const bodySha256Hex = await sha256Hex(input.body);
    const canonicalString = buildCanonicalString({
      timestamp,
      method: input.method,
      path: input.path,
      query: input.query,
      bodySha256Hex,
    });
    const signature = await requireWebCrypto().subtle.sign(
      { name: "Ed25519" },
      this.privateKey,
      new TextEncoder().encode(canonicalString),
    );
    return {
      keyId: this.registeredKeyId,
      operation: input.operation,
      timestamp,
      canonicalString,
      bodySha256Hex,
      signatureB64: bytesToBase64(signature),
      signatureHex: bytesToHex(signature),
    };
  }
}

export function signedHeaders(
  signed: Pick<SignedRequestResult, "keyId" | "timestamp" | "signatureB64">,
): Record<string, string> {
  return {
    "X-API-KEY-ID": signed.keyId,
    "X-API-TIMESTAMP": signed.timestamp,
    "X-API-SIGNATURE": signed.signatureB64,
  };
}
