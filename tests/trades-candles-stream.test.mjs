/**
 * Trades and candles streaming: publication parsing, the merges that make a
 * tape and a chart correct, the exact channel names, and the page wiring.
 *
 * The channel strings are pinned literally because they are a contract with the
 * exchange: a typo does not fail loudly, it silently subscribes to nothing and
 * looks like "no trades right now".
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, it } from "node:test";

let core;
let vite;
let tradesLib;
let candlesLib;

const ROOT = path.resolve(import.meta.dirname, "..");

before(async () => {
  const { createServer } = await import("vite");
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "error",
  });
  core = await vite.ssrLoadModule("/packages/core/src/index.ts");
  tradesLib = await vite.ssrLoadModule("/apps/web/src/lib/tradesStream.ts");
  candlesLib = await vite.ssrLoadModule("/apps/web/src/lib/candlesStream.ts");
});

after(async () => {
  await vite?.close();
});

const trade = (over = {}) => ({
  executedAt: "2026-01-01T00:00:00.123456789Z",
  matchId: "41821",
  price: "101.25",
  qty: "0.25",
  side: "BUY",
  symbol: "BTC-USDT",
  ...over,
});

const candle = (over = {}) => ({
  close: "101.7",
  high: "101.9",
  isClosed: false,
  low: "101.1",
  open: "101.25",
  tsSec: "1767225600",
  volume: "1.5",
  ...over,
});

describe("trade publications", () => {
  it("accepts the published JSON shape", () => {
    const parsed = core.parseMarketTrade(trade());
    assert.equal(parsed.matchId, "41821");
    assert.equal(parsed.side, "buy");
    assert.equal(parsed.price, "101.25");
    assert.equal(parsed.qty, "0.25");
    assert.equal(parsed.tsMs, Date.UTC(2026, 0, 1, 0, 0, 0, 123));
  });

  it("keeps prices and quantities as strings so nothing is rounded", () => {
    const parsed = core.parseMarketTrade(trade({ price: "0.123456789012345678" }));
    assert.equal(parsed.price, "0.123456789012345678");
  });

  it("normalises either side casing and rejects anything else", () => {
    assert.equal(core.parseMarketTrade(trade({ side: "sell" })).side, "sell");
    assert.throws(
      () => core.parseMarketTrade(trade({ side: "SELF_TRADE" })),
      /invalid_field \(side\)/,
    );
  });

  it("rejects a payload that is not an object", () => {
    for (const bad of [null, "trade", 42, ["a"]]) {
      assert.throws(() => core.parseMarketTrade(bad), /not_an_object/);
    }
  });

  it("rejects a malformed match id, price, quantity or timestamp", () => {
    assert.throws(() => core.parseMarketTrade(trade({ matchId: "abc" })), /matchId/);
    assert.throws(() => core.parseMarketTrade(trade({ price: "-1" })), /price/);
    assert.throws(() => core.parseMarketTrade(trade({ qty: "1e5" })), /qty/);
    assert.throws(() => core.parseMarketTrade(trade({ executedAt: "yesterday" })), /executedAt/);
  });

  it("handles nanosecond timestamps that Date.parse is not defined for", () => {
    // Nine fractional digits: truncated to milliseconds, not rejected.
    assert.equal(
      core.parseMarketTrade(trade({ executedAt: "2026-01-01T00:00:00.987654321Z" })).tsMs,
      Date.UTC(2026, 0, 1, 0, 0, 0, 987),
    );
    // No fraction at all is equally valid RFC3339.
    assert.equal(
      core.parseMarketTrade(trade({ executedAt: "2026-01-01T00:00:00Z" })).tsMs,
      Date.UTC(2026, 0, 1),
    );
    assert.equal(core.parseExecutedAt("nope"), null);
  });
});

describe("trade merge", () => {
  const t = (matchId, tsMs) => ({ matchId, tsMs });

  it("puts the newest trade first", () => {
    const list = core.mergeTrade([t("1", 1)], t("2", 2), 10);
    assert.deepEqual(list.map((x) => x.matchId), ["2", "1"]);
  });

  it("deduplicates a replayed matchId instead of double-counting volume", () => {
    // At-least-once delivery plus reconnects mean the same fill can arrive twice.
    const list = core.mergeTrades([t("2", 2), t("1", 1)], [t("1", 1), t("2", 2)], 10);
    assert.deepEqual(list.map((x) => x.matchId), ["2", "1"]);
  });

  it("keeps a bounded tape", () => {
    let list = [];
    for (let i = 0; i < 10; i++) list = core.mergeTrade(list, t(String(i), i), 3);
    assert.deepEqual(list.map((x) => x.matchId), ["9", "8", "7"]);
  });
});

describe("candle publications", () => {
  it("accepts the published JSON shape", () => {
    const parsed = core.parseCandlePoint(candle());
    assert.deepEqual(parsed, {
      tsSec: "1767225600",
      open: "101.25",
      high: "101.9",
      low: "101.1",
      close: "101.7",
      volume: "1.5",
      isClosed: false,
    });
  });

  it("tolerates a numeric tsSec without losing the timestamp", () => {
    assert.equal(core.parseCandlePoint(candle({ tsSec: 1767225600 })).tsSec, "1767225600");
  });

  it("treats a missing isClosed as an open bar, never as closed", () => {
    assert.equal(core.parseCandlePoint(candle({ isClosed: undefined })).isClosed, false);
  });

  it("rejects a non-decimal body or a malformed timestamp", () => {
    assert.throws(() => core.parseCandlePoint(candle({ open: 101.25 })), /open/);
    assert.throws(() => core.parseCandlePoint(candle({ low: "NaN" })), /low/);
    assert.throws(() => core.parseCandlePoint(candle({ tsSec: "12.5" })), /tsSec/);
    assert.throws(() => core.parseCandlePoint(candle({ tsSec: true })), /tsSec/);
    assert.throws(() => core.parseCandlePoint(null), /not_an_object/);
  });

  it("converts to the chart shape in seconds, not milliseconds", () => {
    const chart = core.toChartCandle(core.parseCandlePoint(candle()));
    assert.equal(chart.time, 1767225600);
    assert.equal(chart.close, "101.7");
  });
});

describe("candle merge", () => {
  const bar = (time, close, isClosed = false) => ({
    time,
    open: "1",
    high: "2",
    low: "1",
    close,
    volume: "1",
    isClosed,
  });

  it("replaces the running bar instead of appending a new candle per tick", () => {
    // This is the defect the merge exists to prevent: a republished open bar
    // must move, not multiply.
    let series = core.mergeCandle([], bar(100, "1.0"), 100);
    series = core.mergeCandle(series, bar(100, "1.5"), 100);
    series = core.mergeCandle(series, bar(100, "1.7", true), 100);
    assert.equal(series.length, 1);
    assert.equal(series[0].close, "1.7");
    assert.equal(series[0].isClosed, true);
  });

  it("keeps the series ascending when an older bar arrives late", () => {
    const series = core.mergeCandle([bar(200, "2"), bar(300, "3")], bar(100, "1"), 100);
    assert.deepEqual(series.map((c) => c.time), [100, 200, 300]);
  });

  it("keeps a bounded series, dropping the oldest", () => {
    const series = core.mergeCandle([bar(1, "1"), bar(2, "2")], bar(3, "3"), 2);
    assert.deepEqual(series.map((c) => c.time), [2, 3]);
  });

  it("recognises a bar that advances or refines the newest one", () => {
    const series = [bar(100, "1")];
    assert.equal(core.advancesOpenBar(series, bar(100, "1.1")), true);
    assert.equal(core.advancesOpenBar(series, bar(200, "2")), true);
    assert.equal(core.advancesOpenBar(series, bar(50, "0.5")), false);
  });
});

describe("channel names are a contract", () => {
  it("builds the published trade and candle channels", () => {
    assert.equal(tradesLib.tradesChannel(7), "public:spot:market:trades:7");
    assert.equal(candlesLib.candlesChannel("1m", 7), "public:spot:market:candles:1m:7");
  });
});

describe("the live stream itself", () => {
  /** A socket that records what the client asked for and lets us deliver. */
  function makeSocketClass() {
    const sockets = [];
    class FakeSocket {
      constructor(url, protocols) {
        this.url = url;
        this.protocols = protocols;
        this.protocol = "centrifuge-json";
        this.sent = [];
        this.closed = false;
        this.readyState = 0;
        sockets.push(this);
      }
      send(data) {
        this.sent.push(JSON.parse(data));
      }
      close() {
        this.closed = true;
        this.readyState = 3;
      }
      addEventListener(type, fn) {
        this["on" + type] = fn;
      }
      removeEventListener() {}
      emit(type, event) {
        this["on" + type]?.(event);
      }
      deliver(payload) {
        this.emit("message", { data: JSON.stringify(payload) });
      }
    }
    return { FakeSocket, sockets };
  }

  function open(socket) {
    socket.readyState = 1;
    socket.emit("open", {});
    socket.deliver({ id: 1, connect: { client: "x", version: "6.6.0", ping: 25 } });
  }

  it("subscribes to the trade channel and delivers parsed trades", () => {
    const { FakeSocket, sockets } = makeSocketClass();
    const trades = [];
    tradesLib.streamTrades({
      symbolId: 3,
      WebSocketImpl: FakeSocket,
      visibilityTarget: null,
      onTrade: (t) => trades.push(t),
      onStatus: () => {},
    });
    const socket = sockets[0];
    open(socket);
    const sub = socket.sent.find((m) => m.subscribe);
    assert.equal(sub.subscribe.channel, "public:spot:market:trades:3");

    socket.deliver({ push: { channel: sub.subscribe.channel, pub: { data: trade() } } });
    assert.equal(trades.length, 1);
    assert.equal(trades[0].matchId, "41821");
  });

  it("survives a malformed trade without tearing down the stream", () => {
    const { FakeSocket, sockets } = makeSocketClass();
    const trades = [];
    const stop = tradesLib.streamTrades({
      symbolId: 3,
      WebSocketImpl: FakeSocket,
      visibilityTarget: null,
      onTrade: (t) => trades.push(t),
      onStatus: () => {},
    });
    const socket = sockets[0];
    open(socket);
    const channel = `public:spot:market:trades:3`;
    socket.deliver({ push: { channel, pub: { data: { matchId: "x" } } } });
    socket.deliver({ push: { channel, pub: { data: trade({ matchId: "9" }) } } });
    assert.deepEqual(trades.map((t) => t.matchId), ["9"]);
    assert.equal(socket.closed, false);
    stop();
  });

  it("subscribes to the candle channel and delivers chart-ready bars", () => {
    const { FakeSocket, sockets } = makeSocketClass();
    const bars = [];
    const stop = candlesLib.streamCandles({
      symbolId: 3,
      timeframe: "5m",
      WebSocketImpl: FakeSocket,
      visibilityTarget: null,
      onCandle: (c) => bars.push(c),
      onStatus: () => {},
    });
    const socket = sockets[0];
    open(socket);
    const sub = socket.sent.find((m) => m.subscribe);
    assert.equal(sub.subscribe.channel, "public:spot:market:candles:5m:3");

    socket.deliver({ push: { channel: sub.subscribe.channel, pub: { data: candle() } } });
    assert.equal(bars.length, 1);
    assert.equal(bars[0].time, 1767225600);
    stop();
  });
});

describe("page wiring", () => {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

  it("Tape streams the public tape and renders the stream status", () => {
    const src = read("apps/web/src/pages/Tape.tsx");
    assert.match(src, /streamTrades\(/);
    assert.match(src, /data-stream-status=/);
    // One ingestion path: a second copy of whale detection would drift.
    assert.equal((src.match(/const ingest = useCallback/g) ?? []).length, 1);
    assert.match(src, /ingest\(data\.trades\)/);
  });

  it("Charts overlays live bars and falls back to polling when the stream dies", () => {
    const src = read("apps/web/src/pages/Charts.tsx");
    assert.match(src, /streamCandles\(/);
    assert.match(src, /upsertCandle\(/);
    assert.match(src, /seriesForDisplay\(streamStatus, liveCandles\)/);
    assert.match(src, /data-stream-status=/);
  });
});
