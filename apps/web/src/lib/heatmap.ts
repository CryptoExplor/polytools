import { dec, price, type HeatmapBucket } from "@poly/core";

export const HEATMAP_PRICE_BINS = 36;

interface DecodedPoint {
  px: number;
  qty: number;
  side: "bid" | "ask";
}

interface DecodedBucket {
  tsSec: number;
  points: DecodedPoint[];
  bestBid: number | null;
  bestAsk: number | null;
  totalBidQty: number;
  totalAskQty: number;
}

/** Decode positive resting liquidity and build the fixed-size render grid. */
export function decodeHeatmapBuckets(rawBuckets: HeatmapBucket[]) {
  if (!rawBuckets.length) return null;

  let minPx = Infinity;
  let maxPx = -Infinity;
  let peakLevelQty = 0;
  let peakBidPx = 0;
  let peakBidQty = 0;
  let peakAskPx = 0;
  let peakAskQty = 0;

  const buckets: DecodedBucket[] = rawBuckets.map((b) => {
    const points: DecodedPoint[] = [];
    let bestBid: number | null = null;
    let bestAsk: number | null = null;
    let totalBidQty = 0;
    let totalAskQty = 0;

    const bidPrices = b.bids?.price ?? [];
    const bidQtys = b.bids?.qty ?? [];
    for (let i = 0; i < bidPrices.length; i++) {
      const q = dec(bidQtys[i]);
      if (!(q > 0)) continue; // FIN-11: ignore zero-qty levels
      const p = price(bidPrices[i]);
      if (!(p > 0)) continue;
      points.push({ px: p, qty: q, side: "bid" });
      totalBidQty += q;
      if (bestBid === null || p > bestBid) bestBid = p;
      if (p < minPx) minPx = p;
      if (p > maxPx) maxPx = p;
      if (q > peakBidQty) {
        peakBidQty = q;
        peakBidPx = p;
      }
    }

    const askPrices = b.asks?.price ?? [];
    const askQtys = b.asks?.qty ?? [];
    for (let i = 0; i < askPrices.length; i++) {
      const q = dec(askQtys[i]);
      if (!(q > 0)) continue; // FIN-11: ignore zero-qty levels
      const p = price(askPrices[i]);
      if (!(p > 0)) continue;
      points.push({ px: p, qty: q, side: "ask" });
      totalAskQty += q;
      if (bestAsk === null || p < bestAsk) bestAsk = p;
      if (p < minPx) minPx = p;
      if (p > maxPx) maxPx = p;
      if (q > peakAskQty) {
        peakAskQty = q;
        peakAskPx = p;
      }
    }

    return {
      tsSec: b.tsSec,
      points,
      bestBid,
      bestAsk,
      totalBidQty,
      totalAskQty,
    };
  });

  // Empty and zero-only inputs have no valid extrema and remain unavailable.
  if (!Number.isFinite(minPx) || !Number.isFinite(maxPx)) return null;

  // A valid flat book still has liquidity. Keep its actual extrema for display,
  // but use a separate non-zero domain for bins, canvas traces, and hover.
  const flatBook = maxPx === minPx;
  const renderSpan = flatBook ? minPx * 0.02 || 1 : maxPx - minPx;
  const renderMinPx = flatBook ? Math.max(0, minPx - renderSpan / 2) : minPx;
  const renderMaxPx = flatBook ? minPx + renderSpan / 2 : maxPx;
  const binSize = (renderMaxPx - renderMinPx) / HEATMAP_PRICE_BINS;

  // Build 2D grid: [bucketIdx][binIdx] -> { bidQty, askQty }
  const grid = buckets.map((b) => {
    const bins = Array.from({ length: HEATMAP_PRICE_BINS }, () => ({
      bidQty: 0,
      askQty: 0,
    }));
    for (const pt of b.points) {
      const idx = Math.min(
        HEATMAP_PRICE_BINS - 1,
        Math.max(0, Math.floor((pt.px - renderMinPx) / binSize)),
      );
      if (pt.side === "bid") bins[idx].bidQty += pt.qty;
      else bins[idx].askQty += pt.qty;
      const tot = bins[idx].bidQty + bins[idx].askQty;
      if (tot > peakLevelQty) peakLevelQty = tot;
    }
    return bins;
  });

  // Top persistent liquidity bands across all buckets
  const bandTotals = Array.from({ length: HEATMAP_PRICE_BINS }, (_, i) => {
    let bidSum = 0;
    let askSum = 0;
    let activeBuckets = 0;
    for (let col = 0; col < grid.length; col++) {
      const cell = grid[col][i];
      if (cell.bidQty > 0 || cell.askQty > 0) activeBuckets++;
      bidSum += cell.bidQty;
      askSum += cell.askQty;
    }
    const low = renderMinPx + i * binSize;
    const high = low + binSize;
    return {
      binIdx: i,
      low,
      high,
      mid: (low + high) / 2,
      side: bidSum >= askSum ? ("bid" as const) : ("ask" as const),
      totalQty: bidSum + askSum,
      avgQty: buckets.length ? (bidSum + askSum) / buckets.length : 0,
      persistencePct: buckets.length ? (activeBuckets / buckets.length) * 100 : 0,
    };
  })
    .filter((b) => b.totalQty > 0)
    .sort((a, b) => b.totalQty - a.totalQty)
    .slice(0, 8);

  return {
    buckets,
    grid,
    minPx,
    maxPx,
    renderMinPx,
    renderMaxPx,
    binSize,
    peakLevelQty: peakLevelQty || 1,
    peakBidPx,
    peakBidQty,
    peakAskPx,
    peakAskQty,
    bandTotals,
  };
}
