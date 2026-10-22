/**
 * TOOL 10 — API key vault (the Portfolio foundation).
 *
 * What works TODAY: generate/import Ed25519 keypairs entirely in-browser
 * (WebCrypto), export the PUBLIC key for registration in your Polyester
 * account's API-key settings, sign canonical strings, and wipe everything.
 *
 * What unlocks AT MAINNET: private REST calls (balances/orders) signed with
 * these keys — the docs define the three headers (X-API-KEY-ID,
 * X-API-TIMESTAMP, X-API-SIGNATURE); the canonical-string assembly lands
 * here once the private endpoints are publicly documented/announced.
 *
 * Security model: keys never leave this browser. localStorage only. No
 * analytics, no telemetry, no server. Verify by reading this file.
 */

import { useState } from "react";
import { vault } from "@poly/core";
import { Card, Pill } from "../components/ui";

export default function Portfolio() {
  const [keys, setKeys] = useState(() => vault.loadVault());
  const [label, setLabel] = useState("my-api-key");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const supported = vault.ed25519Supported();

  const refresh = () => setKeys(vault.loadVault());

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      await vault.generateVaultKey(label.trim() || "key");
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "key generation failed (insecure context?)");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text: string, tag: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(tag);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="grid">
      <div className="notice info">
        <b>How this becomes the Portfolio tool at mainnet:</b> register the public key below in
        your Polyester account (API settings → create key, paste this public key), and this page
        will sign read-only private REST calls locally. The signing code is already written and
        the keys below are production-grade Ed25519 — the only thing pending is the public
        documentation of the private endpoint paths.
      </div>

      {!supported && (
        <div className="notice">⚠ WebCrypto Ed25519 needs a secure context (HTTPS or localhost) and a modern browser.</div>
      )}
      {error && <div className="notice">⚠ {error}</div>}

      <div className="grid cols-2">
        <Card title="Generate a new keypair">
          <div className="field">
            <label>Key label (this becomes your X-API-KEY-ID)</label>
            <input className="input mono" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <button className="btn primary" onClick={() => void generate()} disabled={busy || !supported}>
            {busy ? "Generating…" : "⚡ Generate Ed25519 keypair"}
          </button>
          <div className="faint mt-2">
            Generated with WebCrypto. The private key is stored only in this browser's
            localStorage and can be wiped below at any time.
          </div>
        </Card>

        <Card title="Vault status">
          <div className="kv"><span className="k">Stored keys</span><span className="v">{keys.length}</span></div>
          <div className="kv"><span className="k">Storage</span><span className="v mono">localStorage (this browser only)</span></div>
          <div className="kv"><span className="k">Algorithm</span><span className="v mono">Ed25519 (WebCrypto)</span></div>
          <div className="kv"><span className="k">Telemetry</span><span className="v">none — verify in source</span></div>
          <div className="mt-2">
            <button
              className="btn sm ghost"
              style={{ borderColor: "var(--down)", color: "var(--down)" }}
              onClick={() => { if (confirm("Delete ALL stored keys from this browser?")) { vault.wipeVault(); refresh(); } }}
            >
              🗑 wipe vault
            </button>
          </div>
        </Card>
      </div>

      <Card title={`Stored keys · ${keys.length}`}>
        {!keys.length && <div className="faint">No keys yet — generate one above. It takes ~100ms.</div>}
        {keys.map((k) => (
          <div className="card mb-2" key={k.keyId} style={{ background: "var(--panel-2)" }}>
            <div className="row-flex" style={{ justifyContent: "space-between" }}>
              <div className="row-flex">
                <Pill kind="accent">{k.keyId}</Pill>
                <span className="faint">created {new Date(k.createdAt).toLocaleString()}</span>
              </div>
              <button
                className="btn sm ghost"
                onClick={() => { vault.deleteVaultKey(k.keyId); refresh(); }}
              >
                delete
              </button>
            </div>
            <div className="field mt-2 mb-0">
              <label>Public key (base64, safe to share — register this in your Polyester account)</label>
              <div className="row-flex">
                <input className="input mono" readOnly value={k.publicKeyB64} onFocus={(e) => e.target.select()} />
                <button className="btn" onClick={() => void copy(k.publicKeyB64, k.keyId)}>
                  {copied === k.keyId ? "✓ copied" : "copy"}
                </button>
              </div>
            </div>
          </div>
        ))}
      </Card>

      <Card title="Mainnet wiring checklist (for developers)">
        <div className="faint" style={{ lineHeight: 1.8 }}>
          1. Register a vault public key in your Polyester account API settings.<br />
          2. Confirm private REST paths and the canonical signing string in
          developer-docs → authentication-security → Ed25519 API keys.<br />
          3. Call <code className="mono">vault.signRequest(entry, canonical)</code> and attach
          the returned <code className="mono">X-API-KEY-ID / X-API-TIMESTAMP / X-API-SIGNATURE</code> headers.<br />
          4. Keep requests read-only (balances/orders) — this UI is analytics-first by design.
          All of the above lives in <code className="mono">packages/core/src/keys.ts</code>.
        </div>
      </Card>
    </div>
  );
}
