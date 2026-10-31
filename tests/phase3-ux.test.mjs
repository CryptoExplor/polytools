import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createServer } from "vite";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
// Normalised so a Windows checkout (CRLF) asserts the same as a Unix one.
const source = (path) =>
  readFileSync(`${rootDir}/${path}`, "utf8").replace(/\r\n/g, "\n");
const render = (element) => renderToStaticMarkup(element);

let vite;
let clipboard;
let navigation;
let BrandFilterEmptyState;
let Portfolio;
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
  clipboard = await vite.ssrLoadModule("/apps/web/src/lib/clipboard.ts");
  navigation = await vite.ssrLoadModule("/apps/web/src/lib/navigation.ts");
  ({ BrandFilterEmptyState } = await vite.ssrLoadModule("/apps/web/src/pages/BrandKit.tsx"));
  ({ default: Portfolio } = await vite.ssrLoadModule("/apps/web/src/pages/Portfolio.tsx"));
  ({ GLOSSARY_TERMS } = await vite.ssrLoadModule("/apps/web/src/components/Glossary.tsx"));
});

after(async () => {
  if (vite) await vite.close();
});

function renderPortfolio(path) {
  return render(React.createElement(
    MemoryRouter,
    { initialEntries: [path] },
    React.createElement(Portfolio),
  ));
}

describe("P3-1 small copy, empty states, and clipboard outcomes", () => {
  it("returns clipboard success/failure and exposes a useful retry presentation", async () => {
    let received = null;
    assert.equal(await clipboard.copyTextToClipboard("synthetic text", async (text) => {
      received = text;
    }), true);
    assert.equal(received, "synthetic text");
    assert.equal(await clipboard.copyTextToClipboard("secret-free text", async () => {
      throw new Error("synthetic denied clipboard");
    }), false);

    assert.deepEqual(
      clipboard.copyButtonPresentation("idle", "URL", "Copied"),
      { visibleLabel: "URL", accessibleLabel: "Copy URL" },
    );
    assert.equal(
      clipboard.copyButtonPresentation("copied", "URL", "Copied").accessibleLabel,
      "Copied",
    );
    const failed = clipboard.copyButtonPresentation("failed", "URL", "Copied");
    assert.equal(failed.visibleLabel, "Copy failed");
    assert.ok(failed.accessibleLabel.includes("Try again or copy the text manually"));
    assert.ok(failed.title.includes("Clipboard access failed"));

    const ui = source("apps/web/src/components/ui.tsx");
    assert.ok(ui.includes('setStatus(succeeded ? "copied" : "failed")'));
    assert.ok(ui.includes('aria-live="polite"'));
    assert.ok(!ui.includes("ignore clipboard error"));
  });

  it("renders resettable Brand filter empty states with escaped queries", () => {
    for (const [kind, title] of [
      ["token", "No token packshots match"],
      ["avatar", "No Polybot avatars match"],
    ]) {
      const html = render(React.createElement(BrandFilterEmptyState, {
        kind,
        query: "<not-a-token>",
        onClear: () => undefined,
      }));
      assert.ok(html.includes(title));
      assert.ok(html.includes("&lt;not-a-token&gt;"));
      assert.ok(!html.includes("<not-a-token>"));
      assert.ok(html.includes("Clear Filter"));
    }
    const brand = source("apps/web/src/pages/BrandKit.tsx");
    assert.ok(brand.includes("filteredTokens.length === 0"));
    assert.ok(brand.includes("filteredAvatars.length === 0"));
    assert.ok(brand.includes('onClear={() => setTokenQuery("")}'));
    assert.ok(brand.includes('onClear={() => setAvatarQuery("")}'));
  });

  it("labels Zipper config and deposit estimates without independent verification claims", () => {
    const zipper = source("apps/web/src/pages/Zipper.tsx");
    assert.ok(zipper.includes("not independently verified by PolyTools"));
    assert.ok(!zipper.includes("Verified contract addresses"));
    assert.ok(zipper.includes("Illustrative Deposit Net"));
    assert.ok(zipper.includes("checks the deposit minimum only"));
    assert.ok(zipper.includes("not a\n              withdrawal or executable transfer quote"));
    assert.ok(!zipper.includes("come from live Zipper"));
  });
});

describe("P3-1/P3-2 public Flow scope and Worker wording", () => {
  it("preserves redirect query parameters and derives Money Movement scope from the URL", () => {
    assert.equal(
      navigation.accountRedirectTarget("/account/transactions", "?mode=by-tx&q=0xabc", "public"),
      "/account/transactions?mode=by-tx&q=0xabc&scope=public",
    );
    assert.equal(navigation.accountRedirectTarget("/account/api", ""), "/account/api");
    assert.equal(navigation.moneyMovementScope("?scope=public"), "all");
    assert.equal(navigation.moneyMovementScope("?scope=other"), "mine");
    assert.equal(
      navigation.withMoneyMovementScope("?mode=explain&q=abc", "all").toString(),
      "mode=explain&q=abc&scope=public",
    );
    assert.equal(
      navigation.withMoneyMovementScope("?mode=explain&q=abc&scope=public", "mine").toString(),
      "mode=explain&q=abc",
    );

    assert.ok(source("apps/web/src/App.tsx").includes('to="/account/transactions" scope="public"'));
    assert.ok(source("apps/web/src/pages/Flow.tsx").includes('if (embedded) params.scope = "public"'));
  });

  it("opens the legacy Flow destination directly in public lookup without private data", () => {
    const publicHtml = renderPortfolio("/account/transactions?scope=public&mode=explain");
    assert.ok(publicHtml.includes("Lifecycle Trace Query"));
    assert.ok(publicHtml.includes("Public transaction lookup"));
    assert.ok(!publicHtml.includes("Unlock to view your transfers"));

    const privateHtml = renderPortfolio("/account/transactions");
    assert.ok(privateHtml.includes("Unlock to view your transfers"));
    assert.ok(!privateHtml.includes("Lifecycle Trace Query"));
  });

  it("keeps account read-only guarantees while naming the optional Telegram side effect", () => {
    const readOnly = GLOSSARY_TERMS.find((term) => term.term === "Read-only");
    assert.ok(readOnly.definition.includes("never places or cancels orders or moves tokens"));
    assert.ok(readOnly.definition.includes("POST public-mover alerts to Telegram"));
    assert.ok(readOnly.definition.includes("separate notification secrets, not account keys"));

    const readme = source("README.md");
    assert.ok(readme.includes("POSTs notifications to"));
    assert.ok(readme.includes("Telegram every 15 minutes"));
    assert.ok(readme.includes("not an exchange-account"));
    assert.ok(readme.includes("Account reads remain read-only"));
  });
});
