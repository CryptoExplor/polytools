/**
 * TOOL 9 — Transaction & Lifecycle Flow Explorer (/#/flow)
 * Investigates cross-chain deposits, withdrawals, and transfers using the
 * three Polyester read-only lifecycle endpoints:
 *   1. /api/flow/explain?txHash=... (explain_transaction)
 *   2. /api/flow/by-tx?txHash=...   (get_lifecycle_flow_by_tx)
 *   3. /api/flow?flowId=...         (get_lifecycle_flow)
 * Preserves identifiers verbatim and distinguishes unindexed/missing queries
 * from failed on-chain transactions.
 */

import { useMemo, useState } from "react";
import { api } from "../lib/api";
import {
  Card,
  CopyButton,
  EmptyState,
  JsonView,
  Loading,
  MetricCell,
  MetricStrip,
  PageHeader,
  Pill,
} from "../components/ui";
import { IconFlow, IconSearch, IconTrash } from "../components/icons";

type LookupMode = "explain" | "by-tx" | "flow";

interface HistoryEntry {
  mode: LookupMode;
  query: string;
  ts: number;
}

const MODE_LABELS: Record<
  LookupMode,
  { label: string; endpoint: string; placeholder: string; hint: string }
> = {
  explain: {
    label: "Explain Tx (by Hash)",
    endpoint: "/api/flow/explain",
    placeholder: "Paste source or destination tx hash (e.g. 0x… or chain txid)",
    hint: "Calls explain_transaction — returns a structured human-readable lifecycle summary.",
  },
  "by-tx": {
    label: "Raw Flow (by Tx Hash)",
    endpoint: "/api/flow/by-tx",
    placeholder: "Paste source or destination tx hash (e.g. 0x… or chain txid)",
    hint: "Calls get_lifecycle_flow_by_tx — looks up the raw lifecycle flow state by transaction hash.",
  },
  flow: {
    label: "Raw Flow (by Flow ID)",
    endpoint: "/api/flow",
    placeholder: "Paste exact base58 flow / intent ID",
    hint: "Calls get_lifecycle_flow — looks up lifecycle state by opaque base58 flowId (case-sensitive).",
  },
};

export default function Flow() {
  const [mode, setMode] = useState<LookupMode>("explain");
  const [input, setInput] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queriedInfo, setQueriedInfo] = useState<{
    mode: LookupMode;
    query: string;
    at: number;
  } | null>(null);
  const [showRawJson, setShowRawJson] = useState<boolean>(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  // Input validation without mutating the user's identifier
  const validation = useMemo(() => {
    const trimmed = input.trim();
    if (!trimmed) {
      return { valid: false, warning: null };
    }
    if (/\s/.test(trimmed)) {
      return {
        valid: false,
        warning: "Identifier contains whitespace characters. Remove spaces before tracing.",
      };
    }
    if ((mode === "explain" || mode === "by-tx") && trimmed.length < 8) {
      return {
        valid: true,
        warning:
          "Input looks shorter than a typical transaction hash — if this is a Polyester flow ID, switch to 'Raw Flow (by Flow ID)'.",
      };
    }
    if (mode === "flow" && trimmed.startsWith("0x") && trimmed.length >= 64) {
      return {
        valid: true,
        warning:
          "Input starts with 0x and looks like an EVM transaction hash — consider using 'Explain Tx (by Hash)' or 'Raw Flow (by Tx Hash)'.",
      };
    }
    return { valid: true, warning: null };
  }, [input, mode]);

  const executeLookup = async (overrideMode?: LookupMode, overrideQuery?: string) => {
    const activeMode = overrideMode ?? mode;
    const q = (overrideQuery ?? input).trim();
    if (!q || /\s/.test(q)) return;

    setBusy(true);
    setError(null);
    setResult(null);
    setQueriedInfo({ mode: activeMode, query: q, at: Date.now() });

    try {
      const res =
        activeMode === "explain"
          ? await api.flowExplain(q)
          : activeMode === "by-tx"
            ? await api.flowByTx(q)
            : await api.flow(q);
      setResult((res ?? {}) as Record<string, unknown>);
      setHistory((prev) => {
        const filtered = prev.filter(
          (h) => !(h.mode === activeMode && h.query === q),
        );
        return [{ mode: activeMode, query: q, ts: Date.now() }, ...filtered].slice(0, 8);
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Lifecycle lookup request failed");
    } finally {
      setBusy(false);
    }
  };

  // Extract top-level summary fields if present in the open-shaped payload
  const extractedSummary = useMemo(() => {
    if (!result) return null;
    const status =
      typeof result.status === "string"
        ? result.status
        : typeof result.state === "string"
          ? result.state
          : typeof result.lifecycleStatus === "string"
            ? result.lifecycleStatus
            : null;
    const flowId =
      typeof result.flowId === "string"
        ? result.flowId
        : typeof result.id === "string"
          ? result.id
          : null;
    const apiEnv = typeof result.apiEnv === "string" ? result.apiEnv : null;
    const note =
      typeof result.note === "string"
        ? result.note
        : typeof result.explanation === "string"
          ? result.explanation
          : typeof result.text === "string"
            ? result.text
            : null;
    return { status, flowId, apiEnv, note };
  }, [result]);

  return (
    <div className="page-stack">
      <PageHeader
        title="Transaction & Lifecycle Flow Explorer"
        badge={<Pill kind="accent">Read-Only Trace</Pill>}
        subtitle="Trace cross-chain Zipper deposits, withdrawals, and settlement flows from source-chain confirmation to exchange ledger credit or destination release."
      />

      <MetricStrip>
        <MetricCell
          label="Active Lookup Mode"
          value={MODE_LABELS[mode].label}
          sub={MODE_LABELS[mode].endpoint}
        />
        <MetricCell
          label="Identifier Handling"
          value="Exact Verbatim"
          sub="Base58 & hex case preserved"
        />
        <MetricCell
          label="Last Query Status"
          trend={
            busy
              ? undefined
              : error
                ? "warn"
                : result
                  ? "up"
                  : undefined
          }
          value={
            busy
              ? "Tracing…"
              : error
                ? "Not Found / Error"
                : result
                  ? extractedSummary?.status ?? "Payload Returned"
                  : "Idle"
          }
          sub={
            queriedInfo
              ? `${queriedInfo.query.slice(0, 18)}${queriedInfo.query.length > 18 ? "…" : ""}`
              : "Enter a txHash or flowId"
          }
        />
        <MetricCell
          label="Session Lookups"
          value={history.length}
          sub="Recent queries in this tab"
        />
      </MetricStrip>

      <Card
        title="Lifecycle Trace Query"
        subtitle={MODE_LABELS[mode].hint}
        actions={
          <div className="seg-group" role="group" aria-label="Lifecycle lookup mode">
            {(Object.keys(MODE_LABELS) as LookupMode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={`seg-btn ${mode === m ? "active" : ""}`}
                onClick={() => setMode(m)}
              >
                {MODE_LABELS[m].label}
              </button>
            ))}
          </div>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void executeLookup();
          }}
        >
          <div className="row-flex" style={{ gap: 8 }}>
            <div className="input-group" style={{ flex: 1, minWidth: 240 }}>
              <span className="input-icon">
                <IconSearch size={14} />
              </span>
              <input
                type="text"
                className="input with-icon mono"
                placeholder={MODE_LABELS[mode].placeholder}
                aria-label={MODE_LABELS[mode].label}
                value={input}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                onChange={(e) => setInput(e.target.value)}
              />
            </div>

            {input && (
              <button
                type="button"
                className="btn ghost"
                onClick={() => setInput("")}
                title="Clear input"
              >
                Clear
              </button>
            )}

            <button
              type="submit"
              className="btn primary"
              disabled={busy || !validation.valid}
            >
              <IconFlow size={14} />
              <span>{busy ? "Tracing…" : "Trace Lifecycle"}</span>
            </button>
          </div>
        </form>

        {validation.warning && (
          <div className="notice mt-2" style={{ padding: "8px 12px" }}>
            <span>{validation.warning}</span>
          </div>
        )}

        {history.length > 0 && (
          <div className="row-flex mt-3" style={{ justifyContent: "space-between" }}>
            <div className="row-flex" style={{ gap: 6 }}>
              <span className="faint">Recent queries:</span>
              {history.map((h) => (
                <button
                  key={`${h.mode}-${h.query}`}
                  type="button"
                  className="btn sm ghost mono"
                  onClick={() => {
                    setMode(h.mode);
                    setInput(h.query);
                    void executeLookup(h.mode, h.query);
                  }}
                >
                  [{h.mode}] {h.query.slice(0, 10)}
                  {h.query.length > 10 ? "…" : ""}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="btn sm ghost"
              onClick={() => setHistory([])}
            >
              <IconTrash size={12} /> Clear History
            </button>
          </div>
        )}
      </Card>

      {busy && (
        <Card title="Querying Polyester Lifecycle Index…">
          <Loading lines={6} />
        </Card>
      )}

      {error && (
        <Card
          title="Lookup Diagnostic"
          actions={<Pill kind="warn">No Lifecycle Record Returned</Pill>}
        >
          <div className="notice error mb-3">
            <div>
              <strong>Endpoint response:</strong> {error}
            </div>
          </div>
          <div className="faint" style={{ lineHeight: 1.65 }}>
            <strong>Important:</strong> A missing or failed lookup here does{" "}
            <strong>not</strong> mean your on-chain transaction reverted or failed. Common
            reasons a trace is not yet returned:
            <ul style={{ margin: "6px 0 0 18px", padding: 0 }}>
              <li>
                The transaction was just broadcast on the source chain and has not yet
                reached the required confirmation count for Zipper indexing.
              </li>
              <li>
                You pasted a base58 <code>flowId</code> while in{" "}
                <code>by Transaction Hash</code> mode (or vice-versa) — try switching the
                lookup mode above.
              </li>
              <li>
                Always verify the on-chain transaction status directly on the source
                network&apos;s block explorer (linked on the Zipper Routes page).
              </li>
            </ul>
          </div>
        </Card>
      )}

      {!busy && !error && result === null && (
        <Card>
          <EmptyState
            icon={<IconFlow size={18} />}
            title="Ready to trace a transaction or flow"
            description="Paste a deposit/withdrawal transaction hash from any supported Zipper chain or a Polyester base58 flow ID above to inspect its settlement lifecycle."
          />
        </Card>
      )}

      {result !== null && (
        <Card
          title="Lifecycle Trace Payload"
          subtitle={
            queriedInfo
              ? `Query: ${queriedInfo.query} (${MODE_LABELS[queriedInfo.mode].endpoint})`
              : undefined
          }
          actions={
            <div className="row-flex" style={{ gap: 8 }}>
              {extractedSummary?.apiEnv && (
                <Pill kind={extractedSummary.apiEnv === "testnet" ? "warn" : "up"}>
                  {extractedSummary.apiEnv}
                </Pill>
              )}
              {extractedSummary?.status && (
                <Pill kind="accent">status: {extractedSummary.status}</Pill>
              )}
              <button
                type="button"
                className="btn sm ghost"
                onClick={() => setShowRawJson((v) => !v)}
              >
                {showRawJson ? "Structured View" : "Raw JSON"}
              </button>
              <CopyButton
                text={JSON.stringify(result, null, 2)}
                label="Copy JSON"
              />
            </div>
          }
        >
          {extractedSummary?.note && (
            <div className="notice info mb-3">
              <div>
                <strong>Summary:</strong> {extractedSummary.note}
              </div>
            </div>
          )}

          {queriedInfo && (
            <div className="kv mb-2">
              <span className="k">Queried Identifier (verbatim)</span>
              <span className="v mono row-flex" style={{ justifyContent: "flex-end" }}>
                <span>{queriedInfo.query}</span>
                <CopyButton text={queriedInfo.query} label="Copy ID" />
              </span>
            </div>
          )}

          {showRawJson ? (
            <pre
              className="mono"
              style={{
                margin: 0,
                padding: 14,
                background: "var(--bg-shell)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-sm)",
                overflowX: "auto",
                fontSize: 12,
                lineHeight: 1.5,
              }}
            >
              {JSON.stringify(result, null, 2)}
            </pre>
          ) : (
            <JsonView value={result} />
          )}
        </Card>
      )}
    </div>
  );
}
