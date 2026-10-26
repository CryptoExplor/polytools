/**
 * SDK & Bot Quickstart Studio (/#/sdk)
 * Beginner-friendly interactive guide and code generator for the official
 * Polyester TypeScript, Python, and Rust SDKs, plus an interactive Ed25519
 * 5-field canonical request & SHA-256 inspector and capability matrices.
 */

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  CANDLE_TIMEFRAMES,
  NETWORKS,
  fmtNum,
  price,
  splitSymbol,
  vault,
  type CandleTimeframe,
} from "@poly/core";
import { api } from "../lib/api";
import { usePollData } from "../lib/hooks";
import { useApp } from "../lib/store";
import { roundToTick, validateOrderDraft } from "../lib/orderConstraints";
import { validateCanonicalRequest } from "../lib/canonicalRequest";
import {
  Card,
  CopyButton,
  MetricCell,
  MetricStrip,
  PageHeader,
  Pill,
  TermTip,
} from "../components/ui";
import { IconCheck, IconExternal, IconKey } from "../components/icons";

type SdkLang = "typescript" | "python" | "rust";
type GuideStep = "install" | "market" | "stream" | "trade";

const DOC_URLS = {
  tsOverview: "https://testnet.polyester.com/docs/sdk/typescript/get-started",
  tsInstall: "https://testnet.polyester.com/docs/sdk/typescript/get-started/installation",
  tsQuickstart: "https://testnet.polyester.com/docs/sdk/typescript/get-started/quickstart",
  pyOverview: "https://testnet.polyester.com/docs/sdk/python/get-started",
  pyInstall: "https://testnet.polyester.com/docs/sdk/python/get-started/installation",
  pyQuickstart: "https://testnet.polyester.com/docs/sdk/python/get-started/quickstart",
  rsOverview: "https://testnet.polyester.com/docs/sdk/rust/get-started",
  rsInstall: "https://testnet.polyester.com/docs/sdk/rust/get-started/installation",
  rsQuickstart: "https://testnet.polyester.com/docs/sdk/rust/get-started/quickstart",
  matrix: "https://testnet.polyester.com/docs/developer-docs/getting-started/sdk-capability-matrix",
  connectivity:
    "https://testnet.polyester.com/docs/developer-docs/getting-started/connectivity-matrix",
  ed25519: "https://testnet.polyester.com/docs/developer-docs/authentication-security/ed25519-api-keys",
};

export default function SdkGuide() {
  const { symbol, setSymbol, pairBySymbol } = useApp();
  const { data: ov } = usePollData(() => api.overview([symbol]), 6000, [symbol]);
  const livePx = ov?.markets?.[0] ? price(ov.markets[0].lastPrice) : NaN;

  const [lang, setLang] = useState<SdkLang>("typescript");
  const [step, setStep] = useState<GuideStep>("install");

  // Interactive code-generator parameters
  const [orderSide, setOrderSide] = useState<"buy" | "sell">("buy");
  const [orderQty, setOrderQty] = useState<string>("0.001");
  const [orderPrice, setOrderPrice] = useState<string>("50000");
  const [streamTf, setStreamTf] = useState<CandleTimeframe>("1m");
  const [keyIdInput, setKeyIdInput] = useState<string>("ak_your_testnet_key_id");

  // Interactive Ed25519 canonical string visualizer state
  const [httpMethod, setHttpMethod] = useState<"GET" | "POST" | "DELETE">("POST");
  const [reqPath, setReqPath] = useState<string>("/v1/orders");
  const [reqQuery, setReqQuery] = useState<string>("symbol=BTC-USDT&limit=10");
  const [reqBody, setReqBody] = useState<string>(
    '{"symbol":"BTC-USDT","side":"buy","qty":"0.001","price":"50000"}',
  );
  const [bodyHash, setBodyHash] = useState<string>("");
  const [bodyHashError, setBodyHashError] = useState<string | null>(null);
  const [sampleTs, setSampleTs] = useState<string>(() => String(Date.now()));

  const [base, quote] = splitSymbol(symbol);
  const pair = pairBySymbol.get(symbol);

  useEffect(() => {
    let alive = true;
    const effectiveBody = httpMethod === "GET" ? "" : reqBody;
    setBodyHash("");
    setBodyHashError(null);
    void vault
      .sha256Hex(effectiveBody)
      .then((hash) => {
        if (alive) setBodyHash(hash);
      })
      .catch((caught) => {
        if (alive) setBodyHashError(vault.vaultErrorMessage(caught));
      });
    return () => {
      alive = false;
    };
  }, [httpMethod, reqBody]);

  const syncLivePriceToOrder = () => {
    if (!isFinite(livePx) || livePx <= 0) return;
    // Post-only requires a resting price: sit ~2% away from the live price and
    // then snap to a legal tick so the snippet never shows sub-tick decimals.
    const target = orderSide === "buy" ? livePx * 0.98 : livePx * 1.02;
    const snapped = roundToTick(target, pair?.tickSize ?? "0.01", orderSide === "buy" ? "down" : "up");
    if (snapped) setOrderPrice(snapped);
  };

  // The trade snippet is generated code the user will run against testnet, so
  // it is only offered once qty and price are provably legal for this pair.
  const orderDraft = useMemo(
    () => validateOrderDraft({ qty: orderQty, price: orderPrice, pair, base, quote }),
    [orderQty, orderPrice, pair, base, quote],
  );
  const orderBlocked = step === "trade" && !orderDraft.ok;
  const orderIssueText = orderDraft.issues.map((issue) => issue.message);

  const canonicalPreview = useMemo(() => {
    if (bodyHashError) {
      return { query: "", text: "", error: bodyHashError };
    }
    if (!bodyHash) return { query: "", text: "", error: null };
    try {
      const canonicalQuery = vault.normalizeCanonicalQuery(reqQuery);
      return {
        query: canonicalQuery,
        text: vault.buildCanonicalString({
          timestamp: sampleTs,
          method: httpMethod,
          path: reqPath,
          query: reqQuery,
          bodySha256Hex: bodyHash,
        }),
        error: null,
      };
    } catch (caught) {
      return { query: "", text: "", error: vault.vaultErrorMessage(caught) };
    }
  }, [sampleTs, httpMethod, reqPath, reqQuery, bodyHash, bodyHashError]);
  const canonicalValidation = useMemo(
    () =>
      validateCanonicalRequest({
        timestamp: sampleTs,
        path: reqPath,
        query: reqQuery,
        body: reqBody,
        method: httpMethod,
      }),
    [sampleTs, reqPath, reqQuery, reqBody, httpMethod],
  );
  const canonicalQuery = canonicalPreview.query;
  const canonicalString5Line = canonicalPreview.text;
  const canonicalError = canonicalPreview.error;

  const generatedCode = useMemo(() => {
    const cleanQty = orderQty.trim() || "0.001";
    const cleanPx = orderPrice.trim() || "50000";
    const cleanKeyId = keyIdInput.trim() || "ak_...";

    if (lang === "typescript") {
      if (step === "install") {
        return `# 1. Install the official TypeScript SDK (Node.js 20+, Bun, Deno, Workers, or Browser)
npm install @polyester/sdk
# or: pnpm add @polyester/sdk | bun add @polyester/sdk

# Ensure package.json has: "type": "module"`;
      }
      if (step === "market") {
        return `import { PolyesterClient, POLYESTER_TESTNET_ENVIRONMENT } from "@polyester/sdk";

// Public market data requires NO API keys or credentials
const client = new PolyesterClient({
  environment: POLYESTER_TESTNET_ENVIRONMENT,
});

// Load the reference catalog to map between numeric symbolId and "${symbol}"
await client.catalog.ensureReady();
const symbolId = client.catalog.market.requireSymbolIdByPairSymbol("${symbol}");
console.log("Resolved ${symbol} -> symbolId:", symbolId);

// Fetch live market overview (prices are returned as exact decimal strings, e.g. "82132.47")
const { markets } = await client.marketOverview.list({ limit: 10 });
for (const m of markets) {
  const pairSymbol = client.catalog.market.requirePairSymbolBySymbolId(m.symbolId);
  console.log(\`\${pairSymbol} (#\${m.symbolId}): last=\${m.lastPrice}\`);
}`;
      }
      if (step === "stream") {
        return `import { PolyesterClient, POLYESTER_TESTNET_ENVIRONMENT } from "@polyester/sdk";

const client = new PolyesterClient({
  environment: POLYESTER_TESTNET_ENVIRONMENT,
});

await client.catalog.ensureReady();
const symbolId = client.catalog.market.requireSymbolIdByPairSymbol("${symbol}");

// Subscribe to live ${streamTf} candles for ${symbol}
const unsubscribe = client.candles.subscribe({
  symbolId,
  timeframe: "${streamTf}",
  onEvent: (candle) => {
    console.log("[${symbol} ${streamTf}] close:", candle.close, "volume:", candle.volume);
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
    getKeyId: () => process.env.POLYESTER_API_KEY_ID ?? "${cleanKeyId}",
    getSecretKey: () => evmHexToBytes(process.env.POLYESTER_API_SECRET_HEX ?? "0x..."),
  },
});

await client.catalog.ensureReady();
const symbolId = client.catalog.market.requireSymbolIdByPairSymbol("${symbol}");

// Place a post-only limit ${orderSide} order on ${symbol} (mutates testnet state)
const created = await client.orders.create({
  symbolId,
  side: "${orderSide}",
  qty: "${cleanQty}",
  execution: {
    type: "limit_gtc",
    price: "${cleanPx}",
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

    if (lang === "python") {
      if (step === "install") {
        return `# 1. Install the official Python SDK (requires Python 3.11+)
pip install "polyester-sdk==0.1.0a55"

# Testnet Endpoints (configured automatically via POLYESTER_TESTNET_ENVIRONMENT):
#   API:       https://api-testnet.polyester.com
#   WebSocket: wss://api-testnet.polyester.com`;
      }
      if (step === "market") {
        return `import asyncio
from polyester import AsyncPolyester, POLYESTER_TESTNET_ENVIRONMENT

async def main() -> None:
    # Public market data needs NO credentials
    async with AsyncPolyester(environment=POLYESTER_TESTNET_ENVIRONMENT) as client:
        overview = await client.market_overview.list(limit=10)
        for market in overview.markets:
            print(f"{market.symbol}: last={market.last_price}")

asyncio.run(main())`;
      }
      if (step === "stream") {
        return `import asyncio
from polyester import AsyncPolyester, POLYESTER_TESTNET_ENVIRONMENT

async def main() -> None:
    async with AsyncPolyester(environment=POLYESTER_TESTNET_ENVIRONMENT) as client:
        # Bounded fail-closed realtime trade stream for ${symbol}
        subscription = await client.market_data.subscribe_trades(symbol="${symbol}")
        async with subscription:
            async for trade in subscription:
                print("${symbol} trade:", trade.price.ticks if trade.price else None)
                break

asyncio.run(main())`;
      }
      return `import asyncio
import os
from uuid import uuid4
from polyester import AsyncPolyester, POLYESTER_TESTNET_ENVIRONMENT

async def main() -> None:
    async with AsyncPolyester(
        environment=POLYESTER_TESTNET_ENVIRONMENT,
        api_key_id=os.environ.get("POLYESTER_API_KEY_ID", "${cleanKeyId}"),
        api_private_key=os.environ["POLYESTER_API_PRIVATE_KEY"],  # 64-char hex secret
        default_account_id=os.environ["POLYESTER_ACCOUNT_ID"],    # Profile -> Account ID
    ) as client:
        # Wait for spot scale catalogs before sending decimal order quantities/prices
        await client.wait_for_catalogs()

        client_order_id = f"quickstart-{uuid4().hex[:20]}"
        result = await client.orders.create(
            symbol="${symbol}",
            side="${orderSide}",
            order_type="limit",
            tif="gtc",
            qty="${cleanQty}",
            price="${cleanPx}",
            post_only=True,
            client_order_id=client_order_id,
        )
        print("Order status:", result.status, "order_id:", result.order_id)

        # Cancel the test order
        await client.orders.cancel(client_order_id=client_order_id)

asyncio.run(main())`;
    }

    // Rust SDK
    if (step === "install") {
      return `# Cargo.toml (requires Rust 1.88+ MSRV)
# Note: crate is named "polyester-sdk", library import target is "polyester"
[dependencies]
polyester-sdk = "0.1.0-alpha.49"
tokio = { version = "1", features = ["full"] }`;
    }
    if (step === "market") {
      return `use polyester::{Client, Config};
use polyester::services::ListMarketOverviewOptions;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Public market data requires NO credentials
    let client = Client::new(Config {
        environment: Some(polyester::POLYESTER_TESTNET_ENVIRONMENT.clone()),
        ..Default::default()
    })?;

    let overview = client.market_overview.list(ListMarketOverviewOptions {
        limit: Some(10),
        ..Default::default()
    }).await?;

    for market in overview.markets {
        println!("{} {:?}", market.symbol, market.last_price.as_ref().map(|p| p.as_ticks()));
    }
    Ok(())
}`;
    }
    if (step === "stream") {
      return `use polyester::{Client, Config};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = Client::new(Config {
        environment: Some(polyester::POLYESTER_TESTNET_ENVIRONMENT.clone()),
        ..Default::default()
    })?;

    // Bounded fail-closed realtime trade subscription for ${symbol}
    let mut sub = client.market_data.subscribe_trades("${symbol}").await?;
    if let Some(trade) = sub.recv_result().await? {
        println!("${symbol} trade: {trade:?}");
    }
    Ok(())
}`;
    }
    return `use std::time::{SystemTime, UNIX_EPOCH};
use polyester::{Client, Config, Price, Quantity};
use polyester::models::{CreateOrderParams, CreateOrderType, CreateSide, CreateTimeInForce};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let client = Client::new(Config {
        environment: Some(polyester::POLYESTER_TESTNET_ENVIRONMENT.clone()),
        api_key_id: Some("${cleanKeyId}".into()),
        api_private_key: Some(std::env::var("POLYESTER_API_PRIVATE_KEY")?),
        default_account_id: Some(std::env::var("POLYESTER_ACCOUNT_ID")?),
        ..Default::default()
    })?;

    // Wait for spot config scale catalogs before constructing decimal Quantities/Prices
    client.wait_for_catalogs().await?;

    let quantity_scale = client
        .catalogs
        .base_quantity_scale_for_symbol("${symbol}")
        .ok_or_else(|| polyester::Error::validation("${symbol} quantity scale unavailable"))?;

    let client_order_id = format!(
        "quickstart-{}",
        SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos()
    );

    let result = client.orders.create(CreateOrderParams {
        symbol: "${symbol}".into(),
        side: CreateSide::${orderSide === "buy" ? "Buy" : "Sell"},
        order_type: CreateOrderType::Limit,
        quantity: Some(Quantity::from_decimal_str(
            "${cleanQty}",
            quantity_scale,
            Some("${symbol}".into()),
            None,
        )?),
        max_quote_debit_scaled: None,
        price: Some(Price::from_decimal_str("${cleanPx}", Some("${symbol}".into()))?),
        time_in_force: Some(CreateTimeInForce::Gtc),
        client_order_id: Some(client_order_id.clone()),
        subaccount_id: None,
        post_only: Some(true),
        market_client_ref_price: None,
        fee_asset: None,
        self_trade_prevention: None,
        market_max_slippage: None,
        attached_risk: None,
    }).await?;

    println!("{} {}", result.status, result.order_id);

    client.orders.cancel_by_client_order_id(&client_order_id, Some("${symbol}"), None).await?;
    Ok(())
}`;
  }, [lang, step, symbol, orderSide, orderQty, orderPrice, streamTf, keyIdInput]);

  return (
    <div className="page-stack">
      <PageHeader
        title="Developers: SDK quickstart"
        badge={<Pill kind="accent">TypeScript · Python · Rust</Pill>}
        subtitle="Copy-paste code for TypeScript, Python, and Rust — public data, then authenticated requests."
        actions={
          <div className="row-flex">
            <a
              className="btn sm ghost"
              href={DOC_URLS.matrix}
              target="_blank"
              rel="noreferrer"
            >
              <span>SDK Matrix</span>
              <IconExternal size={12} />
            </a>
          </div>
        }
      />

      <MetricStrip>
        <MetricCell
          label="TypeScript SDK"
          trend="up"
          value="@polyester/sdk"
          sub="Node 20+, Bun, Edge & Browser"
        />
        <MetricCell
          label="Python SDK"
          trend="up"
          value="polyester-sdk"
          sub="Python 3.11+ · Async & Sync"
        />
        <MetricCell
          label="Rust SDK"
          trend="up"
          value="polyester-sdk"
          sub="Rust 1.88+ · Tokio Async"
        />
        <MetricCell
          label="Testnet API Host"
          value="api-testnet.polyester.com"
          sub="ConnectRPC + WS Protobuf"
        />
        <MetricCell
          label="Authentication"
          value="Ed25519 API Keys"
          sub="32B public key · ±10s timestamp"
        />
      </MetricStrip>

      <div className="notice warn" role="note">
        <div>
          <strong>PolyTools does not run this code.</strong> These snippets are examples you
          copy into your own project. Running the order examples places real orders on
          testnet and may cancel them again — nothing here executes on your behalf.
        </div>
      </div>

      {/* Beginner 4-Step Orientation */}
      <Card
        title="New to Polyester? Start here (4 rules)"
        subtitle="Understand how Polyester's APIs, prices, and keys work before writing your first line of code."
        actions={<Pill kind="up">Beginner Friendly</Pill>}
      >
        <div className="grid cols-4">
          <div
            className="card"
            style={{ background: "var(--bg-elevated)", padding: "12px 14px" }}
          >
            <div className="between mb-2">
              <Pill kind="accent">1. Public vs Private</Pill>
              <IconCheck size={14} style={{ color: "var(--up)" }} />
            </div>
            <strong style={{ fontSize: 13 }}>No Keys Needed for Market Data</strong>
            <div className="faint mt-1" style={{ lineHeight: 1.5 }}>
              You can fetch market overviews, order books, candles, trades, and Zipper
              routes immediately with <strong>zero credentials</strong> using{" "}
              <code className="mono">POLYESTER_TESTNET_ENVIRONMENT</code>.
            </div>
          </div>

          <div
            className="card"
            style={{ background: "var(--bg-elevated)", padding: "12px 14px" }}
          >
            <div className="between mb-2">
              <Pill kind="accent">2. Price Formats</Pill>
              <IconCheck size={14} style={{ color: "var(--up)" }} />
            </div>
            <strong style={{ fontSize: 13 }}>Decimals in SDK vs ÷10³ on Wire</strong>
            <div className="faint mt-1" style={{ lineHeight: 1.5 }}>
              On raw MCP/Protobuf wire, prices are scaled integers (e.g.{" "}
              <code className="mono">&quot;82132470&quot;</code> ={" "}
              <code className="mono">82,132.47</code>). The official SDKs convert these
              for you so you pass exact decimal strings like{" "}
              <code className="mono">&quot;50000&quot;</code>.
            </div>
          </div>

          <div
            className="card"
            style={{ background: "var(--bg-elevated)", padding: "12px 14px" }}
          >
            <div className="between mb-2">
              <Pill kind="accent">3. Catalogs First</Pill>
              <IconCheck size={14} style={{ color: "var(--up)" }} />
            </div>
            <strong style={{ fontSize: 13 }}>Load the Symbol Catalog</strong>
            <div className="faint mt-1" style={{ lineHeight: 1.5 }}>
              Trading endpoints use numeric <code className="mono">symbolId</code>s and
              per-pair tick/step scales. Call{" "}
              <code className="mono">catalog.ensureReady()</code> (TS) or{" "}
              <code className="mono">wait_for_catalogs()</code> (Python/Rust) before
              placing orders.
            </div>
          </div>

          <div
            className="card"
            style={{ background: "var(--bg-elevated)", padding: "12px 14px" }}
          >
            <div className="between mb-2">
              <Pill kind="accent">4. API Key Policy</Pill>
              <IconKey size={14} style={{ color: "var(--warn)" }} />
            </div>
            <strong style={{ fontSize: 13 }}>Attach Permissions to Your Key</strong>
            <div className="faint mt-1" style={{ lineHeight: 1.5 }}>
              A newly created Ed25519 API key has <strong>no trading permissions</strong>{" "}
              by default. In the Polyester app, open the key&apos;s Permissions and enable{" "}
              <code className="mono">Spot trading</code> + max order size.
            </div>
          </div>
        </div>
      </Card>

      {/* Official SDK Language Cards */}
      <div className="grid cols-3">
        <Card
          title="TypeScript SDK (@polyester/sdk)"
          subtitle="Node.js, Bun, Workers, and browser apps"
          actions={<Pill kind="up">Full-Stack + Browser</Pill>}
          footer={
            <div className="between" style={{ width: "100%" }}>
              <a href={DOC_URLS.tsOverview} target="_blank" rel="noreferrer">
                TS Overview ↗
              </a>
              <a href={DOC_URLS.tsInstall} target="_blank" rel="noreferrer">
                Installation ↗
              </a>
              <a href={DOC_URLS.tsQuickstart} target="_blank" rel="noreferrer">
                Quickstart ↗
              </a>
            </div>
          }
        >
          <div className="kv">
            <span className="k">Package</span>
            <span className="v mono">@polyester/sdk</span>
          </div>
          <div className="kv">
            <span className="k">Clients Included</span>
            <span className="v mono">PolyesterClient / Browser / Server</span>
          </div>
          <div className="kv">
            <span className="k">Auth Modes</span>
            <span className="v">Ed25519 API Key, Wallet Signer, Session</span>
          </div>
          <div className="kv">
            <span className="k">Runtime Req</span>
            <span className="v mono">Node 20+ · ESM (&quot;type&quot;: &quot;module&quot;)</span>
          </div>
        </Card>

        <Card
          title="Python SDK (polyester-sdk)"
          subtitle="Trading bots, research scripts, async automation"
          actions={<Pill kind="accent">Async & Sync</Pill>}
          footer={
            <div className="between" style={{ width: "100%" }}>
              <a href={DOC_URLS.pyOverview} target="_blank" rel="noreferrer">
                Python Overview ↗
              </a>
              <a href={DOC_URLS.pyInstall} target="_blank" rel="noreferrer">
                Installation ↗
              </a>
              <a href={DOC_URLS.pyQuickstart} target="_blank" rel="noreferrer">
                Quickstart ↗
              </a>
            </div>
          }
        >
          <div className="kv">
            <span className="k">PyPI Package</span>
            <span className="v mono">polyester-sdk==0.1.0a55</span>
          </div>
          <div className="kv">
            <span className="k">Clients Included</span>
            <span className="v mono">AsyncPolyester &amp; Polyester</span>
          </div>
          <div className="kv">
            <span className="k">Auth Mode</span>
            <span className="v">Ed25519 API Key (`ak_...`)</span>
          </div>
          <div className="kv">
            <span className="k">Runtime Req</span>
            <span className="v mono">Python 3.11+</span>
          </div>
        </Card>

        <Card
          title="Rust SDK (polyester-sdk)"
          subtitle="Low-latency bots, high-reliability Tokio services"
          actions={<Pill kind="warn">Tokio Async</Pill>}
          footer={
            <div className="between" style={{ width: "100%" }}>
              <a href={DOC_URLS.rsOverview} target="_blank" rel="noreferrer">
                Rust Overview ↗
              </a>
              <a href={DOC_URLS.rsInstall} target="_blank" rel="noreferrer">
                Installation ↗
              </a>
              <a href={DOC_URLS.rsQuickstart} target="_blank" rel="noreferrer">
                Quickstart ↗
              </a>
            </div>
          }
        >
          <div className="kv">
            <span className="k">Cargo Crate</span>
            <span className="v mono">polyester-sdk = &quot;0.1.0-alpha.49&quot;</span>
          </div>
          <div className="kv">
            <span className="k">Rust Import Name</span>
            <span className="v mono">use polyester::Client;</span>
          </div>
          <div className="kv">
            <span className="k">Auth Mode</span>
            <span className="v">Ed25519 API Key (`ak_...`)</span>
          </div>
          <div className="kv">
            <span className="k">Compiler Req</span>
            <span className="v mono">Rust 1.88+ (MSRV)</span>
          </div>
        </Card>
      </div>

      {/* Interactive Code Generator */}
      <Card
        title={`Interactive SDK Code Generator · ${symbol}`}
        subtitle="Pick a language and parameters; the example updates as you type."
        actions={
          <div className="row-flex" style={{ gap: 8 }}>
            <div className="seg-group" role="group" aria-label="Select SDK language">
              <button
                type="button"
                className={`seg-btn ${lang === "typescript" ? "active" : ""}`}
                onClick={() => setLang("typescript")}
              >
                TypeScript
              </button>
              <button
                type="button"
                className={`seg-btn ${lang === "python" ? "active" : ""}`}
                onClick={() => setLang("python")}
              >
                Python
              </button>
              <button
                type="button"
                className={`seg-btn ${lang === "rust" ? "active" : ""}`}
                onClick={() => setLang("rust")}
              >
                Rust
              </button>
            </div>
            <CopyButton
              text={orderBlocked ? "" : generatedCode}
              label={orderBlocked ? "Fix inputs to copy" : "Copy Snippet"}
              size="md"
              disabled={orderBlocked}
            />
          </div>
        }
        footer={
          <>
            <span>
              Pair constraints for <strong>{symbol}</strong>:{" "}
              {pair
                ? `tickSize ${pair.tickSize} ${quote} · stepSize ${pair.stepSize} ${base} · minNotional ${pair.minNotionalQuote} ${quote}`
                : "select a listed pair to view exchange constraints"}
            </span>
            <Link to="/account/api">Need an Ed25519 keypair? Open API setup (/#/account/api) →</Link>
          </>
        }
      >
        {/* Step Selector + Parameter Controls */}
        <div className="between mb-3" style={{ gap: 10 }}>
          <div className="seg-group" role="group" aria-label="Quickstart step">
            <button
              type="button"
              className={`seg-btn ${step === "install" ? "active" : ""}`}
              onClick={() => setStep("install")}
            >
              1. Install Package
            </button>
            <button
              type="button"
              className={`seg-btn ${step === "market" ? "active" : ""}`}
              onClick={() => setStep("market")}
            >
              2. Read Market Data
            </button>
            <button
              type="button"
              className={`seg-btn ${step === "stream" ? "active" : ""}`}
              onClick={() => setStep("stream")}
            >
              3. Live WebSocket Stream
            </button>
            <button
              type="button"
              className={`seg-btn ${step === "trade" ? "active" : ""}`}
              onClick={() => setStep("trade")}
            >
              4. Place &amp; Cancel Order
            </button>
          </div>

          {step === "stream" && lang === "typescript" && (
            <div className="row-flex" style={{ gap: 6 }}>
              <span className="faint">Candle Timeframe:</span>
              <select
                className="select mono"
                style={{ width: "auto", padding: "4px 8px" }}
                value={streamTf}
                onChange={(e) => setStreamTf(e.target.value as CandleTimeframe)}
              >
                {CANDLE_TIMEFRAMES.map((tf) => (
                  <option key={tf} value={tf}>
                    {tf}
                  </option>
                ))}
              </select>
            </div>
          )}

          {step === "trade" && (
            <div className="row-flex" style={{ gap: 8 }}>
              <div className="seg-group" role="group" aria-label="Order side">
                <button
                  type="button"
                  className={`seg-btn ${orderSide === "buy" ? "active" : ""}`}
                  onClick={() => setOrderSide("buy")}
                >
                  ▲ Buy
                </button>
                <button
                  type="button"
                  className={`seg-btn ${orderSide === "sell" ? "active" : ""}`}
                  onClick={() => setOrderSide("sell")}
                >
                  ▼ Sell
                </button>
              </div>
              <input
                type="text"
                className="input mono"
                style={{ width: 95, padding: "4px 8px" }}
                value={orderQty}
                onChange={(e) => setOrderQty(e.target.value)}
                aria-label="Order quantity"
                aria-invalid={orderDraft.issues.some((i) => i.field === "qty") || undefined}
                aria-describedby={step === "trade" && orderBlocked ? "sdk-order-issues" : undefined}
                inputMode="decimal"
                placeholder="Qty"
              />
              <span className="faint mono">{base} @</span>
              <input
                type="text"
                className="input mono"
                style={{ width: 110, padding: "4px 8px" }}
                value={orderPrice}
                onChange={(e) => setOrderPrice(e.target.value)}
                aria-label="Order limit price"
                aria-invalid={orderDraft.issues.some((i) => i.field === "price") || undefined}
                aria-describedby={step === "trade" && orderBlocked ? "sdk-order-issues" : undefined}
                inputMode="decimal"
                placeholder="Price"
              />
              <span className="faint mono">{quote}</span>
              {isFinite(livePx) && livePx > 0 && (
                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={syncLivePriceToOrder}
                >
                  Use Live ({fmtNum(livePx)})
                </button>
              )}
              <input
                type="text"
                className="input mono"
                style={{ width: 170, padding: "4px 8px" }}
                value={keyIdInput}
                onChange={(e) => setKeyIdInput(e.target.value)}
                aria-label="API Key ID"
                placeholder="ak_..."
              />
            </div>
          )}
        </div>

        {orderBlocked ? (
          <div className="notice warn" role="alert" id="sdk-order-issues" aria-live="polite">
            <div>
              <strong>No snippet until this order is valid.</strong> A snippet is runnable code
              against testnet, so it is withheld while the order breaks this pair&apos;s rules
              ({symbol}). Nothing has been sent anywhere.
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {orderIssueText.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : (
          <pre
            className="mono"
            style={{
              margin: 0,
              padding: 16,
              background: "var(--bg-shell)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-sm)",
              overflowX: "auto",
              fontSize: 12.5,
              lineHeight: 1.58,
              color: "var(--text-primary)",
            }}
          >
            {generatedCode}
          </pre>
        )}
      </Card>

      {/* Interactive Ed25519 5-Field Canonical String & Query Normalizer */}
      <Card
        title="Interactive Ed25519 Canonical String & Query Normalizer"
        subtitle="Exactly how Polyester builds the 5-line UTF-8 signing payload for private requests."
        actions={
          <a
            className="btn sm ghost"
            href={DOC_URLS.ed25519}
            target="_blank"
            rel="noreferrer"
          >
            <span>Ed25519 Spec</span>
            <IconExternal size={12} />
          </a>
        }
        footer={
          <span>
            Required headers: <code className="mono">X-API-KEY-ID</code>,{" "}
            <code className="mono">X-API-TIMESTAMP</code> (within ±10s of server time),
            and <code className="mono">X-API-SIGNATURE</code> (64-byte Ed25519 signature in
            Base64 or 128-char hex).
          </span>
        }
      >
        {!canonicalValidation.ok && (
          <div className="notice warn mb-3" role="status" id="canon-issues">
            <div>
              <strong>These fields cannot be signed as entered.</strong> Nothing is sent from this
              page; the panel shows what a signature would cover.
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {canonicalValidation.issues.map((issue) => (
                  <li key={issue.field}>{issue.message}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <div className="grid cols-2">
          <div>
            <div className="grid cols-2">
              <div className="field">
                <label htmlFor="canon-method">HTTP Method</label>
                <select
                  id="canon-method"
                  className="select mono"
                  value={httpMethod}
                  onChange={(e) =>
                    setHttpMethod(e.target.value as "GET" | "POST" | "DELETE")
                  }
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST</option>
                  <option value="DELETE">DELETE</option>
                </select>
              </div>
              <div className="field">
                <label htmlFor="canon-ts">
                  <span>X-API-TIMESTAMP (ms)</span>
                  <button
                    type="button"
                    className="btn sm ghost"
                    style={{ padding: "1px 6px", fontSize: 10.5 }}
                    onClick={() => setSampleTs(String(Date.now()))}
                  >
                    Now
                  </button>
                </label>
                <input
                  id="canon-ts"
                  type="text"
                  className="input mono"
                  value={sampleTs}
                  onChange={(e) => setSampleTs(e.target.value)}
                  aria-invalid={
                    canonicalValidation.issues.some((issue) => issue.field === "timestamp") || undefined
                  }
                  aria-describedby={canonicalValidation.ok ? undefined : "canon-issues"}
                  inputMode="numeric"
                />
              </div>
            </div>

            <div className="field">
              <label htmlFor="canon-path">Request Path (excluding host &amp; query)</label>
              <input
                id="canon-path"
                type="text"
                className="input mono"
                value={reqPath}
                onChange={(e) => setReqPath(e.target.value)}
                aria-invalid={
                  canonicalValidation.issues.some((issue) => issue.field === "path") || undefined
                }
                aria-describedby={canonicalValidation.ok ? undefined : "canon-issues"}
              />
            </div>

            <div className="field">
              <label htmlFor="canon-query">
                <TermTip
                  label="Raw Query String (auto-sorted per RFC 3986)"
                  tip="Decoded, sorted by key then value, and RFC 3986 percent-encoded"
                />
              </label>
              <input
                id="canon-query"
                type="text"
                className="input mono"
                value={reqQuery}
                onChange={(e) => setReqQuery(e.target.value)}
                placeholder="e.g. tag=z&q=hello+world&tag=a"
                aria-invalid={
                  canonicalValidation.issues.some((issue) => issue.field === "query") || undefined
                }
                aria-describedby={canonicalValidation.ok ? undefined : "canon-issues"}
              />
            </div>

            {httpMethod !== "GET" && (
              <div className="field mb-0">
                <label htmlFor="canon-body">Request Body (exact serialized UTF-8 bytes)</label>
                <input
                  id="canon-body"
                  type="text"
                  className="input mono"
                  value={reqBody}
                  onChange={(e) => setReqBody(e.target.value)}
                  aria-invalid={
                    canonicalValidation.issues.some((issue) => issue.field === "body") || undefined
                  }
                  aria-describedby={canonicalValidation.ok ? undefined : "canon-issues"}
                />
              </div>
            )}
          </div>

          <div>
            <div className="between mb-2">
              <strong style={{ fontSize: 12 }}>
                Resulting 5-Line Canonical String (UTF-8, newline-separated):
              </strong>
              {canonicalString5Line && !canonicalError && (
                <CopyButton text={canonicalString5Line} label="Copy Canonical String" />
              )}
            </div>
            <pre
              className="mono"
              style={{
                margin: 0,
                padding: 12,
                background: "var(--bg-shell)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-sm)",
                overflowX: "auto",
                fontSize: 12,
                lineHeight: 1.6,
              }}
            >
              {canonicalError
                ? `Blocked: ${canonicalError}`
                : canonicalString5Line || "Calculating SHA-256…"}
            </pre>

            <div className="mt-3">
              <div className="kv">
                <span className="k">Line 1 · Timestamp (ms)</span>
                <span className="v mono">{sampleTs.trim()}</span>
              </div>
              <div className="kv">
                <span className="k">Line 2 · Uppercase Method</span>
                <span className="v mono">{httpMethod.toUpperCase()}</span>
              </div>
              <div className="kv">
                <span className="k">Line 3 · Request Path</span>
                <span className="v mono">{reqPath.trim() || "/"}</span>
              </div>
              <div className="kv">
                <span className="k">Line 4 · Canonical Query</span>
                <span className="v mono">
                  {canonicalError ? "Blocked" : canonicalQuery || "(empty string)"}
                </span>
              </div>
              <div className="kv">
                <span className="k">Line 5 · Body SHA-256 (hex)</span>
                <span className="v mono" style={{ fontSize: 11 }}>
                  {bodyHash
                    ? `${bodyHash.slice(0, 24)}…${bodyHash.slice(-12)}`
                    : "Unavailable — hashing required"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </Card>

      {/* SDK Capability Matrix & Transport Connectivity Matrix */}
      <div className="grid cols-2">
        <Card
          flush
          title="Official SDK Capability Matrix"
          subtitle="TypeScript, Python, Go, and Rust feature coverage"
          actions={
            <a
              className="btn sm ghost"
              href={DOC_URLS.matrix}
              target="_blank"
              rel="noreferrer"
            >
              <span>Full Matrix</span>
              <IconExternal size={12} />
            </a>
          }
        >
          <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
            <table className="data">
              <thead>
                <tr>
                  <th className="align-left">Capability</th>
                  <th>TypeScript</th>
                  <th>Python</th>
                  <th>Rust</th>
                  <th>Go</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { name: "Public Market Data (Overview, Book, Candles, Trades)", ts: true, py: true, rs: true, go: true },
                  { name: "Order Book Heatmap & Chain Analytics", ts: true, py: true, rs: true, go: true },
                  { name: "Ed25519 API-Key Authentication", ts: true, py: true, rs: true, go: true },
                  { name: "Spot Orders (Create, Cancel, Modify, Batch, Triggers)", ts: true, py: true, rs: true, go: true },
                  { name: "Realtime Market & Account WebSocket Streams", ts: true, py: true, rs: true, go: true },
                  { name: "Reference Catalogs & Scale Conversion", ts: true, py: true, rs: true, go: true },
                  { name: "Zipper Config, Deposits, Withdraws & Lifecycle Flows", ts: true, py: true, rs: true, go: true },
                  { name: "Browser Wallet Login & Interactive Session MFA", ts: true, py: false, rs: false, go: false },
                ].map((row) => (
                  <tr key={row.name}>
                    <td style={{ fontWeight: 500 }}>{row.name}</td>
                    <td>{row.ts ? <Pill kind="up">✓ Yes</Pill> : <Pill>Scope Out</Pill>}</td>
                    <td>{row.py ? <Pill kind="up">✓ Yes</Pill> : <Pill>TS Only</Pill>}</td>
                    <td>{row.rs ? <Pill kind="up">✓ Yes</Pill> : <Pill>TS Only</Pill>}</td>
                    <td>{row.go ? <Pill kind="up">✓ Yes</Pill> : <Pill>TS Only</Pill>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card
          flush
          title="Polyester Connectivity & Transport Matrix"
          subtitle="Pick a protocol by workload and latency"
          actions={
            <a
              className="btn sm ghost"
              href={DOC_URLS.connectivity}
              target="_blank"
              rel="noreferrer"
            >
              <span>Connectivity Docs</span>
              <IconExternal size={12} />
            </a>
          }
        >
          <div className="table-wrap" style={{ border: "none", borderRadius: 0 }}>
            <table className="data">
              <thead>
                <tr>
                  <th className="align-left">Interface</th>
                  <th className="align-left">Encoding</th>
                  <th className="align-left">Best For</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>ConnectRPC + WS Protobuf</strong>
                  </td>
                  <td className="align-left">
                    <Pill kind="accent">Protobuf / ProtoJSON</Pill>
                  </td>
                  <td className="align-left muted">
                    Official SDKs (TS, Python, Rust, Go) &amp; typed trading bots
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>REST + WebSocket JSON</strong>
                  </td>
                  <td className="align-left">
                    <Pill kind="up">JSON</Pill>
                  </td>
                  <td className="align-left muted">
                    Direct HTTP scripts, curl, and zero-codegen integrations
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>MCP Read-Only Server</strong>
                  </td>
                  <td className="align-left">
                    <Pill kind="info">JSON-RPC / SSE</Pill>
                  </td>
                  <td className="align-left muted">
                    PolyTools analytics terminal &amp; AI/agent read-only inspection
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>SBE WebSocket</strong>
                  </td>
                  <td className="align-left">
                    <Pill kind="warn">Binary SBE</Pill>
                  </td>
                  <td className="align-left muted">
                    Ultra-low-latency binary order entry &amp; execution
                  </td>
                </tr>
                <tr>
                  <td>
                    <strong>FIX Classic / FIX-SBE</strong>
                  </td>
                  <td className="align-left">
                    <Pill>FIX Tag-Value / SBE</Pill>
                  </td>
                  <td className="align-left muted">
                    Institutional order management systems &amp; FIX engines
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="card-footer">
            <span>
              Official Testnet Docs:{" "}
              <a href={NETWORKS.testnet.docsUrl} target="_blank" rel="noreferrer">
                {NETWORKS.testnet.docsUrl} ↗
              </a>
            </span>
          </div>
        </Card>
      </div>
    </div>
  );
}
