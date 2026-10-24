import {
  absolute,
  add,
  compare,
  divide,
  fromBigInt,
  isZero,
  multiply,
  negate,
  parseDecimal,
  subtract,
  sum,
  type ExactDecimal,
} from "./decimal";
import type { Coverage } from "./coverage";
import { observedMetricEligibility } from "./coverage";

export class AnalyticsError extends Error {
  constructor(readonly code: "INVALID_FILL" | "INVALID_EQUITY" | "UNSORTED_SAMPLES" | "INCOMPATIBLE_DATA", message: string) {
    super(message);
    this.name = "AnalyticsError";
  }
}

export interface BalanceInput {
  asset: string;
  trading: string;
  funding: string;
  reserved?: string;
  available?: string;
}

export function totalBalance(balance: BalanceInput): ExactDecimal {
  // reserved/available are attributes of trading, never additional buckets.
  return add(parseDecimal(balance.trading), parseDecimal(balance.funding));
}

export type FillSide = "BUY" | "SELL";
export type FeeAsset = "BASE" | "QUOTE";

export interface FillInput {
  accountScope: string;
  symbol: string;
  marketSymbol?: string;
  baseAsset: string;
  quoteAsset: string;
  matchId: string;
  orderId: string;
  side: FillSide;
  quantity: string;
  price: string;
  feeMagnitude: string;
  feeAsset: FeeAsset;
  feeIsRebate: boolean;
  timestamp: string;
  lineageId?: string;
  generation?: number;
  isMaker?: boolean;
  referralShare?: string;
}

export interface FillCalculation {
  fill: FillInput;
  notional: ExactDecimal;
  signedFee: ExactDecimal;
  dBase: ExactDecimal;
  dQuote: ExactDecimal;
}

export function calculateFill(fill: FillInput): FillCalculation {
  if (
    !fill ||
    (fill.side !== "BUY" && fill.side !== "SELL") ||
    (fill.feeAsset !== "BASE" && fill.feeAsset !== "QUOTE") ||
    typeof fill.feeIsRebate !== "boolean" ||
    !fill.accountScope ||
    !fill.baseAsset ||
    !fill.quoteAsset ||
    !fill.symbol ||
    !fill.matchId ||
    !fill.orderId
  ) {
    throw new AnalyticsError("INVALID_FILL", "Fill identity, side, assets, or fee asset is invalid.");
  }
  if (fill.side === "SELL" && fill.feeAsset === "BASE") {
    throw new AnalyticsError("INCOMPATIBLE_DATA", "A base-asset fee on a sell needs contract review; it is not silently accepted.");
  }
  const quantity = parseDecimal(fill.quantity);
  const price = parseDecimal(fill.price);
  const feeMagnitude = parseDecimal(fill.feeMagnitude);
  if (compare(quantity, fromBigInt(0n)) < 0 || compare(price, fromBigInt(0n)) < 0 || compare(feeMagnitude, fromBigInt(0n)) < 0) {
    throw new AnalyticsError("INVALID_FILL", "Quantity, price, and fee magnitude must be non-negative.");
  }
  const notional = multiply(quantity, price);
  const signedFee = fill.feeIsRebate ? feeMagnitude : negate(feeMagnitude);
  const baseFromTrade = fill.side === "BUY" ? quantity : negate(quantity);
  const quoteFromTrade = fill.side === "SELL" ? notional : negate(notional);
  const dBase = fill.feeAsset === "BASE" ? add(baseFromTrade, signedFee) : baseFromTrade;
  const dQuote = fill.feeAsset === "QUOTE" ? add(quoteFromTrade, signedFee) : quoteFromTrade;
  return { fill, notional, signedFee, dBase, dQuote };
}

function fingerprint(fill: FillInput): string {
  // IDs and financial fields are compared losslessly; decimal spelling alone
  // does not make two otherwise identical fills a conflict.
  const quantity = parseDecimal(fill.quantity);
  const price = parseDecimal(fill.price);
  const fee = parseDecimal(fill.feeMagnitude);
  return JSON.stringify([
    fill.accountScope,
    fill.symbol,
    fill.baseAsset,
    fill.quoteAsset,
    fill.matchId,
    fill.orderId,
    fill.side,
    quantity.numerator.toString(),
    quantity.denominator.toString(),
    price.numerator.toString(),
    price.denominator.toString(),
    fee.numerator.toString(),
    fee.denominator.toString(),
    fill.feeAsset,
    fill.feeIsRebate,
    fill.timestamp,
    fill.lineageId,
    fill.generation,
    fill.referralShare,
  ]);
}

export interface FillDedupResult {
  rows: FillInput[];
  duplicateRows: number;
  conflictingRows: number;
}

export function deduplicateFills(fills: readonly FillInput[]): FillDedupResult {
  const rows: FillInput[] = [];
  const seen = new Map<string, { index: number; fingerprint: string }>();
  let duplicateRows = 0;
  let conflictingRows = 0;
  for (const fill of fills) {
    const key = JSON.stringify([fill.accountScope, fill.symbol, fill.matchId, fill.orderId]);
    let currentFingerprint: string;
    try {
      currentFingerprint = fingerprint(fill);
    } catch {
      // Keep malformed rows visible for quarantine instead of throwing them
      // away during identity processing.
      currentFingerprint = `invalid:${JSON.stringify(fill)}`;
    }
    const previous = seen.get(key);
    if (!previous) {
      seen.set(key, { index: rows.length, fingerprint: currentFingerprint });
      rows.push(fill);
      continue;
    }
    if (previous.fingerprint === currentFingerprint) {
      duplicateRows += 1;
    } else {
      // Retain the first row for evidence/display, but block affected metrics.
      conflictingRows += 1;
    }
  }
  return { rows, duplicateRows, conflictingRows };
}

export interface AssetValue {
  asset: string;
  value: ExactDecimal;
}

export interface FeeAssetSummary {
  asset: string;
  grossCharges: ExactDecimal;
  grossRebates: ExactDecimal;
  netFees: ExactDecimal;
}

export interface ObservedFillSummary {
  calculations: FillCalculation[];
  quarantined: FillInput[];
  volumeByQuote: AssetValue[];
  baseFlowByAsset: AssetValue[];
  observedNetQuoteFlowByQuote: AssetValue[];
  feesByAsset: FeeAssetSummary[];
  duplicateRows: number;
  conflictingRows: number;
  unknownRows: number;
  droppedRows: 0;
  rowsReceived: number;
  rowsAccepted: number;
  metricLabel: "observed-covered-rows" | "observed-in-loaded-rows" | "observed-metrics-blocked";
  eligible: boolean;
  issues: string[];
}

function addToMap(map: Map<string, ExactDecimal>, asset: string, value: ExactDecimal): void {
  map.set(asset, add(map.get(asset) ?? fromBigInt(0n), value));
}

function mapValues(map: Map<string, ExactDecimal>): AssetValue[] {
  return [...map.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([asset, value]) => ({ asset, value }));
}

export function summarizeFills(
  fills: readonly FillInput[],
  coverage?: Pick<Coverage, "status">,
): ObservedFillSummary {
  const deduped = deduplicateFills(fills);
  const calculations: FillCalculation[] = [];
  const quarantined: FillInput[] = [];
  const issues: string[] = [];
  const volume = new Map<string, ExactDecimal>();
  const baseFlow = new Map<string, ExactDecimal>();
  const quoteFlow = new Map<string, ExactDecimal>();
  const fees = new Map<string, { charges: ExactDecimal; rebates: ExactDecimal }>();

  for (const fill of deduped.rows) {
    try {
      const calculation = calculateFill(fill);
      calculations.push(calculation);
      addToMap(volume, fill.quoteAsset, calculation.notional);
      addToMap(baseFlow, fill.baseAsset, calculation.dBase);
      addToMap(quoteFlow, fill.quoteAsset, calculation.dQuote);
      const feeGroup = fees.get(fill.feeAsset === "BASE" ? fill.baseAsset : fill.quoteAsset) ?? {
        charges: fromBigInt(0n),
        rebates: fromBigInt(0n),
      };
      if (fill.feeIsRebate) feeGroup.rebates = add(feeGroup.rebates, parseDecimal(fill.feeMagnitude));
      else feeGroup.charges = add(feeGroup.charges, parseDecimal(fill.feeMagnitude));
      fees.set(fill.feeAsset === "BASE" ? fill.baseAsset : fill.quoteAsset, feeGroup);
    } catch (error) {
      quarantined.push(fill);
      issues.push(error instanceof Error ? error.message : "Invalid fill row.");
    }
  }
  if (deduped.conflictingRows > 0) issues.push("Conflicting duplicate fills block affected aggregates.");
  const unknownRows = quarantined.length;
  const eligible = deduped.conflictingRows === 0 && unknownRows === 0;
  const status = coverage?.status;
  const metricLabel = !eligible
    ? "observed-metrics-blocked"
    : status === "partial" || status === "stale" || status === "loading"
      ? "observed-in-loaded-rows"
      : "observed-covered-rows";
  return {
    calculations,
    quarantined,
    volumeByQuote: mapValues(volume),
    baseFlowByAsset: mapValues(baseFlow),
    observedNetQuoteFlowByQuote: mapValues(quoteFlow),
    feesByAsset: [...fees.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([asset, group]) => ({
        asset,
        grossCharges: group.charges,
        grossRebates: group.rebates,
        netFees: subtract(group.charges, group.rebates),
      })),
    duplicateRows: deduped.duplicateRows,
    conflictingRows: deduped.conflictingRows,
    unknownRows,
    droppedRows: 0,
    rowsReceived: fills.length,
    rowsAccepted: calculations.length,
    metricLabel,
    eligible,
    issues,
  };
}

export function observedFillEligibility(
  summary: ObservedFillSummary,
  coverage: Coverage,
): { available: boolean; reason?: string } {
  if (!summary.eligible) return { available: false, reason: "Fill conflicts or unknown rows block this aggregate." };
  return observedMetricEligibility({
    ...coverage,
    rowsReceived: summary.rowsReceived,
    rowsAccepted: summary.rowsAccepted,
    duplicateRows: summary.duplicateRows,
    conflictingRows: summary.conflictingRows,
    unknownRows: summary.unknownRows,
    droppedRows: summary.droppedRows,
  });
}

export interface EquitySample {
  timestamp: string;
  equity: string;
}

export interface SampledEquityMetrics {
  label: "sampled-valuation-not-pnl";
  sampleCount: number;
  latest?: ExactDecimal;
  start?: ExactDecimal;
  change?: ExactDecimal;
  changePercent?: ExactDecimal;
  maxDrawdownAbsolute?: ExactDecimal;
  maxDrawdownPercent?: ExactDecimal;
}

function timestampValue(timestamp: string): bigint {
  if (!/^\d+$/.test(timestamp)) {
    throw new AnalyticsError("INVALID_EQUITY", "Sample timestamps must retain an exact numeric representation for ordering.");
  }
  return BigInt(timestamp);
}

export function sampledEquityMetrics(samples: readonly EquitySample[]): SampledEquityMetrics {
  if (samples.length === 0) return { label: "sampled-valuation-not-pnl", sampleCount: 0 };
  const values = samples.map((sample) => ({
    timestamp: sample.timestamp,
    time: timestampValue(sample.timestamp),
    equity: parseDecimal(sample.equity),
  }));
  for (let index = 1; index < values.length; index++) {
    if (values[index].time <= values[index - 1].time) {
      throw new AnalyticsError("UNSORTED_SAMPLES", "Equity samples must be strictly chronological; no ordering was invented.");
    }
  }
  const first = values[0].equity;
  const latest = values[values.length - 1].equity;
  const result: SampledEquityMetrics = {
    label: "sampled-valuation-not-pnl",
    sampleCount: values.length,
    latest,
    start: first,
  };
  if (values.length > 1) {
    const change = subtract(latest, first);
    result.change = change;
    if (compare(first, fromBigInt(0n)) > 0) {
      result.changePercent = multiply(divide(change, first), fromBigInt(100n));
    }
  }
  let peak = first;
  let maxAbsolute: ExactDecimal | undefined;
  let maxPercent: ExactDecimal | undefined;
  for (const value of values) {
    if (compare(value.equity, peak) > 0) peak = value.equity;
    const drawdown = subtract(peak, value.equity);
    if (!maxAbsolute || compare(drawdown, maxAbsolute) > 0) maxAbsolute = drawdown;
    if (compare(peak, fromBigInt(0n)) > 0) {
      const percent = multiply(divide(drawdown, peak), fromBigInt(100n));
      if (!maxPercent || compare(percent, maxPercent) > 0) maxPercent = percent;
    }
  }
  result.maxDrawdownAbsolute = maxAbsolute;
  result.maxDrawdownPercent = maxPercent;
  return result;
}

export function currentRateScenario(
  notional: ExactDecimal,
  makerPercent: ExactDecimal,
  takerPercent: ExactDecimal,
): { makerEstimate: ExactDecimal; takerEstimate: ExactDecimal; label: "current-rate-scenario-not-historical-fee" } {
  return {
    makerEstimate: divide(multiply(notional, makerPercent), fromBigInt(100n)),
    takerEstimate: divide(multiply(notional, takerPercent), fromBigInt(100n)),
    label: "current-rate-scenario-not-historical-fee",
  };
}

export function sumExact(values: readonly ExactDecimal[]): ExactDecimal {
  return sum(values);
}

export function isExactZero(value: ExactDecimal): boolean {
  return isZero(value);
}

export function absoluteExact(value: ExactDecimal): ExactDecimal {
  return absolute(value);
}
