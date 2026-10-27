import { useMemo, useState } from "react";
import { account } from "@poly/core";
import { Card, EmptyState, MetricCell, MetricStrip, Pill } from "./ui";
import { IconAlert, IconTrash } from "./icons";
import { useNow } from "../lib/hooks";

type Pair = {
  key: string;
  baseAsset: string;
  quoteAsset: string;
};

type DecisionKind = "" | "fill" | "bucket" | "acquisition" | "disposal" | "quote-neutral";

type FlowDecision = {
  kind: DecisionKind;
  reference: string;
  cost: string;
  note: string;
};

type RelevantFlow = {
  index: number;
  transfer: account.NormalizedTransfer;
  timestamp: string | null;
};

const EMPTY_DECISION: FlowDecision = { kind: "", reference: "", cost: "", note: "" };
const FILL_LEG_CODES = new Set(["TRADE_BASE", "TRADE_QUOTE", "MAKER_FEE", "TAKER_FEE", "REBATE"]);
const BUCKET_CODES = new Set(["FUNDING_TO_TRADING", "TRADING_TO_FUNDING"]);
const ACQUISITION_CODES = new Set(["DEPOSIT", "FUNDING_USER_TRANSFER"]);
const DISPOSAL_CODES = new Set(["WITHDRAW", "FUNDING_USER_TRANSFER"]);
const QUOTE_NEUTRAL_CODES = new Set(["DEPOSIT", "WITHDRAW", "FUNDING_USER_TRANSFER"]);
const MAX_VISIBLE_FLOWS = 100;

function pairOf(fill: account.FillInput): Pair {
  return {
    key: JSON.stringify([fill.baseAsset, fill.quoteAsset]),
    baseAsset: fill.baseAsset,
    quoteAsset: fill.quoteAsset,
  };
}

function transferTime(timestamp: string): string | null {
  try {
    if (!/^\d+$/.test(timestamp)) return null;
    const milliseconds = BigInt(timestamp) / 1000n;
    if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return new Date(Number(milliseconds)).toISOString();
  } catch {
    return null;
  }
}

function localTimeToIso(value: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function ExactAmount({ value, digits = 18 }: { value: account.ExactDecimal | null; digits?: number }) {
  if (!value) return <>Unavailable</>;
  return (
    <span
      className="mono"
      title={`Exact: ${value.raw} · numerator ${value.numerator.toString()} · denominator ${value.denominator.toString()}`}
    >
      {account.formatDecimal(value, digits)}
    </span>
  );
}

function decisionLabel(kind: DecisionKind): string {
  switch (kind) {
    case "fill": return "Already represented by a selected fill";
    case "bucket": return "Paired funding/trading bucket move — documented combined inventory unchanged";
    case "acquisition": return "External base acquisition with documented cost";
    case "disposal": return "Non-trade base disposal — not a sale";
    case "quote-neutral": return "Quote flow does not change this base lot ledger";
    default: return "Unresolved — blocks P&L";
  }
}

function Workspace({
  snapshot,
  accountScope,
  pair,
  fills,
}: {
  snapshot: account.AccountDataSnapshot;
  accountScope: string;
  pair: Pair;
  fills: account.FillInput[];
}) {
  const now = useNow(15_000);
  const [method, setMethod] = useState<account.CostBasisMethod>("FIFO");
  const [openingLots, setOpeningLots] = useState<account.OpeningLotInput[]>([]);
  const [openingZero, setOpeningZero] = useState<account.OpeningZeroInput | null>(null);
  const [zeroConfirmed, setZeroConfirmed] = useState(false);
  const [zeroProvenance, setZeroProvenance] = useState("");
  const [lotQuantity, setLotQuantity] = useState("");
  const [lotCost, setLotCost] = useState("");
  const [lotAcquiredAt, setLotAcquiredAt] = useState("");
  const [lotProvenance, setLotProvenance] = useState("");
  const [decisions, setDecisions] = useState<Record<number, FlowDecision>>({});
  const [mark, setMark] = useState<account.ValuationMarkInput | null>(null);
  const [markPrice, setMarkPrice] = useState("");
  const [markSource, setMarkSource] = useState("");
  const [markKind, setMarkKind] = useState<account.ValuationMarkKind>("last");
  const [markTimestamp, setMarkTimestamp] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const relevantFlows = useMemo(() => {
    const start = Date.parse(snapshot.period.startTime);
    const end = Date.parse(snapshot.period.endTime);
    const rows: RelevantFlow[] = [];
    const transfers = snapshot.transfers.data?.transfers ?? [];
    transfers.forEach((transfer, index) => {
      if (transfer.asset !== pair.baseAsset && transfer.asset !== pair.quoteAsset) return;
      const timestamp = transferTime(transfer.timestamp);
      if (!timestamp) {
        rows.push({ index, transfer, timestamp: null });
        return;
      }
      const time = Date.parse(timestamp);
      if (time >= start && time <= end) rows.push({ index, transfer, timestamp });
    });
    return rows;
  }, [snapshot, pair]);

  const flowResolution = useMemo(() => {
    const events: account.ResolvedCostBasisFlow[] = [];
    const issues: string[] = [];
    let resolvedCount = 0;
    const matches = new Set(fills.map((fill) => fill.matchId));
    for (const { transfer, timestamp, index } of relevantFlows) {
      const decision = decisions[index] ?? EMPTY_DECISION;
      const label = `${transfer.reasonLabel} row ${index + 1}`;
      const note = decision.note.trim();
      let resolved = false;
      if (!transfer.reasonKnown || !timestamp) {
        issues.push(`${label} has an unknown reason or invalid timestamp.`);
        continue;
      }
      if (transfer.transferCode === "INTERNAL_TRANSFER") {
        issues.push(`${label} needs linked two-scope basis mapping; this single-scope view cannot prove both legs.`);
        continue;
      }
      switch (decision.kind) {
        case "fill":
          resolved = FILL_LEG_CODES.has(transfer.transferCode) && matches.has(decision.reference) && note.length >= 3;
          if (!resolved) issues.push(`${label} needs a loaded match ID and a reconciliation note.`);
          break;
        case "bucket": {
          const counterpart = relevantFlows.find((candidate) => String(candidate.index) === decision.reference);
          resolved = Boolean(
            counterpart &&
            counterpart.index !== index &&
            BUCKET_CODES.has(transfer.transferCode) &&
            BUCKET_CODES.has(counterpart.transfer.transferCode) &&
            counterpart.transfer.transferCode !== transfer.transferCode &&
            counterpart.transfer.asset === transfer.asset &&
            counterpart.transfer.isDebit !== transfer.isDebit &&
            transfer.linkId !== "0" &&
            counterpart.transfer.linkId === transfer.linkId &&
            note.length >= 3,
          );
          try {
            if (counterpart && account.compare(account.parseDecimal(counterpart.transfer.amount), account.parseDecimal(transfer.amount)) !== 0) resolved = false;
          } catch {
            resolved = false;
          }
          if (!resolved) issues.push(`${label} needs an opposite loaded bucket leg with the same nonzero correlation, exact asset/amount, and provenance.`);
          break;
        }
        case "acquisition": {
          resolved = !transfer.isDebit && transfer.asset === pair.baseAsset && ACQUISITION_CODES.has(transfer.transferCode) && note.length >= 3;
          try {
            if (account.compare(account.parseDecimal(decision.cost), account.fromBigInt(0n)) < 0) resolved = false;
          } catch {
            resolved = false;
          }
          if (resolved && timestamp) {
            events.push({
              kind: "acquisition",
              accountScope,
              baseAsset: pair.baseAsset,
              quoteAsset: pair.quoteAsset,
              quantity: transfer.amount,
              cost: decision.cost,
              timestamp,
              provenance: `User-resolved ${transfer.reasonLabel}: ${note}`,
            });
          } else {
            issues.push(`${label} needs an external base-acquisition classification, exact non-negative cost, and provenance.`);
          }
          break;
        }
        case "disposal":
          resolved = transfer.isDebit && transfer.asset === pair.baseAsset && DISPOSAL_CODES.has(transfer.transferCode) && note.length >= 3;
          if (resolved && timestamp) {
            events.push({
              kind: "non-trade-disposal",
              accountScope,
              baseAsset: pair.baseAsset,
              quoteAsset: pair.quoteAsset,
              quantity: transfer.amount,
              timestamp,
              provenance: `User-resolved ${transfer.reasonLabel}; not sale proceeds: ${note}`,
            });
          } else {
            issues.push(`${label} needs an external base-disposal classification and provenance.`);
          }
          break;
        case "quote-neutral":
          resolved = transfer.asset === pair.quoteAsset && QUOTE_NEUTRAL_CODES.has(transfer.transferCode) && note.length >= 3;
          if (!resolved) issues.push(`${label} cannot be excluded from this base ledger without a valid quote-only explanation.`);
          break;
        default:
          issues.push(`${label} is unresolved.`);
      }
      if (resolved) resolvedCount += 1;
    }
    if (relevantFlows.length > MAX_VISIBLE_FLOWS) {
      issues.push("More than 100 relevant flows require resolution; narrow the analysis window before calculating P&L.");
    }
    return {
      coverage: snapshot.transfers.coverage,
      requiredCount: relevantFlows.length,
      resolvedCount,
      events,
      issues,
    };
  }, [relevantFlows, decisions, fills, accountScope, pair, snapshot]);

  const analysis = useMemo(() => {
    if (!snapshot.fills.data || !snapshot.transfers.data) {
      return { result: null, error: "Complete validated fills and transfers are required. Denied or unavailable data is not an empty history." };
    }
    if (!snapshot.fills.data.summary.eligible) {
      return { result: null, error: "Conflicting or unrecognized fills block cost-basis accounting." };
    }
    try {
      const results = account.analyzeCostBasis({
        method,
        openingLots,
        openingZero: openingZero ? [openingZero] : [],
        fills,
        fillCoverage: snapshot.fills.coverage,
        flowResolution,
        marks: mark ? [mark] : [],
        nowMs: now,
        maxMarkAgeMs: 5 * 60 * 1000,
      });
      return { result: results.find((result) => result.baseAsset === pair.baseAsset && result.quoteAsset === pair.quoteAsset) ?? null, error: null };
    } catch (error) {
      return { result: null, error: error instanceof Error ? error.message : "Cost-basis inputs are incompatible." };
    }
  }, [snapshot, method, openingLots, openingZero, fills, flowResolution, mark, now, pair]);

  const result = analysis.result;
  const addLot = () => {
    setFormError(null);
    const acquiredAt = localTimeToIso(lotAcquiredAt);
    if (!acquiredAt || lotProvenance.trim().length < 3) {
      setFormError("Enter the acquisition time and a provenance note for the opening lot.");
      return;
    }
    try {
      if (account.compare(account.parseDecimal(lotQuantity), account.fromBigInt(0n)) <= 0) throw new Error("quantity");
      if (account.compare(account.parseDecimal(lotCost), account.fromBigInt(0n)) < 0) throw new Error("cost");
    } catch {
      setFormError("Opening quantity must be positive and total exact cost must be non-negative decimal text.");
      return;
    }
    if (Date.parse(acquiredAt) > Date.parse(snapshot.period.startTime)) {
      setFormError("An opening lot must be acquired at or before the analysis start. Use a flow resolution for a later acquisition.");
      return;
    }
    setOpeningLots((current) => [...current, {
      accountScope,
      baseAsset: pair.baseAsset,
      quoteAsset: pair.quoteAsset,
      quantity: lotQuantity,
      cost: lotCost,
      acquiredAt,
      provenance: lotProvenance.trim(),
      basisStatus: "supplied",
    }]);
    setOpeningZero(null);
    setLotQuantity("");
    setLotCost("");
    setLotAcquiredAt("");
    setLotProvenance("");
  };

  const assertOpeningZero = () => {
    setFormError(null);
    if (!zeroConfirmed || zeroProvenance.trim().length < 3) {
      setFormError("Confirm complete-since-inception evidence and provide its provenance; an arbitrary empty window is not opening zero.");
      return;
    }
    setOpeningZero({
      accountScope,
      baseAsset: pair.baseAsset,
      quoteAsset: pair.quoteAsset,
      at: snapshot.period.startTime,
      provenance: zeroProvenance.trim(),
      fromInception: true,
    });
    setOpeningLots([]);
  };

  const saveMark = () => {
    setFormError(null);
    const timestamp = localTimeToIso(markTimestamp);
    if (!timestamp || markSource.trim().length < 3) {
      setFormError("Enter the mark's source and timestamp. No current price is inferred.");
      return;
    }
    try {
      if (account.compare(account.parseDecimal(markPrice), account.fromBigInt(0n)) <= 0) throw new Error("price");
    } catch {
      setFormError("The valuation mark must be a positive exact decimal.");
      return;
    }
    setMark({
      accountScope,
      baseAsset: pair.baseAsset,
      quoteAsset: pair.quoteAsset,
      price: markPrice,
      source: markSource.trim(),
      kind: markKind,
      timestamp,
    });
  };

  const updateDecision = (index: number, patch: Partial<FlowDecision>) => {
    setDecisions((current) => ({
      ...current,
      [index]: { ...(current[index] ?? EMPTY_DECISION), ...patch },
    }));
  };

  return (
    <>
      <Card
        title={`${pair.baseAsset}/${pair.quoteAsset} cost-basis inputs`}
        subtitle="Memory only — discarded when the view or session changes."
        actions={<Pill kind="warn">User-supplied provenance</Pill>}
      >
        <div className="notice warn" role="note" style={{ marginBottom: 14 }}>
          <IconAlert size={15} />
          <span>Current balances and prices are never historical cost; incomplete inputs block P&L.</span>
        </div>
        <div className="row-flex" style={{ gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 16 }}>
          <label className="field">
            <span className="faint">Accounting method</span>
            <select className="select" value={method} onChange={(event) => setMethod(event.target.value as account.CostBasisMethod)}>
              <option value="FIFO">FIFO</option>
              <option value="WEIGHTED_AVERAGE">Moving weighted average</option>
            </select>
          </label>
          <span className="faint">Window: {snapshot.period.startTime} → {snapshot.period.endTime}</span>
        </div>

        <div className="grid two" style={{ gap: 16 }}>
          <section aria-labelledby="opening-lot-heading">
            <h4 id="opening-lot-heading">Add an opening lot</h4>
            <p className="faint">Quantity and total exact cost for the whole {pair.baseAsset} lot, with {pair.quoteAsset} as quote.</p>
            <div className="row-flex" style={{ gap: 8, flexWrap: "wrap" }}>
              <input className="input" value={lotQuantity} onChange={(event) => setLotQuantity(event.target.value)} placeholder="Quantity, e.g. 0.01" aria-label="Opening lot quantity" />
              <input className="input" value={lotCost} onChange={(event) => setLotCost(event.target.value)} placeholder={`Total cost in ${pair.quoteAsset}`} aria-label="Opening lot total exact cost" />
              <input className="input" type="datetime-local" value={lotAcquiredAt} onChange={(event) => setLotAcquiredAt(event.target.value)} aria-label="Opening lot acquisition time" />
              <input className="input" value={lotProvenance} onChange={(event) => setLotProvenance(event.target.value)} placeholder="Provenance note" aria-label="Opening lot provenance" maxLength={500} />
              <button type="button" className="btn sm" onClick={addLot}>Add lot</button>
            </div>
            {openingLots.length > 0 && (
              <div className="table-wrap mt-3"><table className="data"><thead><tr><th>Quantity</th><th>Total cost</th><th>Acquired</th><th>Provenance</th><th>Remove</th></tr></thead><tbody>
                {openingLots.map((lot, index) => <tr key={`${lot.acquiredAt}-${index}`}><td>{lot.quantity} {pair.baseAsset}</td><td>{lot.cost} {pair.quoteAsset}</td><td>{lot.acquiredAt}</td><td className="align-left">{lot.provenance}</td><td><button type="button" className="btn sm ghost" aria-label={`Remove opening lot ${index + 1}`} onClick={() => setOpeningLots((current) => current.filter((_, item) => item !== index))}><IconTrash size={13} /></button></td></tr>)}
              </tbody></table></div>
            )}
          </section>

          <section aria-labelledby="opening-zero-heading">
            <h4 id="opening-zero-heading">Or establish opening zero</h4>
            <label className="row-flex" style={{ gap: 8 }}><input type="checkbox" checked={zeroConfirmed} onChange={(event) => setZeroConfirmed(event.target.checked)} /> <span>I have complete-since-inception evidence for opening zero</span></label>
            <div className="row-flex mt-2" style={{ gap: 8, flexWrap: "wrap" }}>
              <input className="input" value={zeroProvenance} onChange={(event) => setZeroProvenance(event.target.value)} placeholder="Evidence/provenance note" aria-label="Opening zero provenance" maxLength={500} />
              <button type="button" className="btn sm" onClick={assertOpeningZero}>Assert opening zero</button>
              {openingZero && <Pill kind="up">Opening zero supplied</Pill>}
            </div>
          </section>
        </div>
        {formError && <div className="notice error mt-3" role="alert"><IconAlert size={15} /><span>{formError}</span></div>}
      </Card>

      <Card
        title="Resolve relevant non-fill flows"
        subtitle={`${flowResolution.resolvedCount}/${flowResolution.requiredCount} resolved · unified transfer rows have no assumed unique leg ID or automatic fill link`}
        actions={<Pill kind={flowResolution.issues.length > 0 ? "warn" : "up"}>{flowResolution.issues.length > 0 ? "Blocking" : "Resolved"}</Pill>}
      >
        {relevantFlows.length === 0 ? (
          <EmptyState title="No relevant loaded transfer rows" description="The complete transfer read is still required." />
        ) : (
          <div className="table-wrap"><table className="data"><thead><tr><th className="align-left">Activity</th><th>Asset amount</th><th>Time</th><th>Classification</th><th>Resolution inputs</th></tr></thead><tbody>
            {relevantFlows.slice(0, MAX_VISIBLE_FLOWS).map(({ transfer, index, timestamp }) => {
              const decision = decisions[index] ?? EMPTY_DECISION;
              return <tr key={index}>
                <td className="align-left">{transfer.reasonLabel}<br /><span className="faint">{transfer.isDebit ? "Debit" : "Credit"} · row {index + 1}</span></td>
                <td>{transfer.amount} {transfer.asset}</td><td className="mono">{timestamp ?? "Invalid"}</td>
                <td style={{ minWidth: 250 }}><select className="select" aria-label={`Resolve transfer row ${index + 1}`} value={decision.kind} onChange={(event) => updateDecision(index, { kind: event.target.value as DecisionKind })}>
                  {(["", "fill", "bucket", "acquisition", "disposal", "quote-neutral"] as DecisionKind[]).map((kind) => <option key={kind} value={kind}>{decisionLabel(kind)}</option>)}
                </select></td>
                <td style={{ minWidth: 280 }}>
                  {decision.kind === "fill" && <select className="select" aria-label={`Fill match for transfer row ${index + 1}`} value={decision.reference} onChange={(event) => updateDecision(index, { reference: event.target.value })}><option value="">Choose loaded match</option>{fills.map((fill) => <option key={`${fill.symbol}-${fill.matchId}-${fill.orderId}`} value={fill.matchId}>{fill.matchId} · {fill.side} · {fill.quantity} {fill.baseAsset}</option>)}</select>}
                  {decision.kind === "bucket" && <select className="select" aria-label={`Bucket pair for transfer row ${index + 1}`} value={decision.reference} onChange={(event) => updateDecision(index, { reference: event.target.value })}><option value="">Choose opposite loaded bucket row</option>{relevantFlows.filter((candidate) => candidate.index !== index && candidate.transfer.asset === transfer.asset && BUCKET_CODES.has(candidate.transfer.transferCode)).map((candidate) => <option key={candidate.index} value={String(candidate.index)}>Row {candidate.index + 1} · {candidate.transfer.reasonLabel} · {candidate.transfer.isDebit ? "debit" : "credit"}</option>)}</select>}
                  {decision.kind === "acquisition" && <input className="input" value={decision.cost} onChange={(event) => updateDecision(index, { cost: event.target.value })} placeholder={`Total basis in ${pair.quoteAsset}`} aria-label={`Acquisition cost for transfer row ${index + 1}`} />}
                  {["fill", "bucket", "acquisition", "disposal", "quote-neutral"].includes(decision.kind) && <input className="input mt-2" value={decision.note} onChange={(event) => updateDecision(index, { note: event.target.value })} placeholder="Required provenance note" aria-label={`Resolution note for transfer row ${index + 1}`} maxLength={500} />}
                </td>
              </tr>;
            })}
          </tbody></table></div>
        )}
        {flowResolution.issues.slice(0, 5).map((issue, index) => (
          <div className="notice warn mt-2" role="note" key={`${issue}-${index}`}><IconAlert size={15} /><span>{issue}</span></div>
        ))}
        {flowResolution.issues.length > 5 && <p className="faint mt-2">{flowResolution.issues.length - 5} more unresolved flow issues remain. Every relevant row must be resolved.</p>}
      </Card>

      <Card title="Fresh valuation mark" subtitle="Required for unrealized/total P&L, not realized.">
        <div className="row-flex" style={{ gap: 8, flexWrap: "wrap" }}>
          <input className="input" value={markPrice} onChange={(event) => setMarkPrice(event.target.value)} placeholder={`Price in ${pair.quoteAsset}`} aria-label="Valuation mark price" />
          <input className="input" value={markSource} onChange={(event) => setMarkSource(event.target.value)} placeholder="Labeled source" aria-label="Valuation mark source" maxLength={160} />
          <select className="select" value={markKind} onChange={(event) => setMarkKind(event.target.value as account.ValuationMarkKind)} aria-label="Valuation mark kind"><option value="last">Last</option><option value="mid">Mid</option><option value="other">Other</option></select>
          <input className="input" type="datetime-local" value={markTimestamp} onChange={(event) => setMarkTimestamp(event.target.value)} aria-label="Valuation mark timestamp" />
          <button type="button" className="btn sm" onClick={saveMark}>{mark ? "Replace mark" : "Use mark"}</button>
          {mark && <button type="button" className="btn sm ghost" onClick={() => setMark(null)}>Clear mark</button>}
        </div>
        {mark && <p className="faint mt-2">{mark.price} {pair.quoteAsset} · {mark.kind} · {mark.source} · {mark.timestamp} · five-minute freshness policy</p>}
      </Card>

      <Card
        title="Cost-basis result"
        subtitle={`${method === "FIFO" ? "FIFO" : "Moving weighted average"} · ${result?.openingBasis ?? "unknown"} opening basis · ${result?.nonFillFlows ?? "unresolved"} non-fill flows`}
        actions={<Pill kind={result?.realizedAvailable ? "up" : "warn"}>{result?.realizedAvailable ? "Eligible inputs" : "P&L blocked"}</Pill>}
      >
        {analysis.error && <div className="notice error" role="alert"><IconAlert size={15} /><span>{analysis.error}</span></div>}
        {result?.issues.map((issue, index) => <div className="notice warn" role="note" key={`${issue}-${index}`}><IconAlert size={15} /><span>{issue}</span></div>)}
        <MetricStrip>
          <MetricCell label="Realized P&L" value={result?.realizedPnl ? <><ExactAmount value={result.realizedPnl} /> {pair.quoteAsset}</> : "Unavailable"} sub="Complete fills, opening basis, and resolved flows required" />
          <MetricCell label="Unrealized P&L" value={result?.unrealizedPnl ? <><ExactAmount value={result.unrealizedPnl} /> {pair.quoteAsset}</> : "Unavailable"} sub={result?.markStatus === "fresh" ? `${result.markKind} · ${result.markSource}` : "Fresh labeled mark required"} />
          <MetricCell label="Total P&L" value={result?.totalPnl ? <><ExactAmount value={result.totalPnl} /> {pair.quoteAsset}</> : "Unavailable"} sub="Shown only when both components are eligible" />
          <MetricCell label="Remaining cost" value={result?.remainingCost ? <><ExactAmount value={result.remainingCost} /> {pair.quoteAsset}</> : "Unavailable"} sub={result?.remainingQuantity ? <><ExactAmount value={result.remainingQuantity} /> {pair.baseAsset}</> : "No validated remaining ledger"} />
        </MetricStrip>
        {result?.realizedAvailable && (
          <div className="kv-list mt-3">
            <div className="kv"><span className="k">Opening lots / exact cost</span><span className="v">{result.openingLotCount} · <ExactAmount value={result.openingCost} /> {pair.quoteAsset}</span></div>
            <div className="kv"><span className="k">Validated fills / resolved flows</span><span className="v">{result.fillCount} / {result.resolvedFlowCount}</span></div>
            <div className="kv"><span className="k">Non-trade removed cost</span><span className="v"><ExactAmount value={result.nonTradeRemovedCost} /> {pair.quoteAsset} · not sale proceeds</span></div>
            <div className="kv"><span className="k">Analysis window</span><span className="v">{result.requestedStart} → {result.requestedEnd}</span></div>
            <div className="kv"><span className="k">Valuation provenance</span><span className="v">{result.markStatus === "fresh" ? `${result.markSource} · ${result.markKind} · ${result.markTimestamp}` : "No fresh eligible mark"}</span></div>
          </div>
        )}
      </Card>
    </>
  );
}

export function AccountCostBasis({ snapshot, accountScope }: { snapshot: account.AccountDataSnapshot; accountScope: string }) {
  const pairs = useMemo(() => {
    const unique = new Map<string, Pair>();
    for (const calculation of snapshot.fills.data?.summary.calculations ?? []) {
      const pair = pairOf(calculation.fill);
      unique.set(pair.key, pair);
    }
    return [...unique.values()].sort((left, right) => left.key.localeCompare(right.key));
  }, [snapshot]);
  const [selected, setSelected] = useState<string | null>(null);
  const pair = pairs.find((candidate) => candidate.key === selected) ?? pairs[0] ?? null;

  if (!snapshot.fills.data || !snapshot.transfers.data) {
    return <Card><EmptyState title="Complete fills and transfers are required" description="Unavailable reads are not zero; check dataset status." /></Card>;
  }
  if (!pair) {
    return <Card><EmptyState title="No validated fills" description="Lifetime history and opening zero are unverified; P&L is unavailable." /></Card>;
  }
  const fills = snapshot.fills.data.summary.calculations
    .map((calculation) => calculation.fill)
    .filter((fill) => fill.baseAsset === pair.baseAsset && fill.quoteAsset === pair.quoteAsset);
  return (
    <>
      <Card title="Choose a cost-basis ledger" subtitle="Separate ledgers; no quote conversion.">
        <label className="field" style={{ maxWidth: 360 }}><span className="faint">Market ledger</span><select className="select" value={pair.key} onChange={(event) => setSelected(event.target.value)}>{pairs.map((candidate) => <option key={candidate.key} value={candidate.key}>{candidate.baseAsset}/{candidate.quoteAsset}</option>)}</select></label>
      </Card>
      <Workspace
        key={`${accountScope}:${pair.key}:${snapshot.period.startTime}:${snapshot.period.endTime}:${snapshot.fills.retrievedAtMs ?? "none"}:${snapshot.transfers.retrievedAtMs ?? "none"}`}
        snapshot={snapshot}
        accountScope={accountScope}
        pair={pair}
        fills={fills}
      />
    </>
  );
}
