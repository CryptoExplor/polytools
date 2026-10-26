/**
 * TOOL 4 — Multi-Timeframe Candlestick Charts (/#/charts)
 * All 11 exchange timeframes (1s to 1mo), volume subplot, 2D crosshair,
 * optional SMA(7)/SMA(25) overlays, and window statistics.
 */

import { useMemo, useState } from "react";
import {
  CANDLE_TIMEFRAMES,
  dec,
  fmtCompact,
  fmtNum,
  fmtPctFromBps,
  price,
  splitSymbol,
  type CandleTimeframe,
} from "@poly/core";
import { api } from "../lib/api";
import { usePollData } from "../lib/hooks";
import { useApp } from "../lib/store";
import {
  Card,
  DataFreshness,
  ErrorBox,
  MetricCell,
  MetricStrip,
  PageHeader,
  Pill,
} from "../components/ui";
import { CandleChart, type CandlePoint } from "../components/CandleChart";

const POLL_BY_TF: Record<string, number> = {
  "1s": 1000,
  "1m": 1500,
  "5m": 2000,
  "15m": 3000,
  "30m": 5000,
  "1h": 8000,
  "4h": 15000,
  "12h": 20000,
  "1d": 30000,
  "1w": 60000,
  "1mo": 60000,
};

export default function Charts() {
  const { symbol, setSymbol } = useApp();
  const [tf, setTf] = useState<CandleTimeframe>("1h");
  const [limit, setLimit] = useState<number>(140);
  const [rangeHours, setRangeHours] = useState<number | null>(null);
  const [showSma7, setShowSma7] = useState<boolean>(true);
  const [showSma25, setShowSma25] = useState<boolean>(true);

  const pollInterval = POLL_BY_TF[tf] ?? 5000;

  const {
    data,
    error,
    loading,
    refreshing,
    updatedAt,
    paused,
    setPaused,
    refresh,
  } = usePollData(
    () => {
      const endTsSec = rangeHours
        ? Math.floor(Date.now() / 60_000) * 60
        : undefined;
      const startTsSec =
        rangeHours && endTsSec ? endTsSec - rangeHours * 3600 : undefined;
      return api.candles(symbol, tf, limit, startTsSec, endTsSec);
    },
    pollInterval,
    [symbol, tf, limit, rangeHours],
  );

  const { data: ov } = usePollData(() => api.overview([symbol]), 4000, [symbol]);
  const stats = ov?.markets?.[0];
  const [base, quote] = splitSymbol(symbol);

  const candles: CandlePoint[] = useMemo(
    () =>
      (data?.candles ?? []).map((c) => ({
        time: c.time,
        open: price(c.open),
        high: price(c.high),
        low: price(c.low),
        close: price(c.close),
        volume: dec(c.volume),
        isClosed: c.isClosed,
      })),
    [data],
  );

  const windowStats = useMemo(() => {
    if (candles.length < 1) return null;
    const sorted = [...candles].sort((a, b) => a.time - b.time);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const winHigh = Math.max(...sorted.map((c) => c.high));
    const winLow = Math.min(...sorted.map((c) => c.low));
    const winVol = sorted.reduce((s, c) => s + (isFinite(c.volume) ? c.volume : 0), 0);
    const changeFrac = first.open ? (last.close - first.open) / first.open : 0;
    return {
      first,
      last,
      winHigh,
      winLow,
      winVol,
      changeFrac,
    };
  }, [candles]);

  return (
    <div className="page-stack">
      <PageHeader
        title={`Price chart · ${symbol}`}
        badge={
          stats ? (
            <Pill kind={stats.change24hBps >= 0 ? "up" : "down"}>
              24h {stats.change24hBps >= 0 ? "▲ " : "▼ "}
              {fmtPctFromBps(stats.change24hBps)}
            </Pill>
          ) : null
        }
        subtitle="Price history. One bar per period. Hover or use Left/Right arrows to inspect."
        actions={
          <div className="row-flex">
            <DataFreshness
              updatedAt={updatedAt}
              refreshing={refreshing}
              error={error}
              intervalSec={pollInterval / 1000}
              paused={paused}
              onTogglePause={() => setPaused(!paused)}
              onRefresh={refresh}
            />
          </div>
        }
      />

      <MetricStrip>
        <MetricCell
          label="Last Price"
          trend={
            stats
              ? stats.change24hBps > 0
                ? "up"
                : stats.change24hBps < 0
                  ? "down"
                  : undefined
              : undefined
          }
          value={
            stats
              ? fmtNum(price(stats.lastPrice))
              : windowStats
                ? fmtNum(windowStats.last.close)
                : "—"
          }
          sub={stats ? `Index: ${fmtNum(price(stats.indexPrice))} ${quote}` : quote}
        />
        <MetricCell
          label="24h Range"
          value={
            stats
              ? `${fmtNum(price(stats.low24h))} – ${fmtNum(price(stats.high24h))}`
              : "—"
          }
          sub={
            stats
              ? `24h Vol: ${fmtCompact(dec(stats.volume24hUsd), "$")}`
              : "24h High / Low"
          }
        />
        <MetricCell
          label={`${tf} Window Return`}
          trend={
            windowStats
              ? windowStats.changeFrac > 0
                ? "up"
                : windowStats.changeFrac < 0
                  ? "down"
                  : undefined
              : undefined
          }
          value={
            windowStats
              ? `${windowStats.changeFrac >= 0 ? "+" : ""}${(
                  windowStats.changeFrac * 100
                ).toFixed(2)}%`
              : "—"
          }
          sub={`${candles.length} bars loaded`}
        />
        <MetricCell
          label={`${tf} Window Low / High`}
          value={
            windowStats
              ? `${fmtNum(windowStats.winLow)} – ${fmtNum(windowStats.winHigh)}`
              : "—"
          }
          sub={
            windowStats
              ? `Window Vol: ${fmtCompact(windowStats.winVol)} ${base}`
              : "Visible range"
          }
        />
      </MetricStrip>

      <ErrorBox error={error} onRetry={refresh} hasStaleData={candles.length > 0} />

      {/* Timeframe & Overlay Toolbar */}
      <Card
        title={`${symbol} · ${tf} Candles`}
        subtitle="Focus the chart, then Left/Right inspects a bar."
        actions={
          <div className="row-flex" style={{ gap: 8 }}>
            {/* All 11 supported exchange timeframes */}
            <div className="seg-group" role="group" aria-label="Candle timeframe">
              {CANDLE_TIMEFRAMES.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`seg-btn mono ${tf === t ? "active" : ""}`}
                  onClick={() => setTf(t)}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Bar count limit (MCP max = 200 per DEF-03) */}
            <div className="seg-group" role="group" aria-label="Number of candles">
              {[60, 140, 200].map((n) => (
                <button
                  key={n}
                  type="button"
                  className={`seg-btn ${limit === n ? "active" : ""}`}
                  onClick={() => setLimit(n)}
                >
                  {n} bars
                </button>
              ))}
            </div>

            {/* Optional time window filter (FEAT-07) */}
            <div className="seg-group" role="group" aria-label="Time window filter">
              {[
                { label: "All", hrs: null },
                { label: "24h", hrs: 24 },
                { label: "7d", hrs: 168 },
              ].map((r) => (
                <button
                  key={r.label}
                  type="button"
                  className={`seg-btn ${rangeHours === r.hrs ? "active" : ""}`}
                  onClick={() => setRangeHours(r.hrs)}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {/* Moving average overlay toggles */}
            <div className="seg-group" role="group" aria-label="Moving average overlays">
              <button
                type="button"
                className={`seg-btn ${showSma7 ? "active" : ""}`}
                onClick={() => setShowSma7((v) => !v)}
                style={{ color: showSma7 ? "#38bdf8" : undefined }}
                title="Simple moving average of candle closes over 7 bars."
              >
                SMA 7
              </button>
              <button
                type="button"
                className={`seg-btn ${showSma25 ? "active" : ""}`}
                onClick={() => setShowSma25((v) => !v)}
                style={{ color: showSma25 ? "#f59e0b" : undefined }}
                title="Simple moving average of candle closes over 25 bars."
              >
                SMA 25
              </button>
            </div>
          </div>
        }
        footer={
          <>
            <span>
              MCP marks past bars as open on some intervals; only the rightmost bar is the current
              forming period.
            </span>
            <span className="mono">
              Auto-refresh: {(pollInterval / 1000).toFixed(1)}s for {tf}
            </span>
          </>
        }
      >
        <CandleChart
          candles={candles}
          height={420}
          loading={loading}
          showSma7={showSma7}
          showSma25={showSma25}
        />
      </Card>
    </div>
  );
}
