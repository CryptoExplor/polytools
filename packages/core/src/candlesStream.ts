/**
 * Live candles: `public:spot:market:candles:{timeframe}:{symbolId}` — JSON variant.
 *
 * Published shape, from `streams.json`:
 *
 * ```json
 * {"close":"101.7","high":"101.9","isClosed":false,"low":"101.1",
 *  "open":"101.25","tsSec":"1767225600","volume":"1.5"}
 * ```
 *
 * The interesting property is that the *in-progress* bar is republished as it
 * moves. `isClosed` distinguishes a finished bar from a running one, and the
 * merge must replace rather than append when the same `tsSec` arrives twice —
 * appending would draw a new candle on every tick.
 */

export interface StreamCandle {
  /** Unix seconds, as a decimal string so 64-bit values stay exact. */
  tsSec: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  isClosed: boolean;
}

export type CandleStreamErrorCode = "not_an_object" | "invalid_field";

export class CandleStreamError extends Error {
  constructor(public readonly code: CandleStreamErrorCode, public readonly field?: string) {
    super(`Candle publication rejected: ${code}${field ? ` (${field})` : ""}`);
    this.name = "CandleStreamError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const DECIMAL = /^\d+(?:\.\d+)?$/;

function decimal(value: unknown, field: string, allowZero = true): string {
  if (typeof value !== "string" || !DECIMAL.test(value)) {
    throw new CandleStreamError("invalid_field", field);
  }
  if (!allowZero && Number(value) === 0) throw new CandleStreamError("invalid_field", field);
  return value;
}

export function parseCandlePoint(value: unknown): StreamCandle {
  if (!isRecord(value)) throw new CandleStreamError("not_an_object");

  const rawTs = value.tsSec;
  const tsSec =
    typeof rawTs === "string"
      ? rawTs
      : typeof rawTs === "number" && Number.isSafeInteger(rawTs) && rawTs >= 0
        ? String(rawTs)
        : null;
  if (tsSec === null || !/^\d+$/.test(tsSec)) {
    throw new CandleStreamError("invalid_field", "tsSec");
  }

  return {
    tsSec,
    open: decimal(value.open, "open"),
    high: decimal(value.high, "high"),
    low: decimal(value.low, "low"),
    close: decimal(value.close, "close"),
    // A brand-new bar legitimately has zero volume; a negative one cannot exist.
    volume: decimal(value.volume, "volume"),
    isClosed: value.isClosed === true,
  };
}

/** The shape our candle chart already consumes. */
export interface ChartCandle {
  time: number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  isClosed: boolean;
}

/** Seconds as a number for the chart. Safe for any realistic candle timestamp. */
export function toChartCandle(point: StreamCandle): ChartCandle {
  return {
    time: Number(point.tsSec),
    open: point.open,
    high: point.high,
    low: point.low,
    close: point.close,
    volume: point.volume,
    isClosed: point.isClosed,
  };
}

/**
 * Upserts one bar into an ascending series.
 *
 * Replacing by timestamp is the whole point: a running bar is republished many
 * times, and each publication carries the *whole* bar rather than a delta. The
 * series stays ascending so the chart does not have to re-sort on every tick.
 */
export function mergeCandle(existing: ChartCandle[], incoming: ChartCandle, cap = 500): ChartCandle[] {
  const limit = Math.max(1, Math.floor(cap));
  const withoutSameBar = existing.filter((candle) => candle.time !== incoming.time);
  const merged = [...withoutSameBar, incoming].sort((a, b) => a.time - b.time);
  return merged.slice(-limit);
}

/**
 * True when the only change is inside the most recent, still-open bar.
 *
 * The UI uses this to decide whether a redraw is a cheap in-place update or a
 * structural change; it is also what makes "is the live bar advancing?" a
 * question with an answer rather than a guess.
 */
export function advancesOpenBar(existing: ChartCandle[], incoming: ChartCandle): boolean {
  const last = existing[existing.length - 1];
  if (!last) return true;
  return incoming.time === last.time || incoming.time > last.time;
}
