import { price, splitSymbol, type MarketOverviewEntry } from "@poly/core";
import { COINGECKO_IDS, type CgPrices } from "./coingecko";

export type ComparePriceBasis = "index" | "last";
export type CompareViewMode = "matched" | "all";

export interface CompareRow {
  symbol: string;
  base: string;
  quote: string;
  indexPx: number;
  lastPx: number;
  lastTradeTsMs: number;
  geckoId: string | undefined;
  refUsd: number | null;
  absDiff: number | null;
  premBps: number | null;
  status: "matched" | "non_usd_quote" | "unmapped" | "ref_unavailable" | "poly_unavailable";
}

function activePrice(row: MarketOverviewEntry, basis: ComparePriceBasis): number {
  const indexPx = price(row.indexPrice);
  const lastPx = price(row.lastPrice);
  const indexValid = isFinite(indexPx) && indexPx > 0;
  const lastValid = isFinite(lastPx) && lastPx > 0;
  if (basis === "index") return indexValid ? indexPx : lastValid ? lastPx : Number.NaN;
  return lastValid ? lastPx : indexValid ? indexPx : Number.NaN;
}

/** Derive only genuine USD-reference matches; unavailable values stay null. */
export function buildCompareRows(
  markets: readonly MarketOverviewEntry[],
  cg: CgPrices | null,
  priceBasis: ComparePriceBasis,
): CompareRow[] {
  return markets.map((market) => {
    const [base, quote] = splitSymbol(market.symbol);
    const indexPx = price(market.indexPrice);
    const lastPx = price(market.lastPrice);
    const activePolyPx = activePrice(market, priceBasis);
    const geckoId = COINGECKO_IDS[base];
    const common = {
      symbol: market.symbol,
      base,
      quote,
      indexPx,
      lastPx,
      lastTradeTsMs: market.lastTradeTsMs,
      geckoId,
    };

    if (quote !== "USDT" && quote !== "USDC") {
      return { ...common, refUsd: null, absDiff: null, premBps: null, status: "non_usd_quote" };
    }
    if (!geckoId) {
      return { ...common, refUsd: null, absDiff: null, premBps: null, status: "unmapped" };
    }

    const rawRef = cg?.[geckoId]?.usd;
    const refUsd = typeof rawRef === "number" && isFinite(rawRef) && rawRef > 0
      ? rawRef
      : null;
    if (refUsd === null) {
      return { ...common, refUsd: null, absDiff: null, premBps: null, status: "ref_unavailable" };
    }
    if (!(isFinite(activePolyPx) && activePolyPx > 0)) {
      return { ...common, refUsd, absDiff: null, premBps: null, status: "poly_unavailable" };
    }

    const absDiff = activePolyPx - refUsd;
    return {
      ...common,
      refUsd,
      absDiff,
      premBps: (absDiff / refUsd) * 10_000,
      status: "matched",
    };
  });
}

/** Never substitute All Listed rows when the Matched filter has zero matches. */
export function selectVisibleCompareRows(
  allRows: readonly CompareRow[],
  matchedRows: readonly CompareRow[],
  viewMode: CompareViewMode,
): CompareRow[] {
  const list = viewMode === "matched" ? matchedRows : allRows;
  return [...list].sort((left, right) => {
    if (left.premBps !== null && right.premBps !== null) {
      return Math.abs(right.premBps) - Math.abs(left.premBps);
    }
    if (left.premBps !== null) return -1;
    if (right.premBps !== null) return 1;
    return left.symbol.localeCompare(right.symbol);
  });
}

export function compareMatchLabel(options: { sample: boolean; stale: boolean }): string {
  if (options.sample) return "Sample Match";
  if (options.stale) return "Stale Match";
  return "Live Match";
}
