/**
 * Batch 1 frontend guards: one page heading, de-duplicated page titles, a
 * single symbol control, shortened copy that still keeps its meaning, cache
 * provenance at every width, the /portfolio redirect, neutral retry styling, and
 * the mobile-drawer focus contract.
 *
 * Scope limits, deliberately: these are source- and markup-level assertions.
 * They cannot prove how a page looks at 390/768/1280 px, and they cannot prove
 * keyboard focus, inert behaviour, or backdrop dismissal in a real browser.
 * Those need the recorded manual pass described in
 * docs/frontend-audit/REMAINING_WORK.md.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const source = (path) => readFileSync(resolve(rootDir, path), "utf8");
const render = (element) => renderToStaticMarkup(element);

const PAGE_FILES = [
  "Dashboard", "Book", "Tape", "Charts", "Heatmap", "Compare", "Zipper",
  "Calc", "Hub", "SdkGuide", "BrandKit", "Portfolio", "Flow",
];

let vite;
let ui;
let cacheStatus;
let navigation;

before(async () => {
  vite = await createServer({
    root: rootDir,
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ui = await vite.ssrLoadModule("/apps/web/src/components/ui.tsx");
  ({ PublicCacheStatus: cacheStatus } = await vite.ssrLoadModule(
    "/apps/web/src/components/PublicCacheStatus.tsx",
  ));
  navigation = await vite.ssrLoadModule("/apps/web/src/lib/navigation.ts");
});

after(async () => {
  if (vite) await vite.close();
});

describe("Batch 1 headings and de-duplicated titles", () => {
  it("renders the page title as the single h1 and keeps badges separate", () => {
    const html = render(
      React.createElement(ui.PageHeader, {
        title: "Order book · BTC-USDT",
        subtitle: "Bids and asks.",
        badge: React.createElement("span", null, "testnet"),
        actions: React.createElement("button", { type: "button" }, "Try again"),
      }),
    );
    assert.equal((html.match(/<h1/g) ?? []).length, 1, "exactly one h1 per page");
    assert.ok(html.includes("<h1>Order book · BTC-USDT</h1>"));
    assert.ok(!html.includes("<h2"), "the page header must not contain a second heading");
    assert.ok(!html.includes("Read-only · Testnet"), "the static eyebrow copy is gone");
  });

  it("keeps one heading level per card and never reuses the page title", () => {
    const html = render(
      React.createElement(
        ui.Card,
        { title: "Alerts", subtitle: "Alerts stay in this browser." },
        React.createElement("p", null, "body"),
      ),
    );
    assert.ok(html.includes('<h2 class="panel-title">Alerts</h2>'));
    assert.ok(!html.includes("<h3"), "panel titles use h2 under the page h1");
    assert.ok(!html.includes("<h1"), "cards never render a second h1");
  });

  it("removes the duplicated in-page headings for pages the shell already titles", () => {
    // The only h1 in each page module must come from the shared PageHeader.
    for (const pageFile of PAGE_FILES) {
      const page = source(`apps/web/src/pages/${pageFile}.tsx`);
      assert.ok(!page.includes("<h1"), `${pageFile} must not hand-roll its own h1`);
    }
    const appShell = source("apps/web/src/components/Layout.tsx");
    assert.ok(appShell.includes("topbar-crumb-current"), "the breadcrumb carries the page name");
  });
});

describe("Batch 1 one name per destination", () => {
  it("gives each route the same short name in the sidebar and the topbar", () => {
    const layout = source("apps/web/src/components/Layout.tsx");
    const navPairs = [...layout.matchAll(/\{ to: "([^"]+)", label: "([^"]+)"/g)]
      .map((m) => [m[1], m[2]]);
    const metaPairs = [...layout.matchAll(/^  "([^"]+)": \{ title: "([^"]+)"/gm)]
      .map((m) => [m[1], m[2]]);
    const meta = new Map(metaPairs);
    assert.ok(navPairs.length >= 17, "every nav item is parsed");
    const mismatches = navPairs
      .filter(([to, label]) => meta.has(to) && meta.get(to) !== label)
      .map(([to, label]) => `${to}: nav "${label}" vs topbar "${meta.get(to)}"`);
    assert.deepEqual(mismatches, []);
  });

  it("keeps the page heading consistent with that short name", () => {
    const expected = {
      "Dashboard": "Markets",
      "Book": "Order book",
      "Tape": "Trades",
      "Charts": "Price chart",
      "Heatmap": "Depth heatmap",
      "Compare": "Compare prices",
      "Zipper": "Bridge routes",
      "Calc": "Calculators",
      "Hub": "Start on testnet",
      "SdkGuide": "Developers: SDK",
      "BrandKit": "Polyester brand kit",
    };
    for (const [file, title] of Object.entries(expected)) {
      const page = source(`apps/web/src/pages/${file}.tsx`);
      const header = page.slice(page.indexOf("<PageHeader"));
      const match = header.match(/title=(?:"([^"]+)"|\{`([^`]*)`\})/);
      assert.ok(match, `${file} renders a PageHeader title`);
      const heading = match[1] ?? match[2] ?? "";
      assert.ok(
        heading.toLowerCase().includes(title.toLowerCase()),
        `${file} heading "${heading}" should contain the short name "${title}"`,
      );
    }
  });
});

describe("Batch 1 single symbol control", () => {
  it("renders the symbol selector once, in the shell, not per page", () => {
    const layout = source("apps/web/src/components/Layout.tsx");
    assert.ok(layout.includes("<SymbolSelect"), "the shell owns the only selector");
    for (const pageFile of PAGE_FILES) {
      const page = source(`apps/web/src/pages/${pageFile}.tsx`);
      assert.ok(!page.includes("<SymbolSelect"), `${pageFile} must not render a second selector`);
      assert.ok(!page.includes("SymbolSelect,"), `${pageFile} must not import the removed selector`);
    }
  });
});

describe("Batch 1 shortened copy keeps its meaning", () => {
  it("states that public pages never use an account key", () => {
    for (const pageFile of ["Tape", "Book"]) {
      assert.ok(
        source(`apps/web/src/pages/${pageFile}.tsx`).includes("No account key is used"),
        `${pageFile} keeps the read-only/no-key statement`,
      );
    }
  });

  it("keeps the missing-data reasons that explain an empty public view", () => {
    const compare = source("apps/web/src/pages/Compare.tsx");
    assert.ok(compare.includes("unmapped assets"));
    assert.ok(compare.includes("non-USD quotes"));
    assert.ok(compare.includes("invalid prices"));
    const heatmap = source("apps/web/src/pages/Heatmap.tsx");
    assert.ok(heatmap.includes("zero size"), "the heatmap explains why the window can be empty");
    assert.ok(heatmap.includes("Try a longer window or another market."));
    const book = source("apps/web/src/pages/Book.tsx");
    assert.ok(book.includes("bids") && book.includes("asks"), "order-book terms stay explicit");
    const charts = source("apps/web/src/pages/Charts.tsx");
    assert.ok(charts.includes("arrow keys"), "the keyboard affordance stays discoverable");
  });

  it("keeps the SDK testnet-order warning visible before any snippet", () => {
    const sdk = source("apps/web/src/pages/SdkGuide.tsx");
    const warning = sdk.indexOf("PolyTools does not run this code.");
    const firstCard = sdk.indexOf("<Card");
    assert.ok(warning >= 0, "the mutation warning exists");
    assert.ok(warning < firstCard, "the warning is rendered above the snippet cards");
    assert.ok(sdk.includes('role="note"'), "the warning is announced as a note");
  });

  it("uses one load label because one click still runs every read for the view", () => {
    const analytics = source("apps/web/src/components/AccountAnalytics.tsx");
    assert.ok(analytics.includes('const loadLabel = "Load account data"'));
    assert.ok(analytics.includes('const refreshLabel = "Refresh account data"'));
    for (const stale of ["Load your trades", "Load your orders", "Load money movements", "Load P&L inputs"]) {
      assert.ok(!analytics.includes(stale), `${stale} implies per-section loading`);
    }
    // The reads themselves are unchanged: this batch only renamed the action,
    // so one click still performs the whole view load.
    assert.ok(analytics.includes("account.fetchOfficialSpotCatalog("), "the same read path is still used");
    assert.ok(analytics.includes("const load = useCallback(async (explicit = false)"), "one load entry point");
  });
});

describe("Batch 1 freshness and retry vocabulary", () => {
  it("says Loading… and Waiting for data instead of internal wording", () => {
    const first = render(
      React.createElement(ui.DataFreshness, { updatedAt: null, refreshing: true, onRefresh: () => undefined }),
    );
    assert.ok(first.includes("Loading…"), "a first refresh in flight reads as Loading");
    assert.ok(!first.includes("Syncing"));

    const updated = render(React.createElement(ui.DataFreshness, { updatedAt: 1_000 }));
    assert.ok(updated.includes("Updated "), "a loaded view reports its age as Updated");

    const empty = render(React.createElement(ui.DataFreshness, { updatedAt: null }));
    assert.ok(empty.includes("Waiting for data"));
    assert.ok(!empty.includes("No data yet"));
  });

  it("offers Try again, not Retry now, in the shared error box", () => {
    const html = render(
      React.createElement(ui.ErrorBox, {
        error: "synthetic unreachable endpoint",
        onRetry: () => undefined,
      }),
    );
    assert.ok(html.includes("Try again"));
    assert.ok(!html.includes("Retry now"));
    assert.ok(html.includes("Cannot reach the market data service."));
  });

  it("leaves no internal Retry wording in user-facing copy", () => {
    const offenders = [];
    for (const pageFile of PAGE_FILES) {
      const file = source(`apps/web/src/pages/${pageFile}.tsx`);
      for (const pattern of [">Retry<", "Retry now", "Retry Both", "Retry the read"]) {
        if (file.includes(pattern)) offenders.push(`${pageFile}: ${pattern}`);
      }
    }
    const components = ["ui", "Layout", "PublicCacheStatus", "AccountAnalytics"];
    for (const name of components) {
      const file = source(`apps/web/src/components/${name}.tsx`);
      for (const pattern of [">Retry<", "Retry now", "Retry Both", "Retry the read"]) {
        if (file.includes(pattern)) offenders.push(`${name}: ${pattern}`);
      }
    }
    assert.deepEqual(offenders, []);
  });

  it("keeps the retry control neutral instead of danger-styled", () => {
    const cache = source("apps/web/src/components/PublicCacheStatus.tsx");
    assert.ok(!/btn sm danger/.test(cache), "a retry is not a destructive action");
    assert.ok(cache.includes("Try again"));
    const layout = source("apps/web/src/components/Layout.tsx");
    assert.ok(!/btn sm danger/.test(layout));
  });

  it("keeps cache provenance and age visible at every width", () => {
    const html = render(
      React.createElement(cacheStatus, {
        origin: "persistent",
        savedAt: 100_000,
        freshUntil: 200_000,
        now: 105_000,
        refreshing: false,
        error: null,
        sample: false,
        onRetry: () => undefined,
      }),
    );
    assert.ok(html.includes("Cached metadata"), "the fresh state still names the cache");
    assert.ok(html.includes("IndexedDB"), "the store is still identified");
    assert.ok(html.includes("5s ago"), "the age is still shown");
    assert.ok(!html.includes("hide-xs"), "the freshness signal is not hidden on small screens");
    assert.ok(!html.includes("danger"), "the retry stays neutral");
  });
});

describe("Batch 1 routing", () => {
  it("sends the legacy /portfolio path to the account overview", () => {
    const app = source("apps/web/src/App.tsx");
    assert.ok(app.includes('<AccountRedirect to="/account" />'));
    assert.ok(!app.includes('<AccountRedirect to="/account/api" />'));
    assert.equal(navigation.accountRedirectTarget("/account", "", undefined), "/account");
    assert.equal(navigation.accountRedirectTarget("/account", "?x=1"), "/account?x=1");
  });
});

describe("Batch 1 responsive stylesheet contract", () => {
  const css = source("apps/web/src/styles.css");
  const mediaStart = css.indexOf("@media (max-width: 960px) {");
  const blockFrom = (start) => {
    let depth = 0;
    for (let i = css.indexOf("{", start); i < css.length; i += 1) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") {
        depth -= 1;
        if (depth === 0) return css.slice(start, i + 1);
      }
    }
    return "";
  };

  it("keeps the off-canvas drawer inside the 960px breakpoint only", () => {
    assert.ok(mediaStart > 0, "the mobile breakpoint exists");
    const mobileBlock = blockFrom(mediaStart);
    assert.ok(mobileBlock.includes("transform: translateX(-100%)"), "closed drawer is off-canvas on mobile");
    assert.ok(mobileBlock.includes(".sidebar.open"), "the open state restores it");
    assert.ok(mobileBlock.includes(".burger"), "the trigger only appears on mobile");

    const desktopCss = css.slice(0, mediaStart);
    const baseSidebarStart = desktopCss.lastIndexOf(".sidebar {");
    const baseSidebar = blockFrom(baseSidebarStart);
    assert.ok(baseSidebar.length > 0, "the base sidebar rule is found");
    assert.ok(!/transform:\s*translateX\(-100%\)/.test(baseSidebar), "the desktop sidebar is never translated away");
    assert.ok(!/display:\s*none/.test(baseSidebar), "the desktop sidebar is never display:none");

    const burgerStart = css.indexOf(".burger {");
    const baseBurger = blockFrom(burgerStart);
    assert.ok(/display:\s*none/.test(baseBurger), "the burger is hidden above the breakpoint");
  });

  it("keeps the page heading and numeric alignment styles", () => {
    assert.ok(css.includes(".page-header-info h1"), "the h1 is styled where the h2 used to be");
    const numeric = css.slice(css.indexOf("table.data td"));
    assert.ok(numeric.includes("tabular-nums"), "table figures align on one digit grid");
  });
});

describe("Batch 1 mobile drawer contract", () => {
  it("only hides the sidebar when the layout is narrow AND the drawer is closed", () => {
    const layout = source("apps/web/src/components/Layout.tsx");
    assert.ok(
      layout.includes("const hidden = mobileNav && !navOpen"),
      "desktop keeps the sidebar focusable while navOpen is false",
    );
    assert.ok(layout.includes('matchMedia("(max-width: 960px)")'));
    assert.ok(layout.includes('sidebar.setAttribute("inert", "")'));
    assert.ok(layout.includes('sidebar.removeAttribute("inert")'));
    assert.ok(
      !/inert=\{!navOpen\}|inert=\{navOpen\s*\?\s*""/.test(layout),
      "no JSX-level inert that would disable the desktop sidebar",
    );
  });

  it("wires the trigger, Escape, the backdrop, and focus restoration", () => {
    const layout = source("apps/web/src/components/Layout.tsx");
    assert.ok(layout.includes('aria-expanded={navOpen}'));
    assert.ok(layout.includes('aria-controls="primary-navigation"'));
    assert.ok(layout.includes('aria-label={navOpen ? "Close navigation menu" : "Open navigation menu"}'));
    assert.ok(layout.includes('e.key === "Escape"'), "Escape closes the drawer");
    assert.ok(layout.includes("sidebar-backdrop"), "the backdrop is present");
    assert.ok(layout.includes("onClick={() => setNavOpen(false)}"), "the backdrop dismisses the drawer");
    assert.ok(layout.includes("navBurgerRef.current?.focus()"), "focus returns to the trigger");
    assert.ok(layout.includes('document.getElementById("main-workspace")?.focus()'));
    assert.ok(
      layout.includes("if (mobileNav) navFollowedLink.current = true"),
      "following a link hands focus to the new page instead of the burger",
    );
    assert.ok(layout.includes('querySelector<HTMLElement>(".nav-item")'), "focus enters the drawer");
  });
});

describe("Batch 1 mobile data visibility", () => {
  const css = source("apps/web/src/styles.css");
  const layout = source("apps/web/src/components/Layout.tsx");
  const tape = source("apps/web/src/pages/Tape.tsx");
  const book = source("apps/web/src/pages/Book.tsx");

  it("hides no data cell or status badge behind a width class", () => {
    for (const [name, text] of [["Layout", layout], ["Tape", tape], ["Book", book]]) {
      assert.ok(!/className="[^"]*\bhide-(xs|sm)\b/.test(text), `${name} must not hide content by width`);
    }
    assert.ok(!css.includes(".hide-xs"), "the hiding utility is gone");
    assert.ok(!css.includes(".hide-sm"), "the hiding utility is gone");
  });

  it("keeps the environment badge at every width", () => {
    assert.ok(layout.includes("<span className=\"topbar-eyebrow\">"), "the badge carries no width class");
    assert.ok(layout.includes("Read-only · {apiEnv}"), "it still names the network");
  });

  it("restacks the tape row instead of dropping the match column", () => {
    const mobile = css.slice(css.indexOf("@media (max-width: 960px)"));
    assert.ok(mobile.includes(".tape-row .tape-mid"), "the match id moves rather than disappears");
    assert.ok(mobile.includes("grid-column: 1 / -1"), "it takes its own line");
    assert.ok(!mobile.includes(".tape-notional {\n    display: none"), "notional stays visible");
  });

  it("keeps four ladder columns and a visible notional on phones", () => {
    const small = css.slice(css.indexOf("@media (max-width: 600px)"));
    assert.ok(small.includes(".ladder-head,\n  .ladder .row"), "the ladder is retuned, not trimmed");
    assert.ok(small.includes("minmax(0, 1.05fr)"), "the notional column keeps a share of the width");
    const baseRule = css.slice(css.indexOf(".ladder-head {"), css.indexOf("}", css.indexOf(".ladder-head {")));
    const tracks = baseRule.match(/grid-template-columns:\s*([^;]+);/)[1].trim().split(/\s+/);
    assert.equal(tracks.length, 4, "price, size, total, and notional");
  });
});

describe("Batch 1 route code splitting", () => {
  const app = source("apps/web/src/App.tsx");

  it("keeps only the landing route in the initial bundle", () => {
    assert.ok(app.includes('import Dashboard from "./pages/Dashboard";'), "the landing page ships up front");
    assert.equal(
      (app.match(/^import .* from "\.\/pages\//gm) ?? []).length,
      1,
      "no other page may be imported eagerly",
    );
  });

  it("lazy-loads every other page and wraps the routes in one fallback", () => {
    for (const page of ["Book", "Charts", "Compare", "Zipper", "Calc", "Hub", "SdkGuide", "Portfolio"]) {
      assert.ok(
        app.includes(`const ${page} = lazy(() => import("./pages/${page}"));`),
        `${page} is lazily imported`,
      );
    }
    assert.ok(app.includes('import("./pages/Heatmap").then((module) => ({ default: module.HeatmapPage }))'));
    assert.ok(app.includes('import("./pages/BrandKit").then((module) => ({ default: module.BrandKitPage }))'));
    assert.ok(app.includes("const Tape = lazy(() => import(\"./pages/Tape\"));"));
    assert.ok(app.includes("<Suspense fallback={<RoutePending />}>"), "one fallback wraps every route");
    assert.ok(app.includes('role="status"'), "the fallback announces itself instead of showing a blank screen");
  });

  it("keeps every route path and the redirects unchanged", () => {
    for (const path of ["book", "tape", "charts", "heatmap", "compare", "zipper", "calc", "hub", "sdk", "brand-kit"]) {
      assert.ok(app.includes(`path="${path}"`), `route ${path} still exists`);
    }
    assert.ok(app.includes('path="account/*" element={<Portfolio />}'));
    assert.ok(app.includes('path="flow" element={<AccountRedirect to="/account/transactions" scope="public" />}'));
    assert.ok(app.includes('path="portfolio" element={<AccountRedirect to="/account" />}'));
    assert.ok(app.includes('<Route index element={<Dashboard />} />'));
  });
});
