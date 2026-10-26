/**
 * TOOL 2 — Public Order Book & Cumulative Depth (/#/book)
 * L2 bid/ask ladders with selectable depth (10/20/50/100), cumulative depth chart,
 * liquidity imbalance gauge, spread telemetry, and automatic wall detection.
 */

import { useMemo, useState } from "react";
import {
  BOOK_DEPTHS,
  dec,
  fmtNum,
  fmtPctFromBps,
  price,
  splitSymbol,
  spreadBps,
  wallIndexes,
  type BookDepth,
} from "@poly/core";
import { api } from "../lib/api";
import { formatCompactQuoteNotional } from "../lib/format";
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
import { DepthChart } from "../components/DepthChart";

export default function Book() {
  const { symbol, setSymbol, assetByCode, pairBySymbol } = useApp();
  const [depth, setDepth] = useState<BookDepth>(50);
  const [wallMult, setWallMult] = useState<number>(3);

  const {
    data,
    error,
    loading,
    refreshing,
    updatedAt,
    paused,
    setPaused,
    refresh,
  } = usePollData(() => api.orderbook(symbol, depth), 2000, [symbol, depth]);

  const { data: ov } = usePollData(() => api.overview([symbol]), 4000, [symbol]);
  const stats = ov?.markets?.[0];

  const [base, quote] = splitSymbol(symbol);
  const baseAsset = assetByCode.get(base);
  const pair = pairBySymbol.get(symbol);
  const qtyDecimals = baseAsset?.quantityDisplayDecimals ?? 5;

  const book = useMemo(() => {
    if (!data) return null;
    const bids = (data.bids ?? [])
      .map((l) => ({
        rawPrice: l.price,
        price: price(l.price),
        qty: dec(l.qty),
      }))
      .sort((a, b) => b.price - a.price);
    const asks = (data.asks ?? [])
      .map((l) => ({
        rawPrice: l.price,
        price: price(l.price),
        qty: dec(l.qty),
      }))
      .sort((a, b) => a.price - b.price);

    const bidWalls = wallIndexes(
      bids.map((b) => b.qty),
      wallMult,
    );
    const askWalls = wallIndexes(
      asks.map((a) => a.qty),
      wallMult,
    );

    let bc = 0;
    const bidsCum = bids.map((b) => (bc += isFinite(b.qty) ? b.qty : 0));
    let ac = 0;
    const asksCum = asks.map((a) => (ac += isFinite(a.qty) ? a.qty : 0));

    const totalBidQty = bidsCum[bidsCum.length - 1] ?? 0;
    const totalAskQty = asksCum[asksCum.length - 1] ?? 0;
    const maxCum = Math.max(totalBidQty, totalAskQty, 1e-9);

    const totalBidNotional = bids.reduce(
      (s, b) => s + (isFinite(b.price * b.qty) ? b.price * b.qty : 0),
      0,
    );
    const totalAskNotional = asks.reduce(
      (s, a) => s + (isFinite(a.price * a.qty) ? a.price * a.qty : 0),
      0,
    );
    const bidSharePct =
      totalBidQty + totalAskQty > 0
        ? (totalBidQty / (totalBidQty + totalAskQty)) * 100
        : 50;

    return {
      bids,
      asks,
      bidWalls,
      askWalls,
      bidsCum,
      asksCum,
      maxCum,
      totalBidQty,
      totalAskQty,
      totalBidNotional,
      totalAskNotional,
      bidSharePct,
    };
  }, [data, wallMult]);

  const bid = data?.bestBid ? price(data.bestBid.price) : NaN;
  const ask = data?.bestAsk ? price(data.bestAsk.price) : NaN;
  const mid = isFinite(bid) && isFinite(ask) ? (bid + ask) / 2 : NaN;
  const spBps = spreadBps(bid, ask);

  return (
    <div className="page-stack">
      <PageHeader
        title={`Public Order Book · ${symbol}`}
        badge={
          stats ? (
            <Pill kind={stats.change24hBps >= 0 ? "up" : "down"}>
              {stats.change24hBps >= 0 ? "▲ " : "▼ "}
              {fmtPctFromBps(stats.change24hBps)}
            </Pill>
          ) : null
        }
        subtitle="Public buy orders (bids) and sell orders (asks) waiting to be matched. No account key is used. These orders are not necessarily yours."
        actions={
          <div className="row-flex">
            <SymbolSelect value={symbol} onChange={setSymbol} />
            <div className="seg-group" role="group" aria-label="Order book depth levels">
              {([10, 20, 50, 100] as BookDepth[]).map((d) =>
                BOOK_DEPTHS.includes(d) ? (
                  <button
                    key={d}
                    type="button"
                    className={`seg-btn ${depth === d ? "active" : ""}`}
                    onClick={() => setDepth(d)}
                  >
                    Depth {d}
                  </button>
                ) : null,
              )}
            </div>
            <DataFreshness
              updatedAt={updatedAt}
              refreshing={refreshing}
              error={error}
              intervalSec={2}
              paused={paused}
              onTogglePause={() => setPaused(!paused)}
              onRefresh={refresh}
            />
          </div>
        }
      />

      <MetricStrip>
        <MetricCell
          label="Best Bid"
          trend="up"
          value={isFinite(bid) ? fmtNum(bid) : "—"}
          sub={
            data?.bestBid
              ? `Qty: ${fmtNum(dec(data.bestBid.qty), qtyDecimals)} ${base}`
              : "Top buying level"
          }
        />
        <MetricCell
          label="Best Ask"
          trend="down"
          value={isFinite(ask) ? fmtNum(ask) : "—"}
          sub={
            data?.bestAsk
              ? `Qty: ${fmtNum(dec(data.bestAsk.qty), qtyDecimals)} ${base}`
              : "Top selling level"
          }
        />
        <MetricCell
          label={
            <TermTip
              label="Top Spread"
              tip="(Best Ask − Best Bid) ÷ Mid Price expressed in basis points (1 bps = 0.01%)"
            />
          }
          value={isFinite(spBps) ? `${spBps.toFixed(2)} bps` : "—"}
          sub={
            isFinite(bid) && isFinite(ask)
              ? `Abs: ${fmtNum(ask - bid)} ${quote} · Mid: ${fmtNum(mid)}`
              : "Awaiting both sides"
          }
        />
        <MetricCell
          label="Index Reference"
          value={stats ? fmtNum(price(stats.indexPrice)) : "—"}
          sub={
            data?.bookSeq ? (
              <span className="mono">
                <TermTip
                  label={`bookSeq #${data.bookSeq}`}
                  tip="Exchange monotonic order book sequence identifier"
                />
              </span>
            ) : (
              "Exchange index price"
            )
          }
        />
        <MetricCell
          label={
            <TermTip
              label={`Book Imbalance (${depth} lvls)`}
              tip="Share of displayed bid qty vs ask qty. Not a prediction."
            />
          }
          value={
            book ? (
              <span>
                <span className="up">{book.bidSharePct.toFixed(0)}% B</span>
                <span className="faint"> / </span>
                <span className="down">{(100 - book.bidSharePct).toFixed(0)}% A</span>
              </span>
            ) : (
              "—"
            )
          }
          sub={
            book ? (
              <div className="imbalance-bar mt-1">
                <div
                  className="imbalance-bid"
                  style={{ width: `${book.bidSharePct.toFixed(1)}%` }}
                />
                <div
                  className="imbalance-ask"
                  style={{ width: `${(100 - book.bidSharePct).toFixed(1)}%` }}
                />
              </div>
            ) : (
              "Visible depth ratio"
            )
          }
        />
      </MetricStrip>

      <ErrorBox error={error} onRetry={refresh} hasStaleData={Boolean(book)} />

      {/* Cumulative Depth Visualization */}
      <Card
        title="Cumulative Liquidity Depth"
        subtitle={`Outward cumulative volume from mid price (${isFinite(mid) ? fmtNum(mid) : "—"} ${quote})`}
        actions={
          book && (
            <div className="row-flex faint mono">
              <span className="up">
                Bids: {fmtNum(book.totalBidQty, 3)} {base} ({formatCompactQuoteNotional(book.totalBidNotional, quote)})
              </span>
              <span>·</span>
              <span className="down">
                Asks: {fmtNum(book.totalAskQty, 3)} {base} ({formatCompactQuoteNotional(book.totalAskNotional, quote)})
              </span>
            </div>
          )
        }
      >
        {loading && !book ? (
          <Loading lines={5} />
        ) : book ? (
          <DepthChart bids={book.bids} asks={book.asks} height={275} quoteAsset={quote} />
        ) : (
          <EmptyState
            title="No order book snapshot loaded"
            description="Could not retrieve order book levels for this market."
          />
        )}
      </Card>

      {/* Detected Walls Panel */}
      {book && (
        <Card
          title="Detected Liquidity Walls"
          subtitle={`WALL is a size outlier (≥ ${wallMult}× median side size), not a detected trader.`}
          actions={
            <div className="seg-group" role="group" aria-label="Wall sensitivity multiplier">
              {[2, 3, 5].map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`seg-btn ${wallMult === m ? "active" : ""}`}
                  onClick={() => setWallMult(m)}
                >
                  ≥ {m}× median
                </button>
              ))}
            </div>
          }
        >
          <div className="row-flex">
            {[...book.bidWalls].map((i) => {
              const lvl = book.bids[i];
              if (!lvl) return null;
              return (
                <Pill key={`bw-${lvl.rawPrice}`} kind="up">
                  ▲ BID WALL @ {fmtNum(lvl.price)} · {fmtNum(lvl.qty, qtyDecimals)} {base} (
                  {formatCompactQuoteNotional(lvl.qty * lvl.price, quote)})
                </Pill>
              );
            })}
            {[...book.askWalls].map((i) => {
              const lvl = book.asks[i];
              if (!lvl) return null;
              return (
                <Pill key={`aw-${lvl.rawPrice}`} kind="down">
                  ▼ ASK WALL @ {fmtNum(lvl.price)} · {fmtNum(lvl.qty, qtyDecimals)} {base} (
                  {formatCompactQuoteNotional(lvl.qty * lvl.price, quote)})
                </Pill>
              );
            })}
            {!book.bidWalls.size && !book.askWalls.size && (
              <span className="faint">
                No standout walls (≥ {wallMult}× median side quantity) detected in the current{" "}
                {depth}-level snapshot.
              </span>
            )}
          </div>
        </Card>
      )}

      {/* Synchronized Bid & Ask Ladders */}
      <div className="grid cols-2">
        <Card
          flush
          title={`Bids (Buy Orders) · ${data?.bidCount ?? book?.bids.length ?? 0} levels`}
          actions={
            pair && (
              <span className="faint mono">
                step {pair.stepSize} {base}
              </span>
            )
          }
        >
          <div className="ladder">
            <div className="ladder-head">
              <span>Bid Price ({quote})</span>
              <span className="right">Size ({base})</span>
              <span className="right hide-xs">Notional</span>
              <span className="right">Cumulative ({base})</span>
            </div>
            {loading && !book && (
              <div style={{ padding: 14 }}>
                <Loading lines={8} />
              </div>
            )}
            {book && book.bids.length === 0 && (
              <EmptyState
                title="No bid levels"
                description="The order book currently has no active bids."
              />
            )}
            {book?.bids.map((l, i) => {
              const widthPct = Math.min(100, (book.bidsCum[i] / book.maxCum) * 100);
              const isWall = book.bidWalls.has(i);
              return (
                <div className="row bids" key={`b-${l.rawPrice}-${i}`}>
                  <div className="bar" style={{ width: `${widthPct.toFixed(1)}%` }} />
                  <span className="price bid">
                    {fmtNum(l.price)}
                    {isWall && <span className="wall-tag">WALL</span>}
                  </span>
                  <span className="right">{fmtNum(l.qty, qtyDecimals)}</span>
                  <span className="right muted hide-xs">
                    {formatCompactQuoteNotional(l.price * l.qty, quote)}
                  </span>
                  <span className="right muted">{fmtNum(book.bidsCum[i], qtyDecimals)}</span>
                </div>
              );
            })}
          </div>
        </Card>

        <Card
          flush
          title={`Asks (Sell Orders) · ${data?.askCount ?? book?.asks.length ?? 0} levels`}
          actions={
            pair && (
              <span className="faint mono">
                tick {pair.tickSize} {quote}
              </span>
            )
          }
        >
          <div className="ladder">
            <div className="ladder-head">
              <span>Ask Price ({quote})</span>
              <span className="right">Size ({base})</span>
              <span className="right hide-xs">Notional</span>
              <span className="right">Cumulative ({base})</span>
            </div>
            {loading && !book && (
              <div style={{ padding: 14 }}>
                <Loading lines={8} />
              </div>
            )}
            {book && book.asks.length === 0 && (
              <EmptyState
                title="No ask levels"
                description="The order book currently has no active asks."
              />
            )}
            {book?.asks.map((l, i) => {
              const widthPct = Math.min(100, (book.asksCum[i] / book.maxCum) * 100);
              const isWall = book.askWalls.has(i);
              return (
                <div className="row asks" key={`a-${l.rawPrice}-${i}`}>
                  <div className="bar" style={{ width: `${widthPct.toFixed(1)}%` }} />
                  <span className="price ask">
                    {fmtNum(l.price)}
                    {isWall && <span className="wall-tag">WALL</span>}
                  </span>
                  <span className="right">{fmtNum(l.qty, qtyDecimals)}</span>
                  <span className="right muted hide-xs">
                    {formatCompactQuoteNotional(l.price * l.qty, quote)}
                  </span>
                  <span className="right muted">{fmtNum(book.asksCum[i], qtyDecimals)}</span>
                </div>
              );
            })}
          </div>
        </Card>
      </div>
    </div>
  );
}
