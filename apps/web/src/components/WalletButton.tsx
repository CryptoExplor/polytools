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

/** Tooltip for a per-wallet button. Same claim as CONNECT_TITLE, per wallet. */
export function walletChoiceTitle(name: string): string {
  return `Connect ${name}. Connection only: no sign-in, no account data, no trading.`;
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
      <span className="wallet-cluster">
        <span className="pill down wallet-pill" title={view.message} aria-live="polite">
          Wallet error
        </span>
        <button type="button" className="btn sm" onClick={() => void connect()}>
          Retry
        </button>
      </span>
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
      {menuOpen && (
        <div className="wallet-menu" role="menu" aria-label="Choose a wallet">
          {providers.map((entry) => (
            <button
              key={entry.info.uuid}
              type="button"
              role="menuitem"
              className="wallet-menu-item"
              onClick={() => pick(entry.info.uuid)}
              title={walletChoiceTitle(entry.info.name)}
            >
              {entry.info.name}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
