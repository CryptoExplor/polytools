import { compare, fromBigInt, parseDecimal } from "./decimal";
import { resolveTransferReason } from "./activity";
import type { BalanceInput, FillInput } from "./analytics";

export class AccountSchemaError extends Error {
  constructor(message = "The account response schema is incompatible.") {
    super(message);
    this.name = "AccountSchemaError";
  }
}

function fail(): never {
  throw new AccountSchemaError();
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail();
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) return fail();
  return value;
}

function string(value: unknown, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || /[\u0000-\u001f\u007f]/.test(value)) return fail();
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") return fail();
  return value;
}

function integer(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return fail();
  return value;
}

function decimal(value: unknown, allowNegative = false): string {
  const raw = string(value);
  if (!allowNegative && raw.startsWith("-")) return fail();
  try {
    parseDecimal(raw);
  } catch {
    return fail();
  }
  return raw;
}

function digits(value: unknown): string {
  const raw = string(value);
  return /^\d+$/.test(raw) ? raw : fail();
}

function base58(value: unknown): string {
  const raw = string(value);
  return /^[1-9A-HJ-NP-Za-km-z]+$/.test(raw) ? raw : fail();
}

export interface NormalizedBalance extends BalanceInput {
  symbol: string;
  tradingRevision: string;
  fundingRevision: string;
}

export function validateBalancesResponse(value: unknown): { balances: NormalizedBalance[] } {
  const response = object(value);
  const balances = array(response.balances).map((row) => {
    const item = object(row);
    const symbol = string(item.symbol);
    return {
      asset: symbol,
      symbol,
      trading: decimal(item.trading),
      funding: decimal(item.funding),
      reserved: decimal(item.reserved),
      available: decimal(item.available),
      tradingRevision: digits(item.tradingRevision),
      fundingRevision: digits(item.fundingRevision),
    };
  });
  return { balances };
}

export interface BalanceHistorySeries {
  account: string;
  asset: string;
  balance: string[];
}

export interface BalanceHistoryResponse {
  range: string;
  bucket?: string;
  startTsSec?: number;
  endTsSec?: number;
  points?: number;
  series: BalanceHistorySeries[];
}

function historyBounds(response: Record<string, unknown>): Pick<BalanceHistoryResponse, "bucket" | "startTsSec" | "endTsSec" | "points"> {
  const result: ReturnType<typeof historyBounds> = {};
  if (response.bucket !== undefined) result.bucket = string(response.bucket);
  if (response.startTsSec !== undefined) result.startTsSec = integer(response.startTsSec);
  if (response.endTsSec !== undefined) result.endTsSec = integer(response.endTsSec);
  if (response.points !== undefined) {
    result.points = integer(response.points);
    if (result.points < 0) fail();
  }
  return result;
}

function checkPointCount(points: number | undefined, length: number): void {
  if (points !== undefined && points !== length) fail();
}

export function validateBalanceHistoryResponse(value: unknown): BalanceHistoryResponse {
  const response = object(value);
  const range = string(response.range);
  if (!["1d", "7d", "30d", "90d", "180d", "365d"].includes(range)) fail();
  const series = array(response.series).map((row) => {
    const item = object(row);
    const balance = array(item.balance).map((entry) => decimal(entry));
    return {
      account: string(item.account),
      asset: string(item.asset),
      balance,
    };
  });
  const bounds = historyBounds(response);
  const alignedLength = series[0]?.balance.length;
  for (const row of series) {
    checkPointCount(bounds.points, row.balance.length);
    if (alignedLength !== undefined && row.balance.length !== alignedLength) fail();
  }
  return { range, series, ...bounds };
}

export interface EquityHistorySeries {
  equity: string[];
  account?: { accountCode?: number; name?: string };
  asset?: { id?: number; symbol?: string };
}

export interface EquityHistoryResponse {
  range: string;
  bucket?: string;
  startTsSec?: number;
  endTsSec?: number;
  points?: number;
  quoteAsset?: string;
  btcPrices: string[];
  series: EquityHistorySeries[];
}

export function validateEquityHistoryResponse(value: unknown): EquityHistoryResponse {
  const response = object(value);
  const range = string(response.range);
  if (!["1d", "7d", "30d", "90d", "180d", "365d"].includes(range)) fail();
  const btcPrices = array(response.btcPrices).map((entry) => decimal(entry));
  const series = array(response.series).map((row) => {
    const item = object(row);
    const result: EquityHistorySeries = { equity: array(item.equity).map((entry) => decimal(entry)) };
    if (item.account !== undefined) {
      const account = object(item.account);
      result.account = {};
      if (account.accountCode !== undefined) result.account.accountCode = integer(account.accountCode);
      if (account.name !== undefined) result.account.name = string(account.name);
    }
    if (item.asset !== undefined) {
      const asset = object(item.asset);
      result.asset = {};
      if (asset.id !== undefined) result.asset.id = integer(asset.id);
      if (asset.symbol !== undefined) result.asset.symbol = string(asset.symbol);
    }
    return result;
  });
  const bounds = historyBounds(response);
  const alignedLength = series[0]?.equity.length;
  for (const row of series) {
    checkPointCount(bounds.points, row.equity.length);
    if (alignedLength !== undefined && row.equity.length !== alignedLength) fail();
  }
  if (bounds.points !== undefined) checkPointCount(bounds.points, btcPrices.length);
  if (alignedLength !== undefined && btcPrices.length !== alignedLength) fail();
  const result: EquityHistoryResponse = { range, series, btcPrices, ...bounds };
  if (response.quoteAsset !== undefined) result.quoteAsset = string(response.quoteAsset);
  return result;
}

export interface FillMarket {
  baseAsset: string;
  quoteAsset: string;
  /** Friendly pair label used only for display, not dedup identity. */
  marketSymbol?: string;
}

export interface NormalizedFillPage {
  nextPageToken: string;
  fills: FillInput[];
  /** Unknown rows remain in memory for a visible incompatibility state. */
  quarantined: unknown[];
  settlementLegs: unknown[];
}

function resolveFillMarket(
  symbol: string,
  markets: Readonly<Record<string, FillMarket>>,
): { symbolId: string; market: FillMarket } {
  // Friendly REST has used both a numeric symbol ID and a pair string for
  // this field. Accept either, but never guess when the catalog is ambiguous.
  const matches = Object.entries(markets)
    .filter(([marketId, market]) => marketId === symbol || market.marketSymbol === symbol);
  if (matches.length !== 1) throw new AccountSchemaError("Unknown or ambiguous fill market; row quarantined.");
  const [symbolId, market] = matches[0];
  return { symbolId, market };
}

export function validateFillsResponse(
  value: unknown,
  context: { accountScope: string; markets: Readonly<Record<string, FillMarket>> },
): NormalizedFillPage {
  const response = object(value);
  const nextPageToken = string(response.nextPageToken, true);
  const quarantined: unknown[] = [];
  const fills: FillInput[] = [];
  for (const raw of array(response.trades)) {
    try {
      const row = object(raw);
      const symbol = string(row.symbol);
      const { symbolId, market } = resolveFillMarket(symbol, context.markets);
      const side = string(row.side);
      if (side !== "BUY" && side !== "SELL") fail();
      const feeAsset = string(row.feeAsset);
      if (feeAsset !== "BASE" && feeAsset !== "QUOTE") fail();
      const lineage = object(row.lineage);
      const generation = integer(lineage.generation);
      if (generation < 1) fail();
      const fill: FillInput = {
        accountScope: context.accountScope,
        // Canonical catalog identity keeps aliases deduplicable across pages.
        symbol: symbolId,
        marketSymbol: market.marketSymbol,
        baseAsset: string(market.baseAsset),
        quoteAsset: string(market.quoteAsset),
        matchId: digits(row.matchId),
        orderId: base58(row.orderId),
        side,
        quantity: decimal(row.qty),
        price: decimal(row.price),
        feeMagnitude: decimal(row.fee),
        feeAsset,
        // Proto3 boolean false may be omitted by JSON serializers; the
        // documented default is a charge, while any present non-boolean fails.
        feeIsRebate: row.feeIsRebate === undefined ? false : boolean(row.feeIsRebate),
        timestamp: string(row.executedAt),
        lineageId: base58(lineage.id),
        generation,
        isMaker: boolean(row.isMaker),
        referralShare: decimal(row.referralShare),
      };
      fills.push(fill);
    } catch {
      quarantined.push(raw);
    }
  }
  // Proto/REST serializers may omit an empty repeated settlement-leg field.
  const settlementLegs = response.transfers === undefined ? [] : array(response.transfers);
  return { nextPageToken, fills, quarantined, settlementLegs };
}

export interface NormalizedTransferSide {
  kind: string;
  address: string;
  accountId?: string;
  chainId?: number;
}

export interface NormalizedTransfer {
  account: string;
  asset: string;
  amount: string;
  balanceAfter: string;
  destination: NormalizedTransferSide;
  flowId: string;
  isDebit: boolean;
  linkId: string;
  source: NormalizedTransferSide;
  timestamp: string;
  transferCode: string;
  /** Unknown/unspecified reasons stay visible but do not pass coverage gates. */
  reasonKnown: boolean;
  reasonLabel: string;
}

export interface NormalizedTransferPage {
  nextPageToken: string;
  transfers: NormalizedTransfer[];
  quarantined: unknown[];
}

const TRANSFER_SIDE_KINDS = new Set([
  "FUNDING_ACCOUNT",
  "TRADING_ACCOUNT",
  "EXTERNAL_ADDRESS",
  "PRIVATE_COUNTERPARTY",
  "FEE_ACCOUNT",
  "SYSTEM_ACCOUNT",
]);

function transferSide(value: unknown): NormalizedTransferSide {
  const side = object(value);
  const kind = string(side.kind);
  if (!TRANSFER_SIDE_KINDS.has(kind)) fail();
  const result: NormalizedTransferSide = {
    kind,
    address: string(side.address, true),
  };
  if (side.accountId !== undefined) result.accountId = base58(side.accountId);
  if (side.chainId !== undefined) result.chainId = integer(side.chainId);
  return result;
}

/** Validate financial representations without inventing a transfer-leg key. */
export function validateTransfersResponse(value: unknown): NormalizedTransferPage {
  const response = object(value);
  const nextPageToken = string(response.nextPageToken, true);
  const transfers: NormalizedTransfer[] = [];
  const quarantined: unknown[] = [];
  for (const raw of array(response.transfers)) {
    try {
      const row = object(raw);
      const transferCode = string(row.transferCode);
      const reason = resolveTransferReason(transferCode);
      transfers.push({
        account: string(row.account),
        asset: string(row.asset),
        amount: decimal(row.amount),
        balanceAfter: decimal(row.balanceAfter),
        destination: transferSide(row.destination),
        flowId: string(row.flowId, true),
        isDebit: boolean(row.isDebit),
        linkId: digits(row.linkId),
        source: transferSide(row.source),
        timestamp: digits(row.timestamp),
        transferCode,
        reasonKnown: reason.known,
        reasonLabel: reason.label,
      });
    } catch {
      quarantined.push(raw);
    }
  }
  return { nextPageToken, transfers, quarantined };
}

export interface NormalizedOrder {
  orderId: string;
  symbol: string;
  marketSymbol?: string;
  side: "BUY" | "SELL";
  status: string;
  orderType: string;
  price: string;
  origQty: string;
  cumQty: string;
  leavesQty: string;
  avgPx: string;
  createdAt: string;
  terminalAt?: string;
  lineageId: string;
  generation: number;
  version: number;
  feeAsset?: "BASE" | "QUOTE";
}

export interface NormalizedOrderPage {
  nextPageToken: string;
  orders: NormalizedOrder[];
  quarantined: unknown[];
}

const ORDER_SIDES = new Set(["BUY", "SELL"]);
const ORDER_STATUSES = new Set(["PENDING", "PENDING_CANCEL", "WORKING", "FILLED", "CANCELED", "REJECTED"]);
const ORDER_TYPES = new Set(["LIMIT", "MARKET"]);

export function validateOrderHistoryResponse(
  value: unknown,
  markets: Readonly<Record<string, FillMarket>> = {},
): NormalizedOrderPage {
  const response = object(value);
  const nextPageToken = string(response.nextPageToken, true);
  const orders: NormalizedOrder[] = [];
  const quarantined: unknown[] = [];
  for (const raw of array(response.orders)) {
    try {
      const row = object(raw);
      const side = string(row.side);
      const status = string(row.status);
      const orderType = string(row.orderType);
      if (!ORDER_SIDES.has(side) || !ORDER_STATUSES.has(status) || !ORDER_TYPES.has(orderType)) fail();
      const lineage = object(row.lineage);
      const generation = integer(lineage.generation);
      if (generation < 1) fail();
      const symbol = string(row.symbol);
      const order: NormalizedOrder = {
        orderId: base58(row.orderId),
        symbol,
        marketSymbol: markets[symbol]?.marketSymbol,
        side: side as "BUY" | "SELL",
        status,
        orderType,
        price: decimal(row.price),
        origQty: decimal(row.origQty),
        cumQty: decimal(row.cumQty),
        leavesQty: decimal(row.leavesQty),
        avgPx: decimal(row.avgPx),
        createdAt: string(row.createdAt),
        lineageId: base58(lineage.id),
        generation,
        version: integer(row.version),
      };
      if (row.terminalAt !== undefined) order.terminalAt = string(row.terminalAt);
      if (row.feeAsset !== undefined) {
        const feeAsset = string(row.feeAsset);
        if (feeAsset !== "BASE" && feeAsset !== "QUOTE") fail();
        order.feeAsset = feeAsset;
      }
      orders.push(order);
    } catch {
      quarantined.push(raw);
    }
  }
  return { nextPageToken, orders, quarantined };
}

export interface NormalizedFeeRate {
  symbol: string;
  makerFeeRatePercent: string;
  takerFeeRatePercent: string;
  vipTier: number;
}

export function validateFeeRatesResponse(value: unknown): { feeRates: NormalizedFeeRate[] } {
  const response = object(value);
  const feeRates = array(response.feeRates).map((raw) => {
    const row = object(raw);
    const maker = decimal(row.makerFeeRatePercent, true);
    const taker = decimal(row.takerFeeRatePercent);
    if (compare(parseDecimal(maker), fromBigInt(-100n)) < 0 || compare(parseDecimal(maker), fromBigInt(100n)) > 0) fail();
    if (compare(parseDecimal(taker), fromBigInt(100n)) > 0) fail();
    const vipTier = integer(row.vipTier);
    if (vipTier < 0 || vipTier > 10) fail();
    return {
      symbol: string(row.symbol),
      makerFeeRatePercent: maker,
      takerFeeRatePercent: taker,
      vipTier,
    };
  });
  return { feeRates };
}

export function validateObjectResponse(value: unknown): Record<string, unknown> {
  return object(value);
}
