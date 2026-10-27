import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createServer } from "vite";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const source = (path) => readFileSync(resolve(rootDir, path), "utf8");
const render = (element) => renderToStaticMarkup(element);

let vite;
let Portfolio;
let AccountAnalytics;
let Layout;
let AppProvider;
let BrandKitPage;
let CopyButton;
let Countdown;
let HeatmapTextInspector;
let decodeHeatmapBuckets;
let inspectHeatmapCell;
let GLOSSARY_TERMS;

before(async () => {
  const storage = new Map();
  globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
    clear: () => storage.clear(),
  };

  vite = await createServer({
    root: rootDir,
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ({ default: Portfolio } = await vite.ssrLoadModule("/apps/web/src/pages/Portfolio.tsx"));
  ({ AccountAnalytics } = await vite.ssrLoadModule(
    "/apps/web/src/components/AccountAnalytics.tsx",
  ));
  ({ Layout } = await vite.ssrLoadModule("/apps/web/src/components/Layout.tsx"));
  ({ AppProvider } = await vite.ssrLoadModule("/apps/web/src/lib/store.tsx"));
  ({ BrandKitPage } = await vite.ssrLoadModule("/apps/web/src/pages/BrandKit.tsx"));
  ({ CopyButton, Countdown } = await vite.ssrLoadModule(
    "/apps/web/src/components/ui.tsx",
  ));
  ({ HeatmapTextInspector } = await vite.ssrLoadModule(
    "/apps/web/src/pages/Heatmap.tsx",
  ));
  ({ decodeHeatmapBuckets, inspectHeatmapCell } = await vite.ssrLoadModule(
    "/apps/web/src/lib/heatmap.ts",
  ));
  ({ GLOSSARY_TERMS } = await vite.ssrLoadModule(
    "/apps/web/src/components/Glossary.tsx",
  ));
});

after(async () => {
  if (vite) await vite.close();
});

function renderPortfolio(path) {
  return render(
    React.createElement(
      MemoryRouter,
      { initialEntries: [path] },
      React.createElement(Portfolio),
    ),
  );
}

function renderLayout(path) {
  return render(
    React.createElement(
      MemoryRouter,
      { initialEntries: [path] },
      React.createElement(AppProvider, null, React.createElement(Layout)),
    ),
  );
}

function normalDecoded() {
  return decodeHeatmapBuckets([
    {
      tsSec: 1700000000,
      bids: { price: ["99000", "100000"], qty: ["1", "2"] },
      asks: { price: ["101000"], qty: ["4"] },
    },
  ]);
}

describe("Phase 2 P2-5 account copy and lock consistency", () => {
  it("keeps key links on API setup and routes account locking through the global header", () => {
    const trades = renderPortfolio("/account/trade");
    const orders = renderPortfolio("/account/orders");
    const apiSetup = renderPortfolio("/account/api");
    assert.ok(trades.includes("Your fills. Public trades: Market Data → Trades."));
    assert.ok(orders.includes("Your open and completed orders, not the public book."));
    assert.ok(!trades.includes("Official API Keys"));
    assert.ok(!orders.includes("SDK Quickstart"));
    assert.ok(apiSetup.includes("Official API Keys"));
    assert.ok(apiSetup.includes("SDK Quickstart"));
    assert.ok(!source("apps/web/src/pages/Portfolio.tsx").includes('label="Connection"'));

    const portfolio = source("apps/web/src/pages/Portfolio.tsx");
    const layout = source("apps/web/src/components/Layout.tsx");
    assert.ok(portfolio.includes("registerAccountHeader"));
    assert.ok(!portfolio.includes("Lock now"));
    assert.ok(layout.includes('aria-label="Lock account"'));
  });

  it("separates realized mark independence from unrealized/total requirements", () => {
    const html = renderPortfolio("/account/pnl");
    const costBasis = source("apps/web/src/components/AccountCostBasis.tsx");
    assert.ok(html.includes("Realized P&amp;L needs no current mark"));
    assert.ok(costBasis.includes("Required for unrealized/total P&L, not realized"));
    assert.ok(costBasis.includes("Complete fills, opening basis, and resolved flows required"));
  });

  it("describes authenticated read-only scope and the experimental R3 path honestly", () => {
    const readOnly = GLOSSARY_TERMS.find((entry) => entry.term === "Read-only");
    assert.ok(readOnly);
    assert.ok(readOnly.definition.includes("Public market and bridge reads need no account key"));
    assert.ok(readOnly.definition.includes("approved read-only account requests"));
    assert.ok(readOnly.definition.includes("never places or cancels orders or moves tokens"));

    const readme = source("README.md");
    assert.ok(readme.includes("Experimental, user-assisted exact FIFO or moving-weighted-average"));
    assert.ok(readme.includes("realized output is independently gated"));
    assert.ok(readme.includes("unrealized/total also require fresh marks"));
    assert.ok(readme.includes("Not verified tax output"));
  });

  it("uses exact-decimal footer copy on account routes and wire scaling on public routes", () => {
    const account = renderLayout("/account/trade");
    assert.ok(account.includes("Account amounts retain exact API decimal strings"));
    assert.ok(!account.includes("raw ÷ 10³"));

    const publicMarket = renderLayout("/tape");
    assert.ok(publicMarket.includes("raw ÷ 10³"));
    assert.ok(!publicMarket.includes("Account amounts retain exact API decimal strings"));
  });
});

describe("Phase 2 P2-6 cancellation and section lifecycle", () => {
  it("adds a non-error cancellation notice without merging the cancelled prefix", () => {
    const analytics = source("apps/web/src/components/AccountAnalytics.tsx");
    const start = analytics.indexOf("const cancelImport = useCallback");
    const end = analytics.indexOf("}, []);", start);
    assert.ok(start >= 0 && end > start);
    const cancel = analytics.slice(start, end);
    assert.ok(cancel.includes("importRequestRef.current.abort()"));
    assert.ok(cancel.includes("setImportNotice"));
    assert.ok(cancel.includes("Import cancelled; previous snapshot retained"));
    assert.ok(cancel.includes("cancelled prefix was not merged"));
    assert.ok(!cancel.includes("setSnapshot"));
    assert.ok(analytics.includes('{importNotice && <div className="notice info" role="status"'));
  });

  it("discloses unlocked-session memory without adding private persistence", () => {
    const html = render(
      React.createElement(AccountAnalytics, {
        accountVault: null,
        session: null,
        view: "pnl",
      }),
    );
    assert.ok(html.includes("Unlocked-session memory"));
    assert.ok(html.includes("shared across Account views in memory only"));
    assert.ok(html.includes("Locking, changing, importing, or wiping the vault clears them"));
    assert.ok(html.includes("No private response is persisted"));

    const portfolio = source("apps/web/src/pages/Portfolio.tsx");
    assert.ok(portfolio.includes('<AccountAnalytics owner={accountDataOwner} session={session} view={analyticsView} active={privateAnalyticsActive} />'));
    assert.equal((portfolio.match(/<AccountAnalytics/g) ?? []).length, 1, "Portfolio keeps one stable account-data observer");
    assert.ok(!portfolio.includes('{section === "pnl" && <AccountAnalytics'));
    const costBasis = source("apps/web/src/components/AccountCostBasis.tsx");
    for (const forbidden of ["localStorage", "sessionStorage", "indexedDB"]) {
      assert.ok(!costBasis.includes(forbidden), forbidden);
    }
  });
});

describe("Phase 2 P2-7 visualization and control semantics", () => {
  it("inspects exact heatmap cells and rejects invalid indices", () => {
    const decoded = normalDecoded();
    assert.ok(decoded);
    const first = inspectHeatmapCell(decoded, 0, 0);
    assert.equal(first.tsSec, 1700000000);
    assert.equal(first.priceLow, 99);
    assert.equal(first.bidQty, 1);
    assert.equal(first.askQty, 0);

    const last = inspectHeatmapCell(decoded, 0, 35);
    assert.equal(last.priceHigh, 101);
    assert.equal(last.bidQty, 0);
    assert.equal(last.askQty, 4);
    assert.equal(inspectHeatmapCell(decoded, -1, 0), null);
    assert.equal(inspectHeatmapCell(decoded, 0, 36), null);
    assert.equal(inspectHeatmapCell(decoded, 0.5, 0), null);
  });

  it("renders native heatmap selectors and a complete textual cell readout", () => {
    const decoded = normalDecoded();
    const html = render(
      React.createElement(HeatmapTextInspector, {
        decoded,
        base: "BTC",
        quote: "ETH",
      }),
    );
    assert.ok(html.includes("Keyboard and text inspection"));
    assert.ok(html.includes('aria-label="Heatmap time bucket"'));
    assert.ok(html.includes('aria-label="Heatmap price band in ETH"'));
    assert.equal((html.match(/<option/g) ?? []).length, 37);
    assert.ok(html.includes("Selected cell:"));
    assert.ok(html.includes("Resting bid"));
    assert.ok(html.includes("Resting ask"));
    assert.ok(html.includes("ETH"));

    const narrow = decodeHeatmapBuckets([
      {
        tsSec: 1700000000,
        bids: { price: ["10000000", "10000001"], qty: ["1", "1"] },
        asks: { price: [], qty: [] },
      },
    ]);
    const narrowHtml = render(
      React.createElement(HeatmapTextInspector, {
        decoded: narrow,
        base: "BTC",
        quote: "USD",
      }),
    );
    const optionLabels = [...narrowHtml.matchAll(/<option[^>]*>([^<]+)<\/option>/g)]
      .map((match) => match[1])
      .slice(1);
    assert.equal(optionLabels.length, 36);
    assert.equal(new Set(optionLabels).size, 36);

    const heatmap = source("apps/web/src/pages/Heatmap.tsx");
    assert.ok(heatmap.includes("setHoverCell(inspectHeatmapCell(decoded, bucketIdx, binIdx))"));
    assert.ok(heatmap.includes("<HeatmapTextInspector decoded={decoded}"));
  });

  it("uses pressed native groups instead of incomplete tab semantics", () => {
    const brand = render(React.createElement(BrandKitPage));
    assert.ok(brand.includes('role="group" aria-label="Brand kit sections"'));
    assert.ok(!brand.includes('role="tablist"'));
    assert.ok(!brand.includes('role="tab"'));
    assert.ok(brand.includes('aria-pressed="true"'));

    const api = renderPortfolio("/account/api");
    assert.ok(api.includes('role="group" aria-label="Key creation mode"'));
    assert.ok(!api.includes('role="tablist"'));
    assert.ok(!api.includes('role="tab"'));
    assert.ok(api.includes('aria-pressed="true"'));
  });

  it("exposes Brand quick actions as a focusable native group, not an unsupported menu", () => {
    const layout = source("apps/web/src/components/Layout.tsx");
    assert.ok(layout.includes('role="group"'));
    assert.ok(!layout.includes('role="menu"'));
    assert.ok(!layout.includes('role="menuitem"'));
    assert.ok(layout.includes('querySelector<HTMLElement>("button, a")?.focus()'));
    assert.ok(layout.includes('e.key === "ContextMenu"'));
    assert.ok(layout.includes('e.shiftKey && e.key === "F10"'));
    assert.ok(layout.includes("brandTriggerRef.current?.focus()"));

    const html = renderLayout("/");
    assert.ok(html.includes('aria-controls="brand-quick-actions"'));
    assert.ok(html.includes('aria-expanded="false"'));
  });

  it("gives copy actions concise accessible names", () => {
    const plain = render(React.createElement(CopyButton, { text: "synthetic" }));
    assert.ok(plain.includes('aria-label="Copy"'));
    assert.ok(!plain.includes("Copy Copy"));

    const snippet = render(
      React.createElement(CopyButton, { text: "synthetic", label: "Copy Snippet" }),
    );
    assert.ok(snippet.includes('aria-label="Copy Snippet"'));
    assert.ok(!snippet.includes("Copy Copy"));

    const identifier = render(
      React.createElement(CopyButton, { text: "synthetic", label: "#abc123" }),
    );
    assert.ok(identifier.includes('aria-label="Copy #abc123"'));
  });

  it("keeps the per-second countdown readable on demand without live announcements", () => {
    const html = render(
      React.createElement(Countdown, {
        to: Date.now() + 60_000,
        label: "Synthetic countdown",
      }),
    );
    assert.ok(html.includes('role="timer"'));
    assert.ok(html.includes('aria-live="off"'));
    assert.ok(!html.includes('aria-live="polite"'));
  });
});
