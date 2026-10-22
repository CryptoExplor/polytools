/**
 * TOOL 8 — Testnet Onboarding & Daily Claim Hub (/#/hub)
 * Tracks the 00:00 UTC daily paper-asset claim reset countdown, provides a
 * persistent 8-step onboarding checklist, and lists official testnet faucets
 * and documentation resources.
 */

import { useEffect, useState } from "react";
import { NETWORKS, fmtTimeUTC } from "@poly/core";
import { useNow } from "../lib/hooks";
import { useApp } from "../lib/store";
import {
  Card,
  Countdown,
  MetricCell,
  MetricStrip,
  PageHeader,
  Pill,
} from "../components/ui";
import { IconCheck, IconClock, IconExternal, IconTrash } from "../components/icons";

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
    hint: "Return with the same sign-in method each session — it controls your non-custodial account.",
    url: APP,
  },
  {
    id: "social",
    phase: "Step 2 · Verification",
    title: "Link X (Twitter) and Discord in Account Settings",
    hint: "Required in the official app to unlock the daily Paper Assets reward claim.",
  },
  {
    id: "claim",
    phase: "Step 3 · Daily Reward",
    title: "Claim today's Paper Assets allocation",
    hint: "Resets every day at 00:00 UTC — use the countdown timer above to track the next window.",
    url: APP,
  },
  {
    id: "trade",
    phase: "Step 4 · Execution",
    title: "Place your first spot order",
    hint: "Try placing a limit order on BTC-USDT or ETH-USDC, then experiment with a TP/SL order.",
    url: `${APP}/trade/spot/BTC-USDT`,
  },
  {
    id: "faucet",
    phase: "Step 5 · External Faucet",
    title: "Request external testnet coins from a public faucet",
    hint: "External testnet coins (tBTC, tETH…) are used to test cross-chain Zipper bridge deposits.",
    url: `${DOCS}/user-docs/reference/testnet-faucets`,
  },
  {
    id: "deposit",
    phase: "Step 6 · Bridge In",
    title: "Test a cross-chain deposit over Zipper",
    hint: "Deposit test assets from a supported testnet chain and inspect the trace in the Tx Explorer tool (/#/flow).",
  },
  {
    id: "withdraw",
    phase: "Step 7 · Bridge Out",
    title: "Test a cross-chain withdrawal",
    hint: "Withdraw a supported test asset to an external testnet address to verify the full round-trip.",
  },
  {
    id: "competition",
    phase: "Step 8 · Community",
    title: "Follow testnet competitions & feedback channels",
    hint: "Check the official Discord for scheduled trading competitions and promotional events.",
    url: "https://discord.gg/polyester",
  },
];

const STORE_KEY = "poly-tools:hub-checklist";

/** Compute timestamp (ms) of the next 00:00:00 UTC midnight. */
function nextReset(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0);
}

export default function Hub() {
  const now = useNow(1000);
  const { apiEnv, pairs, assets } = useApp();

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

  return (
    <div className="page-stack">
      <PageHeader
        title="Testnet Hub & Onboarding Guide"
        badge={<Pill kind="warn">ENV: {apiEnv.toUpperCase()}</Pill>}
        subtitle="Track the daily 00:00 UTC paper-asset reset window, work through the local onboarding checklist, and access verified Polyester testnet faucets and documentation."
        actions={
          <span className="pill mono" title="Current UTC clock">
            <IconClock size={12} /> {fmtTimeUTC(now)} UTC
          </span>
        }
      />

      <MetricStrip>
        <MetricCell
          label="Active Environment"
          trend="warn"
          value={apiEnv.toUpperCase()}
          sub="Read-only MCP data source"
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
          value={pairs.length ? `${pairs.length} pairs` : "19 pairs"}
          sub={assets.length ? `${assets.length} supported assets` : "Spot & Zipper assets"}
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
            to={nextReset()}
            label="Time remaining until the next 00:00 UTC daily reset window:"
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
          subtitle="Track your personal walkthrough of core Polyester testnet capabilities."
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
        subtitle="Click any step to mark it complete in your browser."
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

      {/* Official Faucet & Documentation Directory */}
      <Card
        title="Official Faucets, Documentation & Community Directory"
        subtitle="Verified external links for Polyester testnet participants and developers."
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
