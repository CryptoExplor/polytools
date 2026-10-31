/**
 * Public trade tape: `public:spot:market:trades:{symbolId}` — the JSON variant.
 *
 * One of the eight anonymous channels, so no token and no session. Published
 * shape, from `streams.json`:
 *
 * ```json
 * {"executedAt":"2026-01-01T00:00:00.123456789Z","matchId":"41821",
 *  "price":"101.25","qty":"0.25","side":"BUY","symbol":"BTC-USDT"}
 * ```
 *
 * Kept pure and separate from the socket so the merge — which is where a tape
 * goes wrong — is testable without a browser.
 */

export interface StreamTrade {
  matchId: string;
  side: "buy" | "sell";
  price: string;
  qty: string;
  tsMs: number;
}

export type TradesStreamErrorCode = "not_an_object" | "invalid_field";

export class TradesStreamError extends Error {
  constructor(public readonly code: TradesStreamErrorCode, public readonly field?: string) {
    super(`Trade publication rejected: ${code}${field ? ` (${field})` : ""}`);
    this.name = "TradesStreamError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * RFC3339 with an arbitrary number of fractional digits to epoch milliseconds.
 *
 * `executedAt` carries nanoseconds (`…:00.123456789Z`). `Date.parse` is only
 * defined for milliseconds, and implementations differ on how they truncate
 * extra digits, so the fraction is truncated here rather than trusted. Trading
 * the last six digits of a nanosecond timestamp is harmless — the column that
 * uses it shows milliseconds at best.
 */
export function parseExecutedAt(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/.exec(value);
  if (!match) {
    const fallback = Date.parse(value);
    return Number.isFinite(fallback) ? fallback : null;
  }
  const fraction = (match[2] ?? "").padEnd(3, "0").slice(0, 3);
  const parsed = Date.parse(`${match[1]}.${fraction}Z`);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Validates one publication. `expectedSymbolId` is not available on this payload. */
export function parseMarketTrade(value: unknown): StreamTrade {
  if (!isRecord(value)) throw new TradesStreamError("not_an_object");

  const matchId = value.matchId;
  if (typeof matchId !== "string" || !/^\d+$/.test(matchId)) {
    throw new TradesStreamError("invalid_field", "matchId");
  }

  const price = value.price;
  if (typeof price !== "string" || !/^\d+(?:\.\d+)?$/.test(price)) {
    throw new TradesStreamError("invalid_field", "price");
  }

  const qty = value.qty;
  if (typeof qty !== "string" || !/^\d+(?:\.\d+)?$/.test(qty)) {
    throw new TradesStreamError("invalid_field", "qty");
  }

  const sideRaw = value.side;
  if (typeof sideRaw !== "string") throw new TradesStreamError("invalid_field", "side");
  const side = sideRaw.toUpperCase();
  if (side !== "BUY" && side !== "SELL") {
    throw new TradesStreamError("invalid_field", "side");
  }

  const tsMs = parseExecutedAt(value.executedAt);
  if (tsMs === null) throw new TradesStreamError("invalid_field", "executedAt");

  return { matchId, side: side === "BUY" ? "buy" : "sell", price, qty, tsMs };
}

/**
 * Inserts a trade into a newest-first tape.
 *
 * Dedupe is by `matchId`, not by arrival order: realtime delivery is at-least-
 * once, and reconnects can replay. A tape that shows the same fill twice reads
 * as extra volume, which is the kind of quiet inaccuracy this project treats as
 * a defect rather than a cosmetic issue.
 *
 * `cap` keeps the list bounded; the oldest trades fall off the end.
 */
export function mergeTrade<T extends { matchId: string }>(
  existing: T[],
  incoming: T,
  cap: number,
): T[] {
  const limit = Math.max(1, Math.floor(cap));
  const withoutDuplicate = existing.filter((trade) => trade.matchId !== incoming.matchId);
  return [incoming, ...withoutDuplicate].slice(0, limit);
}

/** Merges many publications, preserving newest-first order. */
export function mergeTrades<T extends { matchId: string }>(
  existing: T[],
  incoming: T[],
  cap: number,
): T[] {
  return incoming.reduce((acc, trade) => mergeTrade(acc, trade, cap), existing);
}
