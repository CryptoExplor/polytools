import { fmtCompact } from "@poly/core";

/**
 * Format a price × quantity value in the market's actual quote asset.
 * Explicitly USD-denominated data may keep the dollar sign; every other
 * quote asset stays labeled by its code instead of being presented as USD.
 */
export function formatCompactQuoteNotional(value: number, quoteAsset: string): string {
  const quote = quoteAsset.trim();
  if (quote === "USD") return fmtCompact(value, "$");
  const formatted = fmtCompact(value);
  return quote ? `${formatted} ${quote}` : formatted;
}
