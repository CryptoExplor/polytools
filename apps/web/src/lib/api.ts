/**
 * Browser-side API client — talks to OUR backend facade (same origin by
 * default), never to the MCP endpoint directly (it doesn't allow browser CORS).
 *
 * For a GitHub-Pages-only deploy, build with:
 *   VITE_API_BASE=https://<your-worker>.workers.dev npm run build
 * and every request goes to the standalone worker instead.
 */

import type {
  AssetRoutesResult,
  CandlesResult,
  CompareRoutesResult,
  DepositWithdrawConfig,
  LifecycleResult,
  MarketOverviewResult,
  OrderbookResult,
  RecentTradesResult,
  SpotMarketsResult,
} from "@poly/core";

export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/+$/, "") ?? "";

export interface EnvInfo {
  ok: boolean;
  mcpConfigured: boolean;
  networks: {
    testnet: { mcpConfigured: boolean };
    mainnet: { mcpConfigured: boolean; note: string };
  };
  cache: { keys: number; inFlight: number };
}

async function get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const qs = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    }
  }
  const res = await fetch(`${API_BASE}/api${path}?${qs}`, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch { /* keep status */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  env: () => get<EnvInfo>("/env").catch(() => null),
  markets: () => get<SpotMarketsResult>("/markets"),
  overview: (symbols?: string[]) =>
    get<MarketOverviewResult>("/overview", { symbols: symbols?.join(",") }),
  orderbook: (symbol: string, depth = 50) =>
    get<OrderbookResult>("/orderbook", { symbol, depth }),
  candles: (symbol: string, tf: string, limit = 140) =>
    get<CandlesResult>("/candles", { symbol, tf, limit }),
  trades: (symbol: string, limit = 50, side?: "buy" | "sell") =>
    get<RecentTradesResult>("/trades", { symbol, limit, side }),
  zipperConfig: () => get<DepositWithdrawConfig>("/zipper/config"),
  zipperRoutes: (asset: string, chainFilter?: string) =>
    get<AssetRoutesResult>("/zipper/routes", { asset, chainFilter }),
  zipperCompare: (asset: string, compareBy: "networkFee" | "depositMinAmount") =>
    get<CompareRoutesResult>("/zipper/compare", { asset, compareBy }),
  flow: (flowId: string) => get<LifecycleResult>("/flow", { flowId }),
  flowByTx: (txHash: string) => get<LifecycleResult>("/flow/by-tx", { txHash }),
  flowExplain: (txHash: string) => get<LifecycleResult>("/flow/explain", { txHash }),
};
