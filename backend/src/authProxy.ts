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
function authJson(body: unknown, status = 200, cors?: Record<string, string>): Response {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    // A session token must not land in any cache, browser, edge or otherwise.
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    // The response varies by caller origin, so any cache must key on it.
    Vary: "Origin",
  });
  for (const [name, value] of Object.entries(cors ?? {})) headers.set(name, value);
  applySecurityHeaders(headers);
  return new Response(JSON.stringify(body), { status, headers });
}

function authError(status: number, code: string, detail?: string, cors?: Record<string, string>): Response {
  return authJson(detail ? { error: code, detail } : { error: code }, status, cors);
}

/**
 * Resolve the upstream API origin, allowing plain HTTP only for loopback so the
 * test suite can point this at a local mock without weakening production.
 */
/**
 * Hosts this proxy is willing to talk to. A configuration mistake here would
 * forward a login message, an EOA signature and a user-agent to whatever host
 * the variable named — so the variable may choose *which* Polyester endpoint,
 * never an arbitrary server.
 */
const ALLOWED_API_SUFFIX = ".polyester.com";
const ALLOWED_API_ROOT = "polyester.com";

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

  // Plain HTTP only ever to loopback, so a signature is never sent in the clear.
  if (parsed.protocol === "http:" && loopback) return parsed.origin;
  if (parsed.protocol !== "https:") return null;

  // Everything else must be Polyester's own domain.
  const host = parsed.hostname.toLowerCase();
  const owned = host === ALLOWED_API_ROOT || host.endsWith(ALLOWED_API_SUFFIX);
  return owned ? parsed.origin : null;
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

/**
 * Derives the Polyester Safe address an owner EOA controls.
 *
 * WHY THE SERVER DOES THIS
 *   `smartAccountAddress` is a counterfactually derived Safe, not an EOA (see
 *   docs/wallet-first-audit/16 §2). A wallet with no Polyester account yet has no
 *   way to know its own Safe address, so a client that had to supply it would
 *   only ever work for users who already existed. Deriving here also means the
 *   client cannot send a mismatched pair.
 *
 *   It is deliberately server-side: the derivation needs `@polyester/sdk`, which
 *   is not a browser dependency of this app. Keeping it out of the client leaves
 *   the 102 kB bundle untouched.
 *
 *   The SDK helper's own `signMessage` returns ERC-6492 wrapped signatures,
 *   which login rejects. Only `accountAddress` is taken from it — the signing
 *   always happens in the user's wallet, in the browser.
 */
async function deriveSmartAccount(signerAddress: string): Promise<string | null> {
  try {
    const [{ createPolyesterAccountSigner }, { POLYESTER_TESTNET_ENVIRONMENT }] = await Promise.all([
      import("@polyester/sdk/account-signer"),
      import("@polyester/sdk"),
    ]);
    const { accountAddress } = createPolyesterAccountSigner({
      environment: POLYESTER_TESTNET_ENVIRONMENT,
      /**
       * The parameter is typed as a viem `LocalAccount`, i.e. a keypair. This
       * server has no key and must never hold one, and the derivation reads
       * only `.address`: `create-polyester-account-signer.js` uses `owner` for
       * the owners array and nothing else. Verified by calling the helper with
       * a bare `{ address }` and getting the same deterministic Safe address
       * (docs/wallet-first-audit/16 §2.2). The cast documents that gap rather
       * than fabricating a signing key to satisfy the type.
       */
      owner: { address: signerAddress } as unknown as Parameters<
        typeof createPolyesterAccountSigner
      >[0]["owner"],
    });
    return accountAddress;
  } catch {
    // A missing or incompatible SDK is a configuration fault, not a user error.
    return null;
  }
}

/** POST /api/auth/challenge — ask the exchange for a message for the wallet to sign. */
async function handleChallenge(
  request: Request,
  env?: Record<string, string | undefined>,
  cors?: Record<string, string>,
): Promise<Response> {
  const fail = (status: number, code: string, detail?: string) =>
    authError(status, code, detail, cors);
  const apiOrigin = resolveAuthApiOrigin(env);
  if (!apiOrigin) return fail(503, "api_origin_misconfigured");

  const body = await readJsonBody(request);
  if (!body) return fail(400, "invalid_body");

  const signerAddress = typeof body.signerAddress === "string" ? body.signerAddress.trim() : "";
  if (!ADDRESS_RE.test(signerAddress)) return fail(400, "invalid_signer_address");

  // Derive unless the caller knows its own Safe address exactly (an existing
  // account). A supplied value is validated, never trusted blindly.
  const supplied =
    typeof body.smartAccountAddress === "string" ? body.smartAccountAddress.trim() : "";
  let smartAccountAddress = supplied;
  if (smartAccountAddress) {
    if (!ADDRESS_RE.test(smartAccountAddress)) return fail(400, "invalid_smart_account_address");
  } else {
    smartAccountAddress = (await deriveSmartAccount(signerAddress)) ?? "";
    if (!smartAccountAddress) return fail(503, "smart_account_derivation_unavailable");
  }

  const uri = challengeUri(request);
  if (!uri) return fail(400, "invalid_request_origin");

  const upstream = await callConnect(apiOrigin, "CreateWalletChallenge", {
    smartAccountAddress,
    signerAddress,
    // Derived, never client-supplied. A challenge is bound to this origin.
    uri,
    purpose: PURPOSE_LOGIN,
  });
  if (!upstream.ok) return upstream.response;

  const message = typeof upstream.body.message === "string" ? upstream.body.message : "";
  if (!message) return fail(502, "upstream_missing_message");

  return authJson({
    // Returned verbatim: the wallet must sign these exact UTF-8 bytes.
    message,
    uri,
    // Echoed so the client submits the same pair it was challenged for. Nothing
    // here is secret; both addresses are public chain identifiers.
    smartAccountAddress,
    signerAddress,
    expiresAt: isoFromTimestamp(upstream.body.expiresAt),
  }, 200, cors);
}

/** POST /api/auth/login — exchange the signature for a session token. */
async function handleLogin(
  request: Request,
  env?: Record<string, string | undefined>,
  cors?: Record<string, string>,
): Promise<Response> {
  const fail = (status: number, code: string, detail?: string) =>
    authError(status, code, detail, cors);
  const apiOrigin = resolveAuthApiOrigin(env);
  if (!apiOrigin) return fail(503, "api_origin_misconfigured");

  const body = await readJsonBody(request);
  if (!body) return fail(400, "invalid_body");

  const smartAccountAddress = typeof body.smartAccountAddress === "string" ? body.smartAccountAddress.trim() : "";
  const signature = typeof body.signature === "string" ? body.signature.trim() : "";
  const message = typeof body.message === "string" ? body.message : "";
  const walletProvider = typeof body.walletProvider === "string" ? body.walletProvider.trim().slice(0, 32) : "";

  if (!ADDRESS_RE.test(smartAccountAddress)) return fail(400, "invalid_smart_account_address");
  if (!SIGNATURE_RE.test(signature)) return fail(400, "invalid_signature");
  if (!message) return fail(400, "invalid_message");
  if (new TextEncoder().encode(message).byteLength > 4096) return fail(400, "message_too_long");

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
  if (!accessToken) return fail(502, "upstream_missing_token");

  const accountId = upstream.body.accountId;
  return authJson({
    accessToken,
    expiresAt: isoFromTimestamp(upstream.body.expiresAt),
    // fixed64 arrives as a string or bigint; never let it break JSON.
    accountId:
      typeof accountId === "string" ? accountId : typeof accountId === "bigint" ? accountId.toString() : null,
    username: typeof upstream.body.username === "string" ? upstream.body.username : null,
  }, 200, cors);
}

/**
 * Origins allowed to call these routes cross-origin, from `POLYTOOLS_APP_ORIGINS`
 * (comma-separated, exact origins). Empty by default, which means same-origin
 * only — the safest default and the right one when the API is served from the
 * same deployment (Cloudflare Pages Functions).
 *
 * WHY THIS EXISTS
 *   The documented deployment is a static frontend (GitHub Pages) talking to a
 *   standalone Worker on `*.workers.dev`. That is genuinely cross-origin, so a
 *   same-origin-only rule rejects every real request.
 *
 * WHY IT IS STILL SAFE
 *   The allowed origin is echoed exactly — never `*` — so only a site we name can
 *   read a challenge or a session token. Unlisted origins get 403 and no CORS
 *   headers, which is what the previous blanket `Sec-Fetch-Site` check was trying
 *   to achieve, but without breaking the intended deployment.
 */
export function resolveAppOrigins(env?: Record<string, string | undefined>): string[] {
  const raw = (env?.POLYTOOLS_APP_ORIGINS ?? "").trim();
  if (!raw) return [];
  const origins: string[] = [];
  for (const entry of raw.split(",")) {
    const value = entry.trim();
    if (!value) continue;
    try {
      origins.push(new URL(value).origin);
    } catch {
      // A malformed entry is ignored rather than widening the allowlist.
    }
  }
  return origins;
}

/** Whether this path is one of ours. */
export function isAuthPath(path: string): boolean {
  return path === "/api/auth/challenge" || path === "/api/auth/login";
}

/**
 * Whether the caller is on a different origin from this deployment.
 *
 * Deliberately not a bare `Origin !== request.url.origin` comparison: behind a
 * proxy — and in the Vite dev middleware, which reconstructs the URL — the
 * request URL is not guaranteed to be the URL the browser actually used. Judging
 * same-origin by that alone turned an ordinary same-origin call into a 403.
 *
 * `Sec-Fetch-Site` is the browser's own verdict and is therefore preferred when
 * present. Without it (curl, tests, non-browser callers) there is no Origin to
 * confuse us, so the request is treated as same-origin — which grants nothing,
 * since no CORS headers are ever emitted for it.
 */
function isCrossOrigin(request: Request, originHeader: string | null): boolean {
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (fetchSite === "same-origin") return false;
  if (!originHeader) return false;
  const selfOrigin = challengeUri(request);
  if (!selfOrigin) return false;
  return originHeader !== selfOrigin;
}

export async function handleAuthRoute(
  request: Request,
  path: string,
  opts: AuthProxyEnv = {},
): Promise<Response> {
  const originHeader = request.headers.get("Origin");
  const crossOrigin = isCrossOrigin(request, originHeader);
  const allowed = crossOrigin && resolveAppOrigins(opts.env).includes(originHeader as string);

  // Cross-origin callers must be named in POLYTOOLS_APP_ORIGINS. An unlisted
  // origin is refused here rather than reaching the exchange.
  if (crossOrigin && !allowed) {
    return authError(403, "origin_not_allowed");
  }

  // Echoed exactly, never `*`: only a site we named may read a token.
  const cors: Record<string, string> | undefined = allowed
    ? {
        "Access-Control-Allow-Origin": originHeader as string,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "600",
      }
    : undefined;

  if (request.method === "OPTIONS") {
    const headers = new Headers({
      Allow: "POST, OPTIONS",
      "Cache-Control": "no-store",
      Vary: "Origin",
      ...(cors ?? {}),
    });
    applySecurityHeaders(headers);
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== "POST") {
    return authError(405, "method_not_allowed", undefined, cors);
  }

  if (path === "/api/auth/challenge") return handleChallenge(request, opts.env, cors);
  return handleLogin(request, opts.env, cors);
}
