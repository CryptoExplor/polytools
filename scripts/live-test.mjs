import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const rootDir = fileURLToPath(new URL("..", import.meta.url));

function parseEnv() {
  const envContent = readFileSync(`${rootDir}/.env`, "utf8");
  const env = {};
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const k = trimmed.slice(0, eqIdx).trim();
    const v = trimmed.slice(eqIdx + 1).trim();
    env[k] = v;
  }
  return env;
}

const env = parseEnv();
const { PUBLIC_KEY, PRIVATE_KEY, KEY_ID } = env;

if (!PUBLIC_KEY || !PRIVATE_KEY || !KEY_ID) {
  console.error("Missing required variables in .env (PUBLIC_KEY, PRIVATE_KEY, KEY_ID)");
  process.exit(1);
}

// Global shim for localStorage if needed by storage layer
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

async function main() {
  console.log("=================================================");
  console.log("POLYESTER TESTNET LIVE READ-ONLY VERIFICATION");
  console.log("=================================================");
  console.log(`Key ID:     ${KEY_ID.slice(0, 10)}... (length: ${KEY_ID.length})`);
  console.log(`Public Key: ${PUBLIC_KEY.slice(0, 10)}...${PUBLIC_KEY.slice(-6)} (length: ${PUBLIC_KEY.length})`);

  // Step 1: Clock skew synchronization against /v1/spot/config
  console.log("\n1. Measuring server clock offset against https://api.testnet.polyester.com...");
  const t0 = Date.now();
  const spotRes = await fetch("https://api.testnet.polyester.com/v1/spot/config");
  const spotData = await spotRes.json();
  const roundtrip = Date.now() - t0;
  const serverTimeMs = Number(spotData.tsSec) * 1000;
  const localMid = t0 + Math.round(roundtrip / 2);
  const skewMs = serverTimeMs - localMid;
  console.log(`   Server tsSec: ${spotData.tsSec} (approx latency: ${roundtrip}ms)`);
  console.log(`   Calculated clock skew: ${skewMs}ms (applied to timestamp allocator)`);

  const syncNow = () => Date.now() + skewMs;

  const vite = await createServer({
    root: rootDir,
    logLevel: "silent",
    server: { middlewareMode: true },
  });

  const { account } = await vite.ssrLoadModule("/packages/core/src/index.ts");

  // Step 2: Validate public catalog
  console.log("\n2. Validating official spot catalog...");
  let catalog;
  try {
    catalog = account.validateOfficialSpotConfig(spotData);
    const pairCount = Object.keys(catalog.markets).length;
    console.log(`   [PASS] Validated ${pairCount} pairs in spot catalog.`);
  } catch (err) {
    console.error(`   [FAIL] Catalog validation failed:`, err.message);
    await vite.close();
    process.exit(1);
  }

  // Step 3: Initialize vault & import matching keypair
  console.log("\n3. Importing Ed25519 keypair into client-side memory vault...");
  const vault = new account.AccountVault({
    storage: new account.MemoryVaultStorage(),
    legacyStorage: globalThis.localStorage,
    channel: null,
    now: syncNow,
  });

  try {
    await vault.importKey({
      label: "live-testnet-verification",
      passphrase: "ephemeral-live-test-passphrase-32!",
      registeredKeyId: KEY_ID,
      privateKeyHex: PRIVATE_KEY,
      publicKeyHex: PUBLIC_KEY,
    });
    console.log("   [PASS] Keypair verified and session unlocked (non-extractable CryptoKey).");
  } catch (err) {
    console.error("   [FAIL] Vault import failed:", err.message);
    vault.dispose();
    await vite.close();
    process.exit(1);
  }

  // Step 4: Setup AccountRestClient with synchronized clock
  const client = new account.AccountRestClient({
    vault,
    fetchImpl: globalThis.fetch.bind(globalThis),
    maxRetries: 2,
    retryBaseDelayMs: 500,
    now: syncNow,
  });

  const results = [];

  const operations = [
    {
      name: "authMe",
      desc: "GET /v1/auth/me",
      params: {},
      validate: (v) => account.validateObjectResponse(v),
    },
    {
      name: "balances",
      desc: "GET /v1/balances",
      params: {},
      validate: (v) => account.validateBalancesResponse(v),
    },
    {
      name: "feeRates",
      desc: "GET /v1/spot/fee-rates",
      params: {},
      validate: (v) => account.validateFeeRatesResponse(v),
    },
    {
      name: "ordersOpen",
      desc: "GET /v1/orders/open",
      params: {},
      validate: (v) => account.validateObjectResponse(v),
    },
    {
      name: "ordersHistory",
      desc: "GET /v1/orders/history",
      params: {},
      validate: (v) => account.validateOrderHistoryResponse(v),
    },
    {
      name: "fills",
      desc: "GET /v1/spot/trades",
      params: {},
      validate: (v) => account.validateFillsResponse(v, { accountScope: "live-testnet", markets: catalog.markets }),
    },
    {
      name: "transfers",
      desc: "GET /v1/transfers",
      params: {},
      validate: (v) => account.validateTransfersResponse(v),
    },
    {
      name: "equityHistory",
      desc: "GET /v1/equity/history/series?range=1d",
      params: { range: "1d" },
      validate: (v) => account.validateEquityHistoryResponse(v),
    },
  ];

  console.log("\n4. Executing authenticated read-only endpoints against Polyester testnet...\n");

  for (const op of operations) {
    process.stdout.write(`   Testing ${op.name.padEnd(14)} (${op.desc.padEnd(35)})... `);
    try {
      const res = await client.request(op.name, op.params, op.validate);
      let count = 0;
      if (Array.isArray(res.data)) {
        count = res.data.length;
      } else if (res.data && typeof res.data === "object") {
        if (Array.isArray(res.data.balances)) count = res.data.balances.length;
        else if (Array.isArray(res.data.feeRates)) count = res.data.feeRates.length;
        else if (Array.isArray(res.data.orders)) count = res.data.orders.length;
        else if (Array.isArray(res.data.fills)) count = res.data.fills.length;
        else if (Array.isArray(res.data.transfers)) count = res.data.transfers.length;
        else count = Object.keys(res.data).length;
      }

      console.log(`[HTTP 200] SUCCESS (schema: valid, count: ${count})`);
      results.push({
        operation: op.name,
        endpoint: op.desc.split(" ")[1],
        httpStatus: 200,
        outcome: "SUCCESS",
        detail: `Valid schema (${count} items)`,
      });
    } catch (err) {
      const code = err.code ?? (err.name === "AccountSchemaError" ? "SCHEMA_INCOMPATIBLE" : "HTTP_ERROR");
      const httpStatus = err.details?.httpStatus ?? "N/A";
      console.log(`[HTTP ${httpStatus}] ${code} (${err.message})`);
      results.push({
        operation: op.name,
        endpoint: op.desc.split(" ")[1],
        httpStatus,
        outcome: code,
        detail: err.message,
      });
    }
  }

  // Cleanup
  vault.dispose();
  await vite.close();

  console.log("\n=================================================");
  console.log("LIVE VERIFICATION SANITIZED AUDIT REPORT");
  console.log("=================================================");
  console.log("| Operation       | Endpoint                      | HTTP | Outcome             | Detail |");
  console.log("|-----------------|-------------------------------|------|---------------------|--------|");
  for (const r of results) {
    console.log(`| ${r.operation.padEnd(15)} | ${r.endpoint.padEnd(29)} | ${String(r.httpStatus).padEnd(4)} | ${r.outcome.padEnd(19)} | ${r.detail} |`);
  }
  console.log("=================================================\n");
}

main().catch((e) => {
  console.error("Fatal execution error:", e);
  process.exit(1);
});
