export type CoverageStatus =
  | "loading"
  | "complete"
  | "filter-complete"
  | "partial"
  | "stale"
  | "denied"
  | "blocked"
  | "unavailable";

export type BasisStatus = "proven-zero" | "supplied" | "carried-forward" | "unknown" | "not-required";
export type FlowStatus = "resolved" | "unresolved" | "not-required";

export interface Coverage {
  operation: string;
  contractVersion: string;
  /** Non-identifying local label; never a raw account/subaccount ID. */
  scopeLabel: string;
  filters: Record<string, string | number | boolean | string[]>;
  status: CoverageStatus;
  pagesFetched: number;
  rowsReceived: number;
  rowsAccepted: number;
  duplicateRows: number;
  conflictingRows: number;
  unknownRows: number;
  droppedRows: number;
  cursorExhausted: boolean;
  stoppedAtCap: boolean;
  openingBasis: BasisStatus;
  nonFillFlows: FlowStatus;
  requestedStart?: string;
  requestedEnd?: string;
  observedStart?: string;
  observedEnd?: string;
  retrievedAtMs?: number;
}

export function emptyCoverage(
  operation: string,
  contractVersion: string,
  scopeLabel = "Main account",
): Coverage {
  return {
    operation,
    contractVersion,
    scopeLabel,
    filters: {},
    status: "loading",
    pagesFetched: 0,
    rowsReceived: 0,
    rowsAccepted: 0,
    duplicateRows: 0,
    conflictingRows: 0,
    unknownRows: 0,
    droppedRows: 0,
    cursorExhausted: false,
    stoppedAtCap: false,
    openingBasis: "unknown",
    nonFillFlows: "unresolved",
  };
}

export function rowsReconcile(coverage: Coverage): boolean {
  return (
    coverage.rowsReceived ===
    coverage.rowsAccepted +
      coverage.duplicateRows +
      coverage.conflictingRows +
      coverage.unknownRows +
      coverage.droppedRows
  );
}

export function hasCleanRowCoverage(coverage: Coverage): boolean {
  return (
    rowsReconcile(coverage) &&
    coverage.conflictingRows === 0 &&
    coverage.unknownRows === 0 &&
    coverage.droppedRows === 0
  );
}

export function isFilterComplete(coverage: Coverage): boolean {
  return (
    (coverage.status === "complete" || coverage.status === "filter-complete") &&
    coverage.cursorExhausted &&
    coverage.pagesFetched > 0 &&
    !coverage.stoppedAtCap &&
    hasCleanRowCoverage(coverage)
  );
}

export interface MetricEligibility {
  available: boolean;
  reason?: string;
}

export function observedMetricEligibility(coverage: Coverage): MetricEligibility {
  if (
    coverage.status === "loading" ||
    coverage.status === "denied" ||
    coverage.status === "blocked" ||
    coverage.status === "unavailable"
  ) {
    return { available: false, reason: "Dataset is unavailable; unknown is not zero." };
  }
  if (!hasCleanRowCoverage(coverage)) {
    return { available: false, reason: "Unknown, conflicting, or dropped rows block this aggregate." };
  }
  if (coverage.rowsAccepted === 0 && coverage.rowsReceived > 0) {
    return { available: false, reason: "No validated rows are available for this aggregate." };
  }
  return { available: true };
}

export function completeMetricEligibility(coverage: Coverage): MetricEligibility {
  const observed = observedMetricEligibility(coverage);
  if (!observed.available) return observed;
  if (!isFilterComplete(coverage)) {
    return { available: false, reason: "The cursor chain or required row coverage is incomplete." };
  }
  return { available: true };
}

/** P&L has deliberately stricter gates than observed activity metrics. */
export function pnlEligibility(
  coverage: Coverage,
  options: { quoteAssets?: readonly string[]; freshMark?: boolean } = {},
): MetricEligibility {
  const complete = completeMetricEligibility(coverage);
  if (!complete.available) return { available: false, reason: complete.reason };
  if (coverage.openingBasis === "unknown" || coverage.openingBasis === "not-required") {
    return { available: false, reason: "Opening inventory and cost basis are not established." };
  }
  if (coverage.nonFillFlows !== "resolved" && coverage.nonFillFlows !== "not-required") {
    return { available: false, reason: "Non-fill inventory flows are unresolved." };
  }
  if (options.quoteAssets && options.quoteAssets.length !== 1) {
    return { available: false, reason: "P&L needs one quote asset or a documented historical FX model." };
  }
  if (options.freshMark === false) {
    return { available: false, reason: "A fresh labeled valuation mark is required for unrealized P&L." };
  }
  return { available: true };
}
