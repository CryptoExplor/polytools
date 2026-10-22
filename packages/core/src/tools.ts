/**
 * Typed wrappers around every read-only Polyester MCP tool.
 * One function per tool; argument shapes mirror the live tool schemas.
 */

import { McpClient } from "./mcp";
import { TOOL, type BookDepth, type CandleTimeframe } from "./config";
import type {
  AssetRoutesResult,
  CandlesResult,
  CompareRoutesResult,
  DepositWithdrawConfig,
  HeatmapResult,
  LifecycleResult,
  MarketOverviewResult,
  OrderbookResult,
  RecentTradesResult,
  SpotMarketsResult,
} from "./types";

export class PolyesterData {
  constructor(private readonly client: McpClient) {}

  static fromUrl(url: string, opts?: { clientName?: string }): PolyesterData {
    return new PolyesterData(new McpClient({ url, clientName: opts?.clientName }));
  }

  /** Market + asset configuration (pairs, tick sizes, assets). Cache-friendly. */
  spotMarkets(): Promise<SpotMarketsResult> {
    return this.client.callTool<SpotMarketsResult>(TOOL.spotMarkets);
  }

  /** 24h stats + top of book for all (or filtered) markets. */
  marketOverview(symbols?: string[], limit = 100): Promise<MarketOverviewResult> {
    const args: Record<string, unknown> = { limit };
    if (symbols?.length) args.symbols = symbols;
    return this.client.callTool<MarketOverviewResult>(TOOL.marketOverview, args);
  }

  orderbook(symbol: string, depth: BookDepth = 20): Promise<OrderbookResult> {
    return this.client.callTool<OrderbookResult>(TOOL.orderbook, { symbol, depth });
  }

  candles(
    symbol: string,
    timeframe: CandleTimeframe = "1h",
    limit = 120,
  ): Promise<CandlesResult> {
    return this.client.callTool<CandlesResult>(TOOL.candles, { symbol, timeframe, limit });
  }

  recentTrades(
    symbol: string,
    limit = 25,
    side?: "buy" | "sell",
    pageToken?: string,
  ): Promise<RecentTradesResult> {
    const args: Record<string, unknown> = { symbol, limit };
    if (side) args.side = side;
    if (pageToken) args.pageToken = pageToken;
    return this.client.callTool<RecentTradesResult>(TOOL.recentTrades, args);
  }

  heatmap(
    symbol: string,
    interval: "1s" | "1m" | "5m" | "1h" = "1m",
    depth = 50,
  ): Promise<HeatmapResult> {
    return this.client.callTool<HeatmapResult>(TOOL.heatmap, { symbol, interval, depth });
  }

  /** Zipper: chains, confirmations, explorers for deposits/withdrawals. */
  depositWithdrawConfig(): Promise<DepositWithdrawConfig> {
    return this.client.callTool<DepositWithdrawConfig>(TOOL.depositWithdrawConfig);
  }

  assetRoutes(asset: string, chainFilter?: string): Promise<AssetRoutesResult> {
    const args: Record<string, unknown> = { asset };
    if (chainFilter) args.chainFilter = chainFilter;
    return this.client.callTool<AssetRoutesResult>(TOOL.listAssetRoutes, args);
  }

  compareRoutes(
    asset: string,
    compareBy: "networkFee" | "depositMinAmount" = "networkFee",
    chainFilter?: string,
  ): Promise<CompareRoutesResult> {
    const args: Record<string, unknown> = { asset, compareBy };
    if (chainFilter) args.chainFilter = chainFilter;
    return this.client.callTool<CompareRoutesResult>(TOOL.compareDepositRoutes, args);
  }

  lifecycleFlow(flowId: string): Promise<LifecycleResult> {
    return this.client.callTool<LifecycleResult>(TOOL.lifecycleFlow, { flowId });
  }

  lifecycleByTx(
    txHash: string,
    lookupKind: "source" | "any" = "any",
  ): Promise<LifecycleResult> {
    return this.client.callTool<LifecycleResult>(TOOL.lifecycleFlowByTx, {
      txHash,
      lookupKind,
    });
  }

  explainTransaction(
    txHash: string,
    lookupKind: "source" | "any" = "any",
  ): Promise<LifecycleResult> {
    return this.client.callTool<LifecycleResult>(TOOL.explainTransaction, {
      txHash,
      lookupKind,
    });
  }
}
