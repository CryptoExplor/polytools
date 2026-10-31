/**
 * TOOL 2 — Public Order Book & Cumulative Depth (/#/book)
 * L2 bid/ask ladders with selectable depth (10/20/50/100), cumulative depth chart,
 * liquidity imbalance gauge, spread telemetry, and automatic wall detection.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  type StreamBook,
} from "@poly/core";
import { api } from "../lib/api";
import { streamOrderbook, type StreamStatus } from "../lib/orderbookStream";
import { formatCompactQuoteNotional } from "../lib/format";
import { marketForSymbol, orderbookForRequest } from "../lib/marketIdentity";
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
import { DepthChart } from "../components/DepthChart";

/**
 * Says how the book is being kept current.
 *
 * This exists because "live" and "polled" are different claims. A pill that
 * says Live while the socket is actually dead would be the exact kind of quiet
 * inaccuracy this app is not allowed to ship.
 */
function StreamPill({ status, detail }: { status: StreamStatus; detail: string | null }) {
  if (status === "live") {
    return (
      <Pill kind="up" liveDot title={detail ?? "Streaming updates from the public delta channel"}>
        Live
      </Pill>
    );
  }
  if (status === "connecting") {
    return <Pill kind="info" title="Opening the public stream; polled data below">Connecting</Pill>;
  }
  if (status === "reconnecting") {
    return (
      <Pill kind="warn" title={detail ?? "Reconnecting; showing the last known book"}>
        Polling
      </Pill>
    );
  }
  return (
    <Pill kind="info" title={detail ?? "Stream unavailable; polling every 2s"}>
      Polling
    </Pill>
  );
}

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

  // ---- public realtime refinement -------------------------------------------
  // Polling stays the source of truth; the socket only refines it. `liveBook`
  // is kept separate from polled data so a dropped socket degrades to the last
  // polled book instead of freezing a stale stream on screen.
  const [liveBook, setLiveBook] = useState<StreamBook | null>(null);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("connecting");
  const [streamDetail, setStreamDetail] = useState<string | null>(null);
  const liveIdentity = useRef<string>("");
  // The channel is keyed by the exchange's numeric symbol id, which only
  // arrives with the first polled response. Pulling it out as a primitive lets
  // the effect depend on the *value* — so it re-runs once when the id appears,
  // and not once per poll (which would tear the socket down every 2s). Keying
  // the dependency on `data` itself, or omitting it entirely, silently leaves
  // the stream unstarted on first mount.
  const symbolId: number | null =
    typeof data?.symbolId === "number" && data.symbolId > 0 ? data.symbolId : null;

  const fetchSnapshot = useCallback(async () => {
    const fresh = await api.orderbook(symbol, depth);
    return { bookSeq: fresh.bookSeq, bids: fresh.bids, asks: fresh.asks };
  }, [symbol, depth]);

  useEffect(() => {
    // Any change of market or depth invalidates the local book outright: deltas
    // for one symbol must never be merged into another symbol's book.
    const identity = `${symbol}:${depth}`;
    liveIdentity.current = identity;
    setLiveBook(null);
    setStreamStatus("connecting");
    setStreamDetail(null);

    if (symbolId === null) return;

    const stop = streamOrderbook({
      symbolId,
      depth,
      snapshot: fetchSnapshot,
      onBook: (book) => {
        if (liveIdentity.current !== identity) return;
        setLiveBook(book);
      },
      onStatus: (status, detail) => {
        if (liveIdentity.current !== identity) return;
        setStreamStatus(status);
        setStreamDetail(detail ?? null);
      },
    });
    return stop;
  }, [symbol, depth, symbolId, fetchSnapshot]);

  // A stale streamed book must not outlive the polled book it was built from.
  useEffect(() => {
    if (!data) setLiveBook(null);
  }, [data]);

  const currentData = orderbookForRequest(data, symbol, depth);
  const requestIdentityError = data && !currentData
    ? "Order-book response did not match the selected symbol or depth; it was not displayed."
    : null;
  const displayError = requestIdentityError ?? error;
  const { data: ov } = usePollData(() => api.overview([symbol]), 4000, [symbol]);
  const stats = marketForSymbol(ov?.markets, symbol);

  const [base, quote] = splitSymbol(symbol);
  const baseAsset = assetByCode.get(base);
  const pair = pairBySymbol.get(symbol);
  const qtyDecimals = baseAsset?.quantityDisplayDecimals ?? 5;

  const book = useMemo(() => {
    if (!currentData) return null;
    const levels = liveBook ?? { bids: currentData.bids ?? [], asks: currentData.asks ?? [] };
    const bids = (levels.bids ?? [])
      .map((l) => ({
        rawPrice: l.price,
        price: price(l.price),
        qty: dec(l.qty),
      }))
      .sort((a, b) => b.price - a.price);
    const asks = (levels.asks ?? [])
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
  }, [currentData, wallMult]);

  const bid = currentData?.bestBid ? price(currentData.bestBid.price) : NaN;
  const ask = currentData?.bestAsk ? price(currentData.bestAsk.price) : NaN;
  const mid = isFinite(bid) && isFinite(ask) ? (bid + ask) / 2 : NaN;
  const spBps = spreadBps(bid, ask);

  return (
    <div className="page-stack">
      <PageHeader
        title={`Order book · ${symbol}`}
        badge={
          stats ? (
            <Pill kind={stats.change24hBps >= 0 ? "up" : "down"}>
              {stats.change24hBps >= 0 ? "▲ " : "▼ "}
              {fmtPctFromBps(stats.change24hBps)}
            </Pill>
          ) : null
        }
        subtitle="Resting bids and asks waiting to match. Public data — not your orders."
        actions={
          <div className="row-flex">
            <StreamPill status={streamStatus} detail={streamDetail} />
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
              updatedAt={currentData ? updatedAt : null}
              refreshing={refreshing}
              error={displayError}
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
            currentData?.bestBid
              ? `Qty: ${fmtNum(dec(currentData.bestBid.qty), qtyDecimals)} ${base}`
              : "Top buying level"
          }
        />
        <MetricCell
          label="Best Ask"
          trend="down"
          value={isFinite(ask) ? fmtNum(ask) : "—"}
          sub={
            currentData?.bestAsk
              ? `Qty: ${fmtNum(dec(currentData.bestAsk.qty), qtyDecimals)} ${base}`
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
            currentData?.bookSeq ? (
              <span className="mono">
                <TermTip
                  label={`bookSeq #${currentData.bookSeq}`}
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

      <ErrorBox error={displayError} onRetry={refresh} hasStaleData={Boolean(book)} />

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
            title="No order book data"
            description="This market may have no resting orders, or the data did not load."
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
          title={`Bids (Buy Orders) · ${currentData?.bidCount ?? book?.bids.length ?? 0} levels`}
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
              <span className="right">Notional</span>
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
                  <span className="right muted">
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
          title={`Asks (Sell Orders) · ${currentData?.askCount ?? book?.asks.length ?? 0} levels`}
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
              <span className="right">Notional</span>
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
                  <span className="right muted">
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
