/**
 * TOOL 8 — Fee schedule (/#/fees)
 *
 * The venue's public VIP0–VIP10 catalog: maker and taker rates, the rolling
 * 30-day volume that unlocks each tier, and the average-portfolio-value
 * threshold alongside it.
 *
 * Why this page exists: every "what will this cost me" number elsewhere in the
 * app was a guess typed into a calculator. This is the authoritative schedule,
 * published as an immutable policy version, and it is the honest baseline that
 * any third-party fee would have to sit on top of.
 *
 * What it deliberately does not do:
 *  - It does not claim these are the rates a fill paid. They are absolute rates
 *    *before symbol-specific adjustments*; the per-fill rate lives in account
 *    activity and needs a session.
 *  - It does not predict a trader's tier. Qualification uses volume, portfolio
 *    value, and retention together, and only the exchange decides it.
 */

import { useState } from "react";
import {
  formatPercent,
  formatUsdThreshold,
  percentValue,
  type VipTier,
} from "@poly/core";
import { api } from "../lib/api";
import { usePollData } from "../lib/hooks";
import { fmtNum } from "@poly/core";
import {
  Card,
  DataFreshness,
  ErrorBox,
  Loading,
  MetricCell,
  MetricStrip,
  PageHeader,
  Pill,
  TermTip,
} from "../components/ui";

/** A trade's notional × rate, in USD. Returns null when the rate is unreadable. */
function feeOn(notional: number, ratePercent: string): number | null {
  const rate = percentValue(ratePercent);
  if (rate === null || !Number.isFinite(notional) || notional < 0) return null;
  return (notional * rate) / 100;
}

function usd(value: number | null): string {
  if (value === null) return "—";
  return `$${fmtNum(value, value >= 1 ? 2 : 6)}`;
}

export default function Fees() {
  const { data, error, loading, refreshing, updatedAt, paused, setPaused, refresh } =
    usePollData(() => api.feesTiers(), 300_000, []);

  const [notional, setNotional] = useState<string>("10000");
  const [tierIndex, setTierIndex] = useState<number>(0);

  const notionalValue = Number(notional);
  const tiers = data?.tiers ?? [];
  const selected: VipTier | undefined = tiers[Math.min(tierIndex, tiers.length - 1)];

  const makerFee = selected ? feeOn(notionalValue, selected.makerFeeRatePercent) : null;
  const takerFee = selected ? feeOn(notionalValue, selected.takerFeeRatePercent) : null;

  const worst = tiers[0];
  const best = tiers[tiers.length - 1];

  return (
    <div className="page-stack">
      <PageHeader
        title="Fee schedule"
        subtitle={
          <>
            Every tier the exchange publishes, straight from{" "}
            <code>GET /v1/vip/tiers</code> — a public endpoint, no key and no
            wallet. Rates here are absolute and{" "}
            <TermTip
              label="before pair adjustments"
              tip="A market can carry its own fee modifier on top of the schedule. The rate a specific fill paid is recorded in account activity, not here."
            />
            .
          </>
        }
        badge={<Pill kind="info">Public catalog</Pill>}
        actions={
          <DataFreshness
            updatedAt={updatedAt}
            refreshing={refreshing}
            error={error}
            intervalSec={300}
            paused={paused}
            onTogglePause={() => setPaused(!paused)}
            onRefresh={refresh}
          />
        }
      />

      <ErrorBox error={error} hasStaleData={Boolean(data)} onRetry={refresh} />

      {loading && !data && <Loading lines={6} />}

      {data && (
        <>
          <MetricStrip>
            <MetricCell
              label="Policy version"
              value={data.policyVersion}
              sub="Immutable once published"
            />
            <MetricCell
              label="Effective from"
              value={new Date(data.effectiveFrom).toLocaleDateString()}
              sub={data.effectiveFrom}
            />
            <MetricCell
              label="VIP0 taker"
              value={worst ? (formatPercent(worst.takerFeeRatePercent) ?? "—") : "—"}
              sub="Highest rate in the catalog"
            />
            <MetricCell
              label="VIP10 taker"
              value={best ? (formatPercent(best.takerFeeRatePercent) ?? "—") : "—"}
              sub="Lowest rate in the catalog"
            />
            <MetricCell
              label={<TermTip label="Retention" tip="Average-portfolio-value retention threshold, in basis points, used alongside the entry thresholds to hold a tier." />}
              value={`${(data.retentionThresholdBp / 100).toFixed(2)}%`}
              sub={`${data.retentionThresholdBp} bp`}
            />
          </MetricStrip>

          <Card
            title="All tiers"
            subtitle="Entry thresholds are rolling 30-day figures. VIP0 has no portfolio-value threshold — the exchange omits it rather than publishing a zero."
          >
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Tier</th>
                    <th scope="col">Maker</th>
                    <th scope="col">Taker</th>
                    <th scope="col">30-day volume</th>
                    <th scope="col">Avg portfolio value</th>
                  </tr>
                </thead>
                <tbody>
                  {tiers.map((tier, index) => (
                    <tr
                      key={tier.tier}

                    >
                      <th scope="row">VIP{tier.tier}</th>
                      <td>{formatPercent(tier.makerFeeRatePercent) ?? "—"}</td>
                      <td>{formatPercent(tier.takerFeeRatePercent) ?? "—"}</td>
                      <td>{formatUsdThreshold(tier.volumeThresholdUsd) ?? "—"}</td>
                      <td>
                        {tier.aopThresholdUsd === null ? (
                          <span className="faint">none</span>
                        ) : (
                          (formatUsdThreshold(tier.aopThresholdUsd) ?? "—")
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card
            title="Cost of a trade at this tier"
            subtitle="Notional × the schedule rate. This is arithmetic on the catalog — not a quote, and not a statement that you qualify for the tier."
          >
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <label className="field">
                <span>Trade notional (USD)</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={notional}
                  onChange={(event) => setNotional(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Tier</span>
                <select
                  value={tierIndex}
                  onChange={(event) => setTierIndex(Number(event.target.value))}
                >
                  {tiers.map((tier, index) => (
                    <option key={tier.tier} value={index}>
                      VIP{tier.tier}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <MetricStrip>
              <MetricCell
                label="Maker fee"
                value={usd(makerFee)}
                sub={selected ? formatPercent(selected.makerFeeRatePercent) : undefined}
              />
              <MetricCell
                label="Taker fee"
                value={usd(takerFee)}
                sub={selected ? formatPercent(selected.takerFeeRatePercent) : undefined}
              />
              <MetricCell
                label="Round trip, both sides taker"
                value={usd(takerFee === null ? null : takerFee * 2)}
                sub="Two taker fills"
              />
              <MetricCell
                label="Round trip, both sides maker"
                value={usd(makerFee === null ? null : makerFee * 2)}
                sub="Two maker fills"
              />
            </MetricStrip>
          </Card>

          <Card title="What this page does not tell you">
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, display: "grid", gap: 8 }}>
              <li>
                <strong>The rate a fill actually paid.</strong> Pairs can carry
                their own fee modifier, and rebates exist. That per-fill rate is
                recorded in account activity, which needs a session.
              </li>
              <li>
                <strong>Your tier.</strong> Qualification combines rolling volume,
                average portfolio value, and retention. Only the exchange assigns
                it, and only for an authenticated account.
              </li>
              <li>
                <strong>Any fee of ours.</strong> Polyester publishes no
                third-party fee or attribution mechanism, so nothing on this page
                includes one.
              </li>
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
