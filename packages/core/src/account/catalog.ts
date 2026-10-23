import { AccountRestError, POLYESTER_TESTNET_REST_ORIGIN } from "./rest";
import type { FillMarket } from "./normalize";

export interface OfficialSpotCatalog {
  tsSec: string;
  markets: Readonly<Record<string, FillMarket>>;
}

function schemaError(): never {
  throw new AccountRestError("SCHEMA_INCOMPATIBLE", "spotConfig", "The official spot catalog schema is incompatible.");
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return schemaError();
  return value as Record<string, unknown>;
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || /[\u0000-\u001f\u007f]/.test(value)) return schemaError();
  return value;
}

/** Validate only the official pair identity fields used for financial mapping. */
export function validateOfficialSpotConfig(value: unknown): OfficialSpotCatalog {
  const response = object(value);
  if (!Array.isArray(response.assets) || !Array.isArray(response.pairs)) return schemaError();
  const tsSec = text(response.tsSec);
  if (!/^\d+$/.test(tsSec)) return schemaError();
  const markets: Record<string, FillMarket> = {};
  const pairNames = new Set<string>();
  for (const raw of response.pairs) {
    const pair = object(raw);
    if (typeof pair.symbolId !== "number" || !Number.isSafeInteger(pair.symbolId) || pair.symbolId < 0) return schemaError();
    const symbolId = String(pair.symbolId);
    const symbol = text(pair.symbol);
    if (markets[symbolId] || pairNames.has(symbol)) return schemaError();
    pairNames.add(symbol);
    markets[symbolId] = {
      baseAsset: text(pair.baseAsset),
      quoteAsset: text(pair.quoteAsset),
      marketSymbol: symbol,
    };
  }
  return { tsSec, markets };
}

/**
 * Public, unsigned reference-data read. It is intentionally separate from the
 * private client and never sends vault headers or uses the public MCP facade.
 */
export async function fetchOfficialSpotCatalog(options: {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  now?: () => number;
} = {}): Promise<OfficialSpotCatalog & { retrievedAtMs: number }> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  try {
    const response = await fetchImpl(`${POLYESTER_TESTNET_REST_ORIGIN}/v1/spot/config`, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      mode: "cors",
      signal: options.signal,
    });
    if (!response.ok) {
      const code = response.status === 429 ? "RATE_LIMITED" : response.status >= 500 ? "SERVER" : "HTTP_ERROR";
      throw new AccountRestError(code, "spotConfig", "The official spot catalog could not be read.", { httpStatus: response.status });
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!/^application\/(?:[a-z0-9.+-]*\+)?json(?:\s*;|\s*$)/i.test(contentType)) {
      throw new AccountRestError("SCHEMA_INCOMPATIBLE", "spotConfig", "The official spot catalog content type is incompatible.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await response.text()) as unknown;
    } catch {
      throw new AccountRestError("SCHEMA_INCOMPATIBLE", "spotConfig", "The official spot catalog was not valid JSON.");
    }
    const catalog = validateOfficialSpotConfig(parsed);
    return { ...catalog, retrievedAtMs: (options.now ?? Date.now)() };
  } catch (error) {
    if (error instanceof AccountRestError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AccountRestError("ABORTED", "spotConfig", "The official spot catalog read was aborted.");
    }
    if (error instanceof TypeError) {
      throw new AccountRestError("CORS_BLOCKED", "spotConfig", "Browser access to the official spot catalog could not be verified.");
    }
    throw new AccountRestError("NETWORK", "spotConfig", "The official spot catalog read failed safely.");
  }
}
