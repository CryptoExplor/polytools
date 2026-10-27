/**
 * Wallet login, headless (server-side transport).
 *
 * WHY THIS EXISTS
 *   The exchange's API sends no `Access-Control-Allow-Origin` to a browser
 *   preflight from our origin, so a direct in-page call to the auth service
 *   never leaves the page. The browser cannot do this. A server can: no CORS
 *   applies between servers, so the same call works from the Pages Function
 *   that already fronts this app.
 *
 *   So the browser talks to us, and we talk to the exchange. Two routes:
 *
 *     POST /api/auth/challenge  -> auth.v1.AuthService/CreateWalletChallenge
 *     POST /api/auth/login      -> auth.v1.AuthService/LoginWithWallet
 *
 * WHAT IT WILL NOT DO
 *   - Never sees a private key or seed phrase. The signature is produced by the
 *     user's wallet, in their browser, over the exact message we return. The
 *     server only relays an already-signed payload.
 *   - Never invents the `uri`. It is derived from the incoming request's own
 *     origin and the client's value is ignored, so this endpoint cannot be used
 *     to mint a challenge claiming somebody else's origin.
 *   - Never logs. No token, signature, message or address is written anywhere.
 *     The bearer token goes straight back to the caller and is not stored.
 *   - Never sets `Access-Control-Allow-Origin` on its responses: only a
 *     same-origin page may read a token out of them.
 *   - Places no orders and touches no account state. Challenge issuance is
 *     read-only; login exchanges a signature for a session token.
 *
 * HONESTY NOTE
 *   Whether the exchange issues a challenge for *our* origin at all is still
 *   unverified — that is the C-1 gate. If it pins origins, this route will
 *   faithfully relay the refusal and login will not work even headless. That
 *   outcome is a real answer, not a bug to paper over.
 */

import { applySecurityHeaders } from "../../packages/core/src/deploymentSecurity";

/** Default API origin. Testnet until mainnet is announced. */
const DEFAULT_API_ORIGIN = "https://api.testnet.polyester.com";

/** Body cap. A login body is two addresses, a 65-byte signature and a message. */
const MAX_BODY_BYTES = 8192;

/** Upstream call budget. The exchange is a CDN; slow is a failure. */
const UPSTREAM_TIMEOUT_MS = 10_000;

/**
 * Connect's JSON encoding writes an enum as its **name**, not its number.
 * Verified by pointing the installed SDK's own client at a capture server:
 * `{"smartAccountAddress":…,"signerAddress":…,"uri":…,"purpose":"LOGIN"}`.
 * Unspecified (0) is not a login, so the value is never omitted.
 */
const PURPOSE_LOGIN = "LOGIN";

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
/** 65 bytes, optional 0x, per the proto's own description. */
const SIGNATURE_RE = /^(?:0x)?[0-9a-fA-F]{130}$/;

export interface AuthProxyEnv {
  env?: Record<string, string | undefined>;
}

type Json = Record<string, unknown>;

/** Auth responses are same-origin only: no `Access-Control-Allow-Origin`. */
function authJson(body: unknown, status = 200): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    // A session token must not land in any cache, browser, edge or otherwise.
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  applySecurityHeaders(headers);
  return new Response(JSON.stringify(body), { status, headers });
}

function authError(status: number, code: string, detail?: string): Response {
  return authJson(detail ? { error: code, detail } : { error: code }, status);
}

/**
 * Resolve the upstream API origin, allowing plain HTTP only for loopback so the
 * test suite can point this at a local mock without weakening production.
 */
export function resolveAuthApiOrigin(env?: Record<string, string | undefined>): string | null {
  const raw = (env?.POLYESTER_API_ORIGIN ?? DEFAULT_API_ORIGIN).trim();
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const loopback =
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "::1" ||
    parsed.hostname === "localhost";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    return null;
  }
  return parsed.origin;
}

/**
 * The origin the challenge will bind. Taken from the request itself — the
 * client cannot choose it. Falls back to the `Origin` header only if the
 * request URL carries no usable origin, which should not happen behind the
 * adapters this app ships.
 */
export function challengeUri(request: Request): string | null {
  const candidates = [new URL(request.url).origin, request.headers.get("Origin") ?? ""];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.origin;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

async function readJsonBody(request: Request): Promise<Json | null> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;
  const text = await request.text();
  // Byte length, not string length: a multi-byte body must not slip past the cap.
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return null;
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Json;
  } catch {
    return null;
  }
}

/** Timestamp from the wire is `{seconds, nanos}` as JSON; surface ISO or null. */
function isoFromTimestamp(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const seconds = (value as Json).seconds;
  const numeric = typeof seconds === "string" ? Number(seconds) : seconds;
  if (typeof numeric !== "number" || !Number.isFinite(numeric) || numeric <= 0) return null;
  const ms = numeric * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function callConnect(
  origin: string,
  method: string,
  payload: Json,
): Promise<{ ok: true; body: Json } | { ok: false; response: Response }> {
  let res: Response;
  try {
    res = await fetch(`${origin}/auth.v1.AuthService/${method}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch {
    // The message may name the host but never a credential; both are absent here.
    return { ok: false, response: authError(502, "upstream_unreachable") };
  }

  const text = await res.text();
  let parsed: Json | null = null;
  try {
    parsed = text ? (JSON.parse(text) as Json) : null;
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    // Connect errors are `{code, message}`. Relay the exchange's own words so a
    // refusal is legible instead of flattened into a generic failure.
    const upstreamCode = typeof parsed?.code === "string" ? parsed.code : null;
    const upstreamMessage = typeof parsed?.message === "string" ? parsed.message : null;
    return {
      ok: false,
      response: authError(
        res.status >= 500 ? 502 : res.status,
        upstreamCode ?? `upstream_${res.status}`,
        upstreamMessage ?? undefined,
      ),
    };
  }

  return { ok: true, body: parsed ?? {} };
}

/** POST /api/auth/challenge — ask the exchange for a message for the wallet to sign. */
async function handleChallenge(request: Request, env?: Record<string, string | undefined>): Promise<Response> {
  const apiOrigin = resolveAuthApiOrigin(env);
  if (!apiOrigin) return authError(503, "api_origin_misconfigured");

  const body = await readJsonBody(request);
  if (!body) return authError(400, "invalid_body");

  const smartAccountAddress = typeof body.smartAccountAddress === "string" ? body.smartAccountAddress.trim() : "";
  const signerAddress = typeof body.signerAddress === "string" ? body.signerAddress.trim() : "";
  if (!ADDRESS_RE.test(smartAccountAddress)) return authError(400, "invalid_smart_account_address");
  if (!ADDRESS_RE.test(signerAddress)) return authError(400, "invalid_signer_address");

  const uri = challengeUri(request);
  if (!uri) return authError(400, "invalid_request_origin");

  const upstream = await callConnect(apiOrigin, "CreateWalletChallenge", {
    smartAccountAddress,
    signerAddress,
    // Derived, never client-supplied. A challenge is bound to this origin.
    uri,
    purpose: PURPOSE_LOGIN,
  });
  if (!upstream.ok) return upstream.response;

  const message = typeof upstream.body.message === "string" ? upstream.body.message : "";
  if (!message) return authError(502, "upstream_missing_message");

  return authJson({
    // Returned verbatim: the wallet must sign these exact UTF-8 bytes.
    message,
    uri,
    expiresAt: isoFromTimestamp(upstream.body.expiresAt),
  });
}

/** POST /api/auth/login — exchange the signature for a session token. */
async function handleLogin(request: Request, env?: Record<string, string | undefined>): Promise<Response> {
  const apiOrigin = resolveAuthApiOrigin(env);
  if (!apiOrigin) return authError(503, "api_origin_misconfigured");

  const body = await readJsonBody(request);
  if (!body) return authError(400, "invalid_body");

  const smartAccountAddress = typeof body.smartAccountAddress === "string" ? body.smartAccountAddress.trim() : "";
  const signature = typeof body.signature === "string" ? body.signature.trim() : "";
  const message = typeof body.message === "string" ? body.message : "";
  const walletProvider = typeof body.walletProvider === "string" ? body.walletProvider.trim().slice(0, 32) : "";

  if (!ADDRESS_RE.test(smartAccountAddress)) return authError(400, "invalid_smart_account_address");
  if (!SIGNATURE_RE.test(signature)) return authError(400, "invalid_signature");
  if (!message) return authError(400, "invalid_message");
  if (new TextEncoder().encode(message).byteLength > 4096) return authError(400, "message_too_long");

  const upstream = await callConnect(apiOrigin, "LoginWithWallet", {
    smartAccountAddress,
    signature,
    message,
    walletProvider: walletProvider || "other",
    // Audit metadata the exchange may record. Only what the request itself
    // carries — we do not guess a client IP.
    userAgent: (request.headers.get("User-Agent") ?? "").slice(0, 512),
  });
  if (!upstream.ok) return upstream.response;

  const accessToken = typeof upstream.body.accessToken === "string" ? upstream.body.accessToken : "";
  if (!accessToken) return authError(502, "upstream_missing_token");

  const accountId = upstream.body.accountId;
  return authJson({
    accessToken,
    expiresAt: isoFromTimestamp(upstream.body.expiresAt),
    // fixed64 arrives as a string or bigint; never let it break JSON.
    accountId:
      typeof accountId === "string" ? accountId : typeof accountId === "bigint" ? accountId.toString() : null,
    username: typeof upstream.body.username === "string" ? upstream.body.username : null,
  });
}

/** Whether this path is one of ours. */
export function isAuthPath(path: string): boolean {
  return path === "/api/auth/challenge" || path === "/api/auth/login";
}

export async function handleAuthRoute(
  request: Request,
  path: string,
  opts: AuthProxyEnv = {},
): Promise<Response> {
  if (request.method === "OPTIONS") {
    // Same-origin only: no `Access-Control-Allow-Origin` is ever emitted.
    const headers = new Headers({ Allow: "POST, OPTIONS", "Cache-Control": "no-store" });
    applySecurityHeaders(headers);
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") {
    return authError(405, "method_not_allowed");
  }

  // A cross-site caller should never reach the upstream, even if a future
  // change re-opens CORS by accident.
  if (request.headers.get("Sec-Fetch-Site") === "cross-site") {
    return authError(403, "cross_site_blocked");
  }

  if (path === "/api/auth/challenge") return handleChallenge(request, opts.env);
  return handleLogin(request, opts.env);
}
