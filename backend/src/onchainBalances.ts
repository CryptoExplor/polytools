/**
 * Reading a smart account's funding balances from a public explorer.
 *
 * Kept server-side on purpose. The explorer is a third party whose CORS policy we
 * do not control and cannot test from here; routing through our own backend means
 * the browser only ever talks to `/api`, exactly like every other route in this
 * app. It also keeps the CSP's `connect-src` from growing by another origin.
 *
 * Scope, stated once so it does not get over-claimed:
 *   Funding balances — chain state, readable. ✅
 *   Trading balances — exchange ledger, needs a session. ❌
 *   Open orders      — matching engine, never on-chain. ❌
 */

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Blockscout v2 on Ethereum Sepolia, where the wrapped testnet assets settle. */
export const DEFAULT_EXPLORER_BASE = "https://eth-sepolia.blockscout.com";

export interface OnchainBalance {
  /** Token contract. */
  address: string;
  symbol: string;
  name: string | null;
  decimals: number;
  /** Integer amount exactly as the explorer reports it. */
  raw: string;
  /** Human amount, or null when it cannot be represented exactly. */
  formatted: string | null;
}

/**
 * Formats an integer string by its decimals, exactly.
 *
 * BigInt, not Number: token amounts routinely exceed 2^53, and rounding a balance
 * is the kind of quiet inaccuracy that makes a financial view untrustworthy.
 */
export function formatUnits(raw: string, decimals: number): string | null {
  if (!/^\d+$/.test(raw)) return null;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) return null;

  const digits = raw.padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals) || "0";
  const fraction = decimals > 0 ? digits.slice(digits.length - decimals).replace(/0+$/, "") : "";
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${grouped}${fraction ? `.${fraction}` : ""}`;
}

interface ExplorerEntry {
  value?: unknown;
  token?: {
    address_hash?: unknown;
    symbol?: unknown;
    name?: unknown;
    decimals?: unknown;
    type?: unknown;
  } | null;
}

/**
 * Normalises an explorer token-balance payload.
 *
 * Drops zero-value rows (an address can be spammed with hundreds of them), native
 * coin entries (no token object) and anything that is not an ERC-20 (the same
 * endpoint also lists NFTs).
 */
export function parseExplorerBalances(payload: unknown): OnchainBalance[] {
  if (!Array.isArray(payload)) return [];

  const rows: OnchainBalance[] = [];
  for (const entry of payload as ExplorerEntry[]) {
    const token = entry?.token;
    if (!token) continue;

    const raw = typeof entry.value === "string" ? entry.value : null;
    const symbol = typeof token.symbol === "string" ? token.symbol.trim() : "";
    const contract = typeof token.address_hash === "string" ? token.address_hash : "";
    if (!raw || raw === "0" || !/^\d+$/.test(raw)) continue;
    if (!symbol || !ADDRESS_RE.test(contract)) continue;
    if (typeof token.type === "string" && token.type !== "ERC-20") continue;

    const decimals = Number(token.decimals);
    const scale = Number.isInteger(decimals) ? decimals : 0;
    rows.push({
      address: contract,
      symbol,
      name: typeof token.name === "string" ? token.name : null,
      decimals: scale,
      raw,
      formatted: formatUnits(raw, scale),
    });
  }

  // Largest first, so a real holding is not buried under dust.
  rows.sort((a, b) => {
    const left = a.formatted ? Number(a.formatted.replace(/,/g, "")) : 0;
    const right = b.formatted ? Number(b.formatted.replace(/,/g, "")) : 0;
    return right - left;
  });
  return rows;
}

export type BalancesResult =
  | { ok: true; address: string; balances: OnchainBalance[] }
  | { ok: false; status: number; code: string; detail?: string };

/** Fetches and normalises balances for one address. Never throws. */
export async function fetchOnchainBalances(
  address: string,
  options: { explorerBase?: string; fetchImpl?: typeof fetch } = {},
): Promise<BalancesResult> {
  if (!ADDRESS_RE.test(address)) {
    return { ok: false, status: 400, code: "invalid_address" };
  }

  const base = (options.explorerBase ?? DEFAULT_EXPLORER_BASE).replace(/\/+$/, "");
  const doFetch = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(`${base}/api/v2/addresses/${address}/token-balances`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, status: 502, code: "explorer_unreachable" };
  }

  if (!response.ok) {
    return { ok: false, status: 502, code: "explorer_error", detail: `HTTP ${response.status}` };
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, status: 502, code: "explorer_invalid_response" };
  }
  if (!Array.isArray(payload)) {
    return { ok: false, status: 502, code: "explorer_invalid_response" };
  }

  return { ok: true, address, balances: parseExplorerBalances(payload) };
}
