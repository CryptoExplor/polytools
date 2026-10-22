import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";

const coreSrc = fileURLToPath(
  new URL("../../packages/core/src/index.ts", import.meta.url),
);
const handlerModule = fileURLToPath(
  new URL("../../backend/src/handler.ts", import.meta.url),
);
const wireSamplesDir = fileURLToPath(
  new URL("../../docs/wire-samples/", import.meta.url),
);

function loadWireSample<T = any>(filename: string): T {
  const raw = readFileSync(`${wireSamplesDir}${filename}`, "utf8");
  const parsed = JSON.parse(raw);
  return (parsed?.result?.structuredContent ?? parsed) as T;
}

/**
 * Fallback responder using the repository's captured Polyester testnet wire
 * samples (`docs/wire-samples/*.json`) when the dev sandbox blocks outbound
 * network egress to the upstream MCP server (returning HTTP 502).
 */
function serveWireSampleFallback(url: URL): { status: number; body: unknown } | null {
  const route = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  const q = url.searchParams;

  switch (route) {
    case "markets": {
      return { status: 200, body: loadWireSample("get_spot_markets.json") };
    }
    case "overview": {
      const sample = loadWireSample<{
        apiEnv: string;
        count: number;
        markets: Array<{ symbol: string; [k: string]: unknown }>;
      }>("get_market_overview.json");
      const rawSymbols = q.get("symbols");
      if (rawSymbols) {
        const wanted = new Set(
          rawSymbols
            .split(",")
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean),
        );
        const filtered = sample.markets.filter((m) =>
          wanted.has(m.symbol.toUpperCase()),
        );
        return {
          status: 200,
          body: {
            ...sample,
            count: filtered.length,
            markets: filtered.length > 0 ? filtered : sample.markets.slice(0, 1),
          },
        };
      }
      return { status: 200, body: sample };
    }
    case "orderbook": {
      const sample = loadWireSample<{
        apiEnv: string;
        symbol: string;
        bookSeq: number;
        bestBid: unknown;
        bestAsk: unknown;
        bidCount: number;
        askCount: number;
        bids: unknown[];
        asks: unknown[];
      }>("get_orderbook.json");
      const symbol = q.get("symbol")?.trim() || sample.symbol;
      const depth = Math.min(200, Math.max(1, Number(q.get("depth")) || 50));
      const bids = sample.bids.slice(0, depth);
      const asks = sample.asks.slice(0, depth);
      return {
        status: 200,
        body: {
          ...sample,
          symbol,
          bidCount: bids.length,
          askCount: asks.length,
          bids,
          asks,
        },
      };
    }
    case "candles": {
      const sample = loadWireSample<{
        apiEnv: string;
        symbol: string;
        timeframe: string;
        candleCount: number;
        candles: unknown[];
      }>("get_candles.json");
      const symbol = q.get("symbol")?.trim() || sample.symbol;
      const timeframe = q.get("timeframe")?.trim() || sample.timeframe;
      const limit = Math.min(500, Math.max(1, Number(q.get("limit")) || 120));
      const candles = sample.candles.slice(-limit);
      return {
        status: 200,
        body: {
          ...sample,
          symbol,
          timeframe,
          candleCount: candles.length,
          candles,
        },
      };
    }
    case "trades": {
      const sample = loadWireSample<{
        apiEnv: string;
        symbol: string;
        tradeCount: number;
        trades: unknown[];
      }>("get_recent_trades.json");
      const symbol = q.get("symbol")?.trim() || sample.symbol;
      const limit = Math.min(200, Math.max(1, Number(q.get("limit")) || 50));
      const trades = sample.trades.slice(0, limit);
      return {
        status: 200,
        body: {
          ...sample,
          symbol,
          tradeCount: trades.length,
          trades,
        },
      };
    }
    case "heatmap": {
      const sample = loadWireSample<{
        apiEnv: string;
        symbol: string;
        [k: string]: unknown;
      }>("get_heatmap.json");
      const symbol = q.get("symbol")?.trim() || sample.symbol;
      return {
        status: 200,
        body: { ...sample, symbol },
      };
    }
    case "zipper/config": {
      return {
        status: 200,
        body: loadWireSample("get_deposit_withdraw_config.json"),
      };
    }
    case "zipper/routes": {
      const cfg = loadWireSample<{
        apiEnv: string;
        assets: Array<{
          asset: string;
          variants: Array<{
            chain: string;
            chainCode: string;
            chainId: number;
            isNativeAsset: boolean;
            networkFee: string;
            depositMinAmount: string;
            withdrawMinAmount: string;
          }>;
        }>;
      }>("get_deposit_withdraw_config.json");
      const assetParam = (q.get("asset") ?? "USDT").trim();
      const found =
        cfg.assets.find(
          (a) => a.asset.toLowerCase() === assetParam.toLowerCase(),
        ) ?? cfg.assets[0];
      const routes = (found?.variants ?? []).map((v) => ({
        asset: found.asset,
        ...v,
      }));
      return {
        status: 200,
        body: {
          apiEnv: cfg.apiEnv,
          asset: found?.asset ?? assetParam,
          routeCount: routes.length,
          routes,
        },
      };
    }
    case "zipper/compare": {
      const cfg = loadWireSample<{
        apiEnv: string;
        assets: Array<{
          asset: string;
          variants: Array<{
            chain: string;
            chainCode: string;
            chainId: number;
            isNativeAsset: boolean;
            networkFee: string;
            depositMinAmount: string;
            withdrawMinAmount: string;
          }>;
        }>;
      }>("get_deposit_withdraw_config.json");
      const assetParam = (q.get("asset") ?? "USDT").trim();
      const compareBy =
        q.get("compareBy") === "depositMinAmount"
          ? "depositMinAmount"
          : "networkFee";
      const found =
        cfg.assets.find(
          (a) => a.asset.toLowerCase() === assetParam.toLowerCase(),
        ) ?? cfg.assets[0];
      const baseRoutes = (found?.variants ?? []).map((v) => ({
        asset: found.asset,
        ...v,
      }));
      const byFee = [...baseRoutes].sort(
        (a, b) => Number(a.networkFee) - Number(b.networkFee),
      );
      const byMin = [...baseRoutes].sort(
        (a, b) => Number(a.depositMinAmount) - Number(b.depositMinAmount),
      );
      const sorted = compareBy === "depositMinAmount" ? byMin : byFee;
      return {
        status: 200,
        body: {
          apiEnv: cfg.apiEnv,
          asset: found?.asset ?? assetParam,
          compareBy,
          routeCount: sorted.length,
          cheapestByNetworkFee: byFee[0] ?? null,
          cheapestByDepositMin: byMin[0] ?? null,
          routes: sorted,
        },
      };
    }
    case "flow":
    case "flow/by-tx":
    case "flow/explain": {
      return {
        status: 404,
        body: {
          error:
            "Transaction not found in captured testnet wire samples (sandbox outbound MCP egress is restricted).",
        },
      };
    }
    default:
      return null;
  }
}

/**
 * Dev-only: mount the SAME backend handler used by every production adapter
 * inside the Vite dev server, so `npm run dev` is a full-stack preview
 * with zero extra processes. Requests to /api/* never leave the sandbox.
 * When running in a firewall-restricted sandbox where outbound MCP calls fail
 * with 502, falls back to the repository's captured wire samples.
 */
function devApiPlugin(): Plugin {
  let upstreamOfflineUntil = 0;

  return {
    name: "poly-dev-api",
    configureServer(server) {
      server.middlewares.use(
        "/api",
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          void (async () => {
            const path = `/api${req.url ?? "/"}`;
            const reqUrl = new URL(`http://localhost${path}`);
            try {
              const now = Date.now();
              const isLocalRoute =
                reqUrl.pathname === "/api/health" ||
                reqUrl.pathname === "/api/env";

              if (!isLocalRoute && now < upstreamOfflineUntil) {
                const fallback = serveWireSampleFallback(reqUrl);
                if (fallback) {
                  res.statusCode = fallback.status;
                  res.setHeader("Content-Type", "application/json; charset=utf-8");
                  res.setHeader("X-Poly-Data-Source", "wire-samples");
                  res.end(JSON.stringify(fallback.body));
                  return;
                }
              }

              const { api } = (await server.ssrLoadModule(handlerModule)) as {
                api: (
                  r: Request,
                  o?: { env?: Record<string, string | undefined> },
                ) => Promise<Response>;
              };
              const webReq = new Request(reqUrl.toString(), {
                method: req.method ?? "GET",
              });
              const webRes = await api(webReq, { env: process.env });

              if (webRes.status === 502) {
                upstreamOfflineUntil = Date.now() + 30_000;
                const fallback = serveWireSampleFallback(reqUrl);
                if (fallback) {
                  res.statusCode = fallback.status;
                  res.setHeader("Content-Type", "application/json; charset=utf-8");
                  res.setHeader("X-Poly-Data-Source", "wire-samples");
                  res.end(JSON.stringify(fallback.body));
                  return;
                }
              }

              res.statusCode = webRes.status === 502 ? 503 : webRes.status;
              webRes.headers.forEach((v, k) => res.setHeader(k, v));
              res.end(Buffer.from(await webRes.arrayBuffer()));
            } catch (err) {
              const fallback = serveWireSampleFallback(reqUrl);
              if (fallback) {
                res.statusCode = fallback.status;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.setHeader("X-Poly-Data-Source", "wire-samples");
                res.end(JSON.stringify(fallback.body));
                return;
              }
              res.statusCode = 503;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: String(err) }));
            }
          })().catch(next);
        },
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), devApiPlugin()],
  resolve: {
    alias: { "@poly/core": coreSrc },
  },
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: true,
    port: 4173,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
