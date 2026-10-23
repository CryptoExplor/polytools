/**
 * Searchable Beginner Glossary Drawer (UX-02 / FEAT-09).
 * Explains all 17 exchange & Polyester testnet terms in plain language.
 */

import { useEffect, useMemo, useState } from "react";
import { IconSearch, IconX } from "./icons";

export interface GlossaryEntry {
  term: string;
  category: "Market Basics" | "Order Book & Tape" | "Zipper & Testnet" | "Security & Keys";
  definition: string;
}

export const GLOSSARY_TERMS: GlossaryEntry[] = [
  {
    term: "Testnet",
    category: "Zipper & Testnet",
    definition:
      "A practice version of Polyester where tokens have no real-world value and balances may be reset.",
  },
  {
    term: "Read-only",
    category: "Security & Keys",
    definition:
      "This site can only read public market and bridge data. It cannot log in, place orders, or move tokens.",
  },
  {
    term: "Pair / Symbol",
    category: "Market Basics",
    definition:
      "Two assets traded against each other, written BASE-QUOTE (e.g., BTC-USDT means 1 BTC priced in USDT).",
  },
  {
    term: "Bid",
    category: "Order Book & Tape",
    definition:
      "The highest price a buyer is currently willing to pay on the order book.",
  },
  {
    term: "Ask",
    category: "Order Book & Tape",
    definition:
      "The lowest price a seller is currently willing to accept on the order book.",
  },
  {
    term: "Mid price",
    category: "Market Basics",
    definition:
      "Halfway between the best bid and best ask: (bestBid + bestAsk) ÷ 2.",
  },
  {
    term: "Spread",
    category: "Market Basics",
    definition:
      "The gap between the best ask and best bid (bestAsk − bestBid). Tighter spreads mean cheaper immediate execution.",
  },
  {
    term: "bps (basis points)",
    category: "Market Basics",
    definition:
      "One hundredth of a percent: 1 bps = 0.01%, 10 bps = 0.10%, 100 bps = 1.00%.",
  },
  {
    term: "Order book (L2)",
    category: "Order Book & Tape",
    definition:
      "A sorted list of resting buy and sell limit orders grouped by price level.",
  },
  {
    term: "Wall",
    category: "Order Book & Tape",
    definition:
      "A single price level with much more resting size than nearby levels (a statistical size outlier, not a confirmed single whale).",
  },
  {
    term: "Imbalance",
    category: "Order Book & Tape",
    definition:
      "Whether visible bids or asks have more total quantity in the displayed depth window. Not a price prediction.",
  },
  {
    term: "VWAP (session)",
    category: "Order Book & Tape",
    definition:
      "Average trade price weighted by trade size across trades observed in this browser tab session.",
  },
  {
    term: "Tick size / Step size",
    category: "Market Basics",
    definition:
      "The smallest allowed price increment (tick size) and smallest allowed quantity increment (step size) for a pair.",
  },
  {
    term: "Zipper",
    category: "Zipper & Testnet",
    definition:
      "Polyester's cross-chain deposit and withdrawal routing system connecting external chains to the exchange.",
  },
  {
    term: "Confirmations",
    category: "Zipper & Testnet",
    definition:
      "How many blocks an external blockchain must finalize before a deposit is credited.",
  },
  {
    term: "Flow ID / Tx hash",
    category: "Zipper & Testnet",
    definition:
      "Public identifiers used to look up a deposit or withdrawal lifecycle across source and destination chains.",
  },
  {
    term: "Ed25519 keypair",
    category: "Security & Keys",
    definition:
      "A public/private cryptographic signing key pair used by advanced API scripts. Beginners do not need it.",
  },
];

export function GlossaryDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GLOSSARY_TERMS;
    return GLOSSARY_TERMS.filter(
      (item) =>
        item.term.toLowerCase().includes(q) ||
        item.definition.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q),
    );
  }, [query]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <aside
        className="glossary-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="glossary-drawer-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="between" style={{ paddingBottom: 12, borderBottom: "1px solid var(--border-subtle)" }}>
          <div>
            <h3 id="glossary-drawer-title" style={{ margin: 0, fontSize: 16 }}>
              Plain-English Definitions
            </h3>
            <p className="faint" style={{ margin: "2px 0 0", fontSize: 12 }}>
              17 key market, order book, Zipper bridge, and API terms explained for newcomers.
            </p>
          </div>
          <button
            type="button"
            className="btn sm ghost icon-btn"
            onClick={onClose}
            aria-label="Close definitions drawer"
          >
            <IconX size={16} />
          </button>
        </div>

        <div className="search-wrap mt-3" style={{ maxWidth: "100%" }}>
          <IconSearch size={14} />
          <input
            type="search"
            className="input search-input"
            placeholder="Filter terms (e.g. bps, spread, wall, Zipper, Ed25519)…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Filter glossary terms"
            autoFocus
          />
        </div>

        <div className="glossary-list mt-3">
          {filtered.map((item) => (
            <div key={item.term} className="glossary-item">
              <div className="between">
                <strong style={{ color: "var(--text-primary)", fontSize: 13 }}>
                  {item.term}
                </strong>
                <span className="pill" style={{ fontSize: 10 }}>
                  {item.category}
                </span>
              </div>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: 12.5, lineHeight: 1.5 }}>
                {item.definition}
              </p>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="faint" style={{ textAlign: "center", padding: "24px 0" }}>
              No glossary terms match "{query}".
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
