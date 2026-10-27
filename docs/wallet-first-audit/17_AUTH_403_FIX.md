# 17 — The `/api/auth/challenge` 403: three bugs, all mine

Reported: `Failed to load resource: 403` on `/api/auth/challenge`.

A 403 from that path has exactly two shapes, with very different meanings. The
first job was to tell them apart; the second was to find why one of them was
being produced by our own code on a legitimate request.

## 1. The two 403s

Reproduced locally through the real handler:

| Cause | Body | Meaning |
| --- | --- | --- |
| Our origin guard | `{"error":"origin_not_allowed"}`<br>(was `cross_site_blocked`) | **This deployment** refused before the exchange was contacted |
| The exchange | `{"error":"permission_denied","detail":"…"}` | Polyester refused. This is the C-1 answer |

The client mapped **both** to *"Polyester refused this site's origin"*. That is
the worst possible outcome for a report like this: it points the reader at the
exchange when the block happened here. Fixed — the two are now distinct codes,
and a third case (a non-JSON 403 from a static host or WAF) is reported as an
unreachable endpoint rather than an origin refusal.

## 2. Why a legitimate request was being refused

Three separate defects, each enough to break login on its own.

**B-1 · The client ignored the deployment's API base.** Every other module
resolves its backend through `API_BASE` (`VITE_API_BASE`, set by the Pages
workflow). The auth client used a bare relative `"/api/auth/challenge"`. The
documented deployment is a static frontend that talks to a **separate Worker** on
`*.workers.dev` — so the auth call went to the static host, where no backend
exists. A POST to a path a static host doesn't serve is exactly the kind of
request that comes back 403.

**B-2 · The origin guard rejected the intended architecture.** The guard blocked
any request with `Sec-Fetch-Site: cross-site`. In the documented deployment the
app **is** cross-origin to the worker, so that header is `cross-site` on every
legitimate call. The guard was written against an assumption (same-origin
deployment) that only holds for the Cloudflare Pages Functions variant.

**B-3 · Cross-origin login could not have worked even without the guard.** A
`POST` with `Content-Type: application/json` is not a simple request, so the
browser preflights it; with no `Access-Control-Allow-Origin`, the browser blocks
it before the body is sent. The static-plus-worker deployment therefore needed a
real CORS answer, not just the absence of a block.

## 3. The fixes

- **`polyesterSession.ts`** builds auth URLs from `API_BASE`, like the rest of
  the app.
- **`authProxy.ts`** replaces the blanket `Sec-Fetch-Site` block with an explicit
  origin allowlist: `POLYTOOLS_APP_ORIGINS` (comma-separated, exact origins).
  - Empty by default → same-origin only, the safest default, unchanged for the
    Pages Functions variant.
  - When configured, the matching origin is echoed **exactly, never `*`**, so
    only a site we name can read a challenge or a token.
  - Unlisted cross-origin callers get `403 origin_not_allowed` and no CORS
    headers.
  - `OPTIONS` mirrors the same decision.
- **`Vary: Origin`** on every auth response, since the answer depends on caller.
- **Same-origin detection** no longer trusts a reconstructed request URL.
  `Sec-Fetch-Site: same-origin` is the browser's own verdict and is preferred;
  without it, no `Origin` means no confusion.

### A bug found only by running it in a browser

After the rewrite, a **same-origin** call started returning 403. The cause: the
Vite dev middleware rebuilt the request URL as `http://localhost${path}`, so the
request URL (`http://localhost`) disagreed with the browser's `Origin`
(`http://127.0.0.1:5204`) and an ordinary same-origin call was classified as
cross-origin. Typecheck was clean and every unit test passed; only the browser
run caught it.

Fixed in two places: the middleware now forwards the real `Host` (read from the
raw request, since the header map deliberately drops `host`), and the
cross-origin test no longer depends on the reconstructed URL. A side effect worth
having: the login challenge now binds the **correct** `uri` in development
instead of `http://localhost`.

## 4. Verified

- **468 tests pass** (25 in `auth-proxy`, 20 in `wallet-signin`), including:
  allowlisted origin allowed with an exact echo; unlisted origin refused with no
  CORS grant; preflight answered only for allowed origins; same-origin unaffected;
  malformed allowlist entries ignored rather than widening it; our guard not
  misreported as a Polyester refusal; a non-JSON 403 reported as unreachable; and
  the client building URLs from `API_BASE`.
- **12/12 browser checks** against the full stack, unchanged by the refactor:
  connecting signs nothing, one `personal_sign`, correct bytes, memory-only token,
  sign-out, reload.
- Typecheck, whitespace, build (104.6 kB gzip), performance all green.

## 5. What this does *not* establish

Still untested against the real exchange. If the 403 you saw carried
`permission_denied`, that is the C-1 answer and no code change here helps —
that outcome now surfaces as *"Polyester refused this site's origin"* with the
exchange's own words.

## 6. What to do with the deployment

| Deployment | Action |
| --- | --- |
| Static site + separate Worker | Rebuild the app (it now honours `VITE_API_BASE`), and set `POLYTOOLS_APP_ORIGINS` on the worker to the site's exact origin, e.g. `https://cryptoexplor.github.io` |
| Cloudflare Pages Functions (same origin) | Nothing — `POLYTOOLS_APP_ORIGINS` stays empty and behaviour is unchanged |

To identify the current failure in one step: open DevTools → Network → the
failing `challenge` request → **Response**. `origin_not_allowed` is ours;
`permission_denied` is Polyester's.
