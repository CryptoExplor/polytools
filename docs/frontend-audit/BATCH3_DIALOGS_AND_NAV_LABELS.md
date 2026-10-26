# Batch 3 — one dialog contract, glossary discoverability, phone-width account tabs

Implements **P1-7**, **P1-11**, and **P1-12** from `FRONTEND_ROADMAP.md`.

**Evidence level:** Confirmed in source (quoted below) · Verified by automated tests · **Not browser-tested**.

---

## 1. P1-7 — one focus contract for every overlay

### The defect

`ConfirmDialog` and `GlossaryDrawer` both declared `aria-modal="true"` but neither trapped focus, restored it, or locked the page behind them. `OrderDetailsDrawer` had a correct implementation written inline. Two consequences: keyboard and screen-reader users could tab straight out of a "modal" into the page underneath, and focus ended up wherever the browser left it on close — often at the top of the document.

`ConfirmDialog` also hard-coded `id="confirm-dialog-title"`, so two confirmations in one render produced duplicate ids and each dialog's `aria-labelledby` could resolve to the wrong heading.

### The change

| File | Change |
|---|---|
| `apps/web/src/lib/dialogFocus.ts` | **New.** `useDialogFocus(open, onClose, { initialFocus })`: moves focus in (`initialFocus` ref → `[data-autofocus]` → first focusable → the dialog itself), cycles Tab/Shift+Tab inside, closes on Escape, restores focus to the opener on unmount, and locks body scroll. |
| `components/ui.tsx` | `ConfirmDialog` uses the hook; the title id comes from `useId()`; the dialog is focusable (`tabIndex={-1}`) as a last resort; the cancel action is marked `data-autofocus`, so the safe choice is still the first stop. The old Escape-only effect is gone. |
| `components/Glossary.tsx` | Same hook, `useId()` title, search field marked `data-autofocus` (replacing `autoFocus`). |
| `components/AccountAnalytics.tsx` | `OrderDetailsDrawer`'s 33-line inline effect replaced by one hook call with `initialFocus: closeRef`. Behaviour is unchanged. |

### Stacking

Overlays stack in this app — a confirmation can open from inside the order drawer. The hook keeps a module-level stack and a reference-counted scroll lock:

- only the topmost dialog answers Tab and Escape, so the one underneath cannot yank focus back;
- closing an inner dialog cannot unlock page scroll while an outer one is still open;
- focus is only returned to an opener that is still in the document (`isConnected`).

## 2. P1-11 — glossary discoverability

The glossary button hid its label behind `hide-sm`, leaving a bare info icon on phones. It now keeps `<span>Glossary</span>` at every width and carries `aria-label="Open the plain-English glossary"`.

## 3. P1-12 — account tabs that fit a phone

| Before | After |
|---|---|
| Overview · API setup · Your Trades · Orders · Profit and Loss · Money Movements | Overview · Key setup · Trades · Orders · P&L · Deposits |

Routes are unchanged, and the page headings keep the full names (`Money Movements`, `Profit and Loss`, `API setup`), so nothing is lost — the strip just fits. The active tab is now scrolled into view on section change (`scrollIntoView({ block: "nearest", inline: "nearest" })`) and carries `aria-current="page"`.

Whether all six actually fit at 390 px is a browser fact; the labels are short enough that it is a reasonable expectation, not a claim.

## 4. Verification

| Check | Result |
|---|---|
| `npm test` | **253 / 253**, 57 suites (was 241/55) |
| `npm run typecheck` | pass (web + backend) |
| `npm run build` | pass — 599.67 kB JS / 179.19 kB gzip |
| `npm run check:performance` | pass — JS 600,315 B ≤ 625,000 · gzip 178,836 B ≤ 185,000 · CSS 34,107 B ≤ 40,000 · CSS gzip 6,990 B ≤ 10,000 |
| `npm run check:whitespace` | pass — 179/179 files |
| `npm run check:runtime` | pass (crypto features present in this runtime) |
| `npm run check:dependencies` | pass — 0 missing licence metadata, 0 workspace version mismatches |
| `npm run check:external` | pass — 0 SDK source-pin mismatches |

New file `tests/dialog-focus.test.mjs` (12 assertions): all three overlays use the shared hook, no overlay hand-rolls a Tab loop, the hard-coded ids are gone, two simultaneous dialogs get distinct `aria-labelledby` targets, the confirm dialog keeps `role`/`aria-modal`/safe initial focus, a closed dialog renders nothing, the glossary drawer is labelled and its search field takes focus first, the glossary label is not hidden at small widths, the tab label set matches the approved short list, and the active tab is scrolled into view with `aria-current`.

**Bundle:** 178,836 B gzip against the 185,000 B ceiling — about **6.3 kB** left. Unchanged from batch 2 in practice, but the ceiling is now close enough that the next feature should consider code splitting (P2) first.

## 5. Browser checks still required

1. **Confirm dialog, 1280 px.** Open *Delete all keys* in API setup: Tab cycles Cancel → Delete → Cancel, Shift+Tab mirrors it, Escape closes, focus returns to the button that opened it, and the page behind does not scroll.
2. **Glossary at 390 px.** The button shows the word "Glossary" next to the icon; opening it focuses the search field; Tab stays inside; Escape returns focus to the button; the route does not change.
3. **Stacked overlays.** From inside the order-details drawer, trigger a confirmation: Tab must move within the confirmation only, Escape must close only the confirmation, and closing it must leave the drawer open, scroll still locked, and focus back on the triggering button.
4. **Account tabs at 390 px.** Count the visible tabs (expect six with the short labels), confirm the active one is scrolled into view after navigating between sections, and check that `aria-current` is announced.
5. **Regression sweep.** The account export dialog and the "Forget all" flow must still complete (they use `ConfirmDialog`).

## 6. Still deferred — needs an owner decision

- **P1-1 navigation restructuring.** Changes the information architecture and every visible nav label; the roadmap's own "Deliberately excluded" list keeps it out until the owner signs off.
- **P1-6 account notice consolidation.** Risks weakening security warnings; the guardrail against that is explicit, so it needs the owner's wording.
- **P1-8 warn-before-leaving account work.** Touches the account disposal path; needs a decision on what counts as "work to lose".
- **P1-10 Money Movements switch.** Small, but it changes a deep-link contract (`?scope=public`) that a previous fix depends on.
- **P1-13 contrast tokens.** Needs sign-off on new colour values; measured ratios are in `DESIGN_SYSTEM_AUDIT.md`.
