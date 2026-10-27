/**
 * P0-4b: the SDK quickstart only offers a runnable order snippet once the
 * quantity and limit price are provably legal for the selected pair.
 *
 * The unit tests below pin the decimal arithmetic (no float rounding), and the
 * source/SSR tests pin the page contract: no sub-tick formatting, no snippet
 * and no copy action while the draft is invalid, and a stated reason.
 *
 * Not covered here — and only provable in a browser (checks 20-23 in
 * docs/frontend-audit/REMAINING_WORK.md): that the notice is visible without
 * scrolling at 390 px, that the disabled copy button reads correctly to a
 * screen reader, and that a copied snippet matches the pair constraints.
 */
import { describe, it, before, after } from "node:test";
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

// The real published constraints for the pair the guide defaults to.
const BTC_USDT = {
  tickSize: "0.01",
  stepSize: "0.00000001",
  minQtyBase: "0.00001",
  minNotionalQuote: "5",
};
const AVAX_USDT = {
  tickSize: "0.001",
  stepSize: "0.000001",
  minQtyBase: "0.1",
  minNotionalQuote: "5",
};

let vite;
let constraints;
let SdkGuide;
let AppProvider;
let CopyButton;

before(async () => {
  vite = await createServer({
    root: rootDir,
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  constraints = await vite.ssrLoadModule("/apps/web/src/lib/orderConstraints.ts");
  const page = await vite.ssrLoadModule("/apps/web/src/pages/SdkGuide.tsx");
  SdkGuide = page.default ?? page.SdkGuidePage ?? page.SdkGuide;
  ({ AppProvider } = await vite.ssrLoadModule("/apps/web/src/lib/store.tsx"));
  ({ CopyButton } = await vite.ssrLoadModule("/apps/web/src/components/ui.tsx"));
});

after(async () => {
  if (vite) await vite.close();
});

describe("order constraint arithmetic", () => {
  it("parses only plain non-negative decimals", () => {
    assert.deepEqual(constraints.parseDecimal("0.001"), { units: 1n, scale: 3 });
    assert.deepEqual(constraints.parseDecimal(" 50000 "), { units: 50000n, scale: 0 });
    for (const bad of ["-1", "+1", "1e3", "1,000", "", " ", "0.0.1", "abc", ".5", "5."]) {
      assert.equal(constraints.parseDecimal(bad), null, bad);
    }
  });

  it("counts decimals without trailing zeros", () => {
    assert.equal(constraints.decimalPlaces("0.0010"), 3);
    assert.equal(constraints.decimalPlaces("1.00000000"), 0);
    assert.equal(constraints.decimalPlaces("50000"), 0);
    assert.equal(constraints.decimalPlaces("nope"), null);
  });

  it("compares and multiplies exactly", () => {
    assert.equal(constraints.compareDecimal("0.1", "0.10"), 0);
    assert.equal(constraints.compareDecimal("0.00001", "0.0000100"), 0);
    assert.equal(constraints.compareDecimal("0.1", "0.099999"), 1);
    assert.equal(constraints.compareDecimal("5", "10"), -1);
    assert.equal(constraints.compareDecimal("x", "1"), null);
    // 0.1 × 0.2 is 0.02 exactly, which float maths would render as 0.020000000000000004.
    assert.equal(constraints.multiplyDecimal("0.1", "0.2"), "0.02");
    assert.equal(constraints.multiplyDecimal("0.001", "50000"), "50");
    assert.equal(constraints.multiplyDecimal("0.00000001", "0.01"), "0.0000000001");
  });

  it("detects step multiples without float drift", () => {
    assert.equal(constraints.isMultipleOf("0.001", "0.00000001"), true);
    assert.equal(constraints.isMultipleOf("0.0000015", "0.000001"), false);
    assert.equal(constraints.isMultipleOf("1.10", "0.1"), true);
    assert.equal(constraints.isMultipleOf("1", "0"), null);
    assert.equal(constraints.isMultipleOf("bad", "0.1"), null);
  });

  it("rounds to a legal tick in both directions", () => {
    // 49499.999999 floors to 49499.99 and ceils to 49500 at tick 0.01.
    assert.equal(constraints.roundToTick(49499.999999, "0.01", "down"), "49499.99");
    assert.equal(constraints.roundToTick(49499.999999, "0.01", "up"), "49500");
    assert.equal(constraints.roundToTick(50000, "0.01", "down"), "50000");
    assert.equal(constraints.roundToTick(1.23456, "0.00001", "down"), "1.23456");
    assert.equal(constraints.roundToTick(1.234567, "0.00001", "down"), "1.23456");
    assert.equal(constraints.roundToTick(1.234561, "0.00001", "up"), "1.23457");
    for (const bad of [0, -5, NaN, Infinity]) {
      assert.equal(constraints.roundToTick(bad, "0.01"), null, String(bad));
    }
    assert.equal(constraints.roundToTick(10, "0"), null);
    assert.equal(constraints.roundToTick(10, "not-a-tick"), null);
  });
});

describe("order draft validation", () => {
  const validate = (overrides) =>
    constraints.validateOrderDraft({
      qty: "0.001",
      price: "50000",
      pair: BTC_USDT,
      base: "BTC",
      quote: "USDT",
      ...overrides,
    });

  it("accepts the guide's default draft for the default pair", () => {
    const result = validate({});
    assert.equal(result.ok, true, JSON.stringify(result.issues));
    assert.deepEqual(result.issues, []);
    assert.equal(result.notional, "50");
  });

  it("refuses to validate without pair constraints", () => {
    const result = validate({ pair: null });
    assert.equal(result.ok, false);
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].field, "pair");
    assert.match(result.issues[0].message, /tick size, step size, and minimums are not loaded/);
  });

  it("rejects empty, non-numeric, and zero inputs", () => {
    assert.equal(validate({ qty: "" }).issues[0].message, "Enter a quantity.");
    assert.equal(validate({ price: "  " }).issues[0].message, "Enter a limit price.");
    assert.match(validate({ qty: "0.001btc" }).issues[0].message, /plain number/);
    assert.match(validate({ price: "1e5" }).issues[0].message, /plain number/);
    assert.match(validate({ qty: "0" }).issues[0].message, /greater than zero/);
    assert.match(validate({ price: "0.00" }).issues[0].message, /greater than zero/);
  });

  it("rejects a price that is not on the tick grid", () => {
    // A non-decimal tick grid is the only way to be off-grid with legal decimals.
    const result = validate({
      price: "50000.01",
      pair: { ...BTC_USDT, tickSize: "0.05" },
    });
    assert.equal(result.ok, false);
    assert.equal(result.issues[0].field, "price");
    assert.match(result.issues[0].message, /multiple of 0\.05 USDT/);
    assert.equal(
      constraints.isMultipleOf("50000.05", "0.05"),
      true,
      "a legal multiple still passes",
    );
  });

  it("rejects a price with more decimals than the tick allows", () => {
    const result = validate({ price: "50000.123" });
    assert.equal(result.ok, false);
    assert.match(result.issues[0].message, /at most 2 decimal places/);
  });

  it("rejects a quantity that is not on the step grid", () => {
    const result = validate({ qty: "0.000000015" });
    assert.equal(result.ok, false);
    assert.equal(result.issues[0].field, "qty");
  });

  it("rejects a quantity below the pair minimum", () => {
    // The guide's default qty is legal on BTC-USDT but illegal on AVAX-USDT.
    const result = validate({ pair: AVAX_USDT, base: "AVAX", qty: "0.001" });
    assert.equal(result.ok, false);
    assert.equal(result.issues[0].field, "qty");
    assert.match(result.issues[0].message, /minimum of 0\.1 AVAX/);
  });

  it("rejects an order below the minimum notional", () => {
    const result = validate({ qty: "0.00001", price: "50000" });
    assert.equal(result.ok, false);
    const notional = result.issues.find((issue) => issue.field === "notional");
    assert.ok(notional, JSON.stringify(result.issues));
    assert.match(notional.message, /below this pair's minimum notional of 5 USDT/);
  });

  it("reports one actionable message per field", () => {
    const result = validate({ qty: "", price: "" });
    assert.deepEqual(result.issues.map((issue) => issue.field).sort(), ["price", "qty"]);
    const fields = result.issues.map((issue) => issue.field);
    assert.equal(new Set(fields).size, fields.length);
  });
});

describe("SDK page contract", () => {
  const page = source("apps/web/src/pages/SdkGuide.tsx");

  it("never formats a symbol price with a hard-coded 2 decimals", () => {
    assert.ok(!/\.toFixed\(2\)/.test(page), "prices must follow the pair tick size");
    assert.ok(page.includes("roundToTick("), "the live-price sync snaps to the tick");
  });

  it("gates the snippet and the copy action on validation", () => {
    assert.ok(page.includes("validateOrderDraft({ qty: orderQty, price: orderPrice, pair, base, quote })"));
    assert.ok(page.includes("const orderBlocked = step === \"trade\" && !orderDraft.ok"));
    assert.ok(page.includes("disabled={orderBlocked}"), "copy is refused while invalid");
    assert.ok(
      page.includes("text={orderBlocked ? \"\" : generatedCode}"),
      "an invalid draft has nothing to copy",
    );
    assert.ok(
      page.includes("No snippet until this order is valid."),
      "the blocked state states the reason",
    );
    assert.ok(page.includes('role="alert"'), "the blocked state is announced");
  });

  it("does not call generated order code safe", () => {
    const examples = source("apps/web/src/lib/sdkTypescriptExamples.ts");
    assert.ok(!/\bsafe post/i.test(`${page}\n${examples}`), "the snippet must not describe itself as safe");
    assert.ok(
      examples.includes("mutates testnet state"),
      "the snippet comment states the consequence instead",
    );
  });

  it("keeps the mutation warning above the generator", () => {
    const warning = page.indexOf("PolyTools does not run this code.");
    const generator = page.indexOf("Interactive SDK Code Generator");
    assert.ok(warning >= 0 && warning < generator);
  });

  it("disables the copy control instead of copying an empty snippet", () => {
    const blocked = renderToStaticMarkup(
      React.createElement(CopyButton, { text: "", label: "Fix inputs to copy", disabled: true }),
    );
    assert.ok(blocked.includes("disabled"), "the control is disabled when flagged");
    assert.ok(blocked.includes("nothing to copy yet"), "the disabled label explains itself");

    const ready = renderToStaticMarkup(
      React.createElement(CopyButton, { text: "npm install @polyester/sdk", label: "Copy Snippet" }),
    );
    assert.ok(!ready.includes("disabled"), "a valid snippet stays copyable");
  });

  it("renders the quickstart with the warning visible on first paint", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        MemoryRouter,
        { initialEntries: ["/sdk"] },
        React.createElement(AppProvider, null, React.createElement(SdkGuide)),
      ),
    ).replace(/<!-- -->/g, "");
    assert.ok(html.includes("PolyTools does not run this code."));
    assert.ok(html.includes("npm install @polyester/sdk@0.31.0"), "the install step pins the verified package version");
    assert.ok(html.includes("separate written agreement"), "the registry license restriction is disclosed");
    assert.ok(!html.includes("No snippet until this order is valid."), "the default step is not an order step");
  });
});
