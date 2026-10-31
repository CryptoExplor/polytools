/**
 * Verified Connect RPC surface of the Polyester testnet API.
 *
 * WHY THIS FILE EXISTS
 *   The SDK guide page used to describe endpoints from memory and from the SDK
 *   reference alone. This catalogue is different: every entry is a call that was
 *   observed working in an independent, non-SDK client AND is declared in the
 *   installed SDK's generated protos. The companion test
 *   (`tests/api-surface.test.mjs`) parses `@polyester/sdk/dist/gen/**` and fails
 *   if any entry here stops existing — so the page cannot silently drift.
 *
 * WHAT IS CLAIMED, AND WHAT IS NOT
 *   - `verifiedBy` records exactly why each row is listed. `"protos"` means the
 *     RPC is declared in the installed SDK. `"working-client"` means an
 *     independent client was seen calling it successfully.
 *   - `auth` is stated ONLY where the official SDK reference states it. Where
 *     that is not documented, it is `"unspecified"` rather than guessed.
 *   - `mode` is derived from the method name and is about side effects, not
 *     permissions. PolyTools is a read-only tool: the companion test asserts
 *     that no `"write"` entry is referenced by application code.
 *
 * Nothing here executes a request. This module is data plus pure lookups.
 */

/** Transport style. The API exposes both a Connect RPC surface and a REST one. */
export type SurfaceTransport = "connect-rpc";

/**
 * Only documented claims appear here. `unspecified` is deliberate: guessing an
 * auth requirement is how a guide starts lying to the people who trust it.
 */
export type SurfaceAuth = "public" | "session" | "interactive-session" | "unspecified";

export type SurfaceMode = "read" | "write";

export interface SurfaceEntry {
  /** `package.Service/Method`, exactly as sent on the wire. */
  rpc: string;
  service: string;
  method: string;
  /** Short, neutral description of what the call returns or does. */
  summary: string;
  auth: SurfaceAuth;
  mode: SurfaceMode;
  /** Request field names observed in the working client. */
  requestKeys: readonly string[];
  /** Response field names observed in the working client. */
  responseKeys: readonly string[];
  /** Why this row is trusted. */
  verifiedBy: readonly ("protos" | "working-client")[];
  /** Present when the payload shape carries a caveat worth showing. */
  note?: string;
  /**
   * Set only where a method name and its side effect disagree. Kept explicit
   * instead of silently special-casing the name rule in the test.
   */
  modeNote?: string;
}

/**
 * Field-encoding facts that the app relies on when reading real payloads.
 * Recorded here because they are the kind of detail that is easy to guess wrong.
 */
export const ENCODING_NOTES = Object.freeze({
  priceTicks:
    "Prices arrive as integer ticks. Divide by 10^referencePriceScale from that pair's GetSpotConfig entry (the working client defaults to 9 when absent) — not by a fixed 1e9.",
  qtyScaled:
    "Base quantities arrive in units of 10^-baseQuantityScale from the pair. A fixed 1e6 divider is only correct for pairs that happen to use scale 6.",
  u128Amounts:
    "Token amounts are unsigned 128-bit, carried as { hi, lo } and reconstructed as hi * 2^64 + lo, then divided by 1e18. Reading only `lo` truncates silently.",
  symbolId:
    "Order book and order calls take the numeric `symbolId` from GetSpotConfig, not the 'BTC-USDT' display symbol.",
});

export const API_SURFACE: readonly SurfaceEntry[] = Object.freeze([
  {
    rpc: "auth.v1.AuthService/CreateWalletChallenge",
    service: "auth.v1.AuthService",
    method: "CreateWalletChallenge",
    summary: "Request a single-use EIP-4361 login message bound to a browser origin.",
    auth: "public",
    mode: "write",
    requestKeys: ["smartAccountAddress", "signerAddress", "uri", "purpose"],
    responseKeys: ["message", "expiresAt"],
    verifiedBy: ["protos", "working-client"],
    note: "`purpose` is the enum WalletChallengePurpose; LOGIN = 1. Classified `write` because it creates a single-use server-side nonce — it changes nothing about an account, but it is not a pure read either.",
  },
  {
    rpc: "auth.v1.AuthService/LoginWithWallet",
    service: "auth.v1.AuthService",
    method: "LoginWithWallet",
    summary: "Exchange the signed challenge for a session token.",
    auth: "unspecified",
    mode: "write",
    requestKeys: ["smartAccountAddress", "message", "signature", "walletProvider"],
    responseKeys: ["accessToken", "expiresAt", "accountId", "username"],
    verifiedBy: ["protos", "working-client"],
    note: "The message is forwarded byte-exact; the signature must be the owner EOA's raw 65-byte EIP-191 signature.",
  },
  {
    rpc: "auth.v1.AuthService/Me",
    service: "auth.v1.AuthService",
    method: "Me",
    summary: "Read the identity behind the presented token or API key.",
    auth: "session",
    mode: "read",
    requestKeys: [],
    responseKeys: ["accountId", "username", "apiKeyId", "session"],
    verifiedBy: ["protos", "working-client"],
    note: "SDK 0.31.0 declares no `rootSmartAccountAddress` field on this response.",
  },
  {
    rpc: "auth.v1.AuthService/AcceptTerms",
    service: "auth.v1.AuthService",
    method: "AcceptTerms",
    summary: "Record consent to the current terms for the root account.",
    auth: "interactive-session",
    mode: "write",
    requestKeys: [],
    responseKeys: [],
    verifiedBy: ["protos", "working-client"],
    note: "Documented as requiring an interactive JWT; API keys cannot accept terms.",
  },
  {
    rpc: "auth.v1.ProfileService/GetProfile",
    service: "auth.v1.ProfileService",
    method: "GetProfile",
    summary: "Read the caller's public profile.",
    auth: "unspecified",
    mode: "read",
    requestKeys: [],
    responseKeys: [],
    verifiedBy: ["protos", "working-client"],
  },
  {
    rpc: "auth.v1.ProfileService/UpdateProfile",
    service: "auth.v1.ProfileService",
    method: "UpdateProfile",
    summary: "Update public profile fields.",
    auth: "unspecified",
    mode: "write",
    requestKeys: [],
    responseKeys: [],
    verifiedBy: ["protos", "working-client"],
  },
  {
    rpc: "auth.v1.SocialVerificationService/GetSocialVerification",
    service: "auth.v1.SocialVerificationService",
    method: "GetSocialVerification",
    summary: "Read the state of a social verification.",
    auth: "unspecified",
    mode: "read",
    requestKeys: ["provider"],
    responseKeys: [],
    verifiedBy: ["protos", "working-client"],
  },
  {
    rpc: "auth.v1.SocialVerificationService/StartSocialVerification",
    service: "auth.v1.SocialVerificationService",
    method: "StartSocialVerification",
    summary: "Start a social verification for a provider and handle.",
    auth: "unspecified",
    mode: "write",
    requestKeys: ["provider", "handle", "method"],
    responseKeys: [],
    verifiedBy: ["protos", "working-client"],
  },
  {
    rpc: "auth.v1.SocialVerificationService/SocialVerificationReady",
    service: "auth.v1.SocialVerificationService",
    method: "SocialVerificationReady",
    summary: "Mark a verification ready for the backend to check.",
    auth: "unspecified",
    mode: "write",
    requestKeys: ["provider"],
    responseKeys: [],
    verifiedBy: ["protos", "working-client"],
  },
  {
    rpc: "chain.deposit.v1.DepositAddressService/ListDepositAddresses",
    service: "chain.deposit.v1.DepositAddressService",
    method: "ListDepositAddresses",
    summary: "List deposit addresses, optionally filtered by chain and subaccount.",
    auth: "unspecified",
    mode: "read",
    requestKeys: ["chainId", "subaccountId"],
    responseKeys: [],
    verifiedBy: ["protos", "working-client"],
  },
  {
    rpc: "chain.deposit.v1.DepositAddressService/CreateDepositAddress",
    service: "chain.deposit.v1.DepositAddressService",
    method: "CreateDepositAddress",
    summary: "Create a deposit address for a chain and subaccount.",
    auth: "unspecified",
    mode: "write",
    requestKeys: ["chainId", "subaccountId"],
    responseKeys: [],
    verifiedBy: ["protos", "working-client"],
  },
  {
    rpc: "claims.v1.ClaimsService/GetDailyClaimStatus",
    service: "claims.v1.ClaimsService",
    method: "GetDailyClaimStatus",
    summary: "Read whether the daily reward is claimable.",
    auth: "unspecified",
    mode: "read",
    requestKeys: [],
    responseKeys: ["state", "resetAt"],
    verifiedBy: ["protos", "working-client"],
  },
  {
    rpc: "claims.v1.ClaimsService/ClaimDailyReward",
    service: "claims.v1.ClaimsService",
    method: "ClaimDailyReward",
    summary: "Claim the daily reward when available.",
    auth: "unspecified",
    mode: "write",
    requestKeys: [],
    responseKeys: [],
    verifiedBy: ["protos", "working-client"],
  },
  {
    rpc: "ledger.read.v1.LedgerReadService/GetBalances",
    service: "ledger.read.v1.LedgerReadService",
    method: "GetBalances",
    summary: "Read account balances for a subaccount.",
    auth: "unspecified",
    mode: "read",
    requestKeys: ["subaccountId"],
    responseKeys: ["balances"],
    verifiedBy: ["protos", "working-client"],
    note: "Each balance carries trading/funding buckets of u128 { hi, lo } amounts. Asset ids 1 and 2 are USDT and USDC.",
  },
  {
    rpc: "marketdata.v1.MarketDataService/GetSpotConfig",
    service: "marketdata.v1.MarketDataService",
    method: "GetSpotConfig",
    summary: "Read spot pair configuration: ids, scales and display names.",
    auth: "unspecified",
    mode: "read",
    requestKeys: [],
    responseKeys: ["spotPairs"],
    verifiedBy: ["protos", "working-client"],
    note: "Source of `symbolId`, `referencePriceScale` and `baseQuantityScale` — every price and quantity decode depends on it.",
  },
  {
    rpc: "orderbook.v1.OrderbookService/GetOrderBook",
    service: "orderbook.v1.OrderbookService",
    method: "GetOrderBook",
    summary: "Read aggregated bid and ask levels for a symbol.",
    auth: "unspecified",
    mode: "read",
    requestKeys: ["symbolId", "depth"],
    responseKeys: ["bids", "asks"],
    verifiedBy: ["protos", "working-client"],
    note: "Levels carry `priceTicks`; divide by the pair's referencePriceScale.",
  },
  {
    rpc: "orders.v1.OrdersReadService/GetOpenOrders",
    service: "orders.v1.OrdersReadService",
    method: "GetOpenOrders",
    summary: "List currently open orders for a subaccount.",
    auth: "unspecified",
    mode: "read",
    requestKeys: ["subaccountId"],
    responseKeys: ["orders"],
    verifiedBy: ["protos", "working-client"],
  },
  {
    rpc: "orders.v1.OrdersReadService/GetOrderHistory",
    service: "orders.v1.OrdersReadService",
    method: "GetOrderHistory",
    summary: "List historical orders for a subaccount.",
    auth: "unspecified",
    mode: "read",
    requestKeys: ["subaccountId"],
    responseKeys: ["orders"],
    verifiedBy: ["protos", "working-client"],
  },
  {
    rpc: "orders.v1.OrdersReadService/GetUserTrades",
    service: "orders.v1.OrdersReadService",
    method: "GetUserTrades",
    summary: "List the caller's fills.",
    auth: "unspecified",
    mode: "read",
    requestKeys: [],
    responseKeys: ["trades"],
    verifiedBy: ["protos", "working-client"],
    note: "Fills carry `priceTicks`, `qtyScaled`, `feeAmountE18` { hi, lo } and `matchId`.",
  },
  {
    rpc: "orders.v1.OrdersService/PreviewOrder",
    service: "orders.v1.OrdersService",
    method: "PreviewOrder",
    summary: "Ask the exchange whether an order intent is admissible, without placing it.",
    auth: "unspecified",
    mode: "read",
    requestKeys: ["subaccountId", "order"],
    responseKeys: ["admissible", "resolvedBaseQtyScaled", "protectedPriceBoundTicks"],
    verifiedBy: ["protos", "working-client"],
    note: "Admission only — it does not place anything.",
  },
  {
    rpc: "orders.v1.OrdersService/CreateOrder",
    service: "orders.v1.OrdersService",
    method: "CreateOrder",
    summary: "Place an order.",
    auth: "unspecified",
    mode: "write",
    requestKeys: ["subaccountId", "order"],
    responseKeys: [],
    verifiedBy: ["protos", "working-client"],
  },
  {
    rpc: "orders.v1.OrdersService/CancelOrder",
    service: "orders.v1.OrdersService",
    method: "CancelOrder",
    summary: "Cancel an order.",
    auth: "unspecified",
    mode: "write",
    requestKeys: [],
    responseKeys: [],
    verifiedBy: ["protos", "working-client"],
  },
]);

/** Group order used by the UI; unlisted services sort alphabetically after these. */
const SERVICE_ORDER = [
  "auth.v1.AuthService",
  "auth.v1.ProfileService",
  "auth.v1.SocialVerificationService",
  "marketdata.v1.MarketDataService",
  "orderbook.v1.OrderbookService",
  "orders.v1.OrdersReadService",
  "orders.v1.OrdersService",
  "ledger.read.v1.LedgerReadService",
  "claims.v1.ClaimsService",
  "chain.deposit.v1.DepositAddressService",
];

export function findSurface(rpc: string): SurfaceEntry | null {
  return API_SURFACE.find((entry) => entry.rpc === rpc) ?? null;
}

export function surfaceByService(): { service: string; entries: SurfaceEntry[] }[] {
  const groups = new Map<string, SurfaceEntry[]>();
  for (const entry of API_SURFACE) {
    const list = groups.get(entry.service);
    if (list) list.push(entry);
    else groups.set(entry.service, [entry]);
  }
  const rank = (service: string) => {
    const index = SERVICE_ORDER.indexOf(service);
    return index === -1 ? SERVICE_ORDER.length : index;
  };
  return [...groups.entries()]
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([service, entries]) => ({ service, entries }));
}

export function surfaceCounts(): { total: number; reads: number; writes: number } {
  const writes = API_SURFACE.filter((entry) => entry.mode === "write").length;
  return { total: API_SURFACE.length, reads: API_SURFACE.length - writes, writes };
}

export function matchesSurfaceQuery(entry: SurfaceEntry, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    entry.rpc.toLowerCase().includes(needle) ||
    entry.summary.toLowerCase().includes(needle) ||
    entry.requestKeys.some((key) => key.toLowerCase().includes(needle)) ||
    entry.responseKeys.some((key) => key.toLowerCase().includes(needle))
  );
}
