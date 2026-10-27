#!/usr/bin/env node
/**
 * Is this deployment actually running the code that has wallet sign-in?
 *
 * A 403 or 404 from `/api/auth/challenge` has several possible causes, and they
 * need different fixes. This asks the deployment two harmless questions and
 * names the cause from the answer, so "it doesn't work" becomes a specific
 * finding.
 *
 *   node tools/check-deployment.mjs https://your-site.pages.dev
 *   node tools/check-deployment.mjs https://your-site.pages.dev 0xYourWalletAddress
 *
 * With only a URL it asks two harmless GETs. Give it a wallet address and it also
 * requests a real challenge, which is the only way to learn whether the exchange
 * accepts this deployment's origin. No credentials, no wallet connection, no
 * signature, nothing written anywhere — a challenge is a server-side message the
 * exchange issues and forgets.
 *
 * Written for Windows PowerShell as much as for a terminal: PowerShell aliases
 * `curl` to Invoke-WebRequest, so the usual curl recipe fails there with a
 * "parameter cannot be found" error. Node has no such problem.
 */

const target = process.argv[2];
const signer = process.argv[3];
if (!target) {
  console.error("usage: node tools/check-deployment.mjs https://your-deployment [0xWalletAddress]");
  process.exit(2);
}
if (signer !== undefined && !/^0x[0-9a-fA-F]{40}$/.test(signer)) {
  console.error(`not an address: ${signer}`);
  process.exit(2);
}

let base;
try {
  base = new URL(target).origin;
} catch {
  console.error(`not a URL: ${target}`);
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function probe(path) {
  try {
    const res = await fetch(`${base}${path}`, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* an HTML body is itself a finding */
    }
    return { status: res.status, text: text.slice(0, 300), json, contentType: res.headers.get("content-type") };
  } catch (error) {
    return { transport: String(error?.cause?.code ?? error?.message ?? error) };
  }
}

const lines = [];
const say = (s = "") => lines.push(s);

say(`\nDeployment check · ${base}\n${"-".repeat(64)}`);

const health = await probe("/api/health");
await sleep(120);

if (health.transport) {
  say(`✗ Could not reach the deployment at all (${health.transport}).`);
  say(`  Check the URL, or run this from a network that can reach it.`);
  console.log(lines.join("\n") + "\n");
  process.exit(1);
}

const backendUp = health.status === 200 && health.json?.ok === true;
say(
  backendUp
    ? `✓ Backend is deployed on this origin (${health.json.service ?? "api"})`
    : `✗ No backend on this origin: /api/health returned ${health.status}`,
);

// The fingerprint. Both branches answer 405 here, with different wording:
//   main  -> {"error":"Method not allowed"}          (capital M, pre-auth code)
//   this  -> {"error":"method_not_allowed"}          (auth route present)
// A 404 "Unknown route" means the handler exists but has no auth route at all.
const challenge = await probe("/api/auth/challenge");
const code = typeof challenge.json?.error === "string" ? challenge.json.error : "";

say("");
let verdict;
let exitCode = 0;

if (challenge.transport) {
  say(`✗ /api/auth/challenge unreachable (${challenge.transport}).`);
  verdict = "inconclusive";
  exitCode = 1;
} else if (challenge.status === 405 && code === "method_not_allowed") {
  say(`✓ /api/auth/challenge is present (405 method_not_allowed on GET, as designed)`);
  say("");
  say("VERDICT: this deployment HAS wallet sign-in.");
  say("  If sign-in still fails, the remaining cause is the exchange, not the build.");
  say("  Read the failed request's response body:");
  say('    {"error":"origin_not_allowed"}   -> our allowlist (set POLYTOOLS_APP_ORIGINS)');
  say('    {"error":"permission_denied"}    -> Polyester refused this origin (C-1)');
  verdict = "has-signin";
} else if (challenge.status === 404 && /Unknown route/i.test(code)) {
  say(`✗ /api/auth/challenge does not exist here: ${challenge.status} "${code}"`);
  say("");
  say("VERDICT: this deployment predates wallet sign-in.");
  say("  The auth routes are on the branch, not on this build. Nothing in the");
  say("  browser can fix that — the code that answers the request is not deployed.");
  verdict = "stale-deployment";
  exitCode = 1;
} else if (challenge.status === 403) {
  say(`! /api/auth/challenge answered 403 with: ${challenge.text.slice(0, 120)}`);
  say("");
  say("VERDICT: something in front of the app refused the request.");
  say("  A JSON body means our proxy; an HTML or empty body means the host or a WAF,");
  say("  and the request never reached the application.");
  verdict = "blocked-upstream";
  exitCode = 1;
} else {
  say(`? /api/auth/challenge returned ${challenge.status}: ${challenge.text.slice(0, 120)}`);
  say("");
  say("VERDICT: unrecognised. If the body is HTML, /api is being served as static files.");
  verdict = "unknown";
  exitCode = 1;
}

// --- the real question: does the exchange issue a challenge for this origin? ---
if (signer) {
  say("");
  say("-".repeat(64));
  say(`Requesting a real challenge for ${signer}\n`);

  let res;
  try {
    res = await fetch(`${base}/api/auth/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signerAddress: signer }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    say(`✗ The request failed outright: ${error?.cause?.code ?? error?.message}`);
    console.log(lines.join("\n") + "\n");
    process.exit(1);
  }

  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    /* kept below: an HTML body is itself the finding */
  }

  say(`HTTP ${res.status}`);

  if (res.status === 200 && body?.message) {
    say("");
    say("✓ SUCCESS — the exchange issued a challenge.");
    say("  It accepts this deployment's origin. Sign-in works; click Sign in.");
    if (body.uri) say(`  Challenge bound to uri: ${body.uri}`);
    say(`  Smart account derived: ${body.smartAccountAddress ?? "(absent)"}`);
  } else if (body?.error === "upstream_403" || body?.error === "upstream_429") {
    // An answer with no Connect body never came from Polyester's API layer.
    say(`  code: ${body.error}`);
    if (body.detail) say(`  detail: ${body.detail}`);
    say("");
    if (/browser challenge|cf-mitigated|cf-ray|challenge-platform/i.test(body.detail ?? "")) {
      say("VERDICT: the edge in front of Polyester blocked our server, before the");
      say("  API saw the request. This is bot management on a server-to-server call,");
      say("  not an origin problem and not a wallet problem.");
      const ray = /cf-ray=(\S+)/.exec(body.detail ?? "");
      if (ray) say(`  Quote this to Polyester support: cf-ray ${ray[1].replace(/\.$/, "")}`);
      say("  Ask them to allowlist our egress or point us at an API host without it.");
    } else {
      say("VERDICT: the exchange refused without a Connect error body. That is a");
      say("  proxy or WAF in front of it, not the API itself.");
      const ray = /cf-ray=(\S+)/.exec(body.detail ?? "");
      if (ray) say(`  Quote this to Polyester support: cf-ray ${ray[1].replace(/\.$/, "")}`);
    }
  } else if (body?.error === "permission_denied" || body?.error === "unauthenticated") {
    say(`  code: ${body.error}`);
    if (body.detail) say(`  detail: ${body.detail}`);
    say("");
    say("VERDICT: Polyester's own API refused the challenge. This is the origin");
    say("  gate (C-1) answering, in the exchange's own words.");
  } else if (body?.error === "origin_not_allowed") {
    say("");
    say("VERDICT: our allowlist refused before the exchange was contacted.");
    say("  This build believes the caller is cross-origin. Set");
    say("  POLYTOOLS_APP_ORIGINS to this deployment's exact origin.");
  } else if (res.status === 404 && /Unknown route/i.test(body?.error ?? "")) {
    say("");
    say("VERDICT: this deployment predates wallet sign-in (no auth route).");
    say("  Deploy a build that contains the sign-in work.");
  } else if (res.status === 405) {
    say("");
    say(`VERDICT: the route exists but rejected POST (${body?.error ?? text.slice(0, 80)}).`);
  } else {
    say(`  ${body ? JSON.stringify(body).slice(0, 400) : text.slice(0, 400)}`);
    say("");
    say("VERDICT: unrecognised. The body above is the whole answer we have.");
  }
} else {
  say("");
  say("Note: a GET only proves the route exists. Add a wallet address to also ask");
  say("the exchange for a real challenge, which answers the C-1 question:");
  say("  node tools/check-deployment.mjs <url> 0xYourWalletAddress");
}

console.log(lines.join("\n") + "\n");
process.exit(exitCode);
