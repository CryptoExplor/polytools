/**
 * THE backend — a single pure Web-API request handler.
 *
 * Every deployment target (Cloudflare Pages Functions, standalone Worker,
 * Vercel Edge/Serverless, Node dev server, Vite dev middleware) is a thin
 * adapter that calls `api(request, opts)`. No framework, no platform APIs.
 *
 * What it does:
 *  - speaks the MCP protocol server-side to the read-only Polyester endpoint
 *  - exposes clean, CORS-open GET JSON endpoints the static frontend can call
 *  - caches hot routes at the edge of the isolate (TTL per endpoint)
 *
 * Routes (all GET):
 *   /api/health
 *   /api/env
 *   /api/markets
 *   /api/overview?symbols=BTC-USDT,ETH-USDT
 *   /api/orderbook?symbol=BTC-USDT&depth=20
 *   /api/candles?symbol=BTC-USDT&tf=1h&limit=120
 *   /api/trades?symbol=BTC-USDT&limit=25&side=buy
 *   /api/heatmap?symbol=BTC-USDT&interval=1m&depth=50
 *   /api/zipper/config
 *   /api/zipper/routes?asset=USDT&chainFilter=arb
 *   /api/zipper/compare?asset=ETH&compareBy=networkFee
 *   /api/flow?flowId=...
 *   /api/flow/by-tx?txHash=...
 *   /api/flow/explain?txHash=...
 */

import { NETWORKS, resolveMcpUrl } from "../../packages/core/src/index";
import { cached, cacheStats } from "./cache";
import { dataFor } from "./mcpServer";

export interface ApiOptions {
  /** Platform env vars (Cloudflare bindings / process.env). */
  env?: Record<string, string | undefined>;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, init: ResponseInit = {}, extra?: Record<string, string>) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  if (extra) for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(JSON.stringify(body, null, 0), { ...init, headers });
}

function error(status: number, message: string) {
  return json({ error: message }, { status });
}

const num = (v: string | null, dflt: number, min: number, max: number): number => {
  const n = v === null ? dflt : Number(v);
  if (!isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.trunc(n)));
};

const str = (v: string | null): string | undefined =>
  v !== null && v !== "" ? v : undefined;

export async function api(request: Request, opts: ApiOptions = {}): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (request.method !== "GET") return error(405, "Method not allowed");

  // ---- environment resolution -------------------------------------------------
  // MCP_URL wins anywhere. When the mainnet endpoint is announced, set
  // MCP_URL_MAINNET (or edit packages/core/src/config.ts) — no other change needed.
  const mcpUrl =
    resolveMcpUrl("testnet", opts.env?.MCP_URL) ||
    resolveMcpUrl("mainnet", opts.env?.MCP_URL_MAINNET);

  // ---- meta routes -------------------------------------------------------------
  if (path === "/api" || path === "/api/health") {
    return json({ ok: true, service: "poly-tools-backend", now: Date.now() });
  }
  if (path === "/api/env") {
    return json({
      ok: true,
      mcpConfigured: Boolean(mcpUrl),
      networks: {
        testnet: { mcpConfigured: Boolean(NETWORKS.testnet.mcpUrl) },
        mainnet: {
          mcpConfigured: Boolean(
            NETWORKS.mainnet.mcpUrl || opts.env?.MCP_URL_MAINNET,
          ),
          note: "Set MCP_URL_MAINNET (or config.ts) when the mainnet endpoint is announced.",
        },
      },
      cache: cacheStats(),
    });
  }

  if (!mcpUrl) return error(503, "No MCP endpoint configured");
  const data = dataFor(mcpUrl);

  // ---- market data routes ------------------------------------------------------
  try {
    switch (path) {
      case "/api/markets":
        return json(await cached("markets", 60_000, () => data.spotMarkets()));

      case "/api/overview": {
        const symbols = str(url.searchParams.get("symbols"))?.split(",");
        const key = `overview:${symbols?.join(",") ?? "*"}`;
        return json(await cached(key, 2_000, () => data.marketOverview(symbols)));
      }

      case "/api/orderbook": {
        const symbol = url.searchParams.get("symbol");
        if (!symbol) return error(400, "symbol is required");
        const depth = num(url.searchParams.get("depth"), 20, 1, 100) as
          | 1 | 5 | 10 | 20 | 50 | 100;
        return json(
          await cached(`book:${symbol}:${depth}`, 1_500, () =>
            data.orderbook(symbol, depth),
          ),
        );
      }

      case "/api/candles": {
        const symbol = url.searchParams.get("symbol");
        if (!symbol) return error(400, "symbol is required");
        const tf = str(url.searchParams.get("tf")) ?? "1h";
        const limit = num(url.searchParams.get("limit"), 120, 1, 500);
        return json(
          await cached(`candles:${symbol}:${tf}:${limit}`, 3_000, () =>
            data.candles(symbol, tf as never, limit),
          ),
        );
      }

      case "/api/trades": {
        const symbol = url.searchParams.get("symbol");
        if (!symbol) return error(400, "symbol is required");
        const limit = num(url.searchParams.get("limit"), 25, 1, 100);
        const side = str(url.searchParams.get("side")) as "buy" | "sell" | undefined;
        return json(
          await cached(`trades:${symbol}:${limit}:${side ?? "*"}`, 1_200, () =>
            data.recentTrades(symbol, limit, side),
          ),
        );
      }

      case "/api/heatmap": {
        const symbol = url.searchParams.get("symbol");
        if (!symbol) return error(400, "symbol is required");
        const interval = (str(url.searchParams.get("interval")) ?? "1m") as
          | "1s" | "1m" | "5m" | "1h";
        const depth = num(url.searchParams.get("depth"), 50, 1, 100);
        return json(
          await cached(`heat:${symbol}:${interval}:${depth}`, 5_000, () =>
            data.heatmap(symbol, interval, depth),
          ),
        );
      }

      // ---- zipper / routes -------------------------------------------------------
      case "/api/zipper/config":
        return json(
          await cached("zipper:config", 300_000, () => data.depositWithdrawConfig()),
        );

      case "/api/zipper/routes": {
        const asset = url.searchParams.get("asset");
        if (!asset) return error(400, "asset is required");
        const chainFilter = str(url.searchParams.get("chainFilter"));
        return json(
          await cached(
            `zipper:routes:${asset}:${chainFilter ?? "*"}`,
            300_000,
            () => data.assetRoutes(asset, chainFilter),
          ),
        );
      }

      case "/api/zipper/compare": {
        const asset = url.searchParams.get("asset");
        if (!asset) return error(400, "asset is required");
        const compareBy = (str(url.searchParams.get("compareBy")) ?? "networkFee") as
          | "networkFee" | "depositMinAmount";
        return json(
          await cached(`zipper:cmp:${asset}:${compareBy}`, 300_000, () =>
            data.compareRoutes(asset, compareBy),
          ),
        );
      }

      // ---- lifecycle -------------------------------------------------------------
      case "/api/flow": {
        const flowId = url.searchParams.get("flowId");
        if (!flowId) return error(400, "flowId is required");
        return json(await data.lifecycleFlow(flowId));
      }

      case "/api/flow/by-tx": {
        const txHash = url.searchParams.get("txHash");
        if (!txHash) return error(400, "txHash is required");
        return json(await data.lifecycleByTx(txHash));
      }

      case "/api/flow/explain": {
        const txHash = url.searchParams.get("txHash");
        if (!txHash) return error(400, "txHash is required");
        return json(await data.explainTransaction(txHash));
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "upstream error";
    return error(502, message);
  }

  return error(404, `Unknown route: ${path}`);
}
