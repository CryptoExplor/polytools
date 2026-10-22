/**
 * Raw payload types returned by the Polyester read-only MCP tools.
 * Verified against the live testnet endpoint (Oct 2026).
 *
 * Conventions observed in every market payload:
 *  - Prices (lastPrice, bestBid/Ask, high/low, candles OHLC, book levels,
 *    trade prices, indexPrice) are scaled integers as decimal strings: divide by 10^3.
 *  - Quantities and volume fields are plain decimal strings (NOT scaled).
 *  - `apiEnv` identifies the serving environment ("testnet" today).
 */

export type ApiEnv = "testnet" | "devnet" | "mainnet" | string;

export interface AssetInfo {
  asset: string;
  ledgerId: number;
  name: string;
  quantityDisplayDecimals: number;
  quantityScale: number;
}

export interface PairInfo {
  symbolId: number;
  symbol: string; // "BTC-USDT"
  baseAsset: string;
  quoteAsset: string;
  tickSize: string;
  stepSize: string;
  minNotionalQuote: string;
  minQtyBase: string;
  status: string; // "enabled"
  listingAt: number | null;
  delistingAt: number | null;
}

export interface SpotMarketsResult {
  apiEnv: ApiEnv;
  tsSec: number;
  assets: AssetInfo[];
  pairs: PairInfo[];
}

export interface MarketOverviewEntry {
  symbolId: number;
  symbol: string;
  lastPrice: string;      // scaled
  lastTradeTsMs: number;
  change24hBps: number;   // basis points, e.g. -87 = -0.87%
  high24h: string;        // scaled
  low24h: string;         // scaled
  volume24hBase: string;  // plain decimal
  volume24hQuote: string; // plain decimal
  volume24hUsd: string;   // plain decimal
  listedTsMs: number;
  bestBid: string;        // scaled
  bestBidQty: string;
  bestAsk: string;        // scaled
  bestAskQty: string;
  indexPrice: string;     // scaled
}

export interface MarketOverviewResult {
  apiEnv: ApiEnv;
  markets: MarketOverviewEntry[];
}

export interface BookLevel {
  price: string; // scaled
  qty: string;   // plain
}

export interface OrderbookResult {
  apiEnv: ApiEnv;
  symbol: string;
  symbolId: number;
  depth: number;
  bookSeq: string;
  bestBid: BookLevel;
  bestAsk: BookLevel;
  bidCount: number;
  askCount: number;
  bids: BookLevel[];
  asks: BookLevel[];
  note?: string;
}

export interface Candle {
  time: number;   // unix seconds
  open: string;   // scaled
  high: string;   // scaled
  low: string;    // scaled
  close: string;  // scaled
  volume: string; // plain
  isClosed: boolean;
}

export interface CandlesResult {
  apiEnv: ApiEnv;
  symbol: string;
  symbolId: number;
  timeframe: string;
  candleCount: number;
  candles: Candle[];
}

export interface RecentTrade {
  matchId: string;
  sideLabel: "buy" | "sell";
  price: string; // scaled
  qty: string;   // plain
  tsMs: number;
}

export interface RecentTradesResult {
  apiEnv: ApiEnv;
  symbol: string;
  symbolId: number;
  tradeCount: number;
  trades: RecentTrade[];
  nextPageToken?: string;
}

export interface HeatmapBucket {
  tsSec: number;
  bids: { price: string[]; qty: string[] };
  asks: { price: string[]; qty: string[] };
}

export interface HeatmapResult {
  apiEnv: ApiEnv;
  symbol: string;
  symbolId: number;
  interval: string;
  depth: number;
  startTsSec: number;
  endTsSec: number;
  bucketCount: number;
  quantityMode: string;
  lastPersistedTsSec: number;
  buckets: HeatmapBucket[];
}

export interface ZipperChain {
  chainId: number;
  code: string;
  name: string;
  nativeCurrencySymbol: string;
  explorerUrl: string;
  requiredConfirmations: number;
  confirmationTimeSeconds: number;
}

export interface DepositWithdrawConfig {
  apiEnv: ApiEnv;
  tsMs: number;
  polyesterChainId: number;
  chains: ZipperChain[];
  [k: string]: unknown;
}

export interface AssetRoute {
  asset: string;
  chain: string;
  chainId: number;
  chainCode: string;
  depositMinAmount: string;
  withdrawMinAmount: string;
  networkFee: string;
  isNativeAsset: boolean;
}

export interface AssetRoutesResult {
  apiEnv: ApiEnv;
  asset: string;
  chainFilter: string | null;
  routes: AssetRoute[];
  note?: string;
}

export interface CompareRoutesResult extends AssetRoutesResult {
  compareBy: "networkFee" | "depositMinAmount";
  cheapestByNetworkFee?: { chain: string; networkFee: string; depositMinAmount: string };
  cheapestByDepositMin?: { chain: string; networkFee: string; depositMinAmount: string };
}

/** Lifecycle/explain payloads evolve quickly — keep them open-shaped. */
export interface LifecycleResult {
  apiEnv: ApiEnv;
  note?: string;
  [k: string]: unknown;
}
