/**
 * Order-draft validation for the SDK quickstart snippets.
 *
 * The quickstart generator interpolates a quantity and a limit price into
 * runnable code. Those values must be provably legal for the selected pair
 * before a snippet is shown, so this module works in exact decimal strings
 * (integer arithmetic, never float rounding) and reports every problem with
 * the constraint it violates.
 *
 * Scope: validation and display only. Nothing here sends a request, and no
 * value is rounded unless the caller explicitly asks for tick rounding.
 */

export interface PairConstraints {
  tickSize: string;
  stepSize: string;
  minQtyBase?: string;
  minNotionalQuote?: string;
}

export type OrderIssueField = "pair" | "qty" | "price" | "notional";

export interface OrderIssue {
  field: OrderIssueField;
  message: string;
}

export interface OrderValidation {
  ok: boolean;
  issues: OrderIssue[];
  /** qty × price as an exact decimal string, when both sides parsed. */
  notional: string | null;
}

export interface OrderDraftInput {
  qty: string;
  price: string;
  pair?: PairConstraints | null;
  base?: string;
  quote?: string;
}

const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/;

interface Scaled {
  units: bigint;
  scale: number;
}

/** Parse a plain non-negative decimal ("0.001", "50000"). Rejects signs, exponents, commas. */
export function parseDecimal(value: string): Scaled | null {
  const trimmed = value.trim();
  if (!DECIMAL_PATTERN.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  return {
    units: BigInt(`${whole}${fraction}` || "0"),
    scale: fraction.length,
  };
}

/** Decimal places actually used, ignoring trailing zeros ("0.0010" → 3). */
export function decimalPlaces(value: string): number | null {
  const parsed = parseDecimal(value);
  if (!parsed) return null;
  let { units, scale } = parsed;
  while (scale > 0 && units % 10n === 0n) {
    units /= 10n;
    scale -= 1;
  }
  return scale;
}

function scaleTo(target: number, value: Scaled): bigint {
  return value.units * 10n ** BigInt(target - value.scale);
}

function align(a: Scaled, b: Scaled): { a: bigint; b: bigint; scale: number } {
  const scale = Math.max(a.scale, b.scale);
  return { a: scaleTo(scale, a), b: scaleTo(scale, b), scale };
}

/** -1 / 0 / 1 for two plain decimals, or null when either fails to parse. */
export function compareDecimal(left: string, right: string): number | null {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  if (!a || !b) return null;
  const aligned = align(a, b);
  if (aligned.a === aligned.b) return 0;
  return aligned.a < aligned.b ? -1 : 1;
}

/** Exact qty × price. Returns null when either side fails to parse. */
export function multiplyDecimal(left: string, right: string): string | null {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  if (!a || !b) return null;
  return formatScaled(a.units * b.units, a.scale + b.scale);
}

/** True when `value` is an exact multiple of `step`; null when either is not a decimal. */
export function isMultipleOf(value: string, step: string): boolean | null {
  const a = parseDecimal(value);
  const b = parseDecimal(step);
  if (!a || !b) return null;
  if (b.units === 0n) return null;
  const aligned = align(a, b);
  return aligned.a % aligned.b === 0n;
}

function formatScaled(units: bigint, scale: number): string {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, digits.length - scale);
  const fraction = scale === 0 ? "" : digits.slice(digits.length - scale);
  const trimmedFraction = fraction.replace(/0+$/, "");
  const body = trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
  return negative ? `-${body}` : body;
}

/**
 * Round a numeric price to a legal tick multiple.
 * `down` is used for buy limits (stays below the market), `up` for sells.
 * Returns null when the tick size is missing or unusable.
 */
export function roundToTick(
  value: number,
  tickSize: string,
  mode: "down" | "up" = "down",
): string | null {
  if (!isFinite(value) || value <= 0) return null;
  const tick = parseDecimal(tickSize);
  if (!tick || tick.units === 0n) return null;
  // Keep the scaling inside the safe-integer range; a tick with more than 12
  // decimals is not a tick size this UI can present honestly.
  if (tick.scale > 12) return null;
  const scaled = value * 10 ** tick.scale;
  if (!isFinite(scaled) || Math.abs(scaled) > Number.MAX_SAFE_INTEGER) return null;
  // Prices arrive as decoded floats, so allow a hair of slack before stepping.
  const units = BigInt(mode === "up" ? Math.ceil(scaled - 1e-7) : Math.floor(scaled + 1e-7));
  const remainder = units % tick.units;
  const count = remainder === 0n ? units / tick.units : units / tick.units + 1n;
  return formatScaled(count * tick.units, tick.scale);
}

function hasIssue(issues: OrderIssue[], field: OrderIssueField): boolean {
  return issues.some((issue) => issue.field === field);
}

/**
 * Validate one order draft against the pair's published constraints.
 * Every problem is reported, not just the first, and the messages name the
 * constraint so a user can fix the input without reading the footer.
 */
export function validateOrderDraft(input: OrderDraftInput): OrderValidation {
  const issues: OrderIssue[] = [];
  const qty = input.qty.trim();
  const price = input.price.trim();
  const pair = input.pair ?? null;
  const base = input.base ?? "base";
  const quote = input.quote ?? "quote";

  if (!pair) {
    issues.push({
      field: "pair",
      message:
        "This market's tick size, step size, and minimums are not loaded, so an order snippet cannot be validated. Pick a listed market first.",
    });
  }

  if (!qty) {
    issues.push({ field: "qty", message: "Enter a quantity." });
  } else if (!parseDecimal(qty)) {
    issues.push({
      field: "qty",
      message: "Quantity must be a plain number, for example 0.001.",
    });
  } else if (compareDecimal(qty, "0") === 0) {
    issues.push({ field: "qty", message: "Quantity must be greater than zero." });
  }

  if (!price) {
    issues.push({ field: "price", message: "Enter a limit price." });
  } else if (!parseDecimal(price)) {
    issues.push({
      field: "price",
      message: "Price must be a plain number, for example 50000.5.",
    });
  } else if (compareDecimal(price, "0") === 0) {
    issues.push({ field: "price", message: "Price must be greater than zero." });
  }

  if (pair) {
    const stepDecimals = decimalPlaces(pair.stepSize);
    const tickDecimals = decimalPlaces(pair.tickSize);

    if (qty && parseDecimal(qty) && compareDecimal(qty, "0") === 1) {
      if (stepDecimals !== null && decimalPlaces(qty) !== null && (decimalPlaces(qty) as number) > stepDecimals) {
        issues.push({
          field: "qty",
          message: `Quantity supports at most ${stepDecimals} decimal place${stepDecimals === 1 ? "" : "s"} for ${base} (stepSize ${pair.stepSize}).`,
        });
      } else if (isMultipleOf(qty, pair.stepSize) === false) {
        issues.push({
          field: "qty",
          message: `Quantity must be a multiple of ${pair.stepSize} ${base} (the pair's stepSize).`,
        });
      }
      if (pair.minQtyBase && compareDecimal(pair.minQtyBase, "0") === 1 && compareDecimal(qty, pair.minQtyBase) === -1) {
        issues.push({
          field: "qty",
          message: `Quantity is below this pair's minimum of ${pair.minQtyBase} ${base}.`,
        });
      }
    }

    if (price && parseDecimal(price) && compareDecimal(price, "0") === 1) {
      if (tickDecimals !== null && decimalPlaces(price) !== null && (decimalPlaces(price) as number) > tickDecimals) {
        issues.push({
          field: "price",
          message: `Price supports at most ${tickDecimals} decimal place${tickDecimals === 1 ? "" : "s"} for ${quote} (tickSize ${pair.tickSize}).`,
        });
      } else if (isMultipleOf(price, pair.tickSize) === false) {
        issues.push({
          field: "price",
          message: `Price must be a multiple of ${pair.tickSize} ${quote} (the pair's tickSize).`,
        });
      }
    }
  }

  const notional =
    parseDecimal(qty) && parseDecimal(price) && compareDecimal(qty, "0") === 1 && compareDecimal(price, "0") === 1
      ? multiplyDecimal(qty, price)
      : null;

  if (
    notional &&
    pair?.minNotionalQuote &&
    compareDecimal(pair.minNotionalQuote, "0") === 1 &&
    compareDecimal(notional, pair.minNotionalQuote) === -1
  ) {
    issues.push({
      field: "notional",
      message: `Order value ${notional} ${quote} is below this pair's minimum notional of ${pair.minNotionalQuote} ${quote}.`,
    });
  }

  // One message per field is enough to act on; keep the first for each.
  const deduped: OrderIssue[] = [];
  for (const issue of issues) {
    if (!hasIssue(deduped, issue.field)) deduped.push(issue);
  }

  return { ok: deduped.length === 0, issues: deduped, notional };
}
