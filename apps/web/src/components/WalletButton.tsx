/**
 * Compact injected-wallet control for the topbar.
 *
 * Connection only. The copy deliberately never implies that connecting a wallet
 * signs you in, unlocks account data, or authorizes trading — it does none of
 * those. Private account access still runs through the existing API-key vault.
 *
 * The state→view mapping is a pure function so every state is unit-testable
 * without a DOM or a client renderer.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode, Ref } from "react";
import {
  chainLabel,
  shortenAddress,
  walletErrorMessage,
  type WalletState,
} from "../lib/walletConnection";
import { useWalletConnection, useWalletProviders } from "../lib/useWallet";
import type { DiscoveredProvider } from "../lib/walletDiscovery";

export type WalletControlView =
  | { kind: "hidden" }
  | { kind: "pending" }
  | { kind: "unavailable"; message: string }
  | { kind: "connect"; title: string }
  | { kind: "connected"; address: string; short: string; chain: string | null; title: string }
  | { kind: "error"; message: string; code: NonNullable<WalletState["error"]> };

export const CONNECT_TITLE =
  "Connect a browser wallet. Connection only: no sign-in, no account data, no trading.";

export function describeWalletControl(state: WalletState): WalletControlView {
  switch (state.status) {
    case "detecting":
      // Nothing to say until the silent `eth_accounts` probe resolves. Rendering a
      // placeholder here would flash a false "not connected" on every load.
      return { kind: "hidden" };
    case "connecting":
      return { kind: "pending" };
    case "connected":
      if (!state.address) return { kind: "connect", title: CONNECT_TITLE };
      return {
        kind: "connected",
        address: state.address,
        short: shortenAddress(state.address),
        chain: chainLabel(state.chainId),
        title:
          `Connected wallet ${state.address}` +
          (chainLabel(state.chainId) ? ` on ${chainLabel(state.chainId)}` : "") +
          ". Connection only — it does not sign you in or unlock account data.",
      };
    case "unavailable":
      return { kind: "unavailable", message: walletErrorMessage("NO_PROVIDER") };
    case "error":
      return {
        kind: "error",
        message: walletErrorMessage(state.error ?? "UNKNOWN"),
        code: state.error ?? "UNKNOWN",
      };
    default:
      return { kind: "connect", title: CONNECT_TITLE };
  }
}

/**
 * What a click on the single wallet button should do.
 *
 * No choice to make → connect immediately, exactly the pre-discovery behaviour.
 * A choice → open the menu. The label never changes, so the topbar stays one
 * control however many wallets are installed.
 */
export function walletClickAction(
  providers: readonly DiscoveredProvider[],
  view: WalletControlView,
): "connect" | "menu" {
  if (view.kind === "connected") return "connect";
  return providers.length > 1 ? "menu" : "connect";
}

/**
 * What the user can do after a failed connection.
 *
 * "Retry" only ever re-asks the *same* wallet. With one wallet that is the whole
 * story. With several, the wallet that failed may simply be the wrong one — a
 * locked extension, or the one that owns `window.ethereum` rather than the one
 * the user meant — so the choice has to stay reachable. It did not: the error
 * view replaced the picker, and the only offered action was to retry the same
 * provider forever.
 */
export function walletErrorRecovery(
  providers: readonly DiscoveredProvider[],
): "retry" | "choose" {
  return providers.length > 1 ? "choose" : "retry";
}

/** One letter used as an icon stand-in when a wallet ships no usable artwork. */
export function walletInitial(name: string): string {
  const first = [...name.trim()][0] ?? "?";
  return first.toUpperCase();
}

/** Tooltip for a per-wallet button. Same claim as CONNECT_TITLE, per wallet. */
export function walletChoiceTitle(name: string): string {
  return `Connect ${name}. Connection only: no sign-in, no account data, no trading.`;
}

/**
 * The control while a connection is in a failed state.
 *
 * One pill that says what happened, plus exactly one way forward. With a single
 * wallet installed that is "Retry", because there is nothing else to try. With
 * more than one, the correct affordance is the picker: the wallet that failed
 * may not be the one the user meant, and retrying it forever is a dead end.
 */
export function WalletErrorControl(props: {
  message: string;
  providers: readonly DiscoveredProvider[];
  menuOpen: boolean;
  menu: ReactNode;
  onToggleMenu: () => void;
  onRetry: () => void;
  wrapRef?: Ref<HTMLSpanElement>;
}) {
  const recovery = walletErrorRecovery(props.providers);
  return (
    <span className="wallet-cluster">
      <span className="pill down wallet-pill" title={props.message} aria-live="polite">
        Wallet error
      </span>
      {recovery === "retry" ? (
        <button type="button" className="btn sm" onClick={props.onRetry}>
          Retry
        </button>
      ) : (
        <span className="wallet-picker" ref={props.wrapRef}>
          <button
            type="button"
            className="btn sm wallet-menu-toggle"
            aria-haspopup="menu"
            aria-expanded={props.menuOpen}
            onClick={props.onToggleMenu}
            title={`${props.message} Choose another wallet.`}
          >
            Choose wallet
            <span className="wallet-menu-caret" aria-hidden="true">
              ▾
            </span>
          </button>
          {props.menu}
        </span>
      )}
    </span>
  );
}

export function WalletButton() {
  const { state, connect, disconnect } = useWalletConnection();
  const { providers, choose } = useWalletProviders();
  const view = describeWalletControl(state);
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement | null>(null);

  // Close on Escape and on any click outside, the two things a menu must honour.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && wrapRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [menuOpen]);

  // A wallet that disappears (extension disabled) must not leave a stale menu.
  useEffect(() => {
    if (providers.length <= 1) setMenuOpen(false);
  }, [providers.length]);

  const pick = useCallback(
    (uuid: string) => {
      setMenuOpen(false);
      choose(uuid);
      void connect();
    },
    [choose, connect],
  );

  /**
   * The picker's menu. `errorMessage` is carried into the panel so a user who
   * opens it after a failure still sees why the last attempt failed.
   */
  const renderMenu = (errorMessage: string | null) => (
    <>
      {/* Phone-only scrim. It dims the page and gives a large, obvious way out;
          on desktop the panel stays a plain dropdown with no overlay. */}
      <span
        className="wallet-scrim"
        aria-hidden="true"
        onClick={() => setMenuOpen(false)}
      />
      <div className="wallet-menu" role="menu" aria-label="Choose a wallet">
      <p className="wallet-menu-title">Connect a wallet</p>
      {errorMessage && (
        <p className="wallet-menu-error" role="status">
          {errorMessage}
        </p>
      )}
      <div className="wallet-menu-list" role="group" aria-label="Detected wallets">
        {providers.map((entry) => (
          <button
            key={entry.info.uuid}
            type="button"
            role="menuitem"
            className="wallet-menu-item"
            onClick={() => pick(entry.info.uuid)}
            title={walletChoiceTitle(entry.info.name)}
          >
            {entry.info.icon ? (
              <img
                className="wallet-menu-icon"
                src={entry.info.icon}
                alt=""
                aria-hidden="true"
                width={24}
                height={24}
                loading="lazy"
                decoding="async"
              />
            ) : (
              <span className="wallet-menu-icon wallet-menu-initial" aria-hidden="true">
                {walletInitial(entry.info.name)}
              </span>
            )}
            <span className="wallet-menu-name">{entry.info.name}</span>
            <span className="wallet-menu-tag">Detected</span>
          </button>
        ))}
      </div>
      <p className="wallet-menu-foot">
        Connection only — no sign-in, no account data, no trading.
      </p>
      </div>
    </>
  );

  if (view.kind === "hidden") return null;

  if (view.kind === "pending") {
    return (
      <span className="pill wallet-pill" aria-live="polite">
        <span className="dot" />
        Connecting…
      </span>
    );
  }

  if (view.kind === "connected") {
    return (
      <span className="wallet-cluster">
        <span className="pill up wallet-pill" title={view.title} aria-live="polite">
          <span className="dot live" />
          <span className="mono">{view.short}</span>
        </span>
        {view.chain && <span className="pill wallet-pill">{view.chain}</span>}
        <button
          type="button"
          className="btn sm wallet-disconnect"
          onClick={disconnect}
          title="Disconnect in PolyTools. This does not revoke the site in your wallet."
        >
          Disconnect
        </button>
      </span>
    );
  }

  // An EIP-6963-only wallet owns no `window.ethereum`, so "No wallet" would be a
  // lie; the button must be offered even when the legacy probe found nothing.
  if (view.kind === "unavailable" && providers.length === 0) {
    return (
      <span className="pill wallet-pill" title={view.message} aria-live="polite">
        No wallet
      </span>
    );
  }

  if (view.kind === "error") {
    return (
      <WalletErrorControl
        message={view.message}
        providers={providers}
        menuOpen={menuOpen}
        wrapRef={wrapRef}
        menu={menuOpen ? renderMenu(view.message) : null}
        onToggleMenu={() => setMenuOpen((open) => !open)}
        onRetry={() => void connect()}
      />
    );
  }

  const action = walletClickAction(providers, view);
  const label = "Connect wallet";

  if (action === "connect") {
    return (
      <button
        type="button"
        className="btn sm wallet-connect"
        onClick={() => {
          // A single announced wallet may not be the one `window.ethereum` gave
          // us, so point the connection at it before the explicit gesture.
          if (providers.length === 1) choose(providers[0].info.uuid);
          void connect();
        }}
        title={view.kind === "connect" ? view.title : CONNECT_TITLE}
      >
        {label}
      </button>
    );
  }

  return (
    <span className="wallet-picker" ref={wrapRef}>
      <button
        type="button"
        className="btn sm wallet-connect wallet-menu-toggle"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
        title="Choose a browser wallet. Connection only: no sign-in, no account data, no trading."
      >
        {label}
        <span className="wallet-menu-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {menuOpen && renderMenu(null)}
    </span>
  );
}
