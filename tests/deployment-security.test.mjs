import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, createServer } from "vite";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const webDir = `${rootDir}/apps/web`;
const webConfig = `${webDir}/vite.config.ts`;
const source = (path) => readFileSync(`${rootDir}/${path}`, "utf8");
const MCP_ENV = { MCP_URL: "https://synthetic.invalid/mcp" };

let vite;
let security;
let backend;
let worker;
let pagesAdapter;
let vercelAdapter;

before(async () => {
  vite = await createServer({
    root: rootDir,
    configFile: webConfig,
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  security = await vite.ssrLoadModule("/packages/core/src/deploymentSecurity.ts");
  backend = await vite.ssrLoadModule("/backend/src/handler.ts");
  worker = (await vite.ssrLoadModule("/backend/adapters/worker.ts")).default;
  pagesAdapter = await vite.ssrLoadModule("/backend/adapters/cloudflare-pages.ts");
  vercelAdapter = await vite.ssrLoadModule("/backend/adapters/vercel.ts");
});

after(async () => {
  if (vite) await vite.close();
});

function assertSecurityHeaders(response) {
  for (const [name, value] of Object.entries(security.SECURITY_HEADERS)) {
    assert.equal(response.headers.get(name), value, `${name} on ${response.status}`);
  }
  assert.equal(response.headers.get("Strict-Transport-Security"), null);
}

function parsePagesHeaders(text) {
  const result = {};
  for (const line of text.split("\n")) {
    if (!/^ {2}\S/.test(line)) continue;
    const entry = line.trim();
    const colon = entry.indexOf(":");
    result[entry.slice(0, colon)] = entry.slice(colon + 1).trim();
  }
  return result;
}

describe("P2-9 centralized production security policy", () => {
  it("allows only the inventoried SPA resources and preserves clipboard/WebCrypto needs", () => {
    const csp = security.PRODUCTION_CONTENT_SECURITY_POLICY;
    for (const directive of [
      "default-src 'self'",
      "base-uri 'none'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "frame-src 'none'",
      "form-action 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: https://assets.polyester.com",
      "media-src 'self' https://assets.polyester.com",
      "connect-src 'self' https://api.coingecko.com https://api.testnet.polyester.com wss://api.testnet.polyester.com https://*.workers.dev",
      "manifest-src 'self'",
    ]) {
      assert.ok(csp.includes(directive), directive);
    }
    // A `wss:` source only appeared when the public order-book stream was
    // adopted, and it is only safe because it names one host. Replace the old
    // blanket "no wss at all" ban with the rule that actually matters: the set
    // of websocket origins is exactly the exchange endpoint, never a wildcard
    // and never a second host.
    const wsSources = csp
      .split(";")
      .map((directive) => directive.trim())
      .filter((directive) => directive.startsWith("connect-src"))
      .flatMap((directive) => directive.split(/\s+/).filter((token) => token.startsWith("wss:")));
    assert.deepEqual(wsSources, ["wss://api.testnet.polyester.com"]);
    assert.ok(!csp.includes("wss://*"), "no wildcard websocket origin");
    assert.ok(!csp.includes("ws:"), "no cleartext websocket origin");
    assert.ok(!csp.includes("unsafe-eval"));
    assert.ok(!csp.includes("script-src 'self' 'unsafe-inline'"));
    assert.equal(security.SECURITY_HEADERS["X-Content-Type-Options"], "nosniff");
    assert.equal(security.SECURITY_HEADERS["X-Frame-Options"], "DENY");
    assert.equal(security.REFERRER_POLICY, "strict-origin-when-cross-origin");
    assert.ok(security.PERMISSIONS_POLICY.includes("clipboard-write=(self)"));
    assert.ok(security.PERMISSIONS_POLICY.includes("clipboard-read=()"));
    assert.ok(security.PERMISSIONS_POLICY.includes("camera=()"));
    assert.ok(security.PERMISSIONS_POLICY.includes("microphone=()"));
    assert.ok(!("Strict-Transport-Security" in security.SECURITY_HEADERS));
    assert.ok(!("Cross-Origin-Opener-Policy" in security.SECURITY_HEADERS));
    assert.ok(!("Cross-Origin-Resource-Policy" in security.SECURITY_HEADERS));

    // WebCrypto does not require a Permissions-Policy exemption or network CSP source.
    assert.ok(!security.PERMISSIONS_POLICY.includes("publickey-credentials"));
    // The websocket-origin rule is asserted once, above, as an exact set rather
    // than a blanket ban. A blanket ban here would have to be deleted the moment
    // a socket was wanted, which is how a guard quietly stops guarding.
  });

  it("keeps Vercel and Cloudflare Pages static headers exactly aligned", () => {
    const vercel = JSON.parse(source("vercel.json"));
    assert.equal(vercel.headers.length, 1);
    assert.equal(vercel.headers[0].source, "/(.*)");
    const vercelHeaders = Object.fromEntries(
      vercel.headers[0].headers.map((entry) => [entry.key, entry.value]),
    );
    assert.deepEqual(vercelHeaders, security.SECURITY_HEADERS);

    const pagesHeaders = parsePagesHeaders(source("apps/web/public/_headers"));
    assert.deepEqual(pagesHeaders, security.SECURITY_HEADERS);
    assert.ok(source("apps/web/public/_headers").startsWith("# Cloudflare Pages"));
  });

  it("clones responses without losing status, body, cache, or custom headers", async () => {
    const original = new Response("synthetic asset", {
      status: 206,
      statusText: "Partial Content",
      headers: {
        "Content-Type": "text/plain",
        "Cache-Control": "public, max-age=60",
        "Content-Range": "bytes 0-14/15",
        "X-PolyTools-Data-Source": "wire-samples",
      },
    });
    const hardened = security.withSecurityHeaders(original);
    assert.equal(hardened.status, 206);
    assert.equal(hardened.statusText, "Partial Content");
    assert.equal(await hardened.text(), "synthetic asset");
    assert.equal(hardened.headers.get("Cache-Control"), "public, max-age=60");
    assert.equal(hardened.headers.get("Content-Range"), "bytes 0-14/15");
    assert.equal(hardened.headers.get("X-PolyTools-Data-Source"), "wire-samples");
    assertSecurityHeaders(hardened);
  });
});

describe("P2-9 synthetic API and deployment adapter responses", () => {
  it("adds headers to success, validation, method, route, and preflight responses without changing CORS", async () => {
    const responses = [
      await backend.api(new Request("https://synthetic.test/api/health")),
      await backend.api(new Request("https://synthetic.test/api/orderbook?symbol=BTC-USDT&depth=7"), { env: MCP_ENV }),
      await backend.api(new Request("https://synthetic.test/api/markets", { method: "POST" })),
      await backend.api(new Request("https://synthetic.test/api/not-a-route"), { env: MCP_ENV }),
      await backend.api(new Request("https://synthetic.test/api/overview", { method: "OPTIONS" })),
    ];
    assert.deepEqual(responses.map((response) => response.status), [200, 400, 405, 404, 204]);
    for (const response of responses) {
      assertSecurityHeaders(response);
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
      assert.equal(response.headers.get("Access-Control-Allow-Methods"), "GET, OPTIONS");
      assert.equal(response.headers.get("Access-Control-Allow-Headers"), "Content-Type");
      assert.equal(response.headers.get("Access-Control-Max-Age"), "86400");
    }
    assert.equal(await responses[4].text(), "");
  });

  it("hardens a synthetic upstream failure and both serverless adapters", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error("synthetic upstream outage");
    };
    try {
      const upstream = await backend.api(new Request("https://synthetic.test/api/markets"), { env: MCP_ENV });
      assert.equal(upstream.status, 502);
      assertSecurityHeaders(upstream);
      assert.equal(upstream.headers.get("Access-Control-Allow-Origin"), "*");
    } finally {
      globalThis.fetch = originalFetch;
    }

    const pages = await pagesAdapter.onRequest({
      request: new Request("https://synthetic.test/api/health"),
      env: {},
    });
    const vercel = await vercelAdapter.default(new Request("https://synthetic.test/api/health"));
    for (const response of [pages, vercel]) {
      assert.equal(response.status, 200);
      assertSecurityHeaders(response);
      assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
    }
  });

  it("hardens root Worker assets and keeps /api on the shared handler", async () => {
    let assetRequests = 0;
    const env = {
      ASSETS: {
        fetch: async () => {
          assetRequests += 1;
          return new Response("<!doctype html><title>synthetic</title>", {
            status: 200,
            headers: { "Content-Type": "text/html", "Cache-Control": "no-cache" },
          });
        },
      },
    };
    const asset = await worker.fetch(new Request("https://synthetic.test/"), env);
    assert.equal(asset.status, 200);
    assertSecurityHeaders(asset);
    assert.equal(asset.headers.get("Cache-Control"), "no-cache");
    assert.equal(asset.headers.get("Access-Control-Allow-Origin"), null);
    assert.equal(assetRequests, 1);

    const api = await worker.fetch(new Request("https://synthetic.test/api/health"), env);
    assert.equal(api.status, 200);
    assertSecurityHeaders(api);
    assert.equal(api.headers.get("Access-Control-Allow-Origin"), "*");
    assert.equal(assetRequests, 1, "API request must not be served from static assets");
  });
});

describe("P2-9 production build and development transform", () => {
  it("leaves development HTML without a CSP that would block Vite HMR/React refresh", async () => {
    const transformed = await vite.transformIndexHtml("/", source("apps/web/index.html"));
    assert.ok(transformed.includes("/@vite/client"));
    assert.ok(!transformed.includes("Content-Security-Policy"));
    assert.ok(!transformed.includes('name="referrer"'));
    assert.ok(!source("apps/web/index.html").includes("Content-Security-Policy"));
  });

  it("emits the limited meta fallback and static headers in a real production build", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "polytools-p2-9-build-"));
    try {
      await build({
        root: webDir,
        configFile: webConfig,
        logLevel: "silent",
        build: { outDir, emptyOutDir: true },
      });
      const html = readFileSync(`${outDir}/index.html`, "utf8");
      const cspMeta = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)" \/>/);
      assert.ok(cspMeta, "built HTML must contain the CSP meta fallback");
      assert.equal(cspMeta[1], security.META_CONTENT_SECURITY_POLICY);
      assert.ok(!cspMeta[1].includes("frame-ancestors"));
      assert.ok(cspMeta[1].includes("script-src 'self'"));
      assert.ok(cspMeta[1].includes("style-src 'self' 'unsafe-inline'"));
      assert.ok(html.includes(`<meta name="referrer" content="${security.REFERRER_POLICY}" />`));
      assert.ok(!html.includes('http-equiv="Permissions-Policy"'));
      assert.ok(!html.includes('http-equiv="X-Content-Type-Options"'));
      assert.ok(!html.includes('http-equiv="X-Frame-Options"'));

      const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map((match) => match[0]);
      assert.ok(scripts.length > 0);
      for (const script of scripts) assert.ok(script.includes("src="), script);
      assert.ok(html.indexOf(cspMeta[0]) < html.indexOf(scripts[0]));

      const emittedHeaders = readFileSync(`${outDir}/_headers`, "utf8");
      assert.deepEqual(parsePagesHeaders(emittedHeaders), security.SECURITY_HEADERS);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
