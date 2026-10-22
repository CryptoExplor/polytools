/**
 * TOOL 6 — Zipper routes: supported chains (confirmations, explorers),
 * per-asset deposit/withdraw routes with fees & minimums, and a
 * "cheapest route" ranker — the answer to "which network do I use?".
 */

import { useMemo, useState } from "react";
import { api } from "../lib/api";
import { usePollData } from "../lib/hooks";
import { useApp } from "../lib/store";
import { Card, ErrorBox, Loading, Pill } from "../components/ui";
import { fmtNum, fmtCompact } from "@poly/core";

export default function Zipper() {
  const { assets } = useApp();
  const { data: cfg, error } = usePollData(() => api.zipperConfig(), 120_000, []);
  const [asset, setAsset] = useState("USDT");
  const [compareBy, setCompareBy] = useState<"networkFee" | "depositMinAmount">("networkFee");
  const { data: cmp, error: cmpError, loading } = usePollData(
    () => api.zipperCompare(asset, compareBy), 60_000, [asset, compareBy],
  );

  const assetChoices = useMemo(
    () => assets.filter((a) => !a.asset.startsWith("t")).map((a) => a.asset),
    [assets],
  );

  return (
    <div className="grid">
      <ErrorBox error={error} />

      <Card title={`Supported chains · ${cfg?.chains?.length ?? 0}`}>
        {!cfg ? <Loading lines={5} /> : (
          <div className="table-wrap" style={{ border: "none" }}>
            <table className="data">
              <thead>
                <tr><th>Chain</th><th>Native</th><th>Confirmations</th><th>~Time</th><th style={{ textAlign: "left" }}>Explorer</th></tr>
              </thead>
              <tbody>
                {cfg.chains.map((c) => (
                  <tr key={c.chainId} style={{ cursor: "default" }}>
                    <td><b>{c.name}</b> <span className="faint mono">{c.code}</span></td>
                    <td className="mono">{c.nativeCurrencySymbol}</td>
                    <td className="mono">{c.requiredConfirmations}</td>
                    <td className="mono">{c.confirmationTimeSeconds}s</td>
                    <td style={{ textAlign: "left" }}>
                      <a href={c.explorerUrl} target="_blank" rel="noreferrer">{c.explorerUrl.replace(/^https?:\/\//, "")}</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="row-flex">
        <select className="select" style={{ width: "auto" }} value={asset} onChange={(e) => setAsset(e.target.value)}>
          {[...new Set([asset, ...assetChoices])].map((a) => <option key={a}>{a}</option>)}
        </select>
        <div className="row-flex" style={{ gap: 6 }}>
          <button className={`btn sm ${compareBy === "networkFee" ? "primary" : "ghost"}`} onClick={() => setCompareBy("networkFee")}>rank by fee</button>
          <button className={`btn sm ${compareBy === "depositMinAmount" ? "primary" : "ghost"}`} onClick={() => setCompareBy("depositMinAmount")}>rank by min deposit</button>
        </div>
      </div>

      <ErrorBox error={cmpError} />

      <Card title={`Routes for ${asset}`}>
        {loading && !cmp ? <Loading lines={4} /> : !cmp?.routes?.length ? (
          <div className="faint">No routes returned for this asset yet — try USDT, USDC, ETH, BTC…</div>
        ) : (
          <>
            {cmp.cheapestByNetworkFee && (
              <div className="row-flex mb-3">
                <Pill kind="up">cheapest fee: {cmp.cheapestByNetworkFee.chain} · {fmtCompact(Number(cmp.cheapestByNetworkFee.networkFee), "$")}</Pill>
                {cmp.cheapestByDepositMin && (
                  <Pill kind="accent">lowest minimum: {cmp.cheapestByDepositMin.chain} · {fmtNum(Number(cmp.cheapestByDepositMin.depositMinAmount))} {asset}</Pill>
                )}
              </div>
            )}
            <div className="table-wrap" style={{ border: "none" }}>
              <table className="data">
                <thead>
                  <tr><th>Chain</th><th>Network fee</th><th>Min deposit</th><th>Min withdraw</th><th>Type</th></tr>
                </thead>
                <tbody>
                  {cmp.routes.map((r) => (
                    <tr key={r.chainId} style={{ cursor: "default" }}>
                      <td><b>{r.chain}</b></td>
                      <td className="mono">{fmtNum(Number(r.networkFee))} {r.asset}</td>
                      <td className="mono">{fmtNum(Number(r.depositMinAmount))}</td>
                      <td className="mono">{fmtNum(Number(r.withdrawMinAmount))}</td>
                      <td>{r.isNativeAsset ? <Pill kind="accent">native</Pill> : <Pill>bridged/issued</Pill>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
        <div className="faint mt-2">
          Live values from Zipper config; always confirm in the official Polyester app before depositing.
        </div>
      </Card>
    </div>
  );
}
