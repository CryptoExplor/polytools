/**
 * TOOL 3 — Live Trade Tape & Whale Alerts (/#/tape)
 * Deduplicates prints by matchId, buffers up to 200 session trades, computes
 * buy/sell volume flow & session VWAP, and triggers threshold-based audio,
 * toast, and desktop notifications on newly arriving prints.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  dec,
  fmtAgo,
  fmtNum,
  fmtTimeUTC,
  price,
  splitSymbol,
  type RecentTrade,
} from "@poly/core";
import { api } from "../lib/api";
import { formatCompactQuoteNotional } from "../lib/format";
import { useNow, usePollData } from "../lib/hooks";
import { useApp } from "../lib/store";
import {
  Card,
  CopyButton,
  DataFreshness,
  EmptyState,
  ErrorBox,
  Loading,
  MetricCell,
  MetricStrip,
  PageHeader,
  Pill,
  SymbolSelect,
  TermTip,
} from "../components/ui";
import {
  IconBell,
  IconClose,
  IconTrash,
  IconVolume,
  IconVolumeOff,
} from "../components/icons";

interface TapeRow extends RecentTrade {
  px: number;
  qtyNum: number;
  notional: number;
}

let sharedAudioCtx: AudioContext | null = null;

function playAlertTone() {
  try {
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    if (!sharedAudioCtx || sharedAudioCtx.state === "closed") {
      sharedAudioCtx = new Ctx();
    }
    if (sharedAudioCtx.state === "suspended") {
      void sharedAudioCtx.resume();
    }
    const now = sharedAudioCtx.currentTime;
    const osc = sharedAudioCtx.createOscillator();
    const gain = sharedAudioCtx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(587.33, now); // D5
    osc.frequency.setValueAtTime(880, now + 0.12); // A5
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    osc.connect(gain).connect(sharedAudioCtx.destination);
    osc.onended = () => {
      try {
        osc.disconnect();
        gain.disconnect();
      } catch {
        /* ignore */
      }
    };
    osc.start(now);
    osc.stop(now + 0.48);
  } catch {
    /* audio blocked until user gesture */
  }
}

export default function Tape() {
  const { symbol, setSymbol, pairBySymbol, assetByCode } = useApp();
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
  } = usePollData(() => api.trades(symbol, 50), 1500, [symbol]);

  const [threshold, setThreshold] = useState<number>(10_000);
  const [sideFilter, setSideFilter] = useState<"all" | "buy" | "sell" | "whales">("all");
  const [sound, setSound] = useState<boolean>(false);
  const [notify, setNotify] = useState<boolean>(false);
  const [notifPerm, setNotifPerm] = useState<string>(() =>
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "unsupported",
  );

  const [rows, setRows] = useState<TapeRow[]>([]);
  const [whales, setWhales] = useState<TapeRow[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const seenRef = useRef<Set<string>>(new Set());
  const seededSymbolRef = useRef<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [base, quote] = splitSymbol(symbol);
  const pair = pairBySymbol.get(symbol);
  const qtyDecimals = assetByCode.get(base)?.quantityDisplayDecimals ?? 5;

  // Keep alert preferences and display metadata in a ref so toggling controls never re-runs trade ingestion or re-fires old alerts
  const prefsRef = useRef({ threshold, sound, notify, base, quote, qtyDecimals });
  prefsRef.current = { threshold, sound, notify, base, quote, qtyDecimals };

  const showToastMsg = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), 6000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (sharedAudioCtx && sharedAudioCtx.state !== "closed") {
        void sharedAudioCtx.close().catch(() => {});
        sharedAudioCtx = null;
      }
    };
  }, []);

  // Reset buffers when active symbol changes
  useEffect(() => {
    seenRef.current.clear();
    seededSymbolRef.current = null;
    setRows([]);
    setWhales([]);
  }, [symbol]);

  // Ingest new trades when poll data arrives (strictly deduplicated by matchId)
  useEffect(() => {
    if (!data?.trades || (data.symbol && data.symbol !== symbol)) return;
    const isInitialSeed = seededSymbolRef.current !== symbol;
    const {
      threshold: curThreshold,
      sound: curSound,
      notify: curNotify,
      base: curBase,
      quote: curQuote,
      qtyDecimals: curQtyDecimals,
    } = prefsRef.current;

    const fresh: TapeRow[] = [];
    for (const t of [...data.trades].reverse()) {
      if (seenRef.current.has(t.matchId)) continue;
      seenRef.current.add(t.matchId);
      const px = price(t.price);
      const qtyNum = dec(t.qty);
      fresh.push({ ...t, px, qtyNum, notional: px * qtyNum });
    }

    seededSymbolRef.current = symbol;
    if (!fresh.length) return;

    setRows((prev) => [...fresh.reverse(), ...prev].slice(0, 200));

    const big = fresh.filter((t) => t.notional >= curThreshold);
    if (big.length) {
      setWhales((prev) => [...big.reverse(), ...prev].slice(0, 25));
      // Only fire active notifications for genuinely new live prints after initial history load
      if (!isInitialSeed) {
        const biggest = big.reduce((a, b) => (a.notional > b.notional ? a : b));
        showToastMsg(
          `Whale print on ${symbol}: ${biggest.sideLabel.toUpperCase()} ${fmtNum(
            biggest.qtyNum,
            curQtyDecimals,
          )} ${curBase} @ ${fmtNum(biggest.px)} (≈ ${formatCompactQuoteNotional(biggest.notional, curQuote)})`,
        );
        if (curSound) playAlertTone();
        if (
          curNotify &&
          typeof window !== "undefined" &&
          "Notification" in window &&
          Notification.permission === "granted"
        ) {
          try {
            new Notification(`Whale on ${symbol}`, {
              body: `${biggest.sideLabel.toUpperCase()} ${fmtNum(biggest.qtyNum)} ${curBase} ≈ ${formatCompactQuoteNotional(biggest.notional, curQuote)} @ ${fmtNum(biggest.px)}`,
            });
          } catch {
            /* ignore notification error */
          }
        }
      }
    }
  }, [data, symbol, showToastMsg]);

  const stats = useMemo(() => {
    let buyCount = 0;
    let sellCount = 0;
    let buyNotional = 0;
    let sellNotional = 0;
    let totalQty = 0;
    let biggest = 0;

    for (const r of rows) {
      if (r.sideLabel === "buy") {
        buyCount++;
        buyNotional += isFinite(r.notional) ? r.notional : 0;
      } else {
        sellCount++;
        sellNotional += isFinite(r.notional) ? r.notional : 0;
      }
      totalQty += isFinite(r.qtyNum) ? r.qtyNum : 0;
      if (isFinite(r.notional) && r.notional > biggest) biggest = r.notional;
    }

    const totalNotional = buyNotional + sellNotional;
    const vwap = totalQty > 0 ? totalNotional / totalQty : NaN;
    const buySharePct = totalNotional > 0 ? (buyNotional / totalNotional) * 100 : 50;

    return {
      buyCount,
      sellCount,
      buyNotional,
      sellNotional,
      totalNotional,
      vwap,
      biggest,
      buySharePct,
    };
  }, [rows]);

  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      if (sideFilter === "buy") return r.sideLabel === "buy";
      if (sideFilter === "sell") return r.sideLabel === "sell";
      if (sideFilter === "whales") return r.notional >= threshold;
      return true;
    });
  }, [rows, sideFilter, threshold]);

  const toggleDesktopNotify = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    if (Notification.permission === "granted") {
      setNotify((v) => !v);
      setNotifPerm("granted");
      return;
    }
    const perm = await Notification.requestPermission();
    setNotifPerm(perm);
    setNotify(perm === "granted");
  }, []);

  const triggerTestAlert = () => {
    if (sound) playAlertTone();
    showToastMsg(
      `Test alert active: monitoring ${symbol} prints ≥ ${formatCompactQuoteNotional(threshold, quote)}`,
    );
  };

  return (
    <div className="page-stack">
      <PageHeader
        title={`Recent Market Trades · ${symbol}`}
        badge={<Pill kind="accent">{rows.length} recent trades</Pill>}
        subtitle="Public trades for everyone on this market, newest first. No account key is used. These are not necessarily your trades."
        actions={
          <div className="row-flex">
            <SymbolSelect value={symbol} onChange={setSymbol} />
            <DataFreshness
              updatedAt={updatedAt}
              refreshing={refreshing}
              error={error}
              intervalSec={1.5}
              paused={paused}
              onTogglePause={() => setPaused(!paused)}
              onRefresh={refresh}
            />
          </div>
        }
      />

      <MetricStrip>
        <MetricCell
          label="Buy Flow (Session)"
          trend="up"
          value={`${stats.buyCount} prints`}
          sub={`Notional: ${formatCompactQuoteNotional(stats.buyNotional, quote)}`}
        />
        <MetricCell
          label="Sell Flow (Session)"
          trend="down"
          value={`${stats.sellCount} prints`}
          sub={`Notional: ${formatCompactQuoteNotional(stats.sellNotional, quote)}`}
        />
        <MetricCell
          label="Aggressor Volume Ratio"
          value={
            rows.length ? (
              <span>
                <span className="up">{stats.buySharePct.toFixed(0)}% Buy</span>
                <span className="faint"> / </span>
                <span className="down">{(100 - stats.buySharePct).toFixed(0)}% Sell</span>
              </span>
            ) : (
              "—"
            )
          }
          sub={
            rows.length ? (
              <div className="imbalance-bar mt-1">
                <div
                  className="imbalance-bid"
                  style={{ width: `${stats.buySharePct.toFixed(1)}%` }}
                />
                <div
                  className="imbalance-ask"
                  style={{ width: `${(100 - stats.buySharePct).toFixed(1)}%` }}
                />
              </div>
            ) : (
              "Buy vs sell notional"
            )
          }
        />
        <MetricCell
          label={
            <TermTip
              label="Session VWAP"
              tip="Volume-weighted average price of trades this browser session has seen, not the exchange daily VWAP."
            />
          }
          value={isFinite(stats.vwap) ? fmtNum(stats.vwap) : "—"}
          sub={`Across ${rows.length} buffered prints`}
        />
        <MetricCell
          label={
            <TermTip
              label="Largest Print Seen"
              tip="Single matched trade notional (price × qty) above your chosen threshold."
            />
          }
          trend="warn"
          value={stats.biggest ? formatCompactQuoteNotional(stats.biggest, quote) : "—"}
          sub={`Large print threshold: ≥ ${formatCompactQuoteNotional(threshold, quote)}`}
        />
      </MetricStrip>

      <ErrorBox error={error} onRetry={refresh} hasStaleData={rows.length > 0} />

      {/* Alert Controls Bar */}
      <Card
        title="Large Print Alert & Tape Controls"
        subtitle="Alerts are local. They are not orders. Triggered once per unique matchId on newly arriving trades."
        actions={
          <div className="row-flex" style={{ gap: 8 }}>
            <button type="button" className="btn sm ghost" onClick={triggerTestAlert}>
              Test Alert
            </button>
            {whales.length > 0 && (
              <button
                type="button"
                className="btn sm ghost"
                onClick={() => setWhales([])}
                title="Clear whale log"
              >
                <IconTrash size={12} /> Clear Whale Log
              </button>
            )}
          </div>
        }
      >
        <div className="between" style={{ gap: 12 }}>
          <div className="row-flex" style={{ gap: 10 }}>
            <label className="faint" htmlFor="whale-threshold-select">
              Whale Threshold ({quote}):
            </label>
            <select
              id="whale-threshold-select"
              className="select mono"
              style={{ width: "auto", padding: "5px 10px" }}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            >
              {[500, 1000, 5000, 10000, 25000, 50000, 100000, 250000].map((v) => (
                <option key={v} value={v}>
                  ≥ {formatCompactQuoteNotional(v, quote)}
                </option>
              ))}
            </select>

            <button
              type="button"
              className={`btn sm ${sound ? "primary" : "ghost"}`}
              onClick={() => setSound((v) => !v)}
              aria-pressed={sound}
            >
              {sound ? <IconVolume size={13} /> : <IconVolumeOff size={13} />}
              <span>Sound {sound ? "On" : "Off"}</span>
            </button>

            <button
              type="button"
              className={`btn sm ${notify ? "primary" : "ghost"}`}
              onClick={() => void toggleDesktopNotify()}
              aria-pressed={notify}
              disabled={notifPerm === "denied" || notifPerm === "unsupported"}
              title={
                notifPerm === "denied"
                  ? "Browser notifications are blocked in site permissions"
                  : "Toggle desktop notifications for whale trades"
              }
            >
              <IconBell size={13} />
              <span>
                Desktop {notify ? "On" : notifPerm === "denied" ? "Blocked" : "Off"}
              </span>
            </button>
          </div>

          <div className="seg-group" role="group" aria-label="Filter tape rows">
            <button
              type="button"
              className={`seg-btn ${sideFilter === "all" ? "active" : ""}`}
              onClick={() => setSideFilter("all")}
            >
              All ({rows.length})
            </button>
            <button
              type="button"
              className={`seg-btn ${sideFilter === "buy" ? "active" : ""}`}
              onClick={() => setSideFilter("buy")}
            >
              ▲ Buys ({stats.buyCount})
            </button>
            <button
              type="button"
              className={`seg-btn ${sideFilter === "sell" ? "active" : ""}`}
              onClick={() => setSideFilter("sell")}
            >
              ▼ Sells ({stats.sellCount})
            </button>
            <button
              type="button"
              className={`seg-btn ${sideFilter === "whales" ? "active" : ""}`}
              onClick={() => setSideFilter("whales")}
              title="Single trade notional (price × qty) above your chosen threshold"
            >
              Large prints (≥ {formatCompactQuoteNotional(threshold, quote)})
            </button>
          </div>
        </div>
      </Card>

      {/* Session Whale Log */}
      {whales.length > 0 && (
        <Card
          title={`Whale Prints Detected (${whales.length})`}
          subtitle={`Trades on ${symbol} with quote notional ≥ ${formatCompactQuoteNotional(threshold, quote)}`}
        >
          <div className="row-flex" style={{ gap: 8 }}>
            {whales.map((w) => (
              <Pill
                key={w.matchId}
                kind={w.sideLabel === "buy" ? "up" : "down"}
                title={`Match #${w.matchId} at ${fmtTimeUTC(w.tsMs)} UTC`}
              >
                {w.sideLabel === "buy" ? "▲ BUY" : "▼ SELL"}{" "}
                <strong>{formatCompactQuoteNotional(w.notional, quote)}</strong> ({fmtNum(w.qtyNum, qtyDecimals)}{" "}
                {base} @ {fmtNum(w.px)}) · {fmtTimeUTC(w.tsMs)}
              </Pill>
            ))}
          </div>
        </Card>
      )}

      {/* Main Time & Sales Feed */}
      <Card
        flush
        title={`Time & Sales · ${symbol}`}
        actions={
          pair && (
            <span className="faint mono">
              Min Notional: {pair.minNotionalQuote} {quote} · Min Qty: {pair.minQtyBase} {base}
            </span>
          )
        }
      >
        <div className="tape-head">
          <span>Time (UTC)</span>
          <span>Side</span>
          <span className="right">Price ({quote})</span>
          <span className="right">Quantity ({base})</span>
          <span className="right hide-xs">Notional</span>
          <span className="right hide-sm">Match ID / Age</span>
        </div>

        {loading && !rows.length && (
          <div style={{ padding: 16 }}>
            <Loading lines={8} />
          </div>
        )}

        {!loading && filteredRows.length === 0 && (
          <EmptyState
            title="No trades match current view"
            description={
              rows.length > 0
                ? "Try switching the tape filter back to All or lowering the whale threshold."
                : "Waiting for trade prints from the exchange."
            }
          />
        )}

        <div>
          {filteredRows.map((r) => {
            const isWhale = r.notional >= threshold;
            return (
              <div
                className={`tape-row ${isWhale ? "whale" : ""}`}
                key={r.matchId}
              >
                <span className="muted">{fmtTimeUTC(r.tsMs)}</span>
                <span className={`side ${r.sideLabel}`}>
                  {r.sideLabel === "buy" ? "▲ BUY" : "▼ SELL"}
                </span>
                <span className="right" style={{ fontWeight: 600 }}>
                  {fmtNum(r.px)}
                </span>
                <span className="right muted">{fmtNum(r.qtyNum, qtyDecimals)}</span>
                <span className="right hide-xs" style={{ fontWeight: isWhale ? 700 : 500 }}>
                  {formatCompactQuoteNotional(r.notional, quote)}{" "}
                  {isWhale && (
                    <Pill kind="warn" title="Exceeds whale threshold">
                      WHALE
                    </Pill>
                  )}
                </span>
                <span
                  className="right hide-sm row-flex"
                  style={{ justifyContent: "flex-end", gap: 6 }}
                >
                  <span className="faint">{fmtAgo(r.tsMs, now)}</span>
                  <CopyButton text={r.matchId} label={`#${r.matchId.slice(-6)}`} />
                </span>
              </div>
            );
          })}
        </div>
      </Card>

      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <span>{toast}</span>
          <button
            type="button"
            className="btn sm ghost icon-btn"
            onClick={() => setToast(null)}
            aria-label="Dismiss alert notification"
          >
            <IconClose size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
