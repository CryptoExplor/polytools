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
  new URL("../../docs/wire-samples", import.meta.url),
);

function readWireSample(file: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(`${wireSamplesDir}/${file}`, "utf8");
    const parsed = JSON.parse(raw) as {
      result?: { structuredContent?: Record<string, unknown> };
      structuredContent?: Record<string, unknown>;
    };
    const data =
      parsed?.result?.structuredContent ??
      parsed?.structuredContent ??
      (parsed as Record<string, unknown>);
    return { ...data, dataSource: "wire-samples" };
  } catch {
    return null;
  }
}

function devWireSampleFallback(url: URL): { status: number; body: unknown } | null {
  const p = url.pathname.replace(/\/+$/, "") || "/";
  const q = url.searchParams;

  if (p === "/api/markets") {
    const d = readWireSample("get_spot_markets.json");
    return d ? { status: 200, body: d } : null;
  }
  if (p === "/api/overview") {
    const d = readWireSample("get_market_overview.json");
    return d ? { status: 200, body: d } : null;
  }
  if (p === "/api/orderbook") {
    const d = readWireSample("get_orderbook.json");
    if (!d) return null;
    const symbol = q.get("symbol") ?? (d.symbol as string) ?? "BTC-USDT";
    const depth = Number(q.get("depth") ?? d.depth ?? 20);
    return { status: 200, body: { ...d, symbol, depth } };
  }
  if (p === "/api/candles") {
    const d = readWireSample("get_candles.json");
    if (!d) return null;
    const symbol = q.get("symbol") ?? (d.symbol as string) ?? "BTC-USDT";
    const timeframe = q.get("tf") ?? q.get("timeframe") ?? (d.timeframe as string) ?? "1h";
    return { status: 200, body: { ...d, symbol, timeframe } };
  }
  if (p === "/api/trades") {
    const d = readWireSample("get_recent_trades.json");
    if (!d) return null;
    const symbol = q.get("symbol") ?? (d.symbol as string) ?? "BTC-USDT";
    const side = q.get("side");
    const allTrades = Array.isArray(d.trades) ? d.trades : [];
    const trades =
      side === "buy" || side === "sell"
        ? allTrades.filter((t: any) => t?.sideLabel === side)
        : allTrades;
    return {
      status: 200,
      body: { ...d, symbol, trades, tradeCount: trades.length },
    };
  }
  if (p === "/api/heatmap") {
    const d = readWireSample("get_heatmap.json");
    if (!d) return null;
    const symbol = q.get("symbol") ?? (d.symbol as string) ?? "BTC-USDT";
    const interval = q.get("interval") ?? (d.interval as string) ?? "1m";
    const depth = Number(q.get("depth") ?? d.depth ?? 50);
    return { status: 200, body: { ...d, symbol, interval, depth } };
  }
  if (p === "/api/zipper/config") {
    const d = readWireSample("get_deposit_withdraw_config.json");
    return d ? { status: 200, body: d } : null;
  }
  if (p === "/api/zipper/routes") {
    const cfg = readWireSample("get_deposit_withdraw_config.json") as any;
    const asset = q.get("asset") ?? "USDT";
    const chainFilter = q.get("chainFilter");
    const assetCfg = Array.isArray(cfg?.assets)
      ? cfg.assets.find((a: any) => a?.asset === asset)
      : null;
    if (assetCfg && Array.isArray(assetCfg.variants)) {
      const routes = assetCfg.variants
        .filter((v: any) => !chainFilter || v.chain === chainFilter || v.chainCode === chainFilter)
        .map((v: any) => ({ asset, ...v }));
      return {
        status: 200,
        body: {
          apiEnv: cfg.apiEnv ?? "testnet",
          asset,
          chainFilter: chainFilter ?? null,
          routes,
          dataSource: "wire-samples",
        },
      };
    }
    const d = readWireSample("list_asset_routes.json");
    return d ? { status: 200, body: { ...d, asset } } : null;
  }
  if (p === "/api/zipper/compare") {
    const cfg = readWireSample("get_deposit_withdraw_config.json") as any;
    const asset = q.get("asset") ?? "USDT";
    const compareBy =
      q.get("compareBy") === "depositMinAmount" ? "depositMinAmount" : "networkFee";
    const assetCfg = Array.isArray(cfg?.assets)
      ? cfg.assets.find((a: any) => a?.asset === asset)
      : null;
    if (assetCfg && Array.isArray(assetCfg.variants)) {
      const routes = assetCfg.variants
        .map((v: any) => ({ asset, ...v }))
        .sort(
          (a: any, b: any) =>
            Number(a[compareBy] ?? 0) - Number(b[compareBy] ?? 0),
        );
      return {
        status: 200,
        body: {
          apiEnv: cfg.apiEnv ?? "testnet",
          asset,
          chainFilter: null,
          compareBy,
          routes,
          dataSource: "wire-samples",
        },
      };
    }
    const d = readWireSample("compare_deposit_routes.json");
    return d ? { status: 200, body: { ...d, asset, compareBy } } : null;
  }
  if (p === "/api/flow" || p === "/api/flow/by-tx" || p === "/api/flow/explain") {
    const txHash = q.get("txHash") ?? "";
    const flowId = q.get("flowId") ?? "";
    if (p === "/api/flow") {
      const validFlowId =
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
          flowId,
        ) || /^flow[_-][a-zA-Z0-9_-]{6,}$/.test(flowId);
      if (!validFlowId) {
        return {
          status: 400,
          body: {
            error: "invalid_argument",
            detail:
              "validation error: invalid flowId format (expected UUID or flow identifier)",
          },
        };
      }
      return {
        status: 200,
        body: {
          apiEnv: "testnet",
          found: false,
          flowId,
          flow: null,
          summary: "No public deposit/withdrawal flow indexed for this flowId.",
          dataSource: "wire-samples",
        },
      };
    }
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      return {
        status: 400,
        body: {
          error: "invalid_argument",
          detail:
            "validation error: invalid txHash format (expected 0x-prefixed 32-byte hex hash)",
        },
      };
    }
    return {
      status: 200,
      body: {
        apiEnv: "testnet",
        found: false,
        txHash,
        lookupKind: q.get("lookupKind") ?? "any",
        matchCount: 0,
        matches: [],
        primaryFlowId: null,
        summary: "No public deposit/withdrawal flow indexed for this transaction hash.",
        explanation:
          "Polyester has no public Zipper bridge flow indexed for this hash. That does not mean an on-chain transaction failed.",
        dataSource: "wire-samples",
      },
    };
  }
  return null;
}

/**
 * Dev-only: mount the SAME backend handler used by every production adapter
 * inside the Vite dev server, so `npm run dev` is a full-stack preview
 * with zero extra processes. Requests to /api/* never leave the sandbox.
 */
function devApiPlugin(): Plugin {
  return {
    name: "poly-dev-api",
    configureServer(server) {
      server.middlewares.use(
        "/api",
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          void (async () => {
            try {
              const { api } = (await server.ssrLoadModule(handlerModule)) as {
                api: (
                  r: Request,
                  o?: { env?: Record<string, string | undefined> },
                ) => Promise<Response>;
              };
              const path = `/api${req.url ?? "/"}`;
              const webReq = new Request(`http://localhost${path}`, {
                method: req.method ?? "GET",
              });
              const webRes = await api(webReq, { env: process.env });
              if (webRes.status === 502) {
                const fb = devWireSampleFallback(new URL(webReq.url));
                if (fb) {
                  res.statusCode = fb.status;
                  res.setHeader("Content-Type", "application/json; charset=utf-8");
                  res.end(JSON.stringify(fb.body));
                  return;
                }
              }
              res.statusCode = webRes.status;
              webRes.headers.forEach((v, k) => res.setHeader(k, v));
              res.end(Buffer.from(await webRes.arrayBuffer()));
            } catch (err) {
              res.statusCode = 502;
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
