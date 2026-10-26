/**
 * TOOL 8 — Testnet Onboarding & Daily Claim Hub (/#/hub)
 * Tracks the 00:00 UTC daily paper-asset claim reset countdown, provides a
 * persistent 8-step onboarding checklist, and lists official testnet faucets
 * and documentation resources.
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { NETWORKS, fmtTimeUTC } from "@poly/core";
import { useNow } from "../lib/hooks";
import {
  formatBooleanTelemetry,
  formatCountTelemetry,
  telemetryFallback,
} from "../lib/telemetry";
import { useApp } from "../lib/store";
import {
  Card,
  Countdown,
  MetricCell,
  MetricStrip,
  PageHeader,
  Pill,
} from "../components/ui";
import { IconCheck, IconClock, IconExternal, IconKey, IconTrash } from "../components/icons";

const APP = NETWORKS.testnet.appUrl;
const DOCS = NETWORKS.testnet.docsUrl;

const LINKS = [
  {
    label: "Polyester Testnet Web App",
    tag: "Exchange",
    url: APP,
    desc: "Sign in with Google/email (embedded wallet) or MetaMask, Rabby, Phantom, or WalletConnect.",
  },
  {
    label: "Spot Trading Terminal (ETH-USDC)",
    tag: "Trading",
    url: `${APP}/trade/spot/ETH-USDC`,
    desc: "Test market, limit, TP/SL, trailing stop, TWAP, and ladder order types.",
  },
  {
    label: "Official Testnet Faucets Directory",
    tag: "Faucets",
    url: `${DOCS}/user-docs/reference/testnet-faucets`,
    desc: "Request external testnet coins (tBTC, tETH, tSOL, tBCH…) for cross-chain Zipper deposit testing.",
  },
  {
    label: "TypeScript SDK (@polyester/sdk)",
    tag: "TS SDK",
    url: `${DOCS}/sdk/typescript/get-started`,
    desc: "Official typed TypeScript client for Node.js, Bun, Edge, and Browser (market data, streams, wallet & Ed25519 auth).",
  },
  {
    label: "Python SDK (polyester-sdk)",
    tag: "Python SDK",
    url: `${DOCS}/sdk/python/get-started`,
    desc: "Official async (AsyncPolyester) and sync (Polyester) API-key client for trading bots and ConnectRPC streams.",
  },
  {
    label: "Rust SDK (polyester-sdk)",
    tag: "Rust SDK",
    url: `${DOCS}/sdk/rust/get-started`,
    desc: "Official Tokio async Rust client (use polyester::Client) for low-latency bots and typed Protobuf streams.",
  },
  {
    label: "User Documentation & Guides",
    tag: "User Docs",
    url: `${DOCS}/user-docs`,
    desc: "Learn about accounts, sub-accounts, Zipper deposits/withdrawals, and daily paper rewards.",
  },
  {
    label: "Developer & API Documentation",
    tag: "Dev Docs",
    url: `${DOCS}/developer-docs`,
    desc: "Reference for REST endpoints, WebSocket JSON streams, Ed25519 signing, SBE, and FIX.",
  },
  {
    label: "Polyester Discord Community",
    tag: "Community",
    url: "https://discord.gg/polyester",
    desc: "Official announcements, developer support, bug reports, and testnet trading competitions.",
  },
];

interface CheckItem {
  id: string;
  phase: string;
  title: string;
  hint: string;
  url?: string;
}

const CHECKLIST: CheckItem[] = [
  {
    id: "account",
    phase: "Step 1 · Setup",
    title: "Create a Polyester testnet account",
    hint: "Use the same sign-in method each session.",
    url: APP,
  },
  {
    id: "social",
    phase: "Step 2 · Verification",
    title: "Link X (Twitter) and Discord in Account Settings",
    hint: "Needed for the daily paper-asset claim.",
  },
  {
    id: "claim",
    phase: "Step 3 · Daily Reward",
    title: "Claim today's Paper Assets allocation",
    hint: "Resets daily at 00:00 UTC.",
    url: APP,
  },
  {
    id: "trade",
    phase: "Step 4 · Execution",
    title: "Place your first spot order",
    hint: "Place a limit order on BTC-USDT, then try a TP/SL.",
    url: `${APP}/trade/spot/BTC-USDT`,
  },
  {
    id: "faucet",
    phase: "Step 5 · External Faucet",
    title: "Request external testnet coins from a public faucet",
    hint: "tBTC and tETH test cross-chain Zipper deposits.",
    url: `${DOCS}/user-docs/reference/testnet-faucets`,
  },
  {
    id: "deposit",
    phase: "Step 6 · Bridge In",
    title: "Test a cross-chain deposit over Zipper",
    hint: "Deposit from a testnet chain, then read the trace in Account Tx Explorer.",
  },
  {
    id: "withdraw",
    phase: "Step 7 · Bridge Out",
    title: "Test a cross-chain withdrawal",
    hint: "Withdraw to an external testnet address to close the loop.",
  },
  {
    id: "competition",
    phase: "Step 8 · Community",
    title: "Follow testnet competitions & feedback channels",
    hint: "Competitions and events are announced in Discord.",
    url: "https://discord.gg/polyester",
  },
];

const STORE_KEY = "poly-tools:hub-checklist";

/** Compute timestamp (ms) of the next 00:00:00 UTC midnight relative to `nowMs`. */
function nextReset(nowMs = Date.now()): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
}

export default function Hub() {
  const now = useNow(1000);
  const {
    apiEnv,
    dataSource,
    envInfo,
    marketsError,
    marketsLoading,
    marketsUpdatedAt,
    marketsRefreshing,
    marketsCacheStatus,
    connectionStatus,
    refreshMarkets,
    pairs,
    assets,
  } = useApp();

  const [done, setDone] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify([...done]));
    } catch {
      /* ignore storage errors */
    }
  }, [done]);

  const toggle = (id: string) =>
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const markAll = () => setDone(new Set(CHECKLIST.map((c) => c.id)));
  const resetAll = () => setDone(new Set());

  const pct = Math.round((done.size / CHECKLIST.length) * 100);
  const metadataAvailable = marketsUpdatedAt !== null;
  const metadataPending = !metadataAvailable && marketsLoading;
  const environmentLabel = metadataAvailable
    ? apiEnv.toUpperCase()
    : metadataPending
      ? "PENDING"
      : "UNKNOWN";
  const environmentTelemetry = metadataAvailable
    ? apiEnv
    : telemetryFallback(metadataPending);
  const metadataStale = marketsCacheStatus ? now >= marketsCacheStatus.freshUntil : false;
  const dataSourceLabel = metadataAvailable
    ? marketsCacheStatus
      ? `${metadataStale ? "Stale" : "Fresh"} local public metadata cache${marketsRefreshing ? " (refreshing)" : ""}`
      : dataSource === "wire-samples"
        ? "wire-samples (sandbox offline fallback)"
        : "live MCP endpoint"
    : telemetryFallback(metadataPending);
  const envTelemetryPending = !envInfo && marketsLoading && !marketsError;

  return (
    <div className="page-stack">
      <PageHeader
        title="Start on testnet"
        badge={<Pill kind="warn">ENV: {environmentLabel}</Pill>}
        subtitle="Testnet checklist, daily reset, and official links."
        actions={
          <div className="row-flex">
            <Link to="/sdk" className="btn sm primary">
              <IconKey size={13} />
              <span>Open SDK quickstart (TypeScript · Python · Rust)</span>
            </Link>
            <span className="pill mono" title="Current UTC clock">
              <IconClock size={12} /> {fmtTimeUTC(now)} UTC
            </span>
          </div>
        }
      />

      <MetricStrip>
        <MetricCell
          label="Active Environment"
          trend="warn"
          value={environmentLabel}
          sub={
            metadataAvailable
              ? marketsCacheStatus
                ? "Validated cached public catalog"
                : "Read-only MCP data source"
              : metadataPending
                ? "Waiting for market metadata"
                : "Market metadata unavailable"
          }
        />
        <MetricCell
          label="Daily Claim Reset"
          value="00:00 UTC"
          sub={`Current time: ${fmtTimeUTC(now)} UTC`}
        />
        <MetricCell
          label="Onboarding Checklist"
          trend={pct === 100 ? "up" : undefined}
          value={`${done.size} / ${CHECKLIST.length} (${pct}%)`}
          sub="Saved locally in this browser"
        />
        <MetricCell
          label="Listed Testnet Markets"
          value={
            metadataAvailable
              ? `${pairs.length} pairs`
              : telemetryFallback(metadataPending)
          }
          sub={
            metadataAvailable
              ? `${assets.length} supported assets`
              : "Market metadata unavailable"
          }
        />
      </MetricStrip>

      <div className="notice">
        <div>
          <strong>Testnet Safety Notice:</strong> The Polyester testnet only accepts{" "}
          <strong>paper assets</strong> and external <strong>testnet coins (tBTC, tETH, etc.)</strong>.
          Never send real mainnet funds to any testnet deposit address. Testnet state,
          balances, and order history may be reset by the exchange team at any time.
        </div>
      </div>

      <div className="grid cols-2">
        <Card
          title="Next Daily Claim Reset (00:00 UTC)"
          subtitle="Paper asset claim windows reset at UTC midnight in the official Polyester app."
          actions={<Pill kind="accent">UTC Schedule</Pill>}
        >
          <Countdown
            to={nextReset(now)}
            label="Until the next 00:00 UTC reset:"
          />
          <div className="row-flex mt-3" style={{ justifyContent: "space-between" }}>
            <a
              className="btn primary"
              href={APP}
              target="_blank"
              rel="noreferrer"
            >
              <span>Open Polyester Testnet App</span>
              <IconExternal size={13} />
            </a>
            <span className="faint">
              Claims are performed directly inside your Polyester account.
            </span>
          </div>
        </Card>

        <Card
          title={`Local Onboarding Progress · ${pct}%`}
          subtitle="Your walkthrough of the testnet basics."
          actions={
            done.size > 0 ? (
              <button type="button" className="btn sm ghost" onClick={resetAll}>
                <IconTrash size={12} /> Reset Progress
              </button>
            ) : (
              <button type="button" className="btn sm ghost" onClick={markAll}>
                <IconCheck size={12} /> Mark All Done
              </button>
            )
          }
        >
          <div className="range mb-2" style={{ width: "100%", height: 8 }}>
            <div
              className="fill"
              style={{
                width: `${pct}%`,
                background: pct === 100 ? "var(--up)" : "var(--accent)",
              }}
            />
          </div>
          <div className="between mb-3">
            <span className="muted">
              <strong>{done.size}</strong> of <strong>{CHECKLIST.length}</strong> steps
              completed
            </span>
            {pct === 100 ? (
              <Pill kind="up">▲ All Steps Completed</Pill>
            ) : (
              <Pill>{CHECKLIST.length - done.size} remaining</Pill>
            )}
          </div>

          <div className="kv">
            <span className="k">Checklist Storage</span>
            <span className="v mono">Browser localStorage ({STORE_KEY})</span>
          </div>
          <div className="kv">
            <span className="k">Official Testnet Host</span>
            <span className="v mono">{APP}</span>
          </div>
          <div className="kv">
            <span className="k">Official Docs Host</span>
            <span className="v mono">{DOCS}</span>
          </div>
        </Card>
      </div>

      {/* Interactive Checklist */}
      <Card
        title="Testnet Onboarding Checklist"
        subtitle="Stored only in this browser. PolyTools cannot see whether you actually claimed."
      >
        <div>
          {CHECKLIST.map((c) => {
            const isDone = done.has(c.id);
            return (
              <label key={c.id} className={`check-item ${isDone ? "done" : ""}`}>
                <input
                  type="checkbox"
                  checked={isDone}
                  onChange={() => toggle(c.id)}
                />
                <span className="txt" style={{ flex: 1 }}>
                  <span className="between">
                    <b>{c.title}</b>
                    <Pill kind={isDone ? "up" : undefined}>
                      {isDone ? "✓ Completed" : c.phase}
                    </Pill>
                  </span>
                  <span>
                    {c.hint}{" "}
                    {c.url && (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        style={{ display: "inline-flex", alignItems: "center", gap: 3 }}
                      >
                        Open link <IconExternal size={11} />
                      </a>
                    )}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </Card>

      {/* Connection & Environment Diagnostics (FEAT-11) */}
      <Card
        title="Connection details"
        subtitle="From /api/env and /api/markets. Missing values are labeled, never guessed."
        actions={
          <button type="button" className="btn sm ghost" onClick={refreshMarkets}>
            Refresh
          </button>
        }
      >
        <div className="grid cols-2">
          <div>
            <div className="kv">
              <span className="k">Connection Status</span>
              <span className="v">
                <Pill
                  kind={
                    connectionStatus === "connected"
                      ? "up"
                      : connectionStatus === "connecting"
                        ? "info"
                        : "down"
                  }
                >
                  {connectionStatus.toUpperCase()}
                </Pill>
              </span>
            </div>
            <div className="kv">
              <span className="k">Serving Environment (apiEnv)</span>
              <span className="v mono">{environmentTelemetry}</span>
            </div>
            <div className="kv">
              <span className="k">Data Source</span>
              <span className="v mono">{dataSourceLabel}</span>
            </div>
            <div className="kv">
              <span className="k">Last Metadata Sync</span>
              <span className="v mono">
                {marketsUpdatedAt
                  ? `${fmtTimeUTC(marketsUpdatedAt)} UTC`
                  : marketsError
                    ? `Error: ${marketsError}`
                    : telemetryFallback(marketsLoading)}
              </span>
            </div>
          </div>
          <div>
            <div className="kv">
              <span className="k">Testnet MCP Configured</span>
              <span className="v mono">
                {formatBooleanTelemetry(
                  envInfo?.networks?.testnet?.mcpConfigured,
                  Boolean(envTelemetryPending),
                )}
              </span>
            </div>
            <div className="kv">
              <span className="k">Mainnet MCP Configured</span>
              <span className="v mono">
                {formatBooleanTelemetry(
                  envInfo?.networks?.mainnet?.mcpConfigured,
                  Boolean(envTelemetryPending),
                )}
              </span>
            </div>
            <div className="kv">
              <span className="k">Backend Isolate Cache Keys</span>
              <span className="v mono">
                {formatCountTelemetry(
                  envInfo?.cache?.keys,
                  Boolean(envTelemetryPending),
                  " / 200 max",
                )}
              </span>
            </div>
            <div className="kv">
              <span className="k">In-Flight Coalesced Requests</span>
              <span className="v mono">
                {formatCountTelemetry(
                  envInfo?.cache?.inFlight,
                  Boolean(envTelemetryPending),
                )}
              </span>
            </div>
          </div>
        </div>
      </Card>

      {/* Official Faucet & Documentation Directory */}
      <Card
        title="Official Faucets, Documentation & Community Directory"
        subtitle="Official links for testnet participants and developers."
      >
        <div className="grid cols-3">
          {LINKS.map((l) => (
            <a
              key={l.url}
              href={l.url}
              target="_blank"
              rel="noreferrer"
              className="card"
              style={{
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                textDecoration: "none",
                background: "var(--bg-elevated)",
              }}
            >
              <div>
                <div className="between mb-2">
                  <Pill kind="accent">{l.tag}</Pill>
                  <IconExternal size={13} style={{ color: "var(--text-muted)" }} />
                </div>
                <strong style={{ color: "var(--text-primary)", fontSize: 13.5 }}>
                  {l.label}
                </strong>
                <div className="faint mt-2" style={{ lineHeight: 1.5 }}>
                  {l.desc}
                </div>
              </div>
              <div
                className="mono faint mt-3"
                style={{
                  fontSize: 11,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {l.url.replace(/^https?:\/\//, "")}
              </div>
            </a>
          ))}
        </div>
      </Card>
    </div>
  );
}
