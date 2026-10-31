/**
 * React binding for the injected-wallet connection.
 *
 * Kept separate from `walletConnection.ts` so the state machine stays
 * framework-free, and separate from `store.tsx` so wallet identity never enters
 * the app's market/account store. Nothing here reads or writes the API-key
 * vault or `AccountSessionOwner`.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  INITIAL_WALLET_STATE,
  getWalletConnection,
  type InjectedProvider,
  type WalletConnection,
  type WalletState,
} from "./walletConnection";
import { discoverProviders, type DiscoveredProvider } from "./walletDiscovery";

export interface WalletBinding {
  state: WalletState;
  connect: () => Promise<WalletState>;
  disconnect: () => void;
  /** The provider this connection selected. Needed by the signer. */
  getProvider: () => InjectedProvider | null;
}

export function useWalletConnection(
  connection: WalletConnection = getWalletConnection(),
): WalletBinding {
  // `start()` attaches provider listeners and performs one silent
  // `eth_accounts` read. It never prompts and never touches the exchange.
  useEffect(() => {
    connection.start();
  }, [connection]);

  const state = useSyncExternalStore(
    connection.subscribe,
    connection.getSnapshot,
    () => INITIAL_WALLET_STATE,
  );

  const connect = useCallback(() => connection.connect(), [connection]);
  const disconnect = useCallback(() => connection.disconnect(), [connection]);

  // Wrapped, not passed by reference: `getProvider` reads `this.provider`, so
  // handing the method over unbound makes `this` undefined at the call site.
  const getProvider = useCallback(() => connection.getProvider(), [connection]);

  return { state, connect, disconnect, getProvider };
}

/**
 * EIP-6963 discovery binding. Selection only — it points the connection at a
 * different injected provider; it does not connect, sign, or talk to anything
 * remote. With one wallet (or none) the list stays short and the button keeps
 * its single-wallet behaviour exactly.
 */
export interface WalletProvidersBinding {
  providers: DiscoveredProvider[];
  selectedUuid: string | null;
  choose: (uuid: string) => void;
}

export function useWalletProviders(
  connection: WalletConnection = getWalletConnection(),
): WalletProvidersBinding {
  const [providers, setProviders] = useState<DiscoveredProvider[]>([]);
  const [selectedUuid, setSelectedUuid] = useState<string | null>(null);

  // Announcements are synchronous replies, so this settles in one tick on a
  // normal page; the hook never blocks rendering and never fetches.
  useEffect(() => {
    let live = true;
    void discoverProviders().then((result) => {
      if (live) setProviders(result.providers);
    });
    return () => {
      live = false;
    };
  }, []);

  const choose = useCallback(
    (uuid: string) => {
      const match = providers.find((entry) => entry.info.uuid === uuid);
      if (!match) return;
      connection.setProvider(match.provider);
      setSelectedUuid(uuid);
    },
    [connection, providers],
  );

  return { providers, selectedUuid, choose };
}
