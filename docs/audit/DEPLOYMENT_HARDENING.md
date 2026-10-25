# P2-9 deployment hardening

**Date:** 2026-10-25
**Status:** implemented and tested in the local working tree; not deployed

## 1. Evidence boundary

This change defines and tests repository-controlled browser/API security headers and reviews the public facade's operational abuse boundary. It does **not** establish that any deployed Vercel, Cloudflare Pages, Cloudflare Worker, GitHub Pages, upstream Polyester, or CoinGecko response currently has a particular header, quota, rate limit, log configuration, or availability guarantee.

No deployment, Wrangler dry run, real credential, authenticated account request, financial mutation, or live compatibility check was performed. Local builds and synthetic responses are not deployed-header evidence.

## 2. Resource inventory and resulting browser policy

The shared source of truth is `packages/core/src/deploymentSecurity.ts`.

| Actual need | Policy consequence |
|---|---|
| Vite production JS, CSS, icons, manifest, and other same-origin static assets | `default-src 'self'`, `script-src 'self'`, `font-src 'self'`, and `manifest-src 'self'`; production scripts remain external and no `unsafe-eval` is allowed. |
| React inline `style` attributes | `style-src 'self' 'unsafe-inline'`. The exception is for styles, not inline scripts. |
| Public CoinGecko comparison fetch | `connect-src` allows `https://api.coingecko.com`. |
| Existing direct, exact-origin signed account GETs | `connect-src` allows only the reviewed official testnet REST origin, `https://api.testnet.polyester.com`. No account proxy or credential relaxation was added. |
| Configurable credential-free public API facade on Workers | `connect-src` allows `https://*.workers.dev`. A custom `VITE_API_BASE` origin outside this set requires an explicit policy/configuration update; it is not silently allowed. |
| Official Polyester logos, token images, posters, and media | `img-src`/`media-src` allow `https://assets.polyester.com`; same-origin and data images remain supported. |
| WebCrypto vault/signing operations | No CSP or Permissions-Policy exception is needed. A secure browser context and the existing browser compatibility checks are still required. |
| Explicit clipboard copy buttons | `clipboard-write=(self)` is retained; clipboard read is disabled. |
| No intentional framing or embedded objects | `frame-ancestors 'none'`, `frame-src 'none'`, `object-src 'none'`, and legacy `X-Frame-Options: DENY`. |
| No production browser WebSocket use | No production `wss:` exception was added. Cloudflare's server-side Worker is unrelated to the browser `worker-src` directive. |
| Vite development client/React refresh | The production CSP plugin has `apply: "build"`; development HTML is not given this policy, so the Vite client, React refresh preamble, and HMR socket are not constrained by it. |

The policy also sets `base-uri 'none'`, `form-action 'self'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, and a Permissions-Policy that disables unused sensors/devices/capture/payment capabilities while retaining self fullscreen and picture-in-picture.

No COOP, COEP, or CORP policy was added speculatively. Those are separate compatibility decisions, not prerequisites for the requested headers.

## 3. Platform coverage

| Target | Repository mechanism | Important limit |
|---|---|---|
| Root Cloudflare Worker static assets | `backend/adapters/worker.ts` clones the `ASSETS` response through `withSecurityHeaders`, preserving status, body, cache, and existing headers. | Synthetic binding responses were tested; the deployed Worker was not queried. |
| Root Worker `/api/*` | Requests continue through the shared `api()` handler. | No private account route or authentication change was added. |
| Shared backend responses | `backend/src/handler.ts` applies the same headers to JSON success/error responses and OPTIONS preflights. Existing open public CORS, cache, and wire-sample provenance headers are preserved. | Adapter-level platform behavior and any platform-injected headers remain unverified. |
| Cloudflare Pages static assets | `apps/web/public/_headers` is copied into the production output. | A local parser/equality test is not a Cloudflare dashboard or deployed-response check. |
| Cloudflare Pages Functions | `backend/adapters/cloudflare-pages.ts` inherits shared-handler headers. | Tested with a synthetic context only. |
| Vercel static output and functions | `vercel.json` declares the same all-route headers; the Edge adapter also inherits the shared API values. | JSON/static configuration tests do not prove Vercel accepted or deployed the configuration. |
| GitHub Pages or another static-only host without header configuration | The production Vite build injects CSP and referrer meta tags into `index.html`; the Pages workflow's copied `404.html` therefore receives the same fallback. | **Not equivalent to HTTP headers.** `frame-ancestors` is omitted because it is ignored in meta. Meta cannot supply `nosniff`, `X-Frame-Options`, or Permissions-Policy. No GitHub Pages header enforcement is claimed. |

When both an HTTP CSP and the meta CSP are present, normal browser CSP intersection rules apply. The HTTP header additionally supplies `frame-ancestors` and the other non-meta controls.

## 4. Public abuse, quota, cache, and logging review

This review deliberately does not respond to public abuse risk by adding wallet authentication, private account proxying, or credential collection.

| Area | Established from source | Residual risk / unknown |
|---|---|---|
| Application rate limiting | The public handler remains credential-free GET/OPTIONS with open CORS. There is no application request-rate limiter and no locally generated 429 policy. | Cloudflare/Vercel WAF, firewall, rate-limit rules, and actual thresholds are owner-controlled and unknown. They must be checked per target rather than inferred from code. |
| Existing request controls | Methods are restricted; depth/timeframe/side/interval/compare/lookup values are allowlisted; numeric ranges are clamped; transaction/flow identifiers are validated; unsafe MCP URL schemes are rejected; upstream errors use safe public messages. | These controls do not cap requests per client or total upstream calls. |
| Backend TTL cache | Per-isolate memory cache has at most 200 resolved keys, expiry cleanup/eviction, short route-specific TTLs, and same-key single-flight coalescing. Candle timestamp bounds are quantized to 60-second cache-key buckets. | This is not a global cache or quota. Arbitrary valid query variants can still create high-cardinality work; concurrent distinct in-flight keys and request rate are not globally bounded. The 200-key limit does not bound response bytes or upstream requests per second. |
| Browser public metadata cache | The separately reviewed public-only cache has bounded entries/bytes, freshness/staleness policy, cleanup, and single-flight behavior. | It does not provide server-side abuse protection and never stores private account records. |
| Upstream Polyester/MCP quotas | Cache and single-flight can reduce duplicate origin calls. | Actual upstream quota, burst behavior, isolation across Workers/isolates, and operational limits are unknown. No quota number is asserted. |
| CoinGecko use | Compare polls from each browser on a 35-second interval and displays errors rather than converting missing references to zero. | A per-browser interval is not a fleet-wide rate limit. CoinGecko's current plan quota and deployed client volume are unknown. |
| Logging | No request logger was added to the shared handler. The Node adapter has its existing startup message. | Platform request/build logs, retention, access, alerting, and redaction are unknown. Public query strings can contain transaction/flow identifiers; owners should review log retention and avoid treating them as harmless telemetry. No signed account headers or private account responses should be sent to this backend. |
| Optional notification side effect | The existing Worker cron can read public movers every 15 minutes and POST to Telegram when configured. | Telegram/API quotas, secrets, logs, and deployed cron state were not inspected or changed. This is not an exchange-account mutation. |
| HSTS | No HSTS header was added by this change. | HTTPS redirect behavior, platform-managed HSTS, custom-domain requirements, and the safety of `includeSubDomains`/preload require owner evidence. Deployed HSTS state remains unknown. |

A cache bound is not represented as a rate limiter, and a successful local synthetic response is not represented as deployment protection.

## 5. Required owner follow-up

1. Deploy to owner-controlled previews and inspect actual static, SPA-fallback, API success/error, and OPTIONS responses for duplicate or conflicting headers.
2. Exercise the built SPA in supported browsers with the HTTP CSP enabled, including Compare, brand images/media, clipboard copy, WebCrypto vault operations, and least-privilege signed account reads. Check the browser console for CSP/CORS failures. This was not done locally.
3. Review and configure platform rate limits/WAF rules from measured traffic and confirmed upstream quotas; test the resulting 429 behavior without sending credentials to the public facade.
4. Measure cache hit/concurrency behavior across real isolates. If high-cardinality or burst abuse is observed, choose explicit input/concurrency/rate controls from evidence rather than claiming the 200-entry cache solves it.
5. Review platform log access, retention, alerting, and query-string redaction, plus the unresolved Workers Builds owner logs. No build failure root cause is inferred here.
6. Decide HSTS only after verifying each hostname's HTTPS and subdomain posture. Revisit COOP/COEP/CORP separately if a demonstrated need arises.

## 6. Local verification

- `node --test tests/deployment-security.test.mjs`: **8/8 passed, 3 suites**. Includes an actual temporary Vite production build, emitted HTML/`_headers` assertions, development HTML transformation, static configuration parity, and synthetic API/adapter/Worker responses.
- `node --test tests/compare.test.mjs`: **7/7 passed, 2 suites** (P2-10 companion change).
- `npm test`: **178/178 passed, 39 suites**. Existing SSR React `useLayoutEffect` warnings and the production chunk-size warning remain visible; neither was suppressed.
- `npm run typecheck`: passed for web and backend.
- `npm run build`: passed; **96 modules**, `590.28 kB` JS / `176.05 kB` gzip, `34.09 kB` CSS / `7.02 kB` gzip.
- Direct inspection of `apps/web/dist/index.html`: CSP/referrer meta appears after charset and before the external same-origin module script; the meta omits `frame-ancestors` and contains no unsupported Permissions-Policy/nosniff/X-Frame-Options substitutes.
- Direct inspection of `apps/web/dist/_headers`: emitted values match the shared policy.
- `git diff --check`: passed.

The development transform contained `/@vite/client` and no CSP. This is source/transform evidence only; no real browser HMR socket, browser CSP console, deployed response, or live external resource was tested.
