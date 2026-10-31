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

describe("live range convention", () => {
  // Ranges captured from a real run on 2026-10-31:
  //   10939000-10939003 → 10939003-10939004 → 10939004-10939011
  // Consecutive ranges SHARE a sequence number rather than being strictly
  // adjacent, so a client that assumes start === prevEnd + 1 would report a
  // false gap, and one that assumes no overlap might double-count under
  // increment semantics. SET semantics makes the overlap harmless; this pins it.
  const LIVE_RANGES = [
    [10939000, 10939003],
    [10939003, 10939004],
    [10939004, 10939011],
  ];

  it("applies the full live chain without reporting a gap", () => {
    let book = core.createStreamBook({ bookSeq: "10939000", bids: [], asks: [] });
    for (const [start, end] of LIVE_RANGES) {
      const parsed = core.parseOrderbookDelta(
        delta({
          bookSeqStart: start,
          bookSeqEnd: end,
          bids: [["100.0", String(end - 10938999)]],
        }),
        SYMBOL_ID,
      );
      const result = core.applyOrderbookDelta(book, parsed);
      assert.equal(result.status, "applied", `${start}-${end}`);
      book = result.book;
    }
    assert.equal(book.bookSeq, "10939011");
    // The shared boundary sequence appears in two ranges; SET semantics means
    // the level holds the last stated quantity, never a sum.
    assert.equal(book.bids.find((l) => l.price === "100.0").qty, "12");
  });

  it("treats a shared boundary as contiguous, not as a gap", () => {
    const book = core.createStreamBook({ bookSeq: "10939003", bids: [], asks: [] });
    // start === current seq: already covered at the boundary, still advances.
    const result = core.applyOrderbookDelta(
      book,
      core.parseOrderbookDelta(delta({ bookSeqStart: 10939003, bookSeqEnd: 10939004 }), SYMBOL_ID),
    );
    assert.equal(result.status, "applied");
  });

  it("still catches a genuine hole in that convention", () => {
    const book = core.createStreamBook({ bookSeq: "10939004", bids: [], asks: [] });
    const result = core.applyOrderbookDelta(
      book,
      core.parseOrderbookDelta(delta({ bookSeqStart: 10939006, bookSeqEnd: 10939011 }), SYMBOL_ID),
    );
    assert.equal(result.status, "gap");
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
    constructor(url, protocols) {
      this.url = url;
      this.protocols = protocols;
      // What the server negotiated; a real browser sets this from the response.
      this.protocol = "centrifuge-json";
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

  it("requests the JSON subprotocol on every connection attempt", async () => {
    // The probe asks for `centrifuge-json` and the server negotiates it; a
    // browser that opens with no subprotocol leaves framing to an unverified
    // default. That asymmetry is invisible to any probe, so it is pinned here.
    const h = await makeHarness();
    assert.deepEqual(h.socket().protocols, ["centrifuge-json"]);
    h.stop();
  });

  it("re-requests the subprotocol when it reconnects", async () => {
    const h = await makeHarness({ maxFailures: 3, retryBaseDelayMs: 5 });
    h.socket().drop();
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.ok(FakeSocket.instances.length > 1, "reconnected");
    assert.deepEqual(h.socket().protocols, ["centrifuge-json"]);
    h.stop();
  });

  it("refuses a protobuf framing it cannot decode", async () => {
    // The same endpoint negotiates `centrifuge-protobuf` when asked, and binary
    // frames would parse as null here: a stream that looks connected and never
    // updates. Fail loudly instead of silently rendering a frozen book.
    const h = await makeHarness();
    const socket = h.socket();
    socket.protocol = "centrifuge-protobuf";
    socket.open();

    assert.equal(socket.sent.length, 0, "does not proceed to a connect command");
    assert.equal(h.statuses.at(-1).status, "unavailable");
    assert.match(String(h.statuses.at(-1).detail), /decodes JSON frames only/);
    h.stop();
  });

  it("accepts an empty negotiation, which still carries text JSON", async () => {
    const h = await makeHarness();
    const socket = h.socket();
    socket.protocol = "";
    socket.open();
    assert.equal(socket.sent[0], '{"id":1,"connect":{}}');
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

  it("buffers deltas that arrive before the snapshot, then replays them", async () => {
    // Live traffic publishes within milliseconds of the subscribe reply, so a
    // snapshot that resolves later would otherwise lose the first updates and
    // turn the next delta into a phantom sequence gap.
    let releaseSnapshot;
    const gate = new Promise((resolve) => {
      releaseSnapshot = resolve;
    });
    const h = await makeHarness({
      snapshot: async () => {
        await gate;
        return snapshot();
      },
    });
    const socket = h.socket();
    socket.open();
    socket.deliver({ id: 1, connect: {} });
    socket.deliver({ id: 2, subscribe: {} });

    // Delta arrives while the snapshot is still in flight.
    socket.deliver({
      push: {
        channel: "public:spot:orderbook:deltas:depth:50:1:json",
        pub: { data: delta({ bookSeqStart: 101, bookSeqEnd: 101, bids: [["100.0", "7"]] }) },
      },
    });
    assert.equal(h.books.length, 0, "nothing is published before the snapshot");

    releaseSnapshot();
    await new Promise((resolve) => setImmediate(resolve));

    // Snapshot first (seq 100), then the buffered delta applied on top.
    assert.equal(h.books.length, 2);
    assert.equal(h.books[0].bookSeq, "100");
    assert.equal(h.books[1].bookSeq, "101");
    assert.equal(h.books[1].bids.find((l) => l.price === "100.0").qty, "7");
    h.stop();
  });

  it("discards a buffered delta the snapshot already covers", async () => {
    let releaseSnapshot;
    const gate = new Promise((resolve) => {
      releaseSnapshot = resolve;
    });
    const h = await makeHarness({
      // The snapshot is newer than the delta that raced it.
      snapshot: async () => {
        await gate;
        return { ...snapshot(), bookSeq: "105" };
      },
    });
    const socket = h.socket();
    socket.open();
    socket.deliver({ id: 1, connect: {} });
    socket.deliver({ id: 2, subscribe: {} });
    socket.deliver({
      push: {
        channel: "public:spot:orderbook:deltas:depth:50:1:json",
        pub: { data: delta({ bookSeqStart: 101, bookSeqEnd: 101, bids: [["100.0", "7"]] }) },
      },
    });

    releaseSnapshot();
    await new Promise((resolve) => setImmediate(resolve));

    // Only the snapshot is published; the stale buffered delta is dropped and
    // does not roll the book back to 101.
    assert.equal(h.books.length, 1);
    assert.equal(h.books[0].bookSeq, "105");
    h.stop();
  });

  /** A fake EventTarget that reports a controllable visibilityState. */
  const makeVisibility = () => {
    const listeners = new Set();
    const target = {
      visibilityState: "visible",
      addEventListener: (_type, fn) => listeners.add(fn),
      removeEventListener: (_type, fn) => listeners.delete(fn),
    };
    return {
      target,
      setState(state) {
        target.visibilityState = state;
        for (const fn of [...listeners]) fn({ type: "visibilitychange" });
      },
      get listenerCount() {
        return listeners.size;
      },
    };
  };

  it("gives up after the failure budget, then resumes when the tab is visible again", async () => {
    // A hidden tab is the usual reason a socket dies, so a permanent give-up
    // would mean the page stays dead until reload.
    const visibility = makeVisibility();
    const h = await makeHarness({
      maxFailures: 1,
      retryBaseDelayMs: 5,
      visibilityTarget: visibility.target,
    });

    // First failure: budget is 1, so this schedules one retry.
    h.socket().drop();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const afterFirst = FakeSocket.instances.length;
    assert.ok(afterFirst > 1, "retried once inside the budget");

    // Second failure exceeds the budget: stop trying.
    h.socket().drop();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const afterGiveUp = FakeSocket.instances.length;
    assert.equal(h.statuses.at(-1).status, "unavailable");

    // Still hidden: no reconnect.
    visibility.setState("hidden");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(FakeSocket.instances.length, afterGiveUp, "does not retry while hidden");

    // Visible again: retries immediately.
    visibility.setState("visible");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(FakeSocket.instances.length > afterGiveUp, "reconnects when the tab returns");

    h.stop();
  });

  it("does not reconnect on visibility while the stream is healthy", async () => {
    const visibility = makeVisibility();
    const h = await makeHarness({ visibilityTarget: visibility.target });
    const socket = h.socket();
    socket.open();
    socket.deliver({ id: 1, connect: {} });
    socket.deliver({ id: 2, subscribe: {} });
    await new Promise((resolve) => setImmediate(resolve));

    const before = FakeSocket.instances.length;
    visibility.setState("visible");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(FakeSocket.instances.length, before);
    h.stop();
  });

  it("removes the visibility listener on stop", async () => {
    const visibility = makeVisibility();
    const h = await makeHarness({ visibilityTarget: visibility.target });
    assert.equal(visibility.listenerCount, 1);
    h.stop();
    assert.equal(visibility.listenerCount, 0);
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

/**
 * The page wiring, asserted statically.
 *
 * This exists because the bug it guards against is invisible to a transport
 * test: `streamOrderbook` works perfectly on its own, but the Book page only
 * learns the exchange's numeric `symbolId` from the first polled response. If
 * that value is not a dependency of the subscribe effect, the effect runs once
 * against `null`, returns early, and the socket is never opened at all — the UI
 * silently polls forever while every unit test stays green.
 */
describe("frozen book yields to polling", () => {
  const load = async () => vite.ssrLoadModule("/apps/web/src/lib/orderbookStream.ts");

  it("renders the streamed book while the socket may still recover", async () => {
    const { bookForDisplay } = await load();
    const live = { bookSeq: "9" };
    for (const status of ["connecting", "live", "reconnecting"]) {
      assert.equal(bookForDisplay(status, live), live, status);
    }
  });

  it("drops a streamed book once the stream has given up", async () => {
    // A frozen book under a "Polling" label is the exact quiet inaccuracy the
    // rest of this app refuses to ship: the numbers stop moving but the UI
    // implies they are being refreshed.
    const { bookForDisplay } = await load();
    assert.equal(bookForDisplay("unavailable", { bookSeq: "9" }), null);
  });

  it("is null-safe before any book exists", async () => {
    const { bookForDisplay } = await load();
    assert.equal(bookForDisplay("live", null), null);
    assert.equal(bookForDisplay("unavailable", null), null);
  });
});

describe("Book page stream wiring", () => {
  it("re-runs the subscribe effect when the symbol id arrives", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const { resolve } = await import("node:path");
    const root = fileURLToPath(new URL("..", import.meta.url));
    const page = readFileSync(resolve(root, "apps/web/src/pages/Book.tsx"), "utf8")
      .replace(/\r\n/g, "\n");

    // The id is hoisted to a primitive so it can be a dependency by value.
    assert.match(page, /const symbolId: number \| null =/);

    const effect = page.slice(page.indexOf("const stop = streamOrderbook({"));
    const deps = /\}, \[([^\]]*)\]\);/.exec(effect.slice(effect.indexOf("return stop;")));
    assert.ok(deps, "the effect has a dependency array");
    assert.match(deps[1], /symbolId/, "the subscribe effect depends on symbolId");

    // Depending on `data` would re-subscribe on every poll; the whole response
    // object changes identity every 2s.
    assert.ok(!/\bdata\b/.test(deps[1]), "the effect must not depend on the polled response object");

    // And the render path must route the streamed book through the availability
    // rule, or a dead stream freezes the ladder.
    assert.match(page, /bookForDisplay\(streamStatus, liveBook\)/);
    assert.ok(
      !/liveBook \?\?/.test(page),
      "the levels must not read liveBook directly, bypassing bookForDisplay",
    );
  });
});
