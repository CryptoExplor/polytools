import { useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { NETWORKS, fmtAgo } from "@poly/core";
import { useApp } from "../lib/store";
import { useNow } from "../lib/hooks";
import { SymbolSelect } from "./ui";
import {
  IconBook,
  IconCalc,
  IconChart,
  IconClose,
  IconCompare,
  IconDashboard,
  IconExternal,
  IconFlow,
  IconHub,
  IconMenu,
  IconMoon,
  IconRefresh,
  IconSun,
  IconTape,
  IconVault,
  IconZipper,
} from "./icons";

interface NavItem {
  to: string;
  label: string;
  shortTag?: string;
  icon: ReactNode;
}

const NAV_GROUPS: Array<{ group: string; items: NavItem[] }> = [
  {
    group: "Market Intelligence",
    items: [
      { to: "/", label: "Market Dashboard", shortTag: "MKT", icon: <IconDashboard size={16} /> },
      { to: "/book", label: "Order Book & Depth", shortTag: "L2", icon: <IconBook size={16} /> },
      { to: "/tape", label: "Trades & Whales", shortTag: "TAPE", icon: <IconTape size={16} /> },
      { to: "/charts", label: "Candlestick Charts", shortTag: "OHLC", icon: <IconChart size={16} /> },
      { to: "/compare", label: "Venue Compare", shortTag: "ARB", icon: <IconCompare size={16} /> },
    ],
  },
  {
    group: "Execution & Routing",
    items: [
      { to: "/zipper", label: "Zipper Routes", shortTag: "BRIDGE", icon: <IconZipper size={16} /> },
      { to: "/calc", label: "Risk & PnL Calcs", shortTag: "CALC", icon: <IconCalc size={16} /> },
      { to: "/flow", label: "Tx Lifecycle Explorer", shortTag: "FLOW", icon: <IconFlow size={16} /> },
    ],
  },
  {
    group: "Security & Network",
    items: [
      { to: "/portfolio", label: "Ed25519 Key Vault", shortTag: "KEYS", icon: <IconVault size={16} /> },
      { to: "/hub", label: "Testnet Hub", shortTag: "UTC", icon: <IconHub size={16} /> },
    ],
  },
];

const ROUTE_META: Record<string, { title: string; routeTag: string; showSymbolSelector: boolean }> = {
  "/": { title: "Market Overview Terminal", routeTag: "/#/", showSymbolSelector: true },
  "/book": { title: "L2 Order Book & Depth", routeTag: "/#/book", showSymbolSelector: true },
  "/tape": { title: "Live Trade Tape & Whale Alerts", routeTag: "/#/tape", showSymbolSelector: true },
  "/charts": { title: "Multi-Timeframe Charts", routeTag: "/#/charts", showSymbolSelector: true },
  "/compare": { title: "Cross-Venue Index Comparison", routeTag: "/#/compare", showSymbolSelector: false },
  "/zipper": { title: "Zipper Cross-Chain Routes", routeTag: "/#/zipper", showSymbolSelector: false },
  "/calc": { title: "Position, Liquidation & PnL Calculators", routeTag: "/#/calc", showSymbolSelector: true },
  "/flow": { title: "Transaction & Flow Explorer", routeTag: "/#/flow", showSymbolSelector: false },
  "/portfolio": { title: "Client-Side Ed25519 Key Vault", routeTag: "/#/portfolio", showSymbolSelector: false },
  "/hub": { title: "Testnet Onboarding & Claim Hub", routeTag: "/#/hub", showSymbolSelector: false },
};

export function Layout() {
  const {
    apiEnv,
    envInfo,
    symbol,
    setSymbol,
    theme,
    toggleTheme,
    connectionStatus,
    marketsError,
    marketsUpdatedAt,
    refreshMarkets,
    pairs,
    assets,
  } = useApp();
  const [navOpen, setNavOpen] = useState(false);
  const loc = useLocation();
  const now = useNow(2000);

  const meta = ROUTE_META[loc.pathname] ?? {
    title: "PolyTools Terminal",
    routeTag: `/#${loc.pathname}`,
    showSymbolSelector: true,
  };

  const mainnetReady = Boolean(
    NETWORKS.mainnet.mcpUrl || envInfo?.networks.mainnet.mcpConfigured,
  );

  // Dynamic document title for browser tabs & history
  useEffect(() => {
    const prefix = meta.showSymbolSelector ? `${symbol} · ` : "";
    document.title = `${prefix}${meta.title} — PolyTools`;
  }, [meta.title, meta.showSymbolSelector, symbol]);

  // Close mobile nav on Escape or route change
  useEffect(() => {
    setNavOpen(false);
  }, [loc.pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  return (
    <div className="shell">
      <a href="#main-workspace" className="skip-link">
        Skip to main workspace
      </a>

      <div
        className={`sidebar-backdrop ${navOpen ? "open" : ""}`}
        onClick={() => setNavOpen(false)}
        aria-hidden="true"
      />

      <aside className={`sidebar ${navOpen ? "open" : ""}`} aria-label="Primary navigation">
        <div className="sidebar-header">
          <NavLink to="/" className="brand" onClick={() => setNavOpen(false)}>
            <span className="logo">PT</span>
            <span className="brand-meta">
              <span>PolyTools</span>
              <span className="brand-sub">Exchange Terminal</span>
            </span>
          </NavLink>
          <button
            type="button"
            className="burger"
            onClick={() => setNavOpen(false)}
            aria-label="Close navigation menu"
          >
            <IconClose size={16} />
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Analytics tools">
          {NAV_GROUPS.map((g) => (
            <div key={g.group}>
              <div className="nav-group">{g.group}</div>
              {g.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
                >
                  <span className="ico">{item.icon}</span>
                  <span>{item.label}</span>
                  {item.shortTag && <span className="nav-badge">{item.shortTag}</span>}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="between mb-2">
            <span className="mono" style={{ fontSize: 11 }}>
              {pairs.length ? `${pairs.length} pairs · ${assets.length} assets` : "Read-only MCP"}
            </span>
            <span
              className={`pill ${apiEnv === "testnet" ? "warn" : "up"}`}
              style={{ fontSize: 10.5, padding: "1px 6px" }}
            >
              {apiEnv.toUpperCase()}
            </span>
          </div>
          <div>
            Non-custodial, read-only toolkit for{" "}
            <a href={NETWORKS.testnet.appUrl} target="_blank" rel="noreferrer">
              Polyester <IconExternal size={11} />
            </a>
            . Keys never leave your browser.
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button
            type="button"
            className="burger"
            onClick={() => setNavOpen((v) => !v)}
            aria-label="Toggle navigation menu"
            aria-expanded={navOpen}
          >
            <IconMenu size={16} />
          </button>

          <div className="topbar-title-group">
            <h1>{meta.title}</h1>
            <span className="topbar-route-tag">{meta.routeTag}</span>
          </div>

          <div className="spacer" />

          <div className="topbar-controls">
            {/* Global active market switcher */}
            <SymbolSelect
              value={symbol}
              onChange={setSymbol}
              ariaLabel="Global active market symbol"
            />

            {/* Real Backend Connection Indicator */}
            {connectionStatus === "connected" ? (
              <span
                className="pill up hide-xs"
                title={
                  marketsUpdatedAt
                    ? `Backend connected · Metadata synced ${fmtAgo(marketsUpdatedAt, now)}`
                    : "Backend connected"
                }
              >
                <span className="dot live" />
                API Live
              </span>
            ) : connectionStatus === "connecting" ? (
              <span className="pill hide-xs" title="Connecting to Polyester MCP backend facade">
                <span className="dot" />
                Syncing…
              </span>
            ) : (
              <button
                type="button"
                className="btn sm danger"
                onClick={refreshMarkets}
                title={`Upstream connection issue: ${marketsError ?? "unreachable"}. Click to retry.`}
              >
                <IconRefresh size={12} />
                <span>Upstream Retry</span>
              </button>
            )}

            {/* Data-driven Environment Badge */}
            <span
              className={`pill ${apiEnv === "testnet" ? "warn" : "up"}`}
              title={`Serving environment reported by live API payloads (apiEnv="${apiEnv}")`}
            >
              <span className="dot" />
              {apiEnv}
            </span>

            {/* Mainnet Switch Readiness */}
            <span
              className="pill hide-sm"
              title={
                mainnetReady
                  ? "Mainnet endpoint configured — set MCP_URL_MAINNET to switch"
                  : "Mainnet endpoint pending announcement — configure in packages/core/src/config.ts or MCP_URL_MAINNET"
              }
            >
              mainnet: {mainnetReady ? "ready" : "pending"}
            </span>

            {/* Theme Selector (Dark / Light Terminal) */}
            <button
              type="button"
              className="btn sm ghost"
              onClick={toggleTheme}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            >
              {theme === "dark" ? <IconSun size={14} /> : <IconMoon size={14} />}
              <span className="hide-sm">{theme === "dark" ? "Light" : "Dark"}</span>
            </button>
          </div>
        </header>

        <main id="main-workspace" className="content" tabIndex={-1}>
          <Outlet />
        </main>

        <footer className="foot">
          <span>
            <strong>PolyTools v0.1</strong> · Read-only community analytics for Polyester Exchange ·
            Prices decoded via <code className="mono">raw ÷ 10³</code> (`PRICE_SCALE = 3`)
          </span>
          <span className="row-flex" style={{ gap: 14 }}>
            <a href={NETWORKS.testnet.appUrl} target="_blank" rel="noreferrer">
              Exchange App ↗
            </a>
            <a href={NETWORKS.testnet.docsUrl} target="_blank" rel="noreferrer">
              Developer Docs ↗
            </a>
          </span>
        </footer>
      </div>
    </div>
  );
}
