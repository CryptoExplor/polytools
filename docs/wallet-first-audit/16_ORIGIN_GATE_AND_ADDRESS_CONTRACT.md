# 16 — Origin gate evidence, address contract, and the Stage 2b decision

Scope: run the origin probe, resolve what `smartAccountAddress` must be, decide
go/no-go. **No sign-in code was written.** No signature was produced, no signed
message sent, no private data fetched, no deploy, no merge.

Environment of record: SDK **`@polyester/sdk` 0.31.0**, base commit **`674f393`**.

---

## 1. The probe — inspection, two defects, one run

### 1.1 What it sends, and where

Read from `tools/auth-gate-probe.mjs` before running:

| Item | Value |
| --- | --- |
| Destination | `https://api.testnet.polyester.com/auth.v1.AuthService/CreateWalletChallenge` |
| Method | `POST`, `Content-Type: application/json`, `Connect-Protocol-Version: 1` |
| Payload | `{ smartAccountAddress, signerAddress, uri, purpose }` |
| Credentials | **none** — no key, signature, token, cookie or personal data |
| Leg A (control) | `uri = https://testnet.polyester.com` |
| Leg B (question) | `uri = https://5b3de73c.polytools-cc8.pages.dev` |
| Production hosts | **none**; no fallback path rewrites the destination |

### 1.2 Two defects found before anything was sent

Per the instruction to stop if the payload would be malformed or ambiguous, I
stopped, fixed the instrument, and only then ran it.

**D-1 · The enum was sent as a number.** The probe had `purpose: 1`. Connect's
JSON encoding writes an enum as its **name**. Verified by pointing the installed
SDK's own client at a local capture server:

```
{"smartAccountAddress":"0x1111…","signerAddress":"0x1111…","uri":"https://polytools.example","purpose":"LOGIN"}
```

A malformed body would be rejected for a reason unrelated to `uri`, which is the
only variable the probe measures. Now sends `"LOGIN"`.

**D-2 · The address pair was not a real pair.** The probe sent the *same*
fabricated address for `smartAccountAddress` and `signerAddress`. Those are not
the same thing (§2), so the exchange could reject the pair before it ever looked
at `uri`. The probe now derives a genuine pair offline — an owner EOA and the
Safe address the SDK computes from it — and prints both so the operator can see
what a real login looks like. If the SDK is unavailable it falls back to the
synthetic pair **and says so**, rather than implying the pair is meaningful.

Both fixes are to the test instrument. `--dry-run` prints the exact request and
exits without transmitting, so the payload can be reviewed first.

### 1.3 Exact payload sent

```json
{
  "smartAccountAddress": "0x6437d78d965D668D9C51b99F040AEE14f7e86a6a",
  "signerAddress": "0xabCDeF0123456789AbcdEf0123456789aBCDEF01",
  "uri": "https://testnet.polyester.com",          // leg A
  "purpose": "LOGIN"
}
// leg B identical except  "uri": "https://5b3de73c.polytools-cc8.pages.dev"
```

Addresses are fabricated. Nothing is deployed and nothing is signed — the Safe
address is pure arithmetic over the environment's factory address.

### 1.4 Result

| Leg | Origin sent | HTTP status | Response body |
| --- | --- | --- | --- |
| A (control) | `https://testnet.polyester.com` | **none — transport failed** | none |
| B (question) | `https://5b3de73c.polytools-cc8.pages.dev` | **none — transport failed** | none |

Transport error on both legs: **`ECONNRESET`**.

**Conclusion: INCONCLUSIVE. This says nothing about whether our origin is
accepted.** The control failed too, so leg B carries no information. It must not
be reported as an origin refusal.

### 1.5 Why the transport failed — proven, not assumed

Diagnosed by layer, without touching the destination, the origin, or any proxy:

| Layer | Evidence |
| --- | --- |
| DNS | resolves on both families — `172.67.73.5` (A), `2606:4700:20::…` (AAAA) |
| TCP | IPv4:443 connects |
| **TLS** | **reset during handshake** — `curl: (35) OpenSSL SSL_connect: SSL_ERROR_SYSCALL`, `http=000`; IPv6 cannot connect at all |

Control comparison on the same connection path:

| Host | TLS result |
| --- | --- |
| `github.com` | `http=200` |
| `registry.npmjs.org` | `http=200` |
| `api.testnet.polyester.com` | `http=000` (handshake reset) |

This is an **egress allowlist in this development sandbox**, not a fault at
Polyester and not a proxy requirement. There is no fallback worth attempting and
none was attempted.

**Therefore C-1 remains unverified.** The probe must be run from an environment
with real egress.

---

## 2. The address contract — resolved from SDK 0.31.0

Question: what is `smartAccountAddress` when the wallet has no deployed smart
account? **Answer: the counterfactually derived Polyester Safe address, never the
EOA.** The SDK states this directly (`README.md`):

> Polyester accounts are smart accounts. You bring an owner wallet, the SDK
> derives the smart account address, and the owner EOA signs the login challenge.
> **Nothing gets deployed just to log in.**

And in `dist/account-signer/create-polyester-account-signer.d.ts`:

> Derives the Polyester Safe smart account address and a Safe/ERC-6492 signer
> **without any RPC calls**. […] That form is accepted for subaccount creation but
> **NOT for login**, which requires the owner EOA's **raw 65-byte EIP-191
> signature**. For login, use this only to **derive accountAddress**.

### 2.1 The two cases

| Case | `smartAccountAddress` | `signerAddress` | Deploy needed? |
| --- | --- | --- | --- |
| **1. EOA-only, no smart account yet** | the **predicted Safe** for that owner — `createPolyesterAccountSigner({ environment, owner }).accountAddress` | the **owner EOA** | **No** |
| **2. Existing smart account + owner EOA** | the same derivation, same `saltNonce` (default `0n`) reproduces the deployed address | the **owner EOA** | already deployed |

`saltNonce` selects among several Safes for one owner, so a user with two
Polyester accounts has two addresses from one EOA. Deriving with the wrong salt
yields an address the exchange has no account for.

### 2.2 Verified offline, with real values

`createPolyesterAccountSigner` is pure computation, so this could be checked
here without egress:

```
owner EOA        : 0xabCDeF0123456789AbcdEf0123456789aBCDEF01
derived account  : 0x6437d78d965D668D9C51b99F040AEE14f7e86a6a
EOA === account? : false
deterministic    : true          (same inputs → same address)
saltNonce = 1n   : 0x712e4686F10658CE85B22665A1809Cba3202ef79   (different)
```

Three constraints this exposed, each a real trap for the implementation:

1. **The EOA is not the smart account.** Confirmed numerically. Any code that
   passes the wallet address into both fields is wrong.
2. **The environment changes the address.** Same owner, different environment:
   `polyester-testnet → 0x6437d78d…` vs `polyester-devnet → 0x9beca37d…`. The
   `environmentFingerprint` on the signer must match the client's environment or
   login and `restoreSession()` will not recognise each other.
3. **A checksummed address is required.** viem rejects
   `0xAbCdEf…`-style mixed case: *"Address must match its checksum counterpart."*
   Injected wallets return mixed case, so the address must be normalised to
   checksum form before derivation.

### 2.3 The signature trap, stated plainly

`createPolyesterAccountSigner` returns a signer whose `signMessage` produces
**ERC-6492 wrapped** signatures. Those are accepted for *subaccount creation* and
**rejected by login**. The correct pattern, from the SDK's own quickstart, is to
take `accountAddress` from the helper and build the `AccountSigner` yourself so
that `signMessage` calls the owner EOA directly and returns raw EIP-191.

Any implementation that lazily reuses the helper's signer will look correct,
produce valid signatures, and fail authentication. This is the single most
likely way Stage 2b gets built wrong.

`AccountSigner` (SDK 0.31.0) is:

```ts
interface AccountSigner {
  environmentFingerprint: string;
  accountAddress: HexAddress;    // the Safe
  ownerAddress?: HexAddress;     // the EOA; declared as the login signer
  signMessage(message: string): Promise<Hex>;  // raw 65-byte EIP-191
}
```

---

## 3. Decision

### NO-GO to implement Stage 2b today.

Not because the design is unclear — §2 settled the address question, and the
plan in §5 is concrete. It is blocked on one piece of missing evidence:

> **C-1: does Polyester issue a challenge for our origin?** Still unknown. The
> probe produced no HTTP response, so there is no answer in either direction.

Building `personal_sign` wiring against an unanswered gate risks exactly the
thing this repo's rules forbid: a Sign in button that cannot work, shipped as if
it might.

### The condition that flips it to GO

Run, from a machine with real egress:

```
node tools/auth-gate-probe.mjs
```

| Probe result | Decision |
| --- | --- |
| **A 200, B 200** | **GO** — origin is not the constraint; build §5 |
| **A 200, B refused** | **NO-GO** — the API pins origins. Escalate to Polyester; no client change helps |
| **A refused** | **Inconclusive** — report the exchange's exact error; the probe proves nothing about B |

---

## 4. Unresolved requirements

| # | Requirement | Status |
| --- | --- | --- |
| U-1 | Origin acceptance for `uri` | **Unknown** — no response ever received |
| U-2 | Whether the challenge signature must be raw EIP-191 (not ERC-6492) | **Documented by the SDK**; not yet observed on the wire |
| U-3 | CORS: still irrelevant for login if the proxy is used, since the call is server-side | **Bypassed by design**, not proven |
| U-4 | `provider` value for injected wallets: `SessionData.provider` permits only `"metamask" \| "phantom" \| "turnkey" \| "other"` | Known constraint; **no "rabby"** — Rabby exists only in `AuthLoginMethod` |
| U-5 | Whether the exchange accepts a *counterfactual* Safe address for an account it has never seen | **Untested** — depends on U-1 |
| U-6 | Browser signing may need Ethereum mainnet (chain 1) selected first, per the SDK's `AccountSigner` note ("e.g. Phantom") | Documented; untested |

---

## 5. Implementation plan (not built)

### `apps/web/src/lib/walletSigner.ts`

Provider → `AccountSigner`. No protocol code.

- `normaliseAddress()` → checksum form via `getAddress`, rejecting malformed input.
- `deriveSmartAccount(owner, environment)` → `createPolyesterAccountSigner(...).accountAddress`
  **only**; the returned signer is discarded (§2.3).
- `signMessage(message)`: `personal_sign` with `[utf8ToHex(message), ownerAddress]`.
  Bytes pass through untouched — no trim, no normalise, no re-encode.
- `environmentFingerprint` taken from the same environment constant the client uses.

### `apps/web/src/lib/polyesterClient.ts`

- One `PolyesterBrowserClient`, `environment: POLYESTER_TESTNET_ENVIRONMENT`,
  `accountSigner` from the above, `tokenStorage: createMemoryAuthTokenStorage()`.
- Memory storage is deliberate: reload logs out, and no bearer token can reach
  `localStorage`. Cookie storage is a later, explicit decision
  (`secure: true, sameSite: "lax"`).
- `fetch` wrapper routes **only** `/auth.v1.AuthService/*` through `/api/auth/*`;
  everything else goes direct, preserving the API-key path untouched.

### `apps/web/src/lib/usePolyesterSession.ts`

- State: `anonymous | connected-unsigned | signing | authenticated | error`.
- `login()` / `logout()` / `restoreSession()` on mount; expiry surfaced from
  `getSessionTimeToExpiry()`.
- **Connecting a wallet never transitions to `authenticated`.** Only an explicit
  user action may.

### `WalletButton`

- `connected` gains a third state: address + **Sign in**; authenticated shows
  **Sign out**. Copy keeps the current claim that connection alone grants nothing.

### Tests

| Test | Assertion |
| --- | --- |
| address derivation | EOA ≠ derived Safe; deterministic; `saltNonce` changes it; testnet ≠ devnet |
| checksum | mixed-case input normalised; malformed rejected |
| message integrity | `signMessage` returns the provider's signature unmodified; the hex encodes the exact UTF-8 bytes |
| no ERC-6492 | the `AccountSigner` used for login is **not** the one from `createPolyesterAccountSigner` |
| state machine | connect → `connected-unsigned`, never `authenticated` |
| token storage | default is memory; no `localStorage`/`sessionStorage` write |
| fetch routing | only `auth.v1.AuthService/*` goes to `/api/auth/*`; account REST path unchanged |
| provider mapping | only `metamask \| phantom \| other` emitted; Rabby maps to `other` |

---

## 6. Repository status

- Base: `674f393`
- Changes in this task: `tools/auth-gate-probe.mjs` (D-1, D-2, `--dry-run`), this
  document, and a C-1 status line. No application code, no sign-in, no tests
  touched.
- Known gap carried forward: C-1 unverified; C-2, C-3, C-4, C-5, C-10 unchanged.

---

## 7. Addendum — Stage 2b implemented on explicit instruction (2026-10-28)

The user authorised implementation after reading this report, accepting that
C-1 remains unverified. The decision above stands as the evidence-based
position; this records what was built and what is still unproven.

### 7.1 What was built

| File | Role |
| --- | --- |
| `apps/web/src/lib/walletSigner.ts` | `personal_sign` over the exact issued bytes; 65-byte validation; provider errors mapped to our own codes |
| `apps/web/src/lib/polyesterSession.ts` | challenge → sign → token; **in-memory** token store; the login state machine |
| `apps/web/src/lib/usePolyesterSession.ts` | React binding; `signIn` is an explicit call, never a side effect |
| `apps/web/src/components/WalletButton.tsx` | third state: **Sign in** / **Sign out** |
| `backend/src/authProxy.ts` | derives the Safe address **server-side** from the owner EOA |

**The SDK stays out of the browser.** `@polyester/sdk` is a root devDependency,
not a web dependency, and C-7 is still open. Deriving the Safe address on the
server meant the client needs no SDK at all: the bundle grew **2 kB**
(102.5 kB → 104.4 kB gzip) rather than the ~1.4 MB RainbowKit comparison. It
also resolved the EOA-only case from §2 — a wallet with no Polyester account
sends only its owner address, and the server derives the counterfactual Safe.

### 7.2 Verified

- **16 unit tests** (`tests/wallet-signin.test.mjs`) and **460 total**, all
  passing, including an end-to-end challenge → sign → token run against a mock
  exchange, refusal paths, and the consent invariant.
- **12 browser checks in real Chromium** against the full stack: connecting
  signs nothing; **Sign in** requests exactly one `personal_sign`; the signed
  bytes decode to the issued message; a token is obtained; no bearer token
  appears in `localStorage`/`sessionStorage` (only the pre-existing
  `poly-tools:theme`); **Sign out** returns to connected-and-unsigned; a reload
  signs you out because the token is memory-only.
- **Refusal path**: with the mock returning `403 permission_denied`, the UI
  shows **“Not allowed”** with the exchange's own words in the tooltip and
  **asks for no signature at all** (`signCalls: 0`).
- No overflow at 360 px in either the signed-in or refused state.

### 7.3 What is still not proven

**Polyester's real behaviour is untested.** Every one of the above runs against
a local mock. C-1 — whether the exchange issues a challenge for our origin — is
still unknown, and the refusal path above is the shape a pinned origin would
take. If the real API answers that way, the button will say “Not allowed” and
be correct.

Also unverified: the signature must be raw EIP-191 rather than ERC-6492 (U-2),
whether a counterfactual Safe is accepted for an unseen account (U-5), and any
network requirement before signing (U-6).

### 7.4 Preserved

The API-key path is untouched: `apps/web/src/lib/api.ts` and
`accountSessionOwner.ts` still call the REST origin directly, and `connect-src`
still permits it. The two auth mechanisms share no storage. Wallet sign-in is
the only thing that talks to `/api/auth/*`.

