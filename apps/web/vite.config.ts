import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { WIRE_SAMPLE_DATA_SOURCE, WIRE_SAMPLE_HEADER } from "./src/lib/provenance";
import {
  META_CONTENT_SECURITY_POLICY,
  REFERRER_POLICY,
} from "../../packages/core/src/deploymentSecurity";

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
    return { ...data, dataSource: WIRE_SAMPLE_DATA_SOURCE };
  } catch {
    return null;
  }
}

export function devWireSampleFallback(url: URL): { status: number; body: unknown } | null {
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
          dataSource: WIRE_SAMPLE_DATA_SOURCE,
        },
      };
    }
    const d = readWireSample("list_asset_routes.json");
    return d ? { status: 200, body: { ...d, asset } } : null;
  }
  if (p === "/api/zipper/compare") {
    const cfg = readWireSample("get_deposit_withdraw_config.json") as any;
    const asset = q.get("asset") ?? "USDT";
    const chainFilter = q.get("chainFilter");
    const compareBy =
      q.get("compareBy") === "depositMinAmount" ? "depositMinAmount" : "networkFee";
    const assetCfg = Array.isArray(cfg?.assets)
      ? cfg.assets.find((a: any) => a?.asset === asset)
      : null;
    if (assetCfg && Array.isArray(assetCfg.variants)) {
      const routes = assetCfg.variants
        .filter(
          (v: any) =>
            !chainFilter || v.chain === chainFilter || v.chainCode === chainFilter,
        )
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
          chainFilter: chainFilter ?? null,
          compareBy,
          routes,
          dataSource: WIRE_SAMPLE_DATA_SOURCE,
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
          dataSource: WIRE_SAMPLE_DATA_SOURCE,
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
        dataSource: WIRE_SAMPLE_DATA_SOURCE,
      },
    };
  }
  return null;
}

/** Production validation/errors pass through; only upstream 502 may use samples. */
export function devWireSampleFallbackForStatus(
  url: URL,
  productionStatus: number,
): { status: number; body: unknown } | null {
  return productionStatus === 502 ? devWireSampleFallback(url) : null;
}

export function injectProductionSecurityMeta(html: string): string {
  if (/http-equiv=["']Content-Security-Policy["']/i.test(html)) return html;
  const tags = [
    `    <meta http-equiv="Content-Security-Policy" content="${META_CONTENT_SECURITY_POLICY}" />`,
    `    <meta name="referrer" content="${REFERRER_POLICY}" />`,
  ].join("\n");
  const charset = /<meta\s+charset\s*=\s*["'][^"']+["'][^>]*>/i;
  if (charset.test(html)) {
    return html.replace(charset, (tag) => `${tag}\n${tags}`);
  }
  return html.replace(/<head\b[^>]*>/i, (tag) => `${tag}\n${tags}`);
}

/** Static meta fallback only; supported platforms must send real headers. */
export function productionSecurityMetaPlugin(): Plugin {
  return {
    name: "poly-production-security-meta",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler: injectProductionSecurityMeta,
    },
  };
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
              // Forward the body and headers. This middleware used to build a
              // Request from the method alone, so any POST arrived with an
              // empty body and no Origin/Content-Type/Sec-Fetch-Site — every
              // POST route worked in production and could never work in dev.
              // Cap before buffering: the handler's own limit is checked after
              // the body is in memory. Dev only, but a laptop should not be the
              // place an unbounded upload is discovered.
              const MAX_DEV_BODY = 1_048_576;
              const declared = Number(req.headers["content-length"] ?? "0");
              if (Number.isFinite(declared) && declared > MAX_DEV_BODY) {
                res.statusCode = 413;
                res.setHeader("Content-Type", "application/json");
                res.end(JSON.stringify({ error: "payload_too_large" }));
                return;
              }
              const chunks: Buffer[] = [];
              let buffered = 0;
              for await (const chunk of req) {
                buffered += (chunk as Buffer).length;
                if (buffered > MAX_DEV_BODY) {
                  res.statusCode = 413;
                  res.setHeader("Content-Type", "application/json");
                  res.end(JSON.stringify({ error: "payload_too_large" }));
                  return;
                }
                chunks.push(chunk as Buffer);
              }
              const raw = Buffer.concat(chunks);
              const headers = new Headers();
              for (const [name, value] of Object.entries(req.headers)) {
                if (!value) continue;
                // Rewritten by Request, or derived from the buffered body.
                if (name === "host" || name === "connection" || name === "content-length") continue;
                headers.set(name, Array.isArray(value) ? value.join(", ") : value);
              }
              const webReq = new Request(`http://localhost${path}`, {
                method: req.method ?? "GET",
                headers,
                body: raw.length > 0 ? raw : undefined,
              });
              const webRes = await api(webReq, { env: process.env });
              const fb = devWireSampleFallbackForStatus(new URL(webReq.url), webRes.status);
              if (fb) {
                res.statusCode = fb.status;
                res.setHeader("Content-Type", "application/json; charset=utf-8");
                res.setHeader(WIRE_SAMPLE_HEADER, WIRE_SAMPLE_DATA_SOURCE);
                res.end(JSON.stringify(fb.body));
                return;
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
  plugins: [react(), devApiPlugin(), productionSecurityMetaPlugin()],
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
