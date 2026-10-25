import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const START = "2026-01-01T00:00:00.000Z";
const END = "2026-01-04T00:00:00.000Z";
const NOW = Date.parse("2026-01-04T00:00:00.000Z");
let vite;
let account;

before(async () => {
  vite = await createServer({ root: rootDir, logLevel: "silent", server: { middlewareMode: true } });
  account = (await vite.ssrLoadModule("/packages/core/src/index.ts")).account;
});

after(async () => {
  if (vite) await vite.close();
});

function coverage(rows, overrides = {}) {
  const value = account.emptyCoverage("fills", "synthetic-r3", "Main account");
  Object.assign(value, {
    status: "complete",
    pagesFetched: 1,
    rowsReceived: rows,
    rowsAccepted: rows,
    cursorExhausted: true,
    requestedStart: START,
    requestedEnd: END,
    ...overrides,
  });
  return value;
}

function flowCoverage(rows = 0, overrides = {}) {
  const value = account.emptyCoverage("transfers", "synthetic-r3", "Main account");
  Object.assign(value, {
    status: "complete",
    pagesFetched: 1,
    rowsReceived: rows,
    rowsAccepted: rows,
    cursorExhausted: true,
    ...overrides,
  });
  return value;
}

function fill(overrides = {}) {
  return {
    accountScope: "scope-a",
    symbol: "1",
    marketSymbol: "BTC-USDT",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    matchId: "1",
    orderId: "order1",
    side: "BUY",
    quantity: "1",
    price: "100",
    feeMagnitude: "0",
    feeAsset: "QUOTE",
    feeIsRebate: false,
    timestamp: "2026-01-01T01:00:00.000Z",
    ...overrides,
  };
}

function opening(overrides = {}) {
  return {
    accountScope: "scope-a",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    quantity: "1",
    cost: "100",
    acquiredAt: "2025-12-01T00:00:00.000Z",
    provenance: "Synthetic independently supplied opening lot",
    ...overrides,
  };
}

function zero(overrides = {}) {
  return {
    accountScope: "scope-a",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    at: START,
    provenance: "Synthetic complete history from account inception proves opening zero",
    fromInception: true,
    ...overrides,
  };
}

function flow(overrides = {}) {
  return {
    kind: "acquisition",
    accountScope: "scope-a",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    quantity: "1",
    cost: "150",
    timestamp: "2026-01-01T02:00:00.000Z",
    provenance: "Synthetic external acquisition with documented cost",
    ...overrides,
  };
}

function analyze({
  fills = [],
  openingLots = [],
  openingZero = [],
  events = [],
  requiredCount = 0,
  resolvedCount = requiredCount,
  fillCoverage = coverage(fills.length),
  transferCoverage = flowCoverage(requiredCount),
  flowIssues = [],
  marks = [],
  method = "FIFO",
  nowMs = NOW,
} = {}) {
  return account.analyzeCostBasis({
    method,
    openingLots,
    openingZero,
    fills,
    fillCoverage,
    flowResolution: {
      coverage: transferCoverage,
      requiredCount,
      resolvedCount,
      events,
      issues: flowIssues,
    },
    marks,
    nowMs,
    maxMarkAgeMs: 5 * 60 * 1000,
  });
}

function only(results) {
  assert.equal(results.length, 1);
  return results[0];
}

function mark(overrides = {}) {
  return {
    accountScope: "scope-a",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    price: "110",
    source: "Synthetic manually labeled last price",
    kind: "last",
    timestamp: "2026-01-03T23:59:00.000Z",
    ...overrides,
  };
}

describe("R3 exact FIFO and weighted-average cost basis", () => {
  it("matches the hand-calculated quote-fee buy/sell example without confusing cash flow with a general P&L rule", () => {
    const result = only(analyze({
      openingZero: [zero()],
      fills: [
        fill({ quantity: "0.01", price: "100000", feeMagnitude: "0.8" }),
        fill({ matchId: "2", orderId: "order2", side: "SELL", quantity: "0.01", price: "110000", feeMagnitude: "0.88", timestamp: "2026-01-02T00:00:00.000Z" }),
      ],
    }));
    assert.equal(result.realizedAvailable, true);
    assert.equal(result.realizedPnl.raw, "98.32");
    assert.equal(result.remainingQuantity.raw, "0");
    assert.equal(result.remainingCost.raw, "0");
    assert.equal(result.unrealizedPnl, null);
    assert.equal(result.totalPnl, null);
  });

  it("uses actual base-fee-adjusted acquisition quantity and a fresh labeled mark", () => {
    const result = only(analyze({
      openingZero: [zero()],
      fills: [fill({ quantity: "0.01", price: "100000", feeMagnitude: "0.000008", feeAsset: "BASE" })],
      marks: [mark({ price: "110000" })],
    }));
    assert.equal(result.realizedPnl.raw, "0");
    assert.equal(result.remainingQuantity.raw, "0.009992");
    assert.equal(result.remainingCost.raw, "1000");
    assert.equal(result.marketValue.raw, "1099.12");
    assert.equal(result.unrealizedPnl.raw, "99.12");
    assert.equal(result.totalPnl.raw, "99.12");
    assert.equal(result.markStatus, "fresh");
  });

  it("adds a real quote rebate to disposal proceeds", () => {
    const result = only(analyze({
      openingLots: [opening({ quantity: "0.02", cost: "80" })],
      fills: [fill({ side: "SELL", quantity: "0.02", price: "5000", feeMagnitude: "0.01", feeIsRebate: true })],
    }));
    assert.equal(result.realizedPnl.raw, "20.01");
    assert.equal(result.remainingQuantity.raw, "0");
  });

  it("removes multiple FIFO lots exactly and retains the remaining acquisition cost", () => {
    const result = only(analyze({
      openingLots: [
        opening({ quantity: "1", cost: "100", acquiredAt: "2025-11-01T00:00:00.000Z" }),
        opening({ quantity: "2", cost: "300", acquiredAt: "2025-12-01T00:00:00.000Z" }),
      ],
      fills: [
        fill({ side: "SELL", quantity: "1.5", price: "200" }),
        fill({ matchId: "2", orderId: "order2", quantity: "0.5", price: "250", timestamp: "2026-01-02T00:00:00.000Z" }),
      ],
      marks: [mark({ price: "200" })],
    }));
    assert.equal(result.realizedPnl.raw, "125");
    assert.equal(result.remainingQuantity.raw, "2");
    assert.equal(result.remainingCost.raw, "350");
    assert.equal(result.marketValue.raw, "400");
    assert.equal(result.unrealizedPnl.raw, "50");
    assert.equal(result.totalPnl.raw, "175");
  });

  it("keeps recurring moving-weighted-average cost as an exact rational", () => {
    const result = only(analyze({
      method: "WEIGHTED_AVERAGE",
      openingLots: [
        opening({ quantity: "1", cost: "100" }),
        opening({ quantity: "2", cost: "300", acquiredAt: "2025-12-02T00:00:00.000Z" }),
      ],
      fills: [fill({ side: "SELL", quantity: "1", price: "200" })],
    }));
    assert.equal(result.realizedPnl.raw, "200/3");
    assert.equal(result.realizedPnl.numerator, 200n);
    assert.equal(result.realizedPnl.denominator, 3n);
    assert.equal(result.remainingCost.raw, "800/3");
    assert.equal(result.remainingQuantity.raw, "2");
    assert.equal(account.formatDecimal(result.realizedPnl, 2), "66.67");
    assert.equal(result.realizedPnl.raw, "200/3");
  });
});

describe("R3 coverage, opening-basis, flow, and mark gates", () => {
  it("blocks flat-window P&L when opening basis is unknown", () => {
    const result = only(analyze({
      fills: [
        fill(),
        fill({ matchId: "2", orderId: "order2", side: "SELL", timestamp: "2026-01-02T00:00:00.000Z" }),
      ],
    }));
    assert.equal(result.openingBasis, "unknown");
    assert.equal(result.realizedAvailable, false);
    assert.equal(result.realizedPnl, null);
    assert.equal(result.remainingQuantity, null);
    assert.match(result.issues[0], /Opening inventory and cost basis/);
  });

  it("blocks inventory underflow instead of realizing uncovered inventory at zero cost", () => {
    const result = only(analyze({ openingZero: [zero()], fills: [fill({ side: "SELL" })] }));
    assert.equal(result.realizedAvailable, false);
    assert.equal(result.realizedPnl, null);
    assert.match(result.issues.join(" "), /disposal exceeds established inventory/);
  });

  it("blocks partial fill coverage and incomplete cursor history", () => {
    const result = only(analyze({
      openingZero: [zero()],
      fills: [fill()],
      fillCoverage: coverage(1, { status: "partial", cursorExhausted: false, stoppedAtCap: true }),
    }));
    assert.equal(result.realizedAvailable, false);
    assert.equal(result.realizedPnl, null);
  });

  it("blocks unresolved or unknown non-fill flows even when the fills themselves are complete", () => {
    for (const options of [
      { requiredCount: 1, resolvedCount: 0 },
      { requiredCount: 1, resolvedCount: 1, flowIssues: ["Unknown transfer code"] },
      { requiredCount: 1, resolvedCount: 1, transferCoverage: flowCoverage(1, { status: "partial", unknownRows: 1, rowsAccepted: 0 }) },
    ]) {
      const result = only(analyze({ openingZero: [zero()], fills: [fill()], ...options }));
      assert.equal(result.realizedAvailable, false);
      assert.equal(result.realizedPnl, null);
      assert.equal(result.nonFillFlows, "unresolved");
    }
  });

  it("carries documented external basis and never treats a non-trade withdrawal as a zero-proceeds sale", () => {
    const result = only(analyze({
      openingLots: [opening({ quantity: "1", cost: "100" })],
      events: [
        flow(),
        flow({ kind: "non-trade-disposal", quantity: "1.5", cost: undefined, timestamp: "2026-01-02T00:00:00.000Z", provenance: "Synthetic external withdrawal; not a trade" }),
      ],
      requiredCount: 2,
      fills: [fill({ side: "SELL", quantity: "0.5", price: "250", timestamp: "2026-01-03T00:00:00.000Z" })],
    }));
    assert.equal(result.realizedAvailable, true);
    assert.equal(result.nonTradeRemovedCost.raw, "175");
    assert.equal(result.realizedPnl.raw, "50");
    assert.equal(result.remainingQuantity.raw, "0");
  });

  it("carries exact basis between linked internal scopes and blocks an unmatched leg", () => {
    const openingZero = [zero({ accountScope: "scope-b" })];
    const events = [
      flow({ kind: "internal-transfer-out", cost: undefined, quantity: "1", targetScope: "scope-b", linkKey: "link-1", timestamp: "2026-01-01T02:00:00.000Z" }),
      flow({ kind: "internal-transfer-in", cost: undefined, accountScope: "scope-b", sourceScope: "scope-a", quantity: "1", linkKey: "link-1", timestamp: "2026-01-01T02:00:01.000Z" }),
    ];
    const results = analyze({
      openingLots: [opening({ quantity: "2", cost: "200" })],
      openingZero,
      events,
      requiredCount: 2,
      fills: [fill({ accountScope: "scope-b", side: "SELL", price: "150", timestamp: "2026-01-02T00:00:00.000Z" })],
    });
    const left = results.find((result) => result.accountScope === "scope-a");
    const right = results.find((result) => result.accountScope === "scope-b");
    assert.equal(left.realizedPnl.raw, "0");
    assert.equal(left.remainingQuantity.raw, "1");
    assert.equal(left.remainingCost.raw, "100");
    assert.equal(right.realizedPnl.raw, "50");
    assert.equal(right.remainingQuantity.raw, "0");

    const blockedResults = analyze({
      openingZero: [zero()],
      events: [flow({ kind: "internal-transfer-in", cost: undefined, sourceScope: "scope-x", linkKey: "missing", quantity: "1" })],
      requiredCount: 1,
    });
    const blocked = blockedResults.find((result) => result.accountScope === "scope-a");
    assert.equal(blocked.realizedAvailable, false);
    assert.equal(blocked.realizedPnl, null);
    assert.ok(blockedResults.every((result) => result.realizedPnl === null));
  });

  it("invalidates both sides of an unmatched or otherwise invalid internal mapping", () => {
    const unmatched = analyze({
      openingLots: [opening({ accountScope: "scope-x", quantity: "2", cost: "200" })],
      openingZero: [zero()],
      events: [flow({ kind: "internal-transfer-in", cost: undefined, sourceScope: "scope-x", linkKey: "missing", quantity: "1" })],
      requiredCount: 1,
    });
    assert.ok(unmatched.every((result) => result.realizedAvailable === false));

    const invalidTarget = analyze({
      openingLots: [
        opening({ quantity: "2", cost: "200" }),
        opening({ accountScope: "scope-b", quantity: "1", cost: "-1" }),
      ],
      events: [flow({ kind: "internal-transfer-out", cost: undefined, quantity: "1", targetScope: "scope-b", linkKey: "link-invalid" })],
      requiredCount: 1,
    });
    assert.ok(invalidTarget.every((result) => result.realizedAvailable === false));
  });

  it("rejects unknown runtime flow kinds instead of treating them as internal credits", () => {
    const results = analyze({
      openingLots: [opening({ quantity: "2", cost: "200" })],
      openingZero: [zero({ accountScope: "scope-b" })],
      events: [
        flow({ kind: "internal-transfer-out", cost: undefined, quantity: "1", targetScope: "scope-b", linkKey: "future-link" }),
        flow({ kind: "future-internal-credit", cost: undefined, accountScope: "scope-b", sourceScope: "scope-a", quantity: "1", linkKey: "future-link" }),
      ],
      requiredCount: 2,
    });
    assert.ok(results.every((result) => result.realizedAvailable === false));
    assert.ok(results.some((result) => result.issues.some((issue) => issue.includes("unknown resolved-flow kind"))));
  });

  it("blocks the counterpart when an invalid source skips an outgoing internal mapping", () => {
    const results = analyze({
      openingLots: [
        opening({ cost: "-1" }),
        opening({ accountScope: "scope-b", quantity: "1", cost: "100" }),
      ],
      events: [flow({ kind: "internal-transfer-out", cost: undefined, quantity: "1", targetScope: "scope-b", linkKey: "skipped-link" })],
      requiredCount: 1,
    });
    assert.ok(results.every((result) => result.realizedAvailable === false));
  });

  it("rejects an unrecognized runtime opening-basis status instead of treating it as provenance", () => {
    const result = only(analyze({ openingLots: [opening({ basisStatus: "not-a-real-status" })] }));
    assert.equal(result.realizedAvailable, false);
    assert.match(result.issues.join(" "), /basis status/);
  });

  it("keeps mixed quote assets in independent ledgers without conversion", () => {
    const usdt = zero();
    const usdc = zero({ baseAsset: "ETH", quoteAsset: "USDC" });
    const results = analyze({
      openingZero: [usdt, usdc],
      fills: [
        fill(),
        fill({ baseAsset: "ETH", quoteAsset: "USDC", marketSymbol: "ETH-USDC", symbol: "2" }),
      ],
    });
    assert.equal(results.length, 2);
    assert.deepEqual(results.map((result) => result.quoteAsset).sort(), ["USDC", "USDT"]);
    assert.ok(results.every((result) => result.realizedAvailable));
    assert.ok(results.every((result) => result.remainingCost.raw === "100"));
  });

  it("suppresses only unrealized values for missing, stale, or conflicting marks", () => {
    for (const marks of [
      [],
      [mark({ timestamp: "2026-01-03T00:00:00.000Z" })],
      [mark(), mark({ source: "A second conflicting mark" })],
    ]) {
      const result = only(analyze({ openingLots: [opening()], marks }));
      assert.equal(result.realizedAvailable, true);
      assert.equal(result.realizedPnl.raw, "0");
      assert.equal(result.remainingQuantity.raw, "1");
      assert.equal(result.remainingCost.raw, "100");
      assert.equal(result.unrealizedAvailable, false);
      assert.equal(result.unrealizedPnl, null);
      assert.equal(result.totalPnl, null);
    }
  });

  it("rejects opening lots created after the arbitrary analysis-window start", () => {
    const result = only(analyze({
      openingLots: [opening({ acquiredAt: "2026-01-02T00:00:00.000Z" })],
      fills: [fill({ timestamp: "2026-01-03T00:00:00.000Z" })],
    }));
    assert.equal(result.realizedAvailable, false);
    assert.match(result.issues.join(" "), /at or before the analysis start/);
  });
});
