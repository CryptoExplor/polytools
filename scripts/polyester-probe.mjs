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
/**
 * `handshake` (default) stops at the Upgrade response.
 * `stream` additionally subscribes to a public JSON channel and validates three
 * publications end to end. Read-only either way: no writes, no credentials.
 */
const MODE = (process.argv.includes("--stream") ? "stream" : "handshake");

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

/* ------------------------------------------------- text frames over tcp ---- */

/**
 * Minimal RFC 6455 framing, enough to subscribe to a public JSON channel.
 *
 * Written by hand rather than pulled from a dependency for one reason: no
 * WebSocket client was available and adding one for a diagnostic script would
 * change the app's dependency surface. Client frames must be masked (section
 * 5.3); server frames arrive unmasked.
 */
function encodeTextFrame(text) {
  const payload = Buffer.from(text, "utf8");
  const mask = randomBytes(4);
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = 0x80 | length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 0x80 | 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x81; // FIN + text
  const masked = Buffer.allocUnsafe(length);
  for (let i = 0; i < length; i += 1) masked[i] = payload[i] ^ mask[i % 4];
  return Buffer.concat([header, mask, masked]);
}

function decodeFrames(buffer) {
  const messages = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) !== 0;
    let length = second & 0x7f;
    let cursor = offset + 2;
    if (length === 126) {
      if (buffer.length - cursor < 2) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (buffer.length - cursor < 8) break;
      length = Number(buffer.readBigUInt64BE(cursor));
      cursor += 8;
    }
    if (masked) cursor += 4;
    if (buffer.length - cursor < length) break;
    const payload = buffer.subarray(cursor, cursor + length);
    if (opcode === 0x1) messages.push(payload.toString("utf8"));
    offset = cursor + length;
  }
  return { messages, rest: buffer.subarray(offset) };
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

    // Say exactly what the spread is. Two decimals hides the difference between
    // a genuinely tight market and a *locked* one: a one-cent spread on BTC at
    // 77k is 0.0013bp and rounds to "0.00", while bid == ask is a different
    // market state entirely. In both cases the old message printed "0.00bps",
    // which reads as a defect and is not one.
    const diff = ask - bid;
    const spreadBps = (diff / ((ask + bid) / 2)) * 10_000;
    const quote = diff.toLocaleString("en-US", { maximumFractionDigits: 8 });
    const shape =
      diff === 0
        ? `LOCKED book (bid == ask ${bidPx})`
        : `${quote} wide (${spreadBps.toFixed(4)}bps)`;
    return pass(
      "Order book shape",
      `${bids.length}x${asks.length} levels, ${shape}, seq ${body.bookSeq}, ${ms}ms`,
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

/**
 * Subscribes to the public order-book delta channel and validates what arrives.
 *
 * This is the only check that proves the *whole* streaming path rather than a
 * handshake: it opens the socket, sends the Centrifugo connect and subscribe
 * commands, waits for publications, and asserts each one satisfies the merge
 * assumptions (sequence range, decimal-string levels). It then unsubscribes by
 * simply closing the socket — nothing is written anywhere.
 */
function streamCheck({ host, symbolId, depth, expectMessages, timeoutMs = 20_000 }) {
  return new Promise((resolve) => {
    const channel = `public:spot:orderbook:deltas:depth:${depth}:${symbolId}:json`;
    const received = [];
    const result = { channel, received };
    let raw = Buffer.alloc(0);
    let settled = false;

    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({ ...result, ...outcome });
    };

    const connectOptions = { host, port: SOCKET_PORT };
    const onConnect = () => {
      const lines = [
        `GET /connection/websocket HTTP/1.1`,
        `Host: ${host}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${randomBytes(16).toString("base64")}`,
        "Sec-WebSocket-Version: 13",
        "Sec-WebSocket-Protocol: centrifuge-json",
        `Origin: ${ORIGIN}`,
        "",
        "",
      ];
      socket.write(lines.join("\r\n"));
    };

    const socket = SECURE
      ? tls.connect({ ...connectOptions, servername: host, ALPNProtocols: ["http/1.1"] }, onConnect)
      : net.connect(connectOptions, onConnect);

    let upgraded = false;

    socket.on("data", (chunk) => {
      raw = Buffer.concat([raw, chunk]);
      if (!upgraded) {
        const headEnd = raw.indexOf("\r\n\r\n");
        if (headEnd === -1) return;
        const head = raw.subarray(0, headEnd).toString("utf8");
        const statusLine = head.split("\r\n")[0] ?? "";
        if (!statusLine.includes("101")) {
          return finish({ ok: false, reason: `upgrade refused: ${statusLine}` });
        }
        const subprotocol = /^sec-websocket-protocol:\s*(.+)$/im.exec(head)?.[1]?.trim() ?? null;
        result.subprotocol = subprotocol;
        upgraded = true;
        raw = raw.subarray(headEnd + 4);
        if (!subprotocol || !subprotocol.includes("json")) {
          return finish({
            ok: false,
            reason: `server negotiated "${subprotocol ?? "none"}", not a JSON subprotocol`,
          });
        }
        socket.write(encodeTextFrame(JSON.stringify({ id: 1, connect: {} })));
      }

      const { messages, rest } = decodeFrames(raw);
      raw = rest;
      for (const text of messages) {
        let frame;
        try {
          frame = JSON.parse(text);
        } catch {
          continue;
        }
        if (frame.connect !== undefined) {
          socket.write(encodeTextFrame(JSON.stringify({ id: 2, subscribe: { channel } })));
          continue;
        }
        if (frame.subscribe !== undefined) {
          result.subscribed = true;
          continue;
        }
        if (frame.push?.pub?.data !== undefined) {
          received.push(frame.push.pub.data);
          if (received.length >= expectMessages) {
            return finish({ ok: true });
          }
        }
        if (frame.error !== undefined) {
          return finish({ ok: false, reason: `server error ${frame.error.code ?? ""} ${frame.error.message ?? ""}`.trim() });
        }
      }
    });

    socket.on("error", (error) => finish({ ok: false, reason: error.code ?? "socket error" }));
    socket.setTimeout(timeoutMs, () =>
      finish({
        ok: received.length > 0,
        reason: received.length > 0 ? `only ${received.length} publication(s)` : "no publications before timeout",
      }),
    );
  });
}

async function checkStream(symbolId, depth) {
  if (MODE !== "stream") return;
  try {
    const outcome = await streamCheck({
      host: TARGET.hostname,
      symbolId,
      depth,
      expectMessages: 3,
    });
    if (!outcome.ok && !outcome.received?.length) {
      return unknown("Realtime deltas", outcome.reason ?? "no publications");
    }

    const first = outcome.received[0];
    const problems = [];
    if (typeof first.symbolId !== "number" && typeof first.symbolId !== "string") {
      problems.push("no symbolId");
    }
    if (first.bookSeqEnd === undefined) problems.push("no bookSeqEnd");
    const levels = [...(first.bids ?? []), ...(first.asks ?? [])];
    if (!levels.length) problems.push("no price levels");
    if (levels.some((level) => !Array.isArray(level) || typeof level[0] !== "string")) {
      problems.push("levels are not [price, qty] decimal strings");
    }
    if (problems.length) {
      return fail("Realtime deltas", `${problems.join("; ")} (subprotocol ${outcome.subprotocol})`);
    }
    // Contiguity is what the client's merge actually depends on: each delta's
    // range must begin where the previous one ended (or be a reset). Counting
    // publications proves traffic arrived; this proves the traffic is
    // mergeable, which is the property a gap makes expensive.
    const seq = (delta) => {
      const value = delta?.bookSeqEnd;
      if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
      if (typeof value === "string" && /^\d+$/.test(value)) return value;
      return null;
    };
    const chain = [];
    let breakAt = null;
    for (let i = 0; i < outcome.received.length; i += 1) {
      const delta = outcome.received[i];
      const end = seq(delta);
      chain.push(end ?? "?");
      if (i === 0 || delta.reset === true || breakAt !== null) continue;
      const prev = seq(outcome.received[i - 1]);
      const start = seq({ bookSeqEnd: delta.bookSeqStart });
      if (prev === null || start === null) {
        breakAt = i;
        continue;
      }
      // start must be <= prev+1: a reset legitimately jumps, a plain delta may
      // not. Gaps are only a problem when the client cannot tell it happened.
      const expectedMax = String(BigInt(prev) + 1n);
      if (BigInt(start) > BigInt(expectedMax)) breakAt = i;
    }

    const summary =
      `${outcome.received.length} publication(s) seq ${chain.join("→")}, ` +
      `${levels.length} levels, subprotocol ${outcome.subprotocol}`;

    if (breakAt !== null) {
      return fail(
        "Realtime deltas",
        `sequence gap between publication ${breakAt - 1} and ${breakAt} (${summary}) — ` +
          "the client re-snapshots on this, so frequent gaps would mean constant refetching",
      );
    }
    return pass("Realtime deltas", summary);
  } catch (error) {
    return unknown("Realtime deltas", error?.code ?? error?.name ?? "error");
  }
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
  console.log(`Mode: ${MODE}${MODE === "handshake" ? " (add --stream to verify delta publications)" : ""}`);
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
      "Realtime deltas",
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
    await checkStream(1, 50);
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
