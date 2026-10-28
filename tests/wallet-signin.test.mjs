/**
 * Wallet sign-in — signer, session, and the full challenge → sign → token flow.
 *
 * The exchange itself is mocked. That proves our half: message integrity,
 * explicit-consent gating, the state machine, token handling, and the failure
 * paths. It cannot prove that Polyester accepts our origin (C-1), and nothing
 * here may be read as proof of that.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const webConfig = `${rootDir}/apps/web/vite.config.ts`;
const source = (path) => readFileSync(`${rootDir}/${path}`, "utf8");

const MESSAGE =
  "polyester.example wants you to sign in with your Ethereum account:\n0xabCDeF0123456789AbcdEf0123456789aBCDEF01";
const EOA = "0xabCDeF0123456789AbcdEf0123456789aBCDEF01";
const SIGNATURE = `0x${"c3".repeat(65)}`;

let vite;
let signer;
let sessionModule;
let backend;
let mock;
let mockOrigin;
let upstreamCalls = [];
let scenario = {};

function startMock() {
  return new Promise((resolve) => {
    const server = createHttpServer((req, res) => {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let body = null;
        try {
          body = raw ? JSON.parse(raw) : null;
        } catch {
          body = raw;
        }
        upstreamCalls.push({ url: req.url, body });
        const send = (status, payload) => {
          const text = JSON.stringify(payload);
          res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
          res.end(text);
        };
        if (scenario.reply) return send(scenario.reply.status, scenario.reply.body);
        if (req.url === "/auth.v1.AuthService/CreateWalletChallenge") {
          return send(200, { message: MESSAGE, expiresAt: { seconds: "1767225600" } });
        }
        if (req.url === "/auth.v1.AuthService/LoginWithWallet") {
          return send(200, {
            accessToken: "tok_memory_only",
            expiresAt: { seconds: "1767229200" },
            accountId: "424242",
            username: "tester",
          });
        }
        return send(404, { code: "not_found" });
      });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

before(async () => {
  vite = await createServer({
    root: rootDir,
    configFile: webConfig,
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  signer = await vite.ssrLoadModule("/apps/web/src/lib/walletSigner.ts");
  sessionModule = await vite.ssrLoadModule("/apps/web/src/lib/polyesterSession.ts");
  backend = await vite.ssrLoadModule("/backend/src/handler.ts");
  const started = await startMock();
  mock = started.server;
  mockOrigin = started.origin;
});

after(async () => {
  if (vite) await vite.close();
  if (mock) await new Promise((r) => mock.close(r));
});

/** A wallet that signs on request and records what it was asked to sign. */
function fakeWallet({ signature = SIGNATURE, reject = false } = {}) {
  const calls = [];
  return {
    calls,
    isMetaMask: true,
    async request({ method, params }) {
      calls.push({ method, params });
      if (method === "personal_sign") {
        if (reject) {
          const error = new Error("User rejected");
          error.code = 4001;
          throw error;
        }
        return signature;
      }
      return null;
    },
    on() {},
    removeListener() {},
  };
}

/** A fetch that routes our proxy calls straight into the backend handler. */
function proxyFetch() {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input.url;
    return backend.api(
      new Request(`https://polytools.example${url}`, {
        method: init?.method ?? "GET",
        headers: init?.headers,
        body: init?.body,
      }),
      { env: { POLYESTER_API_ORIGIN: mockOrigin } },
    );
  };
}

const reset = () => {
  upstreamCalls = [];
  scenario = {};
};

describe("message integrity — the wallet signs exactly the issued bytes", () => {
  it("round-trips UTF-8 without altering it", async () => {
    const samples = [
      "simple",
      "line one\nline two",
      "unicode: é ü 漢字 🔐",
      "  leading and trailing spaces  ",
      "tab\there",
      "0xlooks-like-hex",
    ];
    for (const sample of samples) {
      const hex = signer.messageToHex(sample);
      assert.equal(signer.hexToMessage(hex), sample, sample);
      assert.match(hex, /^0x[0-9a-f]*$/);
    }
  });

  it("sends the wallet the exact hex of the message, unmodified", async () => {
    const wallet = fakeWallet();
    await signer.signLoginMessage({ provider: wallet, address: EOA, message: MESSAGE });
    const request = wallet.calls[0];
    assert.equal(request.method, "personal_sign");
    // personal_sign param order: [data, address].
    assert.equal(request.params[0], signer.messageToHex(MESSAGE));
    assert.equal(request.params[1], EOA);
    assert.equal(signer.hexToMessage(request.params[0]), MESSAGE);
  });

  it("rejects a signature that is not 65 bytes", async () => {
    const wallet = fakeWallet({ signature: "0xdeadbeef" });
    await assert.rejects(
      () => signer.signLoginMessage({ provider: wallet, address: EOA, message: MESSAGE }),
      (error) => error.code === "malformed_signature",
    );
  });

  it("classifies a wallet refusal without leaking provider text", async () => {
    const wallet = fakeWallet({ reject: true });
    await assert.rejects(
      () => signer.signLoginMessage({ provider: wallet, address: EOA, message: MESSAGE }),
      (error) => error.code === "rejected" && !/User rejected/.test(error.message),
    );
  });
});

describe("session — memory only, explicit consent", () => {
  it("stores no token in browser storage anywhere in the module", () => {
    // Strip comments first: these files *say* "not localStorage" in prose, and
    // matching the word would report the documentation as the violation.
    const code = (file) =>
      source(file)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
    for (const file of ["apps/web/src/lib/polyesterSession.ts", "apps/web/src/lib/usePolyesterSession.ts"]) {
      const text = code(file);
      assert.equal(/\b(localStorage|sessionStorage|indexedDB)\b/.test(text), false, `${file} must not persist a token`);
      assert.equal(/document\.cookie/.test(text), false, `${file} must not write a cookie`);
    }
  });

  it("starts anonymous and only becomes authenticated after a real login", async () => {
    const store = new sessionModule.PolyesterSessionStore();
    assert.equal(store.status, "anonymous");
    assert.equal(store.getSnapshot(), null);
    assert.equal(store.isUsable(), false);
  });

  it("clears to anonymous on sign-out", async () => {
    const store = new sessionModule.PolyesterSessionStore();
    store.set({
      accessToken: "t",
      accountId: null,
      username: null,
      expiresAt: null,
      smartAccountAddress: EOA,
      signerAddress: EOA,
    });
    assert.equal(store.status, "authenticated");
    store.clear();
    assert.equal(store.status, "anonymous");
    assert.equal(store.getSnapshot(), null);
  });

  it("treats a passed expiry as unusable", () => {
    const store = new sessionModule.PolyesterSessionStore();
    store.set({
      accessToken: "t",
      accountId: null,
      username: null,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      smartAccountAddress: EOA,
      signerAddress: EOA,
    });
    assert.equal(store.isUsable(), false);
  });
});

describe("end to end — challenge, sign, token", () => {
  it("completes a login and sends only the owner EOA for derivation", async () => {
    reset();
    const wallet = fakeWallet();
    const result = await sessionModule.login({
      provider: wallet,
      address: EOA,
      fetchImpl: proxyFetch(),
    });

    assert.equal(result.accessToken, "tok_memory_only");
    assert.equal(result.accountId, "424242");

    // The exchange saw a derived Safe address, not the EOA, and not the EOA twice.
    const challengeCall = upstreamCalls.find((c) => c.url.endsWith("CreateWalletChallenge"));
    assert.ok(challengeCall, "challenge upstream call");
    assert.equal(challengeCall.body.signerAddress, EOA);
    assert.notEqual(challengeCall.body.smartAccountAddress, EOA, "must not reuse the EOA as the Safe");
    assert.match(challengeCall.body.smartAccountAddress, /^0x[0-9a-fA-F]{40}$/);
    assert.equal(challengeCall.body.purpose, "LOGIN");

    // The login used the same pair the challenge was issued for.
    const loginCall = upstreamCalls.find((c) => c.url.endsWith("LoginWithWallet"));
    assert.equal(loginCall.body.smartAccountAddress, challengeCall.body.smartAccountAddress);
    assert.equal(loginCall.body.signature, SIGNATURE);
    assert.equal(loginCall.body.message, MESSAGE);

    // Exactly one signature was requested, over exactly this message.
    assert.equal(wallet.calls.length, 1);
    assert.equal(signer.hexToMessage(wallet.calls[0].params[0]), MESSAGE);
  });

  it("never calls the wallet's signer before the challenge succeeds", async () => {
    reset();
    scenario = { reply: { status: 403, body: { code: "permission_denied", message: "uri is not permitted" } } };
    const wallet = fakeWallet();
    await assert.rejects(
      () => sessionModule.login({ provider: wallet, address: EOA, fetchImpl: proxyFetch() }),
      (error) => error.code === "origin_rejected" && /uri is not permitted/.test(error.detail),
    );
    assert.equal(wallet.calls.length, 0, "no signature may be requested after a refusal");
  });

  it("surfaces an exchange refusal with the exchange's own words", async () => {
    reset();
    scenario = { reply: { status: 403, body: { code: "permission_denied", message: "origin not allowed" } } };
    const wallet = fakeWallet();
    try {
      await sessionModule.login({ provider: wallet, address: EOA, fetchImpl: proxyFetch() });
      assert.fail("should have thrown");
    } catch (error) {
      assert.equal(error.code, "origin_rejected");
      assert.equal(error.detail, "origin not allowed");
    }
  });

  it("does not request a token when the wallet refuses", async () => {
    reset();
    const wallet = fakeWallet({ reject: true });
    await assert.rejects(
      () => sessionModule.login({ provider: wallet, address: EOA, fetchImpl: proxyFetch() }),
      (error) => error.code === "rejected",
    );
    assert.equal(
      upstreamCalls.some((c) => c.url.endsWith("LoginWithWallet")),
      false,
      "no token exchange after a refused signature",
    );
  });

  it("rejects a malformed address before any network call", async () => {
    reset();
    const wallet = fakeWallet();
    await assert.rejects(
      () => sessionModule.login({ provider: wallet, address: "0x123", fetchImpl: proxyFetch() }),
      (error) => error.code === "no_wallet",
    );
    assert.equal(upstreamCalls.length, 0);
  });

  it("reports an unreachable exchange without pretending", async () => {
    reset();
    const wallet = fakeWallet();
    const failing = async (input) => {
      const url = typeof input === "string" ? input : input.url;
      return backend.api(new Request(`https://polytools.example${url}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: '{"signerAddress":"' + EOA + '"}' }), {
        env: { POLYESTER_API_ORIGIN: "http://127.0.0.1:1" },
      });
    };
    await assert.rejects(
      () => sessionModule.login({ provider: wallet, address: EOA, fetchImpl: failing }),
      (error) => error.code === "upstream_unreachable",
    );
  });
});

describe("consent — connecting is not signing in", () => {
  it("the button never signs in from the connect path", () => {
    const text = source("apps/web/src/components/WalletButton.tsx");
    // signIn appears only in the connected branch, behind its own button.
    const connectBlock = text.slice(text.indexOf('className="btn sm wallet-connect"'));
    assert.equal(/signIn\(/.test(connectBlock.slice(0, 600)), false, "connect must not sign in");
    assert.match(text, /wallet-signin/);
    assert.match(text, /Sign in/);
  });

  it("does not auto-sign on mount anywhere in the session modules", () => {
    for (const file of ["apps/web/src/lib/usePolyesterSession.ts", "apps/web/src/lib/polyesterSession.ts"]) {
      const text = source(file);
      // `useEffect` running login on mount would be the silent-consent bug.
      assert.equal(/useEffect[\s\S]{0,200}login\(/.test(text), false, `${file} must not login on mount`);
    }
  });
});

describe("a refusal names the right layer — never the wrong one", () => {
  /** A fetch that returns exactly the proxy response we want to classify. */
  const responding = (status, payload) => async () =>
    new Response(typeof payload === "string" ? payload : JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  const attempt = (fetchImpl) =>
    sessionModule.login({ provider: fakeWallet(), address: EOA, fetchImpl });

  it("reports our own origin guard as this deployment, not as Polyester", async () => {
    // The bug: every 403 was reported as "Polyester refused this site's origin",
    // which sends the reader to the exchange when the block happened here.
    for (const code of ["origin_not_allowed", "cross_site_blocked"]) {
      try {
        await attempt(responding(403, { error: code }));
        assert.fail("should have thrown");
      } catch (error) {
        assert.equal(error.code, "origin_not_allowed", code);
      }
    }
  });

  it("still reports the exchange's own refusal as an origin rejection", async () => {
    try {
      await attempt(responding(403, { error: "permission_denied", detail: "uri is not permitted" }));
      assert.fail("should have thrown");
    } catch (error) {
      assert.equal(error.code, "origin_rejected");
      assert.equal(error.detail, "uri is not permitted");
    }
  });

  it("recognises a non-JSON 403 as an unreachable endpoint", async () => {
    // A static host answering POST to a path only the backend serves.
    try {
      await attempt(responding(403, "<html>Forbidden</html>"));
      assert.fail("should have thrown");
    } catch (error) {
      assert.equal(error.code, "endpoint_unreachable");
    }
  });
});

describe("an unreadable expiry is not an unbounded session", () => {
  it("treats a token as unusable when its stated expiry does not parse", async () => {
    const { PolyesterSessionStore } = await vite.ssrLoadModule("/apps/web/src/lib/polyesterSession.ts");
    const store = new PolyesterSessionStore();
    const base = {
      accessToken: "tok",
      accountId: null,
      username: null,
      smartAccountAddress: EOA,
      signerAddress: EOA,
    };

    store.set({ ...base, expiresAt: "2026-10-27T21:43:44.000Z" }, Date.parse("2026-10-27T21:00:00Z"));
    assert.equal(store.isUsable(Date.parse("2026-10-27T21:00:00Z")), true, "future expiry is usable");
    assert.equal(store.isUsable(Date.parse("2026-10-27T22:00:00Z")), false, "past expiry is not");

    // The regression this guards: a garbled expiry must not read as "never expires".
    store.set({ ...base, expiresAt: "garbage" });
    assert.equal(store.isUsable(), false);

    // No stated expiry still relies on the server to reject the token.
    store.set({ ...base, expiresAt: null });
    assert.equal(store.isUsable(), true);
  });
});

describe("an exchange-side block is not an unreachable endpoint", () => {
  const responding = (status, payload) => async () =>
    new Response(typeof payload === "string" ? payload : JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  const attempt = (fetchImpl) =>
    sessionModule.login({ provider: fakeWallet(), address: EOA, fetchImpl });

  it("classifies upstream_403 as the exchange refusing, not a missing route", async () => {
    // The reported bug in the UI: a refusal from the exchange was shown as
    // "the sign-in endpoint is not reachable", sending the reader to the wrong
    // layer entirely.
    try {
      await attempt(responding(403, { error: "upstream_403", detail: "blocked by a browser challenge · cf-ray=abc-LHR" }));
      assert.fail("should have thrown");
    } catch (error) {
      assert.equal(error.code, "origin_rejected");
      assert.match(error.detail, /cf-ray=abc-LHR/);
    }
  });

  it("keeps a genuine gateway failure as unreachable", async () => {
    try {
      await attempt(responding(502, { error: "upstream_unreachable" }));
      assert.fail("should have thrown");
    } catch (error) {
      assert.equal(error.code, "upstream_unreachable");
    }
  });

  it("names the edge, not the origin, when the detail says so", async () => {
    const { sessionErrorMessage } = await vite.ssrLoadModule("/apps/web/src/lib/usePolyesterSession.ts");
    const edge = sessionErrorMessage("origin_rejected", "blocked by a browser challenge · cf-ray=abc-LHR");
    assert.match(edge, /edge blocked/i);
    assert.match(edge, /cf-ray=abc-LHR/);

    const originCase = sessionErrorMessage("origin_rejected", "uri is not permitted");
    assert.match(originCase, /refused this site's origin/i);
    assert.equal(/edge blocked/i.test(originCase), false);
  });
});

describe("account refusals are not blamed on the origin", () => {
  const responding = (status, payload) => async () =>
    new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
  const attempt = (fetchImpl) =>
    sessionModule.login({ provider: fakeWallet(), address: EOA, fetchImpl });

  it("classifies an auth account code as the exchange refusing the account", async () => {
    // auth.v1.AuthErrorCode: terms not accepted is an account problem. Calling it
    // an origin refusal would point the reader at the deployment.
    try {
      await attempt(responding(403, { error: "auth_terms_not_accepted", detail: "accept terms to continue" }));
      assert.fail("should have thrown");
    } catch (error) {
      assert.equal(error.code, "exchange_refused");
      assert.match(error.detail, /accept terms/);
    }
  });

  it("keeps an origin refusal distinct from an account refusal", async () => {
    try {
      await attempt(responding(403, { error: "permission_denied", detail: "uri is not permitted" }));
      assert.fail("should have thrown");
    } catch (error) {
      assert.equal(error.code, "origin_rejected");
    }
  });

  it("has distinct copy for the two", async () => {
    const { sessionErrorMessage } = await vite.ssrLoadModule("/apps/web/src/lib/usePolyesterSession.ts");
    assert.match(sessionErrorMessage("exchange_refused", "accept terms"), /rejected the sign-in/i);
    assert.match(sessionErrorMessage("origin_rejected", "uri is not permitted"), /refused this site's origin/i);
  });
});

describe("the client honours the deployment's API base", () => {
  it("builds auth URLs from API_BASE rather than a bare relative path", () => {
    // On the documented static deploy the backend is a separate worker, so a
    // relative /api/auth/... call hits the static host and 403s there. This is
    // exactly the failure that shipped.
    const text = source("apps/web/src/lib/polyesterSession.ts");
    assert.match(text, /import \{ API_BASE \} from "\.\/api"/);
    assert.match(text, /\$\{API_BASE\}\/api\/auth\/challenge/);
    assert.match(text, /\$\{API_BASE\}\/api\/auth\/login/);
    // No bare relative auth URL may remain.
    assert.equal(/doFetch\("\/api\/auth/.test(text), false);
  });
});
