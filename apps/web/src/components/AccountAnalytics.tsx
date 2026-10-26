import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { account, fmtAgo } from "@poly/core";
import { Card, ConfirmDialog, EmptyState, MetricCell, MetricStrip, Pill } from "./ui";
import { IconActivity, IconAlert, IconClock, IconRefresh } from "./icons";
import { downloadAccountExport } from "../lib/download";
import { useDialogFocus } from "../lib/dialogFocus";
import { AccountCostBasis } from "./AccountCostBasis";

const RANGES: account.AccountHistoryRange[] = ["1d", "7d", "30d", "90d", "180d", "365d"];
const RANGE_LABELS: Record<account.AccountHistoryRange, string> = {
  "1d": "Last 1 day",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "180d": "Last 180 days",
  "365d": "Last 365 days",
};

function isAccountHistoryRange(value: string): value is account.AccountHistoryRange {
  return RANGES.some((range) => range === value);
}

function rangeLabel(value: string): string {
  return isAccountHistoryRange(value) ? RANGE_LABELS[value] : value;
}

type AccountAnalyticsView = "overview" | "trades" | "orders" | "transfers" | "pnl";

const VIEW_COPY: Record<AccountAnalyticsView, { emptyTitle: string }> = {
  overview: { emptyTitle: "No account data loaded" },
  trades: { emptyTitle: "Your Trades are not loaded" },
  orders: { emptyTitle: "Your Orders are not loaded" },
  transfers: { emptyTitle: "Your money movements are not loaded" },
  pnl: { emptyTitle: "Profit and loss inputs are not loaded" },
};

const CURSOR_IMPORT_OPERATIONS: Record<AccountAnalyticsView, readonly account.AccountCursorImportOperation[]> = {
  overview: [],
  trades: ["fills"],
  orders: ["orders"],
  transfers: ["transfers"],
  pnl: ["fills", "transfers"],
};

type AnyDataset = {
  data: unknown | null;
  coverage: account.Coverage;
  retrievedAtMs: number | null;
  error?: account.SafeAccountError;
};

function errorText(error?: account.SafeAccountError): string {
  if (!error) return "";
  switch (error.code) {
    case "PERMISSION_DENIED": return "Your account key does not have permission to read this information. No rows were inferred.";
    case "UNAUTHENTICATED": return "We could not verify your account connection. Check the registered key ID and that the key is still active.";
    case "CORS_BLOCKED": return "Your browser could not reach the account service. No proxy or public-data fallback was used.";
    case "TIMESTAMP_SKEW": return "The account service rejected your device clock. Check the date and time before retrying.";
    case "SIGNATURE_INVALID": return "The account service rejected the request signature. Automatic signing retries are stopped.";
    case "SCHEMA_INCOMPATIBLE": return "The account service returned a format this app does not understand. Affected numbers are blocked.";
    case "CONTRACT_CONFLICT": return "The request could not be made safely because the account API formats disagree. The read was stopped.";
    case "ACCOUNT_STALE": return "Your account connection changed. Late private data was discarded; unlock and load again.";
    case "ABORTED": return "This account read was cancelled before it finished.";
    case "TIMEOUT": return "The account service took too long to respond. Try again; no private response was retained.";
    case "RATE_LIMITED": return "The account service asked us to slow down. You can retry after a short wait.";
    case "SERVER": return "The account service is temporarily unavailable. Try again later; no public data was substituted.";
    default: return "The account read failed safely. No private response was retained and no public data was substituted.";
  }
}

function statusKind(status?: account.CoverageStatus): "up" | "down" | "warn" | "info" {
  if (status === "complete" || status === "filter-complete") return "up";
  if (status === "denied" || status === "blocked" || status === "unavailable") return "down";
  if (status === "partial" || status === "stale" || status === "loading") return "warn";
  return "info";
}

const STATUS_LABELS: Record<account.CoverageStatus, string> = {
  complete: "Data loaded",
  "filter-complete": "Filtered data loaded",
  partial: "Partial data",
  stale: "May be out of date",
  denied: "Permission needed",
  blocked: "Unavailable",
  unavailable: "Unavailable",
  loading: "Loading",
};

export function DatasetStatus({ dataset, loading = false }: { dataset?: AnyDataset | null; loading?: boolean }) {
  if (!dataset) return <Pill kind={loading ? "info" : undefined}>{loading ? "Loading" : "Not loaded"}</Pill>;
  const status = dataset.coverage.status;
  return (
    <span className="row-flex" style={{ gap: 6, justifyContent: "flex-end" }}>
      <Pill kind={statusKind(status)}>{STATUS_LABELS[status]}</Pill>
      {loading && <Pill kind="info">Refreshing</Pill>}
      {dataset.retrievedAtMs && (
        <span className="faint" title={`Last account response: ${new Date(dataset.retrievedAtMs).toISOString()}`}>
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
  const label = covered ? "Export validated rows" : "Export loaded rows";
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

export function DatasetMessages({ dataset, fixedRange = false }: { dataset: AnyDataset; fixedRange?: boolean }) {
  const coverage = dataset.coverage;
  return (
    <>
      {dataset.error && (
        <div className="notice error" role="alert" style={{ marginBottom: 10 }} title={`Technical error code: ${dataset.error.code}`}>
          <IconAlert size={15} />
          <span>{errorText(dataset.error)}</span>
        </div>
      )}
      {(coverage.status === "partial" || coverage.status === "stale") && !dataset.error && (
        <div className="notice warn" role="note" style={{ marginBottom: 10 }}>
          <span>{coverage.status === "stale" ? "This data may be out of date. " : "Only part of the requested data is loaded. "}Figures use loaded rows only — not a complete history.</span>
        </div>
      )}
      <div
        className="faint"
        style={{ marginTop: 10 }}
        title="How much of the response was validated — not proof that your account has no other activity."
      >
        Data loaded: {coverage.rowsAccepted}/{coverage.rowsReceived} rows · {coverage.pagesFetched} {fixedRange ? "fixed-period response" : `page${coverage.pagesFetched === 1 ? "" : "s"}`} · {fixedRange ? "fixed server time window" : coverage.cursorExhausted ? "all available pages loaded" : "more pages may remain"}
        {coverage.duplicateRows > 0 && ` · ${coverage.duplicateRows} duplicate row${coverage.duplicateRows === 1 ? "" : "s"}`}
        {coverage.conflictingRows > 0 && ` · ${coverage.conflictingRows} conflicting row${coverage.conflictingRows === 1 ? "" : "s"}`}
        {coverage.unknownRows > 0 && ` · ${coverage.unknownRows} unrecognized row${coverage.unknownRows === 1 ? "" : "s"}`}
        {coverage.stoppedAtCap && " · page limit reached"}
      </div>
    </>
  );
}

export function NoDataset({ dataset }: { dataset: AnyDataset }) {
  const status = dataset.coverage.status;
  const title = status === "denied" ? "Permission needed" : status === "blocked" || status === "unavailable" ? "Account data unavailable" : status === "stale" ? "Previous account data is unavailable" : "No account data loaded";
  return (
    <EmptyState
      title={title}
      description="The read was not validated, so no figures are shown. This does not mean your account is empty."
    />
  );
}

function ExactValue({ value, digits = 18 }: { value: account.ExactDecimal | string; digits?: number }) {
  try {
    const parsed = typeof value === "string" ? account.parseDecimal(value) : value;
    const raw = typeof value === "string" ? value : value.raw;
    return <span className="mono" title={`Exact value returned by the account service: ${raw}`}>{account.formatDecimal(parsed, digits)}</span>;
  } catch {
    return <span className="mono">Unavailable</span>;
  }
}

export function ExecutionFee({ fill }: { fill: account.FillInput }) {
  const feeAsset = fill.feeAsset === "BASE" ? fill.baseAsset : fill.quoteAsset;
  return (
    <span className="mono" title={fill.feeIsRebate ? "Actual execution rebate" : "Actual execution fee"}>
      {fill.feeIsRebate ? "+" : "−"}<ExactValue value={fill.feeMagnitude} /> {feeAsset} {fill.feeIsRebate ? "rebate" : "fee"}
    </span>
  );
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
            <caption className="faint">API 1e7-scaled chart units; no extra divisor.</caption>
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
      title="Balance History"
      subtitle="Past samples per asset in the service's fixed chart units. Not current balances or profit."
      actions={<DatasetStatus dataset={dataset} loading={loading} />}
    >
      {loading && <div className="notice info" role="status" style={{ marginBottom: 10 }}><IconRefresh size={15} /><span>Refreshing. Previous samples keep their last update time.</span></div>}
      {data ? (
        <>
          <div className="faint" style={{ marginBottom: 10 }}>
            Time period: <strong>{rangeLabel(data.range)}</strong> (requested {rangeLabel(range)}) · Sample interval: {data.bucket ?? "not supplied"} · Samples: {data.points ?? "aligned by series"} · Start: {epochSecondsTime(data.startTsSec)} · End: {epochSecondsTime(data.endTsSec)}
          </div>
          {!data.timing.available && <div className="notice warn" role="note" style={{ marginBottom: 10 }}>The service did not supply complete sample times. Order is preserved; no dates are invented.</div>}
          {data.series.length > 0 ? data.series.map((series, index) => <BalanceHistorySeriesView key={`${series.asset}-${series.account}-${index}`} data={data} series={series} index={index} />) : (
            <EmptyState title="No balance history in this response" description="Nothing was returned for the selected period." />
          )}
          <DatasetMessages dataset={dataset!} fixedRange />
        </>
      ) : dataset ? (
        <><NoDataset dataset={dataset} /><DatasetMessages dataset={dataset} fixedRange /></>
      ) : !loading ? (
        <EmptyState title="Balance history is not loaded" description="Choose Load account data." />
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
      title="Open Orders"
      subtitle="Unfinished orders. Read-only — no cancel or modify."
      actions={<DatasetStatus dataset={dataset} loading={loading} />}
    >
      {loading && <div className="notice info" role="status" style={{ marginBottom: 10 }}><IconRefresh size={15} /><span>Refreshing open orders.</span></div>}
      {data ? (
        <>
          {data.orders.length > 0 ? <div className="table-wrap"><table className="data"><thead><tr><th className="align-left">Order</th><th>Market</th><th>Side</th><th>Type</th><th>Status</th><th>Price</th><th>Original qty</th><th>Filled qty</th><th>Remaining</th><th>Created</th><th>Details</th></tr></thead><tbody>
            {data.orders.map((order) => <tr key={`${order.orderId}-${order.generation}`}><td className="align-left mono">{order.orderId}</td><td>{order.marketSymbol ?? order.symbol}</td><td>{order.side}</td><td>{order.orderType}</td><td><Pill kind="info">{order.status}</Pill></td><td><ExactValue value={order.price} /></td><td><ExactValue value={order.origQty} /></td><td><ExactValue value={order.cumQty} /></td><td><ExactValue value={order.leavesQty} /></td><td className="mono">{apiTime(order.createdAt)}</td><td><button type="button" className="btn sm ghost order-details-trigger" onClick={() => onDetails(order)} aria-label={`View details for order ${order.orderId}`}>Details</button></td></tr>)}
          </tbody></table></div> : complete ? (
            <EmptyState title="No open orders in the loaded response" description="The service returned no open orders for this account and filter." />
          ) : (
            <EmptyState title="No open-order rows loaded" description={`The data status is ${STATUS_LABELS[dataset?.coverage.status ?? "unavailable"]}. Not proof that you have no open orders.`} />
          )}
          <DatasetMessages dataset={dataset!} />
        </>
      ) : dataset ? (
        <><NoDataset dataset={dataset} /><DatasetMessages dataset={dataset} /></>
      ) : !loading ? (
        <EmptyState title="Open orders are not loaded" description="Choose Load account data." />
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
  const closeRef = useRef<HTMLButtonElement>(null);
  const data = dataset?.data ?? null;
  const order = data?.order ?? null;

  // Focus behaviour comes from the shared hook; this drawer keeps its own
  // "Close" button as the initial target.
  const drawerRef = useDialogFocus<HTMLElement>(true, onClose, { initialFocus: closeRef });

  return (
    <div className="order-drawer-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }} role="presentation">
      <aside ref={drawerRef} className="order-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId} onClick={(event) => event.stopPropagation()}>
        <header className="order-drawer-header">
          <div>
            <span className="faint">Read-only order details from your account</span>
            <h2 id={titleId} className="mono">Order {selection.orderId}</h2>
            <span className="faint">Scope: {selection.subaccountId ? "Selected subaccount" : "Main account"}</span>
          </div>
          <div className="row-flex" style={{ gap: 6 }}>
            <button type="button" className="btn sm ghost" onClick={onRetry} disabled={loading}><IconRefresh size={13} /> Try again</button>
            <button ref={closeRef} type="button" className="btn sm ghost" onClick={onClose} aria-label="Close order details">Close</button>
          </div>
        </header>
        <div className="order-drawer-body">
          {loading && <div className="notice info" role="status"><IconRefresh size={15} /><span>Loading order details and linked trades…</span></div>}
          {dataset?.error && !order && <DatasetMessages dataset={dataset} />}
          {order ? (
            <>
              <div className="order-detail-status"><Pill kind={order.status === "FILLED" ? "up" : "info"}>{order.status}</Pill><span className="faint">Order replacements and linked trades keep their original IDs.</span></div>
              <dl className="order-detail-grid">
                <DetailValue label="Order ID" value={order.orderId} mono />
                <DetailValue label="Market" value={order.marketSymbol ?? order.symbol} mono />
                <DetailValue label="Side / type" value={`${order.side} / ${order.orderType}`} />
                <DetailValue label="Order family ID" value={order.lineageId} mono />
                <DetailValue label="Replacement / state version" value={`${order.generation} / ${order.version}`} />
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
              <div className="notice info" role="note" style={{ marginTop: 14 }}>Not shown: some risk, origin, and settlement-leg fields. Fees come from linked executions, not current rates.</div>
              <section className="order-executions" aria-labelledby={`${titleId}-executions`}>
                <div className="row-flex" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                  <h3 id={`${titleId}-executions`}>Trades linked to this order</h3>
                  <DatasetStatus dataset={dataset} loading={loading} />
                </div>
                <p className="faint">Linked through the requested replacement; order IDs can change. Not proof of complete settlement.</p>
                {data!.executions.length > 0 ? <div className="table-wrap"><table className="data"><thead><tr><th className="align-left">Executed (UTC)</th><th>Market</th><th>Order ID for this execution</th><th>Replacement</th><th>Match</th><th>Side</th><th>Quantity</th><th>Price</th><th>Actual fee / rebate</th><th>Maker / taker</th></tr></thead><tbody>
                  {data!.executions.map((fill) => <tr key={`${fill.symbol}-${fill.matchId}-${fill.orderId}`}><td className="align-left mono">{apiTime(fill.timestamp)}</td><td>{fill.marketSymbol ?? fill.symbol}</td><td className="mono">{fill.orderId}</td><td>{fill.generation ?? "Unavailable"}</td><td className="mono">{fill.matchId}</td><td>{fill.side}</td><td><ExactValue value={fill.quantity} /></td><td><ExactValue value={fill.price} /></td><td><ExecutionFee fill={fill} /></td><td>{fill.isMaker === undefined ? "Unavailable" : fill.isMaker ? "Maker" : "Taker"}</td></tr>)}
                </tbody></table></div> : <EmptyState title="No linked trades loaded" description={dataset?.coverage.status === "complete" ? "The account service returned no linked trades. This does not prove that order settlement is complete." : "The linked-trade data is incomplete or contains unrecognized rows. No trade is inferred."} />}
                {dataset && <DatasetMessages dataset={dataset} />}
              </section>
            </>
          ) : data ? (
            <EmptyState title="Order not found in validated response" description="The endpoint returned no order object." />
          ) : dataset ? (
            <NoDataset dataset={dataset} />
          ) : !loading ? (
            <EmptyState title="Order details unavailable" description="No validated response loaded. Try again." />
          ) : null}
        </div>
      </aside>
    </div>
  );
}

export function AccountAnalytics({
  accountVault,
  session,
  view = "overview",
}: {
  accountVault: account.AccountVault | null;
  session: account.VaultSessionInfo | null;
  view?: AccountAnalyticsView;
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
  const [importing, setImporting] = useState(false);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [importPageCap, setImportPageCap] = useState(500);
  const [importProgress, setImportProgress] = useState<Partial<Record<account.AccountCursorImportOperation, account.AccountCursorProgress>>>({});
  const requestRef = useRef<AbortController | null>(null);
  const importRequestRef = useRef<AbortController | null>(null);
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
      importRequestRef.current?.abort();
      requestRef.current = null;
      detailsRequestRef.current = null;
      importRequestRef.current = null;
      selectedOrderRef.current = null;
      instance.dispose();
      setCoordinator(null);
    };
  }, [accountVault]);

  useEffect(() => {
    requestRef.current?.abort();
    detailsRequestRef.current?.abort();
    importRequestRef.current?.abort();
    requestRef.current = null;
    detailsRequestRef.current = null;
    importRequestRef.current = null;
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
    setImporting(false);
    setImportNotice(null);
    setImportProgress({});
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
    importRequestRef.current?.abort();
    selectedOrderRef.current = null;
  }, []);

  const secureContext = typeof window !== "undefined" && window.isSecureContext;
  const canAttempt = Boolean(
    secureContext && coordinator && session?.registeredKeyId && !loading && !importing,
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
    if (!coordinator || !session || !accountVault || importRequestRef.current) return;
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
    setImportNotice(null);
    setImportProgress({});
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

  const importHistory = useCallback(async () => {
    if (!coordinator || !session || !accountVault || !secureContext || !session.registeredKeyId || !snapshot || !catalogReady || loading || importRequestRef.current) return;
    const controller = new AbortController();
    importRequestRef.current = controller;
    const period = { ...snapshot.period };
    const isCurrent = () => importRequestRef.current === controller && !controller.signal.aborted;
    setImporting(true);
    setImportProgress({});
    setPendingExport(null);
    setLocalError(null);
    setImportNotice(null);
    try {
      const result = await coordinator.importCursorHistory({
        period,
        maxPages: importPageCap,
        operations: CURSOR_IMPORT_OPERATIONS[view],
        markets: marketsRef.current,
        signal: controller.signal,
        onProgress: (progress) => {
          if (isCurrent()) {
            setImportProgress((current) => ({ ...current, [progress.operation]: progress }));
          }
        },
      });
      if (!isCurrent()) return;
      const failed = result.orders?.error ?? result.fills?.error ?? result.transfers?.error;
      if (failed) {
        // A failed import must not replace a previously useful visible snapshot
        // with an aborted, denied, or otherwise unavailable partial result.
        setLocalError(`${failed.code}: Cursor import did not finish. The previous snapshot remains visible; ${errorText(failed)}`);
        return;
      }
      setSnapshot((current) => {
        if (!current || current.period.startTime !== period.startTime || current.period.endTime !== period.endTime) return current;
        return {
          ...current,
          ...(result.orders ? { orders: result.orders } : {}),
          ...(result.fills ? { fills: result.fills } : {}),
          ...(result.transfers ? { transfers: result.transfers } : {}),
        };
      });
    } catch (error) {
      if (isCurrent()) {
        const safe = account.safeAccountError(error);
        setLocalError(`${safe.code}: Cursor import did not finish. The previous snapshot remains visible; ${errorText(safe)}`);
      }
    } finally {
      if (importRequestRef.current === controller) {
        importRequestRef.current = null;
        setImporting(false);
      }
    }
  }, [accountVault, catalogReady, coordinator, importPageCap, loading, secureContext, session, snapshot, view]);

  const cancelImport = useCallback(() => {
    if (!importRequestRef.current) return;
    importRequestRef.current.abort();
    setImportNotice("Import cancelled; previous snapshot retained. The cancelled prefix was not merged.");
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load(false);
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [load]);

  const visibleDatasets: AnyDataset[] = view === "overview"
    ? [...(snapshot ? [snapshot.balances, snapshot.equity, snapshot.feeRates] : []), ...(balanceHistory ? [balanceHistory] : [])]
    : view === "trades"
      ? (snapshot ? [snapshot.fills] : [])
      : view === "orders"
        ? [...(snapshot ? [snapshot.orders] : []), ...(openOrders ? [openOrders] : [])]
        : view === "pnl"
          ? (snapshot ? [snapshot.fills, snapshot.transfers] : [])
          : (snapshot ? [snapshot.transfers] : []);
  const visibleSuccessful = visibleDatasets.filter((dataset) => dataset.data !== null).length;
  const hasViewResponse = visibleDatasets.length > 0;
  const latest = visibleDatasets.reduce<number | null>((latest, dataset) => {
    if (!dataset.retrievedAtMs) return latest;
    return latest === null ? dataset.retrievedAtMs : Math.max(latest, dataset.retrievedAtMs);
  }, null);
  const hasIncomplete = visibleDatasets.some((dataset) => dataset.coverage.status !== "complete" && dataset.coverage.status !== "filter-complete");
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
    ? "Checking your account…"
    : !session
      ? "Account locked"
      : !session.registeredKeyId
        ? "Account key ID needed"
        : hasViewResponse
          ? visibleSuccessful === 0
            ? "No account data is available"
            : hasIncomplete
              ? "Some account data is incomplete"
              : "Account data loaded"
          : "Ready to check your account";
  const copy = VIEW_COPY[view];
  const costBasisAccountScope = snapshot?.fills.data?.summary.calculations[0]?.fill.accountScope
    ?? (session ? JSON.stringify([session.entryId, "root"]) : "");
  // One action covers every read this view makes, so the label stays generic.
  const loadLabel = "Load account data";
  const refreshLabel = "Refresh account data";
  const periodLabel = view === "trades" ? "Trade time period" : view === "orders" ? "Completed-order time period" : view === "pnl" ? "P&L analysis time period" : "Balance and equity time period";
  const emptyDescription = !session
    ? "Set up or unlock a read-only key in API setup."
    : !session.registeredKeyId
      ? "Add the server-issued account key ID in API setup."
      : undefined;

  useEffect(() => {
    detailsRequestRef.current?.abort();
    importRequestRef.current?.abort();
    detailsRequestRef.current = null;
    importRequestRef.current = null;
    setImporting(false);
    setImportNotice(null);
    setImportProgress({});
    selectedOrderRef.current = null;
    setSelectedOrder(null);
    setOrderDetails(null);
    setDetailsLoading(false);
    setLocalError(null);
    setPendingExport(null);
  }, [view]);

  return (
    <Card>
      <div className="row-flex" style={{ gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        {session && <Pill kind={hasViewResponse && !hasIncomplete && visibleSuccessful > 0 ? "up" : "warn"}>{connectionLabel}</Pill>}
        <span className={`pill ${secureContext && session?.registeredKeyId ? "info" : "warn"}`}>
          {secureContext ? (session?.registeredKeyId ? "Key ID saved" : "Key ID required") : "HTTPS required"}
        </span>
      </div>

      <details className="disclosure" style={{ marginBottom: 14 }}>
        <summary>What this means</summary>
        <p>
          <strong>Live compatibility remains unverified.</strong>{" "}
          Authenticated GET reads are enabled, but each operation still succeeds or fails independently. Browser CORS, origin, and owner-controlled read-policy checks determine whether a real response is available; a response is not evidence of another permission.
        </p>
        <p>
          <strong>Section-scoped memory.</strong> Changing account sections intentionally discards this section&apos;s in-memory snapshots, cursor imports, and manual P&amp;L inputs. Reload or re-enter them when you return; no private data is persisted to retain them.
        </p>
        <p>
          <strong>Empty is not zero.</strong> Each read keeps its own status, and public market data is never
          substituted for it. A denied, partial, or unavailable read is never shown as an empty account or a
          zero value, and no figure is inferred from a missing row.
        </p>
        <div className="grid cols-3" style={{ marginTop: 8 }}>
          <div className="kv"><span className="k">Secure browser context</span><span className="v">{secureContext ? "Yes" : "No"}</span></div>
          <div className="kv"><span className="k">Authenticated GET reads</span><span className="v">Enabled</span></div>
          <div className="kv"><span className="k">CORS / permissions</span><span className="v">{snapshot ? "Per-operation result below" : "Not live-verified"}</span></div>
        </div>
      </details>

      <div className="notice info account-load-scope" role="note" style={{ marginBottom: 14 }}>
        <div>
          <strong>Before loading account data:</strong>{" "}
          Activation requests the official spot-market catalog and starts read-only requests for balances, equity history, order history, fills, transfers, fee rates, balance history, and open orders—not just the dataset shown in this section. After activation, if this section remains mounted, the same broad bundle may be requested again when the document becomes visible. No trade, order, or transaction actions are submitted.
        </div>
      </div>

      <div className="row-flex" style={{ gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {view !== "transfers" && <label className="field" style={{ minWidth: 180 }}>
          <span className="faint">{periodLabel}</span>
          <select className="select" value={range} onChange={(event) => {
            requestRef.current?.abort();
            detailsRequestRef.current?.abort();
            importRequestRef.current?.abort();
            requestRef.current = null;
            detailsRequestRef.current = null;
            importRequestRef.current = null;
            requestContextRef.current = null;
            detailsGenerationRef.current += 1;
            setSnapshot(null);
            setBalanceHistory(null);
            setOpenOrders(null);
            setOrderDetails(null);
            setSelectedOrder(null);
            selectedOrderRef.current = null;
            setLoading(false);
            setImporting(false);
            setImportNotice(null);
            setImportProgress({});
            setBalanceHistoryLoading(false);
            setOpenOrdersLoading(false);
            setDetailsLoading(false);
            setPendingExport(null);
            setRange(event.target.value as account.AccountHistoryRange);
          }} aria-label="Account reporting period">
            {RANGES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>}
        <button type="button" className="btn primary" disabled={!canAttempt} onClick={() => void load(true)}>
          <IconActivity size={14} /> {loading ? "Loading…" : hasViewResponse ? refreshLabel : loadLabel}
        </button>
        {hasViewResponse && <span className="faint"><IconClock size={12} /> {latest ? `Latest update ${fmtAgo(latest)}` : "No successful response time"}</span>}
      </div>
      {snapshot && CURSOR_IMPORT_OPERATIONS[view].length > 0 && (
        <div className="notice info" role="note" style={{ marginBottom: 14 }}>
          <div className="row-flex" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
            <div>
              <strong>Need every cursor page?</strong>{" "}
              Many authenticated GETs, one dataset at a time. Orders/fills use the reporting window; transfers stay unfiltered. The 25-page snapshot is unchanged until it finishes.
            </div>
            <div className="row-flex" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
              <label className="field" style={{ minWidth: 130 }}>
                <span className="faint">Page safety cap</span>
                <select className="select" value={importPageCap} disabled={importing} onChange={(event) => setImportPageCap(Number(event.target.value))} aria-label="Cursor import page safety cap">
                  {[100, 500, 1000, 5000, 10000].map((cap) => <option key={cap} value={cap}>{cap} pages</option>)}
                </select>
              </label>
              {!catalogReady && <span className="faint">Pair catalog needed for full import.</span>}
              <button type="button" className={`btn sm ${importing ? "ghost" : "primary"}`} disabled={importing ? false : !canAttempt || !catalogReady} onClick={importing ? cancelImport : () => void importHistory()}>
                {importing ? "Cancel import" : "Import full history (capped)"}
              </button>
            </div>
          </div>
          {(importing || importProgress.orders || importProgress.fills || importProgress.transfers) && (
            <div className="row-flex mt-2" style={{ gap: 14, flexWrap: "wrap" }} aria-live="polite">
              {CURSOR_IMPORT_OPERATIONS[view].map((operation) => {
                const progress = importProgress[operation];
                const label = operation === "orders" ? "Orders" : operation === "fills" ? "Fills" : "Transfers";
                return <span key={operation}>{label}: {progress ? `${progress.pagesFetched} pages · ${progress.rowsReceived} rows received` : "not started"}</span>;
              })}
              <span className="faint">No total or percentage is inferred.</span>
            </div>
          )}
        </div>
      )}
      {importNotice && <div className="notice info" role="status" style={{ marginBottom: 14 }}>{importNotice}</div>}
      {localError && <div className="notice error" role="alert" style={{ marginBottom: 14 }}><IconAlert size={15} /><span>{localError}</span></div>}
      <p className="faint">Exact API decimal strings; display rounding never changes the arithmetic.</p>

      {view === "overview" && (snapshot || balanceHistory || balanceHistoryLoading) && <BalanceHistoryCard dataset={balanceHistory} loading={balanceHistoryLoading} range={range} />}
      {view === "orders" && (snapshot || openOrders || openOrdersLoading) && <OpenOrdersCard dataset={openOrders} loading={openOrdersLoading} onDetails={openDetails} />}

      {snapshot && (
        <>
          {view === "overview" && <MetricStrip>
            <MetricCell label="Reporting period" value={rangeLabel(snapshot.period.range)} sub={`${snapshot.period.startTime} → ${snapshot.period.endTime}`} />
            <MetricCell label="Overview reads with responses" value={`${visibleSuccessful}/4`} sub="Each read keeps its own status" />
            <MetricCell label="Latest update" value={latest ? fmtAgo(latest) : "—"} sub="Per section" />
            <MetricCell label="Profit and loss" value="Unavailable" sub="Gated on complete inputs" />
          </MetricStrip>}

          {view === "overview" && <Card title="Current balances" subtitle="Trading + funding. Reserved and available are not re-added." actions={<DatasetActions dataset={snapshot.balances} name="balances" rowCount={snapshot.balances.data?.balances.length ?? 0} onExport={requestExport} />}>
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
                {snapshot.balances.data.balances.length === 0 && <EmptyState title="Empty validated balance response" description="Zero rows returned — not a denied read." />}
                <DatasetMessages dataset={snapshot.balances} />
              </>
            ) : <><NoDataset dataset={snapshot.balances} /><DatasetMessages dataset={snapshot.balances} /></>}
          </Card>}

          {view === "overview" && <Card title="Sampled equity history" subtitle="Sampled valuation only — never live equity or P&L." actions={<DatasetActions dataset={snapshot.equity} name="equity" rowCount={snapshot.equity.data?.response.series.reduce((count, series) => count + series.equity.length, 0) ?? 0} onExport={requestExport} />}>
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
                </tbody></table></div> : <EmptyState title="No equity series in validated response" description="Nothing is inferred from an empty series." />}
                <DatasetMessages dataset={snapshot.equity} />
              </>
            ) : <><NoDataset dataset={snapshot.equity} /><DatasetMessages dataset={snapshot.equity} /></>}
          </Card>}

          {view === "orders" && <Card title="Order history" subtitle="Selected window, opaque cursors. Read-only." actions={<DatasetActions dataset={snapshot.orders} name="orders" rowCount={snapshot.orders.data?.orders.length ?? 0} onExport={requestExport} />}>
            {snapshot.orders.data ? (
              <>
                {snapshot.orders.data.orders.length > 0 ? <div className="table-wrap"><table className="data"><thead><tr><th className="align-left">Order</th><th>Market</th><th>Side</th><th>Status</th><th>Price</th><th>Original qty</th><th>Filled qty</th><th>Created</th><th>Details</th></tr></thead><tbody>
                  {snapshot.orders.data.orders.map((order) => <tr key={`${order.orderId}-${order.generation}`}><td className="align-left mono">{order.orderId}</td><td>{order.marketSymbol ?? order.symbol}</td><td>{order.side}</td><td><Pill kind={order.status === "FILLED" ? "up" : "info"}>{order.status}</Pill></td><td><ExactValue value={order.price} /></td><td><ExactValue value={order.origQty} /></td><td><ExactValue value={order.cumQty} /></td><td className="mono">{apiTime(order.createdAt)}</td><td><button type="button" className="btn sm ghost order-details-trigger" onClick={() => openDetails(order)} aria-label={`View details for order ${order.orderId}`}>Details</button></td></tr>)}
                </tbody></table></div> : <EmptyState title="No orders in validated coverage" description="Empty validated result. Denied history is not zero orders." />}
                <DatasetMessages dataset={snapshot.orders} />
              </>
            ) : <><NoDataset dataset={snapshot.orders} /><DatasetMessages dataset={snapshot.orders} /></>}
          </Card>}

          {view === "trades" && <Card title="Your Trades and Actual Fees" subtitle="Fees from execution records, grouped by fee asset. Flow is not profit." actions={<DatasetActions dataset={snapshot.fills} name="fills" rowCount={snapshot.fills.data?.summary.calculations.length ?? 0} onExport={requestExport} />}>
            {snapshot.fills.data ? (
              <>
                {account.observedFillEligibility(snapshot.fills.data.summary, snapshot.fills.coverage).available ? (
                  <>
                    {snapshot.fills.data.summary.feesByAsset.length > 0 && <div className="table-wrap" style={{ marginBottom: 14 }}><table className="data"><thead><tr><th className="align-left">Fee asset</th><th>Gross charges</th><th>Gross rebates</th><th>Net actual fees</th></tr></thead><tbody>
                      {snapshot.fills.data.summary.feesByAsset.map((fee) => <tr key={fee.asset}><td className="align-left mono">{fee.asset}</td><td><ExactValue value={fee.grossCharges} digits={18} /></td><td><ExactValue value={fee.grossRebates} digits={18} /></td><td><ExactValue value={fee.netFees} digits={18} /></td></tr>)}
                    </tbody></table></div>}
                    {snapshot.fills.data.summary.calculations.length > 0 ? <div className="table-wrap"><table className="data"><thead><tr><th className="align-left">Match ID</th><th>Market</th><th>Side</th><th>Quantity</th><th>Price</th><th>Actual fee / rebate</th><th>Observed quote flow</th><th>Executed (UTC)</th></tr></thead><tbody>
                      {snapshot.fills.data.summary.calculations.map((calculation) => {
                        const fill = calculation.fill;
                        return <tr key={`${fill.symbol}-${fill.matchId}-${fill.orderId}`}><td className="align-left mono">{fill.matchId}</td><td>{fill.marketSymbol ?? fill.symbol}</td><td>{fill.side}</td><td><ExactValue value={fill.quantity} /></td><td><ExactValue value={fill.price} /></td><td><ExecutionFee fill={fill} /></td><td><ExactValue value={calculation.dQuote} digits={18} /></td><td className="mono">{apiTime(fill.timestamp)}</td></tr>;
                      })}
                    </tbody></table></div> : <EmptyState title="No fills in validated coverage" description="Nothing is inferred from an empty fill set." />}
                  </>
                ) : <div className="notice error" role="alert"><IconAlert size={15} /><span>Conflicting rows block affected totals; raw rows are never repaired.</span></div>}
                <DatasetMessages dataset={snapshot.fills} />
              </>
            ) : <><NoDataset dataset={snapshot.fills} /><DatasetMessages dataset={snapshot.fills} /></>}
          </Card>}

          {view === "transfers" && <Card title="Money Movements" subtitle="Read-only transfer legs, unfiltered by period. Capital flows, not profit." actions={<DatasetActions dataset={snapshot.transfers} name="transfers" rowCount={filteredTransfers.length} onExport={requestExport} />}>
            {snapshot.transfers.data ? (
              <>
                {snapshot.transfers.data.transfers.length > 0 && (
                  <>
                    <div className="notice info" role="note" style={{ marginBottom: 10 }}>
                      <span><strong>Filter loaded rows.</strong> Server coverage is unchanged.</span>
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
                  </tbody></table></div> : <div><EmptyState title="No loaded rows match these filters" description="No loaded rows match. This is not a server-complete empty history." /><button type="button" className="btn sm ghost" onClick={resetTransferFilters}>Reset loaded-row filters</button></div>
                ) : <EmptyState title="No transfers in validated coverage" description="Nothing is inferred from unavailable history." />}
                <DatasetMessages dataset={snapshot.transfers} />
              </>
            ) : <><NoDataset dataset={snapshot.transfers} /><DatasetMessages dataset={snapshot.transfers} /></>}
          </Card>}

          {view === "overview" && <Card title="Current fee rates" subtitle="Current rates are not historical execution fees; actual fees are in Your Trades." actions={<DatasetActions dataset={snapshot.feeRates} name="feeRates" rowCount={snapshot.feeRates.data?.feeRates.length ?? 0} onExport={requestExport} />}>
            {snapshot.feeRates.data ? (
              <>
                {snapshot.feeRates.data.feeRates.length > 0 ? <div className="table-wrap"><table className="data"><thead><tr><th className="align-left">Market</th><th>VIP tier</th><th>Maker rate</th><th>Taker rate</th></tr></thead><tbody>
                  {snapshot.feeRates.data.feeRates.map((rate) => <tr key={rate.symbol}><td className="align-left mono">{rate.symbol}</td><td>{rate.vipTier}</td><td><ExactValue value={rate.makerFeeRatePercent} digits={18} />%</td><td><ExactValue value={rate.takerFeeRatePercent} digits={18} />%</td></tr>)}
                </tbody></table></div> : <EmptyState title="No current fee-rate rows" description="A missing rate is not a zero fee." />}
                <DatasetMessages dataset={snapshot.feeRates} />
              </>
            ) : <><NoDataset dataset={snapshot.feeRates} /><DatasetMessages dataset={snapshot.feeRates} /></>}
          </Card>}

          {view === "pnl" && (
            <AccountCostBasis snapshot={snapshot} accountScope={costBasisAccountScope} />
          )}

          {view === "overview" && <Card title="Profit and loss require cost basis" subtitle="Activity is not automatically profit.">
            <div className="notice info" role="note"><IconAlert size={15} /><span>Use Profit and Loss to supply opening lots, resolve flows, and pick a method. No number appears until every gate passes.</span></div>
          </Card>}
        </>
      )}

      {visibleDatasets.length === 0 && !loading && (
        <EmptyState
          icon={<IconActivity size={22} />}
          title={copy.emptyTitle}
          description={emptyDescription}
        />
      )}
      {loading && <div className="notice info" role="status"><IconRefresh size={15} /><span>Reading independent datasets. A spinner is not a value.</span></div>}
      {view === "orders" && selectedOrder && <OrderDetailsDrawer selection={selectedOrder} dataset={orderDetails} loading={detailsLoading} onClose={closeDetails} onRetry={() => void loadDetails(selectedOrder, true)} />}
      <ConfirmDialog
        open={pendingExport !== null}
        title="Download private financial activity?"
        message={pendingExport && snapshot ? (
          <div>
            <p>{account.ACCOUNT_EXPORT_PRIVATE_WARNING}</p>
            <p>Dataset: <strong>{pendingExport.dataset}</strong> · Format: <strong>{pendingExport.format.toUpperCase()}</strong> · Coverage: <strong>{snapshot[pendingExport.dataset].coverage.status}</strong>.</p>
            <p className="faint">Loaded rows plus a coverage manifest. Not complete history, a tax statement, or P&amp;L. Excludes credentials, cursors, raw account IDs, addresses, and secret-bearing errors.</p>
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
