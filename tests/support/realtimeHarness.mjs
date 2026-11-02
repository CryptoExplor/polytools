/**
 * Shared fakes for the realtime stream tests.
 *
 * There were two hand-written `FakeSocket` classes, and they had already
 * drifted: one recorded raw frames and had `drop()`, the other parsed JSON at
 * send time and had `emit()` instead. A fake that differs per file makes a
 * green suite depend on which file you are in, so everything here is the
 * superset, with both spellings available.
 *
 * Nothing in this module is production code, and nothing here decides what the
 * client *should* do — it only lets a test drive the socket by hand.
 */

/**
 * A controllable WebSocket.
 *
 * `send()` records the raw string, because the wire format is part of what the
 * tests assert; `sentFrames` parses on demand for tests that care about the
 * command rather than its serialisation.
 */
export function makeSocketClass() {
  const sockets = [];

  class FakeSocket {
    static OPEN = 1;

    constructor(url, protocols) {
      this.url = url;
      this.protocols = protocols;
      // What a real browser takes from the handshake response.
      this.protocol = "centrifuge-json";
      this.readyState = 0;
      this.sent = [];
      this.closed = false;
      sockets.push(this);
    }

    /** Parsed view of everything the client sent. */
    get sentFrames() {
      return this.sent.map((frame) => JSON.parse(frame));
    }

    send(payload) {
      this.sent.push(payload);
    }

    close() {
      this.closed = true;
      this.readyState = 3;
      this.onclose?.({});
    }

    addEventListener(type, fn) {
      this[`on${type}`] = fn;
    }

    removeEventListener() {}

    // --- test drivers ---------------------------------------------------------

    emit(type, event) {
      this[`on${type}`]?.(event);
    }

    open() {
      this.readyState = 1;
      this.emit("open", {});
    }

    deliver(frame) {
      this.emit("message", { data: JSON.stringify(frame) });
    }

    /** The server went away: the socket closes without the client asking. */
    drop() {
      this.readyState = 3;
      this.emit("close", {});
    }

    /** The full JSON handshake: open, connect reply, subscribe reply. */
    handshake() {
      this.open();
      this.deliver({ id: 1, connect: { client: "test", version: "6.6.0", ping: 25 } });
      this.deliver({ id: 2, subscribe: {} });
    }
  }

  Object.defineProperty(FakeSocket, "instances", { get: () => sockets });
  FakeSocket.reset = () => {
    sockets.length = 0;
  };
  return { FakeSocket, sockets };
}

/** The most recently constructed socket from any `makeSocketClass()` batch. */
export const latestSocket = (sockets) => sockets.at(-1);

/**
 * A fake `document` that reports a controllable `visibilityState`.
 *
 * Real `Document` instances cannot be told to go hidden in Node, and the
 * visibility resume path is exactly the one that is otherwise untestable.
 */
export function makeVisibility(initial = "visible") {
  const listeners = new Set();
  const target = {
    visibilityState: initial,
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
}

/** Waits for pending timers and microtasks to settle. */
export const settle = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));
