/**
 * TOOL 6 — Zipper Cross-Chain Routes & Bridge Config (/#/zipper)
 * Compares deposit/withdrawal networks, fees, minimums, confirmation times,
 * route rankings (with explicit ranking rationale), estimated net transfer output,
 * and protocol contract directory.
 */

import { useMemo, useState } from "react";
import { fmtNum } from "@poly/core";
import { api } from "../lib/api";
import { zipperCompareForRequest } from "../lib/marketIdentity";
import { usePollData } from "../lib/hooks";
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
  SymBadge,
  TermTip,
} from "../components/ui";
import { IconExternal, IconSearch } from "../components/icons";

interface ConfigAssetEntry {
  asset: string;
  name: string;
  quantityDisplayDecimals: number;
  variants?: Array<{
    chain: string;
    chainCode: string;
    chainId: number;
    isNativeAsset: boolean;
    networkFee: string;
    depositMinAmount: string;
    withdrawMinAmount: string;
  }>;
}

interface ConfigContractEntry {
  name: string;
  address: string;
  type?: string;
}

const DEFAULT_ASSETS = [
  "USDT",
  "USDC",
  "ETH",
  "BTC",
  "SOL",
  "tETH",
  "tBTC",
  "tSOL",
  "AVAX",
  "BNB",
  "XRP",
  "DOGE",
  "LTC",
  "BCH",
  "POL",
  "TRX",
  "ETC",
  "HYPE",
];

export default function Zipper() {
  const { assets } = useApp();
  const [asset, setAsset] = useState<string>("USDT");
  const [compareBy, setCompareBy] = useState<"networkFee" | "depositMinAmount">("networkFee");
  const [chainFilter, setChainFilter] = useState<string>("");
  const [estAmount, setEstAmount] = useState<number>(100);
  const [chainQuery, setChainQuery] = useState<string>("");
  const [showContracts, setShowContracts] = useState<boolean>(false);

  const {
    data: cfg,
    error: cfgError,
    loading: cfgLoading,
    refreshing: cfgRefreshing,
    updatedAt: cfgAt,
    refresh: refreshCfg,
  } = usePollData(() => api.zipperConfig(), 120_000, []);

  const {
    data: cmp,
    error: cmpError,
    loading: cmpLoading,
    refreshing: cmpRefreshing,
    updatedAt: cmpAt,
    refresh: refreshCmp,
  } = usePollData(
    () => api.zipperCompare(asset, compareBy, chainFilter || undefined),
    60_000,
    [asset, compareBy, chainFilter],
  );
  const currentCmp = zipperCompareForRequest(cmp, asset, compareBy, chainFilter);
  const comparisonIdentityError = cmp && !currentCmp
    ? "Bridge comparison response did not match the selected asset or filters; it was not displayed."
    : null;
  const displayCmpError = comparisonIdentityError ?? cmpError;

  const cfgAssets = useMemo(() => cfg?.assets ?? [], [cfg]);

  const cfgContracts = useMemo(() => cfg?.contracts ?? [], [cfg]);

  const assetChoices = useMemo(() => {
    const fromStore = assets.map((a) => a.asset);
    const fromCfg = cfgAssets.map((a) => a.asset);
    const combined = [...new Set([...fromCfg, ...fromStore, ...DEFAULT_ASSETS])];
    // Put standard assets first, then testnet t* assets
    const std = combined.filter((a) => !a.startsWith("t")).sort();
    const tst = combined.filter((a) => a.startsWith("t")).sort();
    return [...std, ...tst];
  }, [assets, cfgAssets]);

  const chainById = useMemo(
    () => new Map((cfg?.chains ?? []).map((c) => [c.chainId, c])),
    [cfg],
  );

  // Preserve the backend/MCP route ranking order while computing explicit ranking rationale
  const rankedRoutes = useMemo(() => {
    const rawRoutes = currentCmp?.routes ?? [];
    if (!rawRoutes.length) return [];

    const cheapestFeeVal = Math.min(...rawRoutes.map((r) => Number(r.networkFee)));
    const lowestMinVal = Math.min(...rawRoutes.map((r) => Number(r.depositMinAmount)));

    return rawRoutes.map((r, idx) => {
      const feeNum = Number(r.networkFee);
      const minDepNum = Number(r.depositMinAmount);
      const minWdNum = Number(r.withdrawMinAmount);
      const chainMeta = chainById.get(r.chainId);

      const reasons: string[] = [];
      if (compareBy === "networkFee" && feeNum === cheapestFeeVal) {
        reasons.push("Lowest network fee");
      }
      if (compareBy === "depositMinAmount" && minDepNum === lowestMinVal) {
        reasons.push("Lowest minimum deposit");
      }
      if (r.isNativeAsset) {
        reasons.push("Native chain asset");
      }
      if (chainMeta && chainMeta.confirmationTimeSeconds <= 15) {
        reasons.push(`Fast finality (~${chainMeta.confirmationTimeSeconds}s)`);
      }
      if (!reasons.length) {
        reasons.push(
          compareBy === "networkFee"
            ? `Ranked #${idx + 1} by network fee`
            : `Ranked #${idx + 1} by deposit minimum`,
        );
      }

      const validAmt = isFinite(estAmount) && estAmount > 0;
      const meetsMinDeposit = validAmt && estAmount >= minDepNum;
      const meetsMinWithdraw = validAmt && estAmount >= minWdNum;
      const estNetAfterFee = validAmt ? Math.max(0, estAmount - feeNum) : NaN;

      return {
        ...r,
        rank: idx + 1,
        feeNum,
        minDepNum,
        minWdNum,
        chainMeta,
        reasons,
        meetsMinDeposit,
        meetsMinWithdraw,
        estNetAfterFee,
      };
    });
  }, [currentCmp, compareBy, chainById, estAmount]);

  const filteredChains = useMemo(() => {
    const list = cfg?.chains ?? [];
    if (!chainQuery.trim()) return list;
    const q = chainQuery.trim().toLowerCase();
    return list.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.nativeCurrencySymbol.toLowerCase().includes(q),
    );
  }, [cfg, chainQuery]);

  return (
    <div className="page-stack">
      <PageHeader
        title="Bridge routes"
        badge={
          cfg?.apiEnv ? (
            <Pill kind={cfg.apiEnv === "testnet" ? "warn" : "up"}>{cfg.apiEnv}</Pill>
          ) : null
        }
        subtitle="Compare routes per token: fee, minimum, and confirmation time. No address is created here."
        actions={
          <DataFreshness
            updatedAt={cmpAt ?? cfgAt}
            refreshing={cmpRefreshing || cfgRefreshing}
            error={cmpError ?? cfgError}
            intervalSec={60}
            onRefresh={() => {
              refreshCfg();
              refreshCmp();
            }}
          />
        }
      />

      <MetricStrip>
        <MetricCell
          label="Supported Networks"
          value={cfg?.chains?.length ?? "—"}
          sub={
            cfg
              ? `Polyester hub chainId: ${cfg.polyesterChainId}`
              : "Cross-chain Zipper spokes"
          }
        />
        <MetricCell
          label={`Selected Asset (${asset})`}
          value={`${rankedRoutes.length} route${rankedRoutes.length === 1 ? "" : "s"}`}
          sub={`Ranked by ${compareBy === "networkFee" ? "Network Fee" : "Deposit Minimum"}`}
        />
        <MetricCell
          label="Cheapest Network Fee"
          trend="up"
          value={
            currentCmp?.cheapestByNetworkFee
              ? `${fmtNum(Number(currentCmp.cheapestByNetworkFee.networkFee))} ${asset}`
              : "—"
          }
          sub={
            currentCmp?.cheapestByNetworkFee
              ? `via ${currentCmp.cheapestByNetworkFee.chain}`
              : "Select an asset"
          }
        />
        <MetricCell
          label="Lowest Deposit Minimum"
          value={
            currentCmp?.cheapestByDepositMin
              ? `${fmtNum(Number(currentCmp.cheapestByDepositMin.depositMinAmount))} ${asset}`
              : "—"
          }
          sub={
            currentCmp?.cheapestByDepositMin
              ? `via ${currentCmp.cheapestByDepositMin.chain}`
              : "Select an asset"
          }
        />
      </MetricStrip>

      <ErrorBox error={cfgError} onRetry={refreshCfg} hasStaleData={Boolean(cfg)} />
      <ErrorBox error={displayCmpError} onRetry={refreshCmp} hasStaleData={Boolean(currentCmp)} />

      {/* Route Comparator & Fee Estimator */}
      <Card
        flush
        title={`Asset Route Comparison · ${asset}`}
        subtitle="Ranked by the chosen column. Inventory and testnet resets are excluded."
        actions={
          <div className="row-flex" style={{ gap: 8 }}>
            <div className="row-flex" style={{ gap: 6 }}>
              <SymBadge asset={asset.replace(/^t/, "")} />
              <select
                className="select mono"
                style={{ width: "auto", fontWeight: 600 }}
                aria-label="Select asset to compare routes"
                value={asset}
                onChange={(e) => setAsset(e.target.value)}
              >
                {assetChoices.map((a) => (
                  <option key={a} value={a}>
                    {a} {a.startsWith("t") ? "(Testnet Native)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <select
              className="select mono"
              style={{ width: "auto" }}
              aria-label="Filter routes by network"
              value={chainFilter}
              onChange={(e) => setChainFilter(e.target.value)}
            >
              <option value="">All Networks</option>
              {(cfg?.chains ?? []).map((c) => (
                <option key={c.chainId} value={c.code}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>

            <div className="seg-group" role="group" aria-label="Rank routes by">
              <button
                type="button"
                className={`seg-btn ${compareBy === "networkFee" ? "active" : ""}`}
                onClick={() => setCompareBy("networkFee")}
              >
                Rank by Fee
              </button>
              <button
                type="button"
                className={`seg-btn ${compareBy === "depositMinAmount" ? "active" : ""}`}
                onClick={() => setCompareBy("depositMinAmount")}
              >
                Rank by Min Deposit
              </button>
            </div>

            <div className="row-flex" style={{ gap: 6 }}>
              <label htmlFor="zipper-est-amt" className="faint">
                Simulate Amount:
              </label>
              <input
                id="zipper-est-amt"
                type="number"
                min="0"
                step="any"
                className="input mono"
                style={{ width: 115, padding: "5px 8px" }}
                value={Number.isFinite(estAmount) ? estAmount : ""}
                onChange={(e) =>
                  setEstAmount(e.target.value === "" ? NaN : Number(e.target.value))
                }
              />
              <span className="mono faint">{asset}</span>
            </div>
          </div>
        }
        footer={
          <>
            <span>
              <strong>Estimation Notice:</strong> Fees and minimums come from the currently
              loaded public Zipper configuration, which may be cached, stale, or a labeled
              development sample. Illustrative Deposit Net subtracts the listed network fee
              from the entered amount and checks the deposit minimum only; it is not a
              withdrawal or executable transfer quote. Confirm final parameters in the
              official Polyester app before initiating a transfer.
            </span>
            <span className="mono">
              Tip: Try <strong>tETH</strong> to compare 4 multi-chain testnet routes.
            </span>
          </>
        }
      >
        {cmpLoading && !currentCmp ? (
          <div style={{ padding: 16 }}>
            <Loading lines={5} />
          </div>
        ) : rankedRoutes.length === 0 ? (
          <EmptyState
            title={`No routes returned for ${asset}`}
            description="No active Zipper routes for this asset. Try USDT, USDC, ETH, BTC, or tETH."
            action={
              <div className="row-flex">
                {["USDT", "ETH", "BTC", "tETH"].map((a) => (
                  <button
                    key={a}
                    type="button"
                    className="btn sm"
                    onClick={() => setAsset(a)}
                  >
                    Switch to {a}
                  </button>
                ))}
              </div>
            }
          />
        ) : (
          <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
            <table className="data">
              <thead>
                <tr>
                  <th className="align-left">Rank & Source/Dest Network</th>
                  <th>Asset Type</th>
                  <th>Network Fee</th>
                  <th>Min Deposit</th>
                  <th>Min Withdraw</th>
                  <th>Confirmations / Finality</th>
                  <th>
                    <TermTip
                      label={`Illustrative Deposit Net (${asset})`}
                      tip="Deposit-oriented illustration: entered amount minus the listed network fee, with a deposit-minimum check. Not a withdrawal or executable transfer quote."
                    />
                  </th>
                  <th className="align-left">Ranking Rationale & Status</th>
                </tr>
              </thead>
              <tbody>
                {rankedRoutes.map((r) => (
                  <tr key={`${r.chainId}-${r.chainCode}`}>
                    <td>
                      <div className="row-flex" style={{ gap: 8 }}>
                        <Pill kind={r.rank === 1 ? "up" : undefined}>#{r.rank}</Pill>
                        <div>
                          <strong>{r.chain}</strong>
                          <div className="faint mono" style={{ fontSize: 11 }}>
                            {r.chainCode} (chainId {r.chainId}) ⇄ Polyester
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {r.isNativeAsset ? (
                        <Pill kind="accent">Native Asset</Pill>
                      ) : (
                        <Pill>Bridged / Token</Pill>
                      )}
                    </td>
                    <td className="mono" style={{ fontWeight: 700 }}>
                      {fmtNum(r.feeNum, 6)} {r.asset}
                    </td>
                    <td className="mono">
                      {fmtNum(r.minDepNum, 6)} {r.asset}
                    </td>
                    <td className="mono">
                      {fmtNum(r.minWdNum, 6)} {r.asset}
                    </td>
                    <td className="mono muted">
                      {r.chainMeta
                        ? `${r.chainMeta.requiredConfirmations} conf (~${r.chainMeta.confirmationTimeSeconds}s)`
                        : "—"}
                    </td>
                    <td className="mono">
                      {!isFinite(estAmount) || estAmount <= 0 ? (
                        <span className="faint">Enter amount</span>
                      ) : !r.meetsMinDeposit ? (
                        <Pill kind="down" title={`Minimum deposit is ${r.minDepNum} ${r.asset}`}>
                          Below Min ({fmtNum(r.minDepNum)})
                        </Pill>
                      ) : (
                        <span className="up" style={{ fontWeight: 600 }}>
                          ≈ {fmtNum(r.estNetAfterFee, 6)} {r.asset}
                        </span>
                      )}
                    </td>
                    <td className="align-left">
                      <div className="row-flex" style={{ gap: 6 }}>
                        {r.reasons.map((reason, i) => (
                          <Pill key={i} kind={r.rank === 1 && i === 0 ? "up" : "info"}>
                            {reason}
                          </Pill>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Supported Chains Directory */}
      <Card
        flush
        title={`Supported Zipper Chains (${cfg?.chains?.length ?? 0})`}
        subtitle="Blockchains connected to the Polyester Zipper bridge."
        actions={
          <div className="row-flex" style={{ gap: 8 }}>
            <div className="input-group" style={{ width: 220 }}>
              <span className="input-icon">
                <IconSearch size={14} />
              </span>
              <input
                type="search"
                className="input with-icon"
                placeholder="Filter networks…"
                aria-label="Filter supported chains"
                value={chainQuery}
                onChange={(e) => setChainQuery(e.target.value)}
              />
            </div>
            {cfgContracts.length > 0 && (
              <button
                type="button"
                className={`btn sm ${showContracts ? "primary" : "ghost"}`}
                onClick={() => setShowContracts((v) => !v)}
              >
                {showContracts ? "Hide" : "Show"} Contracts ({cfgContracts.length})
              </button>
            )}
          </div>
        }
      >
        {cfgLoading && !cfg ? (
          <div style={{ padding: 16 }}>
            <Loading lines={6} />
          </div>
        ) : filteredChains.length === 0 ? (
          <EmptyState
            title="No networks match your filter"
            description="Clear the filter to see every supported network."
          />
        ) : (
          <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
            <table className="data">
              <thead>
                <tr>
                  <th className="align-left">Network Name</th>
                  <th className="align-left">Chain Code</th>
                  <th>Chain ID</th>
                  <th>Native Gas Token</th>
                  <th>Required Confirmations</th>
                  <th>Est. Finality Time</th>
                  <th className="align-left">Block Explorer</th>
                </tr>
              </thead>
              <tbody>
                {filteredChains.map((c) => (
                  <tr key={c.chainId}>
                    <td>
                      <strong>{c.name}</strong>
                    </td>
                    <td className="align-left mono muted">{c.code}</td>
                    <td className="mono">{c.chainId}</td>
                    <td>
                      <Pill>{c.nativeCurrencySymbol}</Pill>
                    </td>
                    <td className="mono">{c.requiredConfirmations}</td>
                    <td className="mono">~{c.confirmationTimeSeconds}s</td>
                    <td className="align-left">
                      <a
                        href={c.explorerUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="row-flex"
                        style={{ gap: 4, display: "inline-flex" }}
                      >
                        <span>{c.explorerUrl.replace(/^https?:\/\//, "")}</span>
                        <IconExternal size={12} />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Optional Protocol Smart Contracts Directory from Zipper Config */}
      {showContracts && cfgContracts.length > 0 && (
        <Card
          flush
          title={`Zipper Protocol Smart Contracts (${cfgContracts.length})`}
          subtitle="From the loaded public config; not independently verified by PolyTools"
        >
          <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
            <table className="data">
              <thead>
                <tr>
                  <th className="align-left">Contract Name</th>
                  <th className="align-left">Role / Type</th>
                  <th className="align-left">Contract Address</th>
                  <th>Copy</th>
                </tr>
              </thead>
              <tbody>
                {cfgContracts.map((ct) => (
                  <tr key={`${ct.name}-${ct.address}`}>
                    <td className="mono" style={{ fontWeight: 600 }}>
                      {ct.name}
                    </td>
                    <td className="align-left">
                      {ct.type ? <Pill kind="accent">{ct.type}</Pill> : <span className="faint">core</span>}
                    </td>
                    <td className="align-left mono muted">{ct.address}</td>
                    <td>
                      <CopyButton text={ct.address} label="Copy" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
