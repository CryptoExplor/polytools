/**
 * TOOL 7 — Trading calculators wired to live prices:
 * position sizing (risk-based), isolated-margin liquidation approximation,
 * fee & PnL, and a base⇄quote converter.
 */

import { useMemo, useState, type ReactNode } from "react";
import { api } from "../lib/api";
import { usePollData } from "../lib/hooks";
import { useApp } from "../lib/store";
import { Card, Pill, SymbolSelect } from "../components/ui";
import { price, fmtNum, splitSymbol } from "@poly/core";

function Num({ label, value, onChange, suffix }: { label: string; value: number; onChange: (n: number) => void; suffix?: string }) {
  return (
    <div className="field">
      <label>{label}{suffix ? ` (${suffix})` : ""}</label>
      <input
        className="input mono"
        type="number"
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
      />
    </div>
  );
}

function Result({ k, v, accent }: { k: string; v: ReactNode; accent?: boolean }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className={`v mono ${accent ? "up" : ""}`}>{v}</span>
    </div>
  );
}

export default function Calc() {
  const { symbol, setSymbol } = useApp();
  const { data: ov } = usePollData(() => api.overview([symbol]), 5000, [symbol]);
  const live = ov?.markets?.[0] ? price(ov.markets[0].lastPrice) : NaN;
  const [, quote] = splitSymbol(symbol);

  // --- position size
  const [equity, setEquity] = useState(1000);
  const [riskPct, setRiskPct] = useState(1);
  const [entry, setEntry] = useState(NaN);
  const [stop, setStop] = useState(NaN);
  const sizing = useMemo(() => {
    if (![equity, riskPct, entry, stop].every(isFinite) || entry === stop) return null;
    const riskAmt = equity * (riskPct / 100);
    const qty = riskAmt / Math.abs(entry - stop);
    return { riskAmt, qty, notional: qty * entry, stop_dist_pct: (Math.abs(entry - stop) / entry) * 100 };
  }, [equity, riskPct, entry, stop]);

  // --- liquidation (isolated approximation)
  const [liqEntry, setLiqEntry] = useState(NaN);
  const [leverage, setLeverage] = useState(10);
  const [side, setSide] = useState<"long" | "short">("long");
  const liq = useMemo(() => {
    if (!isFinite(liqEntry) || !isFinite(leverage) || leverage <= 0) return null;
    const f = 1 / leverage;
    return side === "long" ? liqEntry * (1 - f) : liqEntry * (1 + f);
  }, [liqEntry, leverage, side]);

  // --- pnl & fees
  const [pEntry, setPEntry] = useState(NaN);
  const [pExit, setPExit] = useState(NaN);
  const [pQty, setPQty] = useState(NaN);
  const [feeBps, setFeeBps] = useState(10);
  const [pSide, setPSide] = useState<"long" | "short">("long");
  const pnl = useMemo(() => {
    if (![pEntry, pExit, pQty].every(isFinite)) return null;
    const dir = pSide === "long" ? 1 : -1;
    const gross = (pExit - pEntry) * pQty * dir;
    const fees = ((pEntry + pExit) * pQty * feeBps) / 10_000;
    return { gross, fees, net: gross - fees, roiPct: pEntry * pQty ? (gross / (pEntry * pQty)) * 100 : 0 };
  }, [pEntry, pExit, pQty, feeBps, pSide]);

  // --- converter
  const [amt, setAmt] = useState(1);

  return (
    <div className="grid">
      <div className="row-flex">
        <SymbolSelect value={symbol} onChange={setSymbol} />
        {isFinite(live) && <Pill kind="accent">live {fmtNum(live)}</Pill>}
        {isFinite(live) && (
          <button className="btn sm ghost" onClick={() => { setEntry(live); setLiqEntry(live); setPEntry(live); }}>
            ⇩ fill entries with live price
          </button>
        )}
      </div>

      <div className="grid cols-2">
        <Card title="Position size (risk-based)">
          <div className="grid cols-2">
            <Num label={`Account equity`} suffix={quote} value={equity} onChange={setEquity} />
            <Num label="Risk per trade" suffix="%" value={riskPct} onChange={setRiskPct} />
            <Num label="Entry price" value={entry} onChange={setEntry} />
            <Num label="Stop price" value={stop} onChange={setStop} />
          </div>
          {sizing ? (
            <>
              <Result k="Risk amount" v={`${fmtNum(sizing.riskAmt)} ${quote}`} />
              <Result k="Position size" v={fmtNum(sizing.qty, 6)} accent />
              <Result k="Notional" v={`${fmtNum(sizing.notional)} ${quote}`} />
              <Result k="Stop distance" v={`${sizing.stop_dist_pct.toFixed(2)}%`} />
            </>
          ) : <div className="faint">Fill all fields — stop must differ from entry.</div>}
        </Card>

        <Card title="Liquidation estimate (isolated)">
          <div className="row-flex mb-3" style={{ gap: 6 }}>
            <button className={`btn sm ${side === "long" ? "primary" : "ghost"}`} onClick={() => setSide("long")}>long</button>
            <button className={`btn sm ${side === "short" ? "primary" : "ghost"}`} onClick={() => setSide("short")}>short</button>
          </div>
          <div className="grid cols-2">
            <Num label="Entry price" value={liqEntry} onChange={setLiqEntry} />
            <Num label="Leverage" suffix="×" value={leverage} onChange={setLeverage} />
          </div>
          {liq ? (
            <>
              <Result k="Approx. liquidation" v={fmtNum(liq)} accent />
              <Result k="Distance from entry" v={`${((Math.abs(liq - liqEntry) / liqEntry) * 100).toFixed(2)}%`} />
            </>
          ) : <div className="faint">Enter an entry price and leverage.</div>}
          <div className="faint mt-2">
            Approximation: entry ± entry/leverage. Excludes maintenance margin, fees and funding —
            check the official margin docs before relying on it on mainnet.
          </div>
        </Card>

        <Card title="PnL & fees">
          <div className="row-flex mb-3" style={{ gap: 6 }}>
            <button className={`btn sm ${pSide === "long" ? "primary" : "ghost"}`} onClick={() => setPSide("long")}>long</button>
            <button className={`btn sm ${pSide === "short" ? "primary" : "ghost"}`} onClick={() => setPSide("short")}>short</button>
          </div>
          <div className="grid cols-2">
            <Num label="Entry" value={pEntry} onChange={setPEntry} />
            <Num label="Exit" value={pExit} onChange={setPExit} />
            <Num label="Quantity" value={pQty} onChange={setPQty} />
            <Num label="Fee (round trip)" suffix="bps" value={feeBps} onChange={setFeeBps} />
          </div>
          {pnl ? (
            <>
              <Result k="Gross PnL" v={<span className={pnl.gross >= 0 ? "up" : "down"}>{fmtNum(pnl.gross)} {quote}</span>} />
              <Result k="Est. fees" v={`${fmtNum(pnl.fees)} ${quote}`} />
              <Result k="Net PnL" v={<span className={pnl.net >= 0 ? "up" : "down"}>{fmtNum(pnl.net)} {quote}</span>} accent />
              <Result k="ROI on notional" v={`${pnl.roiPct.toFixed(2)}%`} />
            </>
          ) : <div className="faint">Fill entry, exit and quantity.</div>}
          <div className="faint mt-2">Fee bps is a placeholder default — replace with your actual maker/taker tier.</div>
        </Card>

        <Card title="Converter">
          <Num label={`Amount (${splitSymbol(symbol)[0]})`} value={amt} onChange={setAmt} />
          {isFinite(live) && isFinite(amt) ? (
            <>
              <Result k={`${splitSymbol(symbol)[0]} → ${quote}`} v={`${fmtNum(amt * live)} ${quote}`} accent />
              <Result k={`${quote} → ${splitSymbol(symbol)[0]} (per ${fmtNum(amt)} ${quote})`} v={fmtNum(amt / live, 6)} />
            </>
          ) : <div className="faint">Waiting for live price…</div>}
        </Card>
      </div>
    </div>
  );
}
