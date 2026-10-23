/**
 * TOOL 10 — Client-Side Ed25519 Key Vault & Portfolio Foundation (/#/portfolio)
 *
 * Security boundaries enforced:
 *  - Private keys (privateKeyB64) are NEVER rendered in the DOM, logged,
 *    copied to clipboard, or transmitted over the network.
 *  - All cryptography (Ed25519 keypair generation & request signing) executes
 *    exclusively in-browser via WebCrypto (`@poly/core` vault module).
 *  - Public keys are displayed in 64-character lowercase hex to match
 *    https://testnet.polyester.com/account/api-keys ("Bring your own key":
 *    "Paste 64 hex characters (with or without 0x)") as well as Base64.
 *  - Signing implements the official 5-field newline-separated canonical string:
 *      <timestamp_ms>\n<UPPERCASE_METHOD>\n<path>\n<canonical_query>\n<body_sha256_hex>
 *  - Destructive actions (deleting a key, overwriting a keyId, or wiping the
 *    vault) require explicit modal confirmation (`ConfirmDialog`).
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { NETWORKS, vault } from "@poly/core";
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

type VaultKey = vault.VaultKey;

type PendingConfirm =
  | { kind: "delete"; keyId: string }
  | { kind: "wipe" }
  | { kind: "overwrite-gen"; keyId: string }
  | { kind: "overwrite-import"; keyId: string }
  | null;

type CreateTab = "generate" | "bring";

export default function Portfolio() {
  const [keys, setKeys] = useState<VaultKey[]>(() => vault.loadVault());
  const [createTab, setCreateTab] = useState<CreateTab>("generate");
  const [label, setLabel] = useState<string>("trading-bot-readonly");
  const [customPubHex, setCustomPubHex] = useState<string>("");
  const [newRegKeyId, setNewRegKeyId] = useState<string>("");
  const [lastCreatedKey, setLastCreatedKey] = useState<VaultKey | null>(null);
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
    signatureHex: string;
    headers: Record<string, string>;
  } | null>(null);

  const supported = vault.ed25519Supported();
  const signCapableKeys = useMemo(
    () => keys.filter((k) => Boolean(k.privateKeyB64)),
    [keys],
  );

  const normalizedBringHex = useMemo(
    () => vault.normalizePublicKeyHex(customPubHex),
    [customPubHex],
  );

  const refreshVault = () => {
    const loaded = vault.loadVault();
    setKeys(loaded);
  };

  useEffect(() => {
    if (
      signCapableKeys.length &&
      !signCapableKeys.some((k) => k.keyId === selectedKeyId)
    ) {
      const first = signCapableKeys[0];
      setSelectedKeyId(first.keyId);
      setRegisteredKeyId(first.registeredKeyId ?? "");
    } else if (!signCapableKeys.length) {
      setSelectedKeyId("");
      setSignedOutput(null);
    }
  }, [signCapableKeys, selectedKeyId]);

  const validateLabel = (raw: string): string | null => {
    const clean = raw.trim() || "key";
    if (!/^[a-zA-Z0-9._ -]{1,64}$/.test(clean)) {
      setError(
        "Key label must be 1–64 characters using letters, numbers, spaces, hyphens, underscores, or dots.",
      );
      return null;
    }
    return clean;
  };

  const executeGenerate = async (targetLabel: string) => {
    setBusy(true);
    setError(null);
    try {
      const created = await vault.generateVaultKey(
        targetLabel,
        newRegKeyId.trim() || undefined,
      );
      refreshVault();
      setLastCreatedKey(created);
      setSelectedKeyId(created.keyId);
      if (created.registeredKeyId) {
        setRegisteredKeyId(created.registeredKeyId);
      }
    } catch {
      setError(
        "WebCrypto Ed25519 key generation failed. Ensure you are running in a secure context (HTTPS or localhost) on a modern browser.",
      );
    } finally {
      setBusy(false);
    }
  };

  const executeImportPublic = (targetLabel: string) => {
    setError(null);
    try {
      const created = vault.importPublicVaultKey(
        targetLabel,
        customPubHex,
        newRegKeyId.trim() || undefined,
      );
      refreshVault();
      setLastCreatedKey(created);
      setCustomPubHex("");
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Invalid public key: paste 64 hex characters (with or without 0x).",
      );
    }
  };

  const handleCreateSubmit = () => {
    const clean = validateLabel(label);
    if (!clean) return;
    if (createTab === "generate") {
      if (keys.some((k) => k.keyId === clean)) {
        setPendingConfirm({ kind: "overwrite-gen", keyId: clean });
        return;
      }
      void executeGenerate(clean);
    } else {
      if (!normalizedBringHex) {
        setError(
          "Invalid Public Key: paste 64 hex characters (32-byte Ed25519 public key, with or without 0x).",
        );
        return;
      }
      if (keys.some((k) => k.keyId === clean)) {
        setPendingConfirm({ kind: "overwrite-import", keyId: clean });
        return;
      }
      executeImportPublic(clean);
    }
  };

  const handleSaveRegisteredId = (keyId: string, regId: string) => {
    const updated = vault.setVaultKeyRegisteredId(keyId, regId);
    setKeys(updated);
    if (selectedKeyId === keyId) {
      setRegisteredKeyId(regId.trim());
    }
  };

  const handleSignRequest = async () => {
    const entry = signCapableKeys.find((k) => k.keyId === selectedKeyId);
    if (!entry || !reqPath.trim()) return;
    setSigningBusy(true);
    setError(null);
    try {
      const sig = await vault.signRequest(entry, {
        method: httpMethod,
        path: reqPath,
        query: reqQuery,
        body: httpMethod === "GET" ? "" : reqBody,
        apiKeyId: registeredKeyId.trim() || entry.registeredKeyId || undefined,
      });
      const headers = vault.signedHeaders(sig);
      setSignedOutput({
        ...sig,
        headers,
      });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Failed to sign payload with the selected Ed25519 key.",
      );
    } finally {
      setSigningBusy(false);
    }
  };

  return (
    <div className="page-stack">
      <PageHeader
        title="Ed25519 API Keys & Request Signer"
        badge={
          <Pill kind={supported ? "up" : "warn"}>
            {supported ? "WebCrypto Ed25519 Ready" : "WebCrypto Unavailable"}
          </Pill>
        }
        subtitle="Generate a 64-hex Ed25519 public key in your browser to register on Polyester via 'Bring your own key', or inspect and sign 5-field canonical REST requests locally."
        actions={
          <div className="row-flex" style={{ gap: 8 }}>
            <a
              href={vault.POLYESTER_API_KEYS_URL}
              target="_blank"
              rel="noreferrer"
              className="btn sm"
            >
              <span>Open Polyester API Keys</span>
              <IconExternal size={12} />
            </a>
            <Link to="/sdk" className="btn sm primary">
              <IconKey size={13} />
              <span>SDK &amp; Bot Quickstart</span>
            </Link>
          </div>
        }
      />

      {/* Explicit Beginner Boundary Notice (UX-T10-01) */}
      <div className="notice warn" role="note">
        <div>
          <strong>Local Browser Sandbox — How This Works with Polyester:</strong>{" "}
          Generating a key here keeps the private key in this browser&apos;s{" "}
          <code className="mono">localStorage</code> (never displayed or sent over the network)
          and gives you a <strong>64-character hex Public Key</strong>. To activate it on
          Polyester, open{" "}
          <a
            href={vault.POLYESTER_API_KEYS_URL}
            target="_blank"
            rel="noreferrer"
            style={{ textDecoration: "underline", fontWeight: 600 }}
          >
            testnet.polyester.com/account/api-keys ↗
          </a>{" "}
          → click <strong>Create API Key</strong> → choose{" "}
          <strong>Bring your own key</strong> → paste the{" "}
          <strong>64 hex characters</strong>.
        </div>
      </div>

      <MetricStrip>
        <MetricCell
          label="Stored Keys"
          value={keys.length}
          sub={`${signCapableKeys.length} sign-capable in browser`}
        />
        <MetricCell
          label="Public Key Format"
          value="64-Char Hex"
          sub="32-byte raw Ed25519 (Bring your own key)"
        />
        <MetricCell
          label="Private Key Custody"
          value="Browser Only"
          sub="pkcs8 in localStorage · never rendered"
        />
        <MetricCell
          label="Signing Spec"
          value="5-Field Canonical"
          sub="ts · METHOD · path · query · sha256"
        />
      </MetricStrip>

      {/* Create API Key Card — Mirrors Polyester "Create API Key" modal (Generate in browser | Bring your own key) */}
      <Card
        title="Create API Key (Local Browser Vault)"
        subtitle="Generate a sign-capable Ed25519 keypair in WebCrypto or register an existing 64-hex public key."
        actions={
          <div className="seg-group" role="tablist" aria-label="API Key creation mode">
            <button
              type="button"
              role="tab"
              aria-selected={createTab === "generate"}
              className={`seg-btn ${createTab === "generate" ? "active" : ""}`}
              onClick={() => {
                setCreateTab("generate");
                setError(null);
              }}
            >
              Generate in browser
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={createTab === "bring"}
              className={`seg-btn ${createTab === "bring" ? "active" : ""}`}
              onClick={() => {
                setCreateTab("bring");
                setError(null);
              }}
            >
              Bring your own key (64 hex)
            </button>
          </div>
        }
      >
        <div className="grid cols-2">
          <div className="field">
            <label htmlFor="vault-key-label">
              <span>Label</span>
              <span className="faint">Helps you identify this key later</span>
            </label>
            <input
              id="vault-key-label"
              type="text"
              className="input mono"
              placeholder="e.g. Trading Bot, Read-only Access"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="vault-reg-id">
              <TermTip
                label="Registered Polyester Key ID (optional)"
                tip="If you already registered this key at testnet.polyester.com/account/api-keys, paste the assigned keyId (e.g. ak_...) here."
              />
              <span className="faint">Can also be added later</span>
            </label>
            <input
              id="vault-reg-id"
              type="text"
              className="input mono"
              placeholder="ak_... (optional)"
              value={newRegKeyId}
              onChange={(e) => setNewRegKeyId(e.target.value)}
            />
          </div>
        </div>

        {createTab === "bring" && (
          <div className="field mt-2">
            <label htmlFor="vault-bring-hex">
              <span>Public Key (64 Hex Characters)</span>
              <span className="mono">
                {customPubHex.trim() ? (
                  normalizedBringHex ? (
                    <Pill kind="up">Valid 64-hex Ed25519 Public Key ✓</Pill>
                  ) : (
                    <Pill kind="down">
                      Must be 64 hex characters (with or without 0x)
                    </Pill>
                  )
                ) : (
                  <span className="faint">32-byte raw Ed25519 public key</span>
                )}
              </span>
            </label>
            <textarea
              id="vault-bring-hex"
              rows={2}
              className="input mono"
              style={{ width: "100%", resize: "vertical", fontFamily: "var(--font-mono)" }}
              placeholder="Paste 64 hex characters (with or without 0x)"
              value={customPubHex}
              onChange={(e) => setCustomPubHex(e.target.value)}
            />
            {normalizedBringHex && (
              <div className="between mono faint" style={{ fontSize: 11 }}>
                <span>Normalized 64-hex: {normalizedBringHex}</span>
                <span>Base64: {vault.pubKeyHexToB64(normalizedBringHex)}</span>
              </div>
            )}
          </div>
        )}

        <div
          className="row-flex mt-2"
          style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}
        >
          <span className="faint" style={{ fontSize: 12 }}>
            {createTab === "generate"
              ? "Generates an Ed25519 keypair in WebCrypto. Private key stays in localStorage and is never shown; copy the 64-hex Public Key into Polyester's 'Bring your own key' tab."
              : "Saves a public-key-only entry (64 hex chars) to inspect encodings and track your Polyester API keys."}
          </span>
          <div className="row-flex" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn primary"
              disabled={
                busy ||
                (createTab === "generate" && !supported) ||
                (createTab === "bring" && !normalizedBringHex)
              }
              onClick={handleCreateSubmit}
            >
              <IconKey size={14} />
              <span>
                {busy
                  ? "Generating…"
                  : createTab === "generate"
                    ? "Generate Ed25519 Keypair"
                    : "Save Public Key (64 Hex)"}
              </span>
            </button>
            {keys.length > 0 && (
              <button
                type="button"
                className="btn danger"
                onClick={() => setPendingConfirm({ kind: "wipe" })}
              >
                <IconTrash size={14} />
                <span>Wipe All ({keys.length})</span>
              </button>
            )}
          </div>
        </div>

        {/* Newly created key highlight banner with 64-hex copy for Polyester "Bring your own key" */}
        {lastCreatedKey && (
          <div
            className="mt-3"
            style={{
              padding: 12,
              background: "var(--bg-shell)",
              border: "1px solid var(--accent-border)",
              borderRadius: "var(--radius-sm)",
            }}
          >
            <div className="between mb-1" style={{ flexWrap: "wrap", gap: 8 }}>
              <div className="row-flex" style={{ gap: 8 }}>
                <Pill kind="up">Ready for Polyester</Pill>
                <strong style={{ fontSize: 12.5 }}>
                  Public Key for &ldquo;{lastCreatedKey.keyId}&rdquo; (64 hex characters)
                </strong>
              </div>
              <div className="row-flex" style={{ gap: 6 }}>
                <CopyButton
                  text={lastCreatedKey.publicKeyHex}
                  label="Copy 64-Hex Public Key"
                />
                <CopyButton
                  text={`0x${lastCreatedKey.publicKeyHex}`}
                  label="Copy with 0x"
                />
                <a
                  href={vault.POLYESTER_API_KEYS_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="btn sm primary"
                >
                  <span>Paste in Polyester &ldquo;Bring your own key&rdquo;</span>
                  <IconExternal size={11} />
                </a>
              </div>
            </div>
            <div
              className="mono"
              style={{
                padding: "8px 10px",
                background: "var(--bg-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 4,
                fontSize: 12,
                wordBreak: "break-all",
              }}
            >
              {lastCreatedKey.publicKeyHex}
            </div>
          </div>
        )}

        {error && (
          <div className="notice error mt-2" role="alert">
            <IconAlert size={16} />
            <span>{error}</span>
          </div>
        )}
      </Card>

      {/* Stored Keys Table */}
      <Card
        flush
        title="Stored Browser Keypairs"
        subtitle="Copy the 64-character hex Public Key into testnet.polyester.com/account/api-keys ('Bring your own key'). Private keys are never displayed."
      >
        {keys.length === 0 ? (
          <EmptyState
            icon={<IconVault size={22} />}
            title="Vault is currently empty"
            description="Click 'Generate Ed25519 Keypair' above to create a browser-resident Ed25519 keypair and get its 64-character hex Public Key for Polyester."
          />
        ) : (
          <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
            <table className="data">
              <thead>
                <tr>
                  <th className="align-left">Label</th>
                  <th className="align-left">
                    <TermTip
                      label="Public Key (64 Hex · Bring Your Own Key)"
                      tip="32-byte raw Ed25519 public key encoded as 64 lowercase hex characters — paste directly into testnet.polyester.com/account/api-keys -> Bring your own key."
                    />
                  </th>
                  <th className="align-left">
                    <TermTip
                      label="Registered Polyester keyId"
                      tip="Optional server-assigned keyId (e.g. ak_...) from testnet.polyester.com/account/api-keys used in the X-API-KEY-ID header."
                    />
                  </th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const isSelected = selectedKeyId === k.keyId;
                  const canSign = Boolean(k.privateKeyB64);
                  return (
                    <tr key={k.keyId}>
                      <td className="align-left">
                        <div className="row-flex" style={{ gap: 6 }}>
                          <span className="mono" style={{ fontWeight: 700 }}>
                            {k.keyId}
                          </span>
                          {isSelected && <Pill kind="accent">Active Signer</Pill>}
                          {!canSign && <Pill kind="warn">Public-Only</Pill>}
                        </div>
                      </td>
                      <td className="align-left">
                        <div
                          className="mono"
                          style={{
                            fontSize: 11.5,
                            wordBreak: "break-all",
                            color: "var(--text-primary)",
                          }}
                        >
                          {k.publicKeyHex}
                        </div>
                        <div
                          className="row-flex mt-1"
                          style={{ gap: 6, flexWrap: "wrap" }}
                        >
                          <CopyButton
                            text={k.publicKeyHex}
                            label="Copy 64-Hex"
                          />
                          <CopyButton
                            text={`0x${k.publicKeyHex}`}
                            label="Copy 0xHex"
                          />
                          <CopyButton
                            text={k.publicKeyB64}
                            label="Copy Base64"
                          />
                        </div>
                      </td>
                      <td className="align-left">
                        <input
                          type="text"
                          className="input mono"
                          style={{ width: 170, padding: "4px 8px", fontSize: 11.5 }}
                          placeholder="Paste ak_... keyId"
                          aria-label={`Registered Polyester keyId for ${k.keyId}`}
                          value={k.registeredKeyId ?? ""}
                          onChange={(e) =>
                            handleSaveRegisteredId(k.keyId, e.target.value)
                          }
                        />
                      </td>
                      <td className="mono muted">
                        {new Date(k.createdAt).toISOString().slice(0, 19).replace("T", " ")}{" "}
                        UTC
                      </td>
                      <td>
                        <div
                          className="row-flex"
                          style={{ justifyContent: "flex-end", gap: 6 }}
                        >
                          {canSign && (
                            <button
                              type="button"
                              className={`btn sm ${isSelected ? "primary" : "ghost"}`}
                              onClick={() => {
                                setSelectedKeyId(k.keyId);
                                setRegisteredKeyId(k.registeredKeyId ?? "");
                              }}
                            >
                              {isSelected ? "Selected" : "Use in Signer"}
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn sm danger"
                            onClick={() =>
                              setPendingConfirm({ kind: "delete", keyId: k.keyId })
                            }
                            aria-label={`Delete key ${k.keyId}`}
                          >
                            <IconTrash size={12} />
                            <span>Delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Interactive 5-Field Canonical Request Signer (SEC-01 & SEC-07) */}
      <Card
        title="5-Field Canonical Ed25519 Request Signer"
        subtitle="Constructs and signs the exact 5-line newline-separated canonical string (<timestamp_ms>\n<METHOD>\n<path>\n<canonical_query>\n<body_sha256_hex>) per the Polyester Ed25519 specification."
        actions={
          <Pill kind="info">
            X-API-KEY-ID · X-API-TIMESTAMP · X-API-SIGNATURE
          </Pill>
        }
      >
        {signCapableKeys.length === 0 ? (
          <div className="faint">
            Generate at least one browser keypair above to test local Ed25519 request
            signing.
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
                  onChange={(e) => {
                    const nextId = e.target.value;
                    setSelectedKeyId(nextId);
                    const found = signCapableKeys.find((k) => k.keyId === nextId);
                    setRegisteredKeyId(found?.registeredKeyId ?? "");
                  }}
                >
                  {signCapableKeys.map((k) => (
                    <option key={k.keyId} value={k.keyId}>
                      {k.keyId} ({k.publicKeyHex.slice(0, 12)}…)
                    </option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label htmlFor="signer-reg-keyid">
                  <TermTip
                    label="Registered Polyester Key ID (X-API-KEY-ID)"
                    tip="Server-issued keyId (e.g. ak_01H...) from testnet.polyester.com/account/api-keys. Leave blank for local demo mode."
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
                <div className="between mb-2" style={{ flexWrap: "wrap", gap: 8 }}>
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
                  <div className="row-flex" style={{ gap: 6 }}>
                    <CopyButton
                      text={JSON.stringify(signedOutput.headers, null, 2)}
                      label="Copy Headers (Base64 Sig)"
                    />
                    <CopyButton
                      text={JSON.stringify(
                        {
                          ...signedOutput.headers,
                          "X-API-SIGNATURE": signedOutput.signatureHex,
                        },
                        null,
                        2,
                      )}
                      label="Copy Headers (128-Hex Sig)"
                    />
                  </div>
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
                <div className="kv">
                  <span className="k mono">X-API-SIGNATURE (128-Hex alt)</span>
                  <span className="v mono row-flex" style={{ justifyContent: "flex-end" }}>
                    <span style={{ wordBreak: "break-all" }}>
                      {signedOutput.signatureHex}
                    </span>
                    <CopyButton text={signedOutput.signatureHex} label="Copy Hex" />
                  </span>
                </div>

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
                      padding: 10,
                      background: "var(--bg-card)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 4,
                      fontSize: 11.5,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
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

      {/* Registration & Security Checklist (SEC-06) */}
      <div className="grid cols-2">
        <Card
          title="How to Register Your 64-Hex Public Key on Polyester"
          subtitle="Matches https://testnet.polyester.com/account/api-keys ('Bring your own key')"
        >
          <ol
            style={{
              margin: 0,
              paddingLeft: 18,
              color: "var(--text-secondary)",
              fontSize: 13,
              lineHeight: 1.75,
            }}
          >
            <li>
              Click <strong>Generate Ed25519 Keypair</strong> above and click{" "}
              <strong>Copy 64-Hex Public Key</strong> (64 hexadecimal characters).
            </li>
            <li>
              Open{" "}
              <a
                href={vault.POLYESTER_API_KEYS_URL}
                target="_blank"
                rel="noreferrer"
                style={{ color: "var(--accent)", textDecoration: "underline" }}
              >
                testnet.polyester.com/account/api-keys ↗
              </a>{" "}
              and click <strong>Create API Key</strong>.
            </li>
            <li>
              Select the <strong>Bring your own key</strong> tab and paste your{" "}
              <strong>64 hex characters</strong> into the Public Key box.
            </li>
            <li>
              Copy the assigned <code className="mono">ak_...</code> key ID returned by
              Polyester and paste it into the <strong>Registered Polyester keyId</strong>{" "}
              column above. Configure an <strong>IP allowlist</strong> for any trading key.
            </li>
          </ol>
          <div className="row-flex mt-3" style={{ gap: 8 }}>
            <a
              href={vault.POLYESTER_API_KEYS_URL}
              target="_blank"
              rel="noreferrer"
              className="btn sm primary"
            >
              <span>Open Polyester API Keys</span>
              <IconExternal size={12} />
            </a>
            <a
              href={`${NETWORKS.testnet.docsUrl}/developer-docs/authentication-security/ed25519-api-keys`}
              target="_blank"
              rel="noreferrer"
              className="btn sm"
            >
              <span>Ed25519 API Keys Docs</span>
              <IconExternal size={12} />
            </a>
          </div>
        </Card>

        <Card
          title="Security Model & Threat Boundaries"
          subtitle="Understand what browser localStorage protects against — and what it does not"
        >
          <div className="kv">
            <span className="k">Network Transmission</span>
            <span className="v up">Zero (100% client-side WebCrypto)</span>
          </div>
          <div className="kv">
            <span className="k">Public Key Export</span>
            <span className="v mono">64-char Hex (32 bytes) &amp; Base64</span>
          </div>
          <div className="kv">
            <span className="k">Private Key DOM Rendering</span>
            <span className="v up">Blocked (Never rendered or copied)</span>
          </div>
          <div className="kv">
            <span className="k">Storage Persistence</span>
            <span className="v mono">localStorage (&quot;poly-tools:vault:v1&quot;)</span>
          </div>
          <div className="notice warn mt-2" style={{ fontSize: 12 }}>
            <div>
              <strong>Security Reminder:</strong> Keys stored in{" "}
              <code className="mono">localStorage</code> are accessible to JavaScript
              running on the same origin. Prefer <strong>Read-Only</strong> permissions and{" "}
              <strong>IP allowlists</strong> when registering keys at{" "}
              <code className="mono">testnet.polyester.com/account/api-keys</code>, and wipe
              keys when using shared machines.
            </div>
          </div>
        </Card>
      </div>

      {/* Confirmation Modals */}
      <ConfirmDialog
        open={pendingConfirm?.kind === "delete"}
        title="Delete Ed25519 Keypair?"
        message={
          pendingConfirm?.kind === "delete"
            ? `Permanently remove keypair "${pendingConfirm.keyId}" from this browser's localStorage? Because there is no server backup, this keypair cannot be recovered.`
            : ""
        }
        confirmLabel="Delete Keypair"
        danger
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          if (pendingConfirm?.kind === "delete") {
            vault.deleteVaultKey(pendingConfirm.keyId);
            if (lastCreatedKey?.keyId === pendingConfirm.keyId) {
              setLastCreatedKey(null);
            }
            refreshVault();
          }
          setPendingConfirm(null);
        }}
      />

      <ConfirmDialog
        open={
          pendingConfirm?.kind === "overwrite-gen" ||
          pendingConfirm?.kind === "overwrite-import"
        }
        title="Overwrite Existing Key Label?"
        message={
          pendingConfirm?.kind === "overwrite-gen" ||
          pendingConfirm?.kind === "overwrite-import"
            ? `A key with label "${pendingConfirm.keyId}" already exists in your browser vault. Replacing it will permanently destroy the existing keypair.`
            : ""
        }
        confirmLabel="Replace Key"
        danger
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          if (pendingConfirm?.kind === "overwrite-gen") {
            const target = pendingConfirm.keyId;
            setPendingConfirm(null);
            void executeGenerate(target);
          } else if (pendingConfirm?.kind === "overwrite-import") {
            const target = pendingConfirm.keyId;
            setPendingConfirm(null);
            executeImportPublic(target);
          }
        }}
      />

      <ConfirmDialog
        open={pendingConfirm?.kind === "wipe"}
        title="Wipe Entire Browser Key Vault?"
        message={`Permanently erase all ${keys.length} Ed25519 keypair(s) from this browser's localStorage? This action is immediate and irreversible.`}
        confirmLabel="Wipe All Keys"
        danger
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          vault.wipeVault();
          setLastCreatedKey(null);
          refreshVault();
          setPendingConfirm(null);
        }}
      />
    </div>
  );
}
