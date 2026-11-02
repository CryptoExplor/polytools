# Archive — historical documents

Everything in this folder is **historical**. These are the audits, session reports and plans written
while the project was called PolyTools (October 2026). They record evidence as it stood at specific
commits — old test counts, old heads, findings that have since been fixed — and are kept, with their
Git history, for traceability only.

**Do not cite them as the current state.** The maintained documents are in [`docs/`](../README.md);
where an archived document and a current one disagree, the current one wins.

| Archived | Superseded by |
|---|---|
| `audit/` (working-tree audit, roadmap, technical debt, UX, security & accounting, deployment hardening, cache pilot, phase 2/3 notes, PR #4 release audit) | [SECURITY.md](../SECURITY.md), [TESTING.md](../TESTING.md), [ARCHITECTURE.md](../ARCHITECTURE.md), [ROADMAP.md](../ROADMAP.md) |
| `frontend-audit/` (frontend simplification status and remaining work) | [TESTING.md §4](../TESTING.md#4-manual-browser-pass), [ROADMAP.md](../ROADMAP.md) |
| `wallet-first-audit/00–19` (wallet-first programme: SDK capabilities, parity, architecture, migration plan, risks, acceptance matrix, open questions, monetization, Rabby study, AI analyst, reconciliation, browser validation, run sheet, PR audit, origin gate, auth 403, Hyperliquid order model, connection & on-chain model) | [POLYESTER_PROTOCOL.md](../POLYESTER_PROTOCOL.md), [SECURITY.md](../SECURITY.md), [TESTING.md](../TESTING.md), [ROADMAP.md](../ROADMAP.md), [decisions/](../decisions/README.md) |
| `api-key-automation.md` | [POLYESTER_PROTOCOL.md §3–4](../POLYESTER_PROTOCOL.md#3-connection-modes) |
| `account-live-verification.md` | [TESTING.md §6](../TESTING.md#6-live-account-verification-owner-run) |
| `live-testnet-verification-report.md` | [TESTING.md §5](../TESTING.md#5-live-testnet-verification-headless-owner-run) |

Brand names, file paths, environment variable names (`POLYTOOLS_*`) and commands inside these files
are left exactly as written. Relative links between archived files may point at their old locations.
