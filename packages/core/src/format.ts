/**
 * Display formatting helpers shared by every tool page.
 * Pure functions, no locale surprises (en-US fixed for consistency).
 */

/** Choose decimal places from magnitude (prices like 82132.47 vs 0.99878). */
export function smartDecimals(n: number): number {
  const a = Math.abs(n);
  if (!isFinite(a)) return 2;
  if (a >= 10_000) return 1;
  if (a >= 1_000) return 2;
  if (a >= 100) return 2;
  if (a >= 1) return 3;
  if (a >= 0.01) return 5;
  return 8;
}

/** "82,132.47" style with magnitude-aware precision. */
export function fmtNum(n: number, decimals?: number): string {
  if (!isFinite(n)) return "—";
  const d = decimals ?? smartDecimals(n);
  return n.toLocaleString("en-US", {
    minimumFractionDigits: Math.min(d, 2),
    maximumFractionDigits: d,
  });
}

/** 44_448_769 → "$44.45M"; 728_139 → "728.1K". */
export function fmtCompact(n: number, prefix = ""): string {
  if (!isFinite(n)) return "—";
  const abs = Math.abs(n);
  const units: Array<[number, string]> = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [u, suffix] of units) {
    if (abs >= u) return `${prefix}${(n / u).toFixed(2)}${suffix}`;
  }
  return `${prefix}${fmtNum(n)}`;
}

/** -0.87 → "-0.87%" (bps input) */
export function fmtPctFromBps(bps: number): string {
  if (!isFinite(bps)) return "—";
  const pct = bps / 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

/** fraction 0.1234 → "+12.34%" */
export function fmtPct(frac: number): string {
  if (!isFinite(frac)) return "—";
  return `${frac >= 0 ? "+" : ""}${(frac * 100).toFixed(2)}%`;
}

/** 1792664721425 → "14:25:21" (UTC hh:mm:ss) */
export function fmtTimeUTC(tsMs: number): string {
  if (!isFinite(tsMs)) return "—";
  return new Date(tsMs).toISOString().slice(11, 19);
}

/** Human relative time: "3m ago". */
export function fmtAgo(tsMs: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - tsMs) / 1000));
  if (s < 2) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** Split symbol "BTC-USDT" → ["BTC","USDT"]. */
export function splitSymbol(symbol: string): [string, string] {
  const i = symbol.indexOf("-");
  return i === -1 ? [symbol, ""] : [symbol.slice(0, i), symbol.slice(i + 1)];
}

/** Color class helpers (kept textual so any UI lib can map them). */
export function trendSign(n: number): "up" | "down" | "flat" {
  if (!isFinite(n) || n === 0) return "flat";
  return n > 0 ? "up" : "down";
}
