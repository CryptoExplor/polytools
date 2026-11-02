# Contributing

Thanks for helping make Polyap better! A few ground rules keep this project easy to host and easy
to trust.

## Principles

1. **Read-only until decided otherwise.** Nothing may place orders, cancel, transfer, withdraw, or
   change keys/policies ([ADR 0003](docs/decisions/0003-read-only-first.md)). Private features stay
   client-side; keys never leave the user's browser unencrypted.
2. **Static-friendly frontend.** `apps/web` must build to plain static files. Backend access goes
   through `/api/*` with the same handler everywhere.
3. **One handler, many adapters.** Server logic lives in `backend/src/`; platform code in
   `backend/adapters/*` stays thin.
4. **Shared logic in `packages/core`.** Wire formats, scaling rules, formatting — one
   implementation, imported everywhere as `@polyap/core`.
5. **No new runtime dependencies** without a strong reason. Charts and UI are hand-rolled on
   purpose, and `check:performance` enforces bundle budgets.
6. **Honest data.** Unknown, denied or partial data is labelled, never shown as zero.
7. **Don't rename persisted identifiers.** Values in `packages/core/src/persistedIdentifiers.ts` are
   stored in users' browsers and exports; changing one needs a tested migration
   ([ADR 0001](docs/decisions/0001-rename-to-polyap.md)).

## Dev setup

```bash
npm install
npm run dev        # http://localhost:5173 — full stack in one process
npm test           # synthetic tests
npm run typecheck
npm run build
```

Node ≥ 24. Before opening a PR, run the gates listed in [docs/TESTING.md](docs/TESTING.md).

## Adding a tool

1. If a new upstream capability is needed, add a typed wrapper in `packages/core/src/tools.ts` and a
   sample response in `docs/wire-samples/`.
2. Add a route in `backend/src/handler.ts` with a sensible cache TTL and a query allowlist.
3. Add a page in `apps/web/src/pages/`, register it in `App.tsx` and the `Layout.tsx` nav.
4. Update the feature table in `README.md`, and `docs/ARCHITECTURE.md` if the data path changes.

## Documentation conventions

- **Where things go.** Keep the maintained set small: `README.md` (what and how to start),
  `docs/ARCHITECTURE.md`, `docs/POLYESTER_PROTOCOL.md`, `docs/SECURITY.md`, `docs/TESTING.md`,
  `docs/DEPLOYMENT.md`, `docs/ROADMAP.md`. Update the existing document rather than adding a new
  one; if a genuinely new topic needs its own file, add it to `docs/README.md`.
- **Current facts only.** Docs describe the tree as it is. No session logs, old test counts, or
  "I tried…" narratives — put that in the PR description. Say plainly what is unverified.
- **Decisions get an ADR.** A choice that constrains future work (security boundary, protocol,
  persisted format, deployment shape) goes in `docs/decisions/NNNN-short-title.md` using the
  template in `docs/decisions/README.md`. Never renumber; supersede with a new ADR.
- **Changelog.** Add user- or operator-visible changes under `## [Unreleased]` in `CHANGELOG.md`
  (Keep a Changelog sections: Added, Changed, Deprecated, Removed, Fixed, Security).
- **Roadmap.** When you finish a roadmap item, remove it from `docs/ROADMAP.md` and record it in the
  changelog.
- **Archive, don't delete.** Superseded long-form reports move to `docs/archive/` with `git mv`
  and are listed in `docs/archive/README.md`. Archived files are not edited.
- `docs/wire-samples/` is test data — tests and the dev server read it by path; don't move it.

## Commit style

Short imperative subjects (`add heatmap page`, `fix price scaling for stables`). PRs welcome; open
an issue first for anything big.
