export function marketForSymbol<T extends { symbol: string }>(
  markets: readonly T[] | null | undefined,
  symbol: string,
): T | null {
  return markets?.find((market) => market.symbol === symbol) ?? null;
}

export function orderbookForRequest<T extends { symbol: string; depth: number }>(
  response: T | null | undefined,
  symbol: string,
  depth: number,
): T | null {
  return response?.symbol === symbol && response.depth === depth ? response : null;
}

export function candlesForRequest<T extends { symbol: string; timeframe: string }>(
  response: T | null | undefined,
  symbol: string,
  timeframe: string,
): T | null {
  return response?.symbol === symbol && response.timeframe === timeframe ? response : null;
}

export function heatmapForRequest<T extends { symbol: string; interval: string; depth: number }>(
  response: T | null | undefined,
  symbol: string,
  interval: string,
  depth: number,
): T | null {
  return response?.symbol === symbol && response.interval === interval && response.depth === depth
    ? response
    : null;
}

export function zipperCompareForRequest<T extends {
  asset: string;
  compareBy: string;
  chainFilter: string | null;
}>(
  response: T | null | undefined,
  asset: string,
  compareBy: string,
  chainFilter?: string,
): T | null {
  return response?.asset === asset &&
    response.compareBy === compareBy &&
    response.chainFilter === (chainFilter || null)
    ? response
    : null;
}
