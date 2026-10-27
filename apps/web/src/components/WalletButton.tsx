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

import {
  chainLabel,
  shortenAddress,
  walletErrorMessage,
  type WalletState,
} from "../lib/walletConnection";
import { useWalletConnection } from "../lib/useWallet";

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

export function WalletButton() {
  const { state, connect, disconnect } = useWalletConnection();
  const view = describeWalletControl(state);

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

  if (view.kind === "unavailable") {
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

  return (
    <button
      type="button"
      className="btn sm wallet-connect"
      onClick={() => void connect()}
      title={view.title}
    >
      Connect wallet
    </button>
  );
}
