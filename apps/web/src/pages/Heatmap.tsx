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
import { dec, fmtNum, price, splitSymbol } from "@poly/core";
import { api } from "../lib/api";
import { formatCompactQuoteNotional } from "../lib/format";
import { decodeHeatmapBuckets, HEATMAP_PRICE_BINS, inspectHeatmapCell } from "../lib/heatmap";
import { heatmapForRequest } from "../lib/marketIdentity";
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
  TermTip,
} from "../components/ui";

const fmtPrice = (n: number) => fmtNum(n, 2);

type HeatInterval = "1m" | "5m" | "1h";
type HeatDepth = 10 | 50 | 100;

const PRICE_BINS = HEATMAP_PRICE_BINS;

type DecodedHeatmap = NonNullable<ReturnType<typeof decodeHeatmapBuckets>>;

export function HeatmapTextInspector({
  decoded,
  base,
  quote,
}: {
  decoded: DecodedHeatmap;
  base: string;
  quote: string;
}) {
  const [selection, setSelection] = useState({ bucketIdx: 0, binIdx: 0 });
  const bucketIdx = Math.min(selection.bucketIdx, Math.max(0, decoded.buckets.length - 1));
  const inspection = inspectHeatmapCell(decoded, bucketIdx, selection.binIdx);
  // Keep adjacent native options distinguishable even for narrow or low-priced books.
  const priceDecimals = Math.min(12, Math.max(2, Math.ceil(-Math.log10(decoded.binSize)) + 2));
  const formatBandPrice = (value: number) => fmtNum(value, priceDecimals);

  return (
    <details className="heatmap-text-inspector mt-3">
      <summary>Keyboard and text inspection</summary>
      <p className="faint">
        Choose any time bucket and price band with native controls. The readout includes zero-liquidity cells and uses the same decoded data as pointer hover.
      </p>
      <div className="grid cols-2">
        <label className="field">
          <span className="faint">Time bucket</span>
          <select
            className="select"
            aria-label="Heatmap time bucket"
            value={bucketIdx}
            onChange={(event) => setSelection((current) => ({
              ...current,
              bucketIdx: Number(event.target.value),
            }))}
          >
            {decoded.buckets.map((bucket, index) => (
              <option key={`${bucket.tsSec}-${index}`} value={index}>
                Bucket {index + 1} · {new Date(bucket.tsSec * 1000).toISOString().slice(11, 16)} UTC
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="faint">Price band ({quote})</span>
          <select
            className="select"
            aria-label={`Heatmap price band in ${quote}`}
            value={selection.binIdx}
            onChange={(event) => setSelection((current) => ({
              ...current,
              binIdx: Number(event.target.value),
            }))}
          >
            {Array.from({ length: PRICE_BINS }, (_, binIdx) => {
              const low = decoded.renderMinPx + binIdx * decoded.binSize;
              const high = low + decoded.binSize;
              return (
                <option key={binIdx} value={binIdx}>
                  {formatBandPrice(low)} – {formatBandPrice(high)} {quote}
                </option>
              );
            })}
          </select>
        </label>
      </div>
      {inspection && (
        <p className="notice info" style={{ marginTop: 12 }}>
          <strong>Selected cell:</strong> {new Date(inspection.tsSec * 1000).toISOString().slice(0, 19).replace("T", " ")} UTC · Price {formatBandPrice(inspection.priceLow)}–{formatBandPrice(inspection.priceHigh)} {quote} · Resting bid {fmtNum(inspection.bidQty)} {base} · Resting ask {fmtNum(inspection.askQty)} {base}
        </p>
      )}
    </details>
  );
}

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
  const currentData = heatmapForRequest(data, symbol, interval, depth);
  const requestIdentityError = data && !currentData
    ? "Heatmap response did not match the selected symbol, interval, or depth; it was not displayed."
    : null;
  const displayError = requestIdentityError ?? error;

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

  const decoded = useMemo(
    () => decodeHeatmapBuckets(currentData?.buckets ?? []),
    [currentData],
  );

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
        ((bb - decoded.renderMinPx) /
          (decoded.renderMaxPx - decoded.renderMinPx)) * plotH;
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
        ((ba - decoded.renderMinPx) /
          (decoded.renderMaxPx - decoded.renderMinPx)) * plotH;
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
      const pxVal =
        decoded.renderMaxPx - frac * (decoded.renderMaxPx - decoded.renderMinPx);
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
    setHoverCell(inspectHeatmapCell(decoded, bucketIdx, binIdx));
  };

  return (
    <div>
      <PageHeader
        title="Depth heatmap"
        subtitle={
          <>
            Where buy and sell orders rested over time. Brighter bands mean more
            resting size at that price.
          </>
        }
        badge={<Pill kind="accent">{symbol}</Pill>}
        actions={
          <DataFreshness
            updatedAt={currentData ? updatedAt : null}
            refreshing={refreshing}
            error={displayError}
            intervalSec={6}
            paused={paused}
            onTogglePause={() => setPaused(!paused)}
            onRefresh={refresh}
          />
        }
      />

      <div className="toolbar mb-3">
        <div className="toolbar-group">

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

      <ErrorBox error={displayError} onRetry={refresh} hasStaleData={Boolean(currentData)} />
      {loading && !currentData && <Loading lines={7} />}

      {currentData && decoded && (
        <>
          <MetricStrip>
            <MetricCell
              label="Time Buckets"
              value={<span className="mono">{currentData.bucketCount ?? decoded.buckets.length}</span>}
              sub={`${currentData.interval} buckets · quantityMode: ${currentData.quantityMode ?? "close"}`}
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
                  {currentData.lastPersistedTsSec
                    ? new Date(currentData.lastPersistedTsSec * 1000)
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
            subtitle="Green = bid depth · Red = ask depth · Lines trace best bid/ask"
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
            <HeatmapTextInspector decoded={decoded} base={base} quote={quote} />
          </Card>

          <div className="mt-3">
            <Card
              title="Most Persistent Liquidity Price Bands"
              subtitle="Price bands with the most cumulative resting volume in the window"
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
                        <td className="right mono">{formatCompactQuoteNotional(b.avgQty * b.mid, quote)}</td>
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

      {currentData && !decoded && !loading && (
        <Card>
          <EmptyState
            title="No resting orders in this window"
            description="No levels, or every level had zero size. Try a longer window or another market."
          />
        </Card>
      )}
    </div>
  );
}
