/**
 * TOOL 5 — Cross-venue compare: Polyester index prices vs CoinGecko USD,
 * showing premium/discount in bps so users can sanity-check prices and
 * spot venue divergence. CoinGecko is polled slowly (free tier limits).
 */

import { useMemo } from "react";
import { api } from "../lib/api";
import { fetchUsdPrices, COINGECKO_IDS, type CgPrices } from "../lib/coingecko";
import { usePollData, useNow } from "../lib/hooks";
import { Card, ErrorBox, Loading, Pill, SymBadge } from "../components/ui";
import { price, fmtNum, fmtAgo, splitSymbol, trendSign } from "@poly/core";

export default function Compare() {
  const now = useNow();
  const { data: ov, error } = usePollData(() => api.overview(), 5000, []);
  const bases = useMemo(
    () => [...new Set((ov?.markets ?? []).map((m) => splitSymbol(m.symbol)[0]).filter((b) => COINGECKO_IDS[b]))],
    [ov],
  );
  const { data: cg, error: cgError, updatedAt: cgAt } = usePollData<CgPrices>(
    () => fetchUsdPrices(bases),
    35_000,
    [bases.join(",")],
  );

  const rows = useMemo(() => {
    if (!ov?.markets?.length || !cg) return [];
    return ov.markets
      .map((m) => {
        const [base, quote] = splitSymbol(m.symbol);
        if (quote !== "USDT") return null;
        const gid = COINGECKO_IDS[base];
        const ext = gid ? cg[gid]?.usd : undefined;
        if (!ext) return null;
        const local = price(m.indexPrice || m.lastPrice);
        const premBps = ((local - ext) / ext) * 10_000;
        return { symbol: m.symbol, base, local, ext, premBps };
      })
      .filter(Boolean) as Array<{ symbol: string; base: string; local: number; ext: number; premBps: number }>;
  }, [ov, cg]);

  const maxAbs = Math.max(50, ...rows.map((r) => Math.abs(r.premBps)));

  return (
    <div className="grid">
      <div className="notice info">
        Compares <b>Polyester index prices</b> with <b>CoinGecko reference USD prices</b>.
        Stables/test assets without an external listing are skipped. External prices poll
        every ~35s to respect the free CoinGecko rate limit{cgAt ? ` — last update ${fmtAgo(cgAt, now)}` : ""}.
      </div>

      <ErrorBox error={error} />
      {cgError && <ErrorBox error={cgError} />}

      {!rows.length && <Card title="Loading comparison…"><Loading lines={6} /></Card>}

      {rows.length > 0 && (
        <Card title={`Premium / discount vs external venue (${rows.length} markets)`}>
          <div className="table-wrap" style={{ border: "none" }}>
            <table className="data">
              <thead>
                <tr><th>Market</th><th>Polyester</th><th>CoinGecko</th><th>Premium</th><th style={{ textAlign: "left" }}>Gauge</th></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.symbol}>
                    <td><span className="sym-cell"><SymBadge asset={r.base} />{r.symbol}</span></td>
                    <td className="mono">{fmtNum(r.local)}</td>
                    <td className="mono">{fmtNum(r.ext)}</td>
                    <td><Pill kind={trendSign(r.premBps) === "up" ? "up" : trendSign(r.premBps) === "down" ? "down" : undefined}>{r.premBps >= 0 ? "+" : ""}{r.premBps.toFixed(1)} bps</Pill></td>
                    <td style={{ textAlign: "left" }}>
                      <div className="range" style={{ width: 160 }}>
                        <div className="marker" style={{ left: `calc(${Math.min(100, Math.max(0, 50 + (r.premBps / maxAbs) * 50))}% - 1px)`, background: r.premBps >= 0 ? "var(--up)" : "var(--down)" }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="faint mt-2">Gauge center = parity with the external venue. Polyester testnet prices are engine-simulated, so divergence is expected — on mainnet this becomes a real arbitrage/sanity tool.</div>
        </Card>
      )}
    </div>
  );
}
