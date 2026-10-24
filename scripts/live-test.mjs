import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Local owner-only usage: POLYTOOLS_LIVE_TEST=1 node scripts/live-test.mjs
// Requires a gitignored .env with PUBLIC_KEY, PRIVATE_KEY, and KEY_ID.
// Never run this script in CI, a shared preview, or a deployed web process.

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const ci = /^(?:1|true)$/i.test(process.env.CI ?? "") ||
  /^(?:1|true)$/i.test(process.env.GITHUB_ACTIONS ?? "");

// This is an owner-controlled live runner, not an npm test or CI job.
// The opt-in is checked before reading .env or creating any network client.
if (ci || process.env.POLYTOOLS_LIVE_TEST !== "1") {
  console.error("Refusing live verification. Run only locally with POLYTOOLS_LIVE_TEST=1; CI is not supported.");
  process.exit(1);
}

function parseEnv() {
  const envContent = readFileSync(`${rootDir}/.env`, "utf8");
  const requiredKeys = new Set(["PUBLIC_KEY", "PRIVATE_KEY", "KEY_ID"]);
  const env = {};
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (requiredKeys.has(key)) env[key] = value;
  }
  return env;
}

const env = parseEnv();
const { PUBLIC_KEY, PRIVATE_KEY, KEY_ID } = env;
if (!PUBLIC_KEY || !PRIVATE_KEY || !KEY_ID) {
  console.error("Missing required local variables: PUBLIC_KEY, PRIVATE_KEY, KEY_ID");
  process.exit(1);
}

// Keep the vault's compatibility storage in memory only. No private response
// or decrypted key is written to localStorage, IndexedDB, or a report file.
const mem = new Map();
globalThis.localStorage = {
  getItem: (key) => mem.get(key) ?? null,
  setItem: (key, value) => mem.set(key, String(value)),
  removeItem: (key) => mem.delete(key),
  clear: () => mem.clear(),
};

let vite;
let vault;

function resultDetail(operation, data) {
  if (operation === "authMe") {
    return `object accepted (${Object.keys(data).length} top-level keys; fields not asserted)`;
  }
  if (operation === "ordersOpen") {
    const rows = Array.isArray(data.orders) ? data.orders.length : "unknown";
    return `object accepted (${rows} order rows; row schema not asserted)`;
  }
  if (operation === "equityHistory") {
    const samples = data.series.reduce((total, series) => total + series.equity.length, 0);
    return `schema valid (${samples} samples)`;
  }
  if (operation === "fills") {
    return `schema valid (${data.fills.length} fills; ${data.quarantined.length} quarantined)`;
  }
  if (operation === "ordersHistory") {
    return `schema valid (${data.orders.length} orders; ${data.quarantined.length} quarantined)`;
  }
  if (operation === "transfers") {
    return `schema valid (${data.transfers.length} transfers; ${data.quarantined.length} quarantined)`;
  }
  if (operation === "balances") return `schema valid (${data.balances.length} balances)`;
  if (operation === "feeRates") return `schema valid (${data.feeRates.length} fee-rate rows)`;
  return "schema valid";
}

async function main() {
  console.log("=================================================");
  console.log("POLYESTER TESTNET LIVE READ-ONLY VERIFICATION");
  console.log("Local owner-controlled runner; identifiers suppressed");
  console.log("=================================================");

  // Step 1: measure clock offset against the unsigned official catalog.
  console.log("\n1. Measuring server clock offset against the official testnet catalog...");
  const t0 = Date.now();
  const spotRes = await fetch("https://api.testnet.polyester.com/v1/spot/config", {
    method: "GET",
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!spotRes.ok) throw new Error(`The public catalog returned HTTP ${spotRes.status}.`);
  const spotData = await spotRes.json();
  if (!spotData || typeof spotData.tsSec !== "string" || !/^\d+$/.test(spotData.tsSec)) {
    throw new Error("The public catalog timestamp is invalid.");
  }
  const serverTimeMs = Number(spotData.tsSec) * 1000;
  const roundtrip = Date.now() - t0;
  const localMid = t0 + Math.round(roundtrip / 2);
  const skewMs = serverTimeMs - localMid;
  if (!Number.isSafeInteger(serverTimeMs) || !Number.isSafeInteger(skewMs)) {
    throw new Error("The calculated clock offset is invalid.");
  }
  console.log(`   [PASS] Catalog response received (latency ${roundtrip}ms; offset ${skewMs}ms).`);

  // Step 2: load the audited account modules without letting Vite read .env.
  const { createServer } = await import("vite");
  vite = await createServer({
    root: rootDir,
    logLevel: "silent",
    envFile: false,
    server: { middlewareMode: true },
  });
  const { account } = await vite.ssrLoadModule("/packages/core/src/index.ts");

  // Step 3: validate the public catalog before importing or signing with a key.
  console.log("\n2. Validating official spot catalog...");
  const catalog = account.validateOfficialSpotConfig(spotData);
  console.log(`   [PASS] Validated ${Object.keys(catalog.markets).length} pairs in spot catalog.`);

  // Step 4: import the owner-supplied pair into the memory-only vault.
  console.log("\n3. Importing Ed25519 keypair into the memory-only vault...");
  vault = new account.AccountVault({
    storage: new account.MemoryVaultStorage(),
    legacyStorage: globalThis.localStorage,
    channel: null,
  });
  vault.setClockSkew(skewMs);
  await vault.importKey({
    label: "live-testnet-verification",
    passphrase: "ephemeral-live-test-passphrase-32!",
    registeredKeyId: KEY_ID,
    privateKeyHex: PRIVATE_KEY,
    publicKeyHex: PUBLIC_KEY,
  });
  console.log("   [PASS] Keypair verified; non-extractable session active (identifiers suppressed).");

  // Step 5: use only the audited read-only REST client. Its retry policy is
  // bounded to safe GETs and creates a fresh signed timestamp per attempt.
  const client = new account.AccountRestClient({
    vault,
    fetchImpl: globalThis.fetch.bind(globalThis),
    maxRetries: 2,
    retryBaseDelayMs: 500,
  });
  const operations = [
    { name: "authMe", desc: "GET /v1/auth/me", params: {}, validate: account.validateObjectResponse },
    { name: "balances", desc: "GET /v1/balances", params: {}, validate: account.validateBalancesResponse },
    { name: "feeRates", desc: "GET /v1/spot/fee-rates", params: {}, validate: account.validateFeeRatesResponse },
    { name: "ordersOpen", desc: "GET /v1/orders/open", params: {}, validate: account.validateObjectResponse },
    { name: "ordersHistory", desc: "GET /v1/orders/history", params: {}, validate: account.validateOrderHistoryResponse },
    {
      name: "fills",
      desc: "GET /v1/spot/trades",
      params: {},
      validate: (value) => account.validateFillsResponse(value, {
        accountScope: "live-testnet",
        markets: catalog.markets,
      }),
    },
    { name: "transfers", desc: "GET /v1/transfers", params: {}, validate: account.validateTransfersResponse },
    {
      name: "equityHistory",
      desc: "GET /v1/equity/history/series?range=1d",
      params: { range: "1d" },
      validate: account.validateEquityHistoryResponse,
    },
  ];

  console.log("\n4. Executing authenticated read-only endpoints against Polyester testnet...\n");
  const results = [];
  for (const operation of operations) {
    process.stdout.write(`   Testing ${operation.name.padEnd(14)} (${operation.desc.padEnd(35)})... `);
    try {
      const response = await client.request(operation.name, operation.params, operation.validate, {
        signal: AbortSignal.timeout(30_000),
      });
      const detail = resultDetail(operation.name, response.data);
      console.log(`[HTTP 200] SUCCESS (${detail})`);
      results.push({
        operation: operation.name,
        endpoint: operation.desc.split(" ")[1],
        httpStatus: 200,
        outcome: "SUCCESS",
        detail,
      });
    } catch (error) {
      // Never print arbitrary exception messages: a future validator or
      // transport could include sensitive response material in them.
      const safe = account.safeAccountError(error, operation.name);
      const httpStatus = safe.httpStatus ?? "N/A";
      console.log(`[HTTP ${httpStatus}] ${safe.code}`);
      results.push({
        operation: operation.name,
        endpoint: operation.desc.split(" ")[1],
        httpStatus,
        outcome: safe.code,
        detail: safe.code,
      });
    }
  }

  console.log("\n=================================================");
  console.log("LIVE VERIFICATION SANITIZED AUDIT REPORT");
  console.log("=================================================");
  console.log("| Operation       | Endpoint                      | HTTP | Outcome             | Detail |");
  console.log("|-----------------|-------------------------------|------|---------------------|--------|");
  for (const result of results) {
    console.log(`| ${result.operation.padEnd(15)} | ${result.endpoint.padEnd(29)} | ${String(result.httpStatus).padEnd(4)} | ${result.outcome.padEnd(19)} | ${result.detail} |`);
  }
  console.log("=================================================\n");
}

main()
  .catch(() => {
    console.error("Fatal execution error: live verification aborted safely; no error details were printed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      vault?.dispose();
    } catch {
      // Cleanup is best effort and must not print secret-bearing errors.
    }
    try {
      if (vite) await vite.close();
    } catch {
      // Do not leak a cleanup error after a live run.
    }
  });
