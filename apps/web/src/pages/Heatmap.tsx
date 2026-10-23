/**
 * TOOL — Order Book Liquidity Heatmap (/#/heatmap) — FEAT-01
 * Consumes `/api/heatmap` (`get_heatmap` MCP tool) and renders historical
 * order book resting liquidity buckets (time × price × resting size).
 *
 * Financial correctness rules:
 *  - Decode all bucket prices via `price()` (`raw ÷ 10^3`, `PRICE_SCALE = 3`).
 *  - Decode quantities via `dec()`.
 *  - Ignore `qty <= 0` (`FIN-11`: zero-qty entries are cleared levels, not liquidity).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { dec, fmtCompact, fmtNum, price, splitSymbol } from "@poly/core";
import { api } from "../lib/api";
import { usePollData } from "../lib/hooks";
import { useApp } from "../lib/store";
import {
  Card,
  DataFreshness,
  EmptyState,
  ErrorBox,
  Loading,
  MetricCell,
  MetricStrip,
  PageHeader,
  Pill,
  SymbolSelect,
  TermTip,
} from "../components/ui";

const fmtPrice = (n: number) => fmtNum(n, 2);
const fmtUsd = (n: number) => fmtCompact(n, "$");

type HeatInterval = "1m" | "5m" | "1h";
type HeatDepth = 10 | 50 | 100;

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

const PRICE_BINS = 36;

export function HeatmapPage() {
  const { symbol, setSymbol } = useApp();
  const [interval, setIntervalVal] = useState<HeatInterval>("1m");
  const [depth, setDepth] = useState<HeatDepth>(50);
  const [windowSec, setWindowSec] = useState<number>(3600);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number>(760);
  const [hoverCell, setHoverCell] = useState<{
    bucketIdx: number;
    binIdx: number;
    tsSec: number;
    priceLow: number;
    priceHigh: number;
    bidQty: number;
    askQty: number;
  } | null>(null);

  const [base, quote] = splitSymbol(symbol);

  const { data, loading, refreshing, error, updatedAt, paused, setPaused, refresh } =
    usePollData(
      () => api.heatmap(symbol, interval, depth, windowSec),
      6000,
      [symbol, interval, depth, windowSec],
    );

  // Resize observer for responsive canvas
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (w > 120) setWidth(w);
    };
    update();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(update);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const decoded = useMemo(() => {
    const rawBuckets = data?.buckets ?? [];
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

    if (!Number.isFinite(minPx) || !Number.isFinite(maxPx) || maxPx <= minPx) {
      return null;
    }

    const span = maxPx - minPx || 1;
    const binSize = span / PRICE_BINS;

    // Build 2D grid: [bucketIdx][binIdx] -> { bidQty, askQty }
    const grid = buckets.map((b) => {
      const bins = Array.from({ length: PRICE_BINS }, () => ({
        bidQty: 0,
        askQty: 0,
      }));
      for (const pt of b.points) {
        const idx = Math.min(
          PRICE_BINS - 1,
          Math.max(0, Math.floor((pt.px - minPx) / binSize)),
        );
        if (pt.side === "bid") bins[idx].bidQty += pt.qty;
        else bins[idx].askQty += pt.qty;
        const tot = bins[idx].bidQty + bins[idx].askQty;
        if (tot > peakLevelQty) peakLevelQty = tot;
      }
      return bins;
    });

    // Top persistent liquidity bands across all buckets
    const bandTotals = Array.from({ length: PRICE_BINS }, (_, i) => {
      let bidSum = 0;
      let askSum = 0;
      let activeBuckets = 0;
      for (let col = 0; col < grid.length; col++) {
        const cell = grid[col][i];
        if (cell.bidQty > 0 || cell.askQty > 0) activeBuckets++;
        bidSum += cell.bidQty;
        askSum += cell.askQty;
      }
      const low = minPx + i * binSize;
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
      binSize,
      peakLevelQty: peakLevelQty || 1,
      peakBidPx,
      peakBidQty,
      peakAskPx,
      peakAskQty,
      bandTotals,
    };
  }, [data]);

  // Draw 2D canvas heatmap
  const height = 340;
  const padL = 12;
  const padR = 78;
  const padT = 14;
  const padB = 28;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !decoded) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    const plotW = Math.max(40, width - padL - padR);
    const plotH = Math.max(40, height - padT - padB);
    const cols = decoded.buckets.length;
    const cellW = plotW / Math.max(1, cols);
    const cellH = plotH / PRICE_BINS;

    // Draw cells (bin 0 is lowest price at bottom, bin PRICE_BINS-1 is highest price at top)
    for (let c = 0; c < cols; c++) {
      const x = padL + c * cellW;
      for (let r = 0; r < PRICE_BINS; r++) {
        const cell = decoded.grid[c][r];
        const tot = cell.bidQty + cell.askQty;
        if (tot <= 0) continue;
        // Log-scaled intensity so both medium and wall levels remain visible
        const ratio = Math.min(
          1,
          Math.log10(1 + (tot / decoded.peakLevelQty) * 9),
        );
        const alpha = 0.14 + ratio * 0.78;
        const y = padT + (PRICE_BINS - 1 - r) * cellH;
        ctx.fillStyle =
          cell.bidQty >= cell.askQty
            ? `rgba(16, 185, 129, ${alpha.toFixed(3)})`
            : `rgba(244, 63, 94, ${alpha.toFixed(3)})`;
        ctx.fillRect(x, y, Math.ceil(cellW), Math.ceil(cellH));
      }
    }

    // Best bid / best ask trace lines
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(52, 211, 153, 0.9)";
    ctx.beginPath();
    let startedBid = false;
    for (let c = 0; c < cols; c++) {
      const bb = decoded.buckets[c].bestBid;
      if (bb === null) continue;
      const x = padL + (c + 0.5) * cellW;
      const y =
        padT +
        plotH -
        ((bb - decoded.minPx) / (decoded.maxPx - decoded.minPx || 1)) * plotH;
      if (!startedBid) {
        ctx.moveTo(x, y);
        startedBid = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    ctx.strokeStyle = "rgba(251, 113, 133, 0.9)";
    ctx.beginPath();
    let startedAsk = false;
    for (let c = 0; c < cols; c++) {
      const ba = decoded.buckets[c].bestAsk;
      if (ba === null) continue;
      const x = padL + (c + 0.5) * cellW;
      const y =
        padT +
        plotH -
        ((ba - decoded.minPx) / (decoded.maxPx - decoded.minPx || 1)) * plotH;
      if (!startedAsk) {
        ctx.moveTo(x, y);
        startedAsk = true;
      } else {
        ctx.lineTo(x, y);
      }
    }
    ctx.stroke();

    // Right price axis labels
    ctx.fillStyle = "#8a94a6";
    ctx.font = "11px JetBrains Mono, monospace";
    ctx.textAlign = "left";
    const steps = 5;
    for (let i = 0; i <= steps; i++) {
      const frac = i / steps;
      const pxVal = decoded.maxPx - frac * (decoded.maxPx - decoded.minPx);
      const y = padT + frac * plotH;
      ctx.fillText(fmtPrice(pxVal), padL + plotW + 6, y + 4);
    }

    // Bottom time axis labels
    ctx.textAlign = "center";
    const timeTicks = Math.min(5, cols);
    for (let i = 0; i < timeTicks; i++) {
      const idx = Math.min(
        cols - 1,
        Math.round((i / Math.max(1, timeTicks - 1)) * (cols - 1)),
      );
      const ts = decoded.buckets[idx]?.tsSec;
      if (!ts) continue;
      const x = padL + (idx + 0.5) * cellW;
      const label = new Date(ts * 1000).toISOString().slice(11, 16) + " UTC";
      ctx.fillText(label, x, height - 8);
    }
  }, [decoded, width]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!decoded || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const plotW = Math.max(40, width - padL - padR);
    const plotH = Math.max(40, height - padT - padB);
    if (mx < padL || mx > padL + plotW || my < padT || my > padT + plotH) {
      setHoverCell(null);
      return;
    }
    const cols = decoded.buckets.length;
    const bucketIdx = Math.min(
      cols - 1,
      Math.max(0, Math.floor(((mx - padL) / plotW) * cols)),
    );
    const rowFromTop = Math.min(
      PRICE_BINS - 1,
      Math.max(0, Math.floor(((my - padT) / plotH) * PRICE_BINS)),
    );
    const binIdx = PRICE_BINS - 1 - rowFromTop;
    const cell = decoded.grid[bucketIdx]?.[binIdx];
    const bucket = decoded.buckets[bucketIdx];
    if (!cell || !bucket) {
      setHoverCell(null);
      return;
    }
    const priceLow = decoded.minPx + binIdx * decoded.binSize;
    const priceHigh = priceLow + decoded.binSize;
    setHoverCell({
      bucketIdx,
      binIdx,
      tsSec: bucket.tsSec,
      priceLow,
      priceHigh,
      bidQty: cell.bidQty,
      askQty: cell.askQty,
    });
  };

  return (
    <div>
      <PageHeader
        title="Order Book Liquidity Heatmap"
        subtitle={
          <>
            Historical resting bid and ask liquidity buckets from{" "}
            <code className="mono">get_heatmap</code>. Brighter green and red bands
            highlight price zones where large limit orders rested over time.
          </>
        }
        badge={<Pill kind="accent">{symbol}</Pill>}
        actions={
          <DataFreshness
            updatedAt={updatedAt}
            refreshing={refreshing}
            error={error}
            intervalSec={6}
            paused={paused}
            onTogglePause={() => setPaused(!paused)}
            onRefresh={refresh}
          />
        }
      />

      <div className="toolbar mb-3">
        <div className="toolbar-group">
          <SymbolSelect value={symbol} onChange={setSymbol} />

          <div className="seg-group" role="group" aria-label="Heatmap bucket interval">
            {(["1m", "5m", "1h"] as HeatInterval[]).map((iv) => (
              <button
                key={iv}
                type="button"
                className={`seg-btn mono ${interval === iv ? "active" : ""}`}
                onClick={() => setIntervalVal(iv)}
              >
                {iv}
              </button>
            ))}
          </div>

          <div className="seg-group" role="group" aria-label="Order book depth per bucket">
            {([10, 50, 100] as HeatDepth[]).map((d) => (
              <button
                key={d}
                type="button"
                className={`seg-btn mono ${depth === d ? "active" : ""}`}
                onClick={() => setDepth(d)}
              >
                Depth {d}
              </button>
            ))}
          </div>

          <div className="seg-group" role="group" aria-label="Lookback window">
            {[
              { label: "1h Window", sec: 3600 },
              { label: "6h Window", sec: 21600 },
            ].map((w) => (
              <button
                key={w.sec}
                type="button"
                className={`seg-btn mono ${windowSec === w.sec ? "active" : ""}`}
                onClick={() => setWindowSec(w.sec)}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <ErrorBox error={error} onRetry={refresh} hasStaleData={Boolean(data)} />
      {loading && !data && <Loading lines={7} />}

      {data && decoded && (
        <>
          <MetricStrip>
            <MetricCell
              label="Time Buckets"
              value={<span className="mono">{data.bucketCount ?? decoded.buckets.length}</span>}
              sub={`${data.interval} buckets · quantityMode: ${data.quantityMode ?? "close"}`}
            />
            <MetricCell
              label={
                <TermTip
                  label="Price Span"
                  tip="Lowest to highest non-zero resting order price across all returned time buckets (decoded via raw ÷ 10³)."
                />
              }
              value={
                <span className="mono">
                  {fmtPrice(decoded.minPx)} – {fmtPrice(decoded.maxPx)}
                </span>
              }
              sub={`Quote asset: ${quote}`}
            />
            <MetricCell
              label="Peak Resting Bid"
              value={
                <span className="mono up">
                  {fmtNum(decoded.peakBidQty, 4)} {base}
                </span>
              }
              sub={decoded.peakBidPx ? `At ${fmtPrice(decoded.peakBidPx)} ${quote}` : "—"}
              trend="up"
            />
            <MetricCell
              label="Peak Resting Ask"
              value={
                <span className="mono down">
                  {fmtNum(decoded.peakAskQty, 4)} {base}
                </span>
              }
              sub={decoded.peakAskPx ? `At ${fmtPrice(decoded.peakAskPx)} ${quote}` : "—"}
              trend="down"
            />
            <MetricCell
              label="Last Persisted Snapshot"
              value={
                <span className="mono">
                  {data.lastPersistedTsSec
                    ? new Date(data.lastPersistedTsSec * 1000)
                        .toISOString()
                        .slice(11, 19) + " UTC"
                    : "—"}
                </span>
              }
              sub="Zero-qty cleared levels excluded (FIN-11)"
            />
          </MetricStrip>

          <Card
            title={`Resting Liquidity Density (${symbol} · ${interval})`}
            subtitle="Green = resting bid depth · Red = resting ask depth · Lines trace best bid & best ask"
            actions={
              hoverCell ? (
                <span className="mono" style={{ fontSize: 12 }}>
                  {new Date(hoverCell.tsSec * 1000).toISOString().slice(11, 19)} UTC ·{" "}
                  <strong>
                    {fmtPrice(hoverCell.priceLow)}–{fmtPrice(hoverCell.priceHigh)}
                  </strong>{" "}
                  · Bid:{" "}
                  <span className="up">{fmtNum(hoverCell.bidQty, 4)}</span> · Ask:{" "}
                  <span className="down">{fmtNum(hoverCell.askQty, 4)}</span> {base}
                </span>
              ) : (
                <span className="faint">Hover any bucket cell to inspect resting size</span>
              )
            }
          >
            <div ref={wrapRef} style={{ width: "100%", overflow: "hidden" }}>
              <canvas
                ref={canvasRef}
                style={{ width: "100%", height: `${height}px`, display: "block", cursor: "crosshair" }}
                onMouseMove={handleMouseMove}
                onMouseLeave={() => setHoverCell(null)}
                aria-label={`Order book liquidity heatmap for ${symbol}`}
              />
            </div>
          </Card>

          <div className="mt-3">
            <Card
              title="Most Persistent Liquidity Price Bands"
              subtitle="Price bands holding the largest cumulative resting order book volume across the window"
              flush
            >
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Dominant Side</th>
                      <th className="right">Price Band ({quote})</th>
                      <th className="right">Avg Resting Size ({base})</th>
                      <th className="right">Cumulative Size ({base})</th>
                      <th className="right">Est. Avg Notional</th>
                      <th className="right">Bucket Persistence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {decoded.bandTotals.map((b) => (
                      <tr key={b.binIdx}>
                        <td>
                          <Pill kind={b.side === "bid" ? "up" : "down"}>
                            {b.side === "bid" ? "BID SUPPORT" : "ASK RESISTANCE"}
                          </Pill>
                        </td>
                        <td className="right mono">
                          {fmtPrice(b.low)} – {fmtPrice(b.high)}
                        </td>
                        <td className="right mono">{fmtNum(b.avgQty, 4)}</td>
                        <td className="right mono">{fmtNum(b.totalQty, 4)}</td>
                        <td className="right mono">{fmtUsd(b.avgQty * b.mid)}</td>
                        <td className="right mono">{b.persistencePct.toFixed(0)}% of buckets</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        </>
      )}

      {data && !decoded && !loading && (
        <Card>
          <EmptyState
            title="No non-zero resting liquidity buckets in this window"
            description="Try switching to BTC-USDT or increasing the lookback window."
          />
        </Card>
      )}
    </div>
  );
}
