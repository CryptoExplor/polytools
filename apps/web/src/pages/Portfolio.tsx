/**
 * TOOL 10 — Client-Side Ed25519 Key Vault & Portfolio Foundation (/#/portfolio)
 *
 * Security boundaries enforced:
 *  - Private keys (privateKeyB64) are NEVER rendered in the DOM, logged,
 *    copied to clipboard, or transmitted over the network.
 *  - All cryptography (Ed25519 keypair generation & request signing) executes
 *    exclusively in-browser via WebCrypto (`@poly/core` vault module).
 *  - Signing implements the official 5-field newline-separated canonical string:
 *      <timestamp_ms>\n<UPPERCASE_METHOD>\n<path>\n<canonical_query>\n<body_sha256_hex>
 *  - Destructive actions (deleting a key, overwriting a keyId, or wiping the
 *    vault) require explicit modal confirmation (`ConfirmDialog`).
 */

import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { NETWORKS, vault } from "@poly/core";

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
import { IconAlert, IconExternal, IconKey, IconTrash, IconVault } from "../components/icons";

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

  // Interactive 5-field Request Signer state (SEC-01 & SEC-07)
  const [selectedKeyId, setSelectedKeyId] = useState<string>("");
  const [registeredKeyId, setRegisteredKeyId] = useState<string>("");
  const [httpMethod, setHttpMethod] = useState<"GET" | "POST" | "DELETE">("GET");
  const [reqPath, setReqPath] = useState<string>("/v1/account/balances");
  const [reqQuery, setReqQuery] = useState<string>("asset=USDT&limit=10");
  const [reqBody, setReqBody] = useState<string>("");
  const [signingBusy, setSigningBusy] = useState<boolean>(false);
  const [signedOutput, setSignedOutput] = useState<{
    keyId: string;
    label: string;
    isRegisteredKeyId: boolean;
    timestamp: string;
    canonicalString: string;
    bodySha256Hex: string;
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
    if (!entry || !reqPath.trim()) return;
    setSigningBusy(true);
    setError(null);
    try {
      const sig = await vault.signRequest(entry, {
        method: httpMethod,
        path: reqPath,
        query: reqQuery,
        body: httpMethod === "GET" ? "" : reqBody,
        apiKeyId: registeredKeyId.trim() || undefined,
      });
      const headers = vault.signedHeaders(sig);
      setSignedOutput({
        ...sig,
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
        subtitle="Creates an Ed25519 keypair in your browser and keeps it in this browser's localStorage. This is not a Polyester login and not a funding wallet. No request is sent to Polyester."
        actions={
          <Link to="/sdk" className="btn sm primary">
            <IconKey size={13} />
            <span>SDK &amp; Bot Quickstart (TS · Python · Rust)</span>
          </Link>
        }
      />

      {/* Explicit Beginner Boundary Notice (UX-T10-01) */}
      <div className="notice warn" role="note">
        <div>
          <strong>For developers &amp; API users only:</strong> This is not a Polyester login
          and not a funding wallet. It only stores a local Ed25519 keypair in your browser.
          No request is sent to Polyester. Your local label is <strong>not</strong> a
          Polyester key ID until you register the public key in the official Polyester app or
          via <code className="mono">POST /v1/auth/api-keys</code> (which returns a
          server-assigned <code className="mono">ak_...</code> keyId).
        </div>
      </div>

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
          label="Canonical Format"
          trend="up"
          value="5-Line Spec"
          sub="ts · method · path · query · sha256"
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
            <span className="k">5-Field Canonical Request Signing</span>
            <span className="v up">✓ SHA-256 body + RFC 3986 query</span>
          </div>
          <div className="kv">
            <span className="k">Instant Key Deletion &amp; Full Vault Wipe</span>
            <span className="v up">✓ Immediate local removal</span>
          </div>
        </Card>

        <Card
          title="Current Limitations & Security Best Practices"
          actions={<Pill kind="warn">Important Disclosures</Pill>}
        >
          <div className="kv">
            <span className="k">Local Label vs Polyester Key ID</span>
            <span className="v warn">Register pubkey to receive `ak_...` ID</span>
          </div>
          <div className="kv">
            <span className="k">Storage Encryption at Rest</span>
            <span className="v">Unencrypted browser localStorage</span>
          </div>
          <div className="kv">
            <span className="k">API Key IP Allowlists (Recommended)</span>
            <span className="v">
              <a
                href={`${NETWORKS.testnet.docsUrl}/developer-docs/authentication-security/api-key-ip-allowlists`}
                target="_blank"
                rel="noreferrer"
              >
                Official IP Allowlist Guide <IconExternal size={11} />
              </a>
            </span>
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
              <span>Local Vault Label (not yet a Polyester `ak_...` keyId)</span>
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
        subtitle="Register the Base64 Public Key below in your Polyester account's API settings to receive an official ak_... keyId."
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
                    <Pill kind="accent">Local label: {k.keyId}</Pill>
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
                    <span className="faint">Private key hidden &amp; non-exportable</span>
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
                    <CopyButton
                      text={JSON.stringify(
                        { label: k.keyId, publicKeyEd25519: k.publicKeyB64 },
                        null,
                        2,
                      )}
                      label="Copy POST /v1/auth/api-keys JSON"
                      size="md"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Interactive 5-Field Request Signer (SEC-01 & SEC-07) */}
      <Card
        title="4. Official 5-Field Ed25519 Request Signer"
        subtitle="Builds and signs <timestamp_ms>\n<UPPERCASE_METHOD>\n<path>\n<canonical_query>\n<body_sha256_hex> per official Polyester docs."
        actions={
          <Pill kind={registeredKeyId.trim() ? "up" : "warn"}>
            {registeredKeyId.trim()
              ? "Registered Key ID Supplied"
              : "DEMO — Local Label Only"}
          </Pill>
        }
        footer={
          <span>
            Empty body SHA-256 is{" "}
            <code className="mono">{vault.EMPTY_BODY_SHA256.slice(0, 16)}…</code>. Headers
            will only authenticate against Polyester after the public key is registered and
            its server-assigned <code className="mono">ak_...</code> ID is used.
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
                <label htmlFor="signer-key-select">Local Vault Keypair</label>
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
                <label htmlFor="signer-reg-keyid">
                  <TermTip
                    label="Registered Polyester Key ID (optional)"
                    tip="Server-issued keyId (e.g. ak_01H...) returned when you register your public key on Polyester. Leave blank for local demo mode."
                  />
                </label>
                <input
                  id="signer-reg-keyid"
                  type="text"
                  className="input mono"
                  placeholder="ak_... (leave blank for local demo)"
                  value={registeredKeyId}
                  onChange={(e) => setRegisteredKeyId(e.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="signer-method-select">HTTP Method &amp; Request Path</label>
                <div className="row-flex" style={{ gap: 8 }}>
                  <select
                    id="signer-method-select"
                    className="select mono"
                    style={{ width: 96 }}
                    value={httpMethod}
                    onChange={(e) =>
                      setHttpMethod(e.target.value as "GET" | "POST" | "DELETE")
                    }
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="DELETE">DELETE</option>
                  </select>
                  <input
                    type="text"
                    className="input mono"
                    style={{ flex: 1 }}
                    placeholder="/v1/account/balances"
                    aria-label="Request path"
                    value={reqPath}
                    onChange={(e) => setReqPath(e.target.value)}
                  />
                </div>
              </div>

              <div className="field">
                <label htmlFor="signer-query-input">
                  <TermTip
                    label="Query String (auto-sorted per RFC 3986)"
                    tip="Query pairs are sorted by decoded key then decoded value and RFC 3986 percent-encoded before signing."
                  />
                </label>
                <input
                  id="signer-query-input"
                  type="text"
                  className="input mono"
                  placeholder="symbol=BTC-USDT&limit=10"
                  value={reqQuery}
                  onChange={(e) => setReqQuery(e.target.value)}
                />
              </div>
            </div>

            {httpMethod !== "GET" && (
              <div className="field">
                <label htmlFor="signer-body-input">
                  <span>Request Body (UTF-8 JSON · hashed with SHA-256)</span>
                </label>
                <input
                  id="signer-body-input"
                  type="text"
                  className="input mono"
                  placeholder='{"symbol":"BTC-USDT","side":"buy","qty":"0.001"}'
                  value={reqBody}
                  onChange={(e) => setReqBody(e.target.value)}
                />
              </div>
            )}

            <div className="row-flex" style={{ justifyContent: "space-between" }}>
              <span className="faint">
                Signs the 5-line UTF-8 canonical string in WebCrypto without exposing the
                private key.
              </span>
              <button
                type="button"
                className="btn primary"
                disabled={signingBusy || !selectedKeyId || !reqPath.trim()}
                onClick={() => void handleSignRequest()}
              >
                {signingBusy ? "Signing…" : "Sign 5-Field Payload"}
              </button>
            </div>

            {signedOutput && (
              <div
                className="mt-3"
                style={{
                  padding: 12,
                  background: "var(--bg-shell)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-sm)",
                }}
              >
                <div className="between mb-2">
                  <div className="row-flex" style={{ gap: 8 }}>
                    <strong style={{ fontSize: 12 }}>
                      Generated Authentication Headers
                    </strong>
                    {!signedOutput.isRegisteredKeyId && (
                      <Pill kind="warn">
                        DEMO — local label ({signedOutput.label}) not registered on
                        Polyester
                      </Pill>
                    )}
                  </div>
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

                <div className="mt-2">
                  <div className="between mb-1">
                    <span className="faint">
                      Exact 5-Line Canonical String Signed (UTF-8):
                    </span>
                    <CopyButton
                      text={signedOutput.canonicalString}
                      label="Copy Canonical String"
                    />
                  </div>
                  <pre
                    className="mono"
                    style={{
                      margin: 0,
                      padding: "8px 10px",
                      background: "var(--bg-elevated)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "var(--radius-xs)",
                      fontSize: 11.5,
                      overflowX: "auto",
                    }}
                  >
                    {signedOutput.canonicalString}
                  </pre>
                </div>
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
            setSignedOutput(null);
            refreshVault();
          } else if (action.kind === "delete") {
            vault.deleteVaultKey(action.keyId);
            if (signedOutput?.label === action.keyId) setSignedOutput(null);
            refreshVault();
          } else if (action.kind === "overwrite") {
            if (signedOutput?.label === action.keyId) setSignedOutput(null);
            void executeGenerate(action.keyId);
          }
        }}
      />
    </div>
  );
}
