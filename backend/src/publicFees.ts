/**
 * The public VIP fee schedule, read straight from Polyester's REST API.
 *
 * Why this is a direct REST call rather than an MCP tool call: the MCP endpoint
 * this app uses exposes no VIP/fee tool, but `GET /v1/vip/tiers` is a public
 * operation (`vip.v1.VIPService/ListVIPTiers`, no authentication). Serving it
 * from our own backend keeps the browser talking to `/api` only, so the CSP
 * `connect-src` does not grow another origin, and it lets one shared cache
 * absorb the traffic instead of every tab polling the exchange.
 *
 * Scope, so it never gets overstated: this is the *catalog*. It is not the rate
 * a specific fill paid — that lives in account activity and requires a session.
 */

import {
  parseVipFeeSchedule,
  VipFeeScheduleError,
  type VipFeeSchedule,
} from "../../packages/core/src/index";

/** Public REST host. Same origin the auth proxy already uses. */
export const DEFAULT_PUBLIC_API_ORIGIN = "https://api.testnet.polyester.com";

export type VipFeeScheduleErrorCode =
  /** DNS/TLS/timeout — the exchange could not be reached at all. */
  | "tiers_unreachable"
  /** A non-2xx answer from the exchange. */
  | "tiers_error"
  /** A 2xx answer that does not satisfy the published contract. */
  | "tiers_invalid_response";

export type VipFeeScheduleResult =
  | { ok: true; schedule: VipFeeSchedule }
  | { ok: false; status: number; code: VipFeeScheduleErrorCode; detail?: string };

export interface VipFeeScheduleOptions {
  origin?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Fetches and validates the catalog.
 *
 * A 10s timeout matches the other outbound reads in this backend: long enough
 * for a cold TLS handshake, short enough that a wedged upstream cannot hold a
 * request open until the platform kills it.
 */
export async function fetchVipFeeSchedule(
  options: VipFeeScheduleOptions = {},
): Promise<VipFeeScheduleResult> {
  const origin = (options.origin ?? DEFAULT_PUBLIC_API_ORIGIN).replace(/\/+$/, "");
  const doFetch = options.fetchImpl ?? fetch;
  const signal = options.signal ?? AbortSignal.timeout(10_000);

  let response: Response;
  try {
    response = await doFetch(`${origin}/v1/vip/tiers`, {
      headers: { Accept: "application/json" },
      signal,
    });
  } catch {
    return { ok: false, status: 502, code: "tiers_unreachable" };
  }

  if (!response.ok) {
    return {
      ok: false,
      status: 502,
      code: "tiers_error",
      detail: `exchange responded ${response.status}`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, status: 502, code: "tiers_invalid_response" };
  }

  try {
    return { ok: true, schedule: parseVipFeeSchedule(body) };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      code: "tiers_invalid_response",
      detail: error instanceof VipFeeScheduleError ? error.code : undefined,
    };
  }
}
