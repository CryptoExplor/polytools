/**
 * Secure local Ed25519 vault and read-only request-signing foundation.
 *
 * The signer itself never executes requests. Account analytics uses explicit
 * read-only requests; live compatibility remains subject to target-browser,
 * CORS, and owner-controlled read-policy verification.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, NavLink, useLocation, useSearchParams } from "react-router-dom";
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
import {
  IconAlert,
  IconExternal,
  IconFlow,
  IconKey,
  IconTrash,
  IconVault,
} from "../components/icons";
import { AccountAnalytics } from "../components/AccountAnalytics";
import Flow from "./Flow";
import {
  moneyMovementScope,
  withMoneyMovementScope,
  type MoneyMovementScope,
} from "../lib/navigation";

type CreateMode = "generate" | "import";
type PendingConfirm =
  | { kind: "delete"; entryId: string }
  | { kind: "wipe" }
  | { kind: "legacy-delete" }
  | null;
type SignedOutput = vault.SignedRequestResult & {
  headers: Record<string, string>;
};

type AccountSection = "overview" | "api" | "trade" | "orders" | "pnl" | "transactions";

const ACCOUNT_TABS: Array<{ to: string; section: AccountSection; label: string }> = [
  { to: "/account", section: "overview", label: "Overview" },
  { to: "/account/api", section: "api", label: "API setup" },
  { to: "/account/trade", section: "trade", label: "Your Trades" },
  { to: "/account/orders", section: "orders", label: "Orders" },
  { to: "/account/pnl", section: "pnl", label: "Profit and Loss" },
  { to: "/account/transactions", section: "transactions", label: "Money Movements" },
];

const ACCOUNT_HEADERS: Record<AccountSection, { title: string; subtitle: string }> = {
  overview: {
    title: "Account overview",
    subtitle: "Your balances, orders, trades, money movements, and current fee rates. Each section reports its own loading, permission, and data-coverage status.",
  },
  api: {
    title: "API setup",
    subtitle: "Connect a registered read-only account key. Your key is encrypted in this browser and can sign only approved read requests.",
  },
  trade: {
    title: "Your Trades",
    subtitle: "Only executions belonging to your connected account. Public market trades are available under Market Data → Trades.",
  },
  orders: {
    title: "Your Orders",
    subtitle: "Open and completed orders from your connected account. This is not the public order book.",
  },
  pnl: {
    title: "Profit and Loss",
    subtitle: "User-assisted cost-basis estimates require complete fills, opening basis, resolved flows, and method provenance. Realized P&L does not require a current mark; unrealized and total P&L also require a fresh labeled valuation.",
  },
  transactions: {
    title: "Money Movements",
    subtitle: "Review deposits, withdrawals, and transfers from your account, or look up a public transaction by its exact ID.",
  },
};

function accountSection(pathname: string): AccountSection {
  if (pathname.startsWith("/account/api")) return "api";
  if (pathname.startsWith("/account/trade")) return "trade";
  if (pathname.startsWith("/account/orders") || pathname.startsWith("/account/order-book")) return "orders";
  if (pathname.startsWith("/account/pnl")) return "pnl";
  if (pathname.startsWith("/account/transactions")) return "transactions";
  return "overview";
}

function AccountTabs() {
  return (
    <nav className="account-tabs" aria-label="Account sections">
      {ACCOUNT_TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.section === "overview"}
          className={({ isActive }) => `account-tab ${isActive ? "active" : ""}`}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}

function AccountTransactions({
  accountVault,
  session,
}: {
  accountVault: vault.AccountVault | null;
  session: vault.VaultSessionInfo | null;
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const scope = moneyMovementScope(searchParams);
  const selectScope = (next: MoneyMovementScope) => {
    setSearchParams(withMoneyMovementScope(searchParams, next), { replace: true });
  };
  return (
    <>
      <Card
        title="Choose a money-movement view"
        subtitle="Your account view uses signed private reads. Public lookup is separate and never requires your account key."
      >
        <div className="seg-group" role="group" aria-label="Money movement view">
          <button type="button" className={`seg-btn ${scope === "mine" ? "active" : ""}`} aria-pressed={scope === "mine"} onClick={() => selectScope("mine")}>
            My account
          </button>
          <button type="button" className={`seg-btn ${scope === "all" ? "active" : ""}`} aria-pressed={scope === "all"} onClick={() => selectScope("all")}>
            Public transaction lookup
          </button>
        </div>
        <div className={`notice ${scope === "mine" ? "info" : "warn"} mt-3`} role="note">
          {scope === "mine" ? (
            <span>Private transfers are shown only after you unlock an account and explicitly load them. Missing or incomplete data is never shown as an empty history.</span>
          ) : (
            <span>Public lookup finds a transaction or flow by the ID you enter. It is not a feed of every transaction and does not show your private account history.</span>
          )}
        </div>
      </Card>
      {scope === "mine" ? (
        session && accountVault ? (
          <AccountAnalytics accountVault={accountVault} session={session} view="transfers" />
        ) : (
          <Card title="Your money movements" actions={<Pill kind="info">Account locked</Pill>}>
            <EmptyState
              icon={<IconFlow size={22} />}
              title="Unlock an account to view your transfers"
              description="No private request is made while locked. Set up or unlock an encrypted read-only key in API setup, or choose Public transaction lookup for a credential-free search."
            />
            <div className="row-flex mt-3" style={{ gap: 8 }}>
              <Link to="/account/api" className="btn sm primary">Open API setup</Link>
              <button type="button" className="btn sm" onClick={() => selectScope("all")}>Use public lookup</button>
            </div>
          </Card>
        )
      ) : <Flow embedded />}
    </>
  );
}

const PASSPHRASE_HELP =
  "At least 12 characters. It is never stored and cannot be recovered.";

export default function Portfolio() {
  const [accountVault, setAccountVault] = useState<vault.AccountVault | null>(null);
  const [entries, setEntries] = useState<vault.VaultEntrySummary[]>([]);
  const [legacy, setLegacy] = useState<vault.LegacyVaultStatus>({
    present: false,
    invalid: false,
    signCapableCount: 0,
    publicOnlyCount: 0,
    canMigrate: false,
  });
  const [session, setSession] = useState<vault.VaultSessionInfo | null>(null);
  const [createMode, setCreateMode] = useState<CreateMode>("generate");
  const [label, setLabel] = useState("readonly-analytics");
  const [registeredId, setRegisteredId] = useState("");
  const [publicKeyInput, setPublicKeyInput] = useState("");
  const [privateKeyInput, setPrivateKeyInput] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [unlockEntryId, setUnlockEntryId] = useState("");
  const [unlockPassphrase, setUnlockPassphrase] = useState("");
  const [migrationPassphrase, setMigrationPassphrase] = useState("");
  const [updatedRegisteredId, setUpdatedRegisteredId] = useState("");
  const [updatePassphrase, setUpdatePassphrase] = useState("");
  const [operation, setOperation] = useState<vault.ReadOnlyOperation>("balances");
  const [query, setQuery] = useState("");
  const [signedOutput, setSignedOutput] = useState<SignedOutput | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const supported = vault.ed25519Supported();
  const location = useLocation();
  const section = accountSection(location.pathname);
  const header = ACCOUNT_HEADERS[section];

  // Construct in an effect so React StrictMode's development setup/cleanup
  // cycle cannot reuse a disposed BroadcastChannel or vault session.
  useEffect(() => {
    const instance = new vault.AccountVault();
    setAccountVault(instance);
    return () => instance.dispose();
  }, []);

  const refresh = useCallback(async () => {
    if (!accountVault) return;
    try {
      const nextEntries = await accountVault.listEntries();
      setEntries(nextEntries);
      setUnlockEntryId((current) =>
        nextEntries.some((entry) => entry.entryId === current)
          ? current
          : (nextEntries[0]?.entryId ?? ""),
      );
      setLegacy(accountVault.getLegacyStatus());
      setSession(accountVault.getSessionInfo());
    } catch (caught) {
      setError(vault.vaultErrorMessage(caught));
      setSession(null);
    }
  }, [accountVault]);

  useEffect(() => {
    if (!accountVault) return;
    let active = true;
    void refresh();
    const unsubscribe = accountVault.subscribe((event) => {
      if (!active) return;
      setSession(accountVault.getSessionInfo());
      if (event.type !== "UNLOCK") {
        setSignedOutput(null);
        setUnlockPassphrase("");
        setUpdatePassphrase("");
      }
      void refresh();
    });
    const clearSensitiveOutput = () => {
      setSignedOutput(null);
      setPrivateKeyInput("");
      setPassphrase("");
      setConfirmPassphrase("");
      setUnlockPassphrase("");
      setMigrationPassphrase("");
      setUpdatePassphrase("");
    };
    window.addEventListener("pagehide", clearSensitiveOutput);
    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener("pagehide", clearSensitiveOutput);
    };
  }, [accountVault, refresh]);

  useEffect(() => {
    if (!accountVault) return;
    const activity = () => accountVault.notifyActivity();
    window.addEventListener("pointerdown", activity, { passive: true });
    window.addEventListener("keydown", activity);
    return () => {
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
    };
  }, [accountVault]);

  useEffect(() => {
    if (!signedOutput) return;
    const timeout = window.setTimeout(() => setSignedOutput(null), 60_000);
    return () => window.clearTimeout(timeout);
  }, [signedOutput]);

  const operationDefinition = useMemo(
    () => vault.READ_ONLY_OPERATIONS[operation],
    [operation],
  );

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (caught) {
      setError(vault.vaultErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const clearCreationSecrets = () => {
    setPassphrase("");
    setConfirmPassphrase("");
    setPrivateKeyInput("");
  };

  const createKey = () =>
    run(async () => {
      if (!accountVault) {
        clearCreationSecrets();
        return;
      }
      try {
        if (passphrase !== confirmPassphrase) {
          throw new vault.AccountVaultError(
            "VAULT_INVALID_INPUT",
            "The passphrase confirmation does not match.",
          );
        }
        if (createMode === "generate") {
          await accountVault.createKey({
            label,
            passphrase,
            registeredKeyId: registeredId || undefined,
          });
        } else {
          await accountVault.importKey({
            label,
            passphrase,
            registeredKeyId: registeredId || undefined,
            publicKeyHex: publicKeyInput,
            privateKeyHex: privateKeyInput,
          });
        }
        setPublicKeyInput("");
        setRegisteredId("");
        setNotice(
          "Encrypted entry created and unlocked in memory only. No account request was sent.",
        );
        await refresh();
      } finally {
        clearCreationSecrets();
      }
    });

  const unlock = () =>
    run(async () => {
      if (!accountVault || !unlockEntryId) return;
      try {
        await accountVault.unlock(unlockEntryId, unlockPassphrase);
        setNotice("Entry unlocked. The nonextractable session key exists only in memory.");
      } finally {
        setUnlockPassphrase("");
      }
    });

  const lock = () =>
    run(async () => {
      if (!accountVault) return;
      await accountVault.lock();
      setSignedOutput(null);
      setNotice("Locked. Signing stopped and the in-memory session was discarded.");
    });

  const saveRegisteredId = () =>
    run(async () => {
      if (!accountVault || !session) return;
      try {
        await accountVault.setRegisteredKeyId(
          session.entryId,
          updatePassphrase,
          updatedRegisteredId || undefined,
        );
        setUpdatedRegisteredId("");
        setNotice("Registered key ID updated inside the encrypted entry.");
      } finally {
        setUpdatePassphrase("");
      }
    });

  const sign = () =>
    run(async () => {
      if (!accountVault) return;
      accountVault.notifyActivity();
      const signed = await accountVault.signReadRequest({ operation, query });
      setSignedOutput(signed);
      setNotice(
        "Local signature created. It was not transmitted and will be cleared after 60 seconds or on lock.",
      );
    });

  const migrateLegacy = () =>
    run(async () => {
      if (!accountVault) return;
      try {
        const count = await accountVault.migrateLegacyVault(migrationPassphrase);
        setNotice(
          `${count} legacy signing ${count === 1 ? "entry" : "entries"} migrated to authenticated encryption. The plaintext record was removed after verification.`,
        );
        await refresh();
      } finally {
        setMigrationPassphrase("");
      }
    });

  return (
    <div className="page-stack">
      <AccountTabs />
      <PageHeader
        title={header.title}
        badge={
          <Pill kind={section === "transactions" ? "accent" : session ? "up" : supported ? "warn" : "down"}>
            {section === "transactions"
              ? "Scoped · Read-only"
              : session
                ? "Unlocked · Memory Only"
                : supported
                  ? "Locked"
                  : "WebCrypto Unavailable"}
          </Pill>
        }
        subtitle={header.subtitle}
        actions={
          <div className="row-flex" style={{ gap: 8 }}>
            {session && (
              <button type="button" className="btn sm" onClick={() => void lock()} disabled={busy}>
                Lock now
              </button>
            )}
            <a
              href={vault.POLYESTER_API_KEYS_URL}
              target="_blank"
              rel="noreferrer"
              className="btn sm"
            >
              <span>Official API Keys</span>
              <IconExternal size={12} />
            </a>
            <Link to="/sdk" className="btn sm primary">
              <IconKey size={13} />
              <span>SDK Quickstart</span>
            </Link>
          </div>
        }
      />

      {section === "api" && (
        <>
      <div className="notice warn" role="note">
        <div>
          <strong>Use real account keys only in a deployment you control.</strong>{" "}
          Do not enter a real key in a development server or shared preview. Account reads
          happen only after an explicit click. Browser security settings, service access,
          and the key's read permissions still determine whether a request succeeds. The
          signature inspector below never sends a request.
        </div>
      </div>

      <MetricStrip>
        <MetricCell
          label="Saved account keys"
          value={entries.length}
          sub="Encrypted in this browser · labels are private"
          tooltip="A saved key is an encrypted local entry. It is not a live account balance or a connection to another user."
        />
        <MetricCell
          label="Connection"
          value={session ? "Unlocked" : "Locked"}
          sub={session ? "Key available only in this tab's memory" : "New tabs start locked"}
          tooltip="Unlocking allows approved read requests. Locking removes the session and clears private account snapshots."
        />
        <MetricCell
          label="Key storage"
          value="Encrypted browser storage"
          sub="Your passphrase is required to unlock"
          tooltip="The app uses AES-GCM encryption and PBKDF2 passphrase stretching. These protect stored keys; they do not grant account permissions."
        />
        <MetricCell
          label="Request permissions"
          value="Read-only requests"
          sub="No trading, cancellation, or money movement"
          tooltip="Only approved GET requests can be signed. Each request uses a fresh timestamp and cannot place or change orders."
        />
      </MetricStrip>
        </>
      )}

      {section === "overview" && <AccountAnalytics accountVault={accountVault} session={session} view="overview" />}
      {section === "trade" && <AccountAnalytics accountVault={accountVault} session={session} view="trades" />}
      {section === "orders" && <AccountAnalytics accountVault={accountVault} session={session} view="orders" />}
      {section === "pnl" && <AccountAnalytics accountVault={accountVault} session={session} view="pnl" />}
      {section === "transactions" && <AccountTransactions accountVault={accountVault} session={session} />}

      {section === "api" && (
        <>

      {error && (
        <div className="notice error" role="alert">
          <IconAlert size={16} />
          <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          <span>{notice}</span>
        </div>
      )}

      {legacy.present && (
        <Card
          title="Legacy Plaintext Vault Quarantined"
          subtitle="poly-tools:vault:v1 is never loaded for signing by the new account foundation."
          actions={<Pill kind="warn">Action Required</Pill>}
        >
          <div className="notice warn" role="note">
            <div>
              {legacy.invalid
                ? "The legacy record is malformed. It cannot be migrated; leave it unused or explicitly delete it."
                : `${legacy.signCapableCount} signing ${legacy.signCapableCount === 1 ? "entry" : "entries"} and ${legacy.publicOnlyCount} public-only ${legacy.publicOnlyCount === 1 ? "entry" : "entries"} detected. Migration requires a new passphrase and succeeds only after every encrypted write is read back, decrypted, and key-pair verified.`}
              {legacy.publicOnlyCount > 0 &&
                " Automatic migration is disabled for mixed/public-only legacy vaults to avoid discarding records."}
            </div>
          </div>
          {legacy.canMigrate && (
            <div className="row-flex mt-2" style={{ gap: 8, flexWrap: "wrap" }}>
              <input
                type="password"
                className="input"
                style={{ minWidth: 240, flex: 1 }}
                value={migrationPassphrase}
                onChange={(event) => setMigrationPassphrase(event.target.value)}
                placeholder="New encryption passphrase"
                aria-label="New passphrase for legacy migration"
                autoComplete="new-password"
              />
              <button
                type="button"
                className="btn primary"
                disabled={busy || migrationPassphrase.length < 12}
                onClick={() => void migrateLegacy()}
              >
                Migrate & Remove Plaintext
              </button>
            </div>
          )}
          <div className="row-flex mt-2" style={{ justifyContent: "space-between", gap: 8 }}>
            <span className="faint">Leave unused keeps the record quarantined; it does not make it safe.</span>
            <button
              type="button"
              className="btn sm danger"
              disabled={busy}
              onClick={() => setPendingConfirm({ kind: "legacy-delete" })}
            >
              Delete Legacy Record
            </button>
          </div>
        </Card>
      )}

      <Card
        title="Create an Encrypted Key Entry"
        subtitle="Generate a new Ed25519 pair or import a raw 32-byte seed with its matching public key. Private material is exported only transiently for authenticated encryption, then imported as nonextractable."
        actions={
          <div className="seg-group" role="group" aria-label="Key creation mode">
            <button
              type="button"
              aria-pressed={createMode === "generate"}
              className={`seg-btn ${createMode === "generate" ? "active" : ""}`}
              onClick={() => setCreateMode("generate")}
            >
              Generate
            </button>
            <button
              type="button"
              aria-pressed={createMode === "import"}
              className={`seg-btn ${createMode === "import" ? "active" : ""}`}
              onClick={() => setCreateMode("import")}
            >
              Import
            </button>
          </div>
        }
      >
        <div className="grid cols-2">
          <div className="field">
            <label htmlFor="vault-label">Local label (encrypted)</label>
            <input
              id="vault-label"
              className="input"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={64}
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="vault-registered-id">
              <TermTip
                label="Registered Polyester key ID (optional)"
                tip="Use only the server-issued ak_... ID. A local label is never accepted as an authentication fallback."
              />
            </label>
            <input
              id="vault-registered-id"
              className="input mono"
              value={registeredId}
              onChange={(event) => setRegisteredId(event.target.value)}
              placeholder="ak_... (optional)"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label htmlFor="vault-passphrase">Encryption passphrase</label>
            <input
              id="vault-passphrase"
              type="password"
              className="input"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              autoComplete="new-password"
            />
            <span className="faint">{PASSPHRASE_HELP}</span>
          </div>
          <div className="field">
            <label htmlFor="vault-passphrase-confirm">Confirm passphrase</label>
            <input
              id="vault-passphrase-confirm"
              type="password"
              className="input"
              value={confirmPassphrase}
              onChange={(event) => setConfirmPassphrase(event.target.value)}
              autoComplete="new-password"
            />
          </div>
        </div>

        {createMode === "import" && (
          <div className="grid cols-2 mt-2">
            <div className="field">
              <label htmlFor="vault-public-import">Matching public key (64 hex)</label>
              <textarea
                id="vault-public-import"
                className="input mono"
                rows={2}
                value={publicKeyInput}
                onChange={(event) => setPublicKeyInput(event.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="vault-private-import">Raw private seed (64 hex)</label>
              <input
                id="vault-private-import"
                type="password"
                className="input mono"
                value={privateKeyInput}
                onChange={(event) => setPrivateKeyInput(event.target.value)}
                autoComplete="off"
              />
              <span className="faint">The pair is signed/verified locally before the encrypted write.</span>
            </div>
          </div>
        )}

        <div className="between mt-3" style={{ gap: 10, flexWrap: "wrap" }}>
          <span className="faint">
            No plaintext localStorage fallback, no passphrase recovery, and no network transmission.
          </span>
          <button
            type="button"
            className="btn primary"
            disabled={
              busy ||
              !supported ||
              !accountVault ||
              passphrase.length < 12 ||
              passphrase !== confirmPassphrase ||
              (createMode === "import" &&
                (!vault.normalizePrivateKeyHex(privateKeyInput) ||
                  !vault.normalizePublicKeyHex(publicKeyInput)))
            }
            onClick={() => void createKey()}
          >
            <IconKey size={14} />
            {busy ? "Working…" : createMode === "generate" ? "Generate & Encrypt" : "Verify, Import & Encrypt"}
          </button>
        </div>
      </Card>

      <Card
        title="Encrypted Vault Entries"
        subtitle="While locked, only random local references and KDF parameters are visible. Labels, public keys, registered IDs, and private material remain inside authenticated ciphertext."
        actions={
          (entries.length > 0 || legacy.present) && (
            <button
              type="button"
              className="btn sm danger"
              disabled={busy}
              onClick={() => setPendingConfirm({ kind: "wipe" })}
            >
              <IconTrash size={12} /> Forget All
            </button>
          )
        }
      >
        {entries.length === 0 ? (
          <EmptyState
            icon={<IconVault size={22} />}
            title="No encrypted entries"
            description="Create or explicitly migrate a key above. An empty vault is not an account connection and shows no balances."
          />
        ) : (
          <>
            <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th className="align-left">Random local reference</th>
                    <th>PBKDF2 iterations</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const active = session?.entryId === entry.entryId;
                    return (
                      <tr key={entry.entryId}>
                        <td className="align-left mono">{entry.entryId.slice(0, 8)}…</td>
                        <td className="mono">{entry.iterations.toLocaleString()}</td>
                        <td>{active ? <Pill kind="up">Unlocked here</Pill> : <Pill>Encrypted</Pill>}</td>
                        <td>
                          <div className="row-flex" style={{ justifyContent: "flex-end", gap: 6 }}>
                            <button
                              type="button"
                              className="btn sm"
                              disabled={busy}
                              onClick={() => setUnlockEntryId(entry.entryId)}
                            >
                              Select
                            </button>
                            <button
                              type="button"
                              className="btn sm danger"
                              disabled={busy}
                              onClick={() => setPendingConfirm({ kind: "delete", entryId: entry.entryId })}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="row-flex" style={{ gap: 8, flexWrap: "wrap", padding: 12 }}>
              <select
                className="select mono"
                value={unlockEntryId}
                onChange={(event) => setUnlockEntryId(event.target.value)}
                aria-label="Encrypted entry to unlock"
              >
                {entries.map((entry) => (
                  <option key={entry.entryId} value={entry.entryId}>
                    Local entry {entry.entryId.slice(0, 8)}…
                  </option>
                ))}
              </select>
              <input
                type="password"
                className="input"
                style={{ minWidth: 220, flex: 1 }}
                value={unlockPassphrase}
                onChange={(event) => setUnlockPassphrase(event.target.value)}
                placeholder="Entry passphrase"
                aria-label="Passphrase to unlock selected entry"
                autoComplete="current-password"
              />
              <button
                type="button"
                className="btn primary"
                disabled={busy || !unlockEntryId || unlockPassphrase.length < 12}
                onClick={() => void unlock()}
              >
                Unlock in Memory
              </button>
            </div>
          </>
        )}
      </Card>

      {session && (
        <Card
          title={`Unlocked: ${session.label}`}
          subtitle="This metadata is in memory only. Locking aborts the session signal and invalidates late work."
          actions={<Pill kind="up">Private Key Extractable: {String(session.privateKeyExtractable)}</Pill>}
        >
          <div className="kv">
            <span className="k">Registered key ID</span>
            <span className="v">
              {session.registeredKeyId ? <Pill kind="up">Server ID saved</Pill> : <Pill kind="warn">Required before signing</Pill>}
            </span>
          </div>
          <div className="field mt-2">
            <label htmlFor="session-public-key">Ed25519 public key (safe to register)</label>
            <div className="row-flex" style={{ gap: 8, alignItems: "flex-start" }}>
              <code id="session-public-key" className="mono" style={{ wordBreak: "break-all", flex: 1 }}>
                {session.publicKeyHex}
              </code>
              <CopyButton text={session.publicKeyHex} label="Copy Public Key" />
            </div>
          </div>
          <div className="grid cols-2 mt-3">
            <div className="field">
              <label htmlFor="update-registered-id">Set/clear registered ak_... key ID</label>
              <input
                id="update-registered-id"
                className="input mono"
                value={updatedRegisteredId}
                onChange={(event) => setUpdatedRegisteredId(event.target.value)}
                placeholder={session.registeredKeyId ? "Enter replacement or leave blank to clear" : "ak_..."}
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="update-passphrase">Confirm entry passphrase</label>
              <div className="row-flex" style={{ gap: 8 }}>
                <input
                  id="update-passphrase"
                  type="password"
                  className="input"
                  value={updatePassphrase}
                  onChange={(event) => setUpdatePassphrase(event.target.value)}
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="btn"
                  disabled={busy || updatePassphrase.length < 12}
                  onClick={() => void saveRegisteredId()}
                >
                  Re-encrypt
                </button>
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card
        title="Read-only Canonical Request Signer"
        subtitle="Fixed operation registry only. This creates a local signature for inspection; it does not execute fetch, retry, or authenticate an account."
        actions={<Pill kind="info">GET · {operationDefinition.path}</Pill>}
      >
        {!session ? (
          <EmptyState
            title="Vault locked"
            description="Unlock an encrypted entry to sign. Locked, denied, or unavailable states never become account metrics or a successful connection."
          />
        ) : (
          <>
            {!session.registeredKeyId && (
              <div className="notice warn" role="note">
                Add the server-issued key ID above. The local label “{session.label}” will never be substituted into X-API-KEY-ID.
              </div>
            )}
            <div className="grid cols-2">
              <div className="field">
                <label htmlFor="sign-operation">Allowlisted read operation</label>
                <select
                  id="sign-operation"
                  className="select"
                  value={operation}
                  onChange={(event) => {
                    setOperation(event.target.value as vault.ReadOnlyOperation);
                    setSignedOutput(null);
                  }}
                >
                  {Object.entries(vault.READ_ONLY_OPERATIONS)
                    // Order details needs a validated path identifier and is
                    // initiated by the account drawer, not this raw inspector.
                    .filter(([, definition]) => !definition.path.includes("{"))
                    .map(([key, definition]) => (
                      <option key={key} value={key}>
                        {definition.label} · {definition.path}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="sign-query">
                  <TermTip
                    label="Raw query (optional)"
                    tip="Decoded key/value sorting follows the documented contract. A conflicting SDK sort order blocks signing pending server verification."
                  />
                </label>
                <input
                  id="sign-query"
                  className="input mono"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setSignedOutput(null);
                  }}
                  placeholder="Repeated, empty, reserved, Unicode, and cursor values are preserved"
                  autoComplete="off"
                />
              </div>
            </div>
            <div className="between" style={{ gap: 8, flexWrap: "wrap" }}>
              <span className="faint">Exact empty-body SHA-256 · fresh monotonic timestamp · standard Base64 signature</span>
              <button
                type="button"
                className="btn primary"
                disabled={busy || !session.registeredKeyId}
                onClick={() => void sign()}
              >
                Sign Locally — Do Not Send
              </button>
            </div>
            {signedOutput && (
              <div className="mt-3">
                <div className="between mb-1" style={{ gap: 8, flexWrap: "wrap" }}>
                  <strong>Generated authentication headers (sensitive; auto-clear)</strong>
                  <CopyButton text={JSON.stringify(signedOutput.headers, null, 2)} label="Copy Headers" />
                </div>
                {Object.entries(signedOutput.headers).map(([header, value]) => (
                  <div className="kv" key={header}>
                    <span className="k mono">{header}</span>
                    <span className="v mono" style={{ wordBreak: "break-all" }}>{value}</span>
                  </div>
                ))}
                <div className="between mt-2 mb-1">
                  <span className="faint">Exact five-line canonical string</span>
                  <CopyButton text={signedOutput.canonicalString} label="Copy Canonical String" />
                </div>
                <pre className="mono" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                  {signedOutput.canonicalString}
                </pre>
              </div>
            )}
          </>
        )}
      </Card>

      <div className="grid cols-2">
        <Card title="Registration & Permission Boundary" subtitle="Key creation and policy attachment remain in Polyester's official UI.">
          <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
            <li>Generate locally and copy only the public key into official “Bring your own key”.</li>
            <li>Attach only verified read policies; never add trading, transfer, or withdrawal writes for analytics.</li>
            <li>Save the resulting server-issued ak_... ID here with the entry passphrase.</li>
            <li>Lock clears local use; revoke a compromised key in the official UI.</li>
          </ol>
          <div className="row-flex mt-2" style={{ gap: 8 }}>
            <a href={vault.POLYESTER_API_KEYS_URL} target="_blank" rel="noreferrer" className="btn sm primary">
              Official Key UI <IconExternal size={11} />
            </a>
            <a
              href={`${NETWORKS.testnet.docsUrl}/developer-docs/authentication-security/ed25519-api-keys`}
              target="_blank"
              rel="noreferrer"
              className="btn sm"
            >
              Signing Docs <IconExternal size={11} />
            </a>
          </div>
        </Card>
        <Card title="Residual Browser Limits" subtitle="AEAD and nonextractable keys reduce exposure; they do not make XSS or a compromised device safe.">
          <div className="kv"><span className="k">Idle lock</span><span className="v">15 minutes of deliberate inactivity</span></div>
          <div className="kv"><span className="k">Cross-tab control</span><span className="v">Random event/generation IDs only</span></div>
          <div className="kv"><span className="k">Private responses</span><span className="v">Memory-only after explicit live-read opt-in; never persisted</span></div>
          <p className="faint">
            JavaScript cannot guarantee erasure of every immutable string or garbage-collected copy. Mutable key/passphrase buffers are overwritten where possible; no perfect memory-wiping claim is made.
          </p>
        </Card>
      </div>

      <ConfirmDialog
        open={pendingConfirm?.kind === "delete"}
        title="Delete encrypted entry?"
        message="This deletes the selected encrypted private-key record. There is no passphrase recovery or server backup. Other entries and public preferences are untouched."
        confirmLabel="Delete Encrypted Entry"
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          const target = pendingConfirm;
          setPendingConfirm(null);
          if (target?.kind === "delete") {
            void run(async () => {
              await accountVault?.deleteEntry(target.entryId);
              await refresh();
            });
          }
        }}
      />
      <ConfirmDialog
        open={pendingConfirm?.kind === "wipe"}
        title="Forget all local vault data?"
        message="This locks every tab, deletes all encrypted entries and any quarantined legacy vault, and clears displayed signatures. It does not revoke keys at Polyester; revoke compromised keys in the official UI."
        confirmLabel="Forget All Local Keys"
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          setPendingConfirm(null);
          void run(async () => {
            await accountVault?.wipeAll({ includeLegacy: true });
            setSignedOutput(null);
            await refresh();
          });
        }}
      />
      <ConfirmDialog
        open={pendingConfirm?.kind === "legacy-delete"}
        title="Delete quarantined plaintext record?"
        message="This permanently deletes poly-tools:vault:v1 without migrating it. Other local preferences and encrypted entries are not removed."
        confirmLabel="Delete Legacy Plaintext"
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          setPendingConfirm(null);
          void run(async () => {
            accountVault?.deleteLegacy();
            await refresh();
          });
        }}
      />
        </>
      )}
    </div>
  );
}
