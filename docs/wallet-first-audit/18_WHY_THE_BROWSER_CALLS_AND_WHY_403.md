# 18 — Why the browser calls anything, and why your deployment returns 403

Two questions: *why does the browser make an API call at all*, and *why is it
still failing on `.pages.dev`*.

The second has a concrete answer, measured against the live deployment.

---

## 1. The browser never calls Polyester

That is the part worth being exact about. On a `.pages.dev` deployment the app is
served **by Cloudflare Pages Functions**, so `/api/*` is the *same origin* as the
page. There is no CORS, no preflight and no allowlist involved in the normal
path.

```
browser                         Cloudflare Pages Function          Polyester
-------                         -------------------------          ---------
POST /api/auth/challenge  ───▶  api()  ────────────────────────▶  CreateWalletChallenge
   (same origin)                     derives Safe address
                                     relays `uri` = our origin
                            ◀───  { message }  ◀────────────────
wallet personal_sign
POST /api/auth/login      ───▶  api()  ────────────────────────▶  LoginWithWallet
                            ◀───  { accessToken } ◀─────────────
```

Two calls leave the browser, and **both go to our own backend on our own
origin**. Polyester is contacted by the Worker, never by the page. That is the
whole reason the proxy exists: the exchange sends no `Access-Control-Allow-Origin`
to us, so a direct call from the page cannot work.

### Why any browser call is needed

Because the signature can only be produced in the browser. The user's wallet is a
browser extension; the server has no key and must never hold one. So:

| Step | Where | Why there |
| --- | --- | --- |
| Ask for a challenge | server | the exchange must be called server-side |
| Sign the exact message | **browser** | only the wallet can sign |
| Exchange signature for a token | server | holds the API call, keeps the token exchange server-side |
| Use the token | either | today: discarded on reload (memory only) |

The browser's involvement is one POST containing a public message and a
signature. No private key, no token until the server answers.

**On Pages you need no configuration for this.** `POLYTOOLS_APP_ORIGINS` stays
empty (same-origin only) and `VITE_API_BASE` stays empty (relative URLs). The
allowlist in `17` only matters for the *other* deployment shape, a static host
talking to a separate Worker.

---

## 2. Why it is still failing — the deployment predates the code

Measured against `https://5b3de73c.polytools-cc8.pages.dev`:

| Request | Response | Reading |
| --- | --- | --- |
| `GET /api/health` | `200 {"ok":true,"service":"poly-tools-backend"}` | Functions **are** deployed on this origin |
| `GET /api/auth/challenge` | `404 {"error":"Unknown route: /api/auth/challenge"}` | this build has **no auth routes** |

That `Unknown route` string is `backend/src/handler.ts:451` on **`main`**. On the
branch, the same request answers `405 {"error":"method_not_allowed"}` because the
auth route exists and rejects non-POSTs.

`git log origin/main..HEAD` is the explanation: **twelve commits, including all of
the sign-in work, exist only on `arena/609563ba-polytools`.** PR #8 is open and
unmerged — and merging was never authorised, so nothing deployed it.

Cloudflare Pages builds from the connected branch, almost certainly `main`.
So the site you are testing is `main`: it has no `/api/auth/*` route, and no
Sign in button either.

### Consequence worth stating plainly

**No change to the browser can fix this.** The request is answered by code that
is not deployed. The fix is a merge and a deploy, which is your decision, not a
code change I can make.

### About the specific 403

On a build of `main`, a `POST` to an unknown `/api` path gets **405**, not 403 —
main rejects non-GET before route matching. A `404 "Unknown route"` is what a GET
gets. So a **403** is not something `main`'s handler produces, and it is not
something the branch produces either for a same-origin caller:

| Body | Source |
| --- | --- |
| `{"error":"origin_not_allowed"}` | our allowlist — only when the caller is genuinely cross-origin |
| `{"error":"permission_denied","detail":"…"}` | Polyester refused the challenge (C-1) |
| HTML or empty body | Cloudflare, a WAF, or the host — the request never reached the app |

If the failing request's response body is empty or HTML, the request is being
stopped in front of the application, and the build is irrelevant until that is
resolved.

---

## 3. Verify any deployment in one command

```bash
node tools/check-deployment.mjs https://your-site.pages.dev
```

Two read-only GETs; no credentials. It distinguishes the four cases above and
prints the next action. Verified against both shapes here — a build with the auth
routes, and a mock of `main` returning `Unknown route`.

---

## 4. The path forward

1. **Merge PR #8** (your call — I have not merged) so a build contains the routes.
2. Deploy. On Pages, no new environment variables are needed.
3. Run `node tools/check-deployment.mjs https://your-site.pages.dev` and confirm
   it says *"this deployment HAS wallet sign-in"*.
4. Click **Sign in**. Whatever happens next is the real C-1 answer:
   - a session opens → login works, and the origin is not constrained;
   - `permission_denied` → Polyester pins origins, and that is a conversation
     with Polyester, not a code change.

Step 4 is the first time any of this touches the real exchange. Everything
verified so far — 468 tests, 12 browser checks — ran against a mock.
