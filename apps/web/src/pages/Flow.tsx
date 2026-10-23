/**
 * TOOL 9 — Transaction & Lifecycle Flow Explorer (/#/flow)
 * Investigates cross-chain deposits, withdrawals, and transfers using the
 * three Polyester read-only lifecycle endpoints:
 *   1. /api/flow/explain?txHash=... (explain_transaction)
 *   2. /api/flow/by-tx?txHash=...   (get_lifecycle_flow_by_tx)
 *   3. /api/flow?flowId=...         (get_lifecycle_flow)
 *
 * Preserves identifiers verbatim, syncs shareable URL search params (?mode=&q=),
 * and cleanly distinguishes:
 *   - HTTP 400 invalid argument / validation errors (ErrorBox kind="invalid")
 *   - HTTP 200 found === false ("No public flow indexed" EmptyState)
 *   - HTTP 200 found === true (structured summary + explanation + JSON inspector)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError, api } from "../lib/api";
import {
  Card,
  CopyButton,
  EmptyState,
  ErrorBox,
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
    label: "Explain",
    endpoint: "/api/flow/explain",
    placeholder: "Paste 0x… transaction hash (66 chars)",
    hint: "Calls explain_transaction — returns a plain-English lifecycle summary and matched flows.",
  },
  "by-tx": {
    label: "Find by tx hash",
    endpoint: "/api/flow/by-tx",
    placeholder: "Paste 0x… transaction hash (66 chars)",
    hint: "Calls get_lifecycle_flow_by_tx — looks up raw lifecycle flow records by transaction hash.",
  },
  flow: {
    label: "Find by flow id",
    endpoint: "/api/flow",
    placeholder: "Paste UUID or exact flow identifier",
    hint: "Calls get_lifecycle_flow — looks up lifecycle state by exact flowId (case-sensitive).",
  },
};

function parseMode(raw: string | null): LookupMode {
  if (raw === "by-tx" || raw === "flow" || raw === "explain") return raw;
  return "explain";
}

export default function Flow() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialMode = parseMode(searchParams.get("mode"));
  const initialQ = searchParams.get("q") ?? "";

  const [mode, setMode] = useState<LookupMode>(initialMode);
  const [input, setInput] = useState<string>(initialQ);
  const [busy, setBusy] = useState<boolean>(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<"invalid" | "unavailable">("unavailable");
  const [queriedInfo, setQueriedInfo] = useState<{
    mode: LookupMode;
    query: string;
    at: number;
  } | null>(null);
  const [showRawJson, setShowRawJson] = useState<boolean>(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const autoRanRef = useRef<string | null>(null);

  // Input validation without mutating the user's identifier
  const validation = useMemo(() => {
    const trimmed = input.trim();
    if (!trimmed) {
      return { valid: false, warning: null };
    }
    if (/\s/.test(trimmed)) {
      return {
        valid: false,
        warning:
          "Identifier contains whitespace characters. Remove spaces before tracing.",
      };
    }
    if ((mode === "explain" || mode === "by-tx") && trimmed.length < 8) {
      return {
        valid: true,
        warning:
          "Input looks shorter than a typical transaction hash — if this is a Polyester flow ID, switch to 'Find by flow id'.",
      };
    }
    if (mode === "flow" && trimmed.startsWith("0x") && trimmed.length >= 64) {
      return {
        valid: true,
        warning:
          "Input starts with 0x and looks like an EVM transaction hash — consider using 'Explain' or 'Find by tx hash'.",
      };
    }
    return { valid: true, warning: null };
  }, [input, mode]);

  const executeLookup = useCallback(
    async (
      overrideMode?: LookupMode,
      overrideQuery?: string,
      syncUrl = true,
    ) => {
      const activeMode = overrideMode ?? mode;
      const q = (overrideQuery ?? input).trim();
      if (!q || /\s/.test(q)) return;

      if (syncUrl) {
        setSearchParams({ mode: activeMode, q }, { replace: true });
      }

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
          return [{ mode: activeMode, query: q, ts: Date.now() }, ...filtered].slice(
            0,
            8,
          );
        });
      } catch (e) {
        const msg =
          e instanceof Error ? e.message : "Lifecycle lookup request failed";
        const isInvalid =
          (e instanceof ApiError && e.status === 400) ||
          /^(invalid_argument|validation error|invalid )/i.test(msg);
        setErrorKind(isInvalid ? "invalid" : "unavailable");
        setError(msg);
      } finally {
        setBusy(false);
      }
    },
    [input, mode, setSearchParams],
  );

  // Run lookup automatically if URL has ?q=... on initial load
  useEffect(() => {
    const qParam = searchParams.get("q")?.trim();
    const mParam = parseMode(searchParams.get("mode"));
    if (qParam && autoRanRef.current !== `${mParam}:${qParam}`) {
      autoRanRef.current = `${mParam}:${qParam}`;
      setMode(mParam);
      setInput(qParam);
      void executeLookup(mParam, qParam, false);
    }
  }, [searchParams, executeLookup]);

  // Extract top-level structured fields
  const extractedSummary = useMemo(() => {
    if (!result) return null;
    const found =
      typeof result.found === "boolean"
        ? result.found
        : typeof result.matchCount === "number"
          ? result.matchCount > 0
          : result.flow !== null && result.flow !== undefined;
    const status =
      typeof result.status === "string"
        ? result.status
        : typeof result.state === "string"
          ? result.state
          : typeof result.lifecycleStatus === "string"
            ? result.lifecycleStatus
            : found
              ? "Indexed"
              : "Not Found";
    const primaryFlowId =
      typeof result.primaryFlowId === "string"
        ? result.primaryFlowId
        : typeof result.flowId === "string"
          ? result.flowId
          : typeof result.id === "string"
            ? result.id
            : null;
    const apiEnv = typeof result.apiEnv === "string" ? result.apiEnv : null;
    const summary =
      typeof result.summary === "string"
        ? result.summary
        : typeof result.note === "string"
          ? result.note
          : null;
    const explanation =
      typeof result.explanation === "string"
        ? result.explanation
        : typeof result.text === "string"
          ? result.text
          : null;
    const matchCount =
      typeof result.matchCount === "number" ? result.matchCount : null;
    return {
      found,
      status,
      primaryFlowId,
      apiEnv,
      summary,
      explanation,
      matchCount,
    };
  }, [result]);

  return (
    <div className="page-stack">
      <PageHeader
        title="Track a Deposit or Withdrawal"
        badge={<Pill kind="accent">Read-Only Trace</Pill>}
        subtitle="Paste a public transaction hash or Polyester flow ID to see what stage a deposit or withdrawal is in."
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
          sub="Base58, UUID & hex case preserved"
        />
        <MetricCell
          label="Last Query Status"
          trend={
            busy
              ? undefined
              : error
                ? "warn"
                : result
                  ? extractedSummary?.found
                    ? "up"
                    : "flat"
                  : undefined
          }
          value={
            busy
              ? "Tracing…"
              : error
                ? errorKind === "invalid"
                  ? "Invalid Format (400)"
                  : "Upstream Error"
                : result
                  ? extractedSummary?.found
                    ? extractedSummary.status
                    : "Not Indexed"
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
                onClick={() => {
                  setInput("");
                  setError(null);
                  setResult(null);
                }}
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
                  [{MODE_LABELS[h.mode].label}] {h.query.slice(0, 10)}
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

      {/* Invalid format (400) or upstream failure (502) */}
      {error && (
        <ErrorBox
          error={error}
          kind={errorKind}
          onRetry={errorKind === "unavailable" ? () => void executeLookup() : undefined}
        />
      )}

      {!busy && !error && result === null && (
        <Card>
          <EmptyState
            icon={<IconFlow size={18} />}
            title="Ready to trace a transaction or flow"
            description="Paste a deposit/withdrawal transaction hash from any supported Zipper chain or a Polyester flow ID above to inspect its settlement lifecycle."
          />
        </Card>
      )}

      {/* HTTP 200 with found === false (UX-T9-01 / A4) */}
      {result !== null && extractedSummary?.found === false && (
        <Card
          title="Lookup Result"
          subtitle={
            queriedInfo
              ? `Queried verbatim: ${queriedInfo.query} (${MODE_LABELS[queriedInfo.mode].endpoint})`
              : undefined
          }
          actions={
            <div className="row-flex" style={{ gap: 8 }}>
              {extractedSummary.apiEnv && (
                <Pill kind="warn">{extractedSummary.apiEnv}</Pill>
              )}
              <button
                type="button"
                className="btn sm ghost"
                onClick={() => setShowRawJson((v) => !v)}
              >
                {showRawJson ? "Hide Raw JSON" : "Inspect Raw JSON"}
              </button>
            </div>
          }
        >
          <EmptyState
            icon={<IconFlow size={18} />}
            title="No public flow indexed for this identifier"
            description="Polyester has no public flow for this id. That is not the same as a failed transfer."
          />
          {extractedSummary.summary && (
            <div className="notice mt-2">
              <div>
                <strong>Summary:</strong> {extractedSummary.summary}
              </div>
            </div>
          )}
          {showRawJson && (
            <pre
              className="mono mt-3"
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
          )}
        </Card>
      )}

      {/* HTTP 200 with found !== false */}
      {result !== null && extractedSummary?.found !== false && (
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
          {extractedSummary?.summary && (
            <div className="notice info mb-3">
              <div>
                <strong>Summary:</strong> {extractedSummary.summary}
              </div>
            </div>
          )}
          {extractedSummary?.explanation &&
            extractedSummary.explanation !== extractedSummary.summary && (
              <div className="notice mb-3">
                <div>
                  <strong>Explanation:</strong> {extractedSummary.explanation}
                </div>
              </div>
            )}
          {extractedSummary?.primaryFlowId && (
            <div className="kv mb-2">
              <span className="k">Primary Flow ID</span>
              <span className="v mono row-flex" style={{ justifyContent: "flex-end" }}>
                <span>{extractedSummary.primaryFlowId}</span>
                <CopyButton text={extractedSummary.primaryFlowId} label="Copy Flow ID" />
              </span>
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
