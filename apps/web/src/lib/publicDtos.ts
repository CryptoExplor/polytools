import type {
  CandlesResult,
  MarketOverviewResult,
  OrderbookResult,
  RecentTradesResult,
  SpotMarketsResult,
} from "@poly/core";
import { parseVipFeeSchedule } from "@poly/core";

type JsonObject = Record<string, unknown>;
type RequestParams = Record<string, string | number | undefined>;

interface EnvironmentResponse {
  ok: boolean;
  mcpConfigured: boolean;
  networks: {
    testnet: { mcpConfigured: boolean };
    mainnet: { mcpConfigured: boolean; note: string };
  };
  cache: { keys: number; inFlight: number };
}

/** A successful HTTP response with an incompatible shape is not accepted as data. */
export class PublicApiSchemaError extends Error {
  readonly code = "SCHEMA_INCOMPATIBLE" as const;

  constructor(readonly route: string) {
    super(`The public ${route} response did not match the expected data shape; no data was accepted.`);
    this.name = "PublicApiSchemaError";
  }
}

function fail(route: string): never {
  throw new PublicApiSchemaError(route);
}

function object(value: unknown, route: string): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(route);
  return value as JsonObject;
}

function list(value: unknown, route: string): unknown[] {
  if (!Array.isArray(value)) fail(route);
  return value;
}

function string(value: unknown, route: string): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function requiredString(value: unknown, route: string): asserts value is string {
  if (!string(value, route)) fail(route);
}

function identityString(value: unknown, route: string): asserts value is string {
  requiredString(value, route);
  if (value !== value.trim()) fail(route);
}

function decimalString(value: unknown, route: string): void {
  if (
    typeof value !== "string" ||
    !/^-?(?:\d+)(?:\.\d+)?$/.test(value) ||
    !Number.isFinite(Number(value))
  ) fail(route);
}

function finiteNumber(value: unknown, route: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(route);
}

function safeInteger(value: unknown, route: string, minimum = 0): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) fail(route);
}

function booleanValue(value: unknown, route: string): void {
  if (typeof value !== "boolean") fail(route);
}

function validateEnvironment(value: unknown): EnvironmentResponse {
  const route = "/env";
  const root = object(value, route);
  booleanValue(root.ok, route);
  booleanValue(root.mcpConfigured, route);

  const networks = object(root.networks, route);
  const testnet = object(networks.testnet, route);
  booleanValue(testnet.mcpConfigured, route);
  const mainnet = object(networks.mainnet, route);
  booleanValue(mainnet.mcpConfigured, route);
  requiredString(mainnet.note, route);

  const cache = object(root.cache, route);
  safeInteger(cache.keys, route);
  safeInteger(cache.inFlight, route);
  return value as EnvironmentResponse;
}

function optionalString(value: unknown, route: string): void {
  if (value !== undefined) requiredString(value, route);
}

function optionalNullableString(value: unknown, route: string): void {
  if (value !== undefined && value !== null) requiredString(value, route);
}

function apiEnvironment(value: JsonObject, route: string): void {
  identityString(value.apiEnv, route);
}

function expectedSymbol(value: unknown, params: RequestParams | undefined, route: string): void {
  identityString(value, route);
  const expected = params?.symbol;
  if (
    typeof expected === "string" &&
    expected.trim() !== "" &&
    value !== expected.trim()
  ) fail(route);
}

function validateSpotMarkets(value: unknown): SpotMarketsResult {
  const route = "/markets";
  const root = object(value, route);
  apiEnvironment(root, route);
  safeInteger(root.tsSec, route);

  const assets = list(root.assets, route);
  const assetIds = new Set<number>();
  const assetSymbols = new Set<string>();
  for (const value of assets) {
    const asset = object(value, route);
    identityString(asset.asset, route);
    safeInteger(asset.ledgerId, route);
    requiredString(asset.name, route);
    safeInteger(asset.quantityDisplayDecimals, route);
    safeInteger(asset.quantityScale, route);
    const id = asset.ledgerId as number;
    const symbol = (asset.asset as string).toUpperCase();
    if (assetIds.has(id) || assetSymbols.has(symbol)) fail(route);
    assetIds.add(id);
    assetSymbols.add(symbol);
  }

  const pairs = list(root.pairs, route);
  const pairIds = new Set<number>();
  const pairSymbols = new Set<string>();
  for (const value of pairs) {
    const pair = object(value, route);
    safeInteger(pair.symbolId, route, 1);
    identityString(pair.symbol, route);
    identityString(pair.baseAsset, route);
    identityString(pair.quoteAsset, route);
    decimalString(pair.tickSize, route);
    decimalString(pair.stepSize, route);
    decimalString(pair.minNotionalQuote, route);
    decimalString(pair.minQtyBase, route);
    requiredString(pair.status, route);
    if (pair.listingAt !== null) safeInteger(pair.listingAt, route);
    if (pair.delistingAt !== null) safeInteger(pair.delistingAt, route);
    if (pair.listingAt === undefined || pair.delistingAt === undefined) fail(route);
    const id = pair.symbolId as number;
    const symbol = (pair.symbol as string).toUpperCase();
    if (pairIds.has(id) || pairSymbols.has(symbol)) fail(route);
    pairIds.add(id);
    pairSymbols.add(symbol);
  }
  return value as SpotMarketsResult;
}

function validateOverviewEntry(value: unknown): void {
  const route = "/overview";
  const market = object(value, route);
  safeInteger(market.symbolId, route, 1);
  identityString(market.symbol, route);
  for (const field of ["lastPrice", "high24h", "low24h", "bestBid", "bestAsk", "indexPrice"]) {
    decimalString(market[field], route);
  }
  for (const field of ["volume24hBase", "volume24hQuote", "volume24hUsd", "bestBidQty", "bestAskQty"]) {
    decimalString(market[field], route);
  }
  for (const field of ["lastTradeTsMs", "listedTsMs"]) safeInteger(market[field], route);
  finiteNumber(market.change24hBps, route);
}

function validateMarketOverview(value: unknown, params?: RequestParams): MarketOverviewResult {
  const route = "/overview";
  const root = object(value, route);
  apiEnvironment(root, route);
  const markets = list(root.markets, route);
  const requested = typeof params?.symbols === "string"
    ? new Set(params.symbols.split(",").map((symbol) => symbol.trim()).filter(Boolean))
    : null;
  const seenIds = new Set<number>();
  const seenSymbols = new Set<string>();
  for (const market of markets) {
    validateOverviewEntry(market);
    const entry = market as JsonObject;
    const id = entry.symbolId as number;
    const rawSymbol = entry.symbol as string;
    const symbol = rawSymbol.toUpperCase();
    if (seenIds.has(id) || seenSymbols.has(symbol)) fail(route);
    seenIds.add(id);
    seenSymbols.add(symbol);
    if (requested && !requested.has(rawSymbol)) fail(route);
  }
  optionalNullableString(root.nextPageToken, route);
  optionalString(root.error, route);
  if (root.knownSymbols !== undefined) {
    for (const symbol of list(root.knownSymbols, route)) requiredString(symbol, route);
  }
  return value as MarketOverviewResult;
}

function validateBookLevel(value: unknown, route: string): void {
  const level = object(value, route);
  decimalString(level.price, route);
  decimalString(level.qty, route);
}

function validateOrderbook(value: unknown, params?: RequestParams): OrderbookResult {
  const route = "/orderbook";
  const root = object(value, route);
  apiEnvironment(root, route);
  expectedSymbol(root.symbol, params, route);
  safeInteger(root.symbolId, route, 1);
  safeInteger(root.depth, route, 1);
  requiredString(root.bookSeq, route);
  validateBookLevel(root.bestBid, route);
  validateBookLevel(root.bestAsk, route);
  safeInteger(root.bidCount, route);
  safeInteger(root.askCount, route);
  for (const level of list(root.bids, route)) validateBookLevel(level, route);
  for (const level of list(root.asks, route)) validateBookLevel(level, route);
  optionalString(root.note, route);
  return value as OrderbookResult;
}

function validateCandle(value: unknown, route: string): void {
  const candle = object(value, route);
  safeInteger(candle.time, route);
  for (const field of ["open", "high", "low", "close", "volume"]) decimalString(candle[field], route);
  if (typeof candle.isClosed !== "boolean") fail(route);
}

function validateCandles(value: unknown, params?: RequestParams): CandlesResult {
  const route = "/candles";
  const root = object(value, route);
  apiEnvironment(root, route);
  expectedSymbol(root.symbol, params, route);
  safeInteger(root.symbolId, route, 1);
  requiredString(root.timeframe, route);
  if (typeof params?.tf === "string" && root.timeframe !== params.tf) fail(route);
  safeInteger(root.candleCount, route);
  for (const candle of list(root.candles, route)) validateCandle(candle, route);
  optionalString(root.note, route);
  return value as CandlesResult;
}

function validateTrade(value: unknown, route: string): void {
  const trade = object(value, route);
  requiredString(trade.matchId, route);
  if (trade.sideLabel !== "buy" && trade.sideLabel !== "sell") fail(route);
  decimalString(trade.price, route);
  decimalString(trade.qty, route);
  safeInteger(trade.tsMs, route);
}

function validateRecentTrades(value: unknown, params?: RequestParams): RecentTradesResult {
  const route = "/trades";
  const root = object(value, route);
  apiEnvironment(root, route);
  expectedSymbol(root.symbol, params, route);
  safeInteger(root.symbolId, route, 1);
  safeInteger(root.tradeCount, route);
  const trades = list(root.trades, route);
  for (const trade of trades) validateTrade(trade, route);
  optionalString(root.nextPageToken, route);
  return value as RecentTradesResult;
}

/**
 * Validate high-value public market DTOs at the browser boundary. Unknown
 * fields remain allowed so additive upstream changes do not break the client.
 */
export function decodePublicApiResponse<T>(
  path: string,
  value: unknown,
  params?: RequestParams,
): T {
  const normalizedPath = path.split("?", 1)[0].replace(/\/+$/, "") || "/";
  switch (normalizedPath) {
    case "/env":
      return validateEnvironment(value) as T;
    case "/markets":
      return validateSpotMarkets(value) as T;
    case "/overview":
      return validateMarketOverview(value, params) as T;
    case "/orderbook":
      return validateOrderbook(value, params) as T;
    case "/candles":
      return validateCandles(value, params) as T;
    case "/trades":
      return validateRecentTrades(value, params) as T;
    case "/fees/tiers":
      // Shared parser, so a malformed catalog is rejected in the browser with
      // the same rules the backend applied before it cached the response.
      return parseVipFeeSchedule(value) as T;
    default:
      return value as T;
  }
}
