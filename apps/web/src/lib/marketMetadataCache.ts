import type { AssetInfo, PairInfo, SpotMarketsResult } from "@poly/core";
import { API_BASE } from "./api";
import {
  IndexedDbPublicCacheStorage,
  PublicDataCache,
  type PublicCachePolicy,
} from "./publicCache";

export const MARKET_METADATA_SCHEMA = "spot-markets@1";
export const MARKET_METADATA_POLICY: PublicCachePolicy = {
  schema: MARKET_METADATA_SCHEMA,
  // Matches /api/markets' current max-age; response directives can shorten it.
  freshMs: 60_000,
  // Stale copies are always labeled and are never presented as live.
  maxAgeMs: 24 * 60 * 60 * 1000,
  maxBytes: 1_048_576,
};
export const MARKET_METADATA_REVALIDATE_MS = 60_000;

export type PublicSpotMarkets = SpotMarketsResult & {
  dataSource?: "wire-samples";
};

function apiScope(): string {
  if (!API_BASE) return "same-origin";
  try {
    const url = new URL(API_BASE, "https://relative.polytools.invalid");
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return "invalid-api-base";
  }
}

export const MARKET_METADATA_CACHE_KEY =
  `public:${apiScope()}:/api/markets:${MARKET_METADATA_SCHEMA}`;

export const marketMetadataCache = new PublicDataCache({
  storage: new IndexedDbPublicCacheStorage(),
  maxEntries: 8,
});

function text(value: unknown, maxLength = 256): string | null {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : null;
}

function decimalText(value: unknown): string | null {
  const parsed = text(value, 128);
  return parsed && /^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(parsed) ? parsed : null;
}

function safeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function nullableTimestamp(value: unknown): number | null | undefined {
  if (value === null) return null;
  const parsed = safeInteger(value);
  return parsed === null ? undefined : parsed;
}

function decodeAsset(value: unknown): AssetInfo | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const asset = text(raw.asset, 64);
  const name = text(raw.name, 256);
  const ledgerId = safeInteger(raw.ledgerId);
  const quantityDisplayDecimals = safeInteger(raw.quantityDisplayDecimals);
  const quantityScale = safeInteger(raw.quantityScale);
  if (
    asset === null || name === null || ledgerId === null ||
    quantityDisplayDecimals === null || quantityScale === null
  ) return null;
  return { asset, ledgerId, name, quantityDisplayDecimals, quantityScale };
}

function decodePair(value: unknown): PairInfo | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const symbolId = safeInteger(raw.symbolId);
  const symbol = text(raw.symbol, 128);
  const baseAsset = text(raw.baseAsset, 64);
  const quoteAsset = text(raw.quoteAsset, 64);
  const tickSize = decimalText(raw.tickSize);
  const stepSize = decimalText(raw.stepSize);
  const minNotionalQuote = decimalText(raw.minNotionalQuote);
  const minQtyBase = decimalText(raw.minQtyBase);
  const status = text(raw.status, 64);
  const listingAt = nullableTimestamp(raw.listingAt);
  const delistingAt = nullableTimestamp(raw.delistingAt);
  if (
    symbolId === null || symbol === null || baseAsset === null || quoteAsset === null ||
    tickSize === null || stepSize === null || minNotionalQuote === null ||
    minQtyBase === null || status === null || listingAt === undefined ||
    delistingAt === undefined
  ) return null;
  return {
    symbolId,
    symbol,
    baseAsset,
    quoteAsset,
    tickSize,
    stepSize,
    minNotionalQuote,
    minQtyBase,
    status,
    listingAt,
    delistingAt,
  };
}

/** Validate and strip every field before a catalog is reused or persisted. */
export function decodePublicSpotMarkets(value: unknown): PublicSpotMarkets | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.assets) || raw.assets.length > 4096) return null;
  if (!Array.isArray(raw.pairs) || raw.pairs.length > 4096) return null;
  const apiEnv = text(raw.apiEnv, 64);
  const tsSec = safeInteger(raw.tsSec);
  if (apiEnv === null || tsSec === null) return null;
  if (raw.dataSource !== undefined && raw.dataSource !== "wire-samples") return null;

  const assets: AssetInfo[] = [];
  const pairs: PairInfo[] = [];
  const assetCodes = new Set<string>();
  const pairIds = new Set<number>();
  const pairSymbols = new Set<string>();
  for (const rawAsset of raw.assets) {
    const asset = decodeAsset(rawAsset);
    if (!asset || assetCodes.has(asset.asset)) return null;
    assetCodes.add(asset.asset);
    assets.push(asset);
  }
  for (const rawPair of raw.pairs) {
    const pair = decodePair(rawPair);
    if (!pair || pairIds.has(pair.symbolId) || pairSymbols.has(pair.symbol)) return null;
    pairIds.add(pair.symbolId);
    pairSymbols.add(pair.symbol);
    pairs.push(pair);
  }

  return {
    apiEnv,
    tsSec,
    assets,
    pairs,
    ...(raw.dataSource === "wire-samples" ? { dataSource: "wire-samples" as const } : {}),
  };
}
