import { useCallback, useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { NETWORKS, fmtAgo } from "@poly/core";
import { useApp } from "../lib/store";
import { useNow } from "../lib/hooks";
import { SymbolSelect } from "./ui";
import { GlossaryDrawer } from "./Glossary";
import {
  IconActivity,
  IconBook,
  IconCalc,
  IconChart,
  IconClose,
  IconCompare,
  IconDashboard,
  IconExternal,
  IconFlow,
  IconHub,
  IconInfo,
  IconKey,
  IconMenu,
  IconMoon,
  IconRefresh,
  IconSun,
  IconTape,
  IconVault,
  IconX,
  IconZipper,
} from "./icons";

interface NavItem {
  to: string;
  label: string;
  shortTag?: string;
  icon: ReactNode;
}

const INTRO_STORAGE_KEY = "poly-tools:intro:v1";

const NAV_GROUPS: Array<{ group: string; items: NavItem[] }> = [
  {
    group: "Watch",
    items: [
      { to: "/", label: "Markets", shortTag: "MKT", icon: <IconDashboard size={16} /> },
      { to: "/book", label: "Order book", shortTag: "L2", icon: <IconBook size={16} /> },
      { to: "/tape", label: "Recent trades", shortTag: "TAPE", icon: <IconTape size={16} /> },
      { to: "/charts", label: "Price chart", shortTag: "OHLC", icon: <IconChart size={16} /> },
      { to: "/heatmap", label: "Liquidity heatmap", shortTag: "HEAT", icon: <IconActivity size={16} /> },
      { to: "/compare", label: "vs CoinGecko", shortTag: "ARB", icon: <IconCompare size={16} /> },
    ],
  },
  {
    group: "Move (info only)",
    items: [
      { to: "/zipper", label: "Deposit networks", shortTag: "BRIDGE", icon: <IconZipper size={16} /> },
      { to: "/flow", label: "Track a deposit", shortTag: "FLOW", icon: <IconFlow size={16} /> },
    ],
  },
  {
    group: "Learn",
    items: [
      { to: "/calc", label: "Calculators", shortTag: "CALC", icon: <IconCalc size={16} /> },
      { to: "/hub", label: "Testnet setup", shortTag: "UTC", icon: <IconHub size={16} /> },
      { to: "/sdk", label: "SDK & Bot Guide", shortTag: "SDK", icon: <IconKey size={16} /> },
    ],
  },
  {
    group: "Keys",
    items: [
      { to: "/portfolio", label: "Key vault", shortTag: "KEYS", icon: <IconVault size={16} /> },
    ],
  },
];

const ROUTE_META: Record<string, { title: string; routeTag: string; showSymbolSelector: boolean }> = {
  "/": { title: "Markets Overview", routeTag: "/#/", showSymbolSelector: true },
  "/book": { title: "L2 Order Book & Depth", routeTag: "/#/book", showSymbolSelector: true },
  "/tape": { title: "Recent Trades & Large Prints", routeTag: "/#/tape", showSymbolSelector: true },
  "/charts": { title: "Candlestick Price Chart", routeTag: "/#/charts", showSymbolSelector: true },
  "/heatmap": { title: "Order Book Liquidity Heatmap", routeTag: "/#/heatmap", showSymbolSelector: true },
  "/compare": { title: "Polyester vs CoinGecko Reference", routeTag: "/#/compare", showSymbolSelector: false },
  "/zipper": { title: "Deposit & Withdrawal Networks (Zipper)", routeTag: "/#/zipper", showSymbolSelector: false },
  "/calc": { title: "Position, Break-Even & Risk Calculators", routeTag: "/#/calc", showSymbolSelector: true },
  "/flow": { title: "Track a Deposit or Withdrawal", routeTag: "/#/flow", showSymbolSelector: false },
  "/portfolio": { title: "Local Ed25519 API Key Vault", routeTag: "/#/portfolio", showSymbolSelector: false },
  "/sdk": { title: "Beginner SDK & Bot Quickstart", routeTag: "/#/sdk", showSymbolSelector: true },
  "/hub": { title: "Testnet Setup & Daily Claim Hub", routeTag: "/#/hub", showSymbolSelector: false },
};

export function Layout() {
  const {
    apiEnv,
    dataSource,
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
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [introDismissed, setIntroDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(INTRO_STORAGE_KEY) === "dismissed";
    } catch {
      return false;
    }
  });

  const loc = useLocation();
  const navigate = useNavigate();
  const now = useNow(2000);

  const meta = ROUTE_META[loc.pathname] ?? {
    title: "PolyTools",
    routeTag: `/#${loc.pathname}`,
    showSymbolSelector: false,
  };

  const mainnetReady = Boolean(
    NETWORKS.mainnet.mcpUrl || envInfo?.networks.mainnet.mcpConfigured,
  );

  const dismissIntro = useCallback(() => {
    setIntroDismissed(true);
    try {
      localStorage.setItem(INTRO_STORAGE_KEY, "dismissed");
    } catch {
      /* ignore */
    }
  }, []);

  const handleBrowseMarkets = () => {
    if (loc.pathname !== "/") {
      navigate("/");
    }
    window.setTimeout(() => {
      const el = document.getElementById("market-search") as HTMLInputElement | null;
      if (el) el.focus();
    }, 60);
  };

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (navOpen) setNavOpen(false);
        else if (!introDismissed) dismissIntro();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen, introDismissed, dismissIntro]);

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
              <span className="brand-sub">Testnet · Read-only</span>
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
            Read-only testnet analytics for{" "}
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
            {/* Active market switcher — only shown on market-scoped pages (FE-NAV-02 / DEF-05) */}
            {meta.showSymbolSelector && (
              <SymbolSelect
                value={symbol}
                onChange={setSymbol}
                ariaLabel="Global active market symbol"
              />
            )}

            {/* Real Backend Connection Indicator */}
            {connectionStatus === "connected" ? (
              <span
                className={`pill ${dataSource === "wire-samples" ? "info" : "up"} hide-xs`}
                title={
                  dataSource === "wire-samples"
                    ? "Serving captured testnet wire samples (sandbox offline fallback)"
                    : marketsUpdatedAt
                      ? `Backend connected · Metadata synced ${fmtAgo(marketsUpdatedAt, now)}`
                      : "Backend connected"
                }
              >
                <span className="dot live" />
                {dataSource === "wire-samples" ? "Cached sample" : "API Live"}
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

            {/* Glossary / Definitions Drawer Trigger (UX-02 / FEAT-09) */}
            <button
              type="button"
              className="btn sm ghost"
              onClick={() => setGlossaryOpen(true)}
              title="Open plain-English definitions glossary"
              aria-label="Open plain-English definitions glossary"
            >
              <IconInfo size={13} />
              <span className="hide-sm">Definitions</span>
            </button>

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

        {/* First-Visit Dismissible Intent Bar (UX-01 / A11Y-01) */}
        {!introDismissed && (
          <section className="intent-bar" aria-label="About PolyTools">
            <div className="intent-bar-copy">
              <strong>PolyTools is a read-only map of Polyester testnet.</strong>{" "}
              It cannot place orders, move funds, or see your balances. Open a market to
              watch prices, or follow the Testnet Hub to trade in the official app.
            </div>
            <div className="intent-bar-actions">
              <button
                type="button"
                className="btn sm primary"
                onClick={handleBrowseMarkets}
              >
                Browse markets
              </button>
              <NavLink to="/hub" className="btn sm">
                Open Testnet Hub
              </NavLink>
              <button
                type="button"
                className="btn sm ghost"
                onClick={dismissIntro}
                aria-label="Dismiss introduction banner"
              >
                <IconX size={13} />
                <span>Dismiss</span>
              </button>
            </div>
          </section>
        )}

        <main id="main-workspace" className="content" tabIndex={-1}>
          <Outlet />
        </main>

        <footer className="foot">
          <span>
            <strong>PolyTools v0.1</strong> · Read-only testnet analytics. Trade in the official app ·
            Prices decoded via <code className="mono">raw ÷ 10³</code> (`PRICE_SCALE = 3`)
          </span>
          <span className="row-flex" style={{ gap: 14 }}>
            <button
              type="button"
              className="btn sm ghost"
              onClick={() => setGlossaryOpen(true)}
            >
              Definitions
            </button>
            <a href={NETWORKS.testnet.appUrl} target="_blank" rel="noreferrer">
              Exchange App ↗
            </a>
            <a href={NETWORKS.testnet.docsUrl} target="_blank" rel="noreferrer">
              Developer Docs ↗
            </a>
          </span>
        </footer>
      </div>

      <GlossaryDrawer open={glossaryOpen} onClose={() => setGlossaryOpen(false)} />
    </div>
  );
}
