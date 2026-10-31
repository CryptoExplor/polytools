export type TypeScriptSdkStep = "install" | "market" | "stream" | "trade";

export interface TypeScriptSdkExampleOptions {
  step: TypeScriptSdkStep;
  symbol: string;
  streamTf: string;
  orderSide: "buy" | "sell";
  orderQty: string;
  orderPrice: string;
  keyIdInput: string;
}

/**
 * Render a value as a TypeScript string literal.
 *
 * Every user-supplied value below is interpolated into generated code that the
 * reader copies. Inserting raw text between quotes lets a `"` end the literal
 * early and a `\` change how it parses, so a hostile or merely odd value
 * (a symbol with a quote, a quantity typed as `12"`) would emit a snippet that
 * fails to compile or silently carries a different value. `JSON.stringify`
 * produces a valid literal for any input and leaves ordinary values unchanged.
 */
function tsString(value: string): string {
  return JSON.stringify(value);
}

/**
 * Escape a value for insertion *inside* an existing double-quoted literal or a
 * single-line comment in the generated code, where wrapping it in a full
 * literal of its own would break the surrounding snippet.
 */
function tsBody(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

/** Single source for the TypeScript code shown in the SDK quickstart. */
export function buildTypeScriptSdkExample({
  step,
  symbol,
  streamTf,
  orderSide,
  orderQty,
  orderPrice,
  keyIdInput,
}: TypeScriptSdkExampleOptions): string {
  const cleanQty = orderQty.trim() || "0.001";
  const cleanPx = orderPrice.trim() || "50000";
  const cleanKeyId = keyIdInput.trim() || "ak_...";

  if (step === "install") {
    return `# 1. Install the verified TypeScript SDK version
npm install @polyester/sdk@0.31.0
# or: pnpm add @polyester/sdk@0.31.0 | bun add @polyester/sdk@0.31.0

# Registry/repository metadata identifies Fabric Labs; the package LICENSE is restrictive.
# Use only if covered by a separate written agreement with Fabric Blockchain Labs Inc.
# Ensure package.json has: "type": "module"`;
  }

  if (step === "market") {
    return `import { PolyesterClient, POLYESTER_TESTNET_ENVIRONMENT } from "@polyester/sdk";

// Public market data requires NO API keys or credentials
const client = new PolyesterClient({
  environment: POLYESTER_TESTNET_ENVIRONMENT,
});

// Load the reference catalog to map between numeric symbolId and "${tsBody(symbol)}"
await client.catalog.ensureReady();
const symbolId = client.catalog.market.requireSymbolIdByPairSymbol(${tsString(symbol)});
console.log("Resolved ${tsBody(symbol)} -> symbolId:", symbolId);

// Fetch market overview (prices are returned as exact decimal strings)
const { markets } = await client.marketOverview.list({ limit: 10 });
for (const market of markets) {
  const pairSymbol = client.catalog.market.requirePairSymbolBySymbolId(market.symbolId);
  console.log(\`\${pairSymbol} (#\${market.symbolId}): last=\${market.lastPrice}\`);
}`;
  }

  if (step === "stream") {
    return `import { PolyesterClient, POLYESTER_TESTNET_ENVIRONMENT } from "@polyester/sdk";

const client = new PolyesterClient({
  environment: POLYESTER_TESTNET_ENVIRONMENT,
});

await client.catalog.ensureReady();
const symbolId = client.catalog.market.requireSymbolIdByPairSymbol(${tsString(symbol)});

// Subscribe to live ${tsBody(streamTf)} candles for ${tsBody(symbol)}
const unsubscribe = client.candles.subscribe({
  symbolId,
  timeframe: ${tsString(streamTf)},
  onEvent: (candle) => {
    console.log("[${tsBody(symbol)} ${tsBody(streamTf)}] close:", candle.close, "volume:", candle.volume);
  },
  onError: (ctx) => {
    console.error("Stream error:", ctx);
  },
});

// Call unsubscribe() when finished to close the stream cleanly
// setTimeout(() => unsubscribe(), 30_000);`;
  }

  return `import {
  PolyesterClient,
  POLYESTER_TESTNET_ENVIRONMENT,
  evmHexToBytes,
} from "@polyester/sdk";

// Authenticate with your Ed25519 API key (requires trade-spot & read-spot permissions)
const client = new PolyesterClient({
  environment: POLYESTER_TESTNET_ENVIRONMENT,
  auth: {
    kind: "api-key-ed25519",
    getKeyId: () => process.env.POLYESTER_API_KEY_ID ?? ${tsString(cleanKeyId)},
    // Must be 0x-prefixed: evmHexToBytes() throws "Invalid hex value" on a bare
    // hex string (the vault stores raw hex without the prefix), so normalize it.
    getSecretKey: () =>
      evmHexToBytes("0x" + (process.env.POLYESTER_API_SECRET_HEX ?? "").replace(/^0x/, "")),
  },
});

await client.catalog.ensureReady();
const symbolId = client.catalog.market.requireSymbolIdByPairSymbol(${tsString(symbol)});

// Place a post-only limit ${tsBody(orderSide)} order on ${tsBody(symbol)} (mutates testnet state)
const created = await client.orders.create({
  symbolId,
  side: "${tsBody(orderSide)}",
  qty: ${tsString(cleanQty)},
  execution: {
    type: "limit_gtc",
    price: ${tsString(cleanPx)},
    postOnly: true,
  },
  clientOrderId: crypto.randomUUID(),
});
console.log("Order admitted:", created.orderId);

// Cancel the test order by orderId
await client.orders.cancel({
  orderId: created.orderId,
  symbolId,
});`;
}
