# 0004 — Private account reads are testnet-only

- **Status:** Accepted
- **Date:** 2026-10-25 (recorded 2026-11-02)

## Context

The Polyester SDK ships devnet and testnet environments only; there is no published mainnet
endpoint, chain, or contract set. Signed account reads depend on an exact origin, signing contract,
and permission model that have only been exercised on testnet.

## Decision

- The account REST client accepts only `https://api.testnet.polyester.com` and refuses any other
  base URL.
- Public market data may point at a mainnet MCP endpoint via `MCP_URL_MAINNET` once one is
  announced; that does not change the private path.
- Product copy says "testnet" wherever it applies.

## Consequences

- Enabling mainnet private reads needs an official endpoint plus separately verified signing and
  permissions, and a new ADR.
- No realizable revenue or real-money claim is possible until mainnet exists.
