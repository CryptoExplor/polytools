# Architecture decision records

Short records of decisions that shape Polyap and the reasons behind them. One file per decision,
numbered in order, never renumbered. To change a decision, add a new ADR that supersedes the old one
and update the old one's status line.

| ADR | Decision | Status |
|---|---|---|
| [0001](./0001-rename-to-polyap.md) | Rename PolyTools to Polyap; keep persisted identifiers | Accepted |
| [0002](./0002-wallet-connection-is-not-a-login.md) | A connected wallet is not a login | Accepted |
| [0003](./0003-read-only-first.md) | Read-only first; trading deferred | Accepted |
| [0004](./0004-testnet-only-private-reads.md) | Private account reads are testnet-only | Accepted |
| [0005](./0005-api-keys-in-passphrase-encrypted-vault.md) | API keys live in a passphrase-encrypted browser vault | Accepted |
| [0006](./0006-realtime-refines-polling.md) | Realtime streams refine polling, never replace it | Accepted |

Template:

```markdown
# NNNN — Title

- **Status:** Proposed | Accepted | Superseded by NNNN
- **Date:** YYYY-MM-DD

## Context
## Decision
## Consequences
```
