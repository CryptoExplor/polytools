/**
 * React binding for the Polyester wallet session.
 *
 * The one rule that matters here: **connecting a wallet never authenticates.**
 * `signIn()` is a separate, explicit call, and it is the only path to a token.
 * The hook exposes which of the three states the UI should show and nothing
 * else — no token, no account data, no auto-refresh.
 */

import { useCallback, useState, useSyncExternalStore } from "react";
import {
  getPolyesterSessionStore,
  login,
  PolyesterLoginError,
  type LoginFailure,
  type PolyesterSessionStore,
} from "./polyesterSession";
import type { InjectedProvider } from "./walletConnection";

export interface SessionBinding {
  /** True only when a token is held in memory. */
  authenticated: boolean;
  signingIn: boolean;
  error: { code: LoginFailure; message: string } | null;
  accountId: string | null;
  username: string | null;
  signIn: (provider: InjectedProvider, address: string) => Promise<boolean>;
  signOut: () => void;
}

/** Copy for a failed sign-in. Every line is true without over-claiming. */
export function sessionErrorMessage(code: LoginFailure, detail?: string): string {
  switch (code) {
    case "rejected":
      return "Sign-in was declined in your wallet.";
    case "pending":
      return "Your wallet already has a pending request. Open it and finish that first.";
    case "unauthorized":
      return "Your wallet has not authorized this site.";
    case "malformed_signature":
      return "Your wallet returned a signature this app cannot read.";
    case "exchange_refused":
      // The exchange understood the request and rejected it for account reasons
      // (terms, an already-linked Safe, a failed wallet login). Nothing about the
      // deployment or the origin is at fault.
      return detail
        ? `Polyester rejected the sign-in: ${detail}`
        : "Polyester rejected the sign-in for this account.";

    case "origin_rejected":
      // Three different refusals arrive here and they mean different things, so
      // the copy names the layer rather than blaming "the exchange" generally.
      if (detail && /cf-mitigated|browser challenge|cf-ray|challenge-platform/i.test(detail)) {
        // The API's edge treated our server's request as a bot. This is not
        // about our origin and not about the user's wallet.
        return `Polyester's edge blocked the sign-in request before it reached the API (${detail}).`;
      }
      if (detail && /^HTTP \d{3}|^upstream_\d{3}$/.test(detail)) {
        return `Polyester returned an unreadable refusal (${detail}).`;
      }
      return detail
        ? `Polyester refused this site's origin: ${detail}`
        : "Polyester refused this site's origin. Sign-in cannot work from this deployment.";
    case "origin_not_allowed":
      // This deployment refused the call before Polyester ever saw it.
      return detail
        ? `This deployment refused the request: ${detail}`
        : "This deployment refused the request before it reached Polyester.";
    case "endpoint_unreachable":
      // Usually a static host being asked for a route only the backend serves.
      return "The sign-in endpoint is not reachable from this deployment. Nothing was signed in.";
    case "upstream_unreachable":
      return "Could not reach Polyester. Nothing was signed in or changed.";
    case "no_wallet":
      return "No wallet is available to sign in.";
    default:
      return "Sign-in failed. Nothing was signed in or changed.";
  }
}

export function usePolyesterSession(
  store: PolyesterSessionStore = getPolyesterSessionStore(),
): SessionBinding {
  const session = useSyncExternalStore(store.subscribe, store.getSnapshot, () => null);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<SessionBinding["error"]>(null);

  const signIn = useCallback(
    async (provider: InjectedProvider, address: string): Promise<boolean> => {
      setSigningIn(true);
      setError(null);
      try {
        const next = await login({ provider, address });
        store.set(next);
        return true;
      } catch (failure) {
        if (failure instanceof PolyesterLoginError) {
          setError({
            code: failure.code,
            message: sessionErrorMessage(failure.code, failure.detail),
          });
        } else {
          setError({ code: "unknown" as LoginFailure, message: sessionErrorMessage("unknown") });
        }
        // A failed sign-in leaves no token: never a half-authenticated state.
        store.set(null);
        return false;
      } finally {
        setSigningIn(false);
      }
    },
    [store],
  );

  const signOut = useCallback(() => {
    store.clear();
    setError(null);
  }, [store]);

  return {
    authenticated: Boolean(session),
    signingIn,
    error,
    accountId: session?.accountId ?? null,
    username: session?.username ?? null,
    signIn,
    signOut,
  };
}
