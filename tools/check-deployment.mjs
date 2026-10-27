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
 *
 * Read-only. Two GETs. No credentials, no wallet, no signature, no state change.
 */

const target = process.argv[2];
if (!target) {
  console.error("usage: node tools/check-deployment.mjs https://your-deployment");
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

say("");
say("Note: a GET only proves the route exists. A POST proves the exchange accepts");
say("this origin, which is a separate question (C-1) and needs a real challenge.");

console.log(lines.join("\n") + "\n");
process.exit(exitCode);
