import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { account, fmtAgo } from "@poly/core";
import { Card, ConfirmDialog, EmptyState, MetricCell, MetricStrip, Pill } from "./ui";
import { IconActivity, IconAlert, IconClock, IconRefresh } from "./icons";
import { downloadAccountExport } from "../lib/download";

const RANGES: account.AccountHistoryRange[] = ["1d", "7d", "30d", "90d", "180d", "365d"];

type AnyDataset = {
  coverage: account.Coverage;
  retrievedAtMs: number | null;
  error?: account.SafeAccountError;
};

function errorText(error?: account.SafeAccountError): string {
  if (!error) return "";
  switch (error.code) {
    case "PERMISSION_DENIED": return "Permission required for this read; no rows were inferred.";
    case "UNAUTHENTICATED": return "Authentication failed; check the registered key ID and read-only key status.";
    case "CORS_BLOCKED": return "Browser CORS or network policy blocked the read; no proxy fallback was used.";
    case "TIMESTAMP_SKEW": return "The signing timestamp was rejected; check the device clock before retrying.";
    case "SIGNATURE_INVALID": return "The signature was rejected; automatic signing retries are stopped.";
    case "SCHEMA_INCOMPATIBLE": return "The response schema is incompatible; affected metrics are blocked.";
    case "CONTRACT_CONFLICT": return "The request contract is ambiguous or incompatible; the read was stopped.";
    case "ACCOUNT_STALE": return "The vault session changed; late private data was discarded.";
    case "ABORTED": return "The read was aborted before coverage completed.";
    case "RATE_LIMITED": return "The read is rate-limited; bounded retry limits still apply.";
    case "SERVER": return "The read endpoint is temporarily unavailable.";
    default: return "The read failed safely; no private response was retained.";
  }
}

function statusKind(status?: account.CoverageStatus): "up" | "down" | "warn" | "info" {
  if (status === "complete" || status === "filter-complete") return "up";
  if (status === "denied" || status === "blocked" || status === "unavailable") return "down";
  if (status === "partial" || status === "stale" || status === "loading") return "warn";
  return "info";
}

function DatasetStatus({ dataset, loading = false }: { dataset?: AnyDataset | null; loading?: boolean }) {
  if (!dataset) return <Pill kind={loading ? "info" : undefined}>{loading ? "Loading" : "Not loaded"}</Pill>;
  const status = dataset.coverage.status;
  return (
    <span className="row-flex" style={{ gap: 6, justifyContent: "flex-end" }}>
      <Pill kind={statusKind(status)}>{status}</Pill>
      {loading && <Pill kind="info">Refreshing</Pill>}
      {dataset.retrievedAtMs && (
        <span className="faint" title={new Date(dataset.retrievedAtMs).toISOString()}>
          {fmtAgo(dataset.retrievedAtMs)}
        </span>
      )}
    </span>
  );
}

function ExportControls({
  dataset,
  name,
  rowCount,
  onExport,
}: {
  dataset: AnyDataset;
  name: account.AccountExportDataset;
  rowCount: number;
  onExport: (name: account.AccountExportDataset, format: account.AccountExportFormat) => void;
}) {
  // Transfers can be filtered client-side, so their export is always described
  // as loaded rows rather than implying a server-complete covered partition.
  const covered = name !== "transfers" && (dataset.coverage.status === "complete" || dataset.coverage.status === "filter-complete");
  const label = covered ? "Export covered rows" : "Export loaded rows";
  return (
    <span className="row-flex" style={{ gap: 5, flexWrap: "wrap", justifyContent: "flex-end" }}>
      <span className="faint">{label}</span>
      {(["csv", "json"] as const).map((format) => (
        <button
          key={format}
          type="button"
          className="btn sm ghost"
          disabled={rowCount === 0}
          title={rowCount === 0 ? "No loaded rows are available to export" : `${label} as ${format.toUpperCase()}`}
          aria-label={`${label} as ${format.toUpperCase()}`}
          onClick={() => onExport(name, format)}
        >
          {format.toUpperCase()}
        </button>
      ))}
    </span>
  );
}

function DatasetActions({
  dataset,
  name,
  rowCount,
  onExport,
}: {
  dataset: AnyDataset;
  name: account.AccountExportDataset;
  rowCount: number;
  onExport: (name: account.AccountExportDataset, format: account.AccountExportFormat) => void;
}) {
  return (
    <>
      <DatasetStatus dataset={dataset} />
      <ExportControls dataset={dataset} name={name} rowCount={rowCount} onExport={onExport} />
    </>
  );
}

function DatasetMessages({ dataset, fixedRange = false }: { dataset: AnyDataset; fixedRange?: boolean }) {
  const coverage = dataset.coverage;
  return (
    <>
      {dataset.error && (
        <div className="notice error" role="alert" style={{ marginBottom: 10 }}>
          <IconAlert size={15} />
          <span><strong>{dataset.error.code}</strong> · {errorText(dataset.error)}</span>
        </div>
      )}
      {(coverage.status === "partial" || coverage.status === "stale") && !dataset.error && (
        <div className="notice warn" role="note" style={{ marginBottom: 10 }}>
          <span>Coverage is {coverage.status}; figures, where shown, are limited to validated loaded rows and are not complete history.</span>
        </div>
      )}
      <div className="faint" style={{ marginTop: 10 }}>
        {coverage.pagesFetched} {fixedRange ? "fixed-range response" : `page${coverage.pagesFetched === 1 ? "" : "s"}`} · {coverage.rowsAccepted}/{coverage.rowsReceived} rows accepted · {fixedRange ? "no cursor; fixed server window" : coverage.cursorExhausted ? "cursor exhausted" : "cursor not exhausted"}
        {coverage.duplicateRows > 0 && ` · ${coverage.duplicateRows} duplicate`}
        {coverage.conflictingRows > 0 && ` · ${coverage.conflictingRows} conflicting`}
        {coverage.unknownRows > 0 && ` · ${coverage.unknownRows} unknown`}
        {coverage.stoppedAtCap && " · page cap reached"}
      </div>
    </>
  );
}

function NoDataset({ dataset }: { dataset: AnyDataset }) {
  const status = dataset.coverage.status;
  const title = status === "denied" ? "Permission required" : status === "blocked" ? "Read blocked" : status === "stale" ? "Session data unavailable" : "No validated response";
  return (
    <EmptyState
      title={title}
      description="This is not an empty account. No numeric value is substituted for unavailable, denied, or incompatible data."
    />
  );
}

function ExactValue({ value, digits = 18 }: { value: account.ExactDecimal | string; digits?: number }) {
  try {
    const parsed = typeof value === "string" ? account.parseDecimal(value) : value;
    const raw = typeof value === "string" ? value : value.raw;
    return <span className="mono" title={`Exact API value: ${raw}`}>{account.formatDecimal(parsed, digits)}</span>;
  } catch {
    return <span className="mono">Unavailable</span>;
  }
}

function apiTime(value: string | undefined, unit: "rfc3339" | "micros" | "millis" = "rfc3339"): string {
  if (!value) return "—";
  try {
    if (unit === "micros" || unit === "millis") {
      if (!/^\d+$/.test(value)) return "—";
      const milliseconds = unit === "micros" ? BigInt(value) / 1_000n : BigInt(value);
      if (milliseconds > BigInt(Number.MAX_SAFE_INTEGER)) return "—";
      return new Date(Number(milliseconds)).toISOString();
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toISOString();
  } catch {
    return "—";
  }
}

type BalanceHistoryDataset = account.AccountDataset<account.BalanceHistoryData>;
type OpenOrdersDataset = account.AccountDataset<account.OpenOrdersData>;
type OrderDetailsDataset = account.AccountDataset<account.OrderDetailsData>;
type OrderSelection = { orderId: string; subaccountId?: string };

function epochSecondsTime(seconds: number | undefined): string {
  if (seconds === undefined) return "not supplied";
  return apiTime((BigInt(seconds) * 1_000n).toString(), "millis");
}

function balancePointTime(data: account.BalanceHistoryData, index: number): string {
  if (!data.timing.available || data.startTsSec === undefined || data.timing.bucketSeconds === undefined) {
    return "Timestamp unavailable";
  }
  const seconds = data.startTsSec + index * data.timing.bucketSeconds;
  if (!Number.isSafeInteger(seconds)) return "Timestamp unavailable";
  const formatted = epochSecondsTime(seconds);
  return formatted === "—" ? "Timestamp unavailable" : formatted;
}

/** Pixel geometry only: source balances stay exact strings throughout the model. */
function balanceChartPoints(values: string[]): string {
  if (values.length === 0) return "";
  try {
    const parsed = values.map((value) => account.parseDecimal(value));
    let min = parsed[0]!;
    let max = parsed[0]!;
    for (const value of parsed.slice(1)) {
      if (account.compare(value, min) < 0) min = value;
      if (account.compare(value, max) > 0) max = value;
    }
    const span = account.subtract(max, min);
    return parsed.map((value, index) => {
      const x = parsed.length === 1 ? 50 : (index / (parsed.length - 1)) * 100;
      let y = 20;
      if (span.numerator !== 0n) {
        const difference = account.subtract(value, min);
        // The quotient is bounded to 36 pixels before conversion to Number.
        const offset = Number(
          (difference.numerator * 36n * span.denominator) /
          (difference.denominator * span.numerator),
        );
        y = 38 - offset;
      }
      return `${x.toFixed(2)},${y}`;
    }).join(" ");
  } catch {
    return "";
  }
}

function BalanceHistorySeriesView({ data, series, index }: {
  data: account.BalanceHistoryData;
  series: account.BalanceHistorySeries;
  index: number;
}) {
  const points = balanceChartPoints(series.balance);
  const label = `${series.asset} / ${series.account}`;
  return (
    <article className="balance-series">
      <div className="row-flex" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <strong className="mono">{label}</strong>
        <span className="faint">{series.balance.length} aligned sample{series.balance.length === 1 ? "" : "s"}</span>
      </div>
      {points ? (
        <svg className="balance-chart" viewBox="0 0 100 40" role="img" aria-label={`Sampled balance history for ${label}; exact values are in the table below`}>
          <title>{`Sampled balance history for ${label}`}</title>
          <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
      ) : <div className="notice warn" role="note">Chart geometry unavailable; exact samples remain available below.</div>}
      <details>
        <summary>View exact {label} samples</summary>
        <div className="table-wrap">
          <table className="data">
            <caption className="faint">Raw chart values in the API's 1e7-scaled chart units; no additional divisor is applied.</caption>
            <thead><tr><th className="align-left">{data.timing.available ? "Sample time (UTC)" : "Sample (point timing unavailable)"}</th><th className="align-left">Asset</th><th className="align-left">Account bucket</th><th>Balance</th></tr></thead>
            <tbody>{series.balance.map((value, pointIndex) => (
              <tr key={`${index}-${pointIndex}`}>
                <td className="align-left mono">{data.timing.available ? balancePointTime(data, pointIndex) : `Sample ${pointIndex + 1}`}</td>
                <td className="align-left mono">{series.asset}</td>
                <td className="align-left mono">{series.account}</td>
                <td><ExactValue value={value} /></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </details>
    </article>
  );
}

function BalanceHistoryCard({ dataset, loading, range }: {
  dataset: BalanceHistoryDataset | null;
  loading: boolean;
  range: account.AccountHistoryRange;
}) {
  const data = dataset?.data ?? null;
  return (
    <Card
      title="Sampled balance history"
      subtitle="Fixed-range asset/account series, separate from current balances and equity. Values are sampled history, not live balances or P&L."
      actions={<DatasetStatus dataset={dataset} loading={loading} />}
    >
      {loading && <div className="notice info" role="status" style={{ marginBottom: 10 }}><IconRefresh size={15} /><span>Refreshing balance history; previous validated samples remain labeled with their retrieval time.</span></div>}
      {data ? (
        <>
          <div className="faint" style={{ marginBottom: 10 }}>
            Range: <strong>{data.range}</strong> (requested {range}) · Bucket: {data.bucket ?? "not supplied"} · Points: {data.points ?? "aligned by series"} · Start: {epochSecondsTime(data.startTsSec)} · End: {epochSecondsTime(data.endTsSec)}
          </div>
          {!data.timing.available && <div className="notice warn" role="note" style={{ marginBottom: 10 }}>Point timestamps are unavailable because the optional aligned timing fields are incomplete. Samples remain ordered; no dates are invented.</div>}
          {data.series.length > 0 ? data.series.map((series, index) => <BalanceHistorySeriesView key={`${series.asset}-${series.account}-${index}`} data={data} series={series} index={index} />) : (
            <EmptyState title="No balance-history series in validated response" description="The fixed-range response is empty. No historical balance or zero value is inferred." />
          )}
          <DatasetMessages dataset={dataset!} fixedRange />
        </>
      ) : dataset ? (
        <><NoDataset dataset={dataset} /><DatasetMessages dataset={dataset} fixedRange /></>
      ) : !loading ? (
        <EmptyState title="Balance history not loaded" description="Use the explicit read-only refresh to request this independent fixed-range dataset." />
      ) : null}
    </Card>
  );
}

function OpenOrdersCard({ dataset, loading, onDetails }: {
  dataset: OpenOrdersDataset | null;
  loading: boolean;
  onDetails: (order: account.NormalizedOrder) => void;
}) {
  const data = dataset?.data ?? null;
  const complete = dataset?.coverage.status === "complete" || dataset?.coverage.status === "filter-complete";
  return (
    <Card
      title="Open orders"
      subtitle="Independent non-terminal order coverage. PENDING and PENDING_CANCEL remain visible; no cancel or modify action is available."
      actions={<DatasetStatus dataset={dataset} loading={loading} />}
    >
      {loading && <div className="notice info" role="status" style={{ marginBottom: 10 }}><IconRefresh size={15} /><span>Refreshing open orders independently from terminal history.</span></div>}
      {data ? (
        <>
          {data.orders.length > 0 ? <div className="table-wrap"><table className="data"><thead><tr><th className="align-left">Order</th><th>Market</th><th>Side</th><th>Type</th><th>Status</th><th>Price</th><th>Original qty</th><th>Filled qty</th><th>Remaining</th><th>Created</th><th>Details</th></tr></thead><tbody>
            {data.orders.map((order) => <tr key={`${order.orderId}-${order.generation}`}><td className="align-left mono">{order.orderId}</td><td>{order.marketSymbol ?? order.symbol}</td><td>{order.side}</td><td>{order.orderType}</td><td><Pill kind="info">{order.status}</Pill></td><td><ExactValue value={order.price} /></td><td><ExactValue value={order.origQty} /></td><td><ExactValue value={order.cumQty} /></td><td><ExactValue value={order.leavesQty} /></td><td className="mono">{apiTime(order.createdAt)}</td><td><button type="button" className="btn sm ghost order-details-trigger" onClick={() => onDetails(order)} aria-label={`View details for order ${order.orderId}`}>Details</button></td></tr>)}
          </tbody></table></div> : complete ? (
            <EmptyState title="No open orders in validated coverage" description="The open-order cursor is exhausted with no validated rows. This is an empty result for this scope/filter, not an inference about another dataset." />
          ) : (
            <EmptyState title="No validated open-order rows loaded" description={`Coverage is ${dataset?.coverage.status ?? "unavailable"}; this is not proof that the account has no open orders.`} />
          )}
          <DatasetMessages dataset={dataset!} />
        </>
      ) : dataset ? (
        <><NoDataset dataset={dataset} /><DatasetMessages dataset={dataset} /></>
      ) : !loading ? (
        <EmptyState title="Open orders not loaded" description="Use the explicit read-only refresh to request open orders independently from terminal history." />
      ) : null}
    </Card>
  );
}

function DetailValue({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return <div><dt>{label}</dt><dd className={mono ? "mono" : undefined}>{value === undefined || value === null || value === "" ? "Unavailable" : value}</dd></div>;
}

function orderTime(value: string | undefined): string {
  if (!value || value === "0") return "Not supplied / not terminal";
  const formatted = apiTime(value);
  return formatted === "—" ? "Unavailable" : formatted;
}

function OrderDetailsDrawer({ selection, dataset, loading, onClose, onRetry }: {
  selection: OrderSelection;
  dataset: OrderDetailsDataset | null;
  loading: boolean;
  onClose: () => void;
  onRetry: () => void;
}) {
  const titleId = useId();
  const drawerRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const data = dataset?.data ?? null;
  const order = data?.order ?? null;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...(drawerRef.current?.querySelectorAll<HTMLElement>("button, a[href], input, select, textarea, [tabindex]:not([tabindex=\"-1\"])") ?? [])]
        .filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (!drawerRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="order-drawer-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} role="presentation">
      <aside ref={drawerRef} className="order-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
        <header className="order-drawer-header">
          <div>
            <span className="faint">Read-only validated order details</span>
            <h2 id={titleId} className="mono">Order {selection.orderId}</h2>
            <span className="faint">Scope: {selection.subaccountId ? "Selected subaccount" : "Main account"}</span>
          </div>
          <div className="row-flex" style={{ gap: 6 }}>
            <button type="button" className="btn sm ghost" onClick={onRetry} disabled={loading}><IconRefresh size={13} /> Retry</button>
            <button ref={closeRef} type="button" className="btn sm ghost" onClick={onClose} aria-label="Close order details">Close</button>
          </div>
        </header>
        <div className="order-drawer-body">
          {loading && <div className="notice info" role="status"><IconRefresh size={15} /><span>Loading validated order details and execution pages…</span></div>}
          {dataset?.error && !order && <DatasetMessages dataset={dataset} />}
          {order ? (
            <>
              <div className="order-detail-status"><Pill kind={order.status === "FILLED" ? "up" : "info"}>{order.status}</Pill><span className="faint">Physical ID and logical lineage are preserved separately.</span></div>
              <dl className="order-detail-grid">
                <DetailValue label="Order ID" value={order.orderId} mono />
                <DetailValue label="Market" value={order.marketSymbol ?? order.symbol} mono />
                <DetailValue label="Side / type" value={`${order.side} / ${order.orderType}`} />
                <DetailValue label="Lineage ID" value={order.lineageId} mono />
                <DetailValue label="Generation / version" value={`${order.generation} / ${order.version}`} />
                <DetailValue label="Price" value={<ExactValue value={order.price} />} />
                <DetailValue label="Original quantity" value={<ExactValue value={order.origQty} />} />
                <DetailValue label="Cumulative filled quantity" value={<ExactValue value={order.cumQty} />} />
                <DetailValue label="Remaining quantity" value={<ExactValue value={order.leavesQty} />} />
                <DetailValue label="Average execution price" value={<ExactValue value={order.avgPx} />} />
                <DetailValue label="Inherited cumulative quantity" value={order.inheritedCumQty === undefined ? "Unavailable" : <ExactValue value={order.inheritedCumQty} />} />
                <DetailValue label="Created at (source)" value={<span title={order.createdAt}>{orderTime(order.createdAt)}</span>} mono />
                <DetailValue label="Terminal at (source)" value={<span title={order.terminalAt}>{orderTime(order.terminalAt)}</span>} mono />
                <DetailValue label="Terminal reason" value={order.terminalReason === undefined ? "Unavailable" : order.terminalReason || "Not supplied / not terminal"} />
                <DetailValue label="Terminal reason code" value={order.terminalReasonCode === undefined ? "Unavailable" : order.terminalReasonCode} />
                <DetailValue label="Fee asset preference" value={order.feeAsset ?? "Unavailable"} />
                <DetailValue label="Time in force" value={order.tif ?? "Unavailable"} />
                <DetailValue label="Expiry (source)" value={order.expireAt === undefined ? "Unavailable" : <span title={order.expireAt}>{orderTime(order.expireAt)}</span>} mono />
                <DetailValue label="Post-only" value={order.postOnly === undefined ? "Unavailable" : order.postOnly ? "Yes" : "No"} />
                <DetailValue label="Self-trade prevention" value={order.stpMode ?? "Unavailable"} />
                <DetailValue label="Client order ID" value={order.clientOrderId === undefined ? "Unavailable" : order.clientOrderId || "None supplied"} mono />
              </dl>
              <div className="notice info" role="note" style={{ marginTop: 14 }}>Attached-risk policy/state, origin metadata, and settlement-leg details are not normalized in this drawer. They are unavailable here; no values are reconstructed. Execution fees below come from validated fills, not current fee rates.</div>
              <section className="order-executions" aria-labelledby={`${titleId}-executions`}>
                <div className="row-flex" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <h3 id={`${titleId}-executions`}>Lineage executions</h3>
                  <DatasetStatus dataset={dataset} loading={loading} />
                </div>
                <p className="faint">Returned by the order-details endpoint for this validated lineage through the requested generation. Physical order IDs can differ after replacement. The execution cursor is not an order-state or settlement reconciliation watermark.</p>
                {data!.executions.length > 0 ? <div className="table-wrap"><table className="data"><thead><tr><th className="align-left">Executed (UTC)</th><th>Market</th><th>Physical order</th><th>Generation</th><th>Match</th><th>Side</th><th>Quantity</th><th>Price</th><th>Actual fee / rebate</th><th>Maker / taker</th></tr></thead><tbody>
                  {data!.executions.map((fill) => {
                    const feeAsset = fill.feeAsset === "BASE" ? fill.baseAsset : fill.quoteAsset;
                    return <tr key={`${fill.symbol}-${fill.matchId}-${fill.orderId}`}><td className="align-left mono">{apiTime(fill.timestamp)}</td><td>{fill.marketSymbol ?? fill.symbol}</td><td className="mono">{fill.orderId}</td><td>{fill.generation ?? "Unavailable"}</td><td className="mono">{fill.matchId}</td><td>{fill.side}</td><td><ExactValue value={fill.quantity} /></td><td><ExactValue value={fill.price} /></td><td><span className="mono" title={fill.feeIsRebate ? "Actual execution rebate" : "Actual execution fee"}>{fill.feeIsRebate ? "+" : "−"}<ExactValue value={fill.feeMagnitude} /> {feeAsset} {fill.feeIsRebate ? "rebate" : "fee"}</span></td><td>{fill.isMaker === undefined ? "Unavailable" : fill.isMaker ? "Maker" : "Taker"}</td></tr>;
                  })}
                </tbody></table></div> : <EmptyState title="No validated lineage executions loaded" description={dataset?.coverage.status === "complete" ? "The validated execution cursor is exhausted with no rows; this is not independent proof of order or settlement reconciliation." : "Execution coverage is incomplete or rows were quarantined; no fill is inferred."} />}
                {dataset && <DatasetMessages dataset={dataset} />}
              </section>
            </>
          ) : data ? (
            <EmptyState title="Order not found in validated response" description="The endpoint returned no order object. No execution is associated with a missing order and no field is reconstructed." />
          ) : dataset ? (
            <NoDataset dataset={dataset} />
          ) : !loading ? (
            <EmptyState title="Order details unavailable" description="No validated order-details response is loaded. Retry the read; no synthetic order data is shown." />
          ) : null}
        </div>
      </aside>
    </div>
  );
}

export function AccountAnalytics({
  accountVault,
  session,
}: {
  accountVault: account.AccountVault | null;
  session: account.VaultSessionInfo | null;
}) {
  const [coordinator, setCoordinator] = useState<account.AccountDataCoordinator | null>(null);
  const [snapshot, setSnapshot] = useState<account.AccountDataSnapshot | null>(null);
  const [balanceHistory, setBalanceHistory] = useState<BalanceHistoryDataset | null>(null);
  const [openOrders, setOpenOrders] = useState<OpenOrdersDataset | null>(null);
  const [orderDetails, setOrderDetails] = useState<OrderDetailsDataset | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<OrderSelection | null>(null);
  const [range, setRange] = useState<account.AccountHistoryRange>("30d");
  const [loading, setLoading] = useState(false);
  const [balanceHistoryLoading, setBalanceHistoryLoading] = useState(false);
  const [openOrdersLoading, setOpenOrdersLoading] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [catalogReady, setCatalogReady] = useState(false);
  const [pendingExport, setPendingExport] = useState<{
    dataset: account.AccountExportDataset;
    format: account.AccountExportFormat;
  } | null>(null);
  const [transferAssetFilter, setTransferAssetFilter] = useState("ALL");
  const [transferDirectionFilter, setTransferDirectionFilter] = useState("ALL");
  const [transferReasonFilter, setTransferReasonFilter] = useState("ALL");
  const requestRef = useRef<AbortController | null>(null);
  const requestContextRef = useRef<string | null>(null);
  const activatedRef = useRef(false);
  const selectedOrderRef = useRef<OrderSelection | null>(null);
  const detailsRequestRef = useRef<AbortController | null>(null);
  const detailsGenerationRef = useRef(0);
  const marketsRef = useRef<Readonly<Record<string, account.FillMarket>>>({});

  useEffect(() => {
    if (!accountVault) return;
    const instance = new account.AccountDataCoordinator({ vault: accountVault });
    setCoordinator(instance);
    return () => {
      requestRef.current?.abort();
      detailsRequestRef.current?.abort();
      requestRef.current = null;
      detailsRequestRef.current = null;
      selectedOrderRef.current = null;
      instance.dispose();
      setCoordinator(null);
    };
  }, [accountVault]);

  useEffect(() => {
    requestRef.current?.abort();
    detailsRequestRef.current?.abort();
    requestRef.current = null;
    detailsRequestRef.current = null;
    requestContextRef.current = null;
    activatedRef.current = false;
    selectedOrderRef.current = null;
    marketsRef.current = {};
    detailsGenerationRef.current += 1;
    setSnapshot(null);
    setBalanceHistory(null);
    setOpenOrders(null);
    setOrderDetails(null);
    setSelectedOrder(null);
    setLocalError(null);
    setCatalogReady(false);
    setLoading(false);
    setBalanceHistoryLoading(false);
    setOpenOrdersLoading(false);
    setDetailsLoading(false);
    setPendingExport(null);
    setTransferAssetFilter("ALL");
    setTransferDirectionFilter("ALL");
    setTransferReasonFilter("ALL");
  }, [session?.generation]);

  useEffect(() => () => {
    requestRef.current?.abort();
    detailsRequestRef.current?.abort();
    selectedOrderRef.current = null;
  }, []);

  const secureContext = typeof window !== "undefined" && window.isSecureContext;
  const canAttempt = Boolean(
    secureContext && coordinator && session?.registeredKeyId && !loading,
  );

  const loadDetails = useCallback(async (selection: OrderSelection, preserve = false) => {
    if (!coordinator || !session || !accountVault || !secureContext || !session.registeredKeyId) return;
    detailsRequestRef.current?.abort();
    const controller = new AbortController();
    const generation = ++detailsGenerationRef.current;
    detailsRequestRef.current = controller;
    selectedOrderRef.current = selection;
    if (!preserve) setOrderDetails(null);
    setDetailsLoading(true);
    const isCurrent = () => (
      detailsRequestRef.current === controller &&
      detailsGenerationRef.current === generation &&
      !controller.signal.aborted &&
      selectedOrderRef.current?.orderId === selection.orderId &&
      selectedOrderRef.current?.subaccountId === selection.subaccountId
    );
    try {
      const next = await coordinator.loadOrderDetails({
        orderId: selection.orderId,
        ...(selection.subaccountId === undefined ? {} : { subaccountId: selection.subaccountId }),
        markets: marketsRef.current,
        signal: controller.signal,
      });
      if (isCurrent()) setOrderDetails(next);
    } catch (error) {
      if (isCurrent()) {
        const safe = account.safeAccountError(error, "orderDetails");
        setLocalError(`${safe.code}: ${errorText(safe)}`);
      }
    } finally {
      if (isCurrent()) {
        setDetailsLoading(false);
        detailsRequestRef.current = null;
      }
    }
  }, [accountVault, coordinator, secureContext, session]);

  const openDetails = useCallback((order: account.NormalizedOrder) => {
    const selection: OrderSelection = { orderId: order.orderId };
    selectedOrderRef.current = selection;
    setSelectedOrder(selection);
    setOrderDetails(null);
    void loadDetails(selection);
  }, [loadDetails]);

  const closeDetails = useCallback(() => {
    detailsRequestRef.current?.abort();
    detailsRequestRef.current = null;
    detailsGenerationRef.current += 1;
    selectedOrderRef.current = null;
    setSelectedOrder(null);
    setOrderDetails(null);
    setDetailsLoading(false);
  }, []);

  const load = useCallback(async (explicit = false) => {
    if (!coordinator || !session || !accountVault) return;
    // The first private read always requires the explicit button. Visibility
    // may refresh only a connection that the user already chose to verify.
    if (!explicit && !activatedRef.current) return;
    if (!secureContext) {
      if (explicit) setLocalError("A secure HTTPS browser context is required before an authenticated read can be attempted.");
      return;
    }
    if (!session.registeredKeyId) {
      if (explicit) setLocalError("Save the server-issued ak_... key ID before attempting an authenticated read.");
      return;
    }
    if (explicit) activatedRef.current = true;
    const contextKey = `${session.generation}:${range}`;
    if (requestRef.current && requestContextRef.current === contextKey) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    requestContextRef.current = contextKey;
    const isCurrent = () => requestRef.current === controller && !controller.signal.aborted;
    setLoading(true);
    setBalanceHistoryLoading(true);
    setOpenOrdersLoading(true);
    setPendingExport(null);
    setLocalError(null);
    try {
      const catalog = await account.fetchOfficialSpotCatalog({ signal: controller.signal });
      if (!isCurrent()) return;
      // The unsigned official catalog also supplies a server reference clock.
      // Apply only the server-minus-local offset to future signing timestamps.
      const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
      const skewMs = BigInt(catalog.tsSec) * 1_000n - BigInt(catalog.retrievedAtMs);
      if (skewMs > maxSafe || skewMs < -maxSafe) {
        throw new Error("The official catalog clock offset is outside the supported range.");
      }
      accountVault.setClockSkew(Number(skewMs));
      marketsRef.current = catalog.markets;
      setCatalogReady(true);
      const options = { range, markets: catalog.markets, signal: controller.signal };
      const tasks: Promise<void>[] = [
        coordinator.loadAll(options).then((next) => {
          if (isCurrent()) setSnapshot(next);
        }),
        coordinator.loadBalanceHistory(options).then((next) => {
          if (isCurrent()) setBalanceHistory(next);
        }).finally(() => {
          if (isCurrent()) setBalanceHistoryLoading(false);
        }),
        coordinator.loadOpenOrders(options).then((next) => {
          if (isCurrent()) setOpenOrders(next);
        }).finally(() => {
          if (isCurrent()) setOpenOrdersLoading(false);
        }),
      ];
      const selected = selectedOrderRef.current;
      if (selected) void loadDetails(selected, true);
      const results = await Promise.allSettled(tasks);
      if (isCurrent()) {
        const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
        if (rejected) {
          const safe = account.safeAccountError(rejected.reason);
          setLocalError(`${safe.code}: ${errorText(safe)}`);
        }
      }
    } catch (error) {
      if (isCurrent()) {
        const safe = account.safeAccountError(error);
        setLocalError(`${safe.code}: ${errorText(safe)}`);
      }
    } finally {
      if (isCurrent()) {
        setLoading(false);
        setBalanceHistoryLoading(false);
        setOpenOrdersLoading(false);
        requestRef.current = null;
        requestContextRef.current = null;
      }
    }
  }, [accountVault, coordinator, loadDetails, secureContext, session, range]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [load]);

  const datasets = snapshot ? [snapshot.balances, snapshot.equity, snapshot.orders, snapshot.fills, snapshot.transfers, snapshot.feeRates] : [];
  const allDatasets = [...datasets, ...(balanceHistory ? [balanceHistory] : []), ...(openOrders ? [openOrders] : [])];
  const successful = allDatasets.filter((dataset) => dataset.data !== null).length;
  const latest = allDatasets.reduce<number | null>((latest, dataset) => {
    if (!dataset.retrievedAtMs) return latest;
    return latest === null ? dataset.retrievedAtMs : Math.max(latest, dataset.retrievedAtMs);
  }, null);
  const hasIncomplete = allDatasets.some((dataset) => dataset.coverage.status !== "complete");
  const loadedTransfers = snapshot?.transfers.data?.transfers ?? null;
  const transferAssets = useMemo(
    () => [...new Set((loadedTransfers ?? []).map((transfer) => transfer.asset))].sort(),
    [loadedTransfers],
  );
  const transferReasons = useMemo(
    () => [...new Set((loadedTransfers ?? []).map((transfer) => transfer.reasonLabel))].sort(),
    [loadedTransfers],
  );
  const filteredTransfers = useMemo(() => (loadedTransfers ?? []).filter((transfer) => (
    (transferAssetFilter === "ALL" || transfer.asset === transferAssetFilter) &&
    (transferDirectionFilter === "ALL" || (transferDirectionFilter === "DEBIT" ? transfer.isDebit : !transfer.isDebit)) &&
    (transferReasonFilter === "ALL" || transfer.reasonLabel === transferReasonFilter)
  )), [loadedTransfers, transferAssetFilter, transferDirectionFilter, transferReasonFilter]);
  const transferFiltersActive = transferAssetFilter !== "ALL" || transferDirectionFilter !== "ALL" || transferReasonFilter !== "ALL";
  const resetTransferFilters = useCallback(() => {
    setTransferAssetFilter("ALL");
    setTransferDirectionFilter("ALL");
    setTransferReasonFilter("ALL");
  }, []);
  const requestExport = useCallback((dataset: account.AccountExportDataset, format: account.AccountExportFormat) => {
    setLocalError(null);
    setPendingExport({ dataset, format });
  }, []);
  const confirmExport = useCallback(() => {
    if (!snapshot || !pendingExport) return;
    try {
      const result = account.createAccountExport({
        snapshot,
        dataset: pendingExport.dataset,
        format: pendingExport.format,
        exportedAtMs: Date.now(),
        ...(pendingExport.dataset === "transfers" ? {
          transferRows: filteredTransfers,
          transferFilters: {
            asset: transferAssetFilter,
            direction: transferDirectionFilter,
            reason: transferReasonFilter,
          },
        } : {}),
      });
      downloadAccountExport(result);
    } catch {
      // Never surface a raw export error: source rows may contain private data.
      setLocalError("The export could not be created safely. No file was downloaded; check loaded-row coverage and try again.");
    } finally {
      setPendingExport(null);
    }
  }, [snapshot, pendingExport, filteredTransfers, transferAssetFilter, transferDirectionFilter, transferReasonFilter]);
  const connectionLabel = loading
    ? "Checking read-only endpoints…"
    : !session
      ? "Locked"
      : !session.registeredKeyId
        ? "Registered key ID required"
        : (snapshot || balanceHistory || openOrders)
          ? successful === 0
            ? "No read granted or available"
            : hasIncomplete
              ? "Partial read coverage"
              : "Validated read responses received"
          : "Ready for owner-controlled verification";

  return (
    <Card
      title="Account analytics"
      subtitle="Read-only balances, sampled balance/equity history, open and terminal orders, validated order details, fills, labeled transfer activity, current rates, and explicit loaded-row exports. Official SpotConfig pair mapping is loaded separately; public MCP tools remain independent."
      actions={<Pill kind={allDatasets.length > 0 && !hasIncomplete && successful > 0 ? "up" : "warn"}>{connectionLabel}</Pill>}
    >
      <div className="notice warn" role="note" style={{ marginBottom: 14 }}>
        <div>
          <strong>Live compatibility remains unverified.</strong>{" "}
          Authenticated GET reads are enabled, but each operation still succeeds or fails independently. Browser CORS, origin, and owner-controlled read-policy checks determine whether a real response is available; a response is not evidence of another permission.
        </div>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <div className="kv"><span className="k">Registered key ID</span><span className="v">{session?.registeredKeyId ? "Saved" : "Required"}</span></div>
        <div className="kv"><span className="k">Secure browser context</span><span className="v">{secureContext ? "Yes" : "No"}</span></div>
        <div className="kv"><span className="k">Authenticated GET reads</span><span className="v">Enabled</span></div>
        <div className="kv"><span className="k">Official pair catalog</span><span className="v">{catalogReady ? "SpotConfig validated" : "Required before fills"}</span></div>
        <div className="kv"><span className="k">CORS / permissions</span><span className="v">{snapshot ? "Per-operation result below" : "Not live-verified"}</span></div>
      </div>

      <div className="row-flex" style={{ gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <label className="field" style={{ minWidth: 180 }}>
          <span className="faint">Reporting period for balance/equity history, orders, and fills</span>
          <select className="select" value={range} onChange={(event) => {
            requestRef.current?.abort();
            detailsRequestRef.current?.abort();
            requestRef.current = null;
            detailsRequestRef.current = null;
            requestContextRef.current = null;
            detailsGenerationRef.current += 1;
            setSnapshot(null);
            setBalanceHistory(null);
            setOpenOrders(null);
            setOrderDetails(null);
            setSelectedOrder(null);
            selectedOrderRef.current = null;
            setLoading(false);
            setBalanceHistoryLoading(false);
            setOpenOrdersLoading(false);
            setDetailsLoading(false);
            setPendingExport(null);
            setRange(event.target.value as account.AccountHistoryRange);
          }} aria-label="Account reporting period">
            {RANGES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <button type="button" className="btn primary" disabled={!canAttempt} onClick={() => void load(true)}>
          <IconActivity size={14} /> {loading ? "Reading…" : allDatasets.length > 0 ? "Refresh read-only data" : "Verify & load read-only data"}
        </button>
        {allDatasets.length > 0 && <span className="faint"><IconClock size={12} /> {latest ? `Latest response ${fmtAgo(latest)}` : "No successful response timestamp"}</span>}
      </div>
      {localError && <div className="notice error" role="alert" style={{ marginBottom: 14 }}><IconAlert size={15} /><span>{localError}</span></div>}
      <p className="faint">Amounts retain the API's exact decimal strings; no additional scale divisor is applied. Rounded display never updates the underlying exact arithmetic.</p>

      <BalanceHistoryCard dataset={balanceHistory} loading={balanceHistoryLoading} range={range} />
      <OpenOrdersCard dataset={openOrders} loading={openOrdersLoading} onDetails={openDetails} />

      {snapshot && (
        <>
          <MetricStrip>
            <MetricCell label="Reporting period" value={snapshot.period.range} sub={`${snapshot.period.startTime} → ${snapshot.period.endTime}`} />
            <MetricCell label="Datasets with responses" value={`${successful}/8`} sub="A response is not a permission grant for other reads" />
            <MetricCell label="Latest freshness" value={latest ? fmtAgo(latest) : "—"} sub="Per-dataset timestamps remain authoritative" />
            <MetricCell label="P&L" value="Unavailable" sub="Opening basis, complete flows, and fresh marks are not yet verified" />
          </MetricStrip>

          <Card title="Current balances" subtitle="Total = trading + funding. Reserved and available are not added again." actions={<DatasetActions dataset={snapshot.balances} name="balances" rowCount={snapshot.balances.data?.balances.length ?? 0} onExport={requestExport} />}>
            {snapshot.balances.data ? (
              <>
                <div className="table-wrap">
                  <table className="data">
                    <thead><tr><th className="align-left">Asset</th><th>Trading</th><th>Funding</th><th>Total</th><th>Reserved</th><th>Available</th></tr></thead>
                    <tbody>{snapshot.balances.data.balances.map((balance) => (
                      <tr key={balance.symbol}>
                        <td className="align-left mono">{balance.asset}</td>
                        <td><ExactValue value={balance.trading} /></td>
                        <td><ExactValue value={balance.funding} /></td>
                        <td><ExactValue value={account.totalBalance(balance)} /></td>
                        <td>{balance.reserved !== undefined ? <ExactValue value={balance.reserved} /> : "—"}</td>
                        <td>{balance.available !== undefined ? <ExactValue value={balance.available} /> : "—"}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                {snapshot.balances.data.balances.length === 0 && <EmptyState title="Empty validated balance response" description="The server returned zero balance rows; this is distinct from a denied or unavailable read." />}
                <DatasetMessages dataset={snapshot.balances} />
              </>
            ) : <><NoDataset dataset={snapshot.balances} /><DatasetMessages dataset={snapshot.balances} /></>}
          </Card>

          <Card title="Sampled equity history" subtitle="Sampled valuation only — never live equity or P&L. Point timestamps are not invented when the server does not supply them." actions={<DatasetActions dataset={snapshot.equity} name="equity" rowCount={snapshot.equity.data?.response.series.reduce((count, series) => count + series.equity.length, 0) ?? 0} onExport={requestExport} />}>
            {snapshot.equity.data ? (
              <>
                <div className="faint" style={{ marginBottom: 10 }}>
                  Server bounds: {snapshot.equity.data.response.startTsSec !== undefined ? apiTime(String(snapshot.equity.data.response.startTsSec * 1000), "millis") : "not supplied"} → {snapshot.equity.data.response.endTsSec !== undefined ? apiTime(String(snapshot.equity.data.response.endTsSec * 1000), "millis") : "not supplied"}
                </div>
                {snapshot.equity.data.seriesMetrics.length > 0 ? <div className="table-wrap"><table className="data"><thead><tr><th className="align-left">Series</th><th>Samples</th><th>First</th><th>Latest</th><th>Change</th><th>Max drawdown</th></tr></thead><tbody>
                  {snapshot.equity.data.seriesMetrics.map((metrics, index) => {
                    const series = snapshot.equity.data?.response.series[index];
                    const label = series?.asset?.symbol ?? series?.account?.name ?? `Series ${index + 1}`;
                    return <tr key={`${label}-${index}`}><td className="align-left">{label}</td><td>{metrics.sampleCount}</td><td>{metrics.start ? <ExactValue value={metrics.start} /> : "—"}</td><td>{metrics.latest ? <ExactValue value={metrics.latest} /> : "—"}</td><td>{metrics.change ? <ExactValue value={metrics.change} /> : "—"}</td><td>{metrics.maxDrawdownAbsolute ? <ExactValue value={metrics.maxDrawdownAbsolute} /> : "—"}</td></tr>;
                  })}
                </tbody></table></div> : <EmptyState title="No equity series in validated response" description="No sampled value is inferred from an empty or unavailable series." />}
                <DatasetMessages dataset={snapshot.equity} />
              </>
            ) : <><NoDataset dataset={snapshot.equity} /><DatasetMessages dataset={snapshot.equity} /></>}
          </Card>

          <Card title="Order history" subtitle="Terminal order reads use the selected time window and opaque cursor chain. No cancellation or order-placement action is available." actions={<DatasetActions dataset={snapshot.orders} name="orders" rowCount={snapshot.orders.data?.orders.length ?? 0} onExport={requestExport} />}>
            {snapshot.orders.data ? (
              <>
                {snapshot.orders.data.orders.length > 0 ? <div className="table-wrap"><table className="data"><thead><tr><th className="align-left">Order</th><th>Market</th><th>Side</th><th>Status</th><th>Price</th><th>Original qty</th><th>Filled qty</th><th>Created</th><th>Details</th></tr></thead><tbody>
                  {snapshot.orders.data.orders.map((order) => <tr key={`${order.orderId}-${order.generation}`}><td className="align-left mono">{order.orderId}</td><td>{order.marketSymbol ?? order.symbol}</td><td>{order.side}</td><td><Pill kind={order.status === "FILLED" ? "up" : "info"}>{order.status}</Pill></td><td><ExactValue value={order.price} /></td><td><ExactValue value={order.origQty} /></td><td><ExactValue value={order.cumQty} /></td><td className="mono">{apiTime(order.createdAt)}</td><td><button type="button" className="btn sm ghost order-details-trigger" onClick={() => openDetails(order)} aria-label={`View details for order ${order.orderId}`}>Details</button></td></tr>)}
                </tbody></table></div> : <EmptyState title="No orders in validated coverage" description="An empty validated result is shown as empty; incomplete or denied history is not converted to zero orders." />}
                <DatasetMessages dataset={snapshot.orders} />
              </>
            ) : <><NoDataset dataset={snapshot.orders} /><DatasetMessages dataset={snapshot.orders} /></>}
          </Card>

          <Card title="Fills and actual execution fees" subtitle="Fees come from execution records, grouped by their real fee asset. Net quote flow is observed activity, not profit." actions={<DatasetActions dataset={snapshot.fills} name="fills" rowCount={snapshot.fills.data?.summary.calculations.length ?? 0} onExport={requestExport} />}>
            {snapshot.fills.data ? (
              <>
                {account.observedFillEligibility(snapshot.fills.data.summary, snapshot.fills.coverage).available ? (
                  <>
                    {snapshot.fills.data.summary.feesByAsset.length > 0 && <div className="table-wrap" style={{ marginBottom: 14 }}><table className="data"><thead><tr><th className="align-left">Fee asset</th><th>Gross charges</th><th>Gross rebates</th><th>Net actual fees</th></tr></thead><tbody>
                      {snapshot.fills.data.summary.feesByAsset.map((fee) => <tr key={fee.asset}><td className="align-left mono">{fee.asset}</td><td><ExactValue value={fee.grossCharges} digits={18} /></td><td><ExactValue value={fee.grossRebates} digits={18} /></td><td><ExactValue value={fee.netFees} digits={18} /></td></tr>)}
                    </tbody></table></div>}
                    {snapshot.fills.data.summary.calculations.length > 0 ? <div className="table-wrap"><table className="data"><thead><tr><th className="align-left">Fill</th><th>Market</th><th>Side</th><th>Quantity</th><th>Price</th><th>Observed net quote flow</th><th>Executed</th></tr></thead><tbody>
                      {snapshot.fills.data.summary.calculations.map((calculation) => <tr key={`${calculation.fill.symbol}-${calculation.fill.matchId}-${calculation.fill.orderId}`}><td className="align-left mono">{calculation.fill.matchId}</td><td>{calculation.fill.marketSymbol ?? calculation.fill.symbol}</td><td>{calculation.fill.side}</td><td><ExactValue value={calculation.fill.quantity} /></td><td><ExactValue value={calculation.fill.price} /></td><td><ExactValue value={calculation.dQuote} digits={18} /></td><td className="mono">{apiTime(calculation.fill.timestamp)}</td></tr>)}
                    </tbody></table></div> : <EmptyState title="No fills in validated coverage" description="No fee or volume value is inferred when the validated fill set is empty." />}
                  </>
                ) : <div className="notice error" role="alert"><IconAlert size={15} /><span>Conflicting or unknown fill rows block all affected fee and flow aggregates. Raw rows are not silently repaired.</span></div>}
                <DatasetMessages dataset={snapshot.fills} />
              </>
            ) : <><NoDataset dataset={snapshot.fills} /><DatasetMessages dataset={snapshot.fills} /></>}
          </Card>

          <Card title="Finalized transfer activity" subtitle="Read-only transfer legs. This endpoint has no reporting-period filter in the verified friendly contract; coverage is shown separately. Deposits and transfers are capital/activity flows, not profit." actions={<DatasetActions dataset={snapshot.transfers} name="transfers" rowCount={filteredTransfers.length} onExport={requestExport} />}>
            {snapshot.transfers.data ? (
              <>
                {snapshot.transfers.data.transfers.length > 0 && (
                  <>
                    <div className="notice info" role="note" style={{ marginBottom: 10 }}>
                      <span><strong>Filter loaded rows.</strong> These client-side filters do not change server coverage, request a time/code partition, or prove complete history.</span>
                    </div>
                    <div className="row-flex" style={{ gap: 8, flexWrap: "wrap", marginBottom: 12, alignItems: "flex-end" }}>
                      <label className="field" style={{ minWidth: 130 }}>
                        <span className="faint">Loaded asset</span>
                        <select className="select" value={transferAssetFilter} onChange={(event) => setTransferAssetFilter(event.target.value)} aria-label="Filter loaded transfer rows by asset">
                          <option value="ALL">All loaded assets</option>
                          {transferAssets.map((asset) => <option key={asset} value={asset}>{asset}</option>)}
                        </select>
                      </label>
                      <label className="field" style={{ minWidth: 130 }}>
                        <span className="faint">Direction</span>
                        <select className="select" value={transferDirectionFilter} onChange={(event) => setTransferDirectionFilter(event.target.value)} aria-label="Filter loaded transfer rows by direction">
                          <option value="ALL">All directions</option>
                          <option value="DEBIT">Debit</option>
                          <option value="CREDIT">Credit</option>
                        </select>
                      </label>
                      <label className="field" style={{ minWidth: 170 }}>
                        <span className="faint">Activity</span>
                        <select className="select" value={transferReasonFilter} onChange={(event) => setTransferReasonFilter(event.target.value)} aria-label="Filter loaded transfer rows by activity">
                          <option value="ALL">All loaded activities</option>
                          {transferReasons.map((reason) => <option key={reason} value={reason}>{reason}</option>)}
                        </select>
                      </label>
                      <button type="button" className="btn sm ghost" disabled={!transferFiltersActive} onClick={resetTransferFilters}>Reset loaded-row filters</button>
                      <span className="faint" role="status">Showing {filteredTransfers.length} of {snapshot.transfers.data.transfers.length} loaded rows</span>
                    </div>
                  </>
                )}
                {snapshot.transfers.data.transfers.length > 0 ? (
                  filteredTransfers.length > 0 ? <div className="table-wrap"><table className="data"><thead><tr><th className="align-left">Time (UTC)</th><th>Reason</th><th>Asset</th><th>Signed amount</th><th>Direction</th><th>Affected bucket</th><th>Source → destination</th><th>Balance after</th></tr></thead><tbody>
                    {filteredTransfers.map((transfer, index) => <tr key={`${transfer.timestamp}-${transfer.linkId}-${index}`}><td className="align-left mono">{apiTime(transfer.timestamp, "micros")}</td><td><span>{transfer.reasonLabel}</span>{!transfer.reasonKnown && <span className="faint mono" title="Unrecognized contract transfer code"> ({transfer.transferCode})</span>}</td><td className="mono">{transfer.asset}</td><td><span className="mono">{transfer.isDebit ? "−" : "+"}<ExactValue value={transfer.amount} digits={18} /></span></td><td>{transfer.isDebit ? "Debit" : "Credit"}</td><td>{account.transferBucketLabel(transfer.account)}</td><td>{account.transferSideLabel(transfer.source.kind)} → {account.transferSideLabel(transfer.destination.kind)}</td><td><ExactValue value={transfer.balanceAfter} digits={18} /></td></tr>)}
                  </tbody></table></div> : <div><EmptyState title="No loaded rows match these filters" description="The filtered result is empty only for the currently loaded rows; it is not a server-complete empty history." /><button type="button" className="btn sm ghost" onClick={resetTransferFilters}>Reset loaded-row filters</button></div>
                ) : <EmptyState title="No transfers in validated coverage" description="No transfer or cash-flow value is inferred from unavailable history." />}
                <DatasetMessages dataset={snapshot.transfers} />
              </>
            ) : <><NoDataset dataset={snapshot.transfers} /><DatasetMessages dataset={snapshot.transfers} /></>}
          </Card>

          <Card title="Current effective fee-rate snapshot" subtitle="Current rates are not historical execution fees. Actual fees above come only from fills." actions={<DatasetActions dataset={snapshot.feeRates} name="feeRates" rowCount={snapshot.feeRates.data?.feeRates.length ?? 0} onExport={requestExport} />}>
            {snapshot.feeRates.data ? (
              <>
                {snapshot.feeRates.data.feeRates.length > 0 ? <div className="table-wrap"><table className="data"><thead><tr><th className="align-left">Market</th><th>VIP tier</th><th>Maker rate</th><th>Taker rate</th></tr></thead><tbody>
                  {snapshot.feeRates.data.feeRates.map((rate) => <tr key={rate.symbol}><td className="align-left mono">{rate.symbol}</td><td>{rate.vipTier}</td><td><ExactValue value={rate.makerFeeRatePercent} digits={18} />%</td><td><ExactValue value={rate.takerFeeRatePercent} digits={18} />%</td></tr>)}
                </tbody></table></div> : <EmptyState title="No current fee-rate rows" description="A missing current rate is not treated as a zero fee." />}
                <DatasetMessages dataset={snapshot.feeRates} />
              </>
            ) : <><NoDataset dataset={snapshot.feeRates} /><DatasetMessages dataset={snapshot.feeRates} /></>}
          </Card>

          <Card title="Profit & loss remains unavailable" subtitle="Observed fills, deposits, equity changes, and net quote flow are not profit.">
            <div className="notice info" role="note"><IconAlert size={15} /><span>Realized and unrealized P&L require opening lots, complete fills, resolved non-fill cash flows, and a fresh labeled valuation mark. Those gates are not yet established by this read-only integration, so no P&L number is displayed.</span></div>
          </Card>
        </>
      )}

      {allDatasets.length === 0 && !loading && (
        <EmptyState
          icon={<IconActivity size={22} />}
          title="No account analytics response loaded"
          description="Unlock a registered read-only key, then explicitly verify and load the independent GET datasets. No synthetic fixture is presented as account data."
        />
      )}
      {loading && <div className="notice info" role="status"><IconRefresh size={15} /><span>Reading independent GET datasets. Loading indicators are not account values; each result will retain its own coverage and permission state.</span></div>}
      {selectedOrder && <OrderDetailsDrawer selection={selectedOrder} dataset={orderDetails} loading={detailsLoading} onClose={closeDetails} onRetry={() => void loadDetails(selectedOrder, true)} />}
      <ConfirmDialog
        open={pendingExport !== null}
        title="Download private financial activity?"
        message={pendingExport && snapshot ? (
          <div>
            <p>{account.ACCOUNT_EXPORT_PRIVATE_WARNING}</p>
            <p>Dataset: <strong>{pendingExport.dataset}</strong> · Format: <strong>{pendingExport.format.toUpperCase()}</strong> · Coverage: <strong>{snapshot[pendingExport.dataset].coverage.status}</strong>.</p>
            <p className="faint">Only explicitly projected loaded rows and a coverage manifest are included. This is not complete history, a tax statement, or a P&amp;L statement. Credentials, cursors, raw account IDs, addresses, and secret-bearing errors are excluded.</p>
          </div>
        ) : ""}
        confirmLabel={pendingExport ? `Download ${pendingExport.format.toUpperCase()}` : "Download"}
        danger={false}
        onConfirm={confirmExport}
        onCancel={() => setPendingExport(null)}
      />
    </Card>
  );
}
