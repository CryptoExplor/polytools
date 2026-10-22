/**
 * TOOL 4 — Candlestick charts. All 11 exchange timeframes, volume subplot,
 * crosshair OHLCV readout, live refresh tuned to the timeframe.
 */

import { useMemo, useState } from "react";
import { api } from "../lib/api";
import { usePollData } from "../lib/hooks";
import { useApp } from "../lib/store";
import { Card, ErrorBox, Pill, SymbolSelect } from "../components/ui";
import { CandleChart, type CandlePoint } from "../components/CandleChart";
import { CANDLE_TIMEFRAMES, price, dec, fmtNum, fmtPctFromBps, type CandleTimeframe } from "@poly/core";

const POLL_BY_TF: Record<string, number> = {
  "1s": 1000, "1m": 1500, "5m": 2000, "15m": 3000, "30m": 5000, "1h": 8000,
  "4h": 15000, "12h": 20000, "1d": 30000, "1w": 60000, "1mo": 60000,
};

export default function Charts() {
  const { symbol, setSymbol } = useApp();
  const [tf, setTf] = useState<CandleTimeframe>("1h");
  const { data, error } = usePollData(
    () => api.candles(symbol, tf, 140),
    POLL_BY_TF[tf] ?? 5000,
    [symbol, tf],
  );
  const { data: ov } = usePollData(() => api.overview([symbol]), 4000, [symbol]);
  const stats = ov?.markets?.[0];

  const candles: CandlePoint[] = useMemo(
    () =>
      (data?.candles ?? []).map((c) => ({
        time: c.time,
        open: price(c.open),
        high: price(c.high),
        low: price(c.low),
        close: price(c.close),
        volume: dec(c.volume),
      })),
    [data],
  );

  const change = useMemo(() => {
    if (candles.length < 2) return null;
    const first = candles[0].open;
    const last = candles[candles.length - 1].close;
    return (last - first) / first;
  }, [candles]);

  return (
    <div className="grid">
      <div className="row-flex">
        <SymbolSelect value={symbol} onChange={setSymbol} />
        <div className="row-flex" style={{ gap: 6 }}>
          {CANDLE_TIMEFRAMES.map((t) => (
            <button key={t} className={`btn sm ${tf === t ? "primary" : "ghost"}`} onClick={() => setTf(t)}>
              {t}
            </button>
          ))}
        </div>
      </div>

      <ErrorBox error={error} />

      <Card
        title={
          stats ? `${symbol} · ${fmtNum(price(stats.lastPrice))} (${fmtPctFromBps(stats.change24hBps)} 24h)` : symbol
        }
        actions={
          change !== null && (
            <Pill kind={change >= 0 ? "up" : "down"}>
              {tf} window {(change * 100).toFixed(2)}% · {candles.length} candles
            </Pill>
          )
        }
      >
        <CandleChart candles={candles} />
        <div className="faint mt-2">
          Unclosed candles are included (engine streams them live) — the rightmost bar is still forming.
        </div>
      </Card>
    </div>
  );
}
