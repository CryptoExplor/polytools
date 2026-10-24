import { negate, parseDecimal } from "./decimal";
import { totalBalance } from "./analytics";
import { transferBucketLabel, transferSideLabel } from "./activity";
import type { Coverage, CoverageStatus, BasisStatus, FlowStatus } from "./coverage";
import type { AccountDataSnapshot } from "./data";
import type { NormalizedTransfer } from "./normalize";

export const ACCOUNT_EXPORT_PRIVATE_WARNING =
  "This downloaded file contains private financial activity. Store and share it carefully.";
export const ACCOUNT_EXPORT_STATEMENT =
  "Loaded rows only; not complete history, a tax statement, or a P&L statement.";

export type AccountExportDataset = "balances" | "equity" | "orders" | "fills" | "transfers" | "feeRates";
export type AccountExportFormat = "csv" | "json";
export type ExportScalar = string | number | boolean | null;
export type AccountExportRow = Record<string, ExportScalar>;

export interface TransferExportFilters {
  asset?: string;
  direction?: string;
  reason?: string;
}

export interface AccountExportOptions {
  snapshot: AccountDataSnapshot;
  dataset: AccountExportDataset;
  format: AccountExportFormat;
  /** Optional subset of the exact object references in the loaded transfer dataset. */
  transferRows?: readonly NormalizedTransfer[];
  transferFilters?: TransferExportFilters;
  exportedAtMs?: number;
}

export interface AccountExportCoverage {
  operation: string;
  contractVersion: string;
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
}

export interface AccountExportWindow {
  range: string | null;
  requestedStart: string | null;
  requestedEnd: string | null;
  actualStartTsSec: number | null;
  actualEndTsSec: number | null;
}

export interface AccountExportManifest {
  schemaVersion: "polytools.account-export.v1";
  dataset: AccountExportDataset;
  environment: "testnet";
  /** Only the coordinator's non-identifying account-scope category is retained. */
  scopeLabel: "Main account" | "Selected subaccount";
  coverage: AccountExportCoverage;
  filters: {
    server: Record<string, ExportScalar>;
    loadedRows: Record<string, ExportScalar>;
  };
  window: AccountExportWindow;
  retrievedAtMs: number | null;
  exportedAtMs: number;
  exportedAtUtc: string;
  sourceRowCount: number;
  exportedRowCount: number;
  method: string;
  privateWarning: string;
  statement: string;
}

export interface AccountExportResult {
  filename: string;
  mimeType: string;
  contents: string;
  rowCount: number;
  manifest: AccountExportManifest;
}

export class AccountExportError extends Error {
  constructor(
    readonly code: "NO_DATA" | "EMPTY_CSV" | "INVALID_ROWS" | "INVALID_ARGUMENT",
    message: string,
  ) {
    super(message);
    this.name = "AccountExportError";
  }
}

interface Projection {
  rows: AccountExportRow[];
  columns: string[];
  sourceRowCount: number;
}

const BALANCE_COLUMNS = [
  "asset",
  "source_trading",
  "source_funding",
  "source_reserved",
  "source_available",
  "derived_total",
];

const EQUITY_COLUMNS = [
  "series",
  "sample_index",
  "source_equity",
  "source_btc_price",
  "quote_asset",
  "derived_series_start",
  "derived_series_latest",
  "derived_series_change",
  "derived_series_max_drawdown",
];

const ORDER_COLUMNS = [
  "market",
  "side",
  "status",
  "order_type",
  "source_price",
  "source_original_quantity",
  "source_cumulative_quantity",
  "source_leaves_quantity",
  "source_average_price",
  "fee_asset",
  "created_at",
  "terminal_at",
  "generation",
  "version",
];

const FILL_COLUMNS = [
  "market",
  "side",
  "base_asset",
  "quote_asset",
  "source_quantity",
  "source_price",
  "source_fee_magnitude",
  "fee_asset",
  "fee_is_rebate",
  "is_maker",
  "executed_at",
  "derived_notional",
  "derived_signed_fee",
  "derived_delta_base",
  "derived_delta_quote",
];

const TRANSFER_COLUMNS = [
  "timestamp",
  "reason_code",
  "reason_label",
  "reason_known",
  "asset",
  "source_amount",
  "derived_signed_amount",
  "source_balance_after",
  "affected_bucket",
  "source_category",
  "destination_category",
  "flow_interpretation",
];

const FEE_RATE_COLUMNS = [
  "market",
  "vip_tier",
  "source_maker_fee_rate_percent",
  "source_taker_fee_rate_percent",
  "rate_interpretation",
];

function requiredData<T>(data: T | null): T {
  if (data === null) {
    throw new AccountExportError("NO_DATA", "This dataset has no validated loaded response to export.");
  }
  return data;
}

function selectedCoverage(snapshot: AccountDataSnapshot, dataset: AccountExportDataset): Coverage {
  return snapshot[dataset].coverage;
}

function selectedRetrievedAt(snapshot: AccountDataSnapshot, dataset: AccountExportDataset): number | null {
  return snapshot[dataset].retrievedAtMs;
}

function projectionFor(options: AccountExportOptions): Projection {
  const { snapshot, dataset } = options;
  switch (dataset) {
    case "balances": {
      const data = requiredData(snapshot.balances.data);
      return {
        sourceRowCount: data.balances.length,
        columns: BALANCE_COLUMNS,
        rows: data.balances.map((balance) => ({
          asset: balance.asset,
          source_trading: balance.trading,
          source_funding: balance.funding,
          source_reserved: balance.reserved ?? null,
          source_available: balance.available ?? null,
          derived_total: totalBalance(balance).raw,
        })),
      };
    }
    case "equity": {
      const data = requiredData(snapshot.equity.data);
      const response = data.response;
      const rows: AccountExportRow[] = [];
      response.series.forEach((series, seriesIndex) => {
        const metrics = data.seriesMetrics[seriesIndex];
        // Account names/IDs are deliberately not used as series labels.
        const seriesLabel = series.asset?.symbol ?? `Series ${seriesIndex + 1}`;
        series.equity.forEach((equity, sampleIndex) => {
          rows.push({
            series: seriesLabel,
            sample_index: sampleIndex,
            source_equity: equity,
            source_btc_price: response.btcPrices[sampleIndex] ?? null,
            quote_asset: response.quoteAsset ?? null,
            derived_series_start: metrics?.start?.raw ?? null,
            derived_series_latest: metrics?.latest?.raw ?? null,
            derived_series_change: metrics?.change?.raw ?? null,
            derived_series_max_drawdown: metrics?.maxDrawdownAbsolute?.raw ?? null,
          });
        });
      });
      return { rows, columns: EQUITY_COLUMNS, sourceRowCount: rows.length };
    }
    case "orders": {
      const data = requiredData(snapshot.orders.data);
      return {
        sourceRowCount: data.orders.length,
        columns: ORDER_COLUMNS,
        rows: data.orders.map((order) => ({
          market: order.marketSymbol ?? order.symbol,
          side: order.side,
          status: order.status,
          order_type: order.orderType,
          source_price: order.price,
          source_original_quantity: order.origQty,
          source_cumulative_quantity: order.cumQty,
          source_leaves_quantity: order.leavesQty,
          source_average_price: order.avgPx,
          fee_asset: order.feeAsset ?? null,
          created_at: order.createdAt,
          terminal_at: order.terminalAt ?? null,
          generation: order.generation,
          version: order.version,
        })),
      };
    }
    case "fills": {
      const data = requiredData(snapshot.fills.data);
      return {
        sourceRowCount: data.summary.calculations.length,
        columns: FILL_COLUMNS,
        // Only deduplicated, validated fill calculations are projected. The
        // unified transfer settlement legs are never added a second time.
        rows: data.summary.calculations.map((calculation) => {
          const fill = calculation.fill;
          return {
            market: fill.marketSymbol ?? fill.symbol,
            side: fill.side,
            base_asset: fill.baseAsset,
            quote_asset: fill.quoteAsset,
            source_quantity: fill.quantity,
            source_price: fill.price,
            source_fee_magnitude: fill.feeMagnitude,
            fee_asset: fill.feeAsset,
            fee_is_rebate: fill.feeIsRebate,
            is_maker: fill.isMaker ?? null,
            executed_at: fill.timestamp,
            derived_notional: calculation.notional.raw,
            derived_signed_fee: calculation.signedFee.raw,
            derived_delta_base: calculation.dBase.raw,
            derived_delta_quote: calculation.dQuote.raw,
          };
        }),
      };
    }
    case "transfers": {
      const data = requiredData(snapshot.transfers.data);
      const loaded = data.transfers;
      const selected = options.transferRows ?? loaded;
      if (options.transferRows) {
        const loadedReferences = new Set<NormalizedTransfer>(loaded);
        if (selected.some((row) => !loadedReferences.has(row))) {
          throw new AccountExportError(
            "INVALID_ROWS",
            "Filtered exports must use rows from the current loaded transfer snapshot.",
          );
        }
      }
      return {
        sourceRowCount: loaded.length,
        columns: TRANSFER_COLUMNS,
        rows: selected.map((transfer) => ({
          timestamp: transfer.timestamp,
          reason_code: transfer.transferCode,
          reason_label: transfer.reasonLabel,
          reason_known: transfer.reasonKnown,
          asset: transfer.asset,
          source_amount: transfer.amount,
          derived_signed_amount: transfer.isDebit
            ? negate(parseDecimal(transfer.amount)).raw
            : parseDecimal(transfer.amount).raw,
          source_balance_after: transfer.balanceAfter,
          affected_bucket: transferBucketLabel(transfer.account),
          source_category: transferSideLabel(transfer.source.kind),
          destination_category: transferSideLabel(transfer.destination.kind),
          flow_interpretation: transfer.transferCode === "DEPOSIT" || !transfer.isDebit
            ? "Capital/activity flow — not profit"
            : "Activity flow — not profit",
        })),
      };
    }
    case "feeRates": {
      const data = requiredData(snapshot.feeRates.data);
      return {
        sourceRowCount: data.feeRates.length,
        columns: FEE_RATE_COLUMNS,
        rows: data.feeRates.map((rate) => ({
          market: rate.symbol,
          vip_tier: rate.vipTier,
          source_maker_fee_rate_percent: rate.makerFeeRatePercent,
          source_taker_fee_rate_percent: rate.takerFeeRatePercent,
          rate_interpretation: "Current effective rate — not a historical execution fee",
        })),
      };
    }
  }
}

function filterValue(value: string | undefined, fallback = "ALL"): string {
  if (value === undefined) return fallback;
  if (value.length > 200 || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new AccountExportError("INVALID_ARGUMENT", "The loaded-row filter is not exportable.");
  }
  return value;
}

function manifestFor(
  options: AccountExportOptions,
  projection: Projection,
  exportedAtMs: number,
): AccountExportManifest {
  const { snapshot, dataset } = options;
  const coverage = selectedCoverage(snapshot, dataset);
  const period = ["orders", "fills", "equity"].includes(dataset) ? snapshot.period : null;
  const equity = dataset === "equity" ? requiredData(snapshot.equity.data).response : null;
  const loadedRows: Record<string, ExportScalar> = dataset === "transfers"
    ? {
      asset: filterValue(options.transferFilters?.asset),
      direction: filterValue(options.transferFilters?.direction),
      reason: filterValue(options.transferFilters?.reason),
      selection: options.transferRows ? "Filtered loaded rows" : "All loaded rows",
    }
    : {};
  const server: Record<string, ExportScalar> = dataset === "transfers"
    ? { timeFilter: "Not requested by the friendly transfer endpoint", loadedRowsOnly: true }
    : dataset === "equity" && period
      ? { range: period.range, groupBy: "ASSET" }
      : period
        ? { startTime: period.startTime, endTime: period.endTime }
        : { snapshot: "Current response" };
  const exportedAtUtc = new Date(exportedAtMs).toISOString();
  return {
    schemaVersion: "polytools.account-export.v1",
    dataset,
    environment: "testnet",
    scopeLabel: snapshot.scopeLabel === "Selected subaccount" ? "Selected subaccount" : "Main account",
    coverage: {
      operation: coverage.operation,
      contractVersion: coverage.contractVersion,
      status: coverage.status,
      pagesFetched: coverage.pagesFetched,
      rowsReceived: coverage.rowsReceived,
      rowsAccepted: coverage.rowsAccepted,
      duplicateRows: coverage.duplicateRows,
      conflictingRows: coverage.conflictingRows,
      unknownRows: coverage.unknownRows,
      droppedRows: coverage.droppedRows,
      cursorExhausted: coverage.cursorExhausted,
      stoppedAtCap: coverage.stoppedAtCap,
      openingBasis: coverage.openingBasis,
      nonFillFlows: coverage.nonFillFlows,
    },
    filters: { server, loadedRows },
    window: {
      range: period?.range ?? null,
      requestedStart: period?.startTime ?? null,
      requestedEnd: period?.endTime ?? null,
      actualStartTsSec: equity?.startTsSec ?? null,
      actualEndTsSec: equity?.endTsSec ?? null,
    },
    retrievedAtMs: selectedRetrievedAt(snapshot, dataset),
    exportedAtMs,
    exportedAtUtc,
    sourceRowCount: projection.sourceRowCount,
    exportedRowCount: projection.rows.length,
    method: dataset === "balances"
      ? "derived_total=trading+funding"
      : dataset === "fills"
        ? "observed-fill-cash-flow; actual fill fees only"
        : dataset === "transfers"
          ? "derived_signed_amount=isDebit?-source_amount:source_amount"
          : dataset === "equity"
            ? "sampled-valuation-not-pnl"
            : dataset === "feeRates"
              ? "current-effective-rate-not-historical-fee"
              : "source-values-only",
    privateWarning: ACCOUNT_EXPORT_PRIVATE_WARNING,
    statement: ACCOUNT_EXPORT_STATEMENT,
  };
}

const FILENAME_DATASET: Record<AccountExportDataset, string> = {
  balances: "balances",
  equity: "equity",
  orders: "orders",
  fills: "fills",
  transfers: "transfers",
  feeRates: "fee-rates",
};

export function accountExportFilename(
  dataset: AccountExportDataset,
  format: AccountExportFormat,
  exportedAtMs: number,
): string {
  if (!Number.isSafeInteger(exportedAtMs) || exportedAtMs < 0 || !Number.isFinite(new Date(exportedAtMs).getTime())) {
    throw new AccountExportError("INVALID_ARGUMENT", "The export timestamp is invalid.");
  }
  const timestamp = new Date(exportedAtMs).toISOString().replace(/[:.]/g, "-");
  return `polytools-testnet-${FILENAME_DATASET[dataset]}-${timestamp}.${format}`;
}

/**
 * Escape a CSV cell without changing valid exact decimal strings. Numeric
 * decimals are not formulas; other formula-prefixed text receives an
 * apostrophe before normal CSV quoting.
 */
export function accountCsvCell(value: ExportScalar): string {
  let text = value === null ? "" : String(value);
  const validDecimal = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text);
  if (!validDecimal && /^[\s\uFEFF]*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function manifestCsvValues(manifest: AccountExportManifest): AccountExportRow {
  const coverage = manifest.coverage;
  return {
    manifest_schema_version: manifest.schemaVersion,
    manifest_dataset: manifest.dataset,
    manifest_environment: manifest.environment,
    manifest_scope_label: manifest.scopeLabel,
    manifest_operation: coverage.operation,
    manifest_contract_version: coverage.contractVersion,
    manifest_status: coverage.status,
    manifest_pages_fetched: coverage.pagesFetched,
    manifest_rows_received: coverage.rowsReceived,
    manifest_rows_accepted: coverage.rowsAccepted,
    manifest_duplicate_rows: coverage.duplicateRows,
    manifest_conflicting_rows: coverage.conflictingRows,
    manifest_unknown_rows: coverage.unknownRows,
    manifest_dropped_rows: coverage.droppedRows,
    manifest_cursor_exhausted: coverage.cursorExhausted,
    manifest_stopped_at_cap: coverage.stoppedAtCap,
    manifest_opening_basis: coverage.openingBasis,
    manifest_non_fill_flows: coverage.nonFillFlows,
    manifest_filters_json: JSON.stringify(manifest.filters),
    manifest_window_json: JSON.stringify(manifest.window),
    manifest_retrieved_at_ms: manifest.retrievedAtMs,
    manifest_exported_at_utc: manifest.exportedAtUtc,
    manifest_source_row_count: manifest.sourceRowCount,
    manifest_exported_row_count: manifest.exportedRowCount,
    manifest_method: manifest.method,
    manifest_private_warning: manifest.privateWarning,
    manifest_statement: manifest.statement,
  };
}

export function createAccountExport(options: AccountExportOptions): AccountExportResult {
  if (options.format !== "csv" && options.format !== "json") {
    throw new AccountExportError("INVALID_ARGUMENT", "The export format is not supported.");
  }
  if (options.dataset !== "transfers" && (options.transferRows || options.transferFilters)) {
    throw new AccountExportError("INVALID_ARGUMENT", "Loaded-row transfer filters apply only to transfers.");
  }
  const exportedAtMs = options.exportedAtMs ?? Date.now();
  // Validate before doing any projection work or creating a downloadable file.
  const filename = accountExportFilename(options.dataset, options.format, exportedAtMs);
  const projection = projectionFor(options);
  const manifest = manifestFor(options, projection, exportedAtMs);
  if (options.format === "json") {
    return {
      filename,
      mimeType: "application/json;charset=utf-8",
      contents: `${JSON.stringify({ manifest, rows: projection.rows }, null, 2)}\n`,
      rowCount: projection.rows.length,
      manifest,
    };
  }
  if (projection.rows.length === 0) {
    throw new AccountExportError(
      "EMPTY_CSV",
      "CSV export needs at least one loaded row so its coverage manifest stays attached; use JSON for an empty covered response.",
    );
  }
  const manifestValues = manifestCsvValues(manifest);
  const manifestColumns = Object.keys(manifestValues);
  const columns = [...manifestColumns, ...projection.columns];
  const lines = [
    columns.map((column) => accountCsvCell(column)).join(","),
    ...projection.rows.map((row) => columns.map((column) => {
      const value = column in manifestValues ? manifestValues[column] : row[column] ?? null;
      return accountCsvCell(value);
    }).join(",")),
  ];
  return {
    filename,
    mimeType: "text/csv;charset=utf-8",
    contents: `${lines.join("\r\n")}\r\n`,
    rowCount: projection.rows.length,
    manifest,
  };
}
