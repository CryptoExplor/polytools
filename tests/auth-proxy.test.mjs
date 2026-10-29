/**
 * Headless wallet login — the server-side transport.
 *
 * The exchange sends no `Access-Control-Allow-Origin` to our origin, so the
 * browser cannot call the auth service. These routes move that call onto the
 * server, where CORS does not apply.
 *
 * Everything here runs against a **local mock** of the two Connect RPCs. That
 * proves our plumbing: request shaping, origin derivation, validation, error
 * relay, cache and CORS behaviour. It proves nothing about the real exchange —
 * in particular it cannot answer whether the exchange accepts a challenge for
 * our origin (C-1). Those tests are marked, and no live call is made.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const webConfig = `${rootDir}/apps/web/vite.config.ts`;

const SMART_ACCOUNT = `0x${"a1".repeat(20)}`;
const SIGNER = `0x${"b2".repeat(20)}`;
const SIGNATURE = `0x${"c3".repeat(65)}`;
const MESSAGE = "testnet.polyester.com wants you to sign in with your Ethereum account";

let vite;
let backend;
let mock;
let mockOrigin;
/** Every request the proxy made upstream, in order, for assertions. */
let upstreamCalls = [];
/** Set per-test to change what the mock exchange answers. */
let scenario = {};

function startMock() {
  return new Promise((resolve) => {
    const server = createHttpServer((req, res) => {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let body = null;
        try {
          body = raw ? JSON.parse(raw) : null;
        } catch {
          body = raw;
        }
        upstreamCalls.push({
          method: req.method,
          url: req.url,
          headers: req.headers,
          body,
        });

        const send = (status, payload) => {
          const text = JSON.stringify(payload);
          res.writeHead(status, {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(text),
          });
          res.end(text);
        };

        if (scenario.transportFailure) {
          req.socket.destroy();
          return;
        }
        const reply = scenario.reply;
        if (reply) return send(reply.status, reply.body);

        if (req.url === "/auth.v1.AuthService/CreateWalletChallenge") {
          return send(200, {
            message: MESSAGE,
            expiresAt: { seconds: "1767225600", nanos: 0 },
          });
        }
        if (req.url === "/auth.v1.AuthService/LoginWithWallet") {
          return send(200, {
            accessToken: "tok_test_do_not_log",
            expiresAt: { seconds: "1767229200", nanos: 0 },
            accountId: "424242",
            username: "tester",
          });
        }
        return send(404, { code: "not_found", message: "no such route" });
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, origin: `http://127.0.0.1:${port}` });
    });
  });
}

before(async () => {
  vite = await createServer({
    root: rootDir,
    configFile: webConfig,
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  backend = await vite.ssrLoadModule("/backend/src/handler.ts");
  const started = await startMock();
  mock = started.server;
  mockOrigin = started.origin;
});

after(async () => {
  if (vite) await vite.close();
  if (mock) await new Promise((resolve) => mock.close(resolve));
});

function env(overrides = {}) {
  return { env: { POLYESTER_API_ORIGIN: mockOrigin, ...overrides } };
}

function authRequest(path, init = {}) {
  return new Request(`https://polytools.example${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "polytools-test/1.0" },
    ...init,
  });
}

function reset() {
  upstreamCalls = [];
  scenario = {};
}

describe("POST /api/auth/challenge", () => {
  it("forwards the request, returns the message verbatim, and binds our own origin", async () => {
    reset();
    const response = await backend.api(
      authRequest("/api/auth/challenge", {
        body: JSON.stringify({ smartAccountAddress: SMART_ACCOUNT, signerAddress: SIGNER }),
      }),
      env(),
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    // Byte-for-byte: the wallet signs these exact characters.
    assert.equal(body.message, MESSAGE);
    assert.equal(body.uri, "https://polytools.example");
    assert.equal(body.expiresAt, new Date(1767225600 * 1000).toISOString());

    assert.equal(upstreamCalls.length, 1);
    const call = upstreamCalls[0];
    assert.equal(call.url, "/auth.v1.AuthService/CreateWalletChallenge");
    assert.equal(call.headers["connect-protocol-version"], "1");
    assert.equal(call.headers["content-type"], "application/json");
    assert.equal(call.body.smartAccountAddress, SMART_ACCOUNT);
    assert.equal(call.body.signerAddress, SIGNER);
    assert.equal(call.body.uri, "https://polytools.example");
    // WalletChallengePurpose.LOGIN — the enum *name*, as the official client
    // emits it, never UNSPECIFIED and never a bare number.
    assert.equal(call.body.purpose, "LOGIN");
  });

  it("ignores a client-supplied uri, so the endpoint cannot mint a challenge for another origin", async () => {
    reset();
    const response = await backend.api(
      authRequest("/api/auth/challenge", {
        body: JSON.stringify({
          smartAccountAddress: SMART_ACCOUNT,
          signerAddress: SIGNER,
          // A caller trying to make us speak for somebody else.
          uri: "https://testnet.polyester.com",
          origin: "https://testnet.polyester.com",
        }),
      }),
      env(),
    );

    assert.equal(response.status, 200);
    assert.equal(upstreamCalls[0].body.uri, "https://polytools.example");
    assert.equal((await response.json()).uri, "https://polytools.example");
  });

  it("rejects malformed addresses without calling upstream", async () => {
    for (const body of [
      {},
      { smartAccountAddress: "0x123", signerAddress: SIGNER },
      { smartAccountAddress: SMART_ACCOUNT, signerAddress: "not-an-address" },
      { smartAccountAddress: SMART_ACCOUNT },
    ]) {
      reset();
      const response = await backend.api(authRequest("/api/auth/challenge", { body: JSON.stringify(body) }), env());
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.equal(upstreamCalls.length, 0, "must not reach the exchange");
    }
  });

  it("rejects a body that is not a JSON object", async () => {
    for (const raw of ["", "[]", "null", '"string"', "{bad json"]) {
      reset();
      const response = await backend.api(authRequest("/api/auth/challenge", { body: raw }), env());
      assert.equal(response.status, 400, `body ${JSON.stringify(raw)}`);
      assert.equal(upstreamCalls.length, 0);
    }
  });

  it("refuses an oversized body", async () => {
    reset();
    const response = await backend.api(
      authRequest("/api/auth/challenge", {
        body: JSON.stringify({ smartAccountAddress: SMART_ACCOUNT, signerAddress: SIGNER, pad: "x".repeat(9000) }),
      }),
      env(),
    );
    assert.equal(response.status, 400);
    assert.equal(upstreamCalls.length, 0);
  });
});

describe("POST /api/auth/login", () => {
  it("relays a signed message and returns the session token without caching it", async () => {
    reset();
    const response = await backend.api(
      authRequest("/api/auth/login", {
        body: JSON.stringify({
          smartAccountAddress: SMART_ACCOUNT,
          signature: SIGNATURE,
          message: MESSAGE,
        }),
      }),
      env(),
    );

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.accessToken, "tok_test_do_not_log");
    assert.equal(body.accountId, "424242");
    assert.equal(body.username, "tester");

    // A bearer token must never be cacheable, and never readable cross-origin.
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);

    const call = upstreamCalls[0];
    assert.equal(call.url, "/auth.v1.AuthService/LoginWithWallet");
    assert.equal(call.body.signature, SIGNATURE);
    assert.equal(call.body.message, MESSAGE);
    // Default hint: we will not claim to know the wallet's brand.
    assert.equal(call.body.walletProvider, "other");
    // No credential is ever put in a URL.
    assert.equal(call.url.includes("?"), false);
  });

  it("forwards a recognised wallet provider, clamped to the proto's 32 characters", async () => {
    reset();
    await backend.api(
      authRequest("/api/auth/login", {
        body: JSON.stringify({
          smartAccountAddress: SMART_ACCOUNT,
          signature: SIGNATURE,
          message: MESSAGE,
          walletProvider: "x".repeat(80),
        }),
      }),
      env(),
    );
    assert.equal(upstreamCalls[0].body.walletProvider.length, 32);
  });

  it("rejects a signature that is not 65 bytes, without calling upstream", async () => {
    for (const signature of ["", "0xdeadbeef", `0x${"c3".repeat(64)}`, `0x${"zz".repeat(65)}`]) {
      reset();
      const response = await backend.api(
        authRequest("/api/auth/login", {
          body: JSON.stringify({ smartAccountAddress: SMART_ACCOUNT, signature, message: MESSAGE }),
        }),
        env(),
      );
      assert.equal(response.status, 400, `signature ${signature.slice(0, 12)}`);
      assert.equal(upstreamCalls.length, 0);
    }
  });

  it("rejects a message longer than the proto's 4096 bytes", async () => {
    reset();
    const response = await backend.api(
      authRequest("/api/auth/login", {
        body: JSON.stringify({
          smartAccountAddress: SMART_ACCOUNT,
          signature: SIGNATURE,
          message: "m".repeat(5000),
        }),
      }),
      env(),
    );
    assert.equal(response.status, 400);
    assert.equal(upstreamCalls.length, 0);
  });
});

describe("failure behaviour — honest, not papered over", () => {
  it("relays the exchange's own refusal verbatim, so an origin rejection stays legible", async () => {
    reset();
    // This is the shape a pinned-origin answer would arrive in (C-1).
    scenario = {
      reply: { status: 403, body: { code: "permission_denied", message: "uri is not permitted" } },
    };
    const response = await backend.api(
      authRequest("/api/auth/challenge", {
        body: JSON.stringify({ smartAccountAddress: SMART_ACCOUNT, signerAddress: SIGNER }),
      }),
      env(),
    );

    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error, "permission_denied");
    assert.equal(body.detail, "uri is not permitted");
  });

  it("maps an unreachable exchange to 502 without inventing a login", async () => {
    reset();
    scenario = { transportFailure: true };
    const response = await backend.api(
      authRequest("/api/auth/challenge", {
        body: JSON.stringify({ smartAccountAddress: SMART_ACCOUNT, signerAddress: SIGNER }),
      }),
      env(),
    );
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, "upstream_unreachable");
  });

  it("does not turn a missing token into a success", async () => {
    reset();
    scenario = { reply: { status: 200, body: { expiresAt: { seconds: "1767229200" } } } };
    const response = await backend.api(
      authRequest("/api/auth/login", {
        body: JSON.stringify({ smartAccountAddress: SMART_ACCOUNT, signature: SIGNATURE, message: MESSAGE }),
      }),
      env(),
    );
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, "upstream_missing_token");
  });

  it("refuses a non-loopback plain-HTTP upstream instead of sending a signature in the clear", async () => {
    reset();
    const response = await backend.api(
      authRequest("/api/auth/challenge", {
        body: JSON.stringify({ smartAccountAddress: SMART_ACCOUNT, signerAddress: SIGNER }),
      }),
      { env: { POLYESTER_API_ORIGIN: "http://api.testnet.polyester.com" } },
    );
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "api_origin_misconfigured");
    assert.equal(upstreamCalls.length, 0);
  });
});

describe("dev/prod parity", () => {
  it("forwarded the body and headers through the dev middleware", async () => {
    // The dev middleware used to build `new Request(url, { method })`, dropping
    // the body and every header. Every POST route therefore worked in
    // production and could never work in `npm run dev`. This server wraps the
    // real Vite middleware so the fix is exercised, not assumed.
    const { createServer: createHttpServer } = await import("node:http");
    const devServer = createHttpServer((req, res) => {
      vite.middlewares(req, res, () => {
        res.statusCode = 404;
        res.end();
      });
    });
    await new Promise((resolve) => devServer.listen(0, "127.0.0.1", resolve));
    const port = devServer.address().port;
    const post = (headers, body) =>
      fetch(`http://127.0.0.1:${port}/api/auth/challenge`, { method: "POST", headers, body });

    try {
      // Malformed JSON proves the body arrived: an empty body parses as `{}`
      // and would fail on the address instead, which is a different error.
      const bad = await post({ "Content-Type": "application/json" }, "{bad");
      assert.equal(bad.status, 400);
      assert.equal((await bad.json()).error, "invalid_body");

      // The header proves headers arrived.
      const cross = await post(
        { "Content-Type": "application/json", Origin: "https://evil.example" },
        JSON.stringify({ smartAccountAddress: SMART_ACCOUNT, signerAddress: SIGNER }),
      );
      assert.equal(cross.status, 403);
      assert.equal((await cross.json()).error, "origin_not_allowed");
    } finally {
      await new Promise((resolve) => devServer.close(resolve));
    }
  });
});

describe("wire parity with the installed SDK", () => {
  it("emits the same CreateWalletChallenge body as the official client", async () => {
    // Point the SDK's own Connect client at the same mock and compare what it
    // puts on the wire with what our proxy puts on the wire. If the exchange
    // accepts one, it accepts the other. This is what caught `purpose` being
    // sent as the number 1 when Connect's JSON encoding uses the enum name.
    const { createClient } = await import("@connectrpc/connect");
    const { createConnectTransport } = await import("@connectrpc/connect-web");
    const { pathToFileURL } = await import("node:url");
    const pb = await import(
      pathToFileURL(`${rootDir}/node_modules/@polyester/sdk/dist/gen/auth/v1/auth_pb.js`).href
    );

    const client = createClient(
      pb.AuthService,
      createConnectTransport({ baseUrl: mockOrigin, useBinaryFormat: false }),
    );

    reset();
    // The SDK's response parsing is not what is under test; the request body is.
    scenario = { reply: { status: 200, body: { message: MESSAGE } } };
    await client.createWalletChallenge({
      smartAccountAddress: SMART_ACCOUNT,
      signerAddress: SIGNER,
      uri: "https://polytools.example",
      purpose: pb.WalletChallengePurpose.LOGIN,
    });
    // `upstreamCalls[].body` is already the parsed JSON the mock received.
    const officialBody = upstreamCalls[0].body;

    reset();
    await backend.api(
      authRequest("/api/auth/challenge", {
        body: JSON.stringify({ smartAccountAddress: SMART_ACCOUNT, signerAddress: SIGNER }),
      }),
      env(),
    );
    const ours = upstreamCalls[0].body;

    // Same path, same protocol header, same JSON field names and values.
    assert.equal(upstreamCalls[0].url, "/auth.v1.AuthService/CreateWalletChallenge");
    assert.deepEqual(ours, officialBody);
    assert.equal(ours.purpose, "LOGIN");
  });
});

describe("upstream origin is constrained, not merely validated", () => {
  it("refuses a non-Polyester host outright", async () => {
    // The env var may pick which Polyester endpoint to use. It must never be
    // able to redirect a login message and an EOA signature to someone else.
    for (const origin of [
      "https://evil.example",
      "https://polyester.com.evil.example",
      "https://api.polyester.co",
      "https://notpolyester.com",
    ]) {
      reset();
      const response = await backend.api(
        authRequest("/api/auth/challenge", {
          body: JSON.stringify({ smartAccountAddress: SMART_ACCOUNT, signerAddress: SIGNER }),
        }),
        { env: { POLYESTER_API_ORIGIN: origin } },
      );
      assert.equal(response.status, 503, origin);
      assert.equal((await response.json()).error, "api_origin_misconfigured");
      assert.equal(upstreamCalls.length, 0, `${origin} must never be contacted`);
    }
  });

  it("accepts Polyester endpoints, and loopback for tests", async () => {
    const { resolveAuthApiOrigin } = await vite.ssrLoadModule("/backend/src/authProxy.ts");
    for (const origin of [
      "https://api.testnet.polyester.com",
      "https://api.polyester.com",
      "https://polyester.com",
      "https://staging.api.polyester.com",
    ]) {
      assert.equal(resolveAuthApiOrigin({ POLYESTER_API_ORIGIN: origin }), origin, origin);
    }
    assert.equal(resolveAuthApiOrigin({ POLYESTER_API_ORIGIN: "http://127.0.0.1:8080" }), "http://127.0.0.1:8080");
    // Plain HTTP to a public host is never allowed, even a Polyester one.
    assert.equal(resolveAuthApiOrigin({ POLYESTER_API_ORIGIN: "http://api.testnet.polyester.com" }), null);
    // The default is the real testnet endpoint, not something surprising.
    assert.equal(resolveAuthApiOrigin(undefined), "https://api.testnet.polyester.com");
  });
});

describe("upstream refusals stay attributable", () => {
  const describeFn = async () =>
    (await vite.ssrLoadModule("/backend/src/authProxy.ts")).describeUpstreamFailure;

  it("relays a Connect error as the exchange's own words", async () => {
    const d = await describeFn();
    const result = d(
      403,
      "application/json",
      new Headers(),
      JSON.stringify({ code: "permission_denied", message: "uri is not permitted" }),
      { code: "permission_denied", message: "uri is not permitted" },
    );
    assert.equal(result.code, "permission_denied");
    assert.equal(result.detail, "uri is not permitted");
  });

  it("identifies an edge challenge instead of flattening it to upstream_403", async () => {
    // The reported failure: 403 with an HTML body. Polyester's API speaks
    // Connect JSON, so an HTML 403 comes from the edge in front of it.
    const d = await describeFn();
    const headers = new Headers({ "cf-mitigated": "challenge", "cf-ray": "8f2a1c3d4e5f-LHR" });
    const result = d(403, "text/html; charset=UTF-8", headers, "<!DOCTYPE html><title>Just a moment...</title>", null);
    assert.equal(result.code, "upstream_403");
    assert.match(result.detail, /browser challenge/i);
    assert.match(result.detail, /cf-ray=8f2a1c3d4e5f-LHR/);
    // The markup must never be echoed back.
    assert.equal(/<title>|<!DOCTYPE/i.test(result.detail), false);
  });

  it("names a firewall block without echoing the page", async () => {
    // The real answer from the deployed preview: 403, HTML, cf-ray, and no
    // cf-mitigated header. Cloudflare uses cf-mitigated for challenges, so its
    // absence is itself the evidence that this was a rule block, not a challenge.
    const d = await describeFn();
    const headers = new Headers({ "cf-ray": "a514e09d6d7fa7e5-DEL" });
    const html =
      '<!DOCTYPE html><html><head><title>Access denied | api.testnet.polyester.com used Cloudflare to restrict access</title></head>' +
      "<body><h1>Error 1020</h1><p>This website is using a security service.</p></body></html>";
    const result = d(403, "text/html", headers, html, null);

    assert.equal(result.code, "upstream_403");
    assert.match(result.detail, /firewall/i);
    assert.match(result.detail, /cf-error=1020/);
    assert.match(result.detail, /title="Access denied/);
    assert.match(result.detail, /cf-ray=a514e09d6d7fa7e5-DEL/);
    // Markup never reaches the caller; only the title text and the identifiers.
    assert.equal(/<title>|<h1>|DOCTYPE/i.test(result.detail), false);
    // It must not claim a browser challenge it has no evidence for: no
    // cf-mitigated header and no challenge marker in the page.
    assert.equal(/browser challenge|cf-mitigated/i.test(result.detail), false);
  });

  it("does not echo arbitrary HTML as a message", async () => {
    const d = await describeFn();
    const result = d(502, "text/html", new Headers(), "<html><body>Bad gateway</body></html>", null);
    assert.match(result.detail, /firewall|HTML/i);
    assert.equal(/<body>/.test(result.detail), false);
  });

  it("passes through a short non-JSON body, capped", async () => {
    const d = await describeFn();
    const result = d(400, "text/plain", new Headers(), "x".repeat(900), null);
    assert.equal(result.detail.length <= 200, true);
  });

  it("returns the real status and code through the route", async () => {
    reset();
    scenario = {
      reply: { status: 403, body: { code: "permission_denied", message: "uri is not permitted" } },
    };
    const response = await backend.api(
      authRequest("/api/auth/challenge", {
        body: JSON.stringify({ signerAddress: SIGNER }),
      }),
      env(),
    );
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error, "permission_denied");
    assert.equal(body.detail, "uri is not permitted");
  });
});

describe("timestamps arrive the way ProtoJSON actually writes them", () => {
  // auth_v1_auth's CreateWalletChallengeResponse.expires_at is a
  // google.protobuf.Timestamp, which ProtoJSON serialises as an RFC 3339 string.
  // Reading only the {seconds,nanos} object form dropped every real expiry, and a
  // null expiry was then treated by the client as usable indefinitely.
  const RFC = "2026-10-27T21:43:44Z";

  it("passes an RFC 3339 string through as ISO-8601", async () => {
    reset();
    scenario = { reply: { status: 200, body: { message: MESSAGE, expiresAt: RFC } } };
    const response = await backend.api(
      authRequest("/api/auth/challenge", { body: JSON.stringify({ signerAddress: SIGNER }) }),
      env(),
    );
    assert.equal((await response.json()).expiresAt, "2026-10-27T21:43:44.000Z");
  });

  it("still accepts the object form the binary wire uses", async () => {
    reset();
    scenario = { reply: { status: 200, body: { message: MESSAGE, expiresAt: { seconds: 1793134000, nanos: 500_000_000 } } } };
    const response = await backend.api(
      authRequest("/api/auth/challenge", { body: JSON.stringify({ signerAddress: SIGNER }) }),
      env(),
    );
    assert.equal((await response.json()).expiresAt, new Date(1793134000_500).toISOString());
  });

  it("reports null, not a guess, for a shape it does not understand", async () => {
    reset();
    scenario = { reply: { status: 200, body: { message: MESSAGE, expiresAt: "not a date" } } };
    const response = await backend.api(
      authRequest("/api/auth/challenge", { body: JSON.stringify({ signerAddress: SIGNER }) }),
      env(),
    );
    assert.equal((await response.json()).expiresAt, null);
  });

  it("carries the login expiry through to the client", async () => {
    reset();
    scenario = {
      reply: {
        status: 200,
        body: { accessToken: "tok", expiresAt: RFC, accountId: "1", username: "u" },
      },
    };
    const response = await backend.api(
      authRequest("/api/auth/login", {
        body: JSON.stringify({ smartAccountAddress: SMART_ACCOUNT, signature: SIGNATURE, message: MESSAGE }),
      }),
      env(),
    );
    assert.equal((await response.json()).expiresAt, "2026-10-27T21:43:44.000Z");
  });
});

describe("the challenge URN decides which account is logged in", () => {
  // Evidence: a working third-party client parses
  // `urn:polyester:wallet-challenge:login:0x…` out of the message and notes that
  // this address is what LoginWithWallet must receive. The exchange can issue a
  // challenge for a root account we did not predict.
  const ROOT = `0x${"d4".repeat(20)}`;

  // Copied from Polyester's public API reference for POST /v1/auth/wallet-challenge.
  // The address is the last colon segment, after `eip155:<chainId>`. An earlier
  // parser read the whole remainder as the address, never matched, and fell back
  // silently, which made the whole fix inert.
  const DOCUMENTED = [
    "devnet.polyester.com wants you to sign in with your Ethereum account:",
    "0x5555555555555555555555555555555555555555",
    "",
    "Sign in to Polyester. This does not authorize a transaction.",
    "",
    "URI: https://devnet.polyester.com",
    "Version: 1",
    "Chain ID: 1",
    "Nonce: 8f3a72c91b4de6058f3a72c91b4de6058f3a72c91b4de6058f3a72c91b4de605",
    "Issued At: 2026-01-01T00:00:00Z",
    "Expiration Time: 2026-01-01T00:05:00Z",
    "Request ID: 8f3a72c91b4de6058f3a72c91b4de6058f3a72c91b4de6058f3a72c91b4de605",
    "Resources:",
    "- urn:polyester:wallet-challenge:login:eip155:888168:0x2222222222222222222222222222222222222222",
  ].join("\n");

  it("parses the documented URN shape with a chain id in it", async () => {
    reset();
    scenario = { reply: { status: 200, body: { message: DOCUMENTED, expiresAt: "2026-01-01T00:05:00Z" } } };
    const response = await backend.api(
      authRequest("/api/auth/challenge", { body: JSON.stringify({ signerAddress: SIGNER }) }),
      env(),
    );
    assert.equal(response.status, 200);
    assert.equal(
      (await response.json()).smartAccountAddress,
      "0x2222222222222222222222222222222222222222",
      "the address after eip155:<chainId> must be extracted",
    );
  });

  it("sends the documented URN account to login as well", async () => {
    reset();
    scenario = { reply: { status: 200, body: { accessToken: "tok", expiresAt: "2026-01-01T00:05:00Z", accountId: "1" } } };
    await backend.api(
      authRequest("/api/auth/login", {
        body: JSON.stringify({ smartAccountAddress: SMART_ACCOUNT, signature: SIGNATURE, message: DOCUMENTED }),
      }),
      env(),
    );
    assert.equal(upstreamCalls.at(-1).body.smartAccountAddress, "0x2222222222222222222222222222222222222222");
  });

  it("still reads a bare single-segment URN", async () => {
    reset();
    scenario = { reply: { status: 200, body: { message: `Resources:\n- urn:polyester:wallet-challenge:login:${ROOT}`, expiresAt: 1 } } };
    const response = await backend.api(
      authRequest("/api/auth/challenge", { body: JSON.stringify({ signerAddress: SIGNER }) }),
      env(),
    );
    assert.equal((await response.json()).smartAccountAddress, ROOT);
  });

  it("returns the URN account, not the derived one", async () => {
    reset();
    scenario = {
      reply: { status: 200, body: { message: `line one\nurn:polyester:wallet-challenge:login:${ROOT}\n`, expiresAt: 1 } },
    };
    const response = await backend.api(
      authRequest("/api/auth/challenge", { body: JSON.stringify({ signerAddress: SIGNER }) }),
      env(),
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).smartAccountAddress, ROOT);
  });

  it("sends the URN account upstream at login, not the client's copy", async () => {
    reset();
    scenario = {
      reply: { status: 200, body: { accessToken: "tok", expiresAt: 1, accountId: "1", username: "u" } },
    };
    const response = await backend.api(
      authRequest("/api/auth/login", {
        body: JSON.stringify({
          smartAccountAddress: SMART_ACCOUNT,
          signature: SIGNATURE,
          message: `some challenge\nurn:polyester:wallet-challenge:login:${ROOT}\n`,
        }),
      }),
      env(),
    );
    assert.equal(response.status, 200);
    const loginCall = upstreamCalls.at(-1);
    assert.match(loginCall.url, /LoginWithWallet/);
    assert.equal(loginCall.body.smartAccountAddress, ROOT);
  });

  it("falls back to the caller's address when the message has no URN", async () => {
    reset();
    scenario = {
      reply: { status: 200, body: { accessToken: "tok", expiresAt: 1, accountId: "1", username: "u" } },
    };
    await backend.api(
      authRequest("/api/auth/login", {
        body: JSON.stringify({ smartAccountAddress: SMART_ACCOUNT, signature: SIGNATURE, message: MESSAGE }),
      }),
      env(),
    );
    assert.equal(upstreamCalls.at(-1).body.smartAccountAddress, SMART_ACCOUNT);
  });

  it("ignores a malformed URN rather than trusting it", async () => {
    reset();
    scenario = {
      reply: { status: 200, body: { accessToken: "tok", expiresAt: 1, accountId: "1", username: "u" } },
    };
    await backend.api(
      authRequest("/api/auth/login", {
        body: JSON.stringify({
          smartAccountAddress: SMART_ACCOUNT,
          signature: SIGNATURE,
          message: "urn:polyester:wallet-challenge:login:not-an-address",
        }),
      }),
      env(),
    );
    assert.equal(upstreamCalls.at(-1).body.smartAccountAddress, SMART_ACCOUNT);
  });
});

describe("a session token can never reach the shared cache", () => {
  it("dispatches the auth route before any cache lookup", async () => {
    // This is the structural guarantee, not a header. Auth is handled before the
    // `cached()` calls in api(), so no token can enter the isolate-wide store
    // even if a response header were ever dropped. If a refactor moves the
    // auth branch below the cache, this fails.
    const { clearCache, cacheStats } = await vite.ssrLoadModule("/backend/src/cache.ts");
    clearCache();
    reset();
    scenario = {
      reply: {
        status: 200,
        body: { accessToken: "tok_secret", expiresAt: "2026-10-27T21:43:44.000Z", accountId: "1", username: "u" },
      },
    };

    const before = cacheStats();
    const response = await backend.api(
      authRequest("/api/auth/login", {
        body: JSON.stringify({ smartAccountAddress: SMART_ACCOUNT, signature: SIGNATURE, message: MESSAGE }),
      }),
      env(),
    );
    const after = cacheStats();

    assert.equal(response.status, 200);
    assert.equal((await response.json()).accessToken, "tok_secret");
    assert.deepEqual(after, before, "the cache must be untouched by an auth request");
    assert.equal(after.keys, 0);
  });

  it("still marks the token non-cacheable for anything downstream", async () => {
    reset();
    scenario = {
      reply: {
        status: 200,
        body: { accessToken: "tok_secret", expiresAt: "2026-10-27T21:43:44.000Z", accountId: "1", username: "u" },
      },
    };
    const response = await backend.api(
      authRequest("/api/auth/login", {
        body: JSON.stringify({ smartAccountAddress: SMART_ACCOUNT, signature: SIGNATURE, message: MESSAGE }),
      }),
      env(),
    );
    assert.equal(response.headers.get("Cache-Control"), "no-store");
  });
});

describe("surface discipline", () => {
  it("is same-origin only and POST-only", async () => {
    reset();
    const get = await backend.api(
      new Request("https://polytools.example/api/auth/challenge"),
      env(),
    );
    assert.equal(get.status, 405);

    const options = await backend.api(
      new Request("https://polytools.example/api/auth/challenge", { method: "OPTIONS" }),
      env(),
    );
    assert.equal(options.status, 204);
    // Critically: no `*`. A token response must not be open to other origins.
    assert.equal(options.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal(options.headers.get("Allow"), "POST, OPTIONS");
  });

  it("refuses an unlisted cross-origin caller before it reaches the exchange", async () => {
    reset();
    const response = await backend.api(
      authRequest("/api/auth/challenge", {
        headers: { "Content-Type": "application/json", Origin: "https://evil.example" },
        body: JSON.stringify({ smartAccountAddress: SMART_ACCOUNT, signerAddress: SIGNER }),
      }),
      env(),
    );
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "origin_not_allowed");
    assert.equal(upstreamCalls.length, 0);
    // An unlisted origin gets no CORS grant, so it cannot read the reply either.
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  });

  it("allows the app origin when it is explicitly configured", async () => {
    // The documented deployment is a static frontend on a different origin from
    // the worker. A same-origin-only rule broke every real request.
    reset();
    const response = await backend.api(
      authRequest("/api/auth/challenge", {
        headers: { "Content-Type": "application/json", Origin: "https://app.example" },
        body: JSON.stringify({ signerAddress: SIGNER }),
      }),
      { env: { POLYESTER_API_ORIGIN: mockOrigin, POLYTOOLS_APP_ORIGINS: "https://app.example" } },
    );
    assert.equal(response.status, 200);
    // Echoed exactly, never `*`.
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://app.example");
    assert.equal(response.headers.get("Vary"), "Origin");
    assert.equal(upstreamCalls.length, 1);
  });

  it("answers the preflight only for an allowed origin", async () => {
    const preflight = (origin, appOrigins) =>
      backend.api(
        new Request("https://polytools.example/api/auth/challenge", {
          method: "OPTIONS",
          headers: { Origin: origin, "Access-Control-Request-Method": "POST" },
        }),
        { env: { POLYESTER_API_ORIGIN: mockOrigin, ...(appOrigins ? { POLYTOOLS_APP_ORIGINS: appOrigins } : {}) } },
      );

    const blocked = await preflight("https://evil.example");
    assert.equal(blocked.status, 403);
    assert.equal(blocked.headers.get("Access-Control-Allow-Origin"), null);

    const ok = await preflight("https://app.example", "https://app.example");
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get("Access-Control-Allow-Origin"), "https://app.example");
    assert.match(ok.headers.get("Access-Control-Allow-Headers") ?? "", /content-type/i);
  });

  it("keeps same-origin callers working with no CORS grant at all", async () => {
    reset();
    const response = await backend.api(
      authRequest("/api/auth/challenge", {
        body: JSON.stringify({ signerAddress: SIGNER }),
      }),
      env(),
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
  });

  it("parses the allowlist defensively", async () => {
    const { resolveAppOrigins } = await vite.ssrLoadModule("/backend/src/authProxy.ts");
    assert.deepEqual(resolveAppOrigins(undefined), []);
    assert.deepEqual(resolveAppOrigins({ POLYTOOLS_APP_ORIGINS: "" }), []);
    assert.deepEqual(
      resolveAppOrigins({ POLYTOOLS_APP_ORIGINS: "https://a.example, https://b.example/" }),
      ["https://a.example", "https://b.example"],
    );
    // A malformed entry must not widen the list.
    assert.deepEqual(resolveAppOrigins({ POLYTOOLS_APP_ORIGINS: "not-a-url,https://a.example" }), ["https://a.example"]);
  });

  it("leaves every existing route GET-only", async () => {
    reset();
    for (const path of ["/api/markets", "/api/orderbook", "/api/health", "/api/env"]) {
      const response = await backend.api(new Request(`https://polytools.example${path}`, { method: "POST" }), env());
      assert.equal(response.status, 405, path);
    }
    assert.equal(upstreamCalls.length, 0);
  });

  it("announces no orders and no account mutation anywhere in the auth module", async () => {
    const source = (await import("node:fs")).readFileSync(
      `${rootDir}/backend/src/authProxy.ts`,
      "utf8",
    );
    for (const forbidden of ["CreateOrder", "CancelOrder", "PreviewOrder", "privateKey", "console.", "localStorage"]) {
      assert.equal(source.includes(forbidden), false, `authProxy must not mention ${forbidden}`);
    }
  });
});
