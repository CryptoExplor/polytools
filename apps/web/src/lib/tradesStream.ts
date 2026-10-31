/**
 * Live trade tape on top of the shared realtime session.
 *
 * Anonymous channel, so nothing from the wallet or session is passed here.
 * Polling stays the floor: if the socket never connects the caller keeps its
 * polled tape and the UI says so.
 */

import { mergeTrade, parseMarketTrade, type StreamTrade } from "@poly/core";
import { subscribeChannel, type RealtimeStatus } from "./realtimeSession";

export type { RealtimeStatus };

export function tradesChannel(symbolId: number): string {
  return `public:spot:market:trades:${symbolId}`;
}

export interface TradesStreamOptions {
  symbolId: number;
  /** Most recent trades the UI will hold; older ones fall off. */
  cap?: number;
  onTrade: (trade: StreamTrade) => void;
  onStatus: (status: RealtimeStatus, detail?: string) => void;
  wsUrl?: string;
  WebSocketImpl?: typeof WebSocket;
  maxFailures?: number;
  retryBaseDelayMs?: number;
  visibilityTarget?: EventTarget | null;
}

/** Subscribes to the public tape. Returns a stop function. */
export function streamTrades(options: TradesStreamOptions): () => void {
  return subscribeChannel({
    channel: tradesChannel(options.symbolId),
    wsUrl: options.wsUrl,
    WebSocketImpl: options.WebSocketImpl,
    maxFailures: options.maxFailures,
    retryBaseDelayMs: options.retryBaseDelayMs,
    visibilityTarget: options.visibilityTarget,
    onStatus: options.onStatus,
    onMessage: (data) => {
      let trade: StreamTrade;
      try {
        trade = parseMarketTrade(data);
      } catch {
        // One malformed publication must not tear down a working tape, and it
        // must not be shown either: an unparseable fill is not a fill.
        return;
      }
      options.onTrade(trade);
    },
  });
}

/**
 * Folds a streamed trade into a newest-first list.
 *
 * Exported so the page can express its update as a pure function, which keeps
 * the React handler trivial and the merge covered by the core tests.
 */
export function insertTrade<T extends { matchId: string }>(
  existing: T[],
  incoming: T,
  cap = 120,
): T[] {
  return mergeTrade(existing, incoming, cap);
}
