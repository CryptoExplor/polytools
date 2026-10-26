import { useEffect, useRef, type MutableRefObject, type RefObject } from "react";

/**
 * Overlays can stack (a confirmation opened from inside the order drawer).
 * Only the topmost one may answer Tab/Escape, and the body scroll lock is
 * reference-counted so closing the inner overlay cannot unlock the page while
 * the outer one is still open.
 */
const dialogStack: symbol[] = [];
let scrollLocks = 0;
let savedOverflow = "";

function lockScroll() {
  if (scrollLocks === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  scrollLocks += 1;
}

function unlockScroll() {
  scrollLocks = Math.max(0, scrollLocks - 1);
  if (scrollLocks === 0) document.body.style.overflow = savedOverflow;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/**
 * Shared modal behaviour for every overlay in the app.
 *
 * One implementation of the four things a dialog owes the user: focus starts
 * inside it, Tab cycles within it, Escape closes it, and focus returns to
 * whatever opened it. The page behind the overlay keeps its scroll locked while
 * it is open, which is what `aria-modal="true"` promises.
 *
 * The hook only runs its effects in a browser. Server rendering still produces
 * the markup, so the dialog is not hidden from tests or crawlers.
 */
export function useDialogFocus<T extends HTMLElement>(
  open: boolean,
  onClose: () => void,
  options: { initialFocus?: RefObject<HTMLElement | null>; restoreFocus?: boolean } = {},
): MutableRefObject<T | null> {
  const containerRef = useRef<T | null>(null);
  // Keep the latest callback without re-running the effect on every render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const initialFocusRef = useRef(options.initialFocus);
  initialFocusRef.current = options.initialFocus;
  const restoreFocus = options.restoreFocus !== false;

  useEffect(() => {
    if (!open) return;
    const node = containerRef.current;
    if (!node) return;

    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const token = Symbol("dialog");
    dialogStack.push(token);
    const isTopmost = () => dialogStack[dialogStack.length - 1] === token;
    lockScroll();

    const focusables = () =>
      [...node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
        (element) =>
          element.getAttribute("aria-hidden") !== "true" &&
          element.getClientRects().length > 0,
      );

    const preferred =
      initialFocusRef.current?.current ??
      node.querySelector<HTMLElement>("[data-autofocus]") ??
      focusables()[0] ??
      node;
    preferred.focus();

    const onKey = (event: KeyboardEvent) => {
      // A stacked overlay owns the keyboard; the one underneath stays inert.
      if (!isTopmost()) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (!node.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      const index = dialogStack.lastIndexOf(token);
      if (index >= 0) dialogStack.splice(index, 1);
      unlockScroll();
      if (restoreFocus && previous?.isConnected) previous.focus();
    };
  }, [open, restoreFocus]);

  return containerRef;
}
