/**
 * The order-book layer on top of the shared realtime session.
 *
 * Socket lifecycle (reconnect, backoff, heartbeat, visibility, framing) lives in
 * `realtimeSession.ts`. This file owns only what is order-book specific: taking
 * a unary snapshot first, buffering deltas that race it, and merging.
 *
 * Design constraints, all deliberate:
 *
 *  - **Polling stays the floor.** This never replaces the polled book; it
 *    refines it. If the socket never connects, drops repeatedly, or reports a
 *    sequence gap that cannot be repaired, the caller keeps its polled data.
 *  - **No credentials.** The channel is anonymous. Nothing from the wallet or
 *    session is ever passed here.
 */

import {
  applyOrderbookDelta,
  createStreamBook,
  orderbookDeltaChannel,
  parseOrderbookDelta,
  type OrderbookDelta,
  type StreamBook,
} from "@poly/core";
import {
  subscribeChannel,
  type RealtimeStatus,
} from "./realtimeSession";

export type StreamStatus = RealtimeStatus;

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
  subprotocols?: string[];
  /** Consecutive failures before the session stops trying. */
  maxFailures?: number;
  /** Base reconnect delay in ms; doubles per failure. */
  retryBaseDelayMs?: number;
  visibilityTarget?: EventTarget | null;
}

/** Re-exported so callers do not import the session module directly. */
export { defaultRealtimeUrl as defaultOrderbookStreamUrl, JSON_SUBPROTOCOL } from "./realtimeSession";

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
/**
 * A dead stream yields to polling; anything still trying keeps showing the last
 * known value, because "reconnecting" is a reason to keep the number on screen,
 * not to blank it.
 */
export function seriesForDisplay<T>(status: StreamStatus, live: T | null): T | null {
  return status === "unavailable" ? null : live;
}

/** The book is a series like any other; one rule, one implementation. */
export const bookForDisplay = seriesForDisplay;

export function streamOrderbook(options: OrderbookStreamOptions): () => void {
  let book: StreamBook | null = null;
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

  const resnapshot = async (reason: string) => {
    if (resnapshotInFlight) return;
    resnapshotInFlight = true;
    try {
      const fresh = await options.snapshot();
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
    // already covered by a newer snapshot: dropping it silently is correct.
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

  return subscribeChannel({
    channel: orderbookDeltaChannel(options.depth, options.symbolId),
    wsUrl: options.wsUrl,
    WebSocketImpl: options.WebSocketImpl,
    subprotocols: options.subprotocols,
    maxFailures: options.maxFailures,
    retryBaseDelayMs: options.retryBaseDelayMs,
    visibilityTarget: options.visibilityTarget,
    onStatus: options.onStatus,
    // Snapshot first, deltas second: a delta applied to an empty book is a book
    // with one price level and no context.
    onSubscribed: () => {
      void resnapshot("subscribe");
    },
    onMessage: (data) => {
      let delta: OrderbookDelta;
      try {
        delta = parseOrderbookDelta(data, options.symbolId);
      } catch {
        // A malformed publication is not worth tearing the socket down over,
        // but it does mean the book can no longer be trusted to be current.
        void resnapshot("malformed update; refetching");
        return;
      }
      applyDelta(delta);
    },
  });
}
