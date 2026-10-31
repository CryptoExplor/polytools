/**
 * Live candles on top of the shared realtime session.
 *
 * The chart already renders a polled series; this refines the newest bar in
 * place. A running bar is republished as it moves, so the merge replaces by
 * timestamp rather than appending — see `mergeCandle`.
 */

import {
  mergeCandle,
  parseCandlePoint,
  toChartCandle,
  type ChartCandle,
} from "@poly/core";

export type { ChartCandle };
import { subscribeChannel, type RealtimeStatus } from "./realtimeSession";

export type { RealtimeStatus };

export function candlesChannel(timeframe: string, symbolId: number): string {
  return `public:spot:market:candles:${timeframe}:${symbolId}`;
}

export interface CandlesStreamOptions {
  symbolId: number;
  /** Channel timeframe token, e.g. `1m`. */
  timeframe: string;
  cap?: number;
  onCandle: (candle: ChartCandle) => void;
  onStatus: (status: RealtimeStatus, detail?: string) => void;
  wsUrl?: string;
  WebSocketImpl?: typeof WebSocket;
  maxFailures?: number;
  retryBaseDelayMs?: number;
  visibilityTarget?: EventTarget | null;
}

/** Subscribes to live candles. Returns a stop function. */
export function streamCandles(options: CandlesStreamOptions): () => void {
  return subscribeChannel({
    channel: candlesChannel(options.timeframe, options.symbolId),
    wsUrl: options.wsUrl,
    WebSocketImpl: options.WebSocketImpl,
    maxFailures: options.maxFailures,
    retryBaseDelayMs: options.retryBaseDelayMs,
    visibilityTarget: options.visibilityTarget,
    onStatus: options.onStatus,
    onMessage: (data) => {
      try {
        options.onCandle(toChartCandle(parseCandlePoint(data)));
      } catch {
        // A malformed bar is skipped; the polled series remains the floor.
      }
    },
  });
}

/** Folds one live bar into the chart series. */
export function upsertCandle(
  existing: ChartCandle[],
  incoming: ChartCandle,
  cap = 500,
): ChartCandle[] {
  return mergeCandle(existing, incoming, cap);
}
