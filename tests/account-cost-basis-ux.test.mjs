import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const START = "2026-01-01T00:00:00.000Z";
const END = "2026-01-04T00:00:00.000Z";
let vite;
let account;
let AccountCostBasis;

before(async () => {
  vite = await createServer({ root: rootDir, logLevel: "silent", server: { middlewareMode: true } });
  account = (await vite.ssrLoadModule("/packages/core/src/index.ts")).account;
  ({ AccountCostBasis } = await vite.ssrLoadModule("/apps/web/src/components/AccountCostBasis.tsx"));
});

after(async () => {
  if (vite) await vite.close();
});

function fill() {
  return {
    accountScope: "synthetic-scope",
    symbol: "1",
    marketSymbol: "BTC-USDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    matchId: "1",
    orderId: "order1",
    side: "BUY",
    quantity: "0.01",
    price: "100000",
    feeMagnitude: "0.8",
    feeAsset: "QUOTE",
    feeIsRebate: false,
    timestamp: "2026-01-01T01:00:00.000Z",
  };
}

function coverage(operation, rows, overrides = {}) {
  const value = account.emptyCoverage(operation, "synthetic-r3-ux", "Main account");
  Object.assign(value, {
    status: "complete",
    pagesFetched: 1,
    rowsReceived: rows,
    rowsAccepted: rows,
    cursorExhausted: true,
    requestedStart: operation === "fills" ? START : undefined,
    requestedEnd: operation === "fills" ? END : undefined,
    ...overrides,
  });
  return value;
}

function rawTransfer(overrides = {}) {
  return {
    account: "trading",
    asset: "BTC",
    amount: "0.01",
    balanceAfter: "0.02",
    destination: { kind: "TRADING_ACCOUNT", address: "", accountId: "account1" },
    flowId: "private-flow-id",
    isDebit: false,
    linkId: "99",
    source: { kind: "EXTERNAL_ADDRESS", address: "private-address" },
    timestamp: String(BigInt(Date.parse("2026-01-01T02:00:00.000Z")) * 1000n),
    transferCode: "DEPOSIT",
    ...overrides,
  };
}

function snapshot({ withFill = true, withTransfers = true, transferRows = [] } = {}) {
  const fills = withFill ? [fill()] : [];
  const transfers = withTransfers ? account.validateTransfersResponse({ nextPageToken: "", transfers: transferRows }).transfers : null;
  return {
    period: { range: "30d", startTime: START, endTime: END },
    scopeLabel: "Main account",
    fills: {
      data: withFill === null ? null : {
        summary: account.summarizeFills(fills, { status: "complete" }),
        quarantined: [],
      },
      coverage: coverage("fills", fills.length),
      retrievedAtMs: Date.parse(END),
    },
    transfers: {
      data: transfers === null ? null : { transfers, quarantined: [] },
      coverage: coverage("transfers", transferRows.length),
      retrievedAtMs: Date.parse(END),
    },
  };
}

function render(value) {
  return renderToStaticMarkup(React.createElement(AccountCostBasis, { snapshot: value, accountScope: "synthetic-scope" }));
}

describe("R3 cost-basis panel states and privacy", () => {
  it("renders exact-method inputs and blocks missing opening basis without a zero P&L value", () => {
    const html = render(snapshot());
    assert.ok(html.includes("BTC/USDT cost-basis inputs"));
    assert.ok(html.includes("Memory only"));
    assert.ok(html.includes("FIFO"));
    assert.ok(html.includes("Moving weighted average"));
    assert.ok(html.includes("P&amp;L blocked"));
    assert.ok(html.includes("Opening inventory and cost basis"));
    assert.ok(html.includes("Realized P&amp;L"));
    assert.ok(html.includes("Unavailable"));
    assert.ok(!html.includes("0.00 USDT"));
  });

  it("keeps transfer resolutions visible and explains single-scope internal-transfer blocking without rendering identifiers", () => {
    const html = render(snapshot({
      transferRows: [
        rawTransfer(),
        rawTransfer({ transferCode: "INTERNAL_TRANSFER", isDebit: true, source: { kind: "TRADING_ACCOUNT", address: "" }, destination: { kind: "PRIVATE_COUNTERPARTY", address: "private-address" } }),
      ],
    }));
    assert.ok(html.includes("0/2 resolved"));
    assert.ok(html.includes("Deposit"));
    assert.ok(html.includes("Internal transfer"));
    assert.ok(html.includes("single-scope view cannot prove both legs"));
    assert.ok(html.includes("Unresolved — blocks P&amp;L"));
    assert.ok(!html.includes("private-flow-id"));
    assert.ok(!html.includes("private-address"));
    assert.ok(!html.includes("account1"));
  });

  it("does not turn denied or unavailable private datasets into empty activity", () => {
    const value = snapshot();
    value.fills.data = null;
    value.fills.coverage.status = "denied";
    const html = render(value);
    assert.ok(html.includes("Complete fills and transfers are required"));
    assert.ok(html.includes("Unavailable reads are not zero"));
  });

  it("does not infer lifetime inactivity or opening zero from an empty validated fill result", () => {
    const html = render(snapshot({ withFill: false }));
    assert.ok(html.includes("No validated fills"));
    assert.ok(html.includes("Lifetime history and opening zero are unverified"));
  });

  it("adds no credential, persistence, mutation, or public-market fallback path", () => {
    const component = readFileSync(resolve(rootDir, "apps/web/src/components/AccountCostBasis.tsx"), "utf8");
    for (const forbidden of ["localStorage", "indexedDB", "sessionStorage", "fetch(", "api.trades", "createOrder", "cancelOrder", "PK", "privateKey"]) {
      assert.ok(!component.includes(forbidden), forbidden);
    }
    assert.ok(component.includes("Memory only"));
    assert.ok(component.includes("Current balances and prices are never historical cost"));
  });
});
