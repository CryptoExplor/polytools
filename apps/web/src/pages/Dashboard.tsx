/**
 * TOOL 1 — Market dashboard.
 * All pairs, live prices (3s poll), 24h stats, client-side sparklines
 * built from the live price ring buffer, sortable columns.
 */

import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { usePollData, useNow } from "../lib/hooks";
import { useApp } from "../lib/store";
import { ErrorBox, Loading, Pill, SymBadge } from "../components/ui";
import {
  price, dec, bpsToPct, spreadBps,
  fmtNum, fmtCompact, fmtPctFromBps, fmtAgo, splitSymbol, trendSign,
  type MarketOverviewEntry,
} from "@poly/core";

type SortKey = "symbol" | "last" | "change" | "vol" | "spread";

export default function Dashboard() {
  const { setSymbol, pairs } = useApp();
  const nav = useNavigate();
  const now = useNow();
  const { data, error, loading, updatedAt } = usePollData(() => api.overview(), 3000, []);
  const [sortKey, setSortKey] = useState<SortKey>("vol");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [query, setQuery] = useState("");

  const pairMap = useMemo(() => new Map(pairs.map((p) => [p.symbol, p])), [pairs]);

  // Ring buffers of last prices per symbol → live 1-px sparklines, zero extra API calls.
  const buffers = useRef(new Map<string, number[]>());
  const sparkline = (m: MarketOverviewEntry): number[] => {
    const p = price(m.lastPrice);
    let buf = buffers.current.get(m.symbol);
    if (!buf) { buf = []; buffers.current.set(m.symbol, buf); }
    if (buf[buf.length - 1] !== p) { buf.push(p); if (buf.length > 40) buf.shift(); }
    return buf;
  };

  const rows = useMemo(() => {
    let list = data?.markets ?? [];
    if (query) list = list.filter((m) => m.symbol.toLowerCase().includes(query.toLowerCase()));
    const val = (m: MarketOverviewEntry): number | string => {
      switch (sortKey) {
        case "symbol": return m.symbol;
        case "last": return price(m.lastPrice);
        case "change": return m.change24hBps;
        case "vol": return dec(m.volume24hUsd);
        case "spread": return spreadBps(price(m.bestBid), price(m.bestAsk));
      }
    };
    return [...list].sort((a, b) => {
      const va = val(a), vb = val(b);
      const c = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return c * sortDir;
    });
  }, [data, query, sortKey, sortDir]);

  const totals = useMemo(() => {
    const ms = data?.markets ?? [];
    return {
      count: ms.length,
      volUsd: ms.reduce((s, m) => s + (dec(m.volume24hUsd) || 0), 0),
      gainers: ms.filter((m) => m.change24hBps > 0).length,
    };
  }, [data]);

  const sortBtn = (k: SortKey, label: string) => (
    <th onClick={() => { setSortKey(k); setSortDir(sortKey === k ? ((sortDir * -1) as 1 | -1) : -1); }}>
      {label} {sortKey === k ? (sortDir === 1 ? "↑" : "↓") : ""}
    </th>
  );

  const open = (symbol: string) => { setSymbol(symbol); nav("/charts"); };

  return (
    <div className="grid">
      <div className="grid cols-4">
        <div className="card stat"><div className="label">Markets</div><div className="value">{totals.count}</div><div className="sub">spot pairs listed</div></div>
        <div className="card stat"><div className="label">24h volume</div><div className="value">{fmtCompact(totals.volUsd, "$")}</div><div className="sub">across all pairs</div></div>
        <div className="card stat"><div className="label">Gainers 24h</div><div className="value up">{totals.gainers}</div><div className="sub">of {totals.count} markets</div></div>
        <div className="card stat"><div className="label">Updated</div><div className="value" style={{ fontSize: 15, marginTop: 8 }}>{updatedAt ? fmtAgo(updatedAt, now) : "—"}</div><div className="sub">polling every 3s · click a row for charts</div></div>
      </div>

      <ErrorBox error={error} />

      <div className="row-flex mb-3">
        <input className="input" style={{ maxWidth: 240 }} placeholder="Filter markets…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Pill kind="accent">{data?.apiEnv ?? "…"}</Pill>
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              {sortBtn("symbol", "Market")}
              {sortBtn("last", "Last price")}
              {sortBtn("change", "24h %")}
              <th>24h range</th>
              {sortBtn("vol", "24h vol $")}
              {sortBtn("spread", "Spread")}
              <th>Live</th>
            </tr>
          </thead>
          <tbody>
            {loading && !rows.length && (
              <tr><td colSpan={7}><Loading lines={6} /></td></tr>
            )}
            {rows.map((m) => {
              const last = price(m.lastPrice);
              const hi = price(m.high24h);
              const lo = price(m.low24h);
              const bid = price(m.bestBid);
              const ask = price(m.bestAsk);
              const pos = hi > lo ? Math.min(1, Math.max(0, (last - lo) / (hi - lo))) : 0.5;
              const [base, quote] = splitSymbol(m.symbol);
              const pair = pairMap.get(m.symbol);
              const spark = sparkline(m);
              return (
                <tr key={m.symbol} onClick={() => open(m.symbol)}>
                  <td>
                    <span className="sym-cell">
                      <SymBadge asset={base} />
                      <span>{base}<small>/{quote}</small>
                        {pair && <small title={`tick ${pair.tickSize} · min notional ${pair.minNotionalQuote} ${quote}`}> ·</small>}
                      </span>
                    </span>
                  </td>
                  <td className="mono" style={{ fontWeight: 650 }}>{fmtNum(last)}</td>
                  <td><Pill kind={trendSign(bpsToPct(m.change24hBps)) === "up" ? "up" : trendSign(bpsToPct(m.change24hBps)) === "down" ? "down" : undefined}>{fmtPctFromBps(m.change24hBps)}</Pill></td>
                  <td>
                    <div className="range" title={`low ${fmtNum(lo)} → high ${fmtNum(hi)}`}>
                      <div className="fill" style={{ width: "100%", opacity: 0.5 }} />
                      <div className="marker" style={{ left: `calc(${(pos * 100).toFixed(1)}% - 1px)` }} />
                    </div>
                  </td>
                  <td className="mono">{fmtCompact(dec(m.volume24hUsd))}</td>
                  <td className="mono muted">{isFinite(spreadBps(bid, ask)) ? `${spreadBps(bid, ask).toFixed(1)} bps` : "—"}</td>
                  <td><MiniSpark data={spark} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="faint">Prices are scaled-integer decoded (÷10³). Live column builds from your session's observed ticks — no extra API load.</div>
    </div>
  );
}

function MiniSpark({ data }: { data: number[] }) {
  if (data.length < 2) return <span className="faint">…</span>;
  const min = Math.min(...data), max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => `${(i * (100 / (data.length - 1))).toFixed(1)},${(26 - ((v - min) / span) * 22).toFixed(1)}`).join(" ");
  const up = data[data.length - 1] >= data[0];
  return (
    <svg width="100" height="28">
      <polyline points={pts} fill="none" stroke={up ? "var(--up)" : "var(--down)"} strokeWidth="1.5" />
    </svg>
  );
}
