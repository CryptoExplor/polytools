/**
 * Wallet signing for Polyester login — the injected provider, nothing else.
 *
 * SCOPE BOUNDARY (same as `walletConnection.ts`):
 *   - The only method called here is `personal_sign`, and only from an explicit
 *     user gesture. Nothing is signed on mount, on connect, or on a timer.
 *   - No private key is ever read, requested or stored. The signature is
 *     produced inside the wallet; this module only carries the result.
 *   - The message is never modified. Polyester's contract is that the wallet
 *     signs the exact UTF-8 bytes the server issued: no trim, no whitespace
 *     normalisation, no re-encoding round trip. A "helpful" cleanup here
 *     produces a valid signature over the wrong bytes, which the exchange
 *     rejects with no useful explanation.
 *
 * Why the smart account address is not derived here: it is derived on the
 * server (see `backend/src/authProxy.ts`). Deriving client-side would require
 * `@polyester/sdk` in the browser bundle, and the SDK helper's own `signMessage`
 * returns ERC-6492 wrapped signatures that login rejects — an easy trap.
 */

import type { InjectedProvider } from "./walletConnection";

/** 0x-prefixed, 40 hex characters. */
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export interface SignRequest {
  provider: InjectedProvider;
  /** The owner EOA, as it will be sent to the server. */
  address: string;
  /** The exact UTF-8 message issued by the challenge endpoint. */
  message: string;
}

export type SignFailure =
  | "rejected"
  | "pending"
  | "unauthorized"
  | "malformed_signature"
  | "unknown";

export class WalletSignatureError extends Error {
  readonly code: SignFailure;
  constructor(code: SignFailure) {
    super(`wallet signature failed: ${code}`);
    this.name = "WalletSignatureError";
    this.code = code;
  }
}

/** UTF-8 → 0x-hex, byte for byte. */
export function messageToHex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  let hex = "0x";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/** Round-trip used by tests and by the pre-flight check below. */
export function hexToMessage(hex: string): string {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return new TextDecoder().decode(bytes);
}

/** A login signature is 65 bytes of hex, with or without the 0x prefix. */
export function isSignatureLike(value: unknown): value is string {
  return typeof value === "string" && /^(?:0x)?[0-9a-fA-F]{130}$/.test(value);
}

/** Maps EIP-1193 codes to our own, so provider text never reaches the UI. */
export function classifySignError(error: unknown): SignFailure {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 4001) return "rejected";
  if (code === -32002) return "pending";
  if (code === 4100) return "unauthorized";
  return "unknown";
}

export function signatureErrorMessage(code: SignFailure): string {
  switch (code) {
    case "rejected":
      return "Sign-in was declined in your wallet.";
    case "pending":
      return "Your wallet already has a pending request. Open it and finish that first.";
    case "unauthorized":
      return "Your wallet has not authorized this site.";
    case "malformed_signature":
      return "Your wallet returned a signature this app cannot read.";
    default:
      return "Sign-in failed. Nothing was sent to the exchange.";
  }
}

/**
 * Signs the challenge with the owner EOA.
 *
 * Must be called from a user gesture. Some wallets additionally require the
 * Ethereum mainnet network to be selected before signing a login message;
 * that is the wallet's choice and we do not switch networks behind the user.
 */
export async function signLoginMessage(request: SignRequest): Promise<string> {
  const { provider, address, message } = request;
  if (!ADDRESS_RE.test(address)) throw new WalletSignatureError("unknown");
  if (!message) throw new WalletSignatureError("unknown");

  const hex = messageToHex(message);
  // Cheap guard against a silent encoding bug: the wallet must sign exactly
  // these bytes, so confirm the round trip before involving the wallet at all.
  if (hexToMessage(hex) !== message) throw new WalletSignatureError("unknown");

  let signature: unknown;
  try {
    signature = await provider.request({
      method: "personal_sign",
      params: [hex, address],
    });
  } catch (error) {
    throw new WalletSignatureError(classifySignError(error));
  }

  if (!isSignatureLike(signature)) throw new WalletSignatureError("malformed_signature");
  return signature;
}
