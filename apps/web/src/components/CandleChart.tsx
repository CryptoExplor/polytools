import { useMemo, useRef, useState } from "react";
import { fmtCompact, fmtNum, fmtTimeUTC } from "@poly/core";

export interface CandlePoint {
  time: number; // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Dependency-free candlestick chart: volume subplot, last-price tag,
 * crosshair with OHLCV tooltip. Sized via ResizeObserver.
 */
export function CandleChart({ candles, height = 380 }: { candles: CandlePoint[]; height?: number }) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(820);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const setRef = (el: HTMLDivElement | null) => {
    boxRef.current = el;
    if (el) {
      setWidth(el.clientWidth);
      new ResizeObserver((es) => setWidth(es[0].contentRect.width)).observe(el);
    }
  };

  const data = useMemo(() => [...candles].sort((a, b) => a.time - b.time), [candles]);

  const geom = useMemo(() => {
    if (data.length < 2) return null;
    const padL = 6, padR = 74, padT = 12;
    const volH = Math.round(height * 0.16);
    const priceH = height - volH - padT - 22;
    const w = width - padL - padR;
    const highs = data.map((c) => c.high);
    const lows = data.map((c) => c.low);
    const maxP = Math.max(...highs);
    const minP = Math.min(...lows);
    const span = maxP - minP || 1;
    const maxV = Math.max(...data.map((c) => c.volume)) || 1;
    const step = w / data.length;
    const bw = Math.max(1.5, Math.min(14, step * 0.62));
    const x = (i: number) => padL + i * step + step / 2;
    const y = (p: number) => padT + priceH - ((p - minP) / span) * priceH;
    const yv = (v: number) => padT + priceH + 8 + volH - (v / maxV) * volH;
    return { padL, padR, padT, priceH, volH, w, maxP, minP, step, bw, x, y, yv };
  }, [data, width, height]);

  if (!geom || !data.length) {
    return <div className="faint center" style={{ padding: 40 }}>Loading candles…</div>;
  }
  const last = data[data.length - 1];
  const hover = hoverIdx !== null ? data[hoverIdx] : null;

  return (
    <div className="chart-box" ref={setRef}>
      <svg
        width={width}
        height={height}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const i = Math.round((e.clientX - r.left - geom.padL - geom.step / 2) / geom.step);
          setHoverIdx(i >= 0 && i < data.length ? i : null);
        }}
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* horizontal grid + price labels */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const p = geom.maxP - f * (geom.maxP - geom.minP);
          const yv = geom.y(p);
          return (
            <g key={f}>
              <line x1={geom.padL} x2={width - geom.padR} y1={yv} y2={yv} stroke="var(--border-soft)" strokeDasharray="3 6" />
              <text x={width - geom.padR + 8} y={yv + 4} fontSize="10.5" fill="var(--text-faint)" fontFamily="var(--mono)">
                {fmtNum(p)}
              </text>
            </g>
          );
        })}

        {/* volume bars */}
        {data.map((c, i) => (
          <rect
            key={`v${i}`}
            x={geom.x(i) - geom.bw / 2}
            y={geom.yv(c.volume)}
            width={geom.bw}
            height={Math.max(1, geom.padT + geom.priceH + 8 + geom.volH - geom.yv(c.volume))}
            fill={c.close >= c.open ? "rgba(34,197,139,0.35)" : "rgba(240,69,92,0.35)"}
          />
        ))}

        {/* candles */}
        {data.map((c, i) => {
          const up = c.close >= c.open;
          const color = up ? "var(--up)" : "var(--down)";
          const top = geom.y(Math.max(c.open, c.close));
          const bot = geom.y(Math.min(c.open, c.close));
          return (
            <g key={i} opacity={hoverIdx === null || hoverIdx === i ? 1 : 0.45}>
              <line x1={geom.x(i)} x2={geom.x(i)} y1={geom.y(c.high)} y2={geom.y(c.low)} stroke={color} strokeWidth="1.2" />
              <rect x={geom.x(i) - geom.bw / 2} y={top} width={geom.bw} height={Math.max(1.2, bot - top)} fill={color} rx="1" />
            </g>
          );
        })}

        {/* last price line + tag */}
        <line x1={geom.padL} x2={width - geom.padR} y1={geom.y(last.close)} y2={geom.y(last.close)} stroke="var(--accent)" strokeDasharray="5 4" />
        <rect x={width - geom.padR + 2} y={geom.y(last.close) - 10} width={geom.padR - 4} height={20} rx="5" fill="var(--accent)" />
        <text x={width - geom.padR + 8} y={geom.y(last.close) + 4} fontSize="10.5" fill="#fff" fontFamily="var(--mono)">
          {fmtNum(last.close)}
        </text>

        {/* crosshair */}
        {hover && hoverIdx !== null && (
          <line x1={geom.x(hoverIdx)} x2={geom.x(hoverIdx)} y1={geom.padT} y2={geom.padT + geom.priceH + 8 + geom.volH} stroke="var(--text-faint)" strokeDasharray="3 4" />
        )}
      </svg>

      {hover && (
        <div className="chart-tip" style={{ display: "block", left: 10, top: 10 }}>
          <div className="muted">{fmtTimeUTC(hover.time * 1000)} UTC</div>
          <div>
            O <span className={hover.close >= hover.open ? "up" : "down"}>{fmtNum(hover.open)}</span>  H <span className="up">{fmtNum(hover.high)}</span>{" "}
            L <span className="down">{fmtNum(hover.low)}</span>  C <span className={hover.close >= hover.open ? "up" : "down"}>{fmtNum(hover.close)}</span>
          </div>
          <div className="muted">vol {fmtCompact(hover.volume)}</div>
        </div>
      )}
    </div>
  );
}
