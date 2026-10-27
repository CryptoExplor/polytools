/**
 * TOOL 7 — Trading, Risk, Fee & Unit Calculators (/#/calc)
 * Unified workspace for risk-based position sizing, isolated-margin liquidation
 * estimates, gross/net PnL & fee breakdown, and asset/unit conversion.
 * Includes full edge-case validation and live exchange price integration.
 */

import { useEffect, useId, useMemo, useReducer, useState, type ReactNode } from "react";
import { fmtNum, price, splitSymbol } from "@poly/core";
import { api } from "../lib/api";
import {
  converterPriceReducer,
  INITIAL_CONVERTER_PRICE_STATE,
} from "../lib/converter";
import { marketForSymbol } from "../lib/marketIdentity";
import { usePollData } from "../lib/hooks";
import { useApp } from "../lib/store";
import {
  Card,
  MetricCell,
  MetricStrip,
  PageHeader,
  Pill,
  TermTip,
} from "../components/ui";

function NumInput({
  label,
  value,
  onChange,
  suffix,
  min = 0,
  step = "any",
  placeholder,
  error,
  hint,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  suffix?: string;
  min?: number;
  step?: string;
  placeholder?: string;
  error?: string | null;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>
        <span>{label}</span>
        {suffix && <span className="mono faint">{suffix}</span>}
      </label>
      <div className="input-group">
        <input
          id={id}
          className={`input mono ${error ? "input-invalid" : ""}`}
          type="number"
          min={min}
          step={step}
          placeholder={placeholder}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
        />
      </div>
      {error ? (
        <div className="field-error" role="alert">
          {error}
        </div>
      ) : hint ? (
        <div className="field-hint">{hint}</div>
      ) : null}
    </div>
  );
}

function OutputRow({
  label,
  value,
  highlight,
  sub,
}: {
  label: ReactNode;
  value: ReactNode;
  highlight?: "up" | "down" | "accent" | "warn";
  sub?: ReactNode;
}) {
  return (
    <div className="kv">
      <span className="k">{label}</span>
      <span
        className={`v mono ${
          highlight === "up"
            ? "up"
            : highlight === "down"
              ? "down"
              : highlight === "warn"
                ? "warn"
                : ""
        }`}
        style={highlight === "accent" ? { color: "var(--accent-text)" } : undefined}
      >
        {value}
        {sub && (
          <small className="faint" style={{ display: "block", fontWeight: 400 }}>
            {sub}
          </small>
        )}
      </span>
    </div>
  );
}

export default function Calc() {
  const { symbol, setSymbol, pairBySymbol, assetByCode } = useApp();
  const { data: ov } = usePollData(() => api.overview([symbol]), 5000, [symbol]);
  const selectedMarket = marketForSymbol(ov?.markets, symbol);
  const live = selectedMarket ? price(selectedMarket.lastPrice) : NaN;
  const indexLive = selectedMarket ? price(selectedMarket.indexPrice) : NaN;

  const [base, quote] = splitSymbol(symbol);
  const pair = pairBySymbol.get(symbol);
  const baseDecimals = assetByCode.get(base)?.quantityDisplayDecimals ?? 6;

  // --- 1. Position Sizing State
  const [equity, setEquity] = useState<number>(1000);
  const [riskPct, setRiskPct] = useState<number>(1);
  const [entry, setEntry] = useState<number>(82000);
  const [stop, setStop] = useState<number>(80000);
  const [showWalkthrough, setShowWalkthrough] = useState<boolean>(false);

  // --- 2. Liquidation Estimate State
  const [liqEntry, setLiqEntry] = useState<number>(82000);
  const [leverage, setLeverage] = useState<number>(10);
  const [side, setSide] = useState<"long" | "short">("long");

  // --- 3. PnL & Fees State
  const [pEntry, setPEntry] = useState<number>(82000);
  const [pExit, setPExit] = useState<number>(86000);
  const [pQty, setPQty] = useState<number>(0.25);
  const [feeBps, setFeeBps] = useState<number>(10);
  const [pSide, setPSide] = useState<"long" | "short">("long");

  // --- 4. Unit & Asset Converter State
  const [amt, setAmt] = useState<number>(1);
  const [convPriceState, dispatchConvPrice] = useReducer(
    converterPriceReducer,
    INITIAL_CONVERTER_PRICE_STATE,
  );
  const convPrice = convPriceState.value;
  const [bpsInput, setBpsInput] = useState<number>(25);

  // Poll live prices only until the user edits the converter reference.
  useEffect(() => {
    if (isFinite(live) && live > 0) {
      dispatchConvPrice({ type: "sync", value: live });
    }
  }, [live]);

  const fillAllWithLive = () => {
    if (!isFinite(live) || live <= 0) return;
    setEntry(live);
    setStop(Number((live * 0.975).toPrecision(6)));
    setLiqEntry(live);
    setPEntry(live);
    setPExit(Number((live * 1.03).toPrecision(6)));
    dispatchConvPrice({ type: "sync", value: live, force: true });
  };

  const applySampleSizing = () => {
    const px = isFinite(live) && live > 0 ? live : 82000;
    setEquity(1000);
    setRiskPct(1);
    setEntry(px);
    setStop(Number((px * 0.975).toPrecision(6)));
    setShowWalkthrough(true);
  };

  // --- 1. Position Sizing Validation & Calculation
  const sizingResult = useMemo(() => {
    const errors: {
      equity?: string;
      riskPct?: string;
      entry?: string;
      stop?: string;
    } = {};

    if (!isFinite(equity) || equity <= 0) errors.equity = "Equity must be greater than 0";
    if (!isFinite(riskPct) || riskPct <= 0 || riskPct > 100) {
      errors.riskPct = "Risk % must be between 0.01% and 100%";
    }
    if (!isFinite(entry) || entry <= 0) errors.entry = "Entry price must be greater than 0";
    if (!isFinite(stop) || stop < 0) errors.stop = "Stop price cannot be negative";
    else if (isFinite(entry) && entry === stop) {
      errors.stop = "Stop price must differ from entry price";
    }

    if (Object.keys(errors).length > 0) {
      return { valid: false as const, errors };
    }

    const riskAmt = equity * (riskPct / 100);
    const qty = riskAmt / Math.abs(entry - stop);
    const notional = qty * entry;
    const stop_dist_pct = (Math.abs(entry - stop) / entry) * 100;
    const inferredSide: "LONG" | "SHORT" = entry > stop ? "LONG" : "SHORT";
    const impliedLeverage = equity > 0 ? notional / equity : 0;

    const minQty = pair ? Number(pair.minQtyBase) : 0;
    const minNotional = pair ? Number(pair.minNotionalQuote) : 0;
    const belowMinQty = minQty > 0 && qty < minQty;
    const belowMinNotional = minNotional > 0 && notional < minNotional;

    return {
      valid: true as const,
      errors,
      riskAmt,
      qty,
      notional,
      stop_dist_pct,
      inferredSide,
      impliedLeverage,
      belowMinQty,
      belowMinNotional,
    };
  }, [equity, riskPct, entry, stop, pair]);

  // --- 2. Liquidation Validation & Calculation
  const liqResult = useMemo(() => {
    const errors: { liqEntry?: string; leverage?: string } = {};
    if (!isFinite(liqEntry) || liqEntry <= 0) {
      errors.liqEntry = "Entry price must be greater than 0";
    }
    if (!isFinite(leverage) || leverage < 1 || leverage > 200) {
      errors.leverage = "Leverage must be between 1× and 200×";
    }
    if (Object.keys(errors).length > 0) {
      return { valid: false as const, errors };
    }

    const f = 1 / leverage;
    const liq = side === "long" ? liqEntry * (1 - f) : liqEntry * (1 + f);
    const distAbs = Math.abs(liq - liqEntry);
    const distPct = (distAbs / liqEntry) * 100;
    const initMarginPerUnit = liqEntry / leverage;

    return {
      valid: true as const,
      errors,
      liq,
      distAbs,
      distPct,
      initMarginPerUnit,
    };
  }, [liqEntry, leverage, side]);

  // --- 3. PnL & Fees Validation & Calculation
  const pnlResult = useMemo(() => {
    const errors: {
      pEntry?: string;
      pExit?: string;
      pQty?: string;
      feeBps?: string;
    } = {};

    if (!isFinite(pEntry) || pEntry <= 0) errors.pEntry = "Entry must be > 0";
    if (!isFinite(pExit) || pExit < 0) errors.pExit = "Exit must be ≥ 0";
    if (!isFinite(pQty) || pQty <= 0) errors.pQty = "Quantity must be > 0";
    if (!isFinite(feeBps) || feeBps < 0 || feeBps >= 5000) {
      errors.feeBps = "Fee must be between 0 and 5,000 bps";
    }

    if (Object.keys(errors).length > 0) {
      return { valid: false as const, errors };
    }

    const dir = pSide === "long" ? 1 : -1;
    const entryNotional = pEntry * pQty;
    const exitNotional = pExit * pQty;
    const gross = (pExit - pEntry) * pQty * dir;
    const feeRate = feeBps / 10_000;
    const entryFee = entryNotional * feeRate;
    const exitFee = exitNotional * feeRate;
    const fees = ((pEntry + pExit) * pQty * feeBps) / 10_000;
    const net = gross - fees;
    const roiPct = entryNotional ? (gross / entryNotional) * 100 : 0;
    const netRoiPct = entryNotional ? (net / entryNotional) * 100 : 0;

    // Exact break-even exit price where gross == fees
    const breakEven =
      pSide === "long"
        ? (pEntry * (1 + feeRate)) / Math.max(1e-9, 1 - feeRate)
        : (pEntry * (1 - feeRate)) / (1 + feeRate);

    return {
      valid: true as const,
      errors,
      entryNotional,
      exitNotional,
      gross,
      entryFee,
      exitFee,
      fees,
      net,
      roiPct,
      netRoiPct,
      breakEven,
    };
  }, [pEntry, pExit, pQty, feeBps, pSide]);

  // --- 4. Converter Validation & Calculation
  const convResult = useMemo(() => {
    const activePrice = isFinite(convPrice) && convPrice > 0 ? convPrice : live;
    const errors: { amt?: string; convPrice?: string } = {};
    if (!isFinite(amt) || amt < 0) errors.amt = "Amount must be ≥ 0";
    if (!isFinite(activePrice) || activePrice <= 0) {
      errors.convPrice = "Reference price must be > 0";
    }
    if (Object.keys(errors).length > 0) {
      return { valid: false as const, errors };
    }

    const baseToQuote = amt * activePrice;
    const quoteToBase = amt / activePrice;
    const tickNum = pair ? Number(pair.tickSize) : 0.01;
    const stepNum = pair ? Number(pair.stepSize) : 0.0001;
    const ticksInPrice = tickNum > 0 ? Math.round(activePrice / tickNum) : null;
    const stepsInAmt = stepNum > 0 ? Math.floor(amt / stepNum) : null;

    return {
      valid: true as const,
      errors,
      activePrice,
      baseToQuote,
      quoteToBase,
      ticksInPrice,
      stepsInAmt,
    };
  }, [amt, convPrice, live, pair]);

  return (
    <div className="page-stack">
      <PageHeader
        title={`Calculators · ${symbol}`}
        badge={
          isFinite(live) ? (
            <Pill kind="accent" liveDot>
              Live {fmtNum(live)} {quote}
            </Pill>
          ) : null
        }
        subtitle="Position size, fees, and profit. Stays in your browser."
        actions={
          <div className="row-flex">
            <button
              type="button"
              className="btn sm primary"
              disabled={!isFinite(live) || live <= 0}
              onClick={fillAllWithLive}
              title={
                isFinite(live)
                  ? `Populate calculator entry prices with live ${symbol} price (${fmtNum(live)})`
                  : "Waiting for live price from exchange"
              }
            >
              Use current price ({isFinite(live) ? fmtNum(live) : "—"})
            </button>
          </div>
        }
      />

      <MetricStrip>
        <MetricCell
          label={`Active Pair (${symbol})`}
          value={isFinite(live) ? `${fmtNum(live)} ${quote}` : "Manual Mode"}
          sub={
            isFinite(indexLive)
              ? `Index: ${fmtNum(indexLive)} ${quote}`
              : "Enter custom prices below"
          }
        />
        <MetricCell
          label="Exchange Min Order"
          value={pair ? `${pair.minQtyBase} ${base}` : "—"}
          sub={pair ? `Min Notional: ${pair.minNotionalQuote} ${quote}` : "Spot constraints"}
        />
        <MetricCell
          label="Price Tick / Qty Step"
          value={pair ? `${pair.tickSize} / ${pair.stepSize}` : "—"}
          sub={`Display precision: ${baseDecimals} dec`}
        />
        <MetricCell
          label="Sized Position Qty"
          trend="up"
          value={
            sizingResult.valid ? `${fmtNum(sizingResult.qty, baseDecimals)} ${base}` : "—"
          }
          sub={
            sizingResult.valid
              ? `Notional: ${fmtNum(sizingResult.notional)} ${quote}`
              : "Check sizing inputs"
          }
        />
        <MetricCell
          label="Simulated Net PnL"
          trend={
            pnlResult.valid ? (pnlResult.net >= 0 ? "up" : "down") : undefined
          }
          value={
            pnlResult.valid
              ? `${pnlResult.net >= 0 ? "+" : ""}${fmtNum(pnlResult.net)} ${quote}`
              : "—"
          }
          sub={
            pnlResult.valid
              ? `Net ROI: ${pnlResult.netRoiPct >= 0 ? "+" : ""}${pnlResult.netRoiPct.toFixed(2)}%`
              : "Check PnL inputs"
          }
        />
      </MetricStrip>

      <div className="grid cols-2">
        {/* 1. Position Sizing */}
        <Card
          title="1. Position size"
          subtitle="Size a position so a stop-out loses only your target risk %."
          actions={
            <div className="row-flex" style={{ gap: 6 }}>
              <button
                type="button"
                className="btn sm"
                onClick={applySampleSizing}
                title="Load a beginner-friendly 1% risk example with a 3-line explanation"
              >
                Use example numbers
              </button>
              {sizingResult.valid ? (
                <Pill kind={sizingResult.inferredSide === "LONG" ? "up" : "down"}>
                  Inferred {sizingResult.inferredSide}
                </Pill>
              ) : null}
            </div>
          }
          footer={
            <span className="mono">
              Formula: Qty = (Equity × Risk%) ÷ |Entry − Stop|
            </span>
          }
        >
          <div className="grid cols-2">
            <NumInput
              label="Account Equity"
              suffix={quote}
              value={equity}
              onChange={setEquity}
              error={sizingResult.errors.equity}
            />
            <NumInput
              label="Risk Per Trade"
              suffix="%"
              value={riskPct}
              onChange={setRiskPct}
              error={sizingResult.errors.riskPct}
              hint={riskPct > 5 ? "Caution: >5% equity risk per trade is aggressive" : undefined}
            />
            <NumInput
              label="Entry Price"
              suffix={quote}
              value={entry}
              onChange={setEntry}
              error={sizingResult.errors.entry}
            />
            <NumInput
              label="Stop-Loss Price"
              suffix={quote}
              value={stop}
              onChange={setStop}
              error={sizingResult.errors.stop}
            />
          </div>

          <div
            style={{
              marginTop: 8,
              padding: "10px 12px",
              background: "var(--bg-shell)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {sizingResult.valid ? (
              <>
                <OutputRow
                  label="Capital at Risk"
                  value={`${fmtNum(sizingResult.riskAmt)} ${quote}`}
                />
                <OutputRow
                  label={`Position Size (${base})`}
                  value={`${fmtNum(sizingResult.qty, baseDecimals)} ${base}`}
                  highlight="up"
                />
                <OutputRow
                  label={`Position Notional (${quote})`}
                  value={`${fmtNum(sizingResult.notional)} ${quote}`}
                  sub={`Implied Account Leverage: ${sizingResult.impliedLeverage.toFixed(2)}×`}
                />
                <OutputRow
                  label="Stop Distance from Entry"
                  value={`${sizingResult.stop_dist_pct.toFixed(2)}% (${fmtNum(
                    Math.abs(entry - stop),
                  )} ${quote})`}
                />
                {(sizingResult.belowMinQty || sizingResult.belowMinNotional) && (
                  <div className="notice mt-2" style={{ padding: "6px 10px" }}>
                    <span>
                      Note: Calculated position is below {symbol} exchange minimums (
                      {pair?.minQtyBase} {base} / {pair?.minNotionalQuote} {quote}).
                    </span>
                  </div>
                )}
                {showWalkthrough && (
                  <div
                    className="notice mt-2"
                    style={{ padding: "8px 10px", fontSize: 12 }}
                    role="note"
                  >
                    <div>
                      <strong>Walkthrough (3 steps):</strong>
                      <div className="muted mt-1">
                        1. Risk budget: {riskPct}% of {fmtNum(equity)} {quote} ={" "}
                        <strong>
                          {fmtNum(sizingResult.riskAmt)} {quote}
                        </strong>{" "}
                        maximum loss if stopped out.
                        <br />
                        2. Price distance to stop: |{fmtNum(entry)} − {fmtNum(stop)}| ={" "}
                        <strong>
                          {fmtNum(Math.abs(entry - stop))} {quote}
                        </strong>{" "}
                        per 1 {base}.
                        <br />
                        3. Target size: {fmtNum(sizingResult.riskAmt)} ÷{" "}
                        {fmtNum(Math.abs(entry - stop))} ={" "}
                        <strong>
                          {fmtNum(sizingResult.qty, baseDecimals)} {base}
                        </strong>
                        .
                      </div>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="faint center" style={{ padding: "12px 0" }}>
                Correct the highlighted inputs above to compute position size.
              </div>
            )}
          </div>
        </Card>

        {/* 2. Educational Isolated-Margin Sketch (UX-03 / A6) */}
        <Card
          title="2. Liquidation estimate (simple model)"
          subtitle="Toy textbook 1/L math — Polyester's public product is unified-asset spot + lending, not isolated-margin perpetuals."
          actions={
            <div className="seg-group" role="group" aria-label="Liquidation position direction">
              <button
                type="button"
                className={`seg-btn ${side === "long" ? "active" : ""}`}
                onClick={() => setSide("long")}
              >
                ▲ Long
              </button>
              <button
                type="button"
                className={`seg-btn ${side === "short" ? "active" : ""}`}
                onClick={() => setSide("short")}
              >
                ▼ Short
              </button>
            </div>
          }
          footer={
            <span className="mono">
              Formula: Liq = Entry × (1 {side === "long" ? "−" : "+"} 1 ÷ Leverage)
            </span>
          }
        >
          <div className="grid cols-2">
            <NumInput
              label="Entry Price"
              suffix={quote}
              value={liqEntry}
              onChange={setLiqEntry}
              error={liqResult.errors.liqEntry}
            />
            <NumInput
              label="Isolated Leverage"
              suffix="×"
              min={1}
              value={leverage}
              onChange={setLeverage}
              error={liqResult.errors.leverage}
            />
          </div>

          <div className="row-flex mb-3" style={{ gap: 6 }}>
            <span className="faint">Quick Leverage:</span>
            {[1, 2, 3, 5, 10, 20, 50].map((lv) => (
              <button
                key={lv}
                type="button"
                className={`btn sm ${leverage === lv ? "primary" : "ghost"}`}
                onClick={() => setLeverage(lv)}
              >
                {lv}×
              </button>
            ))}
          </div>

          <div
            style={{
              padding: "10px 12px",
              background: "var(--bg-shell)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {liqResult.valid ? (
              <>
                <OutputRow
                  label="Est. Liquidation Price"
                  value={`${fmtNum(liqResult.liq)} ${quote}`}
                  highlight="warn"
                />
                <OutputRow
                  label="Buffer Distance to Liquidation"
                  value={`${liqResult.distPct.toFixed(2)}% (${fmtNum(liqResult.distAbs)} ${quote})`}
                />
                <OutputRow
                  label={`Initial Margin per 1 ${base}`}
                  value={`${fmtNum(liqResult.initMarginPerUnit)} ${quote}`}
                />
              </>
            ) : (
              <div className="faint center" style={{ padding: "12px 0" }}>
                Enter a positive entry price and leverage ≥ 1×.
              </div>
            )}
          </div>
          <div className="faint mt-2">
            <strong>Model limitations:</strong> Textbook 1/L sketch only; it excludes the exchange
            maintenance margin ratio, taker liquidation fees, funding, and venue-specific risk
            rules. It does not model Polyester's spot/lending risk behavior or predict an actual
            liquidation price.
          </div>
        </Card>

        {/* 3. PnL, Fees & Break-Even */}
        <Card
          title="3. Profit and fees"
          subtitle="Gross PnL, round-trip fees, net ROI, and break-even exit."
          actions={
            <div className="seg-group" role="group" aria-label="PnL trade side">
              <button
                type="button"
                className={`seg-btn ${pSide === "long" ? "active" : ""}`}
                onClick={() => setPSide("long")}
              >
                ▲ Long
              </button>
              <button
                type="button"
                className={`seg-btn ${pSide === "short" ? "active" : ""}`}
                onClick={() => setPSide("short")}
              >
                ▼ Short
              </button>
            </div>
          }
          footer={
            <span className="mono">
              Fees = ((Entry + Exit) × Qty × FeeBps) ÷ 10,000
            </span>
          }
        >
          <div className="grid cols-2">
            <NumInput
              label="Entry Price"
              suffix={quote}
              value={pEntry}
              onChange={setPEntry}
              error={pnlResult.errors.pEntry}
            />
            <NumInput
              label="Target Exit Price"
              suffix={quote}
              value={pExit}
              onChange={setPExit}
              error={pnlResult.errors.pExit}
            />
            <NumInput
              label="Order Quantity"
              suffix={base}
              value={pQty}
              onChange={setPQty}
              error={pnlResult.errors.pQty}
            />
            <NumInput
              label="Fee Rate (per leg)"
              suffix="bps"
              value={feeBps}
              onChange={setFeeBps}
              error={pnlResult.errors.feeBps}
              hint="Example fee rate. Check your own fee tier in Polyester."
            />
          </div>

          <div
            style={{
              marginTop: 8,
              padding: "10px 12px",
              background: "var(--bg-shell)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {pnlResult.valid ? (
              <>
                <OutputRow
                  label="Entry / Exit Notional"
                  value={`${fmtNum(pnlResult.entryNotional)} → ${fmtNum(pnlResult.exitNotional)} ${quote}`}
                />
                <OutputRow
                  label="Gross PnL (before fees)"
                  value={`${pnlResult.gross >= 0 ? "+" : ""}${fmtNum(pnlResult.gross)} ${quote} (${
                    pnlResult.roiPct >= 0 ? "+" : ""
                  }${pnlResult.roiPct.toFixed(2)}%)`}
                  highlight={pnlResult.gross >= 0 ? "up" : "down"}
                />
                <OutputRow
                  label="Est. Round-Trip Fees"
                  value={`−${fmtNum(pnlResult.fees)} ${quote}`}
                  sub={`Entry: ${fmtNum(pnlResult.entryFee)} · Exit: ${fmtNum(pnlResult.exitFee)}`}
                />
                <OutputRow
                  label="Net PnL (after fees)"
                  value={`${pnlResult.net >= 0 ? "+" : ""}${fmtNum(pnlResult.net)} ${quote} (${
                    pnlResult.netRoiPct >= 0 ? "+" : ""
                  }${pnlResult.netRoiPct.toFixed(2)}%)`}
                  highlight={pnlResult.net >= 0 ? "up" : "down"}
                />
                <OutputRow
                  label={
                    <TermTip
                      label="Break-Even Exit Price"
                      tip="Exact exit price required so Net PnL = 0 after paying both entry and exit fees"
                    />
                  }
                  value={`${fmtNum(pnlResult.breakEven)} ${quote}`}
                />
              </>
            ) : (
              <div className="faint center" style={{ padding: "12px 0" }}>
                Fill valid entry, exit, quantity, and fee bps above.
              </div>
            )}
          </div>
        </Card>

        {/* 4. Asset & Unit Converter */}
        <Card
          title="4. Unit converter"
          subtitle={`Convert between ${base}, ${quote}, exchange tick increments, and basis points.`}
          footer={
            <span className="mono">
              1% = 100 bps · 1 bps = 0.01% = 0.0001
            </span>
          }
        >
          <div className="grid cols-2">
            <NumInput
              label={`Amount (${base} or ${quote})`}
              value={amt}
              onChange={setAmt}
              error={convResult.errors.amt}
            />
            <NumInput
              label={`Reference Price (${symbol})`}
              suffix={quote}
              value={convPrice}
              onChange={(value) => dispatchConvPrice({ type: "edit", value })}
              error={convResult.errors.convPrice}
            />
          </div>

          <div
            style={{
              marginTop: 4,
              padding: "10px 12px",
              background: "var(--bg-shell)",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border-subtle)",
            }}
          >
            {convResult.valid ? (
              <>
                <OutputRow
                  label={`${fmtNum(amt, baseDecimals)} ${base} in ${quote}`}
                  value={`${fmtNum(convResult.baseToQuote)} ${quote}`}
                  highlight="up"
                />
                <OutputRow
                  label={`${fmtNum(amt)} ${quote} in ${base}`}
                  value={`${fmtNum(convResult.quoteToBase, baseDecimals)} ${base}`}
                  highlight="accent"
                />
                {convResult.ticksInPrice !== null && pair && (
                  <OutputRow
                    label={`Price in ${symbol} Ticks (${pair.tickSize})`}
                    value={`${convResult.ticksInPrice.toLocaleString("en-US")} ticks`}
                  />
                )}
                {convResult.stepsInAmt !== null && pair && (
                  <OutputRow
                    label={`Amount in Lot Steps (${pair.stepSize} ${base})`}
                    value={`${convResult.stepsInAmt.toLocaleString("en-US")} steps`}
                  />
                )}
              </>
            ) : (
              <div className="faint center" style={{ padding: "12px 0" }}>
                Enter a non-negative amount and a positive reference price.
              </div>
            )}
          </div>

          {/* Quick Basis Points <-> Percent Converter */}
          <div className="mt-3">
            <NumInput
              label="Basis Points (bps) ⇄ Percentage / Decimal"
              suffix="bps"
              value={bpsInput}
              onChange={setBpsInput}
            />
            {isFinite(bpsInput) && (
              <div className="row-flex" style={{ justifyContent: "space-between" }}>
                <Pill kind="accent">{bpsInput} bps</Pill>
                <span className="mono">= {(bpsInput / 100).toFixed(4)}%</span>
                <span className="mono muted">= {(bpsInput / 10_000).toFixed(6)}x</span>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
