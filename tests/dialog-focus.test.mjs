/**
 * P1-7 / P1-11 / P1-12: one focus contract for every overlay, a glossary
 * affordance that survives mobile widths, and account tabs that fit a phone.
 *
 * What these tests can prove: the markup, the shared hook wiring, unique ids,
 * the label set, and that no dialog still hard-codes an id.
 *
 * What they cannot prove: that Tab actually cycles, that Escape closes, that
 * focus returns to the opener, or that six tabs fit at 390 px. Those are
 * browser facts and are listed as manual checks in
 * docs/frontend-audit/REMAINING_WORK.md.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const source = (path) => readFileSync(resolve(rootDir, path), "utf8");

let vite;
let ui;
let glossary;

before(async () => {
  vite = await createServer({
    root: rootDir,
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  ui = await vite.ssrLoadModule("/apps/web/src/components/ui.tsx");
  glossary = await vite.ssrLoadModule("/apps/web/src/components/Glossary.tsx");
});

after(async () => {
  if (vite) await vite.close();
});

describe("one focus contract for every overlay", () => {
  it("routes all three overlays through the shared hook", () => {
    assert.ok(source("apps/web/src/components/ui.tsx").includes("useDialogFocus<HTMLDivElement>(open, onCancel)"));
    assert.ok(source("apps/web/src/components/Glossary.tsx").includes("useDialogFocus<HTMLElement>(open, onClose)"));
    assert.ok(
      source("apps/web/src/components/AccountAnalytics.tsx").includes(
        "useDialogFocus<HTMLElement>(true, onClose, { initialFocus: closeRef })",
      ),
    );
  });

  it("leaves no overlay managing its own Tab loop", () => {
    for (const file of ["ui.tsx", "Glossary.tsx", "AccountAnalytics.tsx"]) {
      const text = source(`apps/web/src/components/${file}`);
      assert.ok(
        !/event\.key !== "Tab"/.test(text) && !/e\.key !== "Tab"/.test(text),
        `${file} must not hand-roll Tab trapping`,
      );
    }
    // The mobile sidebar keeps its own light-touch handling: it is not modal.
    assert.ok(!source("apps/web/src/components/Layout.tsx").includes("useDialogFocus"));
  });

  it("removes the hard-coded dialog ids", () => {
    for (const file of ["ui.tsx", "Glossary.tsx"]) {
      const text = source(`apps/web/src/components/${file}`);
      assert.ok(!text.includes("confirm-dialog-title"), `${file} must not hard-code the confirm id`);
      assert.ok(!text.includes("glossary-drawer-title"), `${file} must not hard-code the glossary id`);
    }
  });

  it("gives two simultaneous confirmations distinct label ids", () => {
    const dialog = (title) =>
      React.createElement(ui.ConfirmDialog, {
        open: true,
        title,
        message: `${title} message`,
        onConfirm: () => undefined,
        onCancel: () => undefined,
      });
    const html = renderToStaticMarkup(
      React.createElement("div", null, dialog("First"), dialog("Second")),
    );
    const ids = [...html.matchAll(/aria-labelledby="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(ids.length, 2);
    assert.notEqual(ids[0], ids[1], "each dialog owns its own id");
    for (const id of ids) {
      assert.ok(html.includes(`id="${id}"`), `id ${id} labels a real heading`);
    }
  });

  it("marks the confirmation as modal with a safe initial focus", () => {
    const html = renderToStaticMarkup(
      React.createElement(ui.ConfirmDialog, {
        open: true,
        title: "Delete all keys?",
        message: "This cannot be undone.",
        confirmLabel: "Delete all keys",
        onConfirm: () => undefined,
        onCancel: () => undefined,
      }),
    );
    assert.ok(html.includes('role="dialog"'));
    assert.ok(html.includes('aria-modal="true"'));
    assert.ok(/tabindex="-1"/.test(html), "the dialog itself can take focus as a fallback");
    assert.ok(html.includes("data-autofocus"), "the cancel action is the first stop");
    assert.ok(html.includes("Delete all keys"), "the destructive label is unchanged");
  });

  it("lets only the topmost overlay answer the keyboard", () => {
    const hook = source("apps/web/src/lib/dialogFocus.ts");
    assert.ok(hook.includes("const dialogStack: symbol[] = []"));
    assert.ok(hook.includes("if (!isTopmost()) return;"), "a stacked dialog must not steal Tab");
    assert.ok(hook.includes("function lockScroll()"), "the scroll lock is shared");
    assert.ok(
      hook.includes("if (scrollLocks === 0) document.body.style.overflow = savedOverflow;"),
      "closing an inner overlay cannot unlock the page under an outer one",
    );
  });

  it("returns focus only to an element that is still in the document", () => {
    const hook = source("apps/web/src/lib/dialogFocus.ts");
    assert.ok(hook.includes("previous?.isConnected"), "a removed opener cannot receive focus");
  });

  it("renders nothing when a dialog is closed", () => {
    const html = renderToStaticMarkup(
      React.createElement(ui.ConfirmDialog, {
        open: false,
        title: "Hidden",
        message: "Hidden",
        onConfirm: () => undefined,
        onCancel: () => undefined,
      }),
    );
    assert.equal(html, "");
  });

  it("keeps the glossary drawer labelled and searchable", () => {
    const html = renderToStaticMarkup(
      React.createElement(glossary.GlossaryDrawer, { open: true, onClose: () => undefined }),
    );
    const labelledBy = html.match(/aria-labelledby="([^"]+)"/)?.[1];
    assert.ok(labelledBy, "the drawer is labelled");
    assert.ok(html.includes(`id="${labelledBy}"`), "the label points at its own heading");
    assert.ok(html.includes('aria-modal="true"'));
    assert.ok(html.includes("data-autofocus"), "the search field receives focus");
    assert.ok(html.includes("Plain-English Definitions"));
  });
});

describe("glossary and account tab discoverability", () => {
  it("keeps a visible glossary label instead of hiding it on small screens", () => {
    const layout = source("apps/web/src/components/Layout.tsx");
    assert.ok(!/hide-sm">Glossary/.test(layout), "the label must survive mobile widths");
    assert.ok(layout.includes("<span>Glossary</span>"));
    assert.ok(layout.includes('aria-label="Open the plain-English glossary"'));
  });

  it("uses tab labels short enough to fit a phone", () => {
    const portfolio = source("apps/web/src/pages/Portfolio.tsx");
    const labels = [...portfolio.matchAll(/\{ to: "\/account[^"]*", section: "[^"]+", label: "([^"]+)" \}/g)]
      .map((m) => m[1]);
    assert.deepEqual(labels, ["Overview", "Key setup", "Trades", "Orders", "P&L", "Deposits"]);
    for (const label of labels) {
      assert.ok(label.length <= 10, `"${label}" must stay short`);
    }
    assert.ok(!portfolio.includes('label: "Money Movements"'), "routes keep the name, tabs do not");
    // Full names still head the pages themselves.
    assert.ok(portfolio.includes('title: "Money Movements"'));
    assert.ok(portfolio.includes('title: "Profit and Loss"'));
  });

  it("scrolls the active tab into view and marks it for assistive tech", () => {
    const portfolio = source("apps/web/src/pages/Portfolio.tsx");
    assert.ok(portfolio.includes("scrollIntoView({ block: \"nearest\", inline: \"nearest\" })"));
    assert.ok(portfolio.includes('aria-current={tab.section === section ? "page" : undefined}'));
  });
});
