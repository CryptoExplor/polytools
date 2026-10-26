/**
 * P1-13: meaning-carrying text tokens must reach 4.5:1 in both themes.
 *
 * The calculation is deterministic WCAG relative luminance over sRGB, so this
 * is a real check rather than a preference. It is still a static check: it
 * cannot see antialiasing, transparency, or what a browser actually paints, and
 * it says nothing about charts or canvas-drawn text.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MEANINGFUL_TEXT,
  MIN_RATIO,
  SURFACES,
  auditStyles,
  contrastRatio,
  parseThemeBlock,
  readThemes,
} from "../scripts/check-contrast.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const css = readFileSync(resolve(rootDir, "apps/web/src/styles.css"), "utf8");

describe("contrast arithmetic", () => {
  it("matches known WCAG ratios", () => {
    assert.equal(Number(contrastRatio("#ffffff", "#000000").toFixed(2)), 21);
    assert.equal(Number(contrastRatio("#ffffff", "#ffffff").toFixed(2)), 1);
    // #767676 on white is the canonical 4.54:1 boundary grey.
    assert.equal(Number(contrastRatio("#767676", "#ffffff").toFixed(2)), 4.54);
  });

  it("is order-independent and rejects non-hex input", () => {
    assert.equal(contrastRatio("#0a0a0a", "#f7f7f7"), contrastRatio("#f7f7f7", "#0a0a0a"));
    assert.equal(contrastRatio("rgba(0,0,0,0.5)", "#ffffff"), null);
    assert.equal(contrastRatio("#fff", "#000000"), null);
  });

  it("parses each theme block separately", () => {
    const themes = readThemes(css);
    assert.equal(themes.dark["--bg-canvas"], "#0a0a0a");
    assert.equal(themes.light["--bg-canvas"], "#f7f7f7");
    assert.notEqual(themes.dark["--text-primary"], themes.light["--text-primary"]);
  });

  it("fails loudly when a theme block disappears", () => {
    assert.throws(() => parseThemeBlock(":root { --a: #000000; }", '[data-theme="light"]'));
  });
});

describe("token contrast in the shipped stylesheet", () => {
  const results = auditStyles(css);

  it("checks every meaningful token against every surface in both themes", () => {
    assert.equal(results.length, MEANINGFUL_TEXT.length * SURFACES.length * 2);
  });

  it("reaches 4.5:1 for every pair", () => {
    const failures = results.filter((result) => !result.ok);
    assert.deepEqual(
      failures.map((f) => `${f.theme} ${f.token} on ${f.surface}: ${f.ratio}`),
      [],
    );
  });

  it("keeps the semantic state colours distinguishable from the background", () => {
    const lightUp = results.find((r) => r.theme === "light" && r.token === "--up" && r.surface === "--bg-surface");
    const lightDown = results.find((r) => r.theme === "light" && r.token === "--down" && r.surface === "--bg-surface");
    const lightWarn = results.find((r) => r.theme === "light" && r.token === "--warn" && r.surface === "--bg-surface");
    for (const entry of [lightUp, lightDown, lightWarn]) {
      assert.ok(entry && entry.ratio >= MIN_RATIO, JSON.stringify(entry));
    }
  });
});

describe("text roles are used as documented", () => {
  it("never renders meaning-bearing text with the decorative token", () => {
    const faintRule = css.match(/\.faint\s*\{[^}]*\}/)?.[0] ?? "";
    assert.ok(faintRule.length > 0, "the .faint class exists");
    assert.ok(!faintRule.includes("--text-faint"), ".faint is a caption, not decoration");
    assert.ok(faintRule.includes("--text-caption"), ".faint uses the caption role");

    // The only remaining consumer of --text-faint is the breadcrumb separator.
    const consumers = [...css.matchAll(/var\(--text-faint\)/g)].length;
    assert.equal(consumers, 1, "decoration only, one place");
    const separatorRule = css.match(/\.topbar-crumb-sep\s*\{[^}]*\}/)?.[0] ?? "";
    assert.ok(separatorRule.includes("--text-faint"), "the separator is the decorative use");
  });

  it("keeps the caption role at least as readable as the muted role", () => {
    for (const [theme, tokens] of Object.entries(readThemes(css))) {
      for (const surface of SURFACES) {
        const caption = contrastRatio(tokens["--text-caption"], tokens[surface]);
        const muted = contrastRatio(tokens["--text-muted"], tokens[surface]);
        assert.ok(
          caption >= muted,
          `${theme}: caption ${caption.toFixed(2)} should not be weaker than muted ${muted.toFixed(2)} on ${surface}`,
        );
      }
    }
  });
});
