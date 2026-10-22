/**
 * TOOL 10 — Client-Side Ed25519 Key Vault & Portfolio Foundation (/#/portfolio)
 *
 * Security boundaries enforced:
 *  - Private keys (privateKeyB64) are NEVER rendered in the DOM, logged,
 *    copied to clipboard, or transmitted over the network.
 *  - All cryptography (Ed25519 keypair generation & request signing) executes
 *    exclusively in-browser via WebCrypto (`@poly/core` vault module).
 *  - Destructive actions (deleting a key, overwriting a keyId, or wiping the
 *    vault) require explicit modal confirmation (`ConfirmDialog`).
 */

import { useEffect, useState } from "react";
import { vault } from "@poly/core";

type VaultKey = vault.VaultKey;
import {
  Card,
  ConfirmDialog,
  CopyButton,
  EmptyState,
  MetricCell,
  MetricStrip,
  PageHeader,
  Pill,
  TermTip,
} from "../components/ui";
import { IconAlert, IconKey, IconTrash, IconVault } from "../components/icons";

type PendingConfirm =
  | { kind: "delete"; keyId: string }
  | { kind: "wipe" }
  | { kind: "overwrite"; keyId: string }
  | null;

export default function Portfolio() {
  const [keys, setKeys] = useState<VaultKey[]>(() => vault.loadVault());
  const [label, setLabel] = useState<string>("my-readonly-key");
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null);

  // Interactive Request Signer state (uses vault.signRequest & vault.signedHeaders)
  const [selectedKeyId, setSelectedKeyId] = useState<string>("");
  const [canonicalInput, setCanonicalInput] = useState<string>("GET/api/v1/account");
  const [signingBusy, setSigningBusy] = useState<boolean>(false);
  const [signedOutput, setSignedOutput] = useState<{
    keyId: string;
    timestamp: string;
    signatureB64: string;
    headers: Record<string, string>;
  } | null>(null);

  const supported = vault.ed25519Supported();

  const refreshVault = () => {
    const loaded = vault.loadVault();
    setKeys(loaded);
  };

  useEffect(() => {
    if (keys.length && !keys.some((k) => k.keyId === selectedKeyId)) {
      setSelectedKeyId(keys[0].keyId);
    } else if (!keys.length) {
      setSelectedKeyId("");
      setSignedOutput(null);
    }
  }, [keys, selectedKeyId]);

  const executeGenerate = async (targetLabel: string) => {
    setBusy(true);
    setError(null);
    try {
      await vault.generateVaultKey(targetLabel);
      refreshVault();
      setSelectedKeyId(targetLabel);
    } catch {
      setError(
        "WebCrypto Ed25519 key generation failed. Ensure you are running in a secure context (HTTPS or localhost) on a modern browser.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleGenerateClick = () => {
    const clean = label.trim() || "key";
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(clean)) {
      setError(
        "Key label must be 1–64 characters using letters, numbers, hyphens, underscores, or dots.",
      );
      return;
    }
    if (keys.some((k) => k.keyId === clean)) {
      setPendingConfirm({ kind: "overwrite", keyId: clean });
      return;
    }
    void executeGenerate(clean);
  };

  const handleSignRequest = async () => {
    const entry = keys.find((k) => k.keyId === selectedKeyId);
    if (!entry || !canonicalInput.trim()) return;
    setSigningBusy(true);
    setError(null);
    try {
      const sig = await vault.signRequest(entry, canonicalInput);
      const headers = vault.signedHeaders(sig);
      setSignedOutput({
        keyId: sig.keyId,
        timestamp: sig.timestamp,
        signatureB64: sig.signatureB64,
        headers,
      });
    } catch {
      setError("Failed to sign payload with the selected Ed25519 key.");
    } finally {
      setSigningBusy(false);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        title="Ed25519 Key Vault & Portfolio Foundation"
        badge={
          <Pill kind={supported ? "up" : "warn"}>
            {supported ? "WebCrypto Ed25519 Ready" : "WebCrypto Unavailable"}
          </Pill>
        }
        subtitle="Generate client-side Ed25519 API keypairs, export public keys for Polyester account registration, and sign canonical request strings locally."
      />

      <MetricStrip>
        <MetricCell
          label="Stored Keypairs"
          value={keys.length}
          sub="In this browser's vault"
        />
        <MetricCell
          label="Cryptographic Primitive"
          value="Ed25519"
          sub="Native WebCrypto ( SubtleCrypto )"
        />
        <MetricCell
          label="Secret Persistence"
          value="localStorage Only"
          sub="Never transmitted or logged"
        />
        <MetricCell
          label="Private Portfolio Feed"
          trend="warn"
          value="Phase 2 Pending"
          sub="Awaiting public private-REST docs"
        />
      </MetricStrip>

      {!supported && (
        <div className="notice error" role="alert">
          <div className="row-flex" style={{ gap: 10 }}>
            <IconAlert size={16} />
            <span>
              <strong>WebCrypto Ed25519 Not Detected:</strong> Key generation and signing
              require a secure browser context (`https://` or `http://localhost`) and a
              browser with native Ed25519 WebCrypto support.
            </span>
          </div>
        </div>
      )}

      {error && (
        <div className="notice error" role="alert">
          <span>⚠ {error}</span>
          <button type="button" className="btn sm ghost" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {/* Honest Capabilities & Security Boundaries Matrix */}
      <div className="grid cols-2">
        <Card
          title="What Works Today (Implemented & Active)"
          actions={<Pill kind="up">Active in Browser</Pill>}
        >
          <div className="kv">
            <span className="k">Ed25519 Keypair Generation</span>
            <span className="v up">✓ Native WebCrypto</span>
          </div>
          <div className="kv">
            <span className="k">Public Key Export (Base64 raw 32-byte)</span>
            <span className="v up">✓ Ready for API registration</span>
          </div>
          <div className="kv">
            <span className="k">Local Request Signing (`signRequest`)</span>
            <span className="v up">✓ Generates `X-API-*` headers</span>
          </div>
          <div className="kv">
            <span className="k">Instant Key Deletion & Full Vault Wipe</span>
            <span className="v up">✓ Immediate local removal</span>
          </div>
        </Card>

        <Card
          title="Current Limitations & Recovery Boundaries"
          actions={<Pill kind="warn">Important Disclosures</Pill>}
        >
          <div className="kv">
            <span className="k">Private REST Portfolio Balances/Orders</span>
            <span className="v warn">Blocked on public endpoint spec</span>
          </div>
          <div className="kv">
            <span className="k">Key Backup / Cloud Sync / Recovery</span>
            <span className="v">Not supported (no recovery if wiped)</span>
          </div>
          <div className="kv">
            <span className="k">Storage Encryption at Rest</span>
            <span className="v">Unencrypted browser localStorage</span>
          </div>
          <div className="kv">
            <span className="k">Order Placement / Withdrawals</span>
            <span className="v">Never — PolyTools is strictly read-only</span>
          </div>
        </Card>
      </div>

      {/* Key Generation + Vault Status */}
      <div className="grid cols-2">
        <Card
          title="1. Generate New Ed25519 Keypair"
          subtitle="Creates a fresh Ed25519 keypair in browser memory and stores it in localStorage."
        >
          <div className="field">
            <label htmlFor="vault-key-label">
              <span>Key Label (`X-API-KEY-ID`)</span>
              <span className="mono faint">1–64 chars (A-Z, 0-9, -, _, .)</span>
            </label>
            <input
              id="vault-key-label"
              type="text"
              className="input mono"
              value={label}
              maxLength={64}
              spellCheck={false}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleGenerateClick();
                }
              }}
            />
          </div>

          <button
            type="button"
            className="btn primary"
            onClick={handleGenerateClick}
            disabled={busy || !supported}
          >
            <IconKey size={14} />
            <span>{busy ? "Generating Keypair…" : "Generate Ed25519 Keypair"}</span>
          </button>

          <div className="faint mt-2">
            Only the <strong>public key</strong> is ever displayed below. The private key
            remains sealed inside `localStorage` (`poly-tools:vault:v1`) for local
            WebCrypto signing and is never logged or exported.
          </div>
        </Card>

        <Card
          title="2. Vault Security & Storage Status"
          subtitle="Inspect storage state or permanently wipe all local key material."
        >
          <div className="kv">
            <span className="k">Stored Keys Count</span>
            <span className="v mono">{keys.length}</span>
          </div>
          <div className="kv">
            <span className="k">Browser Storage Slot</span>
            <span className="v mono">localStorage[&quot;poly-tools:vault:v1&quot;]</span>
          </div>
          <div className="kv">
            <span className="k">Network Transmission</span>
            <span className="v up">Zero outbound requests</span>
          </div>
          <div className="kv">
            <span className="k">Recovery Policy</span>
            <span className="v warn">Irreversible once deleted</span>
          </div>

          <div className="mt-3 between">
            <span className="faint">
              Wiping removes all stored keypairs from this browser immediately.
            </span>
            <button
              type="button"
              className="btn sm danger"
              disabled={keys.length === 0}
              onClick={() => setPendingConfirm({ kind: "wipe" })}
            >
              <IconTrash size={13} />
              <span>Wipe Entire Vault</span>
            </button>
          </div>
        </Card>
      </div>

      {/* Stored Keys List */}
      <Card
        title={`3. Stored Public Keys (${keys.length})`}
        subtitle="Register the Base64 Public Key below in your Polyester account's API settings."
      >
        {keys.length === 0 ? (
          <EmptyState
            icon={<IconVault size={18} />}
            title="No Ed25519 keys in vault"
            description="Generate a keypair above to obtain a Base64 public key and unlock the local request signer."
          />
        ) : (
          <div className="grid" style={{ gap: 10 }}>
            {keys.map((k) => (
              <div
                key={k.keyId}
                className="card"
                style={{ background: "var(--bg-elevated)", padding: "12px 14px" }}
              >
                <div className="between mb-2">
                  <div className="row-flex" style={{ gap: 8 }}>
                    <Pill kind="accent">{k.keyId}</Pill>
                    <span className="faint mono" style={{ fontSize: 11.5 }}>
                      Created {new Date(k.createdAt).toISOString().replace("T", " ").slice(0, 19)} UTC
                    </span>
                  </div>
                  <div className="row-flex" style={{ gap: 6 }}>
                    <button
                      type="button"
                      className="btn sm ghost"
                      onClick={() => setSelectedKeyId(k.keyId)}
                    >
                      Use in Signer
                    </button>
                    <button
                      type="button"
                      className="btn sm danger"
                      onClick={() => setPendingConfirm({ kind: "delete", keyId: k.keyId })}
                    >
                      <IconTrash size={12} /> Delete Key
                    </button>
                  </div>
                </div>

                <div className="field mb-0">
                  <label htmlFor={`pub-key-${k.keyId}`}>
                    <span>Public Key (Base64 raw 32-byte · safe to share)</span>
                    <span className="faint">Private key hidden & non-exportable</span>
                  </label>
                  <div className="row-flex" style={{ gap: 8 }}>
                    <input
                      id={`pub-key-${k.keyId}`}
                      type="text"
                      className="input mono"
                      style={{ flex: 1 }}
                      readOnly
                      value={k.publicKeyB64}
                      onFocus={(e) => e.target.select()}
                    />
                    <CopyButton
                      text={k.publicKeyB64}
                      label="Copy Public Key"
                      size="md"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Interactive Request Signer (Uses vault.signRequest & vault.signedHeaders) */}
      <Card
        title="4. Interactive Local Request Signer"
        subtitle="Test Ed25519 header signing in-browser using vault.signRequest() and vault.signedHeaders()."
        footer={
          <span>
            Signs <code className="mono">{`$\{canonicalString}$\{timestamp}`}</code> with
            your selected Ed25519 keypair in WebCrypto without exposing the private key.
          </span>
        }
      >
        {keys.length === 0 ? (
          <div className="faint">
            Generate at least one keypair above to test local Ed25519 request signing.
          </div>
        ) : (
          <>
            <div className="grid cols-2">
              <div className="field">
                <label htmlFor="signer-key-select">Signing Key (`X-API-KEY-ID`)</label>
                <select
                  id="signer-key-select"
                  className="select mono"
                  value={selectedKeyId}
                  onChange={(e) => setSelectedKeyId(e.target.value)}
                >
                  {keys.map((k) => (
                    <option key={k.keyId} value={k.keyId}>
                      {k.keyId}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="signer-canonical-input">
                  <TermTip
                    label="Canonical Request String"
                    tip="Method + Path + Body string to sign before appending the millisecond timestamp"
                  />
                </label>
                <div className="row-flex" style={{ gap: 8 }}>
                  <input
                    id="signer-canonical-input"
                    type="text"
                    className="input mono"
                    style={{ flex: 1 }}
                    value={canonicalInput}
                    onChange={(e) => setCanonicalInput(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn primary"
                    disabled={signingBusy || !selectedKeyId || !canonicalInput.trim()}
                    onClick={() => void handleSignRequest()}
                  >
                    {signingBusy ? "Signing…" : "Sign Payload"}
                  </button>
                </div>
              </div>
            </div>

            {signedOutput && (
              <div
                className="mt-2"
                style={{
                  padding: 12,
                  background: "var(--bg-shell)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-sm)",
                }}
              >
                <div className="between mb-2">
                  <strong style={{ fontSize: 12 }}>
                    Generated Authentication Headers
                  </strong>
                  <CopyButton
                    text={JSON.stringify(signedOutput.headers, null, 2)}
                    label="Copy All Headers (JSON)"
                  />
                </div>
                {Object.entries(signedOutput.headers).map(([hdr, val]) => (
                  <div key={hdr} className="kv">
                    <span className="k mono">{hdr}</span>
                    <span className="v mono row-flex" style={{ justifyContent: "flex-end" }}>
                      <span>{val}</span>
                      <CopyButton text={val} label="Copy" />
                    </span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Card>

      {/* Accessible Confirmation Dialog for Destructive Actions */}
      <ConfirmDialog
        open={pendingConfirm !== null}
        title={
          pendingConfirm?.kind === "wipe"
            ? "Permanently Wipe Key Vault?"
            : pendingConfirm?.kind === "overwrite"
              ? `Overwrite Existing Key "${pendingConfirm.keyId}"?`
              : `Delete Key "${pendingConfirm?.keyId ?? ""}"?`
        }
        message={
          pendingConfirm?.kind === "wipe"
            ? "This will permanently erase all stored Ed25519 keypairs from this browser's localStorage. Because PolyTools never backs up or exports private keys, wiped keys cannot be recovered."
            : pendingConfirm?.kind === "overwrite"
              ? `A keypair labeled "${pendingConfirm.keyId}" already exists in this browser. Generating a new keypair with the same label will permanently replace the existing keypair.`
              : `This will permanently delete the Ed25519 keypair "${
                  pendingConfirm?.keyId ?? ""
                }" from browser storage. This action cannot be undone.`
        }
        confirmLabel={
          pendingConfirm?.kind === "wipe"
            ? "Yes, Wipe All Keys"
            : pendingConfirm?.kind === "overwrite"
              ? "Overwrite Keypair"
              : "Delete Keypair"
        }
        danger
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          const action = pendingConfirm;
          setPendingConfirm(null);
          if (!action) return;
          if (action.kind === "wipe") {
            vault.wipeVault();
            refreshVault();
          } else if (action.kind === "delete") {
            vault.deleteVaultKey(action.keyId);
            refreshVault();
          } else if (action.kind === "overwrite") {
            void executeGenerate(action.keyId);
          }
        }}
      />
    </div>
  );
}
