/**
 * EIP-6963 multi-provider discovery — wallet *selection* only.
 *
 * WHY THIS EXISTS
 *   Only one extension can own the legacy `window.ethereum` property. When two
 *   EVM wallets are installed the loser cannot install a provider at all (its
 *   `Object.defineProperty` throws `Cannot redefine property: ethereum`), so a
 *   single-global read silently hides a wallet the user actually has. EIP-6963
 *   fixes the *discovery* half: wallets announce themselves on an event instead
 *   of fighting over one property, and the user picks.
 *
 * SCOPE BOUNDARY (same as `walletConnection.ts`, enforced by tests):
 *   - Discovery only. No exchange request, no vault, no session, no `fetch`.
 *   - Announcements are untrusted input from page-adjacent extension code:
 *     everything is validated, and nothing is rendered as HTML.
 *   - A discovered provider grants nothing. It is not an account session.
 *
 * The target is injected so the whole thing is testable without a browser.
 */

import type { InjectedProvider } from "./walletConnection";

export const EIP6963_ANNOUNCE = "eip6963:announceProvider";
export const EIP6963_REQUEST = "eip6963:requestProvider";

/** Long enough for a slow extension, short enough not to delay first paint. */
export const DEFAULT_DISCOVERY_MS = 300;

/** Display names are third-party strings; bound them before they reach the UI. */
const MAX_NAME_LENGTH = 32;

/**
 * Wallets ship their logo as an inline data URI in the announcement. Anything
 * else is someone else's URL: loading it would leak a request to a third party
 * on page load, so it is refused rather than proxied or rendered.
 */
const MAX_ICON_LENGTH = 12_288;
const ICON_PATTERN = /^data:image\/(?:svg\+xml|png|webp|jpeg|jpg);base64,[A-Za-z0-9+/]+={0,2}$/;

export interface ProviderInfo {
  /** Stable per-announcement id; used as the React key and the selection id. */
  uuid: string;
  /** Human name shown on the button, already trimmed and length-bounded. */
  name: string;
  /** Reverse-DNS id, e.g. `io.metamask`. Empty when the wallet omits it. */
  rdns: string;
  /**
   * Inline logo as a base64 data URI, or null. Never a remote URL and never raw
   * markup: it is handed to `<img src>`, so it cannot execute even as SVG.
   */
  icon: string | null;
}

export interface DiscoveredProvider {
  info: ProviderInfo;
  provider: InjectedProvider;
}

export type DiscoverySource = "eip6963" | "legacy" | "none";

export interface DiscoveryResult {
  providers: DiscoveredProvider[];
  source: DiscoverySource;
}

/** The slice of `EventTarget`/`window` discovery needs. */
export interface DiscoveryTarget {
  addEventListener(type: string, listener: (event: unknown) => void): void;
  removeEventListener(type: string, listener: (event: unknown) => void): void;
  dispatchEvent(event: unknown): boolean;
}

interface LegacyProvider extends InjectedProvider {
  isMetaMask?: boolean;
  isPhantom?: boolean;
  isRabby?: boolean;
  isCoinbaseWallet?: boolean;
  isBraveWallet?: boolean;
  providers?: unknown[];
}

function isProviderLike(value: unknown): value is InjectedProvider {
  if (!value || typeof value !== "object") return false;
  return typeof (value as InjectedProvider).request === "function";
}

/**
 * Accepts only an inline base64 image, bounded in length. A remote URL, a
 * `javascript:` payload, raw (non-base64) SVG, or anything oversized returns
 * null and the menu falls back to a letter tile.
 */
export function sanitizeIcon(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_ICON_LENGTH) return null;
  return ICON_PATTERN.test(trimmed) ? trimmed : null;
}

/** Control characters and runs of whitespace would break the button label. */
function sanitizeName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return fallback;
  return cleaned.length > MAX_NAME_LENGTH ? `${cleaned.slice(0, MAX_NAME_LENGTH - 1)}…` : cleaned;
}

/**
 * Validates one `eip6963:announceProvider` payload. Returns null for anything
 * malformed rather than throwing: an extension must not be able to break the
 * control by announcing garbage.
 */
export function parseAnnouncement(event: unknown): DiscoveredProvider | null {
  if (!event || typeof event !== "object") return null;
  const detail = (event as { detail?: unknown }).detail;
  if (!detail || typeof detail !== "object") return null;
  const info = (detail as { info?: unknown }).info;
  const provider = (detail as { provider?: unknown }).provider;
  if (!info || typeof info !== "object" || !isProviderLike(provider)) return null;
  const uuid = (info as { uuid?: unknown }).uuid;
  if (typeof uuid !== "string" || !uuid.trim()) return null;
  const rdns = (info as { rdns?: unknown }).rdns;
  return {
    info: {
      uuid: uuid.trim(),
      name: sanitizeName((info as { name?: unknown }).name, "Browser wallet"),
      rdns: typeof rdns === "string" ? rdns.trim().slice(0, 128) : "",
      icon: sanitizeIcon((info as { icon?: unknown }).icon),
    },
    provider,
  };
}

function legacyName(provider: LegacyProvider): string {
  if (provider.isMetaMask) return "MetaMask";
  if (provider.isRabby) return "Rabby";
  if (provider.isPhantom) return "Phantom";
  if (provider.isCoinbaseWallet) return "Coinbase Wallet";
  if (provider.isBraveWallet) return "Brave Wallet";
  return "Browser wallet";
}

/**
 * The pre-EIP-6963 shape: either one `window.ethereum`, or several behind
 * `window.ethereum.providers`. Used only when nothing announced itself, so
 * existing single-wallet behaviour is untouched.
 */
export function legacyProviders(target: unknown): DiscoveredProvider[] {
  if (!target || typeof target !== "object") return [];
  const injected = (target as { ethereum?: unknown }).ethereum;
  if (!isProviderLike(injected)) return [];
  const legacy = injected as LegacyProvider;
  const nested = Array.isArray(legacy.providers) ? legacy.providers.filter(isProviderLike) : [];
  const list: InjectedProvider[] = nested.length > 0 ? nested : [injected];
  return list.map((provider, index) => {
    const named = provider as LegacyProvider;
    return {
      info: {
        uuid: `${named.isMetaMask ? "io.metamask" : "injected"}:${index}`,
        name: legacyName(named),
        rdns: named.isMetaMask ? "io.metamask" : "",
        // The legacy global exposes no artwork, and guessing a logo would mean
        // shipping brand assets for wallets we cannot identify reliably.
        icon: null,
      },
      provider,
    };
  });
}

/**
 * Collects announcements until the window closes, then falls back to the legacy
 * globals. Never rejects and never throws: a broken extension degrades to "no
 * wallet", which is the same state as having none installed.
 */
export async function discoverProviders(
  options: {
    target?: DiscoveryTarget | null;
    timeoutMs?: number;
  } = {},
): Promise<DiscoveryResult> {
  const resolvedTarget =
    options.target !== undefined
      ? options.target
      : typeof window !== "undefined"
        ? (window as unknown as DiscoveryTarget)
        : null;
  const timeoutMs = options.timeoutMs ?? DEFAULT_DISCOVERY_MS;

  const found = new Map<string, DiscoveredProvider>();
  const legacy = legacyProviders(resolvedTarget);

  // No target at all (SSR) or no event surface: report what the globals offer.
  if (!resolvedTarget || typeof resolvedTarget.addEventListener !== "function") {
    return legacy.length > 0
      ? { providers: legacy, source: "legacy" }
      : { providers: [], source: "none" };
  }

  const onAnnounce = (event: unknown) => {
    const parsed = parseAnnouncement(event);
    // First announcement from a uuid wins: a wallet re-announcing must not
    // reshuffle the order under the user's pointer.
    if (parsed && !found.has(parsed.info.uuid)) found.set(parsed.info.uuid, parsed);
  };

  await new Promise<void>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolvedTarget.removeEventListener(EIP6963_ANNOUNCE, onAnnounce);
      resolve();
    };
    try {
      resolvedTarget.addEventListener(EIP6963_ANNOUNCE, onAnnounce);
      // Announcements are synchronous replies to this event, so the timer only
      // has to cover providers that are still waking up.
      resolvedTarget.dispatchEvent(
        typeof CustomEvent === "function"
          ? new CustomEvent(EIP6963_REQUEST)
          : ({ type: EIP6963_REQUEST } as unknown),
      );
    } catch {
      finish();
      return;
    }
    timer = setTimeout(finish, Math.max(0, timeoutMs));
  });

  const announced = [...found.values()];
  if (announced.length > 0) return { providers: announced, source: "eip6963" };
  return legacy.length > 0
    ? { providers: legacy, source: "legacy" }
    : { providers: [], source: "none" };
}

/** Convenience for the UI: just the list. */
export async function listWallets(options?: {
  target?: DiscoveryTarget | null;
  timeoutMs?: number;
}): Promise<DiscoveredProvider[]> {
  return (await discoverProviders(options)).providers;
}
