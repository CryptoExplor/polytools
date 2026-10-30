#!/usr/bin/env node
/**
 * Stage 0 — credential-free checks against Polyester's public surfaces.
 *
 *   node scripts/polyester-probe.mjs
 *
 * Why this exists: three questions have blocked the account work and none of
 * them can be answered from a sandbox without egress.
 *
 *   1. Does a browser talk to the exchange directly, or must it be proxied?
 *      -> answerable only by reading the actual CORS headers.
 *   2. Can the public realtime socket be opened from a browser origin?
 *      -> an `https:` CSP source does not authorise `wss:`, and the socket may
 *         reject unknown Origins independently of CSP.
 *   3. Do the public payloads match the published contracts?
 *      -> catches contract drift that unit tests, fed by fixtures, cannot.
 *
 * Design rules, all deliberate:
 *   - No credentials. Nothing is read from `.env`, no key, no wallet, no token.
 *   - No state change. GETs, OPTIONS preflights, and a WebSocket *handshake*.
 *     No `POST /v1/auth/wallet-challenge`, no signature, no subscribe frame, no
 *     order, no cancel, no transfer.
 *   - Dependency-free. `node:net`/`node:tls` instead of a WebSocket client, so
 *     the Origin header is under our control — a library that sets its own
 *     Origin would make check 2 meaningless.
 *
 * Exit code is 0 when every check passes, 1 otherwise, so a local agent can
 * gate on it.
 */

import { randomUUID, randomBytes } from "node:crypto";
import net from "node:net";
import tls from "node:tls";

const HOST = process.env.POLYESTER_HOST ?? "api.testnet.polyester.com";
// Overridable so the checks can be exercised against a fixture server, and so a
// custom or VPC endpoint can be probed without editing this file.
const BASE = (process.env.POLYESTER_BASE ?? `https://${HOST}`).replace(/\/+$/, "");
// Derived from the base so a plain-http VPC endpoint can be probed too; the
// handshake must speak the same scheme as the REST calls or the two disagree.
const TARGET = new URL(BASE);
const SECURE = TARGET.protocol === "https:";
const SOCKET_PORT = Number(TARGET.port) || (SECURE ? 443 : 80);
/** A realistic deploy origin: the kind of host a static Pages build uses. */
const ORIGIN = process.env.POLYESTER_ORIGIN ?? "https://polytools-cc8.pages.dev";
const TIMEOUT_MS = 15_000;

const results = [];

function record(name, state, detail) {
  results.push({ name, state, detail });
  const mark = state === "PASS" ? "PASS" : state === "FAIL" ? "FAIL" : "????";
  console.log(`[${mark}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function pass(name, detail) {
  record(name, "PASS", detail);
}
function fail(name, detail) {
  record(name, "FAIL", detail);
}
function unknown(name, detail) {
  record(name, "UNKNOWN", detail);
}

async function get(path, headers = {}) {
  const started = Date.now();
  const response = await fetch(`${BASE}${path}`, {
    headers: { Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  return { response, body, text, ms: Date.now() - started };
}

/**
 * Reads only the response headers of a CORS preflight.
 *
 * The interesting output is `access-control-allow-origin`: `*` means any
 * browser origin may call it, an exact echo means an allowlist matched, and its
 * absence means the browser will block the response regardless of what the
 * server body says.
 */
async function preflight(path, requestHeaders) {
  const started = Date.now();
  const response = await fetch(`${BASE}${path}`, {
    method: "OPTIONS",
    headers: {
      Origin: ORIGIN,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": requestHeaders,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return {
    status: response.status,
    allowOrigin: response.headers.get("access-control-allow-origin"),
    allowMethods: response.headers.get("access-control-allow-methods"),
    allowHeaders: response.headers.get("access-control-allow-headers"),
    allowCredentials: response.headers.get("access-control-allow-credentials"),
    ms: Date.now() - started,
  };
}

/**
 * Performs a WebSocket Upgrade handshake and stops there.
 *
 * Deliberately never sends a frame: this answers "would a browser be allowed to
 * open this socket?" without establishing a subscription or receiving data.
 */
function websocketHandshake({ host, path, origin, protocol }) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(outcome);
    };

    const key = randomBytes(16).toString("base64");
    const connectOptions = { host, port: SOCKET_PORT };
    const onConnect = () => {
        const lines = [
          `GET ${path} HTTP/1.1`,
          `Host: ${host}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          ...(protocol ? [`Sec-WebSocket-Protocol: ${protocol}`] : []),
          ...(origin ? [`Origin: ${origin}`] : []),
          "",
          "",
        ];
        socket.write(lines.join("\r\n"));
    };

    const socket = SECURE
      ? tls.connect({ ...connectOptions, servername: host, ALPNProtocols: ["http/1.1"] }, onConnect)
      : net.connect(connectOptions, onConnect);

    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      // Headers end at the first blank line; the frame stream after it is
      // ignored, and the socket is closed immediately.
      if (!buffer.includes("\r\n\r\n")) return;
      const head = buffer.slice(0, buffer.indexOf("\r\n\r\n"));
      const statusLine = head.split("\r\n")[0] ?? "";
      const code = Number(statusLine.split(" ")[1] ?? 0);
      const allowOrigin =
        /^access-control-allow-origin:\s*(.+)$/im.exec(head)?.[1]?.trim() ?? null;
      const subprotocol =
        /^sec-websocket-protocol:\s*(.+)$/im.exec(head)?.[1]?.trim() ?? null;
      finish({ code, statusLine, allowOrigin, subprotocol, head });
    });
    socket.on("error", (error) => finish({ error: error.code ?? "socket_error" }));
    socket.on("close", () => finish({ error: "closed_before_response" }));
    socket.setTimeout(TIMEOUT_MS, () => finish({ error: "timeout" }));
  });
}

/* ---------------------------------------------------------------- checks ---- */

async function checkReachability() {
  try {
    const { response, body, ms } = await get("/v1/spot/config");
    if (response.status !== 200) return fail("REST reachable", `HTTP ${response.status}`);
    const pairs = body?.pairs ?? body?.markets ?? body?.spot ?? null;
    const count = Array.isArray(pairs) ? pairs.length : null;
    return pass(
      "REST reachable",
      `HTTP 200 in ${ms}ms${count === null ? " (pair list at an unexpected key)" : `, ${count} pairs`}`,
    );
  } catch (error) {
    return fail("REST reachable", error?.cause?.code ?? error?.name ?? "network error");
  }
}

async function checkOrderbook() {
  try {
    const { response, body, ms } = await get("/v1/orderbook/BTC-USDT");
    if (response.status !== 200) return fail("Order book shape", `HTTP ${response.status}`);
    const bids = body?.bids;
    const asks = body?.asks;
    if (!Array.isArray(bids) || !Array.isArray(asks)) {
      return fail("Order book shape", "bids/asks are not arrays");
    }
    if (!bids.length || !asks.length) return fail("Order book shape", "one side is empty");
    const [bidPx] = bids[0];
    const [askPx] = asks[0];
    if (typeof bidPx !== "string" || typeof askPx !== "string") {
      return fail("Order book shape", "prices are not decimal strings");
    }
    const bid = Number(bidPx);
    const ask = Number(askPx);
    if (!(bid > 0) || !(ask > 0)) return fail("Order book shape", "non-positive price");
    if (bid > ask) return fail("Order book shape", `crossed book: bid ${bid} > ask ${ask}`);
    const spreadBps = ((ask - bid) / ((ask + bid) / 2)) * 10_000;
    return pass(
      "Order book shape",
      `${bids.length}x${asks.length} levels, spread ${spreadBps.toFixed(2)}bps, seq ${body.bookSeq}, ${ms}ms`,
    );
  } catch (error) {
    return fail("Order book shape", error?.cause?.code ?? error?.name ?? "network error");
  }
}

async function checkVipTiers() {
  try {
    const { response, body } = await get("/v1/vip/tiers");
    if (response.status !== 200) return fail("VIP catalog", `HTTP ${response.status}`);
    const tiers = body?.tiers;
    if (!Array.isArray(tiers)) return fail("VIP catalog", "tiers is not an array");
    if (tiers.length < 11) return fail("VIP catalog", `${tiers.length} rows, expected 11`);
    const contiguous = tiers.every((row, index) => (row.tier ?? index) === index);
    if (!contiguous) return fail("VIP catalog", "tiers are not contiguous from 0");
    // proto3 JSON omits defaults, so VIP0 carries no `tier` key. If the exchange
    // ever starts emitting it, that is informative rather than an error.
    const vip0OmitsTier = !("tier" in tiers[0]);
    const vip0OmitsAop = !("aopThresholdUsd" in tiers[0]);
    return pass(
      "VIP catalog",
      `${tiers.length} tiers, VIP0 tier key ${vip0OmitsTier ? "omitted" : "present"}, ` +
        `aop ${vip0OmitsAop ? "omitted" : "present"}, maker ${tiers[0].makerFeeRatePercent}`,
    );
  } catch (error) {
    return fail("VIP catalog", error?.cause?.code ?? error?.name ?? "network error");
  }
}

async function checkRateLimits() {
  try {
    const { response, body } = await get("/v1/rate-limits");
    if (response.status !== 200) return fail("Rate-limit catalog", `HTTP ${response.status}`);
    return pass("Rate-limit catalog", `${Object.keys(body ?? {}).length} top-level keys`);
  } catch (error) {
    return fail("Rate-limit catalog", error?.cause?.code ?? error?.name ?? "network error");
  }
}

async function checkPublicCors() {
  try {
    const pre = await preflight("/v1/orderbook/BTC-USDT", "content-type");
    const direct = await get("/v1/orderbook/BTC-USDT", { Origin: ORIGIN });
    const acao = direct.response.headers.get("access-control-allow-origin");
    if (pre.allowOrigin || acao) {
      return pass(
        "Public CORS",
        `preflight ${pre.status}, allow-origin ${pre.allowOrigin ?? acao}` +
          `${pre.allowHeaders ? `, allow-headers ${pre.allowHeaders}` : ""}`,
      );
    }
    return fail(
      "Public CORS",
      `preflight ${pre.status} with no access-control-allow-origin; a browser cannot read this directly`,
    );
  } catch (error) {
    // A transport error says nothing about the exchange's CORS policy.
    return unknown("Public CORS", `${error?.cause?.code ?? error?.name ?? "network error"} — inconclusive`);
  }
}

async function checkAuthenticatedCors() {
  // The question this answers: could the browser hold an API key and call
  // private reads itself? The signing headers are more interesting than the
  // method, because a preflight that rejects them removes the option entirely.
  try {
    const pre = await preflight(
      "/v1/balances",
      "x-api-key-id,x-api-timestamp,x-api-signature,content-type",
    );
    if (!pre.allowOrigin) {
      return pass(
        "Private CORS",
        `preflight ${pre.status}, no allow-origin — a browser must not hold the key; keep reads server-side`,
      );
    }
    return pass(
      "Private CORS",
      `preflight ${pre.status}, allow-origin ${pre.allowOrigin}, allow-headers ${pre.allowHeaders ?? "none"}`,
    );
  } catch (error) {
    return unknown("Private CORS", error?.cause?.code ?? error?.name ?? "network error");
  }
}

async function checkWebsocketOrigin() {
  const path = "/connection/websocket";
  const withOrigin = await websocketHandshake({
    host: TARGET.hostname,
    path,
    origin: ORIGIN,
    protocol: "centrifuge-protobuf",
  });
  const withoutOrigin = await websocketHandshake({
    host: TARGET.hostname,
    path,
    origin: null,
    protocol: "centrifuge-protobuf",
  });

  if (withOrigin.error && withoutOrigin.error) {
    return unknown(
      "Realtime origin gate",
      `handshake failed both ways (${withOrigin.error}); check egress to ${SECURE ? "wss" : "ws"}://${TARGET.hostname}`,
    );
  }
  if (withoutOrigin.error) {
    return unknown("Realtime origin gate", `baseline handshake failed (${withoutOrigin.error})`);
  }
  if (withOrigin.error && !withoutOrigin.error) {
    return fail(
      "Realtime origin gate",
      `control ${withoutOrigin.code}, but with Origin: ${ORIGIN} the socket failed (${withOrigin.error})`,
    );
  }
  if (withOrigin.code === 101) {
    return pass(
      "Realtime origin gate",
      `101 with Origin: ${ORIGIN}` +
        `${withOrigin.subprotocol ? `, subprotocol ${withOrigin.subprotocol}` : ""}` +
        `${withOrigin.allowOrigin ? `, allow-origin ${withOrigin.allowOrigin}` : ""}` +
        `; baseline ${withoutOrigin.code}`,
    );
  }
  // Same answer with and without an Origin header: the path is not upgrading a
  // socket at all (wrong path, or a proxy in the way). That is not evidence that
  // the Origin was rejected, so it is not reported as a failure.
  if (withOrigin.code === withoutOrigin.code) {
    return unknown(
      "Realtime origin gate",
      `no upgrade with or without Origin (both ${withoutOrigin.code || withoutOrigin.error}) — path or proxy issue`,
    );
  }
  return fail(
    "Realtime origin gate",
    `Origin ${ORIGIN} rejected: ${withOrigin.statusLine || withOrigin.code} (baseline ${withoutOrigin.code})`,
  );
}

async function checkTls() {
  const started = Date.now();
  const outcome = await websocketHandshake({
    host: TARGET.hostname,
    path: "/connection/websocket",
    origin: null,
    protocol: "centrifuge-protobuf",
  }).catch(() => ({ error: "handshake error" }));
  if (outcome.error && !outcome.code) {
    fail("TLS + DNS", outcome.error);
    return false;
  }
  pass(
    "TLS + DNS",
    `${Date.now() - started}ms to first response byte over ${SECURE ? "tls" : "tcp"}:${SOCKET_PORT}`,
  );
  return true;
}

/* ------------------------------------------------------------------ main ---- */

async function main() {
  console.log(`Stage 0 probe — ${BASE}, origin ${ORIGIN}`);
  console.log(`Run ${new Date().toISOString()} with ${process.platform} node ${process.version}`);
  console.log("Read-only: GET, OPTIONS, and a WebSocket handshake. No credentials, no writes.\n");

  // Order matters. If the host is not reachable from this machine, every later
  // result is a statement about the network, not about the exchange, so report
  // them as UNKNOWN rather than dressing them up as findings.
  const reachable = await checkTls();
  if (!reachable) {
    for (const name of [
      "REST reachable",
      "Order book shape",
      "VIP catalog",
      "Rate-limit catalog",
      "Public CORS",
      "Private CORS",
      "Realtime origin gate",
    ]) {
      unknown(name, `skipped — ${TARGET.hostname} not reachable from here`);
    }
  } else {
    await checkReachability();
    await checkOrderbook();
    await checkVipTiers();
    await checkRateLimits();
    await checkPublicCors();
    await checkAuthenticatedCors();
    await checkWebsocketOrigin();
  }

  const failed = results.filter((result) => result.state === "FAIL").length;
  const unknownCount = results.filter((result) => result.state === "UNKNOWN").length;

  console.log("\n=================================================");
  console.log("STAGE 0 SUMMARY");
  console.log("=================================================");
  console.log("| Check               | Result  | Detail |");
  console.log("|---------------------|---------|--------|");
  for (const result of results) {
    console.log(`| ${result.name.padEnd(19)} | ${result.state.padEnd(7)} | ${result.detail ?? ""} |`);
  }
  console.log("=================================================");
  console.log(`${results.length - failed - unknownCount} pass, ${failed} fail, ${unknownCount} unknown`);

  if (failed > 0) {
    console.log("\nA FAIL above is a real blocker or a contract change. Capture the whole");
    console.log("output block and stop; do not work around CORS with a proxy or no-cors.");
  }
  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((error) => {
  // Print a category, never a stack that might contain a URL with a query token.
  console.error(`Probe aborted: ${error?.name ?? "error"}`);
  process.exitCode = 1;
});
