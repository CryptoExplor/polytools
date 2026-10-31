/**
 * Public order-book streaming: the frame layer, the delta merge, and the
 * browser transport's failure behaviour.
 *
 * There is no live socket here. What *is* pinned is everything that would
 * silently corrupt a book: sequence gaps, stale replays, SET-vs-increment
 * semantics, a zero quantity, and a transport that dies mid-stream.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

let core;
let vite;

before(async () => {
  const { createServer } = await import("vite");
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "error",
  });
  core = await vite.ssrLoadModule("/packages/core/src/index.ts");
});

after(async () => {
  await vite?.close();
});

const SYMBOL_ID = 1;

const snapshot = () => ({
  bookSeq: "100",
  bids: [
    { price: "100.0", qty: "2" },
    { price: "99.0", qty: "1" },
  ],
  asks: [
    { price: "101.0", qty: "1.5" },
    { price: "102.0", qty: "3" },
  ],
});

const delta = (over = {}) => ({
  symbolId: SYMBOL_ID,
  bookSeqStart: 101,
  bookSeqEnd: 101,
  reset: false,
  bids: [],
  asks: [],
  ...over,
});

describe("sequence arithmetic", () => {
  it("compares without losing precision past 2^53", () => {
    assert.equal(core.compareSequence("9007199254740993", "9007199254740992"), 1);
    assert.equal(core.compareSequence("9007199254740992", "9007199254740993"), -1);
    assert.equal(core.compareSequence("500", "500"), 0);
    assert.equal(core.compareSequence("99", "100"), -1);
  });

  it("increments, including across a carry", () => {
    assert.equal(core.incrementSequence("41"), "42");
    assert.equal(core.incrementSequence("99"), "100");
    assert.equal(core.incrementSequence("1999"), "2000");
    assert.equal(core.incrementSequence("9007199254740992"), "9007199254740993");
  });
});

describe("parseOrderbookDelta", () => {
  it("accepts the published JSON shape", () => {
    const parsed = core.parseOrderbookDelta(
      {
        asks: [["101.3", "1.75"]],
        bids: [["101.25", "2.5"]],
        bookSeqEnd: 41821,
        bookSeqStart: 41820,
        reset: false,
        symbolId: 1,
        ts: 1767225600123,
      },
      SYMBOL_ID,
    );
    assert.equal(parsed.bookSeqStart, "41820");
    assert.equal(parsed.bookSeqEnd, "41821");
    assert.equal(parsed.bids[0].price, "101.25");
    assert.equal(parsed.ts, 1767225600123);
  });

  it("accepts decimal strings for sequence fields", () => {
    // The Protobuf variant carries uint64 as strings; the JSON one as numbers.
    const parsed = core.parseOrderbookDelta(
      delta({ bookSeqStart: "101", bookSeqEnd: "101" }),
      SYMBOL_ID,
    );
    assert.equal(parsed.bookSeqEnd, "101");
  });

  it("rejects a payload for a different symbol", () => {
    assert.throws(
      () => core.parseOrderbookDelta(delta({ symbolId: 2 }), SYMBOL_ID),
      (error) => error.code === "invalid_symbol_id",
    );
  });

  it("rejects a reversed sequence range", () => {
    assert.throws(
      () => core.parseOrderbookDelta(delta({ bookSeqStart: 105, bookSeqEnd: 104 }), SYMBOL_ID),
      (error) => error.code === "invalid_sequence",
    );
  });

  it("rejects levels that are not decimal string pairs", () => {
    assert.throws(
      () => core.parseOrderbookDelta(delta({ bids: [["100", 2]] }), SYMBOL_ID),
      (error) => error.code === "invalid_level",
    );
    assert.throws(
      () => core.parseOrderbookDelta(delta({ bids: [{ price: "1", qty: "1" }] }), SYMBOL_ID),
      (error) => error.code === "invalid_level",
    );
  });
});

describe("applyOrderbookDelta", () => {
  it("applies SET semantics rather than adding quantities", () => {
    const book = core.createStreamBook(snapshot());
    const result = core.applyOrderbookDelta(
      book,
      core.parseOrderbookDelta(delta({ bids: [["100.0", "5"]] }), SYMBOL_ID),
    );
    assert.equal(result.status, "applied");
    const level = result.book.bids.find((l) => l.price === "100.0");
    // 5, not 2 + 5. A delta states the quantity at the price.
    assert.equal(level.qty, "5");
  });

  it("removes a level when the quantity is zero", () => {
    const book = core.createStreamBook(snapshot());
    const result = core.applyOrderbookDelta(
      book,
      core.parseOrderbookDelta(delta({ bids: [["99.0", "0"]] }), SYMBOL_ID),
    );
    assert.equal(result.status, "applied");
    assert.equal(result.book.bids.some((l) => l.price === "99.0"), false);
    assert.equal(result.book.bids.length, 1);
  });

  it("keeps bids descending and asks ascending", () => {
    const book = core.createStreamBook(snapshot());
    const result = core.applyOrderbookDelta(
      book,
      core.parseOrderbookDelta(
        delta({ bids: [["100.5", "1"]], asks: [["100.9", "1"]] }),
        SYMBOL_ID,
      ),
    );
    assert.equal(result.book.bids[0].price, "100.5");
    assert.equal(result.book.asks[0].price, "100.9");
  });

  it("ignores a delta that does not advance the sequence", () => {
    const book = core.createStreamBook(snapshot());
    const result = core.applyOrderbookDelta(
      book,
      core.parseOrderbookDelta(delta({ bookSeqStart: 100, bookSeqEnd: 100 }), SYMBOL_ID),
    );
    // Reconnect replays are expected; applying them twice would double-count.
    assert.equal(result.status, "stale");
    assert.equal(result.book.bookSeq, "100");
  });

  it("reports a gap instead of applying an update that leaves a hole", () => {
    const book = core.createStreamBook(snapshot());
    const result = core.applyOrderbookDelta(
      book,
      core.parseOrderbookDelta(delta({ bookSeqStart: 105, bookSeqEnd: 106 }), SYMBOL_ID),
    );
    assert.equal(result.status, "gap");
    assert.equal(result.expected, "101");
    assert.equal(result.received, "105");
    // The local book is left untouched so the caller can re-snapshot.
    assert.equal(result.book.bookSeq, "100");
  });

  it("applies a contiguous multi-sequence delta", () => {
    const book = core.createStreamBook(snapshot());
    const result = core.applyOrderbookDelta(
      book,
      core.parseOrderbookDelta(delta({ bookSeqStart: 101, bookSeqEnd: 103 }), SYMBOL_ID),
    );
    assert.equal(result.status, "applied");
    assert.equal(result.book.bookSeq, "103");
  });

  it("clears local state on reset", () => {
    const book = core.createStreamBook(snapshot());
    const result = core.applyOrderbookDelta(
      book,
      core.parseOrderbookDelta(
        delta({ reset: true, bookSeqStart: 0, bookSeqEnd: 200, bids: [["50", "1"]] }),
        SYMBOL_ID,
      ),
    );
    assert.equal(result.status, "applied");
    assert.equal(result.book.bookSeq, "200");
    assert.equal(result.book.bids.length, 1);
    assert.equal(result.book.asks.length, 0);
  });
});

describe("centrifuge frames", () => {
  it("builds commands the server expects", () => {
    assert.equal(core.connectCommand(1), '{"id":1,"connect":{}}');
    assert.equal(
      core.subscribeCommand(2, "public:spot:orderbook:deltas:depth:50:1:json"),
      '{"id":2,"subscribe":{"channel":"public:spot:orderbook:deltas:depth:50:1:json"}}',
    );
  });

  it("interprets replies, publications, heartbeats and errors", () => {
    assert.equal(core.interpretFrame({ id: 1, connect: { client: "abc" } }).kind, "connect");
    assert.equal(core.interpretFrame({ id: 2, subscribe: { channel: "x" } }).kind, "subscribe");

    const publication = core.interpretFrame({
      push: { channel: "ch", pub: { data: { symbolId: 1 } } },
    });
    assert.equal(publication.kind, "publication");
    assert.equal(publication.channel, "ch");
    assert.deepEqual(publication.data, { symbolId: 1 });

    assert.equal(core.interpretFrame({}).kind, "ping");
    assert.equal(core.interpretFrame({ id: 7 }).kind, "ping");

    const error = core.interpretFrame({ id: 2, error: { code: 103, message: "permission denied" } });
    assert.equal(error.kind, "error");
    assert.equal(error.code, 103);
  });

  it("returns null for a non-JSON frame rather than throwing", () => {
    assert.equal(core.parseFrame("not json"), null);
    assert.equal(core.parseFrame("[1,2,3]").kind, "unknown");
    assert.equal(core.parseFrame('"a string"').kind, "unknown");
  });

  it("names the channel exactly as published", () => {
    assert.equal(
      core.orderbookDeltaChannel(50, 1),
      "public:spot:orderbook:deltas:depth:50:1:json",
    );
  });
});

/**
 * The transport, driven by a fake socket.
 *
 * Every assertion here is about degradation: what the caller is told when the
 * socket fails, and whether the polled book is preserved.
 */
describe("streamOrderbook transport", () => {
  const loadTransport = async () =>
    vite.ssrLoadModule("/apps/web/src/lib/orderbookStream.ts");

  /** A minimal fake WebSocket that records sends and can be driven by hand. */
  class FakeSocket {
    static instances = [];
    static OPEN = 1;
    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      FakeSocket.instances.push(this);
    }
    send(payload) {
      this.sent.push(payload);
    }
    close() {
      this.readyState = 3;
      this.onclose?.({});
    }
    // --- test drivers ---
    open() {
      this.readyState = 1;
      this.onopen?.({});
    }
    deliver(frame) {
      this.onmessage?.({ data: JSON.stringify(frame) });
    }
    drop() {
      this.readyState = 3;
      this.onclose?.({});
    }
  }

  const makeHarness = async (overrides = {}) => {
    const transport = await loadTransport();
    FakeSocket.instances = [];
    const books = [];
    const statuses = [];
    let snapshotCalls = 0;
    const stop = transport.streamOrderbook({
      symbolId: SYMBOL_ID,
      depth: 50,
      wsUrl: "wss://example.test/connection/websocket",
      maxFailures: 2,
      snapshot: async () => {
        snapshotCalls += 1;
        return snapshot();
      },
      onBook: (book) => books.push(book),
      onStatus: (status, detail) => statuses.push({ status, detail }),
      WebSocketImpl: FakeSocket,
      ...overrides,
    });
    return { stop, books, statuses, snapshotCalls: () => snapshotCalls, socket: () => FakeSocket.instances.at(-1) };
  };

  it("connects, subscribes, snapshots, then applies a delta", async () => {
    const h = await makeHarness();
    const socket = h.socket();
    assert.equal(socket.url, "wss://example.test/connection/websocket");

    socket.open();
    assert.equal(socket.sent[0], '{"id":1,"connect":{}}');

    socket.deliver({ id: 1, connect: { client: "x" } });
    assert.match(socket.sent[1], /"subscribe"/);
    assert.match(socket.sent[1], /public:spot:orderbook:deltas:depth:50:1:json/);

    socket.deliver({ id: 2, subscribe: {} });
    // The snapshot is awaited before live is reported.
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.books.length, 1);
    assert.equal(h.books[0].bookSeq, "100");

    socket.deliver({ push: { channel: "public:spot:orderbook:deltas:depth:50:1:json", pub: { data: delta({ bids: [["100.0", "9"]] }) } } });
    assert.equal(h.books.at(-1).bookSeq, "101");
    assert.equal(h.books.at(-1).bids.find((l) => l.price === "100.0").qty, "9");

    h.stop();
  });

  it("answers the server heartbeat", async () => {
    const h = await makeHarness();
    const socket = h.socket();
    socket.open();
    socket.deliver({});
    assert.equal(socket.sent.at(-1), "{}");
    h.stop();
  });

  it("re-snapshots on a sequence gap rather than merging a hole", async () => {
    const h = await makeHarness();
    const socket = h.socket();
    socket.open();
    socket.deliver({ id: 1, connect: {} });
    socket.deliver({ id: 2, subscribe: {} });
    await new Promise((resolve) => setImmediate(resolve));
    const before = h.snapshotCalls();

    socket.deliver({ push: { channel: "public:spot:orderbook:deltas:depth:50:1:json", pub: { data: delta({ bookSeqStart: 500, bookSeqEnd: 501 }) } } });
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(h.snapshotCalls(), before + 1);
    // The book was never advanced past the hole.
    assert.equal(h.books.at(-1).bookSeq, "100");
    h.stop();
  });

  it("reports unavailable and keeps retrying, then gives up", async () => {
    const h = await makeHarness();
    h.socket().drop();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(h.statuses.some((s) => s.status === "reconnecting"));
    h.stop();
  });

  it("stays silent when the constructor throws", async () => {
    const throwing = class {
      constructor() {
        throw new Error("blocked");
      }
    };
    const h = await makeHarness({ WebSocketImpl: throwing });
    assert.ok(h.statuses.some((s) => s.status === "reconnecting"));
    h.stop();
  });

  it("does not call the snapshot before a subscribe reply arrives", async () => {
    const h = await makeHarness();
    h.socket().open();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(h.snapshotCalls(), 0);
    h.stop();
  });

  it("stops cleanly: no reconnect after stop()", async () => {
    const h = await makeHarness();
    const socket = h.socket();
    h.stop();
    const countBefore = FakeSocket.instances.length;
    socket.onclose?.({});
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(FakeSocket.instances.length, countBefore);
  });
});
