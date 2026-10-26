import { useEffect, useMemo, useRef, useState } from "react";
import { cumulativeDepth, fmtCompact, fmtNum } from "@poly/core";
import { EmptyState } from "./ui";
import { formatCompactQuoteNotional } from "../lib/format";

interface Level {
  price: number;
  qty: number;
}

/**
 * Cumulative L2 order-book depth chart (bids left of mid, asks right of mid).
 * Accumulates bid depth outward from bestBid down to lowest bid, and ask depth
 * outward from bestAsk up to highest ask.
 */
export function DepthChart({
  bids,
  asks,
  height = 290,
  quoteAsset,
}: {
  bids: Level[];
  asks: Level[];
  height?: number;
  quoteAsset: string;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{
    x: number;
    price: number;
    cum: number;
    side: "bid" | "ask";
    distPct: number;
  } | null>(null);
  const [width, setWidth] = useState(760);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    setWidth(el.clientWidth || 760);
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geom = useMemo(() => {
    const validBids = bids.filter((b) => isFinite(b.price) && isFinite(b.qty) && b.qty > 0);
    const validAsks = asks.filter((a) => isFinite(a.price) && isFinite(a.qty) && a.qty > 0);
    if (!validBids.length || !validAsks.length) return null;

    // Accumulate bids outward from best bid (highest price -> lowest price), then order left-to-right
    const bidsFromMid = [...validBids].sort((a, b) => b.price - a.price);
    const bidCumDesc = cumulativeDepth(bidsFromMid);
    const bidCum = [...bidCumDesc].reverse(); // ascending by price (left edge = max cum, near mid = bestBid qty)

    // Accumulate asks outward from best ask (lowest price -> highest price)
    const asksFromMid = [...validAsks].sort((a, b) => a.price - b.price);
    const askCum = cumulativeDepth(asksFromMid);

    const bestBid = bidsFromMid[0].price;
    const bestAsk = asksFromMid[0].price;
    const minP = bidCum[0].price;
    const maxP = askCum[askCum.length - 1].price;
    const mid = (bestBid + bestAsk) / 2;
    const maxCum = Math.max(
      bidCum[0]?.cum ?? 0,
      askCum[askCum.length - 1]?.cum ?? 0,
      1e-9,
    );

    const padL = 10;
    const padR = 64;
    const padT = 14;
    const padB = 26;
    const w = Math.max(120, width - padL - padR);
    const h = Math.max(80, height - padT - padB);
    const x = (p: number) => padL + ((p - minP) / (maxP - minP || 1)) * w;
    const y = (c: number) => padT + h - (c / maxCum) * h;

    // Step-function path for true orderbook staircase visualization
    const stepLine = (series: { price: number; cum: number }[]) => {
      if (!series.length) return "";
      const pts: string[] = [];
      for (let i = 0; i < series.length; i++) {
        const px = x(series[i].price).toFixed(1);
        const py = y(series[i].cum).toFixed(1);
        if (i === 0) {
          pts.push(`M${px},${py}`);
        } else {
          const prevY = y(series[i - 1].cum).toFixed(1);
          pts.push(`L${px},${prevY} L${px},${py}`);
        }
      }
      return pts.join(" ");
    };

    const stepArea = (series: { price: number; cum: number }[]) => {
      if (!series.length) return "";
      const line = stepLine(series);
      const firstX = x(series[0].price).toFixed(1);
      const lastX = x(series[series.length - 1].price).toFixed(1);
      const baseY = y(0).toFixed(1);
      return `${line} L${lastX},${baseY} L${firstX},${baseY} Z`;
    };

    return {
      bidCum,
      askCum,
      bestBid,
      bestAsk,
      minP,
      maxP,
      mid,
      maxCum,
      x,
      y,
      w,
      h,
      padL,
      padR,
      padT,
      stepLine,
      stepArea,
    };
  }, [bids, asks, width, height]);

  if (!geom) {
    return (
      <div ref={boxRef}>
        <EmptyState
          title="Order book depth unavailable"
          description="Waiting for both bid and ask levels from the exchange to render cumulative depth."
        />
      </div>
    );
  }

  const inspectAtX = (pxClient: number, rectLeft: number) => {
    const px = pxClient - rectLeft;
    const clampedX = Math.max(geom.padL, Math.min(geom.padL + geom.w, px));
    const priceAt = geom.minP + ((clampedX - geom.padL) / geom.w) * (geom.maxP - geom.minP);
    const side: "bid" | "ask" = priceAt <= geom.mid ? "bid" : "ask";
    const series = side === "bid" ? geom.bidCum : geom.askCum;
    let best = series[0];
    for (const p of series) {
      if (Math.abs(p.price - priceAt) < Math.abs(best.price - priceAt)) best = p;
    }
    const distPct = geom.mid > 0 ? ((best.price - geom.mid) / geom.mid) * 100 : 0;
    setHover({
      x: geom.x(best.price),
      price: best.price,
      cum: best.cum,
      side,
      distPct,
    });
  };

  return (
    <div className="chart-box" ref={boxRef}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Order book cumulative depth chart"
        onMouseMove={(e) => inspectAtX(e.clientX, e.currentTarget.getBoundingClientRect().left)}
        onTouchMove={(e) => {
          if (e.touches[0]) {
            inspectAtX(e.touches[0].clientX, e.currentTarget.getBoundingClientRect().left);
          }
        }}
        onMouseLeave={() => setHover(null)}
      >
        {/* Horizontal cumulative depth grid */}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const val = geom.maxCum * (1 - f);
          const yPos = geom.padT + geom.h * f;
          return (
            <g key={f}>
              <line
                x1={geom.padL}
                x2={geom.padL + geom.w}
                y1={yPos}
                y2={yPos}
                stroke="var(--border-subtle)"
                strokeDasharray="3 5"
              />
              <text
                x={geom.padL + geom.w + 6}
                y={yPos + 3.5}
                fontSize="10"
                fill="var(--text-muted)"
                fontFamily="var(--mono)"
              >
                {fmtCompact(val)}
              </text>
            </g>
          );
        })}

        {/* Bid cumulative staircase */}
        <path d={geom.stepArea(geom.bidCum)} fill="var(--up-soft)" />
        <path
          d={geom.stepLine(geom.bidCum)}
          fill="none"
          stroke="var(--up)"
          strokeWidth="1.75"
        />

        {/* Ask cumulative staircase */}
        <path d={geom.stepArea(geom.askCum)} fill="var(--down-soft)" />
        <path
          d={geom.stepLine(geom.askCum)}
          fill="none"
          stroke="var(--down)"
          strokeWidth="1.75"
        />

        {/* Mid-price divider */}
        <line
          x1={geom.x(geom.mid)}
          x2={geom.x(geom.mid)}
          y1={geom.padT}
          y2={geom.padT + geom.h}
          stroke="var(--border-strong)"
          strokeDasharray="4 4"
        />
        <text
          x={geom.x(geom.mid)}
          y={geom.padT + geom.h + 17}
          textAnchor="middle"
          fontSize="10.5"
          fill="var(--text-secondary)"
          fontFamily="var(--mono)"
        >
          mid {fmtNum(geom.mid)}
        </text>
        <text
          x={geom.padL}
          y={geom.padT + geom.h + 17}
          fontSize="10"
          fill="var(--up)"
          fontFamily="var(--mono)"
        >
          {fmtNum(geom.minP)}
        </text>
        <text
          x={geom.padL + geom.w}
          y={geom.padT + geom.h + 17}
          textAnchor="end"
          fontSize="10"
          fill="var(--down)"
          fontFamily="var(--mono)"
        >
          {fmtNum(geom.maxP)}
        </text>

        {/* Hover crosshair */}
        {hover && (
          <g>
            <line
              x1={hover.x}
              x2={hover.x}
              y1={geom.padT}
              y2={geom.padT + geom.h}
              stroke="var(--accent)"
              strokeDasharray="3 3"
            />
            <line
              x1={geom.padL}
              x2={geom.padL + geom.w}
              y1={geom.y(hover.cum)}
              y2={geom.y(hover.cum)}
              stroke="var(--border-default)"
              strokeDasharray="2 4"
            />
            <circle
              cx={hover.x}
              cy={geom.y(hover.cum)}
              r="4.5"
              fill={hover.side === "bid" ? "var(--up)" : "var(--down)"}
              stroke="var(--bg-surface)"
              strokeWidth="1.5"
            />
          </g>
        )}
      </svg>

      {hover && (
        <div
          className="chart-tip"
          style={{
            left: Math.min(Math.max(10, hover.x + 12), Math.max(10, width - 210)),
            top: 16,
          }}
        >
          <div className={hover.side === "bid" ? "up" : "down"} style={{ fontWeight: 700 }}>
            {hover.side === "bid" ? "▲ BID DEPTH" : "▼ ASK DEPTH"} @ {fmtNum(hover.price)}
          </div>
          <div className="muted">
            Distance: {hover.distPct >= 0 ? "+" : ""}
            {hover.distPct.toFixed(2)}% from mid
          </div>
          <div className="muted">Cum Qty: {fmtNum(hover.cum, 4)}</div>
          <div className="muted">Cum Notional: ≈ {formatCompactQuoteNotional(hover.cum * hover.price, quoteAsset)}</div>
        </div>
      )}
    </div>
  );
}
