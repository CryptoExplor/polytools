import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const EXPORTED_AT = Date.parse("2026-01-08T00:00:00.000Z");
const RETRIEVED_AT = Date.parse("2026-01-07T23:59:59.000Z");
const RAW_ACCOUNT = "raw-account-id-should-not-export";
const RAW_ADDRESS = "external-address-should-not-export";
const RAW_CURSOR = "cursor-secret-should-not-export";
const RAW_SECRET = "private-key-should-not-export";
let vite;
let account;

before(async () => {
  vite = await createServer({ root: rootDir, logLevel: "silent", server: { middlewareMode: true } });
  account = (await vite.ssrLoadModule("/packages/core/src/index.ts")).account;
});

after(async () => {
  if (vite) await vite.close();
});

function coverage(operation, rowsReceived, rowsAccepted, overrides = {}) {
  const result = account.emptyCoverage(operation, "synthetic-contract", "Main account");
  Object.assign(result, {
    status: "complete",
    pagesFetched: 1,
    rowsReceived,
    rowsAccepted,
    cursorExhausted: true,
    retrievedAtMs: RETRIEVED_AT,
    ...overrides,
  });
  // These are intentionally poisoned input metadata. Export uses a whitelist,
  // not this arbitrary request/error object.
  result.filters = {
    subaccountId: RAW_ACCOUNT,
    pageToken: RAW_CURSOR,
    apiKey: RAW_SECRET,
  };
  return result;
}

function dataset(data, coverageValue) {
  return {
    data,
    coverage: coverageValue,
    retrievedAtMs: RETRIEVED_AT,
    error: { code: "SERVER", detail: RAW_SECRET },
  };
}

function rawOrder() {
  return {
    orderId: "order1",
    symbol: "1",
    side: "BUY",
    status: "FILLED",
    orderType: "LIMIT",
    price: "100000.0000",
    origQty: "0.0100",
    cumQty: "0.0100",
    leavesQty: "0.0000",
    avgPx: "100000.0000",
    createdAt: "2026-01-01T00:00:00Z",
    lineage: { generation: 1, id: "order1" },
    version: 1,
    feeAsset: "QUOTE",
  };
}

function rawFill() {
  return {
    executedAt: "2026-01-01T00:00:00Z",
    fee: "0.8000",
    feeAsset: "QUOTE",
    feeIsRebate: false,
    isMaker: true,
    lineage: { generation: 1, id: "order1" },
    matchId: "123456",
    orderId: "order1",
    price: "100000.0000",
    qty: "0.0100",
    referralShare: "0.0000",
    side: "BUY",
    symbol: "1",
  };
}

function rawTransfer(overrides = {}) {
  return {
    account: "trading",
    asset: "USDT",
    amount: "1.2300",
    balanceAfter: "2.4600",
    destination: { kind: "TRADING_ACCOUNT", address: "", accountId: "account1" },
    flowId: "flow-id-should-not-export",
    isDebit: false,
    linkId: "999",
    source: { kind: "EXTERNAL_ADDRESS", address: RAW_ADDRESS },
    timestamp: "1700000000000000",
    transferCode: "DEPOSIT",
    ...overrides,
  };
}

function makeSnapshot() {
  const markets = { "1": { baseAsset: "BTC", quoteAsset: "USDT", marketSymbol: "BTC-USDT" } };
  const balances = account.validateBalancesResponse({
    balances: [{
      symbol: "BTC",
      trading: "2.5000",
      funding: "1.2500",
      reserved: "0.5000",
      available: "1.7500",
      tradingRevision: "4",
      fundingRevision: "5",
    }],
  });
  const equityResponse = account.validateEquityHistoryResponse({
    range: "7d",
    points: 2,
    startTsSec: 1700000000,
    endTsSec: 1700000100,
    btcPrices: ["100.0000", "101.0000"],
    series: [{ account: { accountCode: 1, name: RAW_ACCOUNT }, equity: ["10.0000", "11.0000"] }],
  });
  const equity = {
    response: equityResponse,
    seriesMetrics: equityResponse.series.map((series) => account.sampledEquityMetrics(
      series.equity.map((value, index) => ({ timestamp: String(index), equity: value })),
    )),
  };
  const orders = account.validateOrderHistoryResponse({ nextPageToken: RAW_CURSOR, orders: [rawOrder()] }, markets);
  const fillsPage = account.validateFillsResponse(
    { nextPageToken: RAW_CURSOR, trades: [rawFill()], transfers: [rawTransfer({ transferCode: "TRADE_QUOTE" })] },
    { accountScope: RAW_ACCOUNT, markets },
  );
  const fills = { summary: account.summarizeFills(fillsPage.fills, { status: "complete" }), quarantined: [] };
  const transfers = account.validateTransfersResponse({
    nextPageToken: RAW_CURSOR,
    transfers: [
      rawTransfer(),
      rawTransfer({
        account: "funding",
        asset: "=2+2",
        amount: "4.5000",
        balanceAfter: "5.0000",
        destination: { kind: "FUNDING_ACCOUNT", address: "" },
        source: { kind: "PRIVATE_COUNTERPARTY", address: RAW_ADDRESS, accountId: "account1" },
        isDebit: true,
        transferCode: "@future",
      }),
      rawTransfer({ amount: "0.1000", isDebit: true, transferCode: "TRADE_QUOTE" }),
    ],
  });
  const feeRates = account.validateFeeRatesResponse({
    feeRates: [{ symbol: "BTC-USDT", makerFeeRatePercent: "-0.0100", takerFeeRatePercent: "0.1000", vipTier: 0 }],
  });
  const snapshot = {
    period: {
      range: "7d",
      startTime: "2026-01-01T00:00:00.000Z",
      endTime: "2026-01-08T00:00:00.000Z",
    },
    scopeLabel: "Main account",
    balances: dataset(balances, coverage("balances", 1, 1)),
    equity: dataset(equity, coverage("equityHistory", 2, 2)),
    orders: dataset({ orders: orders.orders, quarantined: [] }, coverage("ordersHistory", 1, 1)),
    fills: dataset(fills, coverage("fills", 1, 1)),
    transfers: dataset(
      { transfers: transfers.transfers, quarantined: [] },
      coverage("transfers", 3, 2, { status: "partial", unknownRows: 1 }),
    ),
    feeRates: dataset(feeRates, coverage("feeRates", 1, 1)),
    accountId: RAW_ACCOUNT,
  };
  // Extra fields must not become an implicit JSON serialization contract.
  snapshot.transfers.data.transfers[0].privateKey = RAW_SECRET;
  snapshot.transfers.data.transfers[0].signature = "signature-should-not-export";
  snapshot.fills.data.summary.calculations[0].fill.credentials = RAW_SECRET;
  return snapshot;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n") {
      row.push(cell.endsWith("\r") ? cell.slice(0, -1) : cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value !== ""));
}

function asRecords(csv) {
  const rows = parseCsv(csv);
  const headers = rows[0];
  return rows.slice(1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""])));
}

describe("R2 transfer contract labels", () => {
  it("maps every known official reason and keeps unspecified/unknown reasons incompatible", () => {
    const expected = {
      DEPOSIT: "Deposit",
      WITHDRAW: "Withdrawal",
      MAKER_FEE: "Maker fee",
      TAKER_FEE: "Taker fee",
      INTERNAL_TRANSFER: "Internal transfer",
      TRADE_BASE: "Trade — base asset",
      TRADE_QUOTE: "Trade — quote asset",
      REBATE: "Rebate",
      FUNDING_TO_TRADING: "Funding → trading",
      TRADING_TO_FUNDING: "Trading → funding",
      TRADING_WITHDRAW_RESERVE: "Withdrawal reserve",
      FUNDING_USER_TRANSFER: "Funding user transfer",
      TRADING_WITHDRAW_REQUEST_FEE: "Withdrawal request fee",
    };
    for (const [code, label] of Object.entries(expected)) {
      assert.deepEqual(account.resolveTransferReason(code), { known: true, label });
    }
    assert.deepEqual(account.resolveTransferReason("TRANSFER_CODE_UNSPECIFIED"), { known: false, label: "Unknown activity" });
    assert.deepEqual(account.resolveTransferReason("FUTURE_REASON"), { known: false, label: "Unknown activity" });
    assert.equal(account.transferSideLabel("PRIVATE_COUNTERPARTY"), "Private counterparty");
  });
});

describe("R2 safe account exports", () => {
  it("preserves exact source decimals, separates derived fill values, and carries coverage metadata", () => {
    const snapshot = makeSnapshot();
    const result = account.createAccountExport({ snapshot, dataset: "transfers", format: "json", exportedAtMs: EXPORTED_AT });
    const parsed = JSON.parse(result.contents);
    assert.equal(result.filename, "polytools-testnet-transfers-2026-01-08T00-00-00-000Z.json");
    assert.equal(result.filename.includes(RAW_ACCOUNT), false);
    assert.equal(parsed.manifest.environment, "testnet");
    assert.equal(parsed.manifest.scopeLabel, "Main account");
    assert.equal(parsed.manifest.coverage.status, "partial");
    assert.equal(parsed.manifest.coverage.unknownRows, 1);
    assert.equal(parsed.manifest.coverage.rowsReceived, 3);
    assert.equal(parsed.manifest.coverage.rowsAccepted, 2);
    assert.equal(parsed.manifest.retrievedAtMs, RETRIEVED_AT);
    assert.equal(parsed.manifest.exportedAtUtc, "2026-01-08T00:00:00.000Z");
    assert.equal(parsed.manifest.window.requestedStart, null);
    assert.match(parsed.manifest.filters.server.timeFilter, /Not requested/);
    assert.equal(parsed.rows.length, 3);
    assert.equal(parsed.rows[0].source_amount, "1.2300");
    assert.equal(parsed.rows[0].source_balance_after, "2.4600");
    assert.equal(parsed.rows[0].derived_signed_amount, "1.23");
    assert.equal(parsed.rows[1].source_amount, "4.5000");
    assert.equal(parsed.rows[1].derived_signed_amount, "-4.5");
    assert.equal(parsed.rows[1].reason_label, "Unknown activity");
    assert.equal(parsed.rows[1].reason_known, false);
    assert.equal(parsed.rows[1].source_category, "Private counterparty");
    assert.equal(parsed.rows[0].destination_category, "Trading account");

    const fills = JSON.parse(account.createAccountExport({ snapshot, dataset: "fills", format: "json", exportedAtMs: EXPORTED_AT }).contents);
    assert.equal(fills.rows.length, 1);
    assert.equal(fills.rows[0].source_quantity, "0.0100");
    assert.equal(fills.rows[0].source_price, "100000.0000");
    assert.equal(fills.rows[0].source_fee_magnitude, "0.8000");
    assert.equal(fills.rows[0].derived_notional, "1000");
    assert.equal(fills.rows[0].derived_delta_quote, "-1000.8");
    assert.equal(fills.rows[0].makerFeeRatePercent, undefined);
    assert.equal(fills.manifest.window.requestedStart, snapshot.period.startTime);
    assert.deepEqual(fills.manifest.filters.server, {
      startTime: snapshot.period.startTime,
      endTime: snapshot.period.endTime,
    });
    const equity = JSON.parse(account.createAccountExport({ snapshot, dataset: "equity", format: "json", exportedAtMs: EXPORTED_AT }).contents);
    assert.deepEqual(equity.manifest.filters.server, { range: "7d", groupBy: "ASSET" });
    assert.equal(equity.manifest.window.actualStartTsSec, 1700000000);
    assert.equal(equity.rows[0].source_equity, "10.0000");

    const rates = JSON.parse(account.createAccountExport({ snapshot, dataset: "feeRates", format: "json", exportedAtMs: EXPORTED_AT }).contents);
    assert.equal(rates.rows[0].source_maker_fee_rate_percent, "-0.0100");
    assert.equal(rates.rows[0].source_taker_fee_rate_percent, "0.1000");
  });

  it("attaches a manifest to every CSV row and escapes formulas without changing valid decimals", () => {
    const snapshot = makeSnapshot();
    const result = account.createAccountExport({ snapshot, dataset: "transfers", format: "csv", exportedAtMs: EXPORTED_AT });
    const records = asRecords(result.contents);
    assert.equal(records.length, 3);
    assert.equal(records[0].manifest_status, "partial");
    assert.equal(records[0].manifest_unknown_rows, "1");
    assert.equal(records[0].manifest_source_row_count, "3");
    assert.equal(records[0].manifest_exported_row_count, "3");
    assert.equal(records[0].manifest_environment, "testnet");
    assert.match(records[0].manifest_private_warning, /private financial activity/);
    assert.equal(records[0].source_amount, "1.2300");
    assert.equal(records[1].asset, "'=2+2");
    assert.equal(records[1].reason_code, "'@future");
    assert.equal(records[1].source_amount, "4.5000");
    assert.equal(records[1].derived_signed_amount, "-4.5");
    assert.equal(account.accountCsvCell("=1+1"), "'=1+1");
    assert.equal(account.accountCsvCell("+1+1"), "'+1+1");
    assert.equal(account.accountCsvCell("-1+1"), "'-1+1");
    assert.equal(account.accountCsvCell("@command"), "'@command");
    assert.equal(account.accountCsvCell("-0.0100"), "-0.0100");
    assert.equal(account.accountCsvCell('a,"b"'), '"a,""b"""');
    const rates = asRecords(account.createAccountExport({ snapshot, dataset: "feeRates", format: "csv", exportedAtMs: EXPORTED_AT }).contents);
    assert.equal(rates[0].source_maker_fee_rate_percent, "-0.0100");
  });

  it("exports only the explicitly selected loaded transfer rows and records the filters", () => {
    const snapshot = makeSnapshot();
    const selected = snapshot.transfers.data.transfers[0];
    const result = account.createAccountExport({
      snapshot,
      dataset: "transfers",
      format: "json",
      exportedAtMs: EXPORTED_AT,
      transferRows: [selected],
      transferFilters: { asset: "USDT", direction: "CREDIT", reason: "Deposit" },
    });
    const parsed = JSON.parse(result.contents);
    assert.equal(parsed.manifest.sourceRowCount, 3);
    assert.equal(parsed.manifest.exportedRowCount, 1);
    assert.equal(parsed.manifest.filters.loadedRows.asset, "USDT");
    assert.equal(parsed.manifest.filters.loadedRows.direction, "CREDIT");
    assert.equal(parsed.manifest.filters.loadedRows.reason, "Deposit");
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0].reason_code, "DEPOSIT");
    assert.throws(
      () => account.createAccountExport({ snapshot, dataset: "transfers", format: "json", transferRows: [{ ...selected }] }),
      (error) => error?.code === "INVALID_ROWS",
    );
  });

  it("excludes credentials, identifiers, cursors, addresses, and raw errors from JSON and CSV", () => {
    const snapshot = makeSnapshot();
    const forbidden = [RAW_ACCOUNT, RAW_ADDRESS, RAW_CURSOR, RAW_SECRET, "signature-should-not-export", "order1", "123456", "account1"];
    for (const dataset of ["balances", "equity", "orders", "fills", "transfers", "feeRates"]) {
      for (const format of ["json", "csv"]) {
        const result = account.createAccountExport({ snapshot, dataset, format, exportedAtMs: EXPORTED_AT });
        for (const marker of forbidden) {
          assert.equal(result.contents.includes(marker), false, `${dataset}/${format} leaked ${marker}`);
        }
        assert.equal(result.contents.includes("pageToken"), false);
        assert.equal(result.contents.includes("privateKey"), false);
        assert.equal(result.contents.includes("signature"), false);
      }
    }
  });

  it("supports empty JSON coverage but refuses metadata-free empty CSV files", () => {
    const snapshot = makeSnapshot();
    snapshot.transfers.data.transfers = [];
    snapshot.transfers.coverage.rowsReceived = 0;
    snapshot.transfers.coverage.rowsAccepted = 0;
    snapshot.transfers.coverage.unknownRows = 0;
    const json = account.createAccountExport({ snapshot, dataset: "transfers", format: "json", exportedAtMs: EXPORTED_AT });
    assert.deepEqual(JSON.parse(json.contents).rows, []);
    assert.equal(JSON.parse(json.contents).manifest.exportedRowCount, 0);
    assert.throws(
      () => account.createAccountExport({ snapshot, dataset: "transfers", format: "csv", exportedAtMs: EXPORTED_AT }),
      (error) => error?.code === "EMPTY_CSV",
    );
  });
});
