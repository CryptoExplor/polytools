import { useCallback, useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { NETWORKS, fmtAgo } from "@poly/core";
import { useApp } from "../lib/store";
import { useNow } from "../lib/hooks";
import {
  BRAND_KIT_ZIP_URL,
  POLYESTER_FULL_LOGO_DARK_SVG,
  POLYESTER_LOGOMARK_SVG,
} from "../brand";
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
  IconLayers,
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
  icon: ReactNode;
}

const INTRO_STORAGE_KEY = "poly-tools:intro:v1";

const NAV_GROUPS: Array<{ group: string; items: NavItem[] }> = [
  {
    group: "Market Data",
    items: [
      { to: "/", label: "Markets", icon: <IconDashboard size={15} /> },
      { to: "/book", label: "Order book", icon: <IconBook size={15} /> },
      { to: "/tape", label: "Recent trades", icon: <IconTape size={15} /> },
      { to: "/charts", label: "Price chart", icon: <IconChart size={15} /> },
      { to: "/heatmap", label: "Liquidity heatmap", icon: <IconActivity size={15} /> },
      { to: "/compare", label: "Venue compare", icon: <IconCompare size={15} /> },
    ],
  },
  {
    group: "Cross-Chain",
    items: [
      { to: "/zipper", label: "Zipper routes", icon: <IconZipper size={15} /> },
      { to: "/flow", label: "Tx explorer", icon: <IconFlow size={15} /> },
    ],
  },
  {
    group: "Toolkit & Docs",
    items: [
      { to: "/calc", label: "Calculators", icon: <IconCalc size={15} /> },
      { to: "/hub", label: "Testnet hub", icon: <IconHub size={15} /> },
      { to: "/sdk", label: "SDK quickstart", icon: <IconKey size={15} /> },
      { to: "/portfolio", label: "API keys (Local)", icon: <IconVault size={15} /> },
      { to: "/brand-kit", label: "Brand kit", icon: <IconLayers size={15} /> },
    ],
  },
];

const ROUTE_META: Record<
  string,
  { title: string; group: string; showSymbolSelector: boolean }
> = {
  "/": { title: "Markets", group: "Market Data", showSymbolSelector: true },
  "/book": { title: "Order book", group: "Market Data", showSymbolSelector: true },
  "/tape": { title: "Recent trades", group: "Market Data", showSymbolSelector: true },
  "/charts": { title: "Price chart", group: "Market Data", showSymbolSelector: true },
  "/heatmap": { title: "Liquidity heatmap", group: "Market Data", showSymbolSelector: true },
  "/compare": { title: "Venue compare", group: "Market Data", showSymbolSelector: false },
  "/zipper": { title: "Zipper routes", group: "Cross-Chain", showSymbolSelector: false },
  "/flow": { title: "Tx explorer", group: "Cross-Chain", showSymbolSelector: false },
  "/calc": { title: "Calculators", group: "Toolkit & Docs", showSymbolSelector: true },
  "/hub": { title: "Testnet hub", group: "Toolkit & Docs", showSymbolSelector: false },
  "/sdk": { title: "SDK quickstart", group: "Toolkit & Docs", showSymbolSelector: true },
  "/portfolio": { title: "API keys (Local)", group: "Toolkit & Docs", showSymbolSelector: false },
  "/brand-kit": { title: "Brand kit", group: "Toolkit & Docs", showSymbolSelector: false },
};

export function Layout() {
  const {
    apiEnv,
    dataSource,
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
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);
  const [brandCopiedNote, setBrandCopiedNote] = useState<string | null>(null);
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
    group: "Workspace",
    showSymbolSelector: false,
  };

  const dismissIntro = useCallback(() => {
    setIntroDismissed(true);
    try {
      localStorage.setItem(INTRO_STORAGE_KEY, "dismissed");
    } catch {
      /* ignore */
    }
  }, []);

  const copyBrandSvg = async (svg: string, label: string) => {
    try {
      await navigator.clipboard.writeText(svg);
      setBrandCopiedNote(label);
      window.setTimeout(() => setBrandCopiedNote(null), 1800);
    } catch {
      /* ignore */
    }
    setBrandMenuOpen(false);
  };

  const handleBrowseMarkets = () => {
    if (loc.pathname !== "/") {
      navigate("/");
    }
    window.setTimeout(() => {
      const el = document.getElementById("market-search") as HTMLInputElement | null;
      if (el) el.focus();
    }, 60);
  };

  useEffect(() => {
    const prefix = meta.showSymbolSelector ? `${symbol} · ` : "";
    document.title = `${prefix}${meta.title} — PolyTools`;
  }, [meta.title, meta.showSymbolSelector, symbol]);

  useEffect(() => {
    setNavOpen(false);
    setBrandMenuOpen(false);
  }, [loc.pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (brandMenuOpen) setBrandMenuOpen(false);
        else if (navOpen) setNavOpen(false);
        else if (!introDismissed) dismissIntro();
      }
    };
    const onDocClick = () => {
      if (brandMenuOpen) setBrandMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("click", onDocClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", onDocClick);
    };
  }, [brandMenuOpen, navOpen, introDismissed, dismissIntro]);

  return (
    <div className="shell">
      <a href="#main-workspace" className="skip-link">
        Skip to main content
      </a>

      <div
        className={`sidebar-backdrop ${navOpen ? "open" : ""}`}
        onClick={() => setNavOpen(false)}
        aria-hidden="true"
      />

      <aside className={`sidebar ${navOpen ? "open" : ""}`} aria-label="Primary navigation">
        <div className="sidebar-header" style={{ position: "relative" }}>
          <NavLink
            to="/"
            className="brand"
            title="Left-click for Markets · Right-click for Polyester Brand Kit menu"
            onClick={() => setNavOpen(false)}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setBrandMenuOpen((v) => !v);
            }}
          >
            <img src="/favicon.svg" alt="Polyester symbol" className="logo-img" />
            <span className="brand-meta">
              <span>PolyTools</span>
              <span className="brand-sub">
                {brandCopiedNote ? `✓ ${brandCopiedNote}` : `Read-only · ${apiEnv}`}
              </span>
            </span>
          </NavLink>
          <button
            type="button"
            className="burger"
            onClick={() => setNavOpen(false)}
            aria-label="Close navigation menu"
          >
            <IconClose size={15} />
          </button>

          {brandMenuOpen && (
            <div
              className="brand-context-menu"
              role="menu"
              aria-label="Polyester Brand Kit quick actions"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="brand-context-title mono">Polyester Brand Kit</div>
              <button
                type="button"
                role="menuitem"
                className="brand-context-item"
                onClick={() => copyBrandSvg(POLYESTER_FULL_LOGO_DARK_SVG, "Copied full logo")}
              >
                Copy full logo SVG
              </button>
              <button
                type="button"
                role="menuitem"
                className="brand-context-item"
                onClick={() => copyBrandSvg(POLYESTER_LOGOMARK_SVG, "Copied symbol")}
              >
                Copy symbol SVG
              </button>
              <a
                href={BRAND_KIT_ZIP_URL}
                target="_blank"
                rel="noreferrer"
                role="menuitem"
                className="brand-context-item"
                onClick={() => setBrandMenuOpen(false)}
              >
                Download brand assets (.zip) ↗
              </a>
              <button
                type="button"
                role="menuitem"
                className="brand-context-item"
                onClick={() => {
                  setBrandMenuOpen(false);
                  navigate("/brand-kit");
                }}
              >
                Open Brand Kit & Guidelines →
              </button>
            </div>
          )}
        </div>

        <nav className="sidebar-nav" aria-label="Tools">
          {NAV_GROUPS.map((g) => (
            <div key={g.group} className="nav-section">
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
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-meta-line">
            <span>{pairs.length ? `${pairs.length} pairs · ${assets.length} assets` : "MCP read-only"}</span>
            <span className="mono">{apiEnv}</span>
          </div>
          <div className="sidebar-disclaimer">
            Public analytics for{" "}
            <a href={NETWORKS.testnet.appUrl} target="_blank" rel="noreferrer">
              Polyester ↗
            </a>
            . No wallet or login.
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

          <div className="topbar-breadcrumb">
            <span className="topbar-crumb-group">{meta.group}</span>
            <span className="topbar-crumb-sep">/</span>
            <span className="topbar-crumb-current">{meta.title}</span>
            <span className="topbar-eyebrow hide-sm">
              Read-only · {apiEnv}
            </span>
          </div>

          <div className="spacer" />

          <div className="topbar-controls">
            {meta.showSymbolSelector && (
              <SymbolSelect
                value={symbol}
                onChange={setSymbol}
                ariaLabel="Active market symbol"
              />
            )}

            {connectionStatus === "connected" ? (
              <span
                className={`pill ${dataSource === "wire-samples" ? "warn" : "up"} hide-xs`}
                title={
                  dataSource === "wire-samples"
                    ? "Serving captured testnet wire samples (sandbox offline fallback)"
                    : marketsUpdatedAt
                      ? `Backend connected · Synced ${fmtAgo(marketsUpdatedAt, now)}`
                      : "Backend connected"
                }
              >
                <span className="dot live" />
                {dataSource === "wire-samples" ? "Sample data" : "Live MCP"}
              </span>
            ) : connectionStatus === "connecting" ? (
              <span className="pill hide-xs">
                <span className="dot" />
                Syncing…
              </span>
            ) : (
              <button
                type="button"
                className="btn sm danger"
                onClick={refreshMarkets}
                title={`Connection issue: ${marketsError ?? "unreachable"}. Click to retry.`}
              >
                <IconRefresh size={12} />
                <span>Retry</span>
              </button>
            )}

            <button
              type="button"
              className="btn sm ghost"
              onClick={() => setGlossaryOpen(true)}
              title="Open plain-English definitions glossary"
            >
              <IconInfo size={13} />
              <span className="hide-sm">Glossary</span>
            </button>

            <button
              type="button"
              className="btn sm ghost"
              onClick={toggleTheme}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            >
              {theme === "dark" ? <IconSun size={14} /> : <IconMoon size={14} />}
            </button>
          </div>
        </header>

        <main id="main-workspace" className="content" tabIndex={-1}>
          {!introDismissed && (
            <section className="intent-bar" aria-label="About PolyTools">
              <div className="intent-bar-copy">
                <span className="intent-eyebrow">Read-only toolkit · Testnet</span>
                <strong>PolyTools is a read-only map of Polyester.</strong>{" "}
                <span>
                  Watch live prices, order book depth, trades, and bridge fees without
                  connecting a wallet. It never places orders or touches funds.
                </span>
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
                  Testnet setup
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

          <Outlet />
        </main>

        <footer className="foot">
          <span>
            PolyTools · Read-only companion for Polyester ({apiEnv}) · Prices decoded via{" "}
            <code className="mono">raw ÷ 10³</code>
          </span>
          <span className="row-flex" style={{ gap: 16 }}>
            <NavLink to="/brand-kit">Brand Kit</NavLink>
            <button
              type="button"
              className="foot-link-btn"
              onClick={() => setGlossaryOpen(true)}
            >
              Glossary
            </button>
            <a href={NETWORKS.testnet.appUrl} target="_blank" rel="noreferrer">
              Polyester App ↗
            </a>
            <a href={NETWORKS.testnet.docsUrl} target="_blank" rel="noreferrer">
              Docs ↗
            </a>
          </span>
        </footer>
      </div>

      <GlossaryDrawer open={glossaryOpen} onClose={() => setGlossaryOpen(false)} />
    </div>
  );
}
