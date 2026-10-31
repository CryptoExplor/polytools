#!/usr/bin/env node
/**
 * Deterministic contrast gate for the text tokens in `apps/web/src/styles.css`.
 *
 * This replaces an opinion with arithmetic. Every token listed in
 * `MEANINGFUL_TEXT` carries information (labels, captions, status text, numbers),
 * so it must reach 4.5:1 against every surface it can sit on, in both themes.
 * `--text-faint` is deliberately absent: after this change it is only used for
 * decorative marks such as the breadcrumb separator, and the test suite asserts
 * that no text-bearing class still consumes it.
 *
 * The maths is WCAG 2.x relative luminance over sRGB. It is a static calculation,
 * not a rendering check: it cannot see transparency, antialiasing, or the actual
 * pixels a browser produces.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT_PATH = fileURLToPath(import.meta.url);

/** Tokens that carry meaning and must reach 4.5:1 on every surface. */
export const MEANINGFUL_TEXT = [
  "--text-primary",
  "--text-secondary",
  "--text-muted",
  "--text-caption",
  "--up",
  "--down",
  "--warn",
  "--info",
  "--accent-text",
];

/** Surfaces a text token can be rendered on. */
export const SURFACES = ["--bg-canvas", "--bg-shell", "--bg-surface"];

/** Decorative-only tokens; documented so using them for text is a visible choice. */
export const DECORATIVE_TEXT = ["--text-faint"];

export const MIN_RATIO = 4.5;

export function hexToRgb(hex) {
  const value = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}$/i.test(value)) return null;
  return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
}

export function relativeLuminance(hex) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(foreground, background) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  if (a === null || b === null) return null;
  const [high, low] = a > b ? [a, b] : [b, a];
  return (high + 0.05) / (low + 0.05);
}

/** Pull `--token: #rrggbb;` declarations out of one theme block. */
export function parseThemeBlock(source, marker) {
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Theme block not found: ${marker}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        const block = source.slice(open, i + 1);
        const tokens = {};
        for (const match of block.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
          tokens[match[1]] = match[2].toLowerCase();
        }
        return tokens;
      }
    }
  }
  throw new Error(`Unterminated theme block: ${marker}`);
}

export function readThemes(css) {
  // Normalise here, not at the call sites. The markers below are written with
  // LF, so a CRLF checkout makes the dark block unfindable — and every caller
  // that passes raw file contents would hit it, not just main().
  const normalized = css.replace(/\r\n/g, "\n");
  return {
    dark: parseThemeBlock(normalized, ':root,\n[data-theme="dark"]'),
    light: parseThemeBlock(normalized, '[data-theme="light"]'),
  };
}

/** Every meaningful token × surface pair, with the ratio and pass/fail. */
export function auditTheme(tokens, themeName) {
  const results = [];
  for (const token of MEANINGFUL_TEXT) {
    const foreground = tokens[token];
    if (!foreground) {
      results.push({ theme: themeName, token, surface: null, ratio: null, ok: false, reason: "token missing" });
      continue;
    }
    for (const surface of SURFACES) {
      const background = tokens[surface];
      if (!background) {
        results.push({ theme: themeName, token, surface, ratio: null, ok: false, reason: "surface missing" });
        continue;
      }
      const ratio = contrastRatio(foreground, background);
      results.push({
        theme: themeName,
        token,
        surface,
        foreground,
        background,
        ratio: Number(ratio.toFixed(2)),
        ok: ratio >= MIN_RATIO,
      });
    }
  }
  return results;
}

export function auditStyles(css) {
  const themes = readThemes(css);
  return [...auditTheme(themes.dark, "dark"), ...auditTheme(themes.light, "light")];
}

function main() {
  // Normalised so the token scan behaves identically on a CRLF checkout.
  const css = readFileSync(`${ROOT}/apps/web/src/styles.css`, "utf8").replace(/\r\n/g, "\n");
  const results = auditStyles(css);
  const failures = results.filter((result) => !result.ok);
  const byToken = new Map();
  for (const result of results) {
    const key = `${result.theme} ${result.token}`;
    const current = byToken.get(key) ?? { min: Infinity, worst: null };
    if (result.ratio !== null && result.ratio < current.min) {
      current.min = result.ratio;
      current.worst = result.surface;
    }
    byToken.set(key, current);
  }
  for (const [key, value] of byToken) {
    console.log(`${value.min >= MIN_RATIO ? "PASS" : "FAIL"} ${key}: min ${value.min}:1 on ${value.worst}`);
  }
  console.log(
    `\n${results.length - failures.length}/${results.length} token-surface pairs reach ${MIN_RATIO}:1` +
      ` (decorative only: ${DECORATIVE_TEXT.join(", ")})`,
  );
  if (failures.length > 0) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(new URL(`file://${process.argv[1]}`)) === SCRIPT_PATH) {
  main();
}
