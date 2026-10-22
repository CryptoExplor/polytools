/**
 * TOOL 9 — Transaction lifecycle explorer.
 * Paste an external tx hash (deposit) or a lifecycle flow id and get the
 * exchange's own explanation of where the funds are — the "is my deposit
 * stuck?" self-service tool. Payloads are open-shaped, so we render the
 * structured JSON generically and it improves automatically as the
 * upstream explainers grow.
 */

import { useState } from "react";
import { api } from "../lib/api";
import { Card, JsonView, Loading, Pill } from "../components/ui";

type Mode = "tx" | "flow";

export default function Flow() {
  const [mode, setMode] = useState<Mode>("tx");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    const q = input.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = mode === "tx" ? await api.flowExplain(q) : await api.flow(q);
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "lookup failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid">
      <div className="notice info">
        Traces a <b>deposit / withdrawal / transfer</b> through its lifecycle:
        source-chain confirmation → credit → destination release. Uses the
        exchange's public, read-only lifecycle endpoints — no login required.
      </div>

      <Card title="Lookup">
        <div className="row-flex mb-3" style={{ gap: 6 }}>
          <button className={`btn sm ${mode === "tx" ? "primary" : "ghost"}`} onClick={() => setMode("tx")}>by transaction hash</button>
          <button className={`btn sm ${mode === "flow" ? "primary" : "ghost"}`} onClick={() => setMode("flow")}>by flow id</button>
        </div>
        <div className="row-flex">
          <input
            className="input mono"
            style={{ flex: 1 }}
            placeholder={mode === "tx" ? "0x… or external chain tx id" : "flow / intent id (base58)"}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void run()}
          />
          <button className="btn primary" disabled={busy || !input.trim()} onClick={() => void run()}>
            {busy ? "Tracing…" : "Trace"}
          </button>
        </div>
        <div className="faint mt-2">
          Tip: find your tx hash in the chain explorer linked from the Zipper routes page.
        </div>
      </Card>

      {error && <div className="notice">⚠ {error}. Try the other lookup mode, or verify the hash comes from a supported testnet chain.</div>}
      {busy && <Card title="Tracing…"><Loading lines={5} /></Card>}

      {result !== null && (
        <Card
          title="Lifecycle result"
          actions={<Pill kind="accent">{(result as { apiEnv?: string }).apiEnv ?? "api"}</Pill>}
        >
          <JsonView value={result} />
        </Card>
      )}
    </div>
  );
}
