/**
 * Normalization helpers — convert raw wire payloads into numbers apps can use.
 *
 * Empirically verified scaling rules (testnet, Oct 2026):
 *   PRICES   → raw string / 10^PRICE_SCALE   (e.g. "82132470"  → 82_132.47)
 *   QUANTITY → raw string as-is              (e.g. "0.13424745")
 *   VOLUME   → raw string as-is
 *
 * PRICE_SCALE is a constant rather than guessed per-pair because every
 * observed instrument (BTC, ETH, stablecoins) price-scales by 10^3.
 * Override via the `scale` argument if Polyester ever ships per-asset scales.
 */

export const PRICE_SCALE = 3;
const PRICE_DIV = 10 ** PRICE_SCALE;

/** Decode a scaled-integer price string to a number. */
export function price(raw: string | number | null | undefined, scale = PRICE_DIV): number {
  if (raw === null || raw === undefined || raw === "") return NaN;
  return Number(raw) / scale;
}

/** Decode a plain decimal string (quantities, volumes). */
export function dec(raw: string | number | null | undefined): number {
  if (raw === null || raw === undefined || raw === "") return NaN;
  return Number(raw);
}

/** Basis points → fraction (e.g. -87 → -0.0087). */
export function bpsToFrac(bps: number): number {
  return bps / 10_000;
}

/** Basis points → percent (e.g. -87 → -0.87). */
export function bpsToPct(bps: number): number {
  return bps / 100;
}

/** Spread between best bid/ask in bps of mid price. Prices are display units. */
export function spreadBps(bestBid: number, bestAsk: number): number {
  if (!isFinite(bestBid) || !isFinite(bestAsk) || bestBid <= 0 || bestAsk <= 0) return NaN;
  const mid = (bestBid + bestAsk) / 2;
  return ((bestAsk - bestBid) / mid) * 10_000;
}

/** Detect "walls": levels whose qty stands out vs the median of its side. */
export function wallIndexes(qtys: number[], multiplier = 3): Set<number> {
  const sorted = [...qtys].filter((n) => isFinite(n) && n > 0).sort((a, b) => a - b);
  if (sorted.length < 5) return new Set();
  const median = sorted[Math.floor(sorted.length / 2)];
  const threshold = median * multiplier;
  const out = new Set<number>();
  qtys.forEach((q, i) => {
    if (isFinite(q) && q >= threshold) out.add(i);
  });
  return out;
}

/** Cumulative depth series for depth charts: [[price, cumQty], ...]. */
export function cumulativeDepth(
  levels: Array<{ price: number; qty: number }>,
): Array<{ price: number; cum: number }> {
  let cum = 0;
  return levels.map((l) => {
    cum += l.qty;
    return { price: l.price, cum };
  });
}
