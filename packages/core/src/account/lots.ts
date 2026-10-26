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
  type ExactDecimal,
} from "./decimal";
import { calculateFill, type FillCalculation, type FillInput } from "./analytics";
import {
  completeMetricEligibility,
  pnlEligibility,
  type BasisStatus,
  type Coverage,
  type FlowStatus,
} from "./coverage";

export type CostBasisMethod = "FIFO" | "WEIGHTED_AVERAGE";
export type ValuationMarkKind = "last" | "mid" | "other";

export interface CostBasisIdentity {
  /** In-memory partition only; never include this value in exports or display. */
  accountScope: string;
  baseAsset: string;
  quoteAsset: string;
}

export interface OpeningLotInput extends CostBasisIdentity {
  quantity: string;
  /** Total exact cost for the whole lot, not a unit price. */
  cost: string;
  acquiredAt: string;
  provenance: string;
  basisStatus?: "supplied" | "carried-forward";
}

export interface OpeningZeroInput extends CostBasisIdentity {
  at: string;
  provenance: string;
  /** Zero is proven only from complete history since account inception. */
  fromInception: true;
}

interface FlowIdentity extends CostBasisIdentity {
  timestamp: string;
  provenance: string;
}

export interface FlowAcquisitionInput extends FlowIdentity {
  kind: "acquisition";
  quantity: string;
  /** Total documented basis carried in by this non-fill acquisition. */
  cost: string;
}

export interface NonTradeDisposalInput extends FlowIdentity {
  kind: "non-trade-disposal";
  quantity: string;
}

export interface InternalTransferOutInput extends FlowIdentity {
  kind: "internal-transfer-out";
  quantity: string;
  targetScope: string;
  linkKey: string;
}

export interface InternalTransferInInput extends FlowIdentity {
  kind: "internal-transfer-in";
  quantity: string;
  sourceScope: string;
  linkKey: string;
}

export type ResolvedCostBasisFlow =
  | FlowAcquisitionInput
  | NonTradeDisposalInput
  | InternalTransferOutInput
  | InternalTransferInInput;

export interface CostBasisFlowResolution {
  /** Complete transfer coverage is required even when every row was excluded as a fill leg. */
  coverage: Coverage;
  requiredCount: number;
  resolvedCount: number;
  events: readonly ResolvedCostBasisFlow[];
  issues?: readonly string[];
}

export interface ValuationMarkInput extends CostBasisIdentity {
  price: string;
  source: string;
  kind: ValuationMarkKind;
  timestamp: string;
}

export interface CostBasisAnalysisOptions {
  method: CostBasisMethod;
  openingLots?: readonly OpeningLotInput[];
  openingZero?: readonly OpeningZeroInput[];
  fills: readonly FillInput[];
  fillCoverage: Coverage;
  flowResolution: CostBasisFlowResolution;
  marks?: readonly ValuationMarkInput[];
  nowMs?: number;
  maxMarkAgeMs?: number;
}

export interface CostBasisLedgerResult extends CostBasisIdentity {
  method: CostBasisMethod;
  openingBasis: BasisStatus;
  nonFillFlows: FlowStatus;
  requestedStart: string;
  requestedEnd: string;
  realizedAvailable: boolean;
  realizedPnl: ExactDecimal | null;
  remainingQuantity: ExactDecimal | null;
  remainingCost: ExactDecimal | null;
  nonTradeRemovedCost: ExactDecimal | null;
  unrealizedAvailable: boolean;
  marketValue: ExactDecimal | null;
  unrealizedPnl: ExactDecimal | null;
  totalPnl: ExactDecimal | null;
  markStatus: "fresh" | "missing" | "stale" | "conflicting";
  markSource: string | null;
  markKind: ValuationMarkKind | null;
  markTimestamp: string | null;
  openingLotCount: number;
  openingCost: ExactDecimal;
  fillCount: number;
  resolvedFlowCount: number;
  issues: string[];
}

export class CostBasisError extends Error {
  constructor(
    readonly code: "INVALID_INPUT" | "WINDOW_REQUIRED" | "INVENTORY_UNDERFLOW" | "UNRESOLVED_FLOW" | "INCOMPATIBLE_DATA",
    message: string,
  ) {
    super(message);
    this.name = "CostBasisError";
  }
}

interface Lot {
  quantity: ExactDecimal;
  cost: ExactDecimal;
  acquiredAt: string;
  provenance: string;
}

interface LedgerState extends CostBasisIdentity {
  openingBasis: BasisStatus;
  openingLotCount: number;
  openingCost: ExactDecimal;
  lots: Lot[];
  quantity: ExactDecimal;
  cost: ExactDecimal;
  realized: ExactDecimal;
  nonTradeRemovedCost: ExactDecimal;
  fillCount: number;
  resolvedFlowCount: number;
  issues: string[];
  invalid: boolean;
}

interface PendingInternalTransfer {
  source: CostBasisIdentity;
  target: CostBasisIdentity;
  quantity: ExactDecimal;
  lots: Lot[];
}

interface TimedEvent {
  time: number;
  sequence: number;
  fill?: FillCalculation;
  flow?: ResolvedCostBasisFlow;
}

const ZERO = fromBigInt(0n);
const MAX_EVENTS = 20_000;
const MAX_MARK_AGE_MS = 24 * 60 * 60 * 1000;

function identityKey(identity: CostBasisIdentity): string {
  return JSON.stringify([identity.accountScope, identity.baseAsset, identity.quoteAsset]);
}

function validText(value: string, maxLength: number, allowEmpty = false): boolean {
  return typeof value === "string" &&
    (allowEmpty || value.trim().length > 0) &&
    value.length <= maxLength &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

function validateIdentity(identity: CostBasisIdentity): void {
  if (
    !validText(identity.accountScope, 256) ||
    !validText(identity.baseAsset, 64) ||
    !validText(identity.quoteAsset, 64)
  ) {
    throw new CostBasisError("INVALID_INPUT", "A cost-basis ledger needs a valid account, base, and quote scope.");
  }
}

function timeValue(value: string): number {
  if (
    !validText(value, 64) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  ) {
    throw new CostBasisError("INVALID_INPUT", "Cost-basis timestamps must be explicit RFC3339 values.");
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new CostBasisError("INVALID_INPUT", "A cost-basis timestamp is invalid.");
  }
  return parsed;
}

function positive(raw: string, label: string): ExactDecimal {
  const value = parseDecimal(raw);
  if (compare(value, ZERO) <= 0) {
    throw new CostBasisError("INVALID_INPUT", `${label} must be greater than zero.`);
  }
  return value;
}

function nonNegative(raw: string, label: string): ExactDecimal {
  const value = parseDecimal(raw);
  if (compare(value, ZERO) < 0) {
    throw new CostBasisError("INVALID_INPUT", `${label} must not be negative.`);
  }
  return value;
}

function addIssue(state: LedgerState, issue: string): void {
  state.invalid = true;
  if (!state.issues.includes(issue)) state.issues.push(issue);
}

function makeState(identity: CostBasisIdentity): LedgerState {
  return {
    ...identity,
    openingBasis: "unknown",
    openingLotCount: 0,
    openingCost: ZERO,
    lots: [],
    quantity: ZERO,
    cost: ZERO,
    realized: ZERO,
    nonTradeRemovedCost: ZERO,
    fillCount: 0,
    resolvedFlowCount: 0,
    issues: [],
    invalid: false,
  };
}

function stateFor(states: Map<string, LedgerState>, identity: CostBasisIdentity): LedgerState {
  validateIdentity(identity);
  const key = identityKey(identity);
  let state = states.get(key);
  if (!state) {
    state = makeState(identity);
    states.set(key, state);
  }
  return state;
}

function acquire(state: LedgerState, lots: readonly Lot[]): void {
  for (const lot of lots) {
    if (compare(lot.quantity, ZERO) <= 0) {
      throw new CostBasisError("INVALID_INPUT", "An acquired lot must have positive quantity.");
    }
    state.quantity = add(state.quantity, lot.quantity);
    state.cost = add(state.cost, lot.cost);
    state.lots.push(lot);
  }
}

function removeLots(state: LedgerState, method: CostBasisMethod, quantity: ExactDecimal, at: string): Lot[] {
  if (compare(quantity, ZERO) <= 0 || compare(quantity, state.quantity) > 0 || compare(state.quantity, ZERO) <= 0) {
    throw new CostBasisError(
      "INVENTORY_UNDERFLOW",
      "A disposal exceeds established inventory; missing opening basis or flows cannot be treated as zero-cost inventory.",
    );
  }
  const removed: Lot[] = [];
  let removedCost = ZERO;
  let remaining = quantity;
  if (method === "WEIGHTED_AVERAGE") {
    const cost = divide(multiply(state.cost, quantity), state.quantity);
    removedCost = cost;
    removed.push({ quantity, cost, acquiredAt: at, provenance: "Carried moving weighted-average basis" });
    state.lots = [];
  } else {
    const nextLots: Lot[] = [];
    for (const lot of state.lots) {
      if (isZero(remaining)) {
        nextLots.push(lot);
        continue;
      }
      const take = compare(lot.quantity, remaining) <= 0 ? lot.quantity : remaining;
      const cost = divide(multiply(lot.cost, take), lot.quantity);
      removed.push({ quantity: take, cost, acquiredAt: lot.acquiredAt, provenance: lot.provenance });
      removedCost = add(removedCost, cost);
      remaining = subtract(remaining, take);
      const leftQuantity = subtract(lot.quantity, take);
      if (!isZero(leftQuantity)) {
        nextLots.push({ ...lot, quantity: leftQuantity, cost: subtract(lot.cost, cost) });
      }
    }
    if (!isZero(remaining)) {
      throw new CostBasisError("INVENTORY_UNDERFLOW", "FIFO lots do not cover this disposal.");
    }
    state.lots = nextLots;
  }
  if (method === "WEIGHTED_AVERAGE") removedCost = removed[0].cost;
  state.quantity = subtract(state.quantity, quantity);
  state.cost = subtract(state.cost, removedCost);
  if (isZero(state.quantity)) {
    state.quantity = ZERO;
    state.cost = ZERO;
    state.lots = [];
  }
  return removed;
}

function flowIdentity(flow: ResolvedCostBasisFlow): CostBasisIdentity {
  return {
    accountScope: flow.accountScope,
    baseAsset: flow.baseAsset,
    quoteAsset: flow.quoteAsset,
  };
}

function validateFlow(flow: ResolvedCostBasisFlow, startMs: number, endMs: number): void {
  if (!["acquisition", "non-trade-disposal", "internal-transfer-out", "internal-transfer-in"].includes(flow.kind)) {
    throw new CostBasisError("INVALID_INPUT", "An unknown resolved-flow kind cannot be applied to a cost-basis ledger.");
  }
  validateIdentity(flowIdentity(flow));
  if (!validText(flow.provenance, 500) || !validText(flow.timestamp, 64)) {
    throw new CostBasisError("INVALID_INPUT", "Every resolved flow needs a timestamp and provenance note.");
  }
  const time = timeValue(flow.timestamp);
  if (time < startMs || time > endMs) {
    throw new CostBasisError("INVALID_INPUT", "Resolved flows must belong to the explicit analysis window.");
  }
  positive(flow.quantity, "Flow quantity");
  if (flow.kind === "acquisition") nonNegative(flow.cost, "Acquisition cost");
  if (flow.kind === "internal-transfer-out") {
    if (!validText(flow.targetScope, 256) || !validText(flow.linkKey, 256)) {
      throw new CostBasisError("INVALID_INPUT", "Internal transfer mapping needs a target scope and link key.");
    }
  }
  if (flow.kind === "internal-transfer-in") {
    if (!validText(flow.sourceScope, 256) || !validText(flow.linkKey, 256)) {
      throw new CostBasisError("INVALID_INPUT", "Internal transfer mapping needs a source scope and link key.");
    }
  }
}

function internalKey(flow: InternalTransferOutInput): string;
function internalKey(flow: InternalTransferInInput, targetScope: string): string;
function internalKey(flow: InternalTransferOutInput | InternalTransferInInput, targetScope?: string): string {
  const sourceScope = flow.kind === "internal-transfer-out" ? flow.accountScope : flow.sourceScope;
  const destinationScope = flow.kind === "internal-transfer-out" ? flow.targetScope : targetScope;
  return JSON.stringify([
    flow.linkKey,
    sourceScope,
    destinationScope,
    flow.baseAsset,
    flow.quoteAsset,
  ]);
}

function invalidateInternalCounterpart(
  states: Map<string, LedgerState>,
  flow: InternalTransferOutInput | InternalTransferInInput,
  message: string,
): void {
  const accountScope = flow.kind === "internal-transfer-out" ? flow.targetScope : flow.sourceScope;
  addIssue(stateFor(states, {
    accountScope,
    baseAsset: flow.baseAsset,
    quoteAsset: flow.quoteAsset,
  }), message);
}

function markFor(
  marks: readonly ValuationMarkInput[],
  identity: CostBasisIdentity,
  nowMs: number,
  maxMarkAgeMs: number,
): Pick<CostBasisLedgerResult, "markStatus" | "markSource" | "markKind" | "markTimestamp"> & { mark?: ValuationMarkInput } {
  const matching = marks.filter((mark) => identityKey(mark) === identityKey(identity));
  if (matching.length === 0) return { markStatus: "missing", markSource: null, markKind: null, markTimestamp: null };
  if (matching.length > 1) {
    return {
      markStatus: "conflicting",
      markSource: null,
      markKind: null,
      markTimestamp: null,
    };
  }
  const mark = matching[0];
  try {
    validateIdentity(mark);
    positive(mark.price, "Valuation mark");
    if (!validText(mark.source, 160) || !["last", "mid", "other"].includes(mark.kind)) {
      throw new CostBasisError("INVALID_INPUT", "The valuation mark needs a valid source and kind.");
    }
    const timestamp = timeValue(mark.timestamp);
    const fresh = timestamp <= nowMs && nowMs - timestamp <= maxMarkAgeMs;
    return {
      markStatus: fresh ? "fresh" : "stale",
      markSource: mark.source,
      markKind: mark.kind,
      markTimestamp: mark.timestamp,
      ...(fresh ? { mark } : {}),
    };
  } catch {
    return {
      markStatus: "stale",
      markSource: validText(mark.source, 160) ? mark.source : null,
      markKind: ["last", "mid", "other"].includes(mark.kind) ? mark.kind : null,
      markTimestamp: mark.timestamp,
    };
  }
}

function flowGate(resolution: CostBasisFlowResolution): { status: FlowStatus; reason?: string } {
  const complete = completeMetricEligibility(resolution.coverage);
  if (!complete.available) return { status: "unresolved", reason: complete.reason };
  if (
    !Number.isSafeInteger(resolution.requiredCount) ||
    !Number.isSafeInteger(resolution.resolvedCount) ||
    resolution.requiredCount < 0 ||
    resolution.resolvedCount < 0 ||
    resolution.resolvedCount !== resolution.requiredCount ||
    (resolution.issues?.length ?? 0) > 0
  ) {
    return { status: "unresolved", reason: "Every relevant non-fill flow needs an explicit, valid resolution." };
  }
  return { status: resolution.requiredCount === 0 ? "not-required" : "resolved" };
}

/**
 * Build independent account/base/quote ledgers. No consolidated value is
 * produced across quote assets, and no current price is inferred as basis.
 */
export function analyzeCostBasis(options: CostBasisAnalysisOptions): CostBasisLedgerResult[] {
  if (options.method !== "FIFO" && options.method !== "WEIGHTED_AVERAGE") {
    throw new CostBasisError("INVALID_INPUT", "Choose FIFO or moving weighted average before calculating cost basis.");
  }
  const openingLots = options.openingLots ?? [];
  const openingZero = options.openingZero ?? [];
  const flows = options.flowResolution.events;
  const marks = options.marks ?? [];
  if (openingLots.length + openingZero.length + options.fills.length + flows.length > MAX_EVENTS) {
    throw new CostBasisError("INVALID_INPUT", "The cost-basis event limit was exceeded; narrow the analysis window.");
  }
  if (!options.fillCoverage.requestedStart || !options.fillCoverage.requestedEnd) {
    throw new CostBasisError("WINDOW_REQUIRED", "Cost basis needs an explicit fill-analysis start and end.");
  }
  const requestedStart = options.fillCoverage.requestedStart;
  const requestedEnd = options.fillCoverage.requestedEnd;
  const startMs = timeValue(requestedStart);
  const endMs = timeValue(requestedEnd);
  if (startMs > endMs) throw new CostBasisError("WINDOW_REQUIRED", "The cost-basis analysis window is not ordered.");
  const nowMs = options.nowMs ?? Date.now();
  const maxMarkAgeMs = options.maxMarkAgeMs ?? 5 * 60 * 1000;
  if (
    !Number.isSafeInteger(nowMs) || nowMs < 0 ||
    !Number.isSafeInteger(maxMarkAgeMs) || maxMarkAgeMs < 1 || maxMarkAgeMs > MAX_MARK_AGE_MS
  ) {
    throw new CostBasisError("INVALID_INPUT", "The valuation clock or freshness policy is invalid.");
  }

  const states = new Map<string, LedgerState>();
  const openingEvents = new Map<string, { lot: OpeningLotInput; time: number }[]>();
  for (const zero of openingZero) {
    const state = stateFor(states, zero);
    if (state.openingBasis !== "unknown" || zero.fromInception !== true || !validText(zero.provenance, 500)) {
      addIssue(state, "Opening zero needs a distinct complete-since-inception provenance statement.");
      continue;
    }
    if (timeValue(zero.at) > startMs) {
      addIssue(state, "Opening zero must be established at or before the analysis start.");
      continue;
    }
    state.openingBasis = "proven-zero";
  }
  for (const lot of openingLots) {
    const state = stateFor(states, lot);
    if (state.openingBasis === "proven-zero") {
      addIssue(state, "Opening lots and opening zero cannot be asserted for the same ledger.");
      continue;
    }
    if (!validText(lot.provenance, 500)) {
      addIssue(state, "Every opening lot needs a provenance note.");
      continue;
    }
    try {
      const quantity = positive(lot.quantity, "Opening-lot quantity");
      const cost = nonNegative(lot.cost, "Opening-lot cost");
      const time = timeValue(lot.acquiredAt);
      if (time > startMs) {
        addIssue(state, "An opening lot must be acquired at or before the analysis start; later acquisitions are flows.");
        continue;
      }
      const basisStatus = lot.basisStatus ?? "supplied";
      if (basisStatus !== "supplied" && basisStatus !== "carried-forward") {
        throw new CostBasisError("INVALID_INPUT", "Opening-lot basis status must be supplied or carried-forward.");
      }
      if (state.openingBasis !== "unknown" && state.openingBasis !== basisStatus) {
        addIssue(state, "Opening-lot provenance mixes supplied and carried-forward basis.");
        continue;
      }
      state.openingBasis = basisStatus;
      state.openingLotCount += 1;
      state.openingCost = add(state.openingCost, cost);
      const entries = openingEvents.get(identityKey(state)) ?? [];
      entries.push({ lot, time });
      openingEvents.set(identityKey(state), entries);
    } catch (error) {
      addIssue(state, error instanceof Error ? error.message : "An opening lot is invalid.");
    }
  }
  for (const [key, entries] of openingEvents) {
    const state = states.get(key)!;
    entries.sort((left, right) => left.time - right.time);
    for (const entry of entries) {
      acquire(state, [{
        quantity: parseDecimal(entry.lot.quantity),
        cost: parseDecimal(entry.lot.cost),
        acquiredAt: entry.lot.acquiredAt,
        provenance: entry.lot.provenance,
      }]);
    }
  }

  const events: TimedEvent[] = [];
  let sequence = 0;
  for (const fill of options.fills) {
    try {
      validateIdentity(fill);
      const time = timeValue(fill.timestamp);
      if (time < startMs || time > endMs) {
        throw new CostBasisError("INVALID_INPUT", "A fill falls outside the explicit analysis window.");
      }
      const calculation = calculateFill(fill);
      if (compare(absolute(calculation.dBase), ZERO) <= 0) {
        throw new CostBasisError("INVALID_INPUT", "Fill base movement must be greater than zero.");
      }
      const state = stateFor(states, fill);
      state.fillCount += 1;
      events.push({ time, sequence: sequence++, fill: calculation });
    } catch (error) {
      const state = stateFor(states, fill);
      addIssue(state, error instanceof Error ? error.message : "A fill is incompatible with cost basis.");
    }
  }
  for (const flow of flows) {
    const state = stateFor(states, flowIdentity(flow));
    try {
      validateFlow(flow, startMs, endMs);
      state.resolvedFlowCount += 1;
      events.push({ time: timeValue(flow.timestamp), sequence: sequence++, flow });
      if (flow.kind === "internal-transfer-in") {
        stateFor(states, {
          accountScope: flow.sourceScope,
          baseAsset: flow.baseAsset,
          quoteAsset: flow.quoteAsset,
        });
      }
      if (flow.kind === "internal-transfer-out") {
        stateFor(states, {
          accountScope: flow.targetScope,
          baseAsset: flow.baseAsset,
          quoteAsset: flow.quoteAsset,
        });
      }
    } catch (error) {
      addIssue(state, error instanceof Error ? error.message : "A resolved flow is invalid.");
    }
  }
  events.sort((left, right) => {
    if (left.time !== right.time) return left.time - right.time;
    if (left.fill && right.fill && left.fill.fill.symbol === right.fill.fill.symbol) {
      try {
        const leftMatch = BigInt(left.fill.fill.matchId);
        const rightMatch = BigInt(right.fill.fill.matchId);
        if (leftMatch !== rightMatch) return leftMatch < rightMatch ? -1 : 1;
      } catch {
        // Validation already quarantines a non-numeric match ID through the fill identity checks below.
      }
    }
    const leftInternalOut = left.flow?.kind === "internal-transfer-out" ? 0 : 1;
    const rightInternalOut = right.flow?.kind === "internal-transfer-out" ? 0 : 1;
    if (leftInternalOut !== rightInternalOut) return leftInternalOut - rightInternalOut;
    return left.sequence - right.sequence;
  });

  const pendingInternal = new Map<string, PendingInternalTransfer>();
  for (const event of events) {
    const identity = event.fill
      ? event.fill.fill
      : flowIdentity(event.flow!);
    const state = stateFor(states, identity);
    if (state.invalid) {
      if (event.flow?.kind === "internal-transfer-out" || event.flow?.kind === "internal-transfer-in") {
        invalidateInternalCounterpart(states, event.flow, "The linked ledger is invalid; internal-transfer basis remains unresolved.");
      }
      continue;
    }
    try {
      if (event.fill) {
        const calculation = event.fill;
        if (calculation.fill.side === "BUY") {
          if (compare(calculation.dBase, ZERO) <= 0) {
            throw new CostBasisError("INCOMPATIBLE_DATA", "A buy does not establish positive acquired inventory after its actual base fee.");
          }
          const cost = negate(calculation.dQuote);
          if (compare(cost, ZERO) < 0) {
            throw new CostBasisError("INCOMPATIBLE_DATA", "A buy with positive net quote inflow has unsupported negative basis.");
          }
          acquire(state, [{
            quantity: calculation.dBase,
            cost,
            acquiredAt: calculation.fill.timestamp,
            provenance: `Fill ${calculation.fill.matchId}; actual execution fees included`,
          }]);
        } else {
          if (compare(calculation.dBase, ZERO) >= 0) {
            throw new CostBasisError("INCOMPATIBLE_DATA", "A sell does not remove positive base inventory.");
          }
          const quantity = negate(calculation.dBase);
          const removed = removeLots(state, options.method, quantity, calculation.fill.timestamp);
          const removedCost = removed.reduce((total, lot) => add(total, lot.cost), ZERO);
          state.realized = add(state.realized, subtract(calculation.dQuote, removedCost));
        }
      } else {
        const flow = event.flow!;
        if (flow.kind === "acquisition") {
          acquire(state, [{
            quantity: parseDecimal(flow.quantity),
            cost: parseDecimal(flow.cost),
            acquiredAt: flow.timestamp,
            provenance: flow.provenance,
          }]);
        } else if (flow.kind === "non-trade-disposal") {
          const removed = removeLots(state, options.method, parseDecimal(flow.quantity), flow.timestamp);
          const removedCost = removed.reduce((total, lot) => add(total, lot.cost), ZERO);
          state.nonTradeRemovedCost = add(state.nonTradeRemovedCost, removedCost);
        } else if (flow.kind === "internal-transfer-out") {
          const target = {
            accountScope: flow.targetScope,
            baseAsset: flow.baseAsset,
            quoteAsset: flow.quoteAsset,
          };
          const targetState = stateFor(states, target);
          if (targetState.invalid) {
            addIssue(state, "The linked target ledger is invalid; internal-transfer basis remains unresolved.");
            continue;
          }
          const key = internalKey(flow);
          if (pendingInternal.has(key)) {
            throw new CostBasisError("UNRESOLVED_FLOW", "A duplicate internal transfer mapping would overwrite carried basis.");
          }
          const lots = removeLots(state, options.method, parseDecimal(flow.quantity), flow.timestamp);
          pendingInternal.set(key, {
            source: flowIdentity(flow),
            target,
            quantity: parseDecimal(flow.quantity),
            lots,
          });
        } else {
          const key = internalKey(flow, flow.accountScope);
          const pending = pendingInternal.get(key);
          if (!pending) {
            throw new CostBasisError("UNRESOLVED_FLOW", "An internal transfer credit has no matching basis-carrying debit.");
          }
          if (compare(pending.quantity, parseDecimal(flow.quantity)) !== 0) {
            throw new CostBasisError("UNRESOLVED_FLOW", "Linked internal transfer quantities do not match exactly.");
          }
          acquire(state, pending.lots);
          pendingInternal.delete(key);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "A cost-basis event could not be applied.";
      addIssue(state, message);
      // A failed leg invalidates both sides of an explicit internal mapping;
      // otherwise the counterpart could still look independently eligible.
      if (event.flow?.kind === "internal-transfer-out" || event.flow?.kind === "internal-transfer-in") {
        invalidateInternalCounterpart(states, event.flow, message);
      }
    }
  }
  for (const pending of pendingInternal.values()) {
    const source = stateFor(states, pending.source);
    const target = stateFor(states, pending.target);
    addIssue(source, "An internal transfer debit has no matching credit; carried basis remains unresolved.");
    addIssue(target, "An internal transfer debit has no matching credit; carried basis remains unresolved.");
  }

  const resolvedFlows = flowGate(options.flowResolution);
  return [...states.values()]
    .sort((left, right) => identityKey(left).localeCompare(identityKey(right)))
    .map((state) => {
      const coverage: Coverage = {
        ...options.fillCoverage,
        openingBasis: state.openingBasis,
        nonFillFlows: resolvedFlows.status,
      };
      let eligibility = pnlEligibility(coverage, { quoteAssets: [state.quoteAsset] });
      if (eligibility.available && resolvedFlows.reason) {
        eligibility = { available: false, reason: resolvedFlows.reason };
      }
      if (state.invalid) {
        eligibility = { available: false, reason: state.issues[0] ?? "The cost-basis ledger is invalid." };
      }
      const realizedAvailable = eligibility.available;
      const mark = markFor(marks, state, nowMs, maxMarkAgeMs);
      const unrealizedAvailable = realizedAvailable && mark.markStatus === "fresh" && Boolean(mark.mark);
      const marketValue = unrealizedAvailable
        ? multiply(state.quantity, parseDecimal(mark.mark!.price))
        : null;
      const unrealizedPnl = marketValue === null ? null : subtract(marketValue, state.cost);
      const totalPnl = unrealizedPnl === null ? null : add(state.realized, unrealizedPnl);
      return {
        accountScope: state.accountScope,
        baseAsset: state.baseAsset,
        quoteAsset: state.quoteAsset,
        method: options.method,
        openingBasis: state.openingBasis,
        nonFillFlows: resolvedFlows.status,
        requestedStart,
        requestedEnd,
        realizedAvailable,
        realizedPnl: realizedAvailable ? state.realized : null,
        remainingQuantity: realizedAvailable ? state.quantity : null,
        remainingCost: realizedAvailable ? state.cost : null,
        nonTradeRemovedCost: realizedAvailable ? state.nonTradeRemovedCost : null,
        unrealizedAvailable,
        marketValue,
        unrealizedPnl,
        totalPnl,
        markStatus: mark.markStatus,
        markSource: mark.markSource,
        markKind: mark.markKind,
        markTimestamp: mark.markTimestamp,
        openingLotCount: state.openingLotCount,
        openingCost: state.openingCost,
        fillCount: state.fillCount,
        resolvedFlowCount: state.resolvedFlowCount,
        issues: realizedAvailable
          ? mark.markStatus === "missing"
            ? ["A fresh labeled valuation mark is required for unrealized P&L."]
            : mark.markStatus === "stale"
              ? ["The valuation mark is stale or invalid; current unrealized P&L is suppressed."]
              : mark.markStatus === "conflicting"
                ? ["Multiple valuation marks were supplied; choose exactly one per ledger."]
                : []
          : [eligibility.reason ?? "Cost basis is unavailable.", ...state.issues.filter((issue) => issue !== eligibility.reason)],
      };
    });
}
