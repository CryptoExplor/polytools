/**
 * TOOL 2 — Live order book: L2 ladder (depth 50) + cumulative depth chart,
 * spread stats and automatic "wall" detection (levels ≥ 3× median size).
 */

import { useMemo } from "react";
import { api } from "../lib/api";
import { usePollData } from "../lib/hooks";
import { useApp } from "../lib/store";
import { Card, ErrorBox, Loading, Pill, Stat, SymbolSelect } from "../components/ui";
import { DepthChart } from "../components/DepthChart";
import { price, dec, spreadBps, wallIndexes, fmtNum, fmtCompact, fmtPctFromBps } from "@poly/core";

export default function Book() {
  const { symbol, setSymbol } = useApp();
  const { data, error, loading } = usePollData(() => api.orderbook(symbol, 50), 2000, [symbol]);
  const { data: ov } = usePollData(() => api.overview([symbol]), 4000, [symbol]);
  const stats = ov?.markets?.[0];

  const book = useMemo(() => {
    if (!data) return null;
    const bids = data.bids.map((l) => ({ price: price(l.price), qty: dec(l.qty) }));
    const asks = data.asks.map((l) => ({ price: price(l.price), qty: dec(l.qty) }));
    const bidWalls = wallIndexes(bids.map((b) => b.qty));
    const askWalls = wallIndexes(asks.map((a) => a.qty));
    let bc = 0;
    const bidsCum = bids.map((b) => (bc += b.qty));
    let ac = 0;
    const asksCum = asks.map((a) => (ac += a.qty));
    const maxCum = Math.max(bidsCum[bidsCum.length - 1] ?? 0, asksCum[asksCum.length - 1] ?? 0, 1e-9);
    return { bids, asks, bidWalls, askWalls, bidsCum, asksCum, maxCum };
  }, [data]);

  const bid = data ? price(data.bestBid.price) : NaN;
  const ask = data ? price(data.bestAsk.price) : NaN;

  return (
    <div className="grid">
      <div className="row-flex">
        <SymbolSelect value={symbol} onChange={setSymbol} />
        {stats && <Pill kind={stats.change24hBps >= 0 ? "up" : "down"}>24h {fmtPctFromBps(stats.change24hBps)}</Pill>}
        {data && <span className="faint mono">seq {data.bookSeq}</span>}
      </div>

      <ErrorBox error={error} />

      <div className="grid cols-4">
        <Stat label="Best bid" value={<span className="up">{fmtNum(bid)}</span>} sub={data ? `qty ${fmtNum(dec(data.bestBid.qty))}` : ""} />
        <Stat label="Best ask" value={<span className="down">{fmtNum(ask)}</span>} sub={data ? `qty ${fmtNum(dec(data.bestAsk.qty))}` : ""} />
        <Stat label="Spread" value={isFinite(spreadBps(bid, ask)) ? `${spreadBps(bid, ask).toFixed(1)} bps` : "—"} sub={isFinite(bid) && isFinite(ask) ? `${fmtNum(ask - bid)} abs` : ""} />
        <Stat label="Index price" value={stats ? fmtNum(price(stats.indexPrice)) : "—"} sub="reference price" />
      </div>

      <Card title="Depth (cumulative)">
        {loading && !book ? <Loading lines={4} /> : book ? (
          <DepthChart bids={book.bids} asks={book.asks} />
        ) : null}
      </Card>

      <div className="grid cols-2">
        <Card title={`Bids · ${data?.bidCount ?? 0} levels`}>
          <div className="ladder">
            {!book && <Loading lines={8} />}
            {book?.bids.map((l, i) => (
              <div className="row bids" key={i}>
                <div className="bar" style={{ width: `${((book.bidsCum[i] / book.maxCum) * 100).toFixed(1)}%` }} />
                <span className="price bid">{fmtNum(l.price)}</span>
                <span className="right">{fmtNum(l.qty, 5)}</span>
                <span className="right muted">
                  {fmtNum(book.bidsCum[i], 5)}
                  {book.bidWalls.has(i) && <span className="wall-tag">WALL</span>}
                </span>
              </div>
            ))}
          </div>
        </Card>
        <Card title={`Asks · ${data?.askCount ?? 0} levels`}>
          <div className="ladder">
            {!book && <Loading lines={8} />}
            {book?.asks.map((l, i) => (
              <div className="row asks" key={i}>
                <div className="bar" style={{ width: `${((book.asksCum[i] / book.maxCum) * 100).toFixed(1)}%` }} />
                <span className="price ask">{fmtNum(l.price)}</span>
                <span className="right">{fmtNum(l.qty, 5)}</span>
                <span className="right muted">
                  {fmtNum(book.asksCum[i], 5)}
                  {book.askWalls.has(i) && <span className="wall-tag">WALL</span>}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {book && (
        <Card title="Detected walls (≥ 3× median level size)">
          <div className="row-flex">
            {[...book.bidWalls].map((i) => (
              <Pill key={`b${i}`} kind="up">bid {fmtNum(book.bids[i].price)} · {fmtCompact(book.bids[i].qty * book.bids[i].price, "$")}</Pill>
            ))}
            {[...book.askWalls].map((i) => (
              <Pill key={`a${i}`} kind="down">ask {fmtNum(book.asks[i].price)} · {fmtCompact(book.asks[i].qty * book.asks[i].price, "$")}</Pill>
            ))}
            {!book.bidWalls.size && !book.askWalls.size && <span className="faint">No standout levels right now.</span>}
          </div>
        </Card>
      )}
    </div>
  );
}
