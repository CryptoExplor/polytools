# Contributing

Thanks for helping make Polyester tools better! A few ground rules keep this project
easy to host and easy to trust:

## Principles

1. **Read-only first.** Tools must never place orders or move funds. Private features
   (vault signing) stay client-side, keys never leave the user's browser.
2. **Static-friendly frontend.** Everything in `apps/web` must build to plain static
   files deployable to GitHub Pages. No server-only assumptions — backend access goes
   through `/api/*` with the same handler everywhere.
3. **One handler, many adapters.** Server logic lives in `backend/src/handler.ts` only;
   platform code belongs in `backend/adapters/*` and must stay thin.
4. **Shared logic in `packages/core`.** Wire formats, scaling rules, formatting — one
   implementation, imported everywhere. If Polyester changes a payload, we fix one file.
5. **No new runtime dependencies** without a strong reason. Charts and UI are hand-rolled
   on purpose (bundle is ~71 KB gz).

## Dev setup

```bash
npm install
npm run dev        # http://localhost:5173 — full-stack in one process
npm run build      # typecheck + production build
```

## Adding a tool

1. If a new upstream capability is needed, add a typed wrapper in
   `packages/core/src/tools.ts` and a sample response in `docs/wire-samples/`.
2. Add a route in `backend/src/handler.ts` with a sensible cache TTL.
3. Add a page in `apps/web/src/pages/`, register it in `App.tsx` + `Layout.tsx` nav.
4. Update the tool table in `README.md`.

## Commit style

Short imperative subjects (`add heatmap page`, `fix price scaling for stables`).
PRs welcome; open an issue first for anything big.
