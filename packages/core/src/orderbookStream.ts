/**
 * Public order-book streaming: the Centrifugo frame layer and the delta merge.
 *
 * Kept pure so the protocol and the book arithmetic can be tested without a
 * socket, a network, or a browser. The transport (native `WebSocket` in the
 * browser, a raw client in the probe) lives elsewhere and knows nothing about
 * books; this module knows nothing about transports.
 *
 * The channel is `public:spot:orderbook:deltas:depth:{depth}:{symbolId}:json`,
 * one of the eight anonymous channels — no token, no session, no key.
 *
 * Two contract facts drive the merge, both straight from `orderbook.v1`:
 *
 *  - **SET semantics per price level.** A delta carries absolute quantities at a
 *    price, not a change to apply. A quantity of zero removes the level.
 *  - **Sequence ranges.** Each delta covers `[bookSeqStart, bookSeqEnd]`. Keep
 *    `bookSeqEnd` as the applied sequence, ignore anything that does not advance
 *    it, and re-snapshot on a gap rather than rendering a book with a hole in it.
 */

export interface BookSide {
  price: string;
  qty: string;
}

export interface StreamBook {
  bids: BookSide[];
  asks: BookSide[];
  bookSeq: string;
}

export interface OrderbookDelta {
  symbolId: number;
  bookSeqStart: string;
  bookSeqEnd: string;
  /** Clear local state before applying. */
  reset: boolean;
  bids: BookSide[];
  asks: BookSide[];
  ts: number | null;
}

export type StreamErrorCode =
  | "not_an_object"
  | "invalid_symbol_id"
  | "invalid_sequence"
  | "invalid_levels"
  | "invalid_level";

export class OrderbookStreamError extends Error {
  constructor(public readonly code: StreamErrorCode) {
    super(`Orderbook stream payload rejected: ${code}`);
    this.name = "OrderbookStreamError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Unsigned integer from a JSON channel.
 *
 * The JSON variant sends `bookSeqEnd` as a number and the Protobuf variant sends
 * a 64-bit value as a decimal string. Both are accepted: a client that only
 * handles one of them works against one transport and silently fails on the
 * other. `Number` is never used for the value itself — book sequences exceed
 * 2^53 in long-lived books, so it is stored as a decimal string throughout.
 */
function unsigned(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value === "string" && /^(?:0|[1-9]\d*)$/.test(value)) return value;
  return null;
}

/** Compares two non-negative decimal integer strings without losing precision. */
export function compareSequence(a: string, b: string): -1 | 0 | 1 {
  const left = a.replace(/^0+(?=\d)/, "");
  const right = b.replace(/^0+(?=\d)/, "");
  if (left.length !== right.length) return left.length < right.length ? -1 : 1;
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Adds one to a decimal integer string, exactly. */
export function incrementSequence(value: string): string {
  const digits = value.replace(/^0+(?=\d)/, "").split("");
  let index = digits.length - 1;
  while (index >= 0) {
    if (digits[index] === "9") {
      digits[index] = "0";
      index -= 1;
      continue;
    }
    digits[index] = String(Number(digits[index]) + 1);
    return digits.join("");
  }
  return `1${digits.join("")}`;
}

function parseLevel(value: unknown): BookSide {
  // `[[price, qty], ...]` with decimal strings. Arrays, not objects, so a
  // rename in the object form cannot silently produce zero-filled books.
  if (!Array.isArray(value) || value.length !== 2) {
    throw new OrderbookStreamError("invalid_level");
  }
  const [rawPrice, rawQty] = value;
  if (typeof rawPrice !== "string" || typeof rawQty !== "string") {
    throw new OrderbookStreamError("invalid_level");
  }
  if (!/^\d+(?:\.\d+)?$/.test(rawPrice) || !/^\d+(?:\.\d+)?$/.test(rawQty)) {
    throw new OrderbookStreamError("invalid_level");
  }
  return { price: rawPrice, qty: rawQty };
}

function parseLevels(value: unknown): BookSide[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new OrderbookStreamError("invalid_levels");
  return value.map(parseLevel);
}

/**
 * Validates one publication payload.
 *
 * `expectedSymbolId` is checked rather than trusted: the channel is per-symbol,
 * but a client that subscribes to two symbols and drops the check will merge one
 * market's deltas into another market's book.
 */
export function parseOrderbookDelta(
  value: unknown,
  expectedSymbolId: number,
): OrderbookDelta {
  if (!isRecord(value)) throw new OrderbookStreamError("not_an_object");

  const rawSymbolId = value.symbolId;
  const symbolId =
    typeof rawSymbolId === "string" && /^\d+$/.test(rawSymbolId)
      ? Number(rawSymbolId)
      : rawSymbolId;
  if (typeof symbolId !== "number" || !Number.isInteger(symbolId)) {
    throw new OrderbookStreamError("invalid_symbol_id");
  }
  if (symbolId !== expectedSymbolId) throw new OrderbookStreamError("invalid_symbol_id");

  const bookSeqStart = unsigned(value.bookSeqStart);
  const bookSeqEnd = unsigned(value.bookSeqEnd);
  if (bookSeqStart === null || bookSeqEnd === null) {
    throw new OrderbookStreamError("invalid_sequence");
  }
  if (compareSequence(bookSeqStart, bookSeqEnd) > 0) {
    throw new OrderbookStreamError("invalid_sequence");
  }

  const ts = typeof value.ts === "number" && Number.isFinite(value.ts) ? value.ts : null;

  return {
    symbolId,
    bookSeqStart,
    bookSeqEnd,
    reset: value.reset === true,
    bids: parseLevels(value.bids),
    asks: parseLevels(value.asks),
    ts,
  };
}

/** Snapshot shape, as `/v1/orderbook/{symbol}` already serves it. */
export function createStreamBook(symbol: {
  bookSeq: string;
  bids: BookSide[];
  asks: BookSide[];
}): StreamBook {
  return {
    bids: sortBids(symbol.bids),
    asks: sortAsks(symbol.asks),
    bookSeq: symbol.bookSeq,
  };
}

function toQuantity(qty: string): number {
  const parsed = Number(qty);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Bids descend: best (highest) price first. */
export function sortBids(levels: BookSide[]): BookSide[] {
  return [...levels].sort((a, b) => Number(b.price) - Number(a.price));
}

/** Asks ascend: best (lowest) price first. */
export function sortAsks(levels: BookSide[]): BookSide[] {
  return [...levels].sort((a, b) => Number(a.price) - Number(b.price));
}

/**
 * Applies SET-semantics levels to one side.
 *
 * A zero quantity deletes the price. Anything else replaces it, including a
 * level that is already present — a delta states the quantity at that price, so
 * "1.5 then 2.5" means 2.5, not 4.
 */
function applyLevels(existing: BookSide[], updates: BookSide[]): BookSide[] {
  if (!updates.length) return existing;
  const byPrice = new Map<string, string>();
  for (const level of existing) {
    const qty = toQuantity(level.qty);
    if (qty > 0) byPrice.set(level.price, level.qty);
  }
  for (const level of updates) {
    if (toQuantity(level.qty) <= 0) byPrice.delete(level.price);
    else byPrice.set(level.price, level.qty);
  }
  return [...byPrice.entries()].map(([price, qty]) => ({ price, qty }));
}

export type ApplyDeltaResult =
  | { status: "applied"; book: StreamBook }
  /** Already reflected in local state; drop it silently. */
  | { status: "stale"; book: StreamBook }
  /** A range is missing; the caller must re-snapshot before applying. */
  | { status: "gap"; book: StreamBook; expected: string; received: string };

/**
 * Merges one delta into the local book.
 *
 * Ordering rules, in priority order:
 *  1. `reset` clears local state, so it is always applied.
 *  2. A delta that does not advance past the current sequence is stale.
 *  3. A delta starting after `current + 1` leaves a hole: report a gap instead
 *     of applying it, because a book with missing updates looks plausible and is
 *     wrong, which is worse than showing nothing.
 */
export function applyOrderbookDelta(
  book: StreamBook,
  delta: OrderbookDelta,
): ApplyDeltaResult {
  if (delta.reset) {
    return {
      status: "applied",
      book: {
        bids: sortBids(applyLevels([], delta.bids)),
        asks: sortAsks(applyLevels([], delta.asks)),
        bookSeq: delta.bookSeqEnd,
      },
    };
  }

  if (compareSequence(delta.bookSeqEnd, book.bookSeq) <= 0) {
    return { status: "stale", book };
  }

  const expected = incrementSequence(book.bookSeq);
  if (compareSequence(delta.bookSeqStart, expected) > 0) {
    return { status: "gap", book, expected, received: delta.bookSeqStart };
  }

  return {
    status: "applied",
    book: {
      bids: sortBids(applyLevels(book.bids, delta.bids)),
      asks: sortAsks(applyLevels(book.asks, delta.asks)),
      bookSeq: delta.bookSeqEnd,
    },
  };
}

/** The channel name for a depth/symbol pair, as published in `streams.json`. */
export function orderbookDeltaChannel(depth: number, symbolId: number): string {
  return `public:spot:orderbook:deltas:depth:${depth}:${symbolId}:json`;
}
