import { useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useApp } from "../lib/store";
import { NETWORKS } from "@poly/core";

const NAV: Array<{ group: string; items: Array<{ to: string; ico: string; label: string }> }> = [
  {
    group: "Market data",
    items: [
      { to: "/", ico: "◫", label: "Dashboard" },
      { to: "/book", ico: "𝌆", label: "Order book" },
      { to: "/tape", ico: "≋", label: "Trades & whales" },
      { to: "/charts", ico: "📈", label: "Charts" },
      { to: "/compare", ico: "⚖", label: "Venue compare" },
    ],
  },
  {
    group: "Tools",
    items: [
      { to: "/zipper", ico: "⇄", label: "Zipper routes" },
      { to: "/calc", ico: "🧮", label: "Calculators" },
      { to: "/flow", ico: "🔍", label: "Tx explorer" },
      { to: "/portfolio", ico: "🔐", label: "Key vault" },
    ],
  },
  {
    group: "Testnet",
    items: [{ to: "/hub", ico: "🚰", label: "Testnet hub" }],
  },
];

const TITLES: Record<string, string> = {
  "/": "Market dashboard",
  "/book": "Live order book & depth",
  "/tape": "Trade tape & whale alerts",
  "/charts": "Charts",
  "/compare": "Cross-venue price compare",
  "/zipper": "Zipper deposit routes",
  "/calc": "Trading calculators",
  "/flow": "Transaction lifecycle explorer",
  "/portfolio": "API key vault",
  "/hub": "Testnet hub",
};

export function Layout() {
  const { apiEnv, envInfo, symbol } = useApp();
  const [navOpen, setNavOpen] = useState(false);
  const loc = useLocation();
  const mainnetReady = Boolean(
    NETWORKS.mainnet.mcpUrl || envInfo?.networks.mainnet.mcpConfigured,
  );

  return (
    <div className="shell">
      <aside className={`sidebar ${navOpen ? "open" : ""}`}>
        <div className="brand">
          <span className="logo">P</span> PolyTools
        </div>
        <nav onClick={() => setNavOpen(false)}>
          {NAV.map((g) => (
            <div key={g.group}>
              <div className="nav-group">{g.group}</div>
              {g.items.map((i) => (
                <NavLink
                  key={i.to}
                  to={i.to}
                  end={i.to === "/"}
                  className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
                >
                  <span className="ico">{i.ico}</span> {i.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="faint" style={{ padding: "18px 10px 0", lineHeight: 1.6 }}>
          Community-built, read-only analytics for{" "}
          <a href={NETWORKS.testnet.appUrl} target="_blank" rel="noreferrer">
            Polyester
          </a>
          . Not affiliated. Not financial advice.
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="burger" onClick={() => setNavOpen(!navOpen)} aria-label="menu">
            ☰
          </button>
          <h1>{TITLES[loc.pathname] ?? "PolyTools"}</h1>
          <div className="spacer" />
          <span className="pill">
            <span className="dot" /> {symbol}
          </span>
          <span className={`pill ${apiEnv === "testnet" ? "warn" : "up"}`} title="Served API environment (data-driven, from live responses)">
            ● {apiEnv}
          </span>
          <span
            className="pill"
            title={
              mainnetReady
                ? "Mainnet endpoint configured — flip MCP_URL_MAINNET to switch"
                : "Mainnet not public yet — set MCP_URL_MAINNET when announced"
            }
          >
            mainnet: {mainnetReady ? "ready" : "pending"}
          </span>
        </header>

        <main className="content">
          <Outlet />
        </main>

        <footer className="foot">
          PolyTools · data via the official read-only Polyester API (MCP) through an open
          serverless facade · prices are scaled-integer decoded · testnet may reset data
        </footer>
      </div>
    </div>
  );
}
