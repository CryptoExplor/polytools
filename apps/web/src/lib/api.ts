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
  HeatmapResult,
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

export interface HealthInfo {
  ok: boolean;
  service: string;
  now: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly detail?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function get<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
): Promise<T> {
  const qs = new URLSearchParams();
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") qs.set(k, String(v));
    }
  }
  const queryStr = qs.toString();
  const url = `${API_BASE}/api${path}${queryStr ? `?${queryStr}` : ""}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) {
    let msg = `${res.status}`;
    let code: string | undefined;
    let detail: string | undefined;
    try {
      const body = await res.json();
      if (typeof body?.error === "string") code = body.error;
      if (typeof body?.detail === "string") detail = body.detail;
      if (code && detail) {
        msg = `${code}: ${detail}`;
      } else if (detail) {
        msg = detail;
      } else if (code) {
        msg = code;
      }
    } catch {
      /* keep HTTP status */
    }
    throw new ApiError(msg, res.status, code, detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  health: () => get<HealthInfo>("/health").catch(() => null),
  env: () => get<EnvInfo>("/env").catch(() => null),
  markets: () => get<SpotMarketsResult>("/markets"),
  overview: (symbols?: string[]) =>
    get<MarketOverviewResult>("/overview", { symbols: symbols?.join(",") }),
  orderbook: (symbol: string, depth = 50) =>
    get<OrderbookResult>("/orderbook", { symbol, depth }),
  candles: (
    symbol: string,
    tf: string,
    limit = 140,
    startTsSec?: number,
    endTsSec?: number,
  ) => get<CandlesResult>("/candles", { symbol, tf, limit, startTsSec, endTsSec }),
  trades: (symbol: string, limit = 50, side?: "buy" | "sell") =>
    get<RecentTradesResult>("/trades", { symbol, limit, side }),
  heatmap: (
    symbol: string,
    interval: "1s" | "1m" | "5m" | "1h" = "1m",
    depth: 1 | 5 | 10 | 20 | 50 | 100 = 50,
    windowSec?: number,
    limit?: number,
  ) => get<HeatmapResult>("/heatmap", { symbol, interval, depth, windowSec, limit }),
  zipperConfig: () => get<DepositWithdrawConfig>("/zipper/config"),
  zipperRoutes: (asset: string, chainFilter?: string) =>
    get<AssetRoutesResult>("/zipper/routes", { asset, chainFilter }),
  zipperCompare: (
    asset: string,
    compareBy: "networkFee" | "depositMinAmount",
    chainFilter?: string,
  ) => get<CompareRoutesResult>("/zipper/compare", { asset, compareBy, chainFilter }),
  flow: (flowId: string) => get<LifecycleResult>("/flow", { flowId }),
  flowByTx: (txHash: string, lookupKind: "source" | "any" = "any") =>
    get<LifecycleResult>("/flow/by-tx", { txHash, lookupKind }),
  flowExplain: (txHash: string, lookupKind: "source" | "any" = "any") =>
    get<LifecycleResult>("/flow/explain", { txHash, lookupKind }),
};
