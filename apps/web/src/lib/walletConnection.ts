/**
 * Injected EOA wallet connection — connection only, nothing else.
 *
 * SCOPE BOUNDARY (deliberate, and enforced by tests):
 *  - This module talks to the injected provider and nothing else. No exchange
 *    request, no vault access, no account session, no `fetch`.
 *  - It does not import `accountSessionOwner`, `@poly/core` account modules, or
 *    the signer. Wallet state and account state are independent by design.
 *  - A connected address is NOT proof of exchange authentication and grants no
 *    account authorization. Stage 2b (SIWE) is a separate, unstarted stage with
 *    its own gates; see docs/wallet-first-audit/12 §4 and 05 Stage 2a.
 *
 * The class is framework-free and takes its provider by injection so the whole
 * state machine is testable without a browser.
 */

export type WalletStatus =
  | "detecting"
  | "unavailable"
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

/** Our own stable codes. Provider text never reaches the UI or the logs. */
export type WalletErrorCode =
  | "NO_PROVIDER"
  | "USER_REJECTED"
  | "REQUEST_PENDING"
  | "UNAUTHORIZED"
  | "DISCONNECTED"
  | "CHAIN_DISCONNECTED"
  | "INVALID_ADDRESS"
  | "INVALID_RESPONSE"
  | "UNKNOWN";

export interface WalletState {
  status: WalletStatus;
  /** Lowercased 0x-prefixed address, or null. */
  address: string | null;
  /** Decimal chain id as a string (EIP-155 hex is normalised), or null. */
  chainId: string | null;
  error: WalletErrorCode | null;
  updatedAtMs: number | null;
}

/** The minimal EIP-1193 surface this feature needs. */
export interface InjectedProvider {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

export const INITIAL_WALLET_STATE: WalletState = Object.freeze({
  status: "detecting",
  address: null,
  chainId: null,
  error: null,
  updatedAtMs: null,
});

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/** EIP-55 checksumming is not needed to display or compare; we lowercase. */
export function normalizeAddress(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return ADDRESS_PATTERN.test(trimmed) ? trimmed.toLowerCase() : null;
}

/** Accepts `0x1`, `0x01`, or a decimal string; returns a decimal string. */
export function normalizeChainId(value: unknown): string | null {
  if (typeof value === "bigint") return value >= 0n ? value.toString() : null;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;
  try {
    if (/^0x[0-9a-fA-F]+$/.test(raw)) return BigInt(raw).toString();
    if (/^[0-9]+$/.test(raw)) return raw;
  } catch {
    return null;
  }
  return null;
}

/** EIP-1193 / EIP-1474 error codes, mapped to ours. */
export function classifyWalletError(error: unknown): WalletErrorCode {
  if (typeof error !== "object" || error === null) return "UNKNOWN";
  const code = (error as { code?: unknown }).code;
  if (code === 4001) return "USER_REJECTED";
  if (code === -32002) return "REQUEST_PENDING";
  if (code === 4100) return "UNAUTHORIZED";
  if (code === 4900) return "DISCONNECTED";
  if (code === 4901) return "CHAIN_DISCONNECTED";
  return "UNKNOWN";
}

/**
 * User-facing copy. Written to be true without over-claiming: none of these say
 * anything about an exchange account, because a wallet says nothing about one.
 */
export function walletErrorMessage(code: WalletErrorCode): string {
  switch (code) {
    case "NO_PROVIDER":
      return "No browser wallet detected. Install or enable one to connect.";
    case "USER_REJECTED":
      return "Connection request was declined in your wallet.";
    case "REQUEST_PENDING":
      return "Your wallet already has a pending request. Open it and finish that first.";
    case "UNAUTHORIZED":
      return "Your wallet has not authorized this site.";
    case "DISCONNECTED":
      return "The wallet reported that it is disconnected.";
    case "CHAIN_DISCONNECTED":
      return "The wallet reported that this chain is disconnected.";
    case "INVALID_ADDRESS":
      return "The wallet returned an address this app cannot read.";
    case "INVALID_RESPONSE":
      return "The wallet returned a response this app cannot read.";
    default:
      return "The wallet connection failed. No account data was requested.";
  }
}

/** `0x1234…abcd` */
export function shortenAddress(address: string): string {
  return address.length === 42 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

const CHAIN_NAMES: Record<string, string> = {
  "1": "Ethereum",
  "11155111": "Sepolia",
  "17000": "Holesky",
  "8453": "Base",
  "42161": "Arbitrum One",
  "137": "Polygon",
  "10": "Optimism",
  "888168": "Polyester devnet",
  "888169": "Polyester testnet",
};

export function chainLabel(chainId: string | null): string | null {
  if (!chainId) return null;
  return CHAIN_NAMES[chainId] ?? `Chain ${chainId}`;
}

type Listener = () => void;

export interface WalletConnectionOptions {
  /** Provider lookup. Called once by `start()`; returning null means unavailable. */
  detect?: () => InjectedProvider | null;
  now?: () => number;
}

/**
 * Connection state machine. Owns no DOM beyond the provider it is given, and no
 * persistence: a reload starts from `detecting` again, which is honest — injected
 * wallets keep their own authorization.
 */
export class WalletConnection {
  private readonly detect: () => InjectedProvider | null;
  private readonly now: () => number;
  private provider: InjectedProvider | null = null;
  private listeners = new Set<Listener>();
  private state: WalletState = INITIAL_WALLET_STATE;
  private started = false;
  private disposed = false;
  /**
   * Guards against a late silent-restore overwriting a newer explicit result.
   * Same late-response principle as AccountSessionOwner's identity guards.
   */
  private generation = 0;
  private readonly onAccountsChanged = (...args: unknown[]) => {
    this.handleAccountsChanged(Array.isArray(args[0]) ? args[0] : []);
  };
  private readonly onChainChanged = (...args: unknown[]) => {
    this.handleChainChanged(args[0]);
  };
  private readonly onDisconnect = () => {
    this.setState({ status: "disconnected", address: null, chainId: null, error: null });
  };

  constructor(options: WalletConnectionOptions = {}) {
    this.detect = options.detect ?? (() => defaultDetect());
    this.now = options.now ?? (() => Date.now());
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): WalletState => this.state;

  /** Idempotent. Attaches listeners and reads any already-authorized account. */
  start(): void {
    if (this.started || this.disposed) return;
    this.started = true;
    const provider = this.detect();
    if (!provider) {
      this.setState({ status: "unavailable", address: null, chainId: null, error: null });
      return;
    }
    this.provider = provider;
    provider.on?.("accountsChanged", this.onAccountsChanged);
    provider.on?.("chainChanged", this.onChainChanged);
    provider.on?.("disconnect", this.onDisconnect);
    void this.restoreSilently();
  }

  /**
   * Reads `eth_accounts`, which never prompts. Distinguishes "already authorized
   * in this wallet" from "needs a user gesture", so the button label is accurate.
   */
  private async restoreSilently(): Promise<void> {
    const provider = this.provider;
    if (!provider) return;
    const generation = this.generation;
    const isCurrent = () => !this.disposed && this.generation === generation;
    try {
      const accounts = await provider.request({ method: "eth_accounts" });
      if (!isCurrent()) return;
      const list = Array.isArray(accounts) ? accounts : [];
      if (list.length === 0) {
        this.setState({ status: "disconnected", address: null, chainId: null, error: null });
        return;
      }
      const address = normalizeAddress(list[0]);
      if (!address) {
        this.setState({ status: "error", address: null, chainId: null, error: "INVALID_ADDRESS" });
        return;
      }
      const chainId = await this.readChainId(provider);
      if (!isCurrent()) return;
      this.setState({ status: "connected", address, chainId, error: null });
    } catch (error) {
      if (!isCurrent()) return;
      // A silent read must never surface an alarming error state; treat as
      // "not connected" and let an explicit click produce the real error.
      this.setState({
        status: "disconnected",
        address: null,
        chainId: null,
        error: classifyWalletError(error) === "USER_REJECTED" ? null : "UNKNOWN",
      });
    }
  }

  /** Explicit user gesture. The only call that may show a wallet prompt. */
  async connect(): Promise<WalletState> {
    if (this.disposed) return this.state;
    if (!this.started) this.start();
    const provider = this.provider;
    if (!provider) {
      this.setState({ status: "unavailable", address: null, chainId: null, error: "NO_PROVIDER" });
      return this.state;
    }
    // Invalidate any in-flight silent restore: an explicit gesture is newer.
    this.generation += 1;
    this.setState({ status: "connecting", address: null, chainId: null, error: null });
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      const list = Array.isArray(accounts) ? accounts : [];
      const address = normalizeAddress(list[0]);
      if (!address) {
        this.setState({ status: "error", address: null, chainId: null, error: "INVALID_ADDRESS" });
        return this.state;
      }
      const chainId = await this.readChainId(provider);
      this.setState({ status: "connected", address, chainId, error: null });
    } catch (error) {
      this.setState({
        status: "error",
        address: null,
        chainId: null,
        error: classifyWalletError(error),
      });
    }
    return this.state;
  }

  /**
   * Local only. An injected provider exposes no revocation method: clearing this
   * state does not tell the wallet to forget the site, and the app must not claim
   * otherwise. `restoreSilently()` on the next load may reconnect for that reason.
   */
  disconnect(): void {
    if (this.disposed) return;
    this.generation += 1;
    this.setState({ status: "disconnected", address: null, chainId: null, error: null });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const provider = this.provider;
    provider?.removeListener?.("accountsChanged", this.onAccountsChanged);
    provider?.removeListener?.("chainChanged", this.onChainChanged);
    provider?.removeListener?.("disconnect", this.onDisconnect);
    this.provider = null;
    this.listeners.clear();
  }

  /** Exposed for tests and for the UI's manual refresh of chain identity. */
  handleAccountsChanged(accounts: readonly unknown[]): void {
    if (this.disposed) return;
    if (accounts.length === 0) {
      this.setState({ status: "disconnected", address: null, chainId: null, error: null });
      return;
    }
    const address = normalizeAddress(accounts[0]);
    if (!address) {
      this.setState({ status: "error", address: null, chainId: null, error: "INVALID_ADDRESS" });
      return;
    }
    this.setState({ status: "connected", address, error: null, chainId: this.state.chainId });
  }

  handleChainChanged(chainId: unknown): void {
    if (this.disposed) return;
    const normalized = normalizeChainId(chainId);
    if (!normalized) {
      this.setState({ error: "INVALID_RESPONSE" });
      return;
    }
    // A chain switch must not change who is connected, and must not disconnect.
    this.setState({ chainId: normalized });
  }

  private async readChainId(provider: InjectedProvider): Promise<string | null> {
    try {
      return normalizeChainId(await provider.request({ method: "eth_chainId" }));
    } catch {
      return null;
    }
  }

  private setState(patch: Partial<WalletState>): void {
    if (this.disposed) return;
    const next: WalletState = { ...this.state, ...patch };
    const unchanged =
      next.status === this.state.status &&
      next.address === this.state.address &&
      next.chainId === this.state.chainId &&
      next.error === this.state.error;
    if (unchanged) return;
    this.state = { ...next, updatedAtMs: this.now() };
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // A subscriber must not be able to break connection state.
      }
    }
  }
}

/** `window.ethereum` if present. Guards against non-browser and SSR contexts. */
export function defaultDetect(): InjectedProvider | null {
  if (typeof window === "undefined") return null;
  const candidate = (window as unknown as { ethereum?: unknown }).ethereum;
  if (!candidate || typeof candidate !== "object") return null;
  if (typeof (candidate as InjectedProvider).request !== "function") return null;
  return candidate as InjectedProvider;
}

let singleton: WalletConnection | null = null;

/** App-level instance. Tests construct their own; this is only the wiring. */
export function getWalletConnection(): WalletConnection {
  singleton ??= new WalletConnection();
  return singleton;
}
