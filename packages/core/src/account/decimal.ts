/** Zero-dependency exact decimal/rational arithmetic for friendly REST values. */

export interface ExactDecimal {
  /** Canonical exact value where finite; sourceRaw retains the received string. */
  readonly raw: string;
  readonly sourceRaw: string;
  readonly numerator: bigint;
  readonly denominator: bigint;
  readonly toJSON?: () => { raw: string; sourceRaw: string; numerator: string; denominator: string };
}

export class DecimalError extends Error {
  constructor(readonly code: "INVALID_DECIMAL" | "DIVIDE_BY_ZERO" | "NON_TERMINATING" | "RESOURCE_LIMIT", message: string) {
    super(message);
    this.name = "DecimalError";
  }
}

const MAX_INPUT_DIGITS = 256;
const MAX_FRACTION_DIGITS = 128;
const MAX_VALUE_BITS = 8192;

function bitLength(value: bigint): number {
  return (value < 0n ? -value : value).toString(2).length;
}

function gcd(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a || 1n;
}

function checkSize(numerator: bigint, denominator: bigint): void {
  if (bitLength(numerator) > MAX_VALUE_BITS || bitLength(denominator) > MAX_VALUE_BITS) {
    throw new DecimalError("RESOURCE_LIMIT", "Exact decimal resource limit exceeded.");
  }
}

export function decimalToString(value: ExactDecimal): string {
  let denominator = value.denominator;
  let twos = 0;
  let fives = 0;
  while (denominator % 2n === 0n) {
    denominator /= 2n;
    twos += 1;
  }
  while (denominator % 5n === 0n) {
    denominator /= 5n;
    fives += 1;
  }
  if (denominator !== 1n) {
    throw new DecimalError("NON_TERMINATING", "This rational has no finite decimal representation.");
  }
  const scale = Math.max(twos, fives);
  // To obtain denominator 10^scale, multiply by
  // 2^(scale-twos) * 5^(scale-fives), without intermediate rounding.
  const numerator = value.numerator * 2n ** BigInt(scale - twos) * 5n ** BigInt(scale - fives);
  const negative = numerator < 0n;
  let digits = (negative ? -numerator : numerator).toString().padStart(scale + 1, "0");
  if (scale > 0) digits = `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
  digits = digits.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  if (/^0(?:\.0+)?$/.test(digits)) return "0";
  return `${negative ? "-" : ""}${digits}`;
}

function make(numeratorInput: bigint, denominatorInput: bigint, sourceRaw?: string): ExactDecimal {
  if (denominatorInput === 0n) throw new DecimalError("DIVIDE_BY_ZERO", "Exact division by zero.");
  let numerator = numeratorInput;
  let denominator = denominatorInput;
  if (denominator < 0n) {
    numerator = -numerator;
    denominator = -denominator;
  }
  const divisor = gcd(numerator, denominator);
  numerator /= divisor;
  denominator /= divisor;
  if (numerator === 0n) {
    numerator = 0n;
    denominator = 1n;
  }
  checkSize(numerator, denominator);
  const provisional = { numerator, denominator } as ExactDecimal;
  let raw = "0";
  if (numerator !== 0n) {
    try {
      raw = decimalToString(provisional);
    } catch (error) {
      if (error instanceof DecimalError && error.code === "NON_TERMINATING") {
        raw = `${numerator}/${denominator}`;
      } else {
        throw error;
      }
    }
  }
  const result = {
    raw,
    sourceRaw: sourceRaw ?? raw,
    numerator,
    denominator,
  } as ExactDecimal;
  Object.defineProperty(result, "toJSON", {
    enumerable: false,
    value: () => ({
      raw: result.raw,
      sourceRaw: result.sourceRaw,
      numerator: result.numerator.toString(),
      denominator: result.denominator.toString(),
    }),
  });
  return Object.freeze(result);
}

export function parseDecimal(raw: string): ExactDecimal {
  if (
    typeof raw !== "string" ||
    raw.length === 0 ||
    raw.length > MAX_INPUT_DIGITS + MAX_FRACTION_DIGITS + 4 ||
    raw !== raw.trim() ||
    !/^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)
  ) {
    throw new DecimalError("INVALID_DECIMAL", "Expected a base-10 decimal string without exponent notation.");
  }
  const negative = raw.startsWith("-");
  const unsigned = negative ? raw.slice(1) : raw;
  const [integerPart, fractionPart = ""] = unsigned.split(".");
  const digits = `${integerPart}${fractionPart}`.replace(/^0+(?=\d)/, "");
  if (digits.length > MAX_INPUT_DIGITS || fractionPart.length > MAX_FRACTION_DIGITS) {
    throw new DecimalError("RESOURCE_LIMIT", "Decimal input exceeds the configured precision limit.");
  }
  const numerator = BigInt(`${negative ? "-" : ""}${digits || "0"}`);
  return make(numerator, 10n ** BigInt(fractionPart.length), raw);
}

export function fromBigInt(value: bigint): ExactDecimal {
  return make(value, 1n);
}

export function add(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  return make(left.numerator * right.denominator + right.numerator * left.denominator, left.denominator * right.denominator);
}

export function subtract(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  return make(left.numerator * right.denominator - right.numerator * left.denominator, left.denominator * right.denominator);
}

export function multiply(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  return make(left.numerator * right.numerator, left.denominator * right.denominator);
}

export function divide(left: ExactDecimal, right: ExactDecimal): ExactDecimal {
  if (right.numerator === 0n) throw new DecimalError("DIVIDE_BY_ZERO", "Exact division by zero.");
  return make(left.numerator * right.denominator, left.denominator * right.numerator);
}

export function negate(value: ExactDecimal): ExactDecimal {
  return make(-value.numerator, value.denominator);
}

export function absolute(value: ExactDecimal): ExactDecimal {
  return value.numerator < 0n ? negate(value) : value;
}

export function compare(left: ExactDecimal, right: ExactDecimal): number {
  const difference = left.numerator * right.denominator - right.numerator * left.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export function isZero(value: ExactDecimal): boolean {
  return value.numerator === 0n;
}

export function sum(values: readonly ExactDecimal[]): ExactDecimal {
  return values.reduce((total, value) => add(total, value), fromBigInt(0n));
}

export function percentToRatio(percent: ExactDecimal): ExactDecimal {
  return divide(percent, fromBigInt(100n));
}

/** Presentation-only half-even rounding; never used to update financial state. */
export function formatDecimal(value: ExactDecimal, fractionDigits = 8, trim = true): string {
  if (!Number.isInteger(fractionDigits) || fractionDigits < 0 || fractionDigits > MAX_FRACTION_DIGITS) {
    throw new DecimalError("INVALID_DECIMAL", "Invalid presentation precision.");
  }
  const negative = value.numerator < 0n;
  const numerator = negative ? -value.numerator : value.numerator;
  const scale = 10n ** BigInt(fractionDigits);
  const scaled = numerator * scale;
  let quotient = scaled / value.denominator;
  const remainder = scaled % value.denominator;
  const twice = remainder * 2n;
  if (twice > value.denominator || (twice === value.denominator && quotient % 2n === 1n)) {
    quotient += 1n;
  }
  let digits = quotient.toString().padStart(fractionDigits + 1, "0");
  if (fractionDigits > 0) digits = `${digits.slice(0, -fractionDigits)}.${digits.slice(-fractionDigits)}`;
  if (trim) digits = digits.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  if (/^0(?:\.0+)?$/.test(digits)) return "0";
  return `${negative ? "-" : ""}${digits}`;
}
