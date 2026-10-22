/**
 * TOOL 5 — Cross-Venue Price Comparison (/#/compare)
 * Compares Polyester index/last prices against CoinGecko USD reference prices,
 * reporting absolute dollar difference, basis-point premium/discount, explicit
 * per-source timestamps, and feed availability status.
 */

import { useMemo, useState } from "react";
import {
  fmtAgo,
  fmtNum,
  fmtTimeUTC,
  price,
  splitSymbol,
  trendSign,
} from "@poly/core";
import { api } from "../lib/api";
import { COINGECKO_IDS, fetchUsdPrices, type CgPrices } from "../lib/coingecko";
import { useNow, usePollData } from "../lib/hooks";
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
  SymBadge,
  TermTip,
} from "../components/ui";
import { IconRefresh } from "../components/icons";

interface CompareRow {
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
  status: "matched" | "non_usd_quote" | "unmapped" | "ref_unavailable";
}

export default function Compare() {
  const now = useNow(1000);
  const [viewMode, setViewMode] = useState<"matched" | "all">("matched");
  const [priceBasis, setPriceBasis] = useState<"index" | "last">("index");

  const {
    data: ov,
    error: ovError,
    loading: ovLoading,
    refreshing: ovRefreshing,
    updatedAt: ovAt,
    paused,
    setPaused,
    refresh: refreshOv,
  } = usePollData(() => api.overview(), 5000, []);

  const bases = useMemo(
    () => [
      ...new Set(
        (ov?.markets ?? [])
          .map((m) => splitSymbol(m.symbol)[0])
          .filter((b) => Boolean(COINGECKO_IDS[b])),
      ),
    ],
    [ov],
  );

  // Fallback list so CoinGecko still queries core assets even before Polyester overview resolves
  const geckoTargetBases = useMemo(
    () => (bases.length ? bases : Object.keys(COINGECKO_IDS)),
    [bases],
  );

  const {
    data: cg,
    error: cgError,
    loading: cgLoading,
    refreshing: cgRefreshing,
    updatedAt: cgAt,
    refresh: refreshCg,
  } = usePollData<CgPrices>(
    () => fetchUsdPrices(geckoTargetBases),
    35_000,
    [geckoTargetBases.join(",")],
  );

  const allRows: CompareRow[] = useMemo(() => {
    const markets = ov?.markets ?? [];
    return markets.map((m) => {
      const [base, quote] = splitSymbol(m.symbol);
      const indexPx = price(m.indexPrice);
      const lastPx = price(m.lastPrice);
      const activePolyPx =
        priceBasis === "index"
          ? isFinite(indexPx) && indexPx > 0
            ? indexPx
            : lastPx
          : isFinite(lastPx) && lastPx > 0
            ? lastPx
            : indexPx;

      const geckoId = COINGECKO_IDS[base];
      const isUsdQuote = quote === "USDT" || quote === "USDC";

      if (!isUsdQuote) {
        return {
          symbol: m.symbol,
          base,
          quote,
          indexPx,
          lastPx,
          lastTradeTsMs: m.lastTradeTsMs,
          geckoId,
          refUsd: null,
          absDiff: null,
          premBps: null,
          status: "non_usd_quote",
        };
      }

      if (!geckoId) {
        return {
          symbol: m.symbol,
          base,
          quote,
          indexPx,
          lastPx,
          lastTradeTsMs: m.lastTradeTsMs,
          geckoId: undefined,
          refUsd: null,
          absDiff: null,
          premBps: null,
          status: "unmapped",
        };
      }

      const rawRef = cg?.[geckoId]?.usd;
      const refUsd =
        typeof rawRef === "number" && isFinite(rawRef) && rawRef > 0 ? rawRef : null;

      if (refUsd === null || !isFinite(activePolyPx)) {
        return {
          symbol: m.symbol,
          base,
          quote,
          indexPx,
          lastPx,
          lastTradeTsMs: m.lastTradeTsMs,
          geckoId,
          refUsd: null,
          absDiff: null,
          premBps: null,
          status: "ref_unavailable",
        };
      }

      const absDiff = activePolyPx - refUsd;
      const premBps = (absDiff / refUsd) * 10_000;

      return {
        symbol: m.symbol,
        base,
        quote,
        indexPx,
        lastPx,
        lastTradeTsMs: m.lastTradeTsMs,
        geckoId,
        refUsd,
        absDiff,
        premBps,
        status: "matched",
      };
    });
  }, [ov, cg, priceBasis]);

  const matchedRows = useMemo(
    () => allRows.filter((r) => r.status === "matched"),
    [allRows],
  );

  const visibleRows = useMemo(() => {
    const list = viewMode === "matched" && matchedRows.length > 0 ? matchedRows : allRows;
    return [...list].sort((a, b) => {
      if (a.premBps !== null && b.premBps !== null) {
        return Math.abs(b.premBps) - Math.abs(a.premBps);
      }
      if (a.premBps !== null) return -1;
      if (b.premBps !== null) return 1;
      return a.symbol.localeCompare(b.symbol);
    });
  }, [viewMode, matchedRows, allRows]);

  const maxAbsBps = useMemo(
    () =>
      Math.max(
        50,
        ...matchedRows.map((r) => (r.premBps !== null ? Math.abs(r.premBps) : 0)),
      ),
    [matchedRows],
  );

  const summary = useMemo(() => {
    if (!matchedRows.length) {
      return { avgAbsBps: null, maxRow: null };
    }
    const sumAbs = matchedRows.reduce((s, r) => s + Math.abs(r.premBps ?? 0), 0);
    const maxRow = matchedRows.reduce((best, r) =>
      Math.abs(r.premBps ?? 0) > Math.abs(best.premBps ?? 0) ? r : best,
    );
    return {
      avgAbsBps: sumAbs / matchedRows.length,
      maxRow,
    };
  }, [matchedRows]);

  const timeSkewSec =
    ovAt && cgAt ? Math.round(Math.abs(ovAt - cgAt) / 1000) : null;

  return (
    <div className="page-stack">
      <PageHeader
        title="Cross-Venue Price Comparison"
        badge={
          ov?.apiEnv ? (
            <Pill kind={ov.apiEnv === "testnet" ? "warn" : "up"}>{ov.apiEnv}</Pill>
          ) : null
        }
        subtitle="Compares Polyester exchange prices against CoinGecko USD spot reference feeds to measure absolute dollar spread and basis-point premium/discount."
        actions={
          <div className="row-flex">
            <DataFreshness
              updatedAt={ovAt}
              refreshing={ovRefreshing}
              error={ovError}
              intervalSec={5}
              paused={paused}
              onTogglePause={() => setPaused(!paused)}
              onRefresh={() => {
                refreshOv();
                refreshCg();
              }}
            />
          </div>
        }
      />

      {/* Explicit Dual-Source Telemetry Strip */}
      <MetricStrip>
        <MetricCell
          label="Polyester Feed Status"
          trend={ovError ? "down" : ovAt ? "up" : undefined}
          value={ovError ? "Unavailable" : ovAt ? `Synced ${fmtAgo(ovAt, now)}` : "Syncing…"}
          sub={
            ovAt
              ? `Polled every 5s · ${fmtTimeUTC(ovAt)} UTC`
              : "Via backend MCP facade"
          }
        />
        <MetricCell
          label="CoinGecko Reference Feed"
          trend={cgError ? "warn" : cgAt ? "up" : undefined}
          value={cgError ? "Rate-Limited / Error" : cgAt ? `Synced ${fmtAgo(cgAt, now)}` : "Syncing…"}
          sub={
            cgAt
              ? `Polled every 35s · ${fmtTimeUTC(cgAt)} UTC`
              : "Free public REST API"
          }
        />
        <MetricCell
          label="Timestamp Skew"
          value={timeSkewSec !== null ? `${timeSkewSec}s offset` : "Unsynchronized"}
          sub="Feeds poll on independent intervals"
        />
        <MetricCell
          label="Matched Pairs"
          value={`${matchedRows.length} / ${allRows.length}`}
          sub={
            summary.avgAbsBps !== null
              ? `Mean divergence: ${summary.avgAbsBps.toFixed(1)} bps`
              : "Awaiting both feeds"
          }
        />
        <MetricCell
          label="Widest Divergence"
          trend={
            summary.maxRow?.premBps
              ? summary.maxRow.premBps > 0
                ? "up"
                : "down"
              : undefined
          }
          value={
            summary.maxRow && summary.maxRow.premBps !== null
              ? `${summary.maxRow.symbol} (${summary.maxRow.premBps >= 0 ? "+" : ""}${summary.maxRow.premBps.toFixed(1)} bps)`
              : "—"
          }
          sub={
            summary.maxRow && summary.maxRow.absDiff !== null
              ? `Δ ${summary.maxRow.absDiff >= 0 ? "+" : ""}$${fmtNum(summary.maxRow.absDiff)}`
              : "No active match"
          }
        />
      </MetricStrip>

      <div className="notice info">
        <div>
          <strong>Asynchronous Reference Notice:</strong> Polyester prices poll every{" "}
          <strong>5s</strong> while CoinGecko USD reference prices poll every{" "}
          <strong>35s</strong> to respect public rate limits. Unavailable reference prices
          are explicitly marked as <code className="mono">Unavailable</code> and are never
          represented as zero. On testnet, Polyester prices are matching-engine simulated,
          so divergence from external spot markets is expected.
        </div>
        <button type="button" className="btn sm ghost" onClick={refreshCg} disabled={cgRefreshing}>
          <IconRefresh size={12} /> Sync CoinGecko
        </button>
      </div>

      <ErrorBox error={ovError} onRetry={refreshOv} hasStaleData={allRows.length > 0} />
      {cgError && (
        <ErrorBox
          error={`CoinGecko reference feed: ${cgError}`}
          onRetry={refreshCg}
          hasStaleData={Boolean(cg)}
        />
      )}

      <Card
        flush
        title="Venue Price & Basis-Point Divergence"
        subtitle={`Comparing Polyester ${priceBasis === "index" ? "Index Price" : "Last Trade Price"} vs CoinGecko USD`}
        actions={
          <div className="row-flex" style={{ gap: 8 }}>
            <div className="seg-group" role="group" aria-label="Polyester price basis">
              <button
                type="button"
                className={`seg-btn ${priceBasis === "index" ? "active" : ""}`}
                onClick={() => setPriceBasis("index")}
              >
                Use Index Price
              </button>
              <button
                type="button"
                className={`seg-btn ${priceBasis === "last" ? "active" : ""}`}
                onClick={() => setPriceBasis("last")}
              >
                Use Last Price
              </button>
            </div>

            <div className="seg-group" role="group" aria-label="Row filter">
              <button
                type="button"
                className={`seg-btn ${viewMode === "matched" ? "active" : ""}`}
                onClick={() => setViewMode("matched")}
              >
                Matched ({matchedRows.length})
              </button>
              <button
                type="button"
                className={`seg-btn ${viewMode === "all" ? "active" : ""}`}
                onClick={() => setViewMode("all")}
              >
                All Listed ({allRows.length})
              </button>
            </div>
          </div>
        }
        footer={
          <>
            <span>
              Gauge center represents 0 bps parity with CoinGecko USD. Positive bps =
              Polyester premium; negative bps = Polyester discount.
            </span>
            <span className="mono">
              Polyester: {ovAt ? `${fmtTimeUTC(ovAt)} UTC` : "—"} · CoinGecko:{" "}
              {cgAt ? `${fmtTimeUTC(cgAt)} UTC` : "—"}
            </span>
          </>
        }
      >
        <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
          <table className="data">
            <thead>
              <tr>
                <th className="align-left">Market</th>
                <th>Polyester Index</th>
                <th>Polyester Last</th>
                <th>CoinGecko Ref (USD)</th>
                <th>Absolute Diff ($)</th>
                <th>
                  <TermTip
                    label="Premium / Discount"
                    tip="((Polyester Price − CoinGecko USD) ÷ CoinGecko USD) × 10,000 bps"
                  />
                </th>
                <th className="align-left">Parity Gauge</th>
                <th>Feed Status & Timestamps</th>
              </tr>
            </thead>
            <tbody>
              {(ovLoading || cgLoading) && !allRows.length && (
                <tr>
                  <td colSpan={8} style={{ padding: 16 }}>
                    <Loading lines={6} />
                  </td>
                </tr>
              )}
              {!ovLoading && visibleRows.length === 0 && (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      title="No comparison data available"
                      description="Neither Polyester market overview nor CoinGecko reference prices have loaded yet."
                      action={
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => {
                            refreshOv();
                            refreshCg();
                          }}
                        >
                          Retry Both Feeds
                        </button>
                      }
                    />
                  </td>
                </tr>
              )}
              {visibleRows.map((r) => {
                const sign = r.premBps !== null ? trendSign(r.premBps) : "flat";
                const markerPct =
                  r.premBps !== null
                    ? Math.min(100, Math.max(0, 50 + (r.premBps / maxAbsBps) * 50))
                    : 50;

                return (
                  <tr key={r.symbol}>
                    <td>
                      <span className="sym-cell">
                        <SymBadge asset={r.base} />
                        <span>
                          {r.base}
                          <small>/{r.quote}</small>
                        </span>
                      </span>
                    </td>
                    <td
                      className="mono"
                      style={{ fontWeight: priceBasis === "index" ? 700 : 400 }}
                    >
                      {fmtNum(r.indexPx)}
                    </td>
                    <td
                      className="mono"
                      style={{ fontWeight: priceBasis === "last" ? 700 : 400 }}
                    >
                      {fmtNum(r.lastPx)}
                    </td>
                    <td className="mono">
                      {r.refUsd !== null ? (
                        `$${fmtNum(r.refUsd)}`
                      ) : (
                        <span className="faint">Unavailable</span>
                      )}
                    </td>
                    <td
                      className={`mono ${
                        r.absDiff !== null
                          ? r.absDiff > 0
                            ? "up"
                            : r.absDiff < 0
                              ? "down"
                              : ""
                          : "faint"
                      }`}
                    >
                      {r.absDiff !== null
                        ? `${r.absDiff >= 0 ? "+" : "-"}$${fmtNum(Math.abs(r.absDiff))}`
                        : "—"}
                    </td>
                    <td>
                      {r.premBps !== null ? (
                        <Pill
                          kind={
                            sign === "up" ? "up" : sign === "down" ? "down" : undefined
                          }
                        >
                          {r.premBps > 0 ? "▲ +" : r.premBps < 0 ? "▼ " : ""}
                          {r.premBps.toFixed(1)} bps
                        </Pill>
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                    <td className="align-left">
                      {r.premBps !== null ? (
                        <div
                          className="range"
                          style={{ width: 140 }}
                          title={`${r.premBps >= 0 ? "+" : ""}${r.premBps.toFixed(1)} bps vs parity`}
                        >
                          <div
                            style={{
                              position: "absolute",
                              left: "50%",
                              top: 0,
                              bottom: 0,
                              width: 1,
                              background: "var(--border-strong)",
                            }}
                          />
                          <div
                            className="marker"
                            style={{
                              left: `calc(${markerPct.toFixed(1)}% - 1.5px)`,
                              background: r.premBps >= 0 ? "var(--up)" : "var(--down)",
                            }}
                          />
                        </div>
                      ) : (
                        <span className="faint">N/A</span>
                      )}
                    </td>
                    <td>
                      {r.status === "matched" && (
                        <Pill
                          kind="up"
                          title={`Polyester trade: ${fmtTimeUTC(r.lastTradeTsMs)} UTC · CoinGecko fetch: ${
                            cgAt ? fmtTimeUTC(cgAt) : "—"
                          } UTC`}
                        >
                          Live Match ({cgAt ? fmtAgo(cgAt, now) : "synced"})
                        </Pill>
                      )}
                      {r.status === "non_usd_quote" && (
                        <Pill title="Cross-crypto quote pair (e.g. BTC quote); USD comparison skipped">
                          Non-USD Quote ({r.quote})
                        </Pill>
                      )}
                      {r.status === "unmapped" && (
                        <Pill title="No external CoinGecko feed mapped for this asset">
                          Unmapped Asset
                        </Pill>
                      )}
                      {r.status === "ref_unavailable" && (
                        <Pill
                          kind="warn"
                          title="CoinGecko reference price did not return or is rate-limited"
                        >
                          Ref Unavailable
                        </Pill>
                      )}
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
