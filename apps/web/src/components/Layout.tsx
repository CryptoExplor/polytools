import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { NETWORKS, fmtAgo } from "@poly/core";
import { useApp } from "../lib/store";
import { useNow } from "../lib/hooks";
import {
  BRAND_KIT_ZIP_URL,
  POLYESTER_FULL_LOGO_DARK_SVG,
  POLYESTER_LOGOMARK_SVG,
} from "../brand";
import { Pill, SymbolSelect } from "./ui";
import { GlossaryDrawer } from "./Glossary";
import { PublicCacheStatus } from "./PublicCacheStatus";
import { WireSampleNotice } from "./WireSampleNotice";
import { WalletButton } from "./WalletButton";
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
  IconVolume,
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

export type AccountHeaderStatus = "locked" | "unlocked" | "unavailable";
export type AccountHeaderRegistration = (
  status: AccountHeaderStatus,
  lockAction: (() => Promise<void>) | null,
  lockDisabled: boolean,
) => void;

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

const INTRO_STORAGE_KEY = "poly-tools:intro:v1";

const NAV_GROUPS: Array<{ group: string; items: NavItem[] }> = [
  {
    group: "Account",
    items: [
      { to: "/account", label: "Overview", icon: <IconVault size={15} /> },
      { to: "/account/api", label: "API setup", icon: <IconKey size={15} /> },
      { to: "/account/trade", label: "Your Trades", icon: <IconTape size={15} /> },
      { to: "/account/orders", label: "Orders", icon: <IconBook size={15} /> },
      { to: "/account/pnl", label: "Profit and Loss", icon: <IconChart size={15} /> },
      { to: "/account/transactions", label: "Money Movements", icon: <IconFlow size={15} /> },
    ],
  },
  {
    group: "Market Data",
    items: [
      { to: "/", label: "Markets", icon: <IconDashboard size={15} /> },
      { to: "/tape", label: "Trades", icon: <IconTape size={15} /> },
      { to: "/book", label: "Order book", icon: <IconBook size={15} /> },
      { to: "/charts", label: "Price chart", icon: <IconChart size={15} /> },
      { to: "/heatmap", label: "Depth heatmap", icon: <IconActivity size={15} /> },
      { to: "/compare", label: "Compare prices", icon: <IconCompare size={15} /> },
    ],
  },
  {
    group: "Cross-Chain",
    items: [
      { to: "/zipper", label: "Bridge routes", icon: <IconZipper size={15} /> },
    ],
  },
  {
    group: "Toolkit & Docs",
    items: [
      { to: "/fees", label: "Fee schedule", icon: <IconVolume size={15} /> },
      { to: "/calc", label: "Calculators", icon: <IconCalc size={15} /> },
      { to: "/hub", label: "Start on testnet", icon: <IconHub size={15} /> },
      { to: "/sdk", label: "Developers: SDK", icon: <IconKey size={15} /> },
      { to: "/brand-kit", label: "Brand kit", icon: <IconLayers size={15} /> },
    ],
  },
];

const ROUTE_META: Record<
  string,
  { title: string; group: string; showSymbolSelector: boolean }
> = {
  "/": { title: "Markets", group: "Market Data", showSymbolSelector: true },
  "/account": { title: "Overview", group: "Account", showSymbolSelector: false },
  "/account/api": { title: "API setup", group: "Account", showSymbolSelector: false },
  "/account/trade": { title: "Your Trades", group: "Account", showSymbolSelector: false },
  "/account/orders": { title: "Orders", group: "Account", showSymbolSelector: false },
  "/account/order-book": { title: "Orders", group: "Account", showSymbolSelector: false },
  "/account/pnl": { title: "Profit and Loss", group: "Account", showSymbolSelector: false },
  "/account/transactions": { title: "Money Movements", group: "Account", showSymbolSelector: false },
  "/book": { title: "Order book", group: "Market Data", showSymbolSelector: true },
  "/tape": { title: "Trades", group: "Market Data", showSymbolSelector: true },
  "/charts": { title: "Price chart", group: "Market Data", showSymbolSelector: true },
  "/heatmap": { title: "Depth heatmap", group: "Market Data", showSymbolSelector: true },
  "/compare": { title: "Compare prices", group: "Market Data", showSymbolSelector: false },
  "/zipper": { title: "Bridge routes", group: "Cross-Chain", showSymbolSelector: false },
  "/flow": { title: "Money Movements", group: "Account", showSymbolSelector: false },
  "/fees": { title: "Fee schedule", group: "Toolkit & Docs", showSymbolSelector: false },
  "/calc": { title: "Calculators", group: "Toolkit & Docs", showSymbolSelector: true },
  "/hub": { title: "Start on testnet", group: "Toolkit & Docs", showSymbolSelector: false },
  "/sdk": { title: "Developers: SDK", group: "Toolkit & Docs", showSymbolSelector: true },
  "/portfolio": { title: "Overview", group: "Account", showSymbolSelector: false },
  "/brand-kit": { title: "Brand kit", group: "Toolkit & Docs", showSymbolSelector: false },
};

export function Layout() {
  const {
    apiEnv,
    dataSource,
    wireSampleUsed,
    symbol,
    setSymbol,
    theme,
    toggleTheme,
    connectionStatus,
    marketsError,
    marketsUpdatedAt,
    marketsRefreshing,
    marketsCacheStatus,
    refreshMarkets,
    pairs,
    assets,
  } = useApp();
  const [navOpen, setNavOpen] = useState(false);
  const [glossaryOpen, setGlossaryOpen] = useState(false);
  const [brandMenuOpen, setBrandMenuOpen] = useState(false);
  const [brandCopiedNote, setBrandCopiedNote] = useState<string | null>(null);
  const [accountHeaderStatus, setAccountHeaderStatus] = useState<AccountHeaderStatus>("locked");
  const [accountLockDisabled, setAccountLockDisabled] = useState(false);
  const accountLockActionRef = useRef<(() => Promise<void>) | null>(null);
  const registerAccountHeader = useCallback<AccountHeaderRegistration>(
    (status, lockAction, lockDisabled) => {
      accountLockActionRef.current = lockAction;
      setAccountHeaderStatus(status);
      setAccountLockDisabled(lockDisabled);
    },
    [],
  );
  const [introDismissed, setIntroDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(INTRO_STORAGE_KEY) === "dismissed";
    } catch {
      return false;
    }
  });
  const brandMenuRef = useRef<HTMLDivElement | null>(null);
  const brandTriggerRef = useRef<HTMLAnchorElement | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const navBurgerRef = useRef<HTMLButtonElement | null>(null);
  // The drawer is only off-canvas below the 960px breakpoint. Above it the
  // sidebar is always visible, so its focusability must never be removed.
  const [mobileNav, setMobileNav] = useState<boolean>(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 960px)").matches
      : false,
  );

  const loc = useLocation();
  const navigate = useNavigate();
  const now = useNow(2000);

  const meta = ROUTE_META[loc.pathname] ?? {
    title: "PolyTools",
    group: "Workspace",
    showSymbolSelector: false,
  };
  const isAccountRoute =
    loc.pathname === "/account" ||
    loc.pathname.startsWith("/account/") ||
    loc.pathname === "/portfolio";
  const accountHeaderKind = accountHeaderStatus === "unlocked"
    ? "up"
    : accountHeaderStatus === "unavailable"
      ? "down"
      : "warn";
  const accountHeaderLabel = accountHeaderStatus === "unlocked"
    ? "Unlocked"
    : accountHeaderStatus === "unavailable"
      ? "Unavailable"
      : "Locked";
  const accountHeaderTitle = accountHeaderStatus === "unavailable"
    ? "WebCrypto is unavailable in this browser"
    : accountHeaderStatus === "unlocked"
      ? "This tab's in-memory account session"
      : "No unlocked account session";

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
    brandTriggerRef.current?.focus();
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
    if (!brandMenuOpen) return;
    brandMenuRef.current?.querySelector<HTMLElement>("button, a")?.focus();
  }, [brandMenuOpen]);

  // Track the layout mode so the closed drawer can be removed from the tab
  // order on phones/tablets without ever hiding the desktop sidebar.
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(max-width: 960px)");
    const sync = () => setMobileNav(query.matches);
    sync();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", sync);
      return () => query.removeEventListener("change", sync);
    }
    query.addListener(sync);
    return () => query.removeListener(sync);
  }, []);

  // Hide the closed mobile drawer from focus and assistive technology, and keep
  // the page behind an open drawer from scrolling away underneath it.
  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const previousOverflow = document.body.style.overflow;
    if (mobileNav && navOpen) document.body.style.overflow = "hidden";
    const hidden = mobileNav && !navOpen;
    if (hidden) {
      // Resizing into the mobile layout must not strand focus in a subtree that
      // is about to become inert.
      if (sidebar.contains(document.activeElement)) navBurgerRef.current?.focus();
      sidebar.setAttribute("inert", "");
      sidebar.setAttribute("aria-hidden", "true");
    } else {
      sidebar.removeAttribute("inert");
      sidebar.removeAttribute("aria-hidden");
    }
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNav, navOpen]);

  // Move focus into the opened drawer, then hand it somewhere sensible on
  // close: the new page when a link was followed, otherwise the burger.
  const mobileNavTouched = useRef(false);
  const navFollowedLink = useRef(false);
  useEffect(() => {
    if (!mobileNav) return;
    if (navOpen) {
      mobileNavTouched.current = true;
      sidebarRef.current
        ?.querySelector<HTMLElement>(".nav-item")
        ?.focus();
    } else if (mobileNavTouched.current) {
      mobileNavTouched.current = false;
      const followed = navFollowedLink.current;
      navFollowedLink.current = false;
      if (followed) {
        document.getElementById("main-workspace")?.focus();
      } else {
        navBurgerRef.current?.focus();
      }
    }
  }, [mobileNav, navOpen]);

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
        if (brandMenuOpen) {
          setBrandMenuOpen(false);
          brandTriggerRef.current?.focus();
        } else if (navOpen) setNavOpen(false);
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

      <aside
        ref={sidebarRef}
        className={`sidebar ${navOpen ? "open" : ""}`}
        id="primary-navigation"
        aria-label="Primary navigation"
      >
        <div className="sidebar-header" style={{ position: "relative" }}>
          <NavLink
            ref={brandTriggerRef}
            to="/"
            className="brand"
            title="Left-click for Markets · Right-click or press Shift+F10 for Brand Kit quick actions"
            aria-expanded={brandMenuOpen}
            aria-controls="brand-quick-actions"
            onClick={() => {
              if (mobileNav) navFollowedLink.current = true;
              setNavOpen(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
                e.preventDefault();
                e.stopPropagation();
                setBrandMenuOpen(true);
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setBrandMenuOpen(true);
            }}
          >
            <img src="/favicon.svg" alt="Polyester symbol" className="logo-img" />
            <span className="brand-meta">
              <span>PolyTools</span>
              <span className="brand-sub">
                {brandCopiedNote ? `✓ ${brandCopiedNote}` : "Read-only"}
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
              ref={brandMenuRef}
              id="brand-quick-actions"
              className="brand-context-menu"
              role="group"
              aria-label="Polyester Brand Kit quick actions"
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  setBrandMenuOpen(false);
                }
              }}
            >
              <div className="brand-context-title mono">Polyester Brand Kit</div>
              <button
                type="button"
                className="brand-context-item"
                onClick={() => copyBrandSvg(POLYESTER_FULL_LOGO_DARK_SVG, "Copied full logo")}
              >
                Copy full logo SVG
              </button>
              <button
                type="button"
                className="brand-context-item"
                onClick={() => copyBrandSvg(POLYESTER_LOGOMARK_SVG, "Copied symbol")}
              >
                Copy symbol SVG
              </button>
              <a
                href={BRAND_KIT_ZIP_URL}
                target="_blank"
                rel="noreferrer"
                className="brand-context-item"
                onClick={() => {
                  setBrandMenuOpen(false);
                  brandTriggerRef.current?.focus();
                }}
              >
                Download brand assets (.zip) ↗
              </a>
              <button
                type="button"
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
                  end={item.to === "/" || item.to === "/account"}
                  className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}
                  onClick={() => {
                    if (mobileNav) navFollowedLink.current = true;
                    setNavOpen(false);
                  }}
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
          </div>
          <div className="sidebar-disclaimer">
            Public analytics for{" "}
            <a href={NETWORKS.testnet.appUrl} target="_blank" rel="noreferrer">
              Polyester ↗
            </a>
            . No login required for public data.
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button
            ref={navBurgerRef}
            type="button"
            className="burger"
            onClick={() => setNavOpen((v) => !v)}
            aria-label={navOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={navOpen}
            aria-controls="primary-navigation"
          >
            <IconMenu size={16} />
          </button>

          <div className="topbar-breadcrumb">
            <span className="topbar-crumb-group">{meta.group}</span>
            <span className="topbar-crumb-sep" aria-hidden="true">·</span>
            {/* Keep the network identity visible at every width. */}
            <span className="topbar-eyebrow">Read-only · {apiEnv}</span>
          </div>

          <div className="spacer" />

          <div className="topbar-controls">
            <WalletButton />

            {meta.showSymbolSelector && (
              <SymbolSelect
                value={symbol}
                onChange={setSymbol}
                ariaLabel="Active market symbol"
              />
            )}

            {marketsCacheStatus && marketsUpdatedAt ? (
              <PublicCacheStatus
                origin={marketsCacheStatus.origin}
                savedAt={marketsCacheStatus.savedAt}
                freshUntil={marketsCacheStatus.freshUntil}
                now={now}
                refreshing={marketsRefreshing}
                error={marketsError}
                sample={dataSource === "wire-samples"}
                onRetry={refreshMarkets}
              />
            ) : connectionStatus === "connected" ? (
              <span
                className={`pill ${dataSource === "wire-samples" ? "warn" : "up"}`}
                title={
                  dataSource === "wire-samples"
                    ? "Serving captured testnet wire samples (sandbox offline fallback)"
                    : marketsUpdatedAt
                      ? `Backend connected · Updated ${fmtAgo(marketsUpdatedAt, now)}`
                      : "Backend connected"
                }
              >
                <span className="dot live" />
                {dataSource === "wire-samples" ? "Sample data" : "Live"}
              </span>
            ) : connectionStatus === "connecting" ? (
              <span className="pill">
                <span className="dot" />
                Loading…
              </span>
            ) : (
              <button
                type="button"
                className="btn sm"
                onClick={refreshMarkets}
                title={`Connection issue: ${marketsError ?? "unreachable"}. Click to retry.`}
              >
                <IconRefresh size={12} />
                <span>Try again</span>
              </button>
            )}

            {isAccountRoute && (
              <>
                <Pill kind={accountHeaderKind} title={accountHeaderTitle}>
                  {accountHeaderLabel}
                </Pill>
                {accountHeaderStatus === "unlocked" && (
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={() => void accountLockActionRef.current?.()}
                    aria-label="Lock account"
                    disabled={accountLockDisabled}
                    title="Lock account; clears the session and private account data"
                  >
                    <IconVault size={13} />
                    <span>Lock</span>
                  </button>
                )}
              </>
            )}

            <button
              type="button"
              className="btn sm ghost"
              onClick={() => setGlossaryOpen(true)}
              title="Open plain-English definitions glossary"
              aria-label="Open the plain-English glossary"
            >
              <IconInfo size={13} />
              {/* The label stays at every width: the glossary is the main
                  beginner aid and a bare icon does not advertise itself. */}
              <span>Glossary</span>
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
          {wireSampleUsed && <WireSampleNotice />}
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

          <Outlet context={registerAccountHeader} />
        </main>

        <footer className="foot">
          <span>
            PolyTools · Read-only companion for Polyester ·{" "}
            {meta.group === "Account" ? (
              "Account amounts retain exact API decimal strings"
            ) : (
              <>Prices decoded via <code className="mono">raw ÷ 10³</code></>
            )}
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
