#!/usr/bin/env node
/**
 * Stage 2b origin gate (C-1 / NBA-6) — the one check that decides whether
 * wallet login can be built into the web app at all.
 *
 * WHAT IS ALREADY KNOWN
 *   The browser cannot reach the API cross-origin. A preflight from our Pages
 *   origin returned no `Access-Control-Allow-Origin` and the POST never left
 *   the page (`net::ERR_FAILED`). So a direct browser call to
 *   `auth.v1.AuthService/CreateWalletChallenge` fails today, regardless of us.
 *
 * WHAT THIS ASKS INSTEAD
 *   The challenge binds `uri` — the requesting origin — into the signed
 *   EIP-4361 message. If the API refuses a challenge for an origin it does not
 *   recognise, then a same-origin proxy would not rescue login either: we would
 *   proxy a request the server is determined to reject. That question is a
 *   plain HTTP request, not a browser one, so it can be answered from a terminal.
 *
 *   A  challenge with uri = the exchange's own origin   (control)
 *   B  challenge with uri = our Pages deployment origin  (the question)
 *
 *   A ok + B refused  -> the API pins origins. Login needs an origin the
 *                        exchange recognises, not a proxy. Stop and escalate.
 *   A ok + B ok       -> the API does not care about our origin; the only
 *                        blocker is CORS, which a same-origin proxy solves.
 *   A refused         -> the control failed; the probe proves nothing about B.
 *                        Report the error verbatim and do not guess.
 *
 * SAFETY
 *   Unauthenticated, read-only, testnet only. No API key, no wallet, no
 *   signature, no order, no account mutation. The addresses are fabricated and
 *   are expected to be unknown to the exchange — an "unknown account" error is
 *   still a valid answer about `uri`, and the raw response is printed so the
 *   two cases can be told apart. Nothing is written to disk or to a log.
 *
 *   Run it yourself, in your own terminal. The sandbox this repository is
 *   developed in has no TLS egress to the API.
 *
 * USAGE
 *   node tools/auth-gate-probe.mjs
 *   node tools/auth-gate-probe.mjs --our-origin https://your.pages.dev
 */

const API = "https://api.testnet.polyester.com";
const CHALLENGE = `${API}/auth.v1.AuthService/CreateWalletChallenge`;

// Control: the origin the exchange serves its own UI from.
const EXCHANGE_ORIGIN = "https://testnet.polyester.com";
// The question: the origin our static app is actually served from.
const DEFAULT_OUR_ORIGIN = "https://5b3de73c.polytools-cc8.pages.dev";

// Well-formed, checksum-free, and certainly not ours. The answer we care about
// is about `uri`, so an unknown-address rejection still counts as a response.
const ADDRESS = "0x1111111111111111111111111111111111111111";

// WalletChallengePurpose: WALLET_PROOF_UNSPECIFIED = 0, LOGIN = 1.
const PURPOSE_LOGIN = 1;

function originArg() {
  const i = process.argv.indexOf("--our-origin");
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return DEFAULT_OUR_ORIGIN;
}

async function ask(uri) {
  const body = {
    smartAccountAddress: ADDRESS,
    signerAddress: ADDRESS,
    uri,
    purpose: PURPOSE_LOGIN,
  };

  let res;
  try {
    res = await fetch(CHALLENGE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Connect-Protocol-Version": "1",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    return { uri, transport: "failed", detail: String(err?.cause?.code ?? err?.message ?? err) };
  }

  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON error body is itself the finding */
  }

  return {
    uri,
    status: res.status,
    // Connect reports failures as {code, message}; success carries `message`.
    connectCode: parsed?.code ?? null,
    message: typeof parsed?.message === "string" ? parsed.message : null,
    raw: text.slice(0, 600),
  };
}

function summarise(r) {
  if (r.transport) return `TRANSPORT FAILED (${r.detail})`;
  if (r.status === 200) {
    const first = (r.message ?? "").split("\n")[0];
    return `200 — challenge issued · ${first.slice(0, 90)}`;
  }
  const code = r.connectCode ? `${r.connectCode} ` : "";
  return `${r.status} — ${code}${(r.message ?? "").split("\n")[0].slice(0, 110)}`;
}

const ours = originArg();

console.log(`\nStage 2b origin gate (C-1)\n${"-".repeat(72)}`);
console.log(`endpoint  ${CHALLENGE}`);
console.log(`address   ${ADDRESS}  (fabricated; not expected to be known)\n`);

const a = await ask(EXCHANGE_ORIGIN);
console.log(`A  control   uri = ${a.uri}`);
console.log(`   ${summarise(a)}`);

const b = await ask(ours);
console.log(`\nB  question  uri = ${b.uri}`);
console.log(`   ${summarise(b)}`);

console.log(`\n${"-".repeat(72)}`);
const aOk = a.status === 200;
const bOk = b.status === 200;

let verdict;
if (!aOk && !bOk) {
  verdict =
    "INCONCLUSIVE — the control (A) failed too, so B tells us nothing.\n" +
    "  The probe never got a challenge for *any* origin. Fix or report A first;\n" +
    "  do not read B as an origin refusal.";
} else if (aOk && bOk) {
  verdict =
    "UNBLOCKED — origin is not the constraint.\n" +
    "  The API issues challenges for our origin. The only remaining blocker is CORS,\n" +
    "  which a same-origin proxy solves. Login is buildable.";
} else if (aOk && !bOk) {
  verdict =
    "BLOCKED — the API pins the origin.\n" +
    "  A challenge for our origin was refused while the control succeeded, so the\n" +
    "  rejection is about `uri`, not about the fabricated address. A proxy does not\n" +
    "  fix this: it would forward a request the server is determined to refuse.\n" +
    "  Login needs an origin the exchange recognises — that is a decision for them.";
} else {
  verdict =
    "UNEXPECTED — B succeeded while the control A failed. Re-run before trusting\n" +
    "  either result; a success on B and a failure on A is not a coherent pair.";
}
console.log(verdict);

console.log(`\nRaw responses, for the record (no credentials are involved):`);
console.log(`\nA: ${a.raw || "(empty)"}`);
console.log(`\nB: ${b.raw || "(empty)"}\n`);

// Exit code tracks whether a decision was reached, not whether "login works".
process.exit(aOk ? 0 : 1);
