/**
 * TOOL 1 — Market Dashboard (/#/)
 * High-density market overview terminal with 3s live polling, breadth stats,
 * quote/trend filters, accessible sortable columns, session tick sparklines,
 * and one-click navigation to Charts, Order Book, or Trade Tape.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  bpsToPct,
  dec,
  fmtAgo,
  fmtCompact,
  fmtNum,
  fmtPctFromBps,
  price,
  splitSymbol,
  spreadBps,
  trendSign,
  type MarketOverviewEntry,
} from "@poly/core";
import { api } from "../lib/api";
import { useNow, usePollData } from "../lib/hooks";
import { useApp } from "../lib/store";
import {
  Card,
  DataFreshness,
  EmptyState,
  ErrorBox,
  Loading,
  MetricCell,
  MetricStrip,
  PageHeader,
  Pill,
  Sparkline,
  SymBadge,
} from "../components/ui";
import { IconActivity, IconBook, IconChart, IconSearch, IconTape } from "../components/icons";

type SortKey = "symbol" | "last" | "index" | "change" | "vol" | "spread";
type TrendFilter = "all" | "up" | "down";

export const DASHBOARD_TOOL_PATHS = {
  book: "/book",
  tape: "/tape",
  charts: "/charts",
  heatmap: "/heatmap",
} as const;
export type DashboardTool = keyof typeof DASHBOARD_TOOL_PATHS;

export function openDashboardTool(
  symbol: string,
  tool: DashboardTool,
  setSymbol: (symbol: string) => void,
  navigate: (path: string) => void,
): void {
  setSymbol(symbol);
  navigate(DASHBOARD_TOOL_PATHS[tool]);
}

export default function Dashboard() {
  const { setSymbol, pairBySymbol, watchlist, toggleWatchlist } = useApp();
  const nav = useNavigate();
  const now = useNow(1000);
  const {
    data,
    error,
    loading,
    refreshing,
    updatedAt,
    paused,
    setPaused,
    refresh,
  } = usePollData(() => api.overview(), 3000, []);

  const [sortKey, setSortKey] = useState<SortKey>("vol");
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [query, setQuery] = useState("");
  const [quoteFilter, setQuoteFilter] = useState<string>("ALL");
  const [trendFilter, setTrendFilter] = useState<TrendFilter>("all");
  const [watchOnly, setWatchOnly] = useState<boolean>(false);

  // Maintain ring buffers of observed last prices per symbol inside useEffect (pure render)
  const buffersRef = useRef<Map<string, number[]>>(new Map());
  const prevPriceRef = useRef<Map<string, number>>(new Map());
  const [flashMap, setFlashMap] = useState<Record<string, "up" | "down">>({});
  const [, setTickVersion] = useState(0);

  useEffect(() => {
    if (!data?.markets?.length) return;
    const nextFlash: Record<string, "up" | "down"> = {};
    for (const m of data.markets) {
      const p = price(m.lastPrice);
      if (!isFinite(p)) continue;

      const prev = prevPriceRef.current.get(m.symbol);
      if (prev !== undefined && prev !== p) {
        nextFlash[m.symbol] = p > prev ? "up" : "down";
      }
      prevPriceRef.current.set(m.symbol, p);

      let buf = buffersRef.current.get(m.symbol);
      if (!buf) {
        buf = [];
        buffersRef.current.set(m.symbol, buf);
      }
      if (buf[buf.length - 1] !== p) {
        buf.push(p);
        if (buf.length > 40) buf.shift();
      }
    }
    setTickVersion((v) => v + 1);
    if (Object.keys(nextFlash).length > 0) {
      setFlashMap(nextFlash);
      const timer = setTimeout(() => setFlashMap({}), 650);
      return () => clearTimeout(timer);
    }
  }, [data]);

  const quoteChoices = useMemo(() => {
    const set = new Set<string>(["ALL"]);
    for (const m of data?.markets ?? []) {
      const [, q] = splitSymbol(m.symbol);
      if (q) set.add(q);
    }
    return [...set];
  }, [data]);

  const rows = useMemo(() => {
    let list = [...(data?.markets ?? [])];

    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((m) => m.symbol.toLowerCase().includes(q));
    }

    if (quoteFilter !== "ALL") {
      list = list.filter((m) => splitSymbol(m.symbol)[1] === quoteFilter);
    }

    if (trendFilter === "up") {
      list = list.filter((m) => m.change24hBps > 0);
    } else if (trendFilter === "down") {
      list = list.filter((m) => m.change24hBps < 0);
    }

    if (watchOnly) {
      list = list.filter((m) => watchlist.includes(m.symbol));
    }

    const numVal = (m: MarketOverviewEntry): number => {
      switch (sortKey) {
        case "last":
          return price(m.lastPrice) || 0;
        case "index":
          return price(m.indexPrice) || 0;
        case "change":
          return m.change24hBps || 0;
        case "vol":
          return dec(m.volume24hUsd) || 0;
        case "spread": {
          const sp = spreadBps(price(m.bestBid), price(m.bestAsk));
          return isFinite(sp) ? sp : Number.POSITIVE_INFINITY;
        }
        default:
          return 0;
      }
    };

    return list.sort((a, b) => {
      if (sortKey === "symbol") {
        return a.symbol.localeCompare(b.symbol) * sortDir;
      }
      return (numVal(a) - numVal(b)) * sortDir;
    });
  }, [data, query, quoteFilter, trendFilter, watchOnly, watchlist, sortKey, sortDir]);

  const summary = useMemo(() => {
    const ms = data?.markets ?? [];
    const volUsd = ms.reduce((acc, m) => acc + (dec(m.volume24hUsd) || 0), 0);
    const gainers = ms.filter((m) => m.change24hBps > 0).length;
    const losers = ms.filter((m) => m.change24hBps < 0).length;

    let topGainer: MarketOverviewEntry | null = null;
    let topVol: MarketOverviewEntry | null = null;
    let tightest: { symbol: string; bps: number } | null = null;

    for (const m of ms) {
      if (!topGainer || m.change24hBps > topGainer.change24hBps) topGainer = m;
      if (!topVol || (dec(m.volume24hUsd) || 0) > (dec(topVol.volume24hUsd) || 0)) topVol = m;
      const sp = spreadBps(price(m.bestBid), price(m.bestAsk));
      if (isFinite(sp) && sp >= 0 && (!tightest || sp < tightest.bps)) {
        tightest = { symbol: m.symbol, bps: sp };
      }
    }

    return {
      count: ms.length,
      volUsd,
      gainers,
      losers,
      topGainer,
      topVol,
      tightest,
    };
  }, [data]);

  const handleSort = (k: SortKey) => {
    if (sortKey === k) {
      setSortDir((d) => (d === 1 ? -1 : 1));
    } else {
      setSortKey(k);
      setSortDir(k === "symbol" || k === "spread" ? 1 : -1);
    }
  };

  const renderSortTh = (k: SortKey, label: string, alignLeft = false, tip?: string) => {
    const active = sortKey === k;
    const ariaSort = active ? (sortDir === 1 ? "ascending" : "descending") : "none";
    return (
      <th aria-sort={ariaSort} className={alignLeft ? "align-left" : ""}>
        <button
          type="button"
          className={`th-sort-btn ${active ? "active" : ""}`}
          onClick={() => handleSort(k)}
          title={tip}
        >
          <span>{label}</span>
          <span aria-hidden="true">{active ? (sortDir === 1 ? "↑" : "↓") : "↕"}</span>
        </button>
      </th>
    );
  };

  const openTool = (sym: string, tool: DashboardTool) =>
    openDashboardTool(sym, tool, setSymbol, nav);

  const exportCsv = () => {
    if (!rows.length) return;
    const csvNum = (n: number, decimals?: number): string => {
      if (!Number.isFinite(n)) return "";
      return decimals !== undefined ? n.toFixed(decimals) : String(n);
    };
    const csvCell = (val: string): string => {
      const safe = /^[=+\-@]/.test(val) ? `'${val}` : val;
      return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    const headers = [
      "symbol",
      "lastPrice",
      "indexPrice",
      "bestBid",
      "bestAsk",
      "spreadBps",
      "change24hPct",
      "high24h",
      "low24h",
      "volume24hBase",
      "volume24hUsd",
    ];
    const lines = [
      headers.join(","),
      ...rows.map((m) => {
        const bid = price(m.bestBid);
        const ask = price(m.bestAsk);
        const sp = spreadBps(bid, ask);
        return [
          csvCell(m.symbol),
          csvNum(price(m.lastPrice)),
          csvNum(price(m.indexPrice)),
          csvNum(bid),
          csvNum(ask),
          csvNum(sp, 2),
          csvNum(bpsToPct(m.change24hBps), 2),
          csvNum(price(m.high24h)),
          csvNum(price(m.low24h)),
          csvNum(dec(m.volume24hBase)),
          csvNum(dec(m.volume24hUsd)),
        ].join(",");
      }),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `polyester-markets-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    a.click();
    // Let the browser begin the download before releasing the object URL.
    // Immediate revocation can cancel downloads, especially in Safari.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div className="page-stack">
      <PageHeader
        title="Markets"
        badge={
          data?.apiEnv ? (
            <Pill kind={data.apiEnv === "testnet" ? "warn" : "up"}>{data.apiEnv}</Pill>
          ) : null
        }
        subtitle="Spot markets with 24h stats. Refreshes every 3s."
        actions={
          <DataFreshness
            updatedAt={updatedAt}
            refreshing={refreshing}
            error={error}
            intervalSec={3}
            paused={paused}
            onTogglePause={() => setPaused(!paused)}
            onRefresh={refresh}
          />
        }
      />

      <MetricStrip>
        <MetricCell
          label="Listed Markets"
          value={summary.count || "—"}
          sub={
            summary.count
              ? `${rows.length} shown · ${summary.gainers} up / ${summary.losers} down`
              : "Spot markets on Polyester"
          }
        />
        <MetricCell
          label="24h Turnover (USD)"
          value={summary.count ? fmtCompact(summary.volUsd, "$") : "—"}
          sub={
            summary.topVol
              ? `Top: ${summary.topVol.symbol} (${fmtCompact(dec(summary.topVol.volume24hUsd), "$")})`
              : "Aggregate spot volume"
          }
        />
        <MetricCell
          label="Top 24h Mover"
          trend={
            summary.topGainer
              ? trendSign(summary.topGainer.change24hBps) === "up"
                ? "up"
                : "down"
              : undefined
          }
          value={
            summary.topGainer
              ? `${summary.topGainer.symbol} ${fmtPctFromBps(summary.topGainer.change24hBps)}`
              : "—"
          }
          sub={
            summary.topGainer
              ? `Last ${fmtNum(price(summary.topGainer.lastPrice))}`
              : "Waiting for market data"
          }
        />
        <MetricCell
          label="Tightest Spread"
          value={summary.tightest ? `${summary.tightest.bps.toFixed(1)} bps` : "—"}
          sub={summary.tightest ? `on ${summary.tightest.symbol}` : "Top-of-book bid/ask"}
        />
      </MetricStrip>

      <ErrorBox error={error} onRetry={refresh} hasStaleData={Boolean(data?.markets?.length)} />

      <Card
        flush
        title="Spot markets"
        subtitle="Click a symbol for its chart, or open book, trades, or depth."
        actions={
          <button
            type="button"
            className="btn sm ghost"
            onClick={exportCsv}
            disabled={!rows.length}
            title="Download filtered spot markets as CSV"
          >
            Download CSV
          </button>
        }
        footer={
          <>
            <span>
              Prices come from the public Polyester testnet feed. Session sparklines build up
              from observations in this browser tab.
            </span>
            {updatedAt && <span>Snapshot synced {fmtAgo(updatedAt, now)}</span>}
          </>
        }
      >
        <div className="table-toolbar">
          <div className="input-group" style={{ width: 220 }}>
            <span className="input-icon">
              <IconSearch size={14} />
            </span>
            <input
              id="market-search"
              type="search"
              className="input with-icon"
              placeholder="Search symbol (e.g. BTC)…"
              aria-label="Filter markets by symbol"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>

          <div className="row-flex" style={{ gap: 8 }}>
            <button
              type="button"
              className={`btn sm ${watchOnly ? "primary" : "ghost"}`}
              onClick={() => setWatchOnly((w) => !w)}
              aria-pressed={watchOnly}
              title="Show only pairs starred in your local browser watchlist"
            >
              ★ Watchlist ({watchlist.length})
            </button>

            <div className="seg-group" role="group" aria-label="Filter by quote asset">
              {quoteChoices.map((q) => (
                <button
                  key={q}
                  type="button"
                  className={`seg-btn ${quoteFilter === q ? "active" : ""}`}
                  onClick={() => setQuoteFilter(q)}
                >
                  {q}
                </button>
              ))}
            </div>

            <div className="seg-group" role="group" aria-label="Filter by 24h direction">
              <button
                type="button"
                className={`seg-btn ${trendFilter === "all" ? "active" : ""}`}
                onClick={() => setTrendFilter("all")}
              >
                All
              </button>
              <button
                type="button"
                className={`seg-btn ${trendFilter === "up" ? "active" : ""}`}
                onClick={() => setTrendFilter("up")}
              >
                ▲ Gainers
              </button>
              <button
                type="button"
                className={`seg-btn ${trendFilter === "down" ? "active" : ""}`}
                onClick={() => setTrendFilter("down")}
              >
                ▼ Losers
              </button>
            </div>
          </div>
        </div>
        <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
          <table className="data">
            <thead>
              <tr>
                {renderSortTh("symbol", "Market", true)}
                {renderSortTh(
                  "last",
                  "Last Price",
                  false,
                  "Last public trade on Polyester, decoded from the testnet feed (scaled integer ÷ 10³).",
                )}
                {renderSortTh(
                  "index",
                  "Index Price",
                  false,
                  "Exchange reference index price (scaled integer ÷ 10³).",
                )}
                {renderSortTh("change", "24h Change")}
                <th>24h Low / High</th>
                {renderSortTh("vol", "24h Volume ($)")}
                {renderSortTh(
                  "spread",
                  "Spread",
                  false,
                  "Top-of-book (Best Ask − Best Bid) ÷ Mid in basis points (1 bps = 0.01%)",
                )}
                <th>Session Trend</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && !rows.length && (
                <tr>
                  <td colSpan={9} style={{ padding: "18px 16px" }}>
                    <Loading lines={7} />
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    <EmptyState
                      title={
                        data?.markets?.length
                          ? "No markets match"
                          : "No market overview data available"
                      }
                      description={
                        data?.markets?.length
                          ? "Clear the filters to see every market."
                          : "Check your connection, then refresh."
                      }
                      action={
                        (query || quoteFilter !== "ALL" || trendFilter !== "all") && (
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() => {
                              setQuery("");
                              setQuoteFilter("ALL");
                              setTrendFilter("all");
                            }}
                          >
                            Clear filters
                          </button>
                        )
                      }
                    />
                  </td>
                </tr>
              )}
              {rows.map((m) => {
                const last = price(m.lastPrice);
                const idxPx = price(m.indexPrice);
                const hi = price(m.high24h);
                const lo = price(m.low24h);
                const bid = price(m.bestBid);
                const ask = price(m.bestAsk);
                const sp = spreadBps(bid, ask);
                const pos =
                  isFinite(hi) && isFinite(lo) && hi > lo
                    ? Math.min(1, Math.max(0, (last - lo) / (hi - lo)))
                    : 0.5;
                const [base, quote] = splitSymbol(m.symbol);
                const pair = pairBySymbol.get(m.symbol);
                const spark = buffersRef.current.get(m.symbol) ?? (isFinite(last) ? [last] : []);
                const sign = trendSign(bpsToPct(m.change24hBps));
                const flash = flashMap[m.symbol];

                return (
                  <tr
                    key={m.symbol}
                    className={flash === "up" ? "flash-up" : flash === "down" ? "flash-down" : ""}
                  >
                    <td>
                      <span
                        className="sym-cell"
                        title={
                          pair
                            ? `Tick size: ${pair.tickSize} · Min order: ${pair.minQtyBase} ${base} (${pair.minNotionalQuote} ${quote})`
                            : m.symbol
                        }
                      >
                        <button
                          type="button"
                          className={`star-btn ${watchlist.includes(m.symbol) ? "active" : ""}`}
                          onClick={() => toggleWatchlist(m.symbol)}
                          aria-label={
                            watchlist.includes(m.symbol)
                              ? `Remove ${m.symbol} from watchlist`
                              : `Add ${m.symbol} to watchlist`
                          }
                          title={
                            watchlist.includes(m.symbol)
                              ? "Starred in local watchlist"
                              : "Add to local watchlist"
                          }
                        >
                          {watchlist.includes(m.symbol) ? "★" : "☆"}
                        </button>
                        <button
                          type="button"
                          className="market-open-btn"
                          onClick={() => openTool(m.symbol, "charts")}
                          aria-label={`Open ${m.symbol} candlestick chart`}
                          title={`Open ${m.symbol} candlestick chart`}
                        >
                          <SymBadge asset={base} size={22} />
                          <span className="mono">
                            {base}
                            <small>/{quote}</small>
                          </span>
                        </button>
                      </span>
                    </td>
                    <td className="mono" style={{ fontWeight: 650 }}>
                      {fmtNum(last)}
                    </td>
                    <td className="mono muted">{fmtNum(idxPx)}</td>
                    <td>
                      <Pill
                        kind={sign === "up" ? "up" : sign === "down" ? "down" : undefined}
                      >
                        {fmtPctFromBps(m.change24hBps)}
                      </Pill>
                    </td>
                    <td>
                      <div
                        className="range-inline"
                        title={`24h Low: ${fmtNum(lo)} → 24h High: ${fmtNum(hi)}`}
                      >
                        <span className="mono faint" style={{ fontSize: 11 }}>
                          {fmtCompact(lo)}
                        </span>
                        <div className="range">
                          <div
                            className="fill"
                            style={{ width: `${(pos * 100).toFixed(1)}%` }}
                          />
                          <div
                            className="marker"
                            style={{ left: `calc(${(pos * 100).toFixed(1)}% - 1.5px)` }}
                          />
                        </div>
                        <span className="mono faint" style={{ fontSize: 11 }}>
                          {fmtCompact(hi)}
                        </span>
                      </div>
                    </td>
                    <td
                      className="mono"
                      title={`${fmtCompact(dec(m.volume24hBase))} ${base}`}
                    >
                      {fmtCompact(dec(m.volume24hUsd), "$")}
                    </td>
                    <td className="mono muted" title={`Bid ${fmtNum(bid)} / Ask ${fmtNum(ask)}`}>
                      {isFinite(sp) ? `${sp.toFixed(1)} bps` : "—"}
                    </td>
                    <td>
                      <Sparkline data={spark} width={88} height={22} />
                    </td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="row-action-btn"
                          title={`Open ${m.symbol} Order Book`}
                          onClick={() => openTool(m.symbol, "book")}
                        >
                          Book
                        </button>
                        <button
                          type="button"
                          className="row-action-btn"
                          title={`Open ${m.symbol} Trade Tape`}
                          onClick={() => openTool(m.symbol, "tape")}
                        >
                          Tape
                        </button>
                        <button
                          type="button"
                          className="row-action-btn"
                          title={`Open ${m.symbol} Candlestick Chart`}
                          onClick={() => openTool(m.symbol, "charts")}
                        >
                          Chart
                        </button>
                        <button
                          type="button"
                          className="row-action-btn"
                          title={`Open ${m.symbol} Liquidity Heatmap`}
                          onClick={() => openTool(m.symbol, "heatmap")}
                        >
                          Heat
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
