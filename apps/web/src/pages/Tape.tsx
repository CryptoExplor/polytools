/**
 * TOOL 3 — Live trade tape with whale alerts.
 * Dedupes by matchId, keeps the last 200 prints client-side, and fires
 * a sound / toast / browser Notification when a print exceeds the
 * quote-notional threshold you set.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import { usePollData } from "../lib/hooks";
import { useApp } from "../lib/store";
import { Card, ErrorBox, Loading, Pill, SymbolSelect } from "../components/ui";
import { price, dec, fmtNum, fmtCompact, fmtTimeUTC, splitSymbol, type RecentTrade } from "@poly/core";

interface Row extends RecentTrade { px: number; notional: number; }

function beep() {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 660;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.55);
  } catch { /* audio blocked until user interacts */ }
}

export default function Tape() {
  const { symbol, setSymbol, pairBySymbol } = useApp();
  const { data, error, loading } = usePollData(() => api.trades(symbol, 50), 1500, [symbol]);

  const [threshold, setThreshold] = useState(10_000);
  const [sound, setSound] = useState(true);
  const [notify, setNotify] = useState(false);
  const [whales, setWhales] = useState<Row[]>([]);
  const seen = useRef(new Set<string>());
  const [rows, setRows] = useState<Row[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const pair = pairBySymbol.get(symbol);

  useEffect(() => { seen.current.clear(); setRows([]); setWhales([]); }, [symbol]);

  // Fold new prints into the tape whenever a poll resolves.
  useEffect(() => {
    if (!data?.trades) return;
    const fresh: Row[] = [];
    for (const t of [...data.trades].reverse()) {
      if (seen.current.has(t.matchId)) continue;
      seen.current.add(t.matchId);
      const px = price(t.price);
      fresh.push({ ...t, px, notional: px * dec(t.qty) });
    }
    if (!fresh.length) return;
    setRows((r) => [...fresh.reverse(), ...r].slice(0, 200));
    const big = fresh.filter((t) => t.notional >= threshold);
    if (big.length) {
      setWhales((w) => [...big.reverse(), ...w].slice(0, 20));
      const biggest = big.reduce((a, b) => (a.notional > b.notional ? a : b));
      setToast(`🐋 ${symbol}: ${biggest.sideLabel.toUpperCase()} ${fmtNum(dec(biggest.qty))} ≈ ${fmtCompact(biggest.notional, "$")}`);
      if (sound) beep();
      if (notify && "Notification" in window && Notification.permission === "granted") {
        new Notification(`Whale on ${symbol}`, { body: `${biggest.sideLabel} ≈ ${fmtCompact(biggest.notional, "$")}` });
      }
      const t = setTimeout(() => setToast(null), 6000);
      return () => clearTimeout(t);
    }
  }, [data, threshold, sound, notify, symbol]);

  const stats = useMemo(() => {
    const buys = rows.filter((r) => r.sideLabel === "buy").length;
    return { buys, sells: rows.length - buys, biggest: rows.reduce((m, r) => Math.max(m, r.notional), 0) };
  }, [rows]);

  const enableNotify = useCallback(async () => {
    if (!("Notification" in window)) return;
    const p = await Notification.requestPermission();
    setNotify(p === "granted");
  }, []);

  return (
    <div className="grid">
      <div className="row-flex">
        <SymbolSelect value={symbol} onChange={setSymbol} />
        <div className="row-flex card" style={{ padding: "8px 14px", gap: 8 }}>
          <span className="faint">whale ≥</span>
          <select className="select" style={{ width: "auto", padding: "4px 8px" }} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))}>
            {[1000, 5000, 10000, 25000, 50000, 100000].map((v) => (
              <option key={v} value={v}>{fmtCompact(v, "$")}</option>
            ))}
          </select>
          <button className={`btn sm ${sound ? "primary" : "ghost"}`} onClick={() => setSound(!sound)}>🔔 sound {sound ? "on" : "off"}</button>
          <button className={`btn sm ${notify ? "primary" : "ghost"}`} onClick={enableNotify}>
            🖥 notify {notify ? "on" : "off"}
          </button>
        </div>
        <Pill kind="accent">{rows.length} prints buffered</Pill>
      </div>

      <ErrorBox error={error} />

      <div className="grid cols-3">
        <div className="card stat"><div className="label">Buy prints</div><div className="value up">{stats.buys}</div></div>
        <div className="card stat"><div className="label">Sell prints</div><div className="value down">{stats.sells}</div></div>
        <div className="card stat"><div className="label">Largest print seen</div><div className="value warn">{stats.biggest ? fmtCompact(stats.biggest, "$") : "—"}</div></div>
      </div>

      {whales.length > 0 && (
        <Card title="Whale log (this session)">
          <div className="row-flex">
            {whales.map((w) => (
              <Pill key={w.matchId} kind={w.sideLabel === "buy" ? "up" : "down"} title={`${fmtTimeUTC(w.tsMs)} UTC`}>
                🐋 {w.sideLabel.toUpperCase()} {fmtCompact(w.notional, "$")} @ {fmtNum(w.px)}
              </Pill>
            ))}
          </div>
        </Card>
      )}

      <Card title={`Tape · ${symbol}`} actions={pair && <span className="faint">min notional {pair.minNotionalQuote} {splitSymbol(symbol)[1]}</span>}>
        {loading && !rows.length && <Loading lines={8} />}
        <div>
          <div className="tape-row faint hide-sm" style={{ borderBottom: "1px solid var(--border)" }}>
            <span>time UTC</span><span>side</span><span>price</span><span>qty</span><span className="right">notional</span>
          </div>
          {rows.map((r) => (
            <div className={`tape-row ${r.notional >= threshold ? "whale" : ""}`} key={r.matchId}>
              <span className="muted">{fmtTimeUTC(r.tsMs)}</span>
              <span className={`side ${r.sideLabel}`}>{r.sideLabel === "buy" ? "▲ BUY" : "▼ SELL"}</span>
              <span>{fmtNum(r.px)}</span>
              <span className="muted">{fmtNum(dec(r.qty), 6)}</span>
              <span className="right">
                {fmtCompact(r.notional, "$")} {r.notional >= threshold && "🐋"}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
