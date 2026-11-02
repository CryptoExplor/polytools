/**
 * On-chain view of a Polyester account.
 *
 * Polyester accounts are smart accounts, so their funding balances are ordinary
 * chain balances — public data that needs no session. Two small reads:
 *
 *   1. derive the smart-account address from the connected wallet
 *   2. ask our own `/api` what that address holds
 *
 * Both go to this app's backend. The explorer is never contacted from the
 * browser: its CORS policy is a third party's decision, and routing through
 * `/api` keeps the browser talking to one origin, as everywhere else here.
 *
 * The boundary is a fact about the exchange, not an implementation gap:
 *   Funding balances — on-chain, shown here.
 *   Trading balances — exchange ledger, needs a login that may never be granted.
 *   Open orders      — matching engine, never on-chain. No explorer can show them.
 */

import { API_BASE } from "./api";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export interface OnchainBalance {
  address: string;
  symbol: string;
  name: string | null;
  decimals: number;
  raw: string;
  formatted: string | null;
}

export class OnchainError extends Error {
  constructor(
    public readonly code: "invalid_address" | "lookup_failed" | "invalid_response",
    detail?: string,
  ) {
    super(detail ?? code);
    this.name = "OnchainError";
  }
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const parsed = (await response.json()) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** Derives the counterfactual smart account for a connected wallet. Read-only. */
export async function deriveSmartAccountAddress(
  signerAddress: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!ADDRESS_RE.test(signerAddress)) throw new OnchainError("invalid_address", signerAddress);

  const response = await fetchImpl(
    `${API_BASE}/api/account/address?signer=${encodeURIComponent(signerAddress)}`,
    { headers: { Accept: "application/json" } },
  );
  if (!response.ok) throw new OnchainError("lookup_failed", `HTTP ${response.status}`);

  const body = await readJson(response);
  const address = typeof body?.smartAccountAddress === "string" ? body.smartAccountAddress : "";
  if (!ADDRESS_RE.test(address)) throw new OnchainError("invalid_response", "smart account");
  return address;
}

/**
 * Token balances held by an address, already normalised by the backend.
 *
 * Validation runs again here rather than trusting the wire shape: this feeds a
 * table, and a malformed row should disappear rather than render as "NaN".
 */
export async function fetchOnchainBalances(
  address: string,
  fetchImpl: typeof fetch = fetch,
): Promise<OnchainBalance[]> {
  if (!ADDRESS_RE.test(address)) throw new OnchainError("invalid_address", address);

  const response = await fetchImpl(
    `${API_BASE}/api/account/balances?address=${encodeURIComponent(address)}`,
    { headers: { Accept: "application/json" } },
  );
  if (!response.ok) throw new OnchainError("lookup_failed", `HTTP ${response.status}`);

  const body = await readJson(response);
  const raw = body?.balances;
  if (!Array.isArray(raw)) throw new OnchainError("invalid_response", "balances");

  const rows: OnchainBalance[] = [];
  for (const entry of raw as Array<Record<string, unknown>>) {
    const symbol = typeof entry?.symbol === "string" ? entry.symbol : "";
    const contract = typeof entry?.address === "string" ? entry.address : "";
    const value = typeof entry?.raw === "string" ? entry.raw : "";
    if (!symbol || !ADDRESS_RE.test(contract) || !/^\d+$/.test(value)) continue;
    rows.push({
      address: contract,
      symbol,
      name: typeof entry.name === "string" ? entry.name : null,
      decimals: typeof entry.decimals === "number" ? entry.decimals : 0,
      raw: value,
      formatted: typeof entry.formatted === "string" ? entry.formatted : null,
    });
  }
  return rows;
}
