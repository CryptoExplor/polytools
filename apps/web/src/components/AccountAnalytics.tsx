import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { account, fmtAgo } from "@poly/core";
import { Card, ConfirmDialog, EmptyState, MetricCell, MetricStrip, Pill } from "./ui";
import { IconActivity, IconAlert, IconClock, IconRefresh } from "./icons";
import { downloadAccountExport } from "../lib/download";

const LIVE_READS_ENABLED = import.meta.env.VITE_ENABLE_ACCOUNT_READS === "true";
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

function DatasetStatus({ dataset }: { dataset?: AnyDataset }) {
  if (!dataset) return <Pill>Not loaded</Pill>;
  const status = dataset.coverage.status;
  return (
    <span className="row-flex" style={{ gap: 6, justifyContent: "flex-end" }}>
      <Pill kind={statusKind(status)}>{status}</Pill>
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

function DatasetMessages({ dataset }: { dataset: AnyDataset }) {
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
        {coverage.pagesFetched} page{coverage.pagesFetched === 1 ? "" : "s"} · {coverage.rowsAccepted}/{coverage.rowsReceived} rows accepted · {coverage.cursorExhausted ? "cursor exhausted" : "cursor not exhausted"}
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

export function AccountAnalytics({
  accountVault,
  session,
}: {
  accountVault: account.AccountVault | null;
  session: account.VaultSessionInfo | null;
}) {
  const [coordinator, setCoordinator] = useState<account.AccountDataCoordinator | null>(null);
  const [snapshot, setSnapshot] = useState<account.AccountDataSnapshot | null>(null);
  const [range, setRange] = useState<account.AccountHistoryRange>("30d");
  const [loading, setLoading] = useState(false);
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

  useEffect(() => {
    if (!accountVault) return;
    const instance = new account.AccountDataCoordinator({ vault: accountVault });
    setCoordinator(instance);
    return () => {
      requestRef.current?.abort();
      instance.dispose();
      setCoordinator(null);
    };
  }, [accountVault]);

  useEffect(() => {
    requestRef.current?.abort();
    setSnapshot(null);
    setLocalError(null);
    setCatalogReady(false);
    setLoading(false);
    setPendingExport(null);
    setTransferAssetFilter("ALL");
    setTransferDirectionFilter("ALL");
    setTransferReasonFilter("ALL");
  }, [session?.generation]);

  useEffect(() => () => requestRef.current?.abort(), []);

  const secureContext = typeof window !== "undefined" && window.isSecureContext;
  const canAttempt = Boolean(
    LIVE_READS_ENABLED && secureContext && coordinator && session?.registeredKeyId && !loading,
  );

  const load = useCallback(async () => {
    if (!coordinator || !session || !accountVault) return;
    if (!LIVE_READS_ENABLED) {
      setLocalError("Live account reads are disabled in this build. Enable them only in a reviewed deployment after CORS and least-privilege verification; no request was sent.");
      return;
    }
    if (!secureContext) {
      setLocalError("A secure HTTPS browser context is required before an authenticated read can be attempted.");
      return;
    }
    if (!session.registeredKeyId) {
      setLocalError("Save the server-issued ak_... key ID before attempting an authenticated read.");
      return;
    }
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setSnapshot(null);
    setPendingExport(null);
    setLocalError(null);
    setCatalogReady(false);
    try {
      const catalog = await account.fetchOfficialSpotCatalog({ signal: controller.signal });
      if (requestRef.current !== controller || controller.signal.aborted) return;
      // The unsigned official catalog also supplies a server reference clock.
      // Apply only the server-minus-local offset to future signing timestamps.
      const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
      const skewMs = BigInt(catalog.tsSec) * 1_000n - BigInt(catalog.retrievedAtMs);
      if (skewMs > maxSafe || skewMs < -maxSafe) {
        throw new Error("The official catalog clock offset is outside the supported range.");
      }
      accountVault.setClockSkew(Number(skewMs));
      setCatalogReady(true);
      const next = await coordinator.loadAll({ range, markets: catalog.markets, signal: controller.signal });
      if (requestRef.current === controller && !controller.signal.aborted) setSnapshot(next);
    } catch (error) {
      if (requestRef.current === controller && !controller.signal.aborted) {
        const safe = account.safeAccountError(error);
        setLocalError(`${safe.code}: ${errorText(safe)}`);
        setSnapshot(null);
      }
    } finally {
      if (requestRef.current === controller) {
        setLoading(false);
        requestRef.current = null;
      }
    }
  }, [accountVault, coordinator, session, secureContext, range]);

  const datasets = snapshot ? [snapshot.balances, snapshot.equity, snapshot.orders, snapshot.fills, snapshot.transfers, snapshot.feeRates] : [];
  const successful = datasets.filter((dataset) => dataset.data !== null).length;
  const latest = datasets.reduce<number | null>((latest, dataset) => {
    if (!dataset.retrievedAtMs) return latest;
    return latest === null ? dataset.retrievedAtMs : Math.max(latest, dataset.retrievedAtMs);
  }, null);
  const hasIncomplete = datasets.some((dataset) => dataset.coverage.status !== "complete");
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
        : !LIVE_READS_ENABLED
          ? "Live verification required"
          : snapshot
            ? successful === 0
              ? "No read granted or available"
              : hasIncomplete
                ? "Partial read coverage"
                : "Validated read responses received"
            : "Ready for owner-controlled verification";

  return (
    <Card
      title="R2 Account Analytics"
      subtitle="Read-only balances, sampled equity, order history, fills, labeled transfer activity, current rates, and explicit loaded-row exports. Official SpotConfig pair mapping is loaded separately; public MCP tools remain independent."
      actions={<Pill kind={snapshot && !hasIncomplete && successful > 0 ? "up" : "warn"}>{connectionLabel}</Pill>}
    >
      <div className="notice warn" role="note" style={{ marginBottom: 14 }}>
        <div>
          <strong>Live compatibility is still a release gate.</strong>{" "}
          {LIVE_READS_ENABLED
            ? "This deployment has opted into authenticated GET reads. Each operation still succeeds or fails independently; a response is not evidence of another permission."
            : "Authenticated GET reads are disabled in this build. No account request has been sent by this panel. A reviewed deployment must explicitly enable them after browser CORS, origin, and owner-controlled read-policy checks."}
        </div>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <div className="kv"><span className="k">Registered key ID</span><span className="v">{session?.registeredKeyId ? "Saved" : "Required"}</span></div>
        <div className="kv"><span className="k">Secure browser context</span><span className="v">{secureContext ? "Yes" : "No"}</span></div>
        <div className="kv"><span className="k">Deployment read opt-in</span><span className="v">{LIVE_READS_ENABLED ? "Enabled" : "Disabled"}</span></div>
        <div className="kv"><span className="k">Official pair catalog</span><span className="v">{catalogReady ? "SpotConfig validated" : "Required before fills"}</span></div>
        <div className="kv"><span className="k">CORS / permissions</span><span className="v">{snapshot ? "Per-operation result below" : "Not live-verified"}</span></div>
      </div>

      <div className="row-flex" style={{ gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        <label className="field" style={{ minWidth: 180 }}>
          <span className="faint">Reporting period for equity, orders, and fills</span>
          <select className="select" value={range} onChange={(event) => {
            requestRef.current?.abort();
            setSnapshot(null);
            setPendingExport(null);
            setRange(event.target.value as account.AccountHistoryRange);
          }} aria-label="Account reporting period">
            {RANGES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <button type="button" className="btn primary" disabled={!canAttempt} onClick={() => void load()}>
          <IconActivity size={14} /> {loading ? "Reading…" : snapshot ? "Refresh read-only data" : "Verify & load read-only data"}
        </button>
        {snapshot && <span className="faint"><IconClock size={12} /> {latest ? `Latest response ${fmtAgo(latest)}` : "No successful response timestamp"}</span>}
      </div>
      {localError && <div className="notice error" role="alert" style={{ marginBottom: 14 }}><IconAlert size={15} /><span>{localError}</span></div>}
      <p className="faint">Amounts retain friendly REST decimal strings; no ConnectRPC scale divisor is applied. Rounded display never updates the underlying exact arithmetic.</p>
      {!LIVE_READS_ENABLED && <p className="faint">The button is intentionally disabled here. Unit and fake-fetch tests validate behavior, not Polyester live authentication or response compatibility.</p>}

      {snapshot && (
        <>
          <MetricStrip>
            <MetricCell label="Reporting period" value={snapshot.period.range} sub={`${snapshot.period.startTime} → ${snapshot.period.endTime}`} />
            <MetricCell label="Datasets with responses" value={`${successful}/6`} sub="A response is not a permission grant for other reads" />
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
                {snapshot.orders.data.orders.length > 0 ? <div className="table-wrap"><table className="data"><thead><tr><th className="align-left">Order</th><th>Market</th><th>Side</th><th>Status</th><th>Price</th><th>Original qty</th><th>Filled qty</th><th>Created</th></tr></thead><tbody>
                  {snapshot.orders.data.orders.map((order) => <tr key={`${order.orderId}-${order.generation}`}><td className="align-left mono">{order.orderId}</td><td>{order.marketSymbol ?? order.symbol}</td><td>{order.side}</td><td><Pill kind={order.status === "FILLED" ? "up" : "info"}>{order.status}</Pill></td><td><ExactValue value={order.price} /></td><td><ExactValue value={order.origQty} /></td><td><ExactValue value={order.cumQty} /></td><td className="mono">{apiTime(order.createdAt)}</td></tr>)}
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

          <Card title="P&L remains unavailable in R2" subtitle="Observed fills, deposits, equity changes, and net quote flow are not profit.">
            <div className="notice info" role="note"><IconAlert size={15} /><span>Realized and unrealized P&L require opening lots, complete fills, resolved non-fill cash flows, and a fresh labeled valuation mark. Those gates are not yet established by this read-only integration, so no P&L number is displayed.</span></div>
          </Card>
        </>
      )}

      {!snapshot && !loading && (
        <EmptyState
          icon={<IconActivity size={22} />}
          title="No account analytics response loaded"
          description={LIVE_READS_ENABLED ? "Unlock a registered read-only key, then explicitly verify and load the independent GET datasets." : "Live verification is disabled in this build. No synthetic fixture is presented as account data."}
        />
      )}
      {loading && <div className="notice info" role="status"><IconRefresh size={15} /><span>Reading independent GET datasets. Loading indicators are not account values; each result will retain its own coverage and permission state.</span></div>}
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
