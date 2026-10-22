import { useMemo, useRef, useState } from "react";
import { cumulativeDepth, fmtCompact, fmtNum } from "@poly/core";

interface Level {
  price: number;
  qty: number;
}

/**
 * Cumulative depth chart (bids left / asks right of mid).
 * Pure SVG + ResizeObserver sizing — no chart library.
 */
export function DepthChart({ bids, asks, height = 300 }: { bids: Level[]; asks: Level[]; height?: number }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ x: number; price: number; cum: number; side: "bid" | "ask" } | null>(null);
  const [width, setWidth] = useState(760);

  // Observe container width once mounted.
  const setRef = (el: HTMLDivElement | null) => {
    (boxRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    if (el) {
      setWidth(el.clientWidth);
      new ResizeObserver((es) => setWidth(es[0].contentRect.width)).observe(el);
    }
  };

  const geom = useMemo(() => {
    const bidsAsc = [...bids].sort((a, b) => a.price - b.price);
    const asksAsc = [...asks].sort((a, b) => a.price - b.price);
    if (!bidsAsc.length || !asksAsc.length) return null;
    const bidCum = cumulativeDepth(bidsAsc); // cumulative outward from mid
    const askCum = cumulativeDepth(asksAsc);
    const minP = bidsAsc[0].price;
    const maxP = asksAsc[asksAsc.length - 1].price;
    const mid = (bidsAsc[bidsAsc.length - 1].price + asksAsc[0].price) / 2;
    const maxCum = Math.max(bidCum[bidCum.length - 1]?.cum ?? 0, askCum[askCum.length - 1]?.cum ?? 0);
    const padL = 8, padR = 8, padT = 14, padB = 24;
    const w = width - padL - padR;
    const h = height - padT - padB;
    const x = (p: number) => padL + ((p - minP) / (maxP - minP || 1)) * w;
    const y = (c: number) => padT + h - (c / (maxCum || 1)) * h;

    const area = (series: { price: number; cum: number }[], baseline: number) =>
      series.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.price).toFixed(1)},${y(p.cum).toFixed(1)}`).join(" ") +
      ` L${x(series[series.length - 1].price).toFixed(1)},${y(0).toFixed(1)} L${x(series[0].price).toFixed(1)},${y(0).toFixed(1)} Z`;

    return { bidCum, askCum, minP, maxP, mid, maxCum, x, y, w, h, padL, padT, area };
  }, [bids, asks, width, height]);

  if (!geom) return <div className="faint center" style={{ padding: 30 }}>Waiting for book data…</div>;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const priceAt = geom.minP + ((px - geom.padL) / geom.w) * (geom.maxP - geom.minP);
    const side = priceAt <= geom.mid ? "bid" : "ask";
    const series = side === "bid" ? geom.bidCum : geom.askCum;
    // nearest point
    let best = series[0];
    for (const p of series) if (Math.abs(p.price - priceAt) < Math.abs(best.price - priceAt)) best = p;
    setHover({ x: px, price: best.price, cum: best.cum, side });
  };

  return (
    <div className="chart-box" ref={setRef}>
      <svg width={width} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {/* grid */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={geom.padL} x2={width - 8} y1={geom.padT + geom.h * f} y2={geom.padT + geom.h * f} stroke="var(--border-soft)" strokeDasharray="3 6" />
        ))}
        {/* bid area */}
        <path d={geom.area(geom.bidCum, 0)} fill="rgba(34,197,139,0.14)" stroke="var(--up)" strokeWidth="1.6" />
        {/* ask area */}
        <path d={geom.area(geom.askCum, 0)} fill="rgba(240,69,92,0.12)" stroke="var(--down)" strokeWidth="1.6" />
        {/* mid line */}
        <line x1={geom.x(geom.mid)} x2={geom.x(geom.mid)} y1={geom.padT} y2={geom.padT + geom.h} stroke="var(--text-faint)" strokeDasharray="4 4" />
        <text x={geom.x(geom.mid)} y={geom.padT + geom.h + 16} textAnchor="middle" fontSize="11" fill="var(--text-dim)" fontFamily="var(--mono)">
          mid {fmtNum(geom.mid)}
        </text>
        <text x={geom.padL} y={geom.padT + geom.h + 16} fontSize="10.5" fill="var(--up)" fontFamily="var(--mono)">{fmtNum(geom.minP)}</text>
        <text x={geom.padL + geom.w} y={geom.padT + geom.h + 16} textAnchor="end" fontSize="10.5" fill="var(--down)" fontFamily="var(--mono)">{fmtNum(geom.maxP)}</text>
        {hover && (
          <>
            <line x1={hover.x} x2={hover.x} y1={geom.padT} y2={geom.padT + geom.h} stroke="var(--accent)" strokeDasharray="3 3" />
            <circle cx={hover.x} cy={geom.y(hover.cum)} r="4" fill="var(--accent)" />
          </>
        )}
      </svg>
      {hover && (
        <div className="chart-tip" style={{ display: "block", left: Math.min(hover.x + 12, width - 170), top: 20 }}>
          <div className={hover.side === "bid" ? "up" : "down"}>{hover.side === "bid" ? "BID" : "ASK"} @ {fmtNum(hover.price)}</div>
          <div className="muted">cum qty {fmtNum(hover.cum)}</div>
          <div className="muted">≈ {fmtCompact(hover.cum * hover.price, "$")}</div>
        </div>
      )}
    </div>
  );
}
