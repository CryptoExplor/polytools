/**
 * Network configuration — the SINGLE place that knows about environments.
 *
 * Testnet is live today. Mainnet is not public yet: when it launches,
 * fill in the mainnet URLs (or set them via env at build/deploy time).
 * Every tool in this repo is network-agnostic; the UI badge is data-driven
 * by the `apiEnv` field returned in every payload, not by this config.
 */

export interface NetworkConfig {
  id: "testnet" | "mainnet";
  label: string;
  /** Public read-only MCP endpoint (Fabric Labs hosted). */
  mcpUrl: string;
  /** Official web app for deep links. */
  appUrl: string;
  /** Docs root. */
  docsUrl: string;
}

export const NETWORKS: Record<"testnet" | "mainnet", NetworkConfig> = {
  testnet: {
    id: "testnet",
    label: "Testnet",
    mcpUrl: "https://polyester-mcp-testnet.fabriclabs.workers.dev/mcp",
    appUrl: "https://testnet.polyester.com",
    docsUrl: "https://testnet.polyester.com/docs",
  },
  mainnet: {
    id: "mainnet",
    label: "Mainnet",
    // TODO(mainnet): replace with the official mainnet MCP endpoint when announced.
    // Until then, builds keep pointing at testnet (UI shows a clear badge).
    mcpUrl: "",
    appUrl: "https://polyester.com",
    docsUrl: "https://polyester.com/docs",
  },
};

export type NetworkId = keyof typeof NETWORKS;

/**
 * Resolve the MCP URL for a network, allowing env overrides everywhere
 * (Vite build env, worker env vars, or explicit argument).
 */
export function resolveMcpUrl(
  network: NetworkId = "testnet",
  override?: string | null,
): string {
  if (override && override.trim()) return override.trim();
  return NETWORKS[network].mcpUrl;
}

/** MCP tool names, kept as constants so renames are one-line fixes. */
export const TOOL = {
  searchDocs: "search_docs",
  depositWithdrawConfig: "get_deposit_withdraw_config",
  listAssetRoutes: "list_asset_routes",
  compareDepositRoutes: "compare_deposit_routes",
  spotMarkets: "get_spot_markets",
  marketOverview: "get_market_overview",
  lifecycleFlow: "get_lifecycle_flow",
  lifecycleFlowByTx: "get_lifecycle_flow_by_tx",
  explainTransaction: "explain_transaction",
  orderbook: "get_orderbook",
  candles: "get_candles",
  recentTrades: "get_recent_trades",
  heatmap: "get_heatmap",
} as const;

export type ToolName = (typeof TOOL)[keyof typeof TOOL];

export const CANDLE_TIMEFRAMES = [
  "1s", "1m", "5m", "15m", "30m", "1h", "4h", "12h", "1d", "1w", "1mo",
] as const;

export type CandleTimeframe = (typeof CANDLE_TIMEFRAMES)[number];

export const BOOK_DEPTHS = [1, 5, 10, 20, 50, 100] as const;
export type BookDepth = (typeof BOOK_DEPTHS)[number];
