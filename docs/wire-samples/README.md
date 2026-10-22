# Wire samples

Real response payloads captured from the Polyester read-only testnet endpoints
(via the public MCP tools) on 2026-10-22. Use them to:

- understand exact field names and formats without calling the API
- build test fixtures / mocks for new tools
- verify the scaled-integer rules (`packages/core/src/normalize.ts`)

## Formatting rules verified from these samples

| Field kind | Examples in samples | Rule |
|---|---|---|
| Prices (`lastPrice`, `bestBid/Ask`, `high/low24h`, candle OHLC, book `price`, trade `price`, `indexPrice`) | `"82132470"` → 82,132.47 | decode `raw ÷ 10³` |
| Quantities (`qty`, `bestBidQty`, candle `volume`, `volume24h*`) | `"0.13424745"` | plain decimal, use as-is |
| IDs (`matchId`, `bookSeq`, `symbolId`, `listedTsMs`) | `"281474977221704"` | treat as opaque strings |
| `apiEnv` | `"testnet"` | authoritative environment label — drives the UI badge |
| `nextPageToken` | base64 blob or null | opaque cursor; replay exactly, never parse |

Files map 1:1 to MCP tools (see `packages/core/src/config.ts → TOOL`).
