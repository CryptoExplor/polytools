/**
 * The browser transport for the public order-book delta channel.
 *
 * Everything protocol-shaped lives in `@poly/core`; this file owns only the
 * messy part — a socket that can fail, reconnect, and disagree with the
 * snapshot it was resumed from.
 *
 * Design constraints, all deliberate:
 *
 *  - **Polling stays the floor.** This never replaces the polled book; it
 *    refines it. If the socket never connects, drops repeatedly, or reports a
 *    sequence gap that cannot be repaired, the caller keeps its polled data and
 *    the UI says so. A streaming view that dies silently is worse than no
 *    streaming view.
 *  - **No credentials.** The channel is anonymous. Nothing from the wallet or
 *    session is ever passed here, so a compromised socket cannot leak account
 *    state.
 *  - **`WebSocket` is injectable** so the state machine can be tested without a
 *    browser or a network.
 *  - **Give up eventually.** After a bounded number of consecutive failures the
 *    session stops retrying, rather than reconnecting at a user forever.
 */

import {
  PONG_FRAME,
  applyOrderbookDelta,
  connectCommand,
  createStreamBook,
  orderbookDeltaChannel,
  parseFrame,
  parseOrderbookDelta,
  subscribeCommand,
  type OrderbookDelta,
  type StreamBook,
} from "@poly/core";

/** The subprotocol that carries JSON frames; the `:proto` channels need another. */
export const JSON_SUBPROTOCOL = "centrifuge-json";

export type StreamStatus = "connecting" | "live" | "reconnecting" | "unavailable";

/**
 * Which book to render, given the stream's state.
 *
 * Once the stream has given up, a streamed book is a *frozen* snapshot: the
 * socket is gone, so the levels will never change again. Rendering it beneath a
 * "Polling" label claims the numbers are being refreshed when they are not —
 * the polled book is the live one at that point. So an abandoned stream must
 * yield to polling rather than sit in front of it.
 *
 * During `connecting` and `reconnecting` the last known book is still the best
 * information available and the stream may resume at any moment, so it stays.
 */
export function bookForDisplay<T>(status: StreamStatus, live: T | null): T | null {
  return status === "unavailable" ? null : live;
}

export interface StreamSnapshot {
  bookSeq: string;
  bids: { price: string; qty: string }[];
  asks: { price: string; qty: string }[];
}

export interface OrderbookStreamOptions {
  symbolId: number;
  depth: number;
  /** Fetches a fresh unary snapshot; called on start and after a gap. */
  snapshot: () => Promise<StreamSnapshot>;
  onBook: (book: StreamBook) => void;
  onStatus: (status: StreamStatus, detail?: string) => void;
  wsUrl?: string;
  WebSocketImpl?: typeof WebSocket;
  /** Consecutive failures before the session stops trying. */
  maxFailures?: number;
  /** Base reconnect delay in ms; doubles per failure. */
  retryBaseDelayMs?: number;
  /** Subprotocols to request; defaults to the JSON variant. */
  subprotocols?: string[];
  /**
   * Where to listen for the page becoming visible again. Defaults to
   * `document`; injectable so the resume behaviour can be tested without a DOM.
   */
  visibilityTarget?: EventTarget | null;
}

/** Where the public realtime endpoint lives. Overridable for other networks. */
export function defaultOrderbookStreamUrl(): string {
  const configured = (
    import.meta.env.VITE_POLYESTER_WS_URL as string | undefined
  )?.trim();
  const base = configured || "wss://api.testnet.polyester.com/connection/websocket";
  return base;
}

/**
 * Opens the socket and keeps a local book in sync.
 *
 * Returns a stop function. Calling it is the only way to release the socket and
 * the pending reconnect timer; the caller is expected to do so on unmount or
 * whenever the symbol/depth changes.
 */
export function streamOrderbook(options: OrderbookStreamOptions): () => void {
  const WebSocketImpl = options.WebSocketImpl ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  const maxFailures = options.maxFailures ?? 5;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 1_000;

  let socket: WebSocket | null = null;
  let stopped = false;
  let failureCount = 0;
  /**
   * True once the retry budget is exhausted.
   *
   * Browsers suspend or kill sockets in background tabs, so "gave up" is often
   * really "the tab was hidden". Without a way back, a user who leaves the page
   * for a minute returns to a permanently dead stream that only a reload fixes.
   */
  let gaveUp = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let commandId = 1;
  let book: StreamBook | null = null;
  let channel = "";
  let resnapshotInFlight = false;
  /**
   * Deltas that arrived while no book existed yet (the snapshot request is
   * still in flight). Dropping these was the original behaviour and it is
   * wrong under live traffic: the first publications arrive within milliseconds
   * of the subscribe reply, so the very first updates would be lost and the
   * next delta would look like a sequence gap. Bounded, because a snapshot that
   * never returns must not grow memory without limit.
   */
  let pending: OrderbookDelta[] = [];
  const MAX_PENDING = 256;

  const send = (payload: string) => {
    if (socket && socket.readyState === 1) {
      try {
        socket.send(payload);
      } catch {
        // A send that throws is a dying socket; the close handler owns recovery.
      }
    }
  };

  const stop = () => {
    stopped = true;
    pending = [];
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (socket) {
      // Detach first so the close handler does not schedule a reconnect.
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try {
        socket.close();
      } catch {
        // Already closed.
      }
      socket = null;
    }
  };

  const resnapshot = async (reason: string) => {
    if (resnapshotInFlight || stopped) return;
    resnapshotInFlight = true;
    try {
      const fresh = await options.snapshot();
      if (stopped) return;
      book = createStreamBook(fresh);
      options.onBook(book);
      flushPending();
    } catch {
      // The caller still has polled data; report rather than invent a book.
      options.onStatus("unavailable", reason);
    } finally {
      resnapshotInFlight = false;
    }
  };

  const scheduleReconnect = () => {
    if (stopped) return;
    failureCount += 1;
    if (failureCount > maxFailures) {
      gaveUp = true;
      options.onStatus("unavailable", "stream unavailable; showing polled data");
      return;
    }
    options.onStatus("reconnecting");
    // Capped exponential backoff with jitter, so N open tabs do not retry in
    // lockstep after a backend restart.
    const delay = Math.min(30_000, retryBaseDelayMs * 2 ** (failureCount - 1));
    // Jitter proportional to the delay, not a fixed budget: a flat 250ms of
    // jitter would swamp a short delay and make an early retry feel sluggish.
    const jitter = Math.floor(Math.random() * Math.min(delay, 250));
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay + jitter);
  };

  /** Applies one parsed delta to the local book, or reacts to why it cannot. */
  const applyDelta = (delta: OrderbookDelta) => {
    if (!book) {
      pending.push(delta);
      if (pending.length > MAX_PENDING) pending = pending.slice(-MAX_PENDING);
      return;
    }
    const result = applyOrderbookDelta(book, delta);
    if (result.status === "applied") {
      book = result.book;
      options.onBook(book);
      return;
    }
    if (result.status === "gap") {
      options.onStatus("reconnecting", "sequence gap; refetching");
      void resnapshot("sequence gap");
    }
    // "stale" is expected after a reconnect replay or when a buffered delta is
    // already covered by a newer snapshot: the update is in our state already,
    // so dropping it silently is correct.
  };

  /**
   * Replays deltas that arrived before the snapshot landed.
   *
   * A delta the snapshot already covers is stale by sequence and is discarded
   * by `applyDelta`; anything newer applies in order. That is why the snapshot
   * must be taken *before* flushing — it is the baseline those deltas advance.
   */
  const flushPending = () => {
    if (!pending.length) return;
    const queued = pending;
    pending = [];
    for (const delta of queued) applyDelta(delta);
  };

  const handleDelta = (data: unknown) => {
    let delta: OrderbookDelta;
    try {
      delta = parseOrderbookDelta(data, options.symbolId);
    } catch {
      // A malformed publication is not worth tearing the socket down over, but
      // it does mean the book can no longer be trusted to be current.
      void resnapshot("malformed update; refetching");
      return;
    }
    applyDelta(delta);
  };

  const connect = () => {
    if (stopped || !WebSocketImpl) {
      options.onStatus("unavailable", "WebSocket unavailable in this browser");
      return;
    }
    options.onStatus(failureCount === 0 ? "connecting" : "reconnecting");

    let ws: WebSocket;
    try {
      // Request the JSON subprotocol explicitly. The channel we use is the
      // `:json` variant, and live verification proved the server negotiates
      // whatever is asked for. Opening the socket with no subprotocol leaves
      // the framing to the server's default — which is unverified, and would
      // fail here while every probe (which does ask) kept passing.
      ws = new WebSocketImpl(
        options.wsUrl ?? defaultOrderbookStreamUrl(),
        options.subprotocols ?? [JSON_SUBPROTOCOL],
      );
    } catch {
      scheduleReconnect();
      return;
    }
    socket = ws;

    ws.onopen = () => {
      if (stopped) return;
      send(connectCommand(commandId++));
    };

    ws.onmessage = (event: MessageEvent) => {
      if (stopped) return;
      const frame = typeof event.data === "string" ? parseFrame(event.data) : null;
      if (!frame) return;

      switch (frame.kind) {
        case "ping":
          send(PONG_FRAME);
          return;
        case "connect":
          channel = orderbookDeltaChannel(options.depth, options.symbolId);
          send(subscribeCommand(commandId++, channel));
          return;
        case "subscribe":
          // Snapshot first, deltas second: a delta applied to an empty book is
          // a book with one price level and no context.
          failureCount = 0;
          void resnapshot("subscribe").then(() => options.onStatus("live"));
          return;
        case "publication":
          if (frame.channel === null || frame.channel === channel) handleDelta(frame.data);
          return;
        case "error":
          options.onStatus("unavailable", frame.message ?? "stream rejected");
          stop();
          return;
        default:
          return;
      }
    };

    ws.onerror = () => {
      // `onclose` always follows; recovery is handled there so a browser that
      // only fires one of the two cannot cause a double reconnect.
    };

    ws.onclose = () => {
      socket = null;
      if (stopped) return;
      scheduleReconnect();
    };
  };

  // Resume on visibility: a hidden tab is the most common reason the socket
  // died, and it is the one case where retrying is clearly worth it.
  const visibilityTarget =
    options.visibilityTarget === undefined
      ? (typeof document === "undefined" ? null : document)
      : options.visibilityTarget;

  const onVisibility = () => {
    if (stopped || !gaveUp) return;
    const state = (visibilityTarget as Document | null)?.visibilityState;
    if (state !== undefined && state !== "visible") return;
    gaveUp = false;
    failureCount = 0;
    connect();
  };

  if (visibilityTarget) {
    visibilityTarget.addEventListener("visibilitychange", onVisibility);
  }

  const stopWithListener = () => {
    if (visibilityTarget) {
      visibilityTarget.removeEventListener("visibilitychange", onVisibility);
    }
    stop();
  };

  connect();
  return stopWithListener;
}
