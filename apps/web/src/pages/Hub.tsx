/**
 * TOOL 8 — Testnet hub: daily paper-asset claim countdown (resets 00:00 UTC),
 * onboarding checklist (persisted), faucet & docs directory, competition notes.
 * The highest-value page during the testnet phase itself.
 */

import { useEffect, useState } from "react";
import { Card, Countdown, Pill } from "../components/ui";
import { useNow } from "../lib/hooks";
import { NETWORKS } from "@poly/core";

const APP = NETWORKS.testnet.appUrl;
const DOCS = NETWORKS.testnet.docsUrl;

const LINKS = [
  { label: "Open the testnet app", url: APP, desc: "Sign in with Google/email (embedded wallet) or MetaMask/Rabby/Phantom/WalletConnect." },
  { label: "Start spot trading (ETH-USDC)", url: `${APP}/trade/spot/ETH-USDC`, desc: "Market, limit, TP/SL, trailing stop, TWAP and ladder orders." },
  { label: "Testnet faucets (official list)", url: `${DOCS}/user-docs/reference/testnet-faucets`, desc: "Get tBTC, tBCH, tETH and other test assets from external testnets." },
  { label: "User documentation", url: `${DOCS}/user-docs`, desc: "Accounts, sub-accounts, deposits, withdrawals, rewards." },
  { label: "Developer documentation", url: `${DOCS}/developer-docs`, desc: "REST, WebSocket JSON, SDKs, SBE, FIX." },
  { label: "Discord community", url: "https://discord.gg/polyester", desc: "Announcements, support, trading competitions." },
];

interface CheckItem { id: string; title: string; hint: string; url?: string }

const CHECKLIST: CheckItem[] = [
  { id: "account", title: "Create a testnet account", hint: "Return with the same sign-in method every time — it controls your account.", url: APP },
  { id: "social", title: "Connect X and Discord", hint: "Required to unlock the daily Paper Assets reward in account settings." },
  { id: "claim", title: "Claim today's paper assets", hint: "Resets daily at 00:00 UTC — the countdown above tracks the next reset." },
  { id: "trade", title: "Place your first trade", hint: "Try a small limit order on BTC-USDT, then a TP/SL order.", url: `${APP}/trade/spot/BTC-USDT` },
  { id: "faucet", title: "Pull test coins from a faucet", hint: "External testnet coins (tBTC, tETH…) are used for deposit testing.", url: `${DOCS}/user-docs/reference/testnet-faucets` },
  { id: "deposit", title: "Test a cross-chain deposit", hint: "Deposit test assets over Zipper and watch the flow in the Tx explorer tool." },
  { id: "withdraw", title: "Test a withdrawal", hint: "Send a supported asset back over another route to complete the loop." },
  { id: "competition", title: "Watch for competitions & giveaways", hint: "The team announced testnet promotions with real-money prizes — see Discord." },
];

const STORE_KEY = "poly-tools:hub-checklist";

/** Next UTC midnight. */
function nextReset(): number {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0);
}

export default function Hub() {
  useNow(1000); // re-render each second for the countdown
  const [done, setDone] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem(STORE_KEY) ?? "[]")); } catch { return new Set(); }
  });
  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify([...done]));
  }, [done]);

  const toggle = (id: string) =>
    setDone((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const pct = Math.round((done.size / CHECKLIST.length) * 100);

  return (
    <div className="grid">
      <div className="grid cols-2">
        <Card title="Next daily claim reset (00:00 UTC)">
          <Countdown to={nextReset()} label="Paper assets reset daily — claim before the reset to stack streaks." />
          <div className="mt-2">
            <a className="btn primary" href={APP} target="_blank" rel="noreferrer">Open app & claim →</a>
          </div>
        </Card>

        <Card title={`Onboarding progress · ${pct}%`}>
          <div className="range mb-2" style={{ width: "100%", height: 8 }}>
            <div className="fill" style={{ width: `${pct}%` }} />
          </div>
          <div className="faint">
            {done.size} of {CHECKLIST.length} steps done. Progress is saved in this browser.
          </div>
        </Card>
      </div>

      <Card title="Onboarding checklist">
        {CHECKLIST.map((c) => (
          <label key={c.id} className={`check-item ${done.has(c.id) ? "done" : ""}`}>
            <input type="checkbox" checked={done.has(c.id)} onChange={() => toggle(c.id)} />
            <span className="txt">
              <b>{c.title}</b>
              <span>{c.hint} {c.url && <a href={c.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>open →</a>}</span>
            </span>
          </label>
        ))}
      </Card>

      <Card title="Directory">
        <div className="grid cols-2">
          {LINKS.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="card" style={{ display: "block", textDecoration: "none" }}>
              <b style={{ color: "var(--text)" }}>{l.label} ↗</b>
              <div className="faint mt-2">{l.desc}</div>
            </a>
          ))}
        </div>
      </Card>

      <div className="notice">
        <b>Heads up:</b> testnet only accepts <Pill kind="warn">paper assets</Pill> and native testnet
        coins — never send real mainnet funds to testnet addresses. Testnet data can be reset at any time.
      </div>
    </div>
  );
}
