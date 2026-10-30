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
 * Routes (GET unless noted):
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
 *
 *   POST /api/auth/challenge   wallet login: obtain the message to sign
 *   POST /api/auth/login       wallet login: exchange a signature for a token
 *                              (same-origin only, never cached, never logged)
 */

import {
  BOOK_DEPTHS,
  CANDLE_TIMEFRAMES,
  McpError,
  NETWORKS,
  resolveMcpUrl,
  type BookDepth,
  type CandleTimeframe,
} from "../../packages/core/src/index";
import { applySecurityHeaders } from "../../packages/core/src/deploymentSecurity";
import { cached, cacheStats } from "./cache";
import { dataFor } from "./mcpServer";
import { deriveSmartAccount, handleAuthRoute, isAuthPath } from "./authProxy";
import { fetchOnchainBalances } from "./onchainBalances";

export interface ApiOptions {
  /** Platform env vars (Cloudflare bindings / process.env). */
  env?: Record<string, string | undefined>;
  /** Injected in tests so a route never has to reach the network for real. */
  fetch?: typeof fetch;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const VALID_DEPTHS = new Set<number>(BOOK_DEPTHS);
const VALID_TIMEFRAMES = new Set<string>(CANDLE_TIMEFRAMES);
const VALID_HEATMAP_INTERVALS = new Set<string>(["1s", "1m", "5m", "1h"]);
const VALID_SIDES = new Set<string>(["buy", "sell"]);
const VALID_COMPARE_BY = new Set<string>(["networkFee", "depositMinAmount"]);
const VALID_LOOKUP_KIND = new Set<string>(["source", "any"]);

/**
 * Resolve the primary endpoint, honoring a mainnet-only deployment override.
 *
 * A blank value must count as absent. `??` alone selects an empty `MCP_URL`
 * (a common way to leave a var "declared but unset" in wrangler.toml), which
 * then resolves to the testnet default and silently wins over a valid
 * `MCP_URL_MAINNET` — so the deployment would keep serving testnet data.
 */
export function resolveBackendMcpUrl(env?: Record<string, string | undefined>): string {
  const primary = env?.MCP_URL?.trim();
  if (primary) return resolveMcpUrl("testnet", primary);
  const mainnet = env?.MCP_URL_MAINNET?.trim();
  if (mainnet) return resolveMcpUrl("mainnet", mainnet);
  return resolveMcpUrl("testnet");
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function json(body: unknown, init: ResponseInit = {}, extra?: Record<string, string>) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  applySecurityHeaders(headers);
  if (extra) for (const [k, v] of Object.entries(extra)) headers.set(k, v);
  return new Response(JSON.stringify(body, null, 0), { ...init, headers });
}

function cachedJson(body: unknown, maxAgeSec: number) {
  return json(body, {}, { "Cache-Control": `public, max-age=${maxAgeSec}` });
}

function error(status: number, code: string, detail?: string) {
  return json(detail ? { error: code, detail } : { error: code }, { status });
}

const num = (
  name: string,
  v: string | null,
  dflt: number,
  min: number,
  max: number,
): number => {
  if (v === null || v.trim() === "") return dflt;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new ValidationError(`${name} must be a valid number`);
  }
  return Math.min(max, Math.max(min, Math.trunc(n)));
};

const optNum = (
  name: string,
  v: string | null,
  min: number,
  max: number,
): number | undefined => {
  if (v === null || v.trim() === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new ValidationError(`${name} must be a valid number`);
  }
  return Math.min(max, Math.max(min, Math.trunc(n)));
};

const str = (v: string | null): string | undefined => {
  if (v === null) return undefined;
  const trimmed = v.trim();
  return trimmed !== "" ? trimmed : undefined;
};

const isValidTxHash = (txHash: string): boolean =>
  /^0x[0-9a-fA-F]{64}$/.test(txHash);

const isValidFlowId = (flowId: string): boolean =>
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    flowId,
  ) || /^flow[_-][a-zA-Z0-9_-]{6,128}$/.test(flowId);

export async function api(request: Request, opts: ApiOptions = {}): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  // Wallet login is the only non-GET surface, and it is deliberately narrow:
  // two fixed paths, same-origin only, no account state. See authProxy.ts.
  if (isAuthPath(path)) return handleAuthRoute(request, path, opts);

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: applySecurityHeaders(new Headers(CORS_HEADERS)),
    });
  }
  if (request.method !== "GET") return error(405, "Method not allowed");

  // ---- environment resolution -------------------------------------------------
  const mcpUrl = resolveBackendMcpUrl(opts.env);

  // ---- meta routes -------------------------------------------------------------
  if (path === "/api" || path === "/api/health") {
    return json({ ok: true, service: "poly-tools-backend", now: Date.now() });
  }
  // Read-only address lookup. Deriving a smart-account address from an owner EOA
  // is a pure computation — no signature, no token, no exchange call — so a user
  // can see their own on-chain account without a login the exchange may never
  // grant. It reveals nothing that the chain does not already publish.
  if (path === "/api/account/address") {
    const signer = (url.searchParams.get("signer") ?? "").trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(signer)) {
      return error(400, "invalid_signer_address");
    }
    const smartAccountAddress = await deriveSmartAccount(signer);
    if (!smartAccountAddress) {
      // The SDK is unavailable in this runtime; say so rather than guessing.
      return error(503, "smart_account_derivation_unavailable");
    }
    return json(
      { signerAddress: signer, smartAccountAddress },
      {},
      // Deterministic for an EOA, and public data. Safe to cache briefly.
      { "Cache-Control": "public, max-age=300" },
    );
  }
  // On-chain funding balances for a smart account. Read-only, no session: the
  // exchange never grants third-party login, and this part of the account view is
  // public chain data anyway. Proxied so the browser only talks to /api.
  if (path === "/api/account/balances") {
    const address = (url.searchParams.get("address") ?? "").trim();
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return error(400, "invalid_address");
    }
    const result = await fetchOnchainBalances(address, { fetchImpl: opts.fetch });
    if (!result.ok) return error(result.status, result.code, result.detail);
    return json(
      { address: result.address, balances: result.balances },
      {},
      // Chain state changes slowly and the explorer is rate-limited; a short
      // shared cache also keeps us from hammering a public service.
      { "Cache-Control": "public, max-age=30" },
    );
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
        return cachedJson(
          await cached("markets", 60_000, () => data.spotMarkets()),
          60,
        );

      case "/api/overview": {
        const symbols = str(url.searchParams.get("symbols"))
          ?.split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        const limit = num("limit", url.searchParams.get("limit"), 100, 1, 200);
        const key = `overview:${symbols?.join(",") ?? "*"}:${limit}`;
        return cachedJson(
          await cached(key, 2_000, () => data.marketOverview(symbols, limit)),
          2,
        );
      }

      case "/api/orderbook": {
        const symbol = str(url.searchParams.get("symbol"));
        if (!symbol) return error(400, "invalid_argument", "symbol is required");
        const rawDepth = str(url.searchParams.get("depth"));
        let depth: BookDepth = 20;
        if (rawDepth !== undefined) {
          const parsed = Number(rawDepth);
          if (!Number.isInteger(parsed) || !VALID_DEPTHS.has(parsed)) {
            return error(
              400,
              "invalid_argument",
              "depth must be one of 1, 5, 10, 20, 50, 100",
            );
          }
          depth = parsed as BookDepth;
        }
        return cachedJson(
          await cached(`book:${symbol}:${depth}`, 1_500, () =>
            data.orderbook(symbol, depth),
          ),
          1,
        );
      }

      case "/api/candles": {
        const symbol = str(url.searchParams.get("symbol"));
        if (!symbol) return error(400, "invalid_argument", "symbol is required");
        const tf =
          str(url.searchParams.get("tf")) ??
          str(url.searchParams.get("timeframe")) ??
          "1h";
        if (!VALID_TIMEFRAMES.has(tf)) {
          return error(
            400,
            "invalid_argument",
            `tf must be one of ${CANDLE_TIMEFRAMES.join(", ")}`,
          );
        }
        const limit = num("limit", url.searchParams.get("limit"), 120, 1, 200);
        const startTsSec = optNum(
          "startTsSec",
          url.searchParams.get("startTsSec"),
          0,
          4_102_444_800,
        );
        const endTsSec = optNum(
          "endTsSec",
          url.searchParams.get("endTsSec"),
          0,
          4_102_444_800,
        );
        if (
          startTsSec !== undefined &&
          endTsSec !== undefined &&
          startTsSec > endTsSec
        ) {
          return error(
            400,
            "invalid_argument",
            "startTsSec must be less than or equal to endTsSec",
          );
        }
        // Quantize timestamp bounds to 60s buckets in cache keys so rolling UI
        // windows reuse cached responses within the TTL window.
        const startBucket =
          startTsSec !== undefined ? Math.floor(startTsSec / 60) * 60 : "*";
        const endBucket =
          endTsSec !== undefined ? Math.floor(endTsSec / 60) * 60 : "*";
        const key = `candles:${symbol}:${tf}:${limit}:${startBucket}:${endBucket}`;
        return cachedJson(
          await cached(key, 3_000, () =>
            data.candles(
              symbol,
              tf as CandleTimeframe,
              limit,
              startTsSec,
              endTsSec,
            ),
          ),
          3,
        );
      }

      case "/api/trades": {
        const symbol = str(url.searchParams.get("symbol"));
        if (!symbol) return error(400, "invalid_argument", "symbol is required");
        const limit = num("limit", url.searchParams.get("limit"), 25, 1, 100);
        const sideRaw = str(url.searchParams.get("side"));
        if (sideRaw !== undefined && !VALID_SIDES.has(sideRaw)) {
          return error(400, "invalid_argument", "side must be buy or sell");
        }
        const side = sideRaw as "buy" | "sell" | undefined;
        return cachedJson(
          await cached(`trades:${symbol}:${limit}:${side ?? "*"}`, 1_200, () =>
            data.recentTrades(symbol, limit, side),
          ),
          1,
        );
      }

      case "/api/heatmap": {
        const symbol = str(url.searchParams.get("symbol"));
        if (!symbol) return error(400, "invalid_argument", "symbol is required");
        const intervalRaw = str(url.searchParams.get("interval")) ?? "1m";
        if (!VALID_HEATMAP_INTERVALS.has(intervalRaw)) {
          return error(
            400,
            "invalid_argument",
            "interval must be one of 1s, 1m, 5m, 1h",
          );
        }
        const interval = intervalRaw as "1s" | "1m" | "5m" | "1h";
        const rawDepth = str(url.searchParams.get("depth"));
        let depth: BookDepth = 50;
        if (rawDepth !== undefined) {
          const parsed = Number(rawDepth);
          if (!Number.isInteger(parsed) || !VALID_DEPTHS.has(parsed)) {
            return error(
              400,
              "invalid_argument",
              "depth must be one of 1, 5, 10, 20, 50, 100",
            );
          }
          depth = parsed as BookDepth;
        }
        const windowSec = optNum(
          "windowSec",
          url.searchParams.get("windowSec"),
          60,
          86_400,
        );
        const limit = optNum("limit", url.searchParams.get("limit"), 1, 500);
        const key = `heat:${symbol}:${interval}:${depth}:${windowSec ?? "*"}:${limit ?? "*"}`;
        return cachedJson(
          await cached(key, 5_000, () =>
            data.heatmap(symbol, interval, depth, windowSec, limit),
          ),
          5,
        );
      }

      // ---- zipper / routes -------------------------------------------------------
      case "/api/zipper/config":
        return cachedJson(
          await cached("zipper:config", 300_000, () => data.depositWithdrawConfig()),
          300,
        );

      case "/api/zipper/routes": {
        const asset = str(url.searchParams.get("asset"));
        if (!asset) return error(400, "invalid_argument", "asset is required");
        const chainFilter = str(url.searchParams.get("chainFilter"));
        return cachedJson(
          await cached(
            `zipper:routes:${asset}:${chainFilter ?? "*"}`,
            300_000,
            () => data.assetRoutes(asset, chainFilter),
          ),
          300,
        );
      }

      case "/api/zipper/compare": {
        const asset = str(url.searchParams.get("asset"));
        if (!asset) return error(400, "invalid_argument", "asset is required");
        const compareByRaw = str(url.searchParams.get("compareBy")) ?? "networkFee";
        if (!VALID_COMPARE_BY.has(compareByRaw)) {
          return error(
            400,
            "invalid_argument",
            "compareBy must be networkFee or depositMinAmount",
          );
        }
        const compareBy = compareByRaw as "networkFee" | "depositMinAmount";
        const chainFilter = str(url.searchParams.get("chainFilter"));
        return cachedJson(
          await cached(
            `zipper:cmp:${asset}:${compareBy}:${chainFilter ?? "*"}`,
            300_000,
            () => data.compareRoutes(asset, compareBy, chainFilter),
          ),
          300,
        );
      }

      // ---- lifecycle -------------------------------------------------------------
      case "/api/flow": {
        const flowId = str(url.searchParams.get("flowId"));
        if (!flowId) return error(400, "invalid_argument", "flowId is required");
        if (!isValidFlowId(flowId)) {
          return error(
            400,
            "invalid_argument",
            "validation error: invalid flowId format (expected UUID or flow identifier)",
          );
        }
        return json(await data.lifecycleFlow(flowId));
      }

      case "/api/flow/by-tx": {
        const txHash = str(url.searchParams.get("txHash"));
        if (!txHash) return error(400, "invalid_argument", "txHash is required");
        if (!isValidTxHash(txHash)) {
          return error(
            400,
            "invalid_argument",
            "validation error: invalid txHash format (expected 0x-prefixed 32-byte hex hash)",
          );
        }
        const lookupKindRaw = str(url.searchParams.get("lookupKind")) ?? "any";
        if (!VALID_LOOKUP_KIND.has(lookupKindRaw)) {
          return error(400, "invalid_argument", "lookupKind must be source or any");
        }
        const limit = optNum("limit", url.searchParams.get("limit"), 1, 50);
        return json(
          await data.lifecycleByTx(
            txHash,
            lookupKindRaw as "source" | "any",
            limit,
          ),
        );
      }

      case "/api/flow/explain": {
        const txHash = str(url.searchParams.get("txHash"));
        if (!txHash) return error(400, "invalid_argument", "txHash is required");
        if (!isValidTxHash(txHash)) {
          return error(
            400,
            "invalid_argument",
            "validation error: invalid txHash format (expected 0x-prefixed 32-byte hex hash)",
          );
        }
        const lookupKindRaw = str(url.searchParams.get("lookupKind")) ?? "any";
        if (!VALID_LOOKUP_KIND.has(lookupKindRaw)) {
          return error(400, "invalid_argument", "lookupKind must be source or any");
        }
        return json(
          await data.explainTransaction(
            txHash,
            lookupKindRaw as "source" | "any",
          ),
        );
      }
    }
  } catch (e) {
    if (e instanceof ValidationError) {
      return error(400, "invalid_argument", e.message);
    }
    if (e instanceof McpError && /^(validation error|invalid)/i.test(e.message)) {
      return error(400, "invalid_argument", e.message.slice(0, 240));
    }
    return error(502, "upstream", "Upstream market data service unavailable");
  }

  return error(404, `Unknown route: ${path}`);
}
