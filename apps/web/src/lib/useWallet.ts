/**
 * React binding for the injected-wallet connection.
 *
 * Kept separate from `walletConnection.ts` so the state machine stays
 * framework-free, and separate from `store.tsx` so wallet identity never enters
 * the app's market/account store. Nothing here reads or writes the API-key
 * vault or `AccountSessionOwner`.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  INITIAL_WALLET_STATE,
  getWalletConnection,
  type WalletConnection,
  type WalletState,
} from "./walletConnection";

export interface WalletBinding {
  state: WalletState;
  connect: () => Promise<WalletState>;
  disconnect: () => void;
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

  return { state, connect, disconnect };
}
