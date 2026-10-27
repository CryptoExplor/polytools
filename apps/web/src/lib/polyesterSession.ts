/**
 * Polyester wallet session — the client half of login.
 *
 * Talks only to our own `/api/auth/*` routes. The exchange is never called from
 * the browser: it sends no `Access-Control-Allow-Origin` to this origin, so a
 * direct call cannot leave the page. The backend makes that call instead.
 *
 * SCOPE BOUNDARY (enforced by tests):
 *   - The bearer token lives in this module's memory and nowhere else. Not
 *     `localStorage`, not `sessionStorage`, not a URL, not a log. A reload signs
 *     you out, which is the deliberate trade for not persisting a credential.
 *   - No private key, no seed phrase, no auto-signing. Signing happens only
 *     inside `login()`, only on an explicit call.
 *   - The existing API-key path is untouched: this module shares no storage with
 *     it and never reads its vault.
 *   - Connecting a wallet does not call any of this. `login()` requires an
 *     address, and the caller must already have one.
 */

import { API_BASE } from "./api";
import type { InjectedProvider } from "./walletConnection";
import { signLoginMessage, WalletSignatureError, type SignFailure } from "./walletSigner";

export type SessionStatus = "anonymous" | "authenticating" | "authenticated";

/** The opaque session, held in memory only. */
export interface PolyesterSession {
  accessToken: string;
  accountId: string | null;
  username: string | null;
  expiresAt: string | null;
  /** The Safe address the session belongs to. */
  smartAccountAddress: string;
  signerAddress: string;
}

export type LoginFailure =
  | SignFailure
  | "origin_rejected"
  | "origin_not_allowed"
  | "endpoint_unreachable"
  | "upstream_unreachable"
  | "invalid_response"
  | "no_wallet";

export class PolyesterLoginError extends Error {
  readonly code: LoginFailure;
  readonly detail?: string;
  constructor(code: LoginFailure, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "PolyesterLoginError";
    this.code = code;
    this.detail = detail;
  }
}

export interface LoginInput {
  provider: InjectedProvider;
  address: string;
  /** Injectable for tests; defaults to the origin of the current page. */
  fetchImpl?: typeof fetch;
}

interface ChallengeBody {
  message?: unknown;
  smartAccountAddress?: unknown;
  signerAddress?: unknown;
  expiresAt?: unknown;
  error?: unknown;
  detail?: unknown;
}

interface LoginBody extends ChallengeBody {
  accessToken?: unknown;
  accountId?: unknown;
  username?: unknown;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Upstream refusals that mean "this deployment is not allowed to log in". */
const ORIGIN_REFUSAL_CODES = new Set(["permission_denied", "unauthenticated", "invalid_argument"]);

async function readJson(response: Response): Promise<ChallengeBody & LoginBody> {
  try {
    const parsed = (await response.json()) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as ChallengeBody & LoginBody)
      : {};
  } catch {
    return {};
  }
}

function failureFor(response: Response, body: ChallengeBody): PolyesterLoginError {
  const code = typeof body.error === "string" ? body.error : "";
  const detail = typeof body.detail === "string" ? body.detail : undefined;

  // OUR guard refused before the exchange was contacted. Reporting this as a
  // Polyester refusal would send the reader to the wrong place entirely.
  if (code === "origin_not_allowed" || code === "cross_site_blocked") {
    return new PolyesterLoginError("origin_not_allowed", detail ?? code);
  }

  // Genuinely could not complete the round trip.
  if (code === "upstream_unreachable" || response.status === 502 || response.status === 503) {
    return new PolyesterLoginError("upstream_unreachable", detail ?? code);
  }

  // The exchange — or something in front of it — refused. Our proxy prefixes
  // these with `upstream_` when the exchange answered without a Connect error
  // body, which is exactly what an edge block looks like. Never report this as
  // an unreachable endpoint: the request got an answer, just not the one we
  // wanted.
  if (code.startsWith("upstream_") || ORIGIN_REFUSAL_CODES.has(code)) {
    return new PolyesterLoginError("origin_rejected", detail ?? code);
  }

  // A 403 with no JSON body is not our proxy and not the exchange: something in
  // front of the backend (a static host, a proxy, a WAF) answered. On a static
  // deploy this is what you get when the API base points at the site itself.
  if (response.status === 403 || response.status === 404 || response.status === 405) {
    return new PolyesterLoginError("endpoint_unreachable", `HTTP ${response.status}`);
  }

  return new PolyesterLoginError("invalid_response", detail ?? (code || `HTTP ${response.status}`));
}

/**
 * Full login: challenge → wallet signature → session token.
 *
 * Every failure path throws; there is no optimistic "signed in" state. If the
 * exchange refuses our origin, that surfaces as `origin_rejected` with the
 * exchange's own words attached.
 */
export async function login(input: LoginInput): Promise<PolyesterSession> {
  const { provider, address } = input;
  if (!ADDRESS_RE.test(address)) throw new PolyesterLoginError("no_wallet", "invalid address");

  const doFetch = input.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));

  // 1. Ask our backend for a challenge. It derives the Safe address and tells
  //    the exchange which origin is requesting the signature.
  const challengeResponse = await doFetch(`${API_BASE}/api/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // Only the owner EOA is sent. The smart account is derived server-side so a
    // wallet with no Polyester account can still log in.
    body: JSON.stringify({ signerAddress: address }),
  });

  const challenge = await readJson(challengeResponse);
  if (!challengeResponse.ok) throw failureFor(challengeResponse, challenge);

  const message = typeof challenge.message === "string" ? challenge.message : "";
  const smartAccountAddress =
    typeof challenge.smartAccountAddress === "string" ? challenge.smartAccountAddress : "";
  const signerAddress = typeof challenge.signerAddress === "string" ? challenge.signerAddress : "";
  if (!message || !ADDRESS_RE.test(smartAccountAddress) || !ADDRESS_RE.test(signerAddress)) {
    throw new PolyesterLoginError("invalid_response", "challenge");
  }

  // 2. The wallet signs the exact bytes. A refusal here aborts before any
  //    token request is made.
  let signature: string;
  try {
    signature = await signLoginMessage({ provider, address: signerAddress, message });
  } catch (error) {
    if (error instanceof WalletSignatureError) throw new PolyesterLoginError(error.code);
    throw new PolyesterLoginError("unknown");
  }

  // 3. Exchange the signature for a session.
  const loginResponse = await doFetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ smartAccountAddress, signature, message }),
  });

  const session = await readJson(loginResponse);
  if (!loginResponse.ok) throw failureFor(loginResponse, session);

  const accessToken = typeof session.accessToken === "string" ? session.accessToken : "";
  if (!accessToken) throw new PolyesterLoginError("invalid_response", "token");

  return {
    accessToken,
    accountId: typeof session.accountId === "string" ? session.accountId : null,
    username: typeof session.username === "string" ? session.username : null,
    expiresAt: typeof session.expiresAt === "string" ? session.expiresAt : null,
    smartAccountAddress,
    signerAddress,
  };
}

/**
 * In-memory session holder.
 *
 * A class rather than a module-level `let` so tests get isolation, and so the
 * single place a token is stored is auditable in one screenful.
 */
export class PolyesterSessionStore {
  private session: PolyesterSession | null = null;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): PolyesterSession | null => this.session;

  get status(): SessionStatus {
    return this.session ? "authenticated" : "anonymous";
  }

  set(session: PolyesterSession | null): void {
    if (this.session === session) return;
    this.session = session;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        // A subscriber must not be able to break session state.
      }
    }
  }

  /** Explicit sign-out. Local only: the exchange token dies with the page. */
  clear(): void {
    this.set(null);
  }

  /** True when a token exists and has not passed its stated expiry. */
  isUsable(now: number = Date.now()): boolean {
    if (!this.session) return false;
    if (!this.session.expiresAt) return true;
    const expiry = Date.parse(this.session.expiresAt);
    return Number.isFinite(expiry) ? expiry > now : true;
  }
}

let singleton: PolyesterSessionStore | null = null;

/** App-level instance. Tests construct their own. */
export function getPolyesterSessionStore(): PolyesterSessionStore {
  singleton ??= new PolyesterSessionStore();
  return singleton;
}
