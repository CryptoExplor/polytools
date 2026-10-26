/**
 * Standalone Cloudflare Worker — TWO jobs in one:
 *
 * 1. fetch     → serves the shared `api()` handler. This is THE backend for
 *                GitHub-Pages-hosted frontends (deploy once, point the SPA at it).
 *
 * 2. scheduled → the alert bot (tool: Discord/Telegram price movers).
 *                Every N minutes it scans 24h movers and posts big moves to
 *                Telegram. Set these as worker secrets/vars:
 *                  TELEGRAM_BOT_TOKEN  (from @BotFather)
 *                  TELEGRAM_CHAT_ID    (channel/group id)
 *                  ALERT_MIN_BPS       (optional, default 300 = 3%)
 *
 * Deploy:  npx wrangler deploy
 * Cron schedule is configured in wrangler.toml ([triggers] crons)
 */

import { api } from "../src/handler";
import { dataFor } from "../src/mcpServer";
import { withSecurityHeaders } from "../../packages/core/src/deploymentSecurity";
import {
  NETWORKS,
  price,
  dec,
  fmtNum,
  fmtPctFromBps,
  type MarketOverviewResult,
} from "../../packages/core/src/index";

interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

interface WorkerEnv extends Record<string, string | undefined> {
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  ALERT_MIN_BPS?: string;
}

type FullWorkerEnv = WorkerEnv & {
  ASSETS?: AssetsBinding;
};

async function sendTelegram(env: WorkerEnv, text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  await fetch(
    `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        disable_web_page_preview: true,
      }),
    },
  );
}

async function moversReport(env: WorkerEnv): Promise<string | null> {
  const mcpUrl = env.MCP_URL ?? NETWORKS.testnet.mcpUrl;
  if (!mcpUrl) return null;
  const minBps = Number(env.ALERT_MIN_BPS ?? 300);
  let overview: MarketOverviewResult;
  try {
    overview = await dataFor(mcpUrl).marketOverview();
  } catch {
    return null;
  }
  const movers = [...(overview.markets ?? [])]
    .filter((m) => Math.abs(m.change24hBps ?? 0) >= minBps)
    .sort((a, b) => Math.abs(b.change24hBps) - Math.abs(a.change24hBps))
    .slice(0, 10);
  if (!movers.length) return null;
  const lines = movers.map(
    (m) =>
      `${m.symbol}: ${fmtNum(price(m.lastPrice))} (${fmtPctFromBps(m.change24hBps)})  ` +
      `24h vol $${fmtNum(dec(m.volume24hUsd), 0)}`,
  );
  return `🔔 Polyester ${overview.apiEnv} movers (±${minBps / 100}%)\n\n${lines.join("\n")}`;
}

export default {
  fetch(request: Request, env: FullWorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return api(request, { env });
    }
    if (env.ASSETS && typeof env.ASSETS.fetch === "function") {
      return env.ASSETS.fetch(request).then((response) =>
        withSecurityHeaders(response),
      );
    }
    return api(request, { env });
  },

  async scheduled(_event: unknown, env: FullWorkerEnv): Promise<void> {
    const report = await moversReport(env);
    if (report) await sendTelegram(env, report);
  },
};
