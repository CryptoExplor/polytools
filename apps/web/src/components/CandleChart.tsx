import { useEffect, useMemo, useRef, useState } from "react";
import { fmtCompact, fmtNum, fmtTimeUTC } from "@poly/core";
import { EmptyState, Loading } from "./ui";

export interface CandlePoint {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed?: boolean;
}

function computeSma(values: number[], period: number): Array<number | null> {
  const out: Array<number | null> = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function fmtAxisTime(tsSec: number): string {
  if (!isFinite(tsSec)) return "";
  const iso = new Date(tsSec * 1000).toISOString();
  // e.g. "10-22 14:00"
  return `${iso.slice(5, 10)} ${iso.slice(11, 16)}`;
}

/**
 * Dependency-free institutional candlestick chart:
 * - OHLCV + Change% + Range% readout bar
 * - Optional SMA(7) & SMA(25) overlays computed from real candle closes
 * - Volume subplot
 * - 2D crosshair (time + price tags) + keyboard arrow inspection + touch support
 * - Proper ResizeObserver lifecycle cleanup
 */
export function CandleChart({
  candles,
  height = 410,
  loading = false,
  showSma7 = true,
  showSma25 = true,
}: {
  candles: CandlePoint[];
  height?: number;
  loading?: boolean;
  showSma7?: boolean;
  showSma25?: boolean;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(860);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [mouseY, setMouseY] = useState<number | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    setWidth(el.clientWidth || 860);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const data = useMemo(() => [...candles].sort((a, b) => a.time - b.time), [candles]);

  const sma7 = useMemo(() => computeSma(data.map((c) => c.close), 7), [data]);
  const sma25 = useMemo(() => computeSma(data.map((c) => c.close), 25), [data]);

  const geom = useMemo(() => {
    if (!data.length) return null;
    const padL = 8;
    const padR = 78;
    const padT = 14;
    const padB = 24;
    const volH = Math.round(height * 0.17);
    const gapH = 10;
    const priceH = Math.max(120, height - volH - padT - padB - gapH);
    const w = Math.max(140, width - padL - padR);

    const highs = data.map((c) => c.high);
    const lows = data.map((c) => c.low);
    const maxP = Math.max(...highs);
    const minP = Math.min(...lows);
    const span = maxP - minP || (maxP * 0.01 || 1);
    const maxV = Math.max(...data.map((c) => c.volume), 1e-9);

    const step = w / data.length;
    const bw = Math.max(2, Math.min(14, step * 0.66));
    const x = (i: number) => padL + i * step + step / 2;
    const y = (p: number) => padT + priceH - ((p - minP) / span) * priceH;
    const priceAtY = (py: number) =>
      maxP - ((Math.max(padT, Math.min(padT + priceH, py)) - padT) / priceH) * span;
    const volTop = padT + priceH + gapH;
    const volBot = volTop + volH;
    const yv = (v: number) => volBot - (v / maxV) * volH;

    const linePath = (series: Array<number | null>) => {
      const cmds: string[] = [];
      series.forEach((v, i) => {
        if (v === null || !isFinite(v)) return;
        cmds.push(`${cmds.length === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}`);
      });
      return cmds.join(" ");
    };

    return {
      padL,
      padR,
      padT,
      padB,
      priceH,
      volH,
      volTop,
      volBot,
      w,
      maxP,
      minP,
      maxV,
      step,
      bw,
      x,
      y,
      priceAtY,
      yv,
      linePath,
    };
  }, [data, width, height]);

  if (loading && !data.length) {
    return (
      <div ref={boxRef} style={{ padding: "20px 0" }}>
        <Loading lines={7} />
      </div>
    );
  }

  if (!geom || !data.length) {
    return (
      <div ref={boxRef}>
        <EmptyState
          title="No candle data available"
          description="The exchange returned fewer than 2 candles for this market and timeframe."
        />
      </div>
    );
  }

  const clampedHoverIdx =
    hoverIdx !== null ? Math.max(0, Math.min(data.length - 1, hoverIdx)) : null;
  const last = data[data.length - 1];
  const active = clampedHoverIdx !== null ? data[clampedHoverIdx] : last;
  const activeIdx = clampedHoverIdx !== null ? clampedHoverIdx : data.length - 1;
  const activeChangePct = active.open ? ((active.close - active.open) / active.open) * 100 : 0;
  const activeRangePct = active.low ? ((active.high - active.low) / active.low) * 100 : 0;
  const isUp = active.close >= active.open;

  const inspectPointer = (clientX: number, clientY: number, rect: DOMRect) => {
    const relX = clientX - rect.left;
    const relY = clientY - rect.top;
    const idx = Math.round((relX - geom.padL - geom.step / 2) / geom.step);
    setHoverIdx(idx >= 0 && idx < data.length ? idx : null);
    setMouseY(relY >= geom.padT && relY <= geom.padT + geom.priceH ? relY : null);
  };

  // Pick ~5 evenly spaced time ticks on X axis
  const xTickIndices: number[] = [];
  const tickCount = Math.min(6, data.length);
  for (let t = 0; t < tickCount; t++) {
    const idx = Math.round((t / Math.max(1, tickCount - 1)) * (data.length - 1));
    if (!xTickIndices.includes(idx)) xTickIndices.push(idx);
  }

  return (
    <div
      className="chart-box"
      ref={boxRef}
      tabIndex={0}
      aria-label="Interactive candlestick chart. Use Left and Right arrow keys to inspect bars."
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          setHoverIdx((prev) => (prev === null ? data.length - 1 : Math.max(0, prev - 1)));
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          setHoverIdx((prev) =>
            prev === null ? data.length - 1 : Math.min(data.length - 1, prev + 1),
          );
        } else if (e.key === "Escape") {
          setHoverIdx(null);
          setMouseY(null);
        }
      }}
    >
      {/* Live OHLCV + Indicator Legend Bar */}
      <div className="chart-ohlc-bar">
        <span className="muted">{fmtAxisTime(active.time)} UTC</span>
        <span>
          O <strong className={isUp ? "up" : "down"}>{fmtNum(active.open)}</strong>
        </span>
        <span>
          H <strong className="up">{fmtNum(active.high)}</strong>
        </span>
        <span>
          L <strong className="down">{fmtNum(active.low)}</strong>
        </span>
        <span>
          C <strong className={isUp ? "up" : "down"}>{fmtNum(active.close)}</strong>
        </span>
        <span className={isUp ? "up" : "down"}>
          {activeChangePct >= 0 ? "+" : ""}
          {activeChangePct.toFixed(2)}%
        </span>
        <span className="muted">Range {activeRangePct.toFixed(2)}%</span>
        <span className="muted">Vol {fmtCompact(active.volume)}</span>
        {showSma7 && sma7[activeIdx] !== null && (
          <span style={{ color: "#38bdf8" }}>SMA(7) {fmtNum(sma7[activeIdx]!)}</span>
        )}
        {showSma25 && sma25[activeIdx] !== null && (
          <span style={{ color: "#f59e0b" }}>SMA(25) {fmtNum(sma25[activeIdx]!)}</span>
        )}
      </div>

      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Price candlesticks and volume chart"
        onMouseMove={(e) =>
          inspectPointer(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect())
        }
        onTouchMove={(e) => {
          if (e.touches[0]) {
            inspectPointer(
              e.touches[0].clientX,
              e.touches[0].clientY,
              e.currentTarget.getBoundingClientRect(),
            );
          }
        }}
        onMouseLeave={() => {
          setHoverIdx(null);
          setMouseY(null);
        }}
      >
        {/* Horizontal price grid + right-axis price labels */}
        {[0, 0.2, 0.4, 0.6, 0.8, 1].map((f) => {
          const p = geom.maxP - f * (geom.maxP - geom.minP);
          const yv = geom.y(p);
          return (
            <g key={f}>
              <line
                x1={geom.padL}
                x2={width - geom.padR}
                y1={yv}
                y2={yv}
                stroke="var(--border-subtle)"
                strokeDasharray="3 5"
              />
              <text
                x={width - geom.padR + 7}
                y={yv + 3.5}
                fontSize="10"
                fill="var(--text-muted)"
                fontFamily="var(--mono)"
              >
                {fmtNum(p)}
              </text>
            </g>
          );
        })}

        {/* Divider between price and volume subplot */}
        <line
          x1={geom.padL}
          x2={width - geom.padR}
          y1={geom.volTop - 4}
          y2={geom.volTop - 4}
          stroke="var(--border-subtle)"
        />
        <text
          x={width - geom.padR + 7}
          y={geom.volTop + 10}
          fontSize="9.5"
          fill="var(--text-muted)"
          fontFamily="var(--mono)"
        >
          VOL {fmtCompact(geom.maxV)}
        </text>

        {/* X-axis time ticks */}
        {xTickIndices.map((idx) => (
          <g key={idx}>
            <line
              x1={geom.x(idx)}
              x2={geom.x(idx)}
              y1={geom.padT}
              y2={geom.volBot}
              stroke="var(--border-subtle)"
              strokeDasharray="2 6"
            />
            <text
              x={geom.x(idx)}
              y={height - 6}
              textAnchor={
                idx === 0 ? "start" : idx === data.length - 1 ? "end" : "middle"
              }
              fontSize="10"
              fill="var(--text-muted)"
              fontFamily="var(--mono)"
            >
              {fmtAxisTime(data[idx].time)}
            </text>
          </g>
        ))}

        {/* Volume bars */}
        {data.map((c, i) => (
          <rect
            key={`v${c.time}-${i}`}
            x={geom.x(i) - geom.bw / 2}
            y={geom.yv(c.volume)}
            width={geom.bw}
            height={Math.max(1, geom.volBot - geom.yv(c.volume))}
            fill={c.close >= c.open ? "var(--up-soft)" : "var(--down-soft)"}
            stroke={c.close >= c.open ? "var(--up)" : "var(--down)"}
            strokeWidth="0.4"
          />
        ))}

        {/* Candlesticks */}
        {data.map((c, i) => {
          const up = c.close >= c.open;
          const color = up ? "var(--up)" : "var(--down)";
          const top = geom.y(Math.max(c.open, c.close));
          const bot = geom.y(Math.min(c.open, c.close));
          return (
            <g
              key={`${c.time}-${i}`}
              opacity={clampedHoverIdx === null || clampedHoverIdx === i ? 1 : 0.55}
            >
              <line
                x1={geom.x(i)}
                x2={geom.x(i)}
                y1={geom.y(c.high)}
                y2={geom.y(c.low)}
                stroke={color}
                strokeWidth="1.2"
              />
              <rect
                x={geom.x(i) - geom.bw / 2}
                y={top}
                width={geom.bw}
                height={Math.max(1.5, bot - top)}
                fill={color}
                rx="0.8"
              />
            </g>
          );
        })}

        {/* Optional SMA overlays */}
        {showSma7 && (
          <path
            d={geom.linePath(sma7)}
            fill="none"
            stroke="#38bdf8"
            strokeWidth="1.35"
             opacity="0.9"
          />
        )}
        {showSma25 && (
          <path
            d={geom.linePath(sma25)}
            fill="none"
            stroke="#f59e0b"
            strokeWidth="1.35"
            opacity="0.9"
          />
        )}

        {/* Last close price reference line + right-axis tag */}
        <line
          x1={geom.padL}
          x2={width - geom.padR}
          y1={geom.y(last.close)}
          y2={geom.y(last.close)}
          stroke="var(--accent)"
          strokeDasharray="4 4"
        />
        <rect
          x={width - geom.padR + 2}
          y={geom.y(last.close) - 9}
          width={geom.padR - 4}
          height={18}
          rx="4"
          fill="var(--accent)"
        />
        <text
          x={width - geom.padR + 7}
          y={geom.y(last.close) + 3.5}
          fontSize="10"
          fill="#fff"
          fontFamily="var(--mono)"
          fontWeight="600"
        >
          {fmtNum(last.close)}
        </text>

        {/* Crosshair */}
        {clampedHoverIdx !== null && (
          <g>
            {/* Vertical time crosshair */}
            <line
              x1={geom.x(clampedHoverIdx)}
              x2={geom.x(clampedHoverIdx)}
              y1={geom.padT}
              y2={geom.volBot}
              stroke="var(--text-secondary)"
              strokeDasharray="3 3"
            />
            {/* Horizontal cursor price crosshair */}
            {mouseY !== null && (
              <>
                <line
                  x1={geom.padL}
                  x2={width - geom.padR}
                  y1={mouseY}
                  y2={mouseY}
                  stroke="var(--text-muted)"
                  strokeDasharray="3 3"
                />
                <rect
                  x={width - geom.padR + 2}
                  y={mouseY - 9}
                  width={geom.padR - 4}
                  height={18}
                  rx="4"
                  fill="var(--bg-elevated)"
                  stroke="var(--border-strong)"
                />
                <text
                  x={width - geom.padR + 7}
                  y={mouseY + 3.5}
                  fontSize="10"
                  fill="var(--text-primary)"
                  fontFamily="var(--mono)"
                >
                  {fmtNum(geom.priceAtY(mouseY))}
                </text>
              </>
            )}
          </g>
        )}
      </svg>

      {clampedHoverIdx !== null && (
        <div
          className="chart-tip"
          style={{
            left: Math.min(
              Math.max(10, geom.x(clampedHoverIdx) + 14),
              Math.max(10, width - 260),
            ),
            top: 46,
          }}
        >
          <div className="muted">
            {new Date(active.time * 1000).toISOString().slice(0, 10)}{" "}
            {fmtTimeUTC(active.time * 1000)} UTC
          </div>
          <div>
            O <span className={isUp ? "up" : "down"}>{fmtNum(active.open)}</span> · H{" "}
            <span className="up">{fmtNum(active.high)}</span> · L{" "}
            <span className="down">{fmtNum(active.low)}</span> · C{" "}
            <span className={isUp ? "up" : "down"}>{fmtNum(active.close)}</span>
          </div>
          <div className="muted">
            Vol {fmtCompact(active.volume)} · Δ{" "}
            <span className={isUp ? "up" : "down"}>
              {activeChangePct >= 0 ? "+" : ""}
              {activeChangePct.toFixed(2)}%
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
