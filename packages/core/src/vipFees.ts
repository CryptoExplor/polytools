/**
 * The public VIP fee schedule — `GET /v1/vip/tiers`
 * (`vip.v1.VIPService/ListVIPTiers`).
 *
 * This is the venue's own cost curve: VIP0 through VIP10, with the rolling
 * 30-day volume and average-portfolio-value thresholds that unlock each row.
 * It is public — no API key, no session, no wallet — and it is published as a
 * complete immutable policy version rather than a diff, so a cached copy can be
 * labelled with the version it actually came from.
 *
 * Two honesty rules are baked into the types, because both are easy to get
 * wrong in a UI that wants tidy numbers:
 *
 *  - `makerFeeRatePercent` and `takerFeeRatePercent` are *absolute rates before
 *    symbol-specific adjustments*. A pair can carry its own modifier, so these
 *    are the baseline a trader starts from, never the rate a specific fill paid.
 *    The per-fill rate lives in account activity, not here.
 *  - VIP0 has no average-portfolio-value threshold. Absence is `null` and is
 *    never coerced to `0`, because "no threshold" and "a zero threshold" are
 *    different claims and only the first one is true.
 */

/** A single row of the catalog. */
export interface VipTier {
  /** Numeric tier, 0 through 10. */
  tier: number;
  /** Rolling 30-day settled spot volume entry threshold, USD decimal string. */
  volumeThresholdUsd: string;
  /** Average portfolio value entry threshold, USD. `null` for VIP0. */
  aopThresholdUsd: string | null;
  /** Absolute maker rate as a percentage string, before pair adjustments. */
  makerFeeRatePercent: string;
  /** Absolute taker rate as a percentage string, before pair adjustments. */
  takerFeeRatePercent: string;
}

/** One complete, immutable policy version. */
export interface VipFeeSchedule {
  /** Positive integer policy version, as a decimal string (uint64 on the wire). */
  policyVersion: string;
  /** ISO-8601 timestamp at which this version became effective. */
  effectiveFrom: string;
  /** Average-portfolio-value retention threshold in basis points. */
  retentionThresholdBp: number;
  /** Rows ordered by tier ascending. */
  tiers: VipTier[];
}

export type VipFeeScheduleParseError =
  | "not_an_object"
  | "invalid_policy_version"
  | "invalid_effective_from"
  | "invalid_retention_threshold"
  | "invalid_tiers"
  | "invalid_tier_row";

export class VipFeeScheduleError extends Error {
  constructor(public readonly code: VipFeeScheduleParseError) {
    super(`VIP fee schedule rejected: ${code}`);
    this.name = "VipFeeScheduleError";
  }
}

/**
 * Base-10 decimal, optionally negative.
 *
 * Maker rates may legitimately be negative (a rebate): the contract allows
 * -100 through 100 for maker and 0 through 100 for taker. A single shared regex
 * would either reject a valid rebate or accept a nonsensical negative taker fee,
 * so the two are checked separately.
 */
const SIGNED_DECIMAL = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const UNSIGNED_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const UNSIGNED_INTEGER = /^(?:0|[1-9]\d*)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decimal(value: unknown, pattern: RegExp): string | null {
  return typeof value === "string" && pattern.test(value) ? value : null;
}

function parseTierRow(value: unknown, expectedTier: number): VipTier {
  if (!isRecord(value)) throw new VipFeeScheduleError("invalid_tier_row");

  // ProtoJSON omits default values, so the VIP0 row carries no `tier` key at
  // all. Treating that as malformed would reject the real, live response — the
  // absence *is* the zero, and position is what pins it.
  const tier = value.tier === undefined && expectedTier === 0 ? 0 : value.tier;
  if (typeof tier !== "number" || !Number.isInteger(tier) || tier !== expectedTier) {
    throw new VipFeeScheduleError("invalid_tier_row");
  }
  if (tier < 0 || tier > 10) throw new VipFeeScheduleError("invalid_tier_row");

  const volumeThresholdUsd = decimal(value.volumeThresholdUsd, UNSIGNED_DECIMAL);
  if (volumeThresholdUsd === null) throw new VipFeeScheduleError("invalid_tier_row");

  // Optional on the wire: omitted for VIP0, and omitted is meaningful.
  let aopThresholdUsd: string | null = null;
  if (value.aopThresholdUsd !== undefined && value.aopThresholdUsd !== null) {
    aopThresholdUsd = decimal(value.aopThresholdUsd, UNSIGNED_DECIMAL);
    if (aopThresholdUsd === null) throw new VipFeeScheduleError("invalid_tier_row");
  }

  const makerFeeRatePercent = decimal(value.makerFeeRatePercent, SIGNED_DECIMAL);
  if (makerFeeRatePercent === null) throw new VipFeeScheduleError("invalid_tier_row");

  const takerFeeRatePercent = decimal(value.takerFeeRatePercent, UNSIGNED_DECIMAL);
  if (takerFeeRatePercent === null) throw new VipFeeScheduleError("invalid_tier_row");

  return {
    tier,
    volumeThresholdUsd,
    aopThresholdUsd,
    makerFeeRatePercent,
    takerFeeRatePercent,
  };
}

/**
 * Validates a `/v1/vip/tiers` body.
 *
 * Rows must be contiguous from tier 0 and ascending. That is stricter than
 * "eleven rows" on purpose: if the exchange ever extends the catalog, a
 * contiguous prefix still renders correctly instead of the UI quietly dropping
 * or reordering a row.
 */
export function parseVipFeeSchedule(value: unknown): VipFeeSchedule {
  if (!isRecord(value)) throw new VipFeeScheduleError("not_an_object");

  const policyVersion = decimal(value.policyVersion, UNSIGNED_INTEGER);
  if (policyVersion === null || policyVersion === "0") {
    throw new VipFeeScheduleError("invalid_policy_version");
  }

  const effectiveFrom = value.effectiveFrom;
  if (
    typeof effectiveFrom !== "string" ||
    !Number.isFinite(Date.parse(effectiveFrom))
  ) {
    throw new VipFeeScheduleError("invalid_effective_from");
  }

  const retentionThresholdBp = value.retentionThresholdBp;
  if (
    typeof retentionThresholdBp !== "number" ||
    !Number.isInteger(retentionThresholdBp) ||
    retentionThresholdBp < 1 ||
    retentionThresholdBp > 10_000
  ) {
    throw new VipFeeScheduleError("invalid_retention_threshold");
  }

  const rows = value.tiers;
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new VipFeeScheduleError("invalid_tiers");
  }

  const tiers = rows.map((row, index) => parseTierRow(row, index));
  return { policyVersion, effectiveFrom, retentionThresholdBp, tiers };
}

/** Percent string to a number, or `null` when it is not a decimal string. */
export function percentValue(value: string): number | null {
  if (!SIGNED_DECIMAL.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Renders a percentage string with significant decimals only.
 *
 * `0.150000000` becomes `0.15%`, and `0.005000000` becomes `0.005%` — a fixed
 * two-decimal cut would flatten VIP10's maker rate of 0.005% to a flat `0.01`,
 * inventing a 100% overcharge on the best tier in the catalog.
 */
export function formatPercent(value: string): string | null {
  const parsed = percentValue(value);
  if (parsed === null) return null;
  const fixed = parsed.toFixed(6).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return `${fixed}%`;
}

/** Renders a USD decimal string with grouping, dropping trailing zeros. */
export function formatUsdThreshold(value: string | null): string | null {
  if (value === null || !UNSIGNED_DECIMAL.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `$${grouped}${trimmedFraction ? `.${trimmedFraction}` : ""}`;
}
