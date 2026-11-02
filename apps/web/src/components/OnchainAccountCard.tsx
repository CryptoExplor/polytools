import { useCallback, useEffect, useState } from "react";
import { Card, EmptyState } from "./ui";
import { useWalletConnection } from "../lib/useWallet";
import {
  deriveSmartAccountAddress,
  fetchOnchainBalances,
  type OnchainBalance,
} from "../lib/onchainAccount";

type Phase =
  | { kind: "idle" }
  | { kind: "loading"; address: string }
  | { kind: "ready"; address: string; rows: OnchainBalance[] }
  | { kind: "error"; message: string };

const short = (value: string) => `${value.slice(0, 6)}…${value.slice(-4)}`;

/**
 * Shows the smart account and its on-chain holdings for the connected wallet.
 *
 * Deliberately does not touch the exchange: no challenge, no signature, no token.
 * The boundary between what is chain-visible and what needs a session is stated on
 * the card rather than left to be discovered.
 */
export function OnchainAccountCard() {
  const { state } = useWalletConnection();
  const address = state.address;
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  const load = useCallback(async (signer: string, signal: AbortSignal) => {
    setPhase({ kind: "loading", address: signer });
    try {
      const smartAccount = await deriveSmartAccountAddress(signer);
      if (signal.aborted) return;
      const rows = await fetchOnchainBalances(smartAccount);
      if (signal.aborted) return;
      setPhase({ kind: "ready", address: smartAccount, rows });
    } catch (error) {
      if (signal.aborted) return;
      setPhase({
        kind: "error",
        message:
          error instanceof Error && error.message.length < 120
            ? error.message
            : "the lookup failed",
      });
    }
  }, []);

  useEffect(() => {
    if (!address) {
      setPhase({ kind: "idle" });
      return;
    }
    const controller = new AbortController();
    void load(address, controller.signal);
    return () => controller.abort();
  }, [address, load]);

  return (
    <Card
      title="Your account on-chain"
      subtitle="Funding balances read from the chain. No login, no signature."
    >
      {!address ? (
        <EmptyState
          title="Connect a wallet to see your account"
          description="Your Polyester account is a smart account, so its funding balances are public chain data."
        />
      ) : phase.kind === "loading" ? (
        <p className="faint mb-0" role="status">
          Looking up {short(address)} on-chain…
        </p>
      ) : phase.kind === "error" ? (
        <p className="mb-0" role="alert">
          Could not read the chain: {phase.message}.{" "}
          <button type="button" className="btn sm" onClick={() => void load(address, new AbortController().signal)}>
            Try again
          </button>
        </p>
      ) : phase.kind === "ready" ? (
        <>
          <p className="faint mb-0">
            Smart account <span className="mono">{phase.address}</span>
          </p>
          {phase.rows.length === 0 ? (
            <p className="faint mb-0" style={{ marginTop: 8 }}>
              No token balances on Ethereum Sepolia. A new account holds nothing until it is funded.
            </p>
          ) : (
            <div className="table-wrap" style={{ marginTop: 8 }}>
              <table className="data">
                <thead>
                  <tr>
                    <th scope="col">Asset</th>
                    <th scope="col">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {phase.rows.map((row) => (
                    <tr key={row.address}>
                      <td>
                        <span className="mono">{row.symbol}</span>
                        {row.name && <span className="faint"> · {row.name}</span>}
                      </td>
                      <td className="mono">{row.formatted ?? row.raw}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="faint mb-0" style={{ marginTop: 8 }}>
            Trading balances and open orders live in the exchange&apos;s matching engine, not on-chain,
            so they are not shown here.
          </p>
        </>
      ) : null}
    </Card>
  );
}
