/**
 * Cross-venue comparison prices via the free CoinGecko API
 * (CORS-enabled from browsers on the free tier; polled slowly to
 * respect the ~10-30 calls/min rate limit).
 *
 * Only used by the Compare tool — everything else is pure Polyester data.
 */

export const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
  XRP: "ripple",
  BCH: "bitcoin-cash",
  LTC: "litecoin",
  DOGE: "dogecoin",
  AVAX: "avalanche-2",
  BNB: "binancecoin",
  TRX: "tron",
  HYPE: "hyperliquid",
  POL: "matic-network",
  ETC: "ethereum-classic",
};

export interface CgPrices {
  [geckoId: string]: { usd?: number };
}

export async function fetchUsdPrices(baseAssets: string[]): Promise<CgPrices> {
  const ids = [...new Set(baseAssets.map((a) => COINGECKO_IDS[a]).filter(Boolean))];
  if (!ids.length) return {};
  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd`,
    { headers: { Accept: "application/json" } },
  );
  if (!res.ok) throw new Error(`CoinGecko ${res.status} (rate-limited — waits help)`);
  return res.json() as Promise<CgPrices>;
}
