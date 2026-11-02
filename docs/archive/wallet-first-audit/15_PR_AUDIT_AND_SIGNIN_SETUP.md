# 15 — PR #8 audit, and where sign-in actually goes

Two questions from the review: **why does connecting a wallet do nothing**, and
**what does a real exchange frontend/backend set up, so we can copy the shape?**

Everything below was checked against this checkout, not recalled. Where
something is unverified it says so.

---

## 1. The behaviour you saw is real, and it is the design

Connecting a wallet changes exactly one thing: the topbar shows your address and
a Disconnect button. There is **no signature request, no message, no network
call to Polyester**.

Verified by search, not by reading intent:

| Searched for | Matches in `apps/web/src`, `backend/src`, `packages/core/src` |
| --- | --- |
| `personal_sign`, `eth_sign`, `signTypedData`, `wallet_sign` | **none** |
| `api/auth` (the login routes built in `76bfd1e`) | **none — nothing calls them** |

So the transport exists on the server and no client touches it. That is Stage 2a
("connection only"), which was the agreed scope. It is also why the control says
*"no sign-in, no account data, no trading"* on hover — the copy is accurate.

**The honest framing:** nothing is broken, and nothing is finished either. You
have a wallet button wired to a login backend with no wire between them. What is
missing is the `personal_sign` half, and it is gated on one unanswered question
(§5).

---

## 2. Audit of PR #8

Branch `arena/609563ba-polytools`, 42 files, +10,500/−36.

### 2.1 Gates, re-run on this exact commit

| Gate | Result |
| --- | --- |
| `npm test` | **442 → 444 pass**, 0 fail |
| `npm run typecheck` | clean (web + backend) |
| `npm run build` | 323 kB JS / 39.7 kB CSS |
| `check:performance` | PASS — 102 kB gzip JS vs 185 kB budget |
| `check:contrast` | 54/54 pairs ≥ 4.5:1 |
| `check:whitespace` | 211/211 |
| Browser, 23 checks | PASS (two injected wallets, real Chromium) |
| Browser, 16 routes × 4 viewports | PASS, no overflow |

### 2.2 Findings

**A-1 · High · FIXED in this commit — the auth proxy would talk to any host.**
`resolveAuthApiOrigin` accepted *any* `https:` origin from
`POLYESTER_API_ORIGIN`. A typo, a bad staging value, or a tampered build could
send every challenge and every `{message, signature, userAgent}` to an arbitrary
server. A login signature cannot mint a session anywhere but Polyester, so this
is not account takeover — it is identity-assertion harvesting, which is bad
enough. Now pinned to `polyester.com` and its subdomains, with loopback
permitted only for plain-HTTP tests. Two tests cover it, including the
near-miss host `polyester.com.evil.example`.

**A-2 · Medium · open — no rate limit on the auth routes.** A public endpoint
that asks the exchange for challenges can be driven in a loop. The exchange's own
limits are the only backstop, and they are not ours to depend on. A per-isolate
counter would be theatre on edge workers; the honest fix is a Cloudflare rate
limiting rule on `/api/auth/*` at deploy time. **Not done, because it cannot be
done in code.**

**A-3 · Medium · open — `/api/auth/login` returns the token to the caller.** That
is required, since the browser is the only place the token can live. But it means
the token passes through a URL-handler that other code shares. Currently safe
(`Cache-Control: no-store`, no `Access-Control-Allow-Origin`, no logging), and
the discipline test asserts the module never mentions `console.` or
`localStorage`. It stays a sharp edge to re-read whenever this file changes.

**A-4 · Low · FIXED in this commit — the dev middleware buffered an unbounded
body.** The handler's 8192-byte check runs *after* the body is in memory. The dev
middleware now refuses anything over 1 MB before buffering, by `Content-Length`
and again while reading (a chunked request can lie or omit it).

**A-5 · Low · note — CSS budget is at 39,678 / 40,000 bytes.** The wallet panel
took it from 37.7 kB to 39.7 kB. Real headroom, not a failure, but the next
component that adds styling will hit the wall. Either raise the budget
deliberately or split CSS.

**A-6 · Info — CSP still lists `api.testnet.polyester.com` in `connect-src`, and
must.** Login no longer needs it (the server calls the API now), but the API-key
vault path still calls the REST origin from the browser. Removing it would break
that path; leaving it means C-10 (CORS on the API-key path) is still open and
still unanswered.

**A-7 · Info — two things claim to be the login transport.** `backend/src/authProxy.ts`
reimplements the two RPCs, while the SDK's `PolyesterBrowserClient` and
`login()` do the same flow. They must not both grow. §4 recommends which survives.

### 2.3 What the audit did **not** establish

No request has ever reached `api.testnet.polyester.com` from this environment
(`ECONNRESET` at TLS). Every auth test runs against a local mock. The transport
is proven correct; **login working is not proven** and no document in this repo
may say otherwise.

---

## 3. How the three references actually do it

### 3.1 Polyester (the SDK we already ship) — a session token

`AccountSigner` is the seam, and it is deliberately tiny
(`dist/account-signer/types.d.ts`):

```ts
interface AccountSigner {
  environmentFingerprint: string;
  accountAddress: HexAddress;    // smart account — authenticates and trades
  ownerAddress?: HexAddress;     // the EOA that actually signs
  signMessage(message: string): Promise<Hex>;  // raw 65-byte EIP-191
}
```

The flow is: `CreateWalletChallenge` → sign the returned message **exactly** →
`LoginWithWallet` → bearer token. `PolyesterBrowserCore` owns the rest:

| Call | Purpose |
| --- | --- |
| `login({ provider })` | challenge → sign → token → hydrate session |
| `restoreSession()` | re-validate a stored token on reload |
| `refreshSession()` | re-sign before expiry |
| `getSessionTimeToExpiry()` | drive a proactive refresh |
| `logout()` | clear storage + state |
| `handleRejectedToken(t)` | SDK calls this itself on a 401 |

Storage is a plug: `createMemoryAuthTokenStorage()` (the default — dies with the
tab) or `createCookieAuthTokenStorage({ secure, sameSite })`.

The important detail: **the SDK signs through your signer**, so we do not
hand-roll `personal_sign`. That inverts the assumption in our transport work —
the wallet adapter is the only new code, not the protocol.

### 3.2 Hyperliquid — sign once, then a scoped session

No API keys and no server session. The user signs **one** EIP-712 `approveAgent`
action with the master wallet; the app then generates a throwaway key, and that
agent key signs every subsequent order. The agent key is held in
`sessionStorage` for the tab's lifetime, and it **cannot withdraw** — that limit
is the point of the design.

The transferable idea is not the agent key (we must never hold one). It is the
**scope narrowing**: one signature authorises a narrow session, and the
capability is structurally limited rather than policy-limited. Polyester's
version is the same shape: one signature → a bearer token whose scope is "this
account, read + trade as permitted", not "this private key".

### 3.3 Rabby / EIP-6963 — already adopted

Multi-wallet discovery is what we implemented (`walletDiscovery.ts`), including
the reason it exists: only one extension can own `window.ethereum`, and the loser
throws `Cannot redefine property: ethereum`. Nothing further to copy.

---

## 4. Where sign-in goes — concrete, file by file

### 4.1 Frontend (the ~120 lines that are missing)

```
apps/web/src/lib/walletSigner.ts          NEW  provider → AccountSigner
apps/web/src/lib/polyesterClient.ts       NEW  one browser client, one token store
apps/web/src/lib/usePolyesterSession.ts   NEW  login/logout/expiry → React state
apps/web/src/components/WalletButton.tsx  EDIT "connected" gains Sign in / Sign out
```

**`walletSigner.ts`** — the only new protocol-ish code, and it contains no
protocol:

```ts
// accountSigner(): AccountSigner backed by the injected provider.
signMessage: async (message) =>
  provider.request({
    method: "personal_sign",
    params: [utf8ToHex(message), ownerAddress], // exact bytes, no re-encoding
  })
```

Two traps, both documented by Polyester and both worth a test: the message must
be signed **byte for byte** (no trimming, no normalising), and some wallets
require Ethereum mainnet (chain 1) selected before signing — Phantom is named in
their docs.

**`polyesterClient.ts`** — one instance, memory storage by default:

```ts
new PolyesterBrowserClient({
  environment: POLYESTER_TESTNET_ENVIRONMENT,
  accountSigner,
  tokenStorage: createMemoryAuthTokenStorage(),
  fetch: authOnlyFetch,        // see §4.2
});
```

Memory storage means a reload logs you out. That is the conservative choice while
the gate is open, and it keeps a bearer token out of `localStorage` forever —
which the security rules in this repo require. Cookie storage is the alternative
when persistence is wanted, and only with `secure: true, sameSite: "lax"`.

**`WalletButton.tsx`** — three honest states, not two:

| State | Control |
| --- | --- |
| disconnected | **Connect wallet** |
| connected, not signed | **Sign in** ← the missing step you noticed |
| signed in | address + **Sign out** |

Connecting must never silently sign. The signature is a separate, deliberate
click with its own explanatory text.

### 4.2 Backend (mostly already built)

`backend/src/authProxy.ts` exists and works. The question is whether to keep it.

| Option | Shape | Verdict |
| --- | --- | --- |
| **A. Thin forwarder** | SDK does the flow; our `fetch` wrapper routes **only** `/auth.v1.AuthService/*` through `/api/auth/*`; everything else goes direct | **Preferred.** One implementation of the protocol (the SDK's), our code stays a pipe |
| **B. Keep the two hand-written routes** | We own challenge/login shaping; the SDK is unused for auth | Only if we must avoid the SDK in the browser (licensing, NBA-8) |
| **C. Both** | current state | Tolerable for one more commit, then it drifts |

Either way the proxy keeps the properties it has now: origin derived from the
request, no `Access-Control-Allow-Origin`, `no-store`, cross-site refused, no
logging, Polyester-only upstream.

One consequence worth stating plainly: **if login works through the proxy, the
browser never needs CORS from the exchange at all.** That turns C-1 from "can we
ever log in?" into "which transport do we prefer?".

### 4.3 What each side must never hold

| Thing | Frontend | Backend |
| --- | --- | --- |
| Private key / seed phrase | never | never |
| Signature | in memory for the request only | relayed, never stored |
| Bearer token | memory (or a secure cookie), never `localStorage` | returned, never logged or cached |
| Agent key (Hyperliquid-style) | **not implemented — out of scope** | never |

---

## 5. The one blocker, restated plainly

Everything above is buildable now except the part that decides whether it works:

> Does Polyester issue a challenge for **our** origin?

`CreateWalletChallenge` binds `uri` into the signed message. If the exchange only
issues challenges for origins it recognises, both options in §4.2 fail and no
amount of frontend work changes that. This is exactly what
`tools/auth-gate-probe.mjs` answers in two unauthenticated calls, with no key and
no wallet. It has never been run against the real API — the development sandbox
has no TLS egress.

Second open question, needed for the signer itself: for a wallet with **no
Polyester smart account yet**, what goes in `smartAccountAddress`? The SDK expects
a smart account and an owner EOA that controls it. Our EOA-only wallet has the
second and maybe not the first. That is a product question for the exchange, not
a bug we can fix.

---

## 6. Recommendation

1. Run `node tools/auth-gate-probe.mjs`. It costs one minute and gates everything.
2. If it says **not pinned**: build §4.1, choose option A, and get a real login.
3. If it says **pinned**: stop, and take it to Polyester — the partnership you
   mentioned is the correct answer, and nothing in our code substitutes for it.
4. Until either lands, leave the button connection-only. It is honest today; a
   Sign in button that cannot work would not be.
