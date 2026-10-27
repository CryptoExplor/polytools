# 19 — `upstream_403`: what the exchange actually said

Reported on the branch preview
(`arena-609563ba-polytools.polytools-cc8.pages.dev`):

```
POST /api/auth/challenge  →  403
{"error":"upstream_403"}
```

## 1. This is progress, and it is my code answering

`upstream_403` is not produced by Polyester and not by Cloudflare — it is the
fallback code in `backend/src/authProxy.ts` when the exchange answers with an
error **and no Connect error body**. Its presence proves three things:

| Fact | Evidence |
| --- | --- |
| The branch preview has the auth route deployed | the request reached our handler |
| Pages Functions relay POST bodies correctly | the call with `signerAddress` was accepted, not rejected as `invalid_body` |
| The server reached Polyester and got an answer | a 403 response, not a timeout or connection error |

So the transport works. What we had was an opaque code and no way to tell *who*
refused.

## 2. What a 403 with a non-JSON body means

Polyester's API speaks Connect: a refusal from the API itself is JSON,
`{"code": …, "message": …}`. We relay that verbatim. A **403 with an HTML or
empty body** therefore did not come from the API's application layer — it came
from **the edge in front of it**.

That distinction decides the next move:

| Refusal | Body | Meaning | Fix |
| --- | --- | --- | --- |
| API refuses our `uri` | JSON `permission_denied` | origin is pinned (C-1) | Polyester must recognise our origin |
| **Edge blocks our server** | HTML / empty + `cf-ray` | bot management rejected a server-to-server call | Polyester must allowlist our egress, or expose an API host without bot protection |

There is corroboration for the second case in this repo's own history: the
third-party scripts examined earlier call the same API through
`curl_cffi.Session(impersonate="chrome")` **specifically to pass Cloudflare**.
A request that needs a browser TLS fingerprint to succeed is exactly what a
Worker cannot produce.

### Why the browser cannot simply call the API instead

Because the exchange sends no `Access-Control-Allow-Origin` to our origin — we
tested that directly, and the POST never left the page. So:

- the browser is blocked by **CORS**,
- the server is blocked by **the edge**.

If both are true, no client-side or transport change fixes it. That is now the
leading hypothesis, and it is a Polyester conversation, not a code change.

## 3. What changed here

**The refusal is now attributable.** `describeUpstreamFailure()` reports the
upstream status, whether the body was HTML, whether it was a browser challenge,
and the `cf-ray` / `cf-mitigated` headers — the two values Polyester's support
needs to trace a request. Markup is never echoed back; only a label and those
identifiers are.

**The UI stopped blaming the wrong layer.** A refusal from the exchange was
being shown as *"the sign-in endpoint is not reachable"*, which is a different
failure entirely. It now names the actual one:

| Detail contains | Message shown |
| --- | --- |
| `browser challenge` / `cf-mitigated` / `cf-ray` | *Polyester's edge blocked the sign-in request before it reached the API (…)* |
| a plain message such as `uri is not permitted` | *Polyester refused this site's origin: …* |
| `upstream_<status>` only | *Polyester returned an unreadable refusal (…)* |

**The upstream call now sends `User-Agent` and `Accept`.** A request with no
User-Agent is a common bot-management trigger, so this may resolve it outright —
but it is offered as an improvement, not a promise: a Worker cannot present a
browser TLS fingerprint, and if the edge requires one this will not help. If the
runtime refuses the header, the request is retried without it rather than
failing.

## 4. Reproduce it in one command

After the branch preview rebuilds (pushing to the branch triggers it):

```bash
curl -sS -X POST \
  https://arena-609563ba-polytools.polytools-cc8.pages.dev/api/auth/challenge \
  -H 'Content-Type: application/json' \
  -d '{"signerAddress":"0x5c5a38168517b610fe06b00c07a2d45bbb10c2e8"}'
```

No wallet, no key, no signature. The response says which layer refused:

| Response | Verdict |
| --- | --- |
| `{"message": …}` | **It works.** The origin is accepted and only the edge was in the way |
| `{"error":"upstream_403","detail":"blocked by a browser challenge … cf-ray=…"}` | edge blocks our server → Polyester conversation, with the ray ID |
| `{"error":"permission_denied","detail":"uri is not permitted"}` | origin is pinned → Polyester conversation |
| `{"error":"upstream_403","detail":"HTTP 403 with an empty body · cf-ray=…"}` | a WAF rule, not a challenge → Polyester conversation with the ray ID |

## 5. Honest status

Still no verified end-to-end login. What is now true is narrower and more useful:
the transport is proven, the deployment is running the code, and the next
failure will name its own cause instead of hiding behind `upstream_403`.
