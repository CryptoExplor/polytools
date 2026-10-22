import { useMemo, type ReactNode } from "react";
import { useApp } from "../lib/store";

/* ---------- primitives ---------- */

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="card">
      {(title || actions) && (
        <div className="row-flex mb-2" style={{ justifyContent: "space-between" }}>
          {title ? <h3 className="mb-0">{title}</h3> : <span />}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}

export function Stat({ label, value, sub, trend }: { label: string; value: ReactNode; sub?: ReactNode; trend?: "up" | "down" | "flat" }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className={`value ${trend ?? ""}`}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Pill({ kind, children, title }: { kind?: "up" | "down" | "accent" | "warn"; children: ReactNode; title?: string }) {
  return <span className={`pill ${kind ?? ""}`} title={title}>{children}</span>;
}

export function ErrorBox({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="notice mb-3">⚠ {error} — retrying automatically.</div>;
}

export function Loading({ lines = 5 }: { lines?: number }) {
  return (
    <div className="grid" style={{ gap: 10 }}>
      {Array.from({ length: lines }).map((_, i) => (
        <div className="skeleton" key={i} style={{ width: `${92 - i * 9}%` }} />
      ))}
    </div>
  );
}

/* ---------- symbol visuals ---------- */

const PALETTE = ["#7c5cff", "#22a5c5", "#c55a22", "#22c58b", "#c5225a", "#a5c522", "#5a22c5", "#c5a522", "#22c5a5", "#8b22c5"];

export function assetColor(asset: string): string {
  let h = 0;
  for (let i = 0; i < asset.length; i++) h = (h * 31 + asset.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function SymBadge({ asset }: { asset: string }) {
  return (
    <span className="sym-badge" style={{ background: assetColor(asset) }}>
      {asset.slice(0, 3)}
    </span>
  );
}

/* ---------- symbol select ---------- */

export function SymbolSelect({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  const { symbols } = useApp();
  return (
    <select className="select" style={{ width: "auto" }} value={value} onChange={(e) => onChange(e.target.value)}>
      {!symbols.length && <option>{value}</option>}
      {symbols.map((s) => (
        <option key={s} value={s}>{s}</option>
      ))}
    </select>
  );
}

/* ---------- sparkline (dependency-free SVG) ---------- */

export function Sparkline({ data, width = 120, height = 32, stroke = "var(--accent)" }: { data: number[]; width?: number; height?: number; stroke?: string }) {
  const path = useMemo(() => {
    if (data.length < 2) return "";
    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;
    const stepX = width / (data.length - 1);
    return data
      .map((v, i) => `${i === 0 ? "M" : "L"}${(i * stepX).toFixed(1)},${(height - 3 - ((v - min) / span) * (height - 6)).toFixed(1)}`)
      .join(" ");
  }, [data, width, height]);
  if (!path) return <svg width={width} height={height} />;
  const up = data[data.length - 1] >= data[0];
  return (
    <svg width={width} height={height} aria-hidden>
      <path d={path} fill="none" stroke={stroke === "var(--accent)" ? (up ? "var(--up)" : "var(--down)") : stroke} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

/* ---------- generic JSON viewer (lifecycle payloads) ---------- */

export function JsonView({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) return <span className="faint">null</span>;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return <span className="mono" style={{ color: depth === 0 ? "var(--text)" : "#9fe8c8" }}>{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (!value.length) return <span className="faint">[]</span>;
    return (
      <div style={{ marginLeft: depth ? 14 : 0 }}>
        {value.map((v, i) => (
          <div key={i} className="kv">
            <span className="k">[{i}]</span>
            <span className="v"><JsonView value={v} depth={depth + 1} /></span>
          </div>
        ))}
      </div>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  return (
    <div style={{ marginLeft: depth ? 14 : 0 }}>
      {entries.map(([k, v]) => (
        <div key={k} className="kv">
          <span className="k">{k}</span>
          <span className="v" style={{ maxWidth: "70%" }}><JsonView value={v} depth={depth + 1} /></span>
        </div>
      ))}
    </div>
  );
}

/* ---------- countdown (testnet daily claim) ---------- */

export function Countdown({ to, label }: { to: number; label: string }) {
  const ms = Math.max(0, to - Date.now());
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    <div>
      <div className="faint mb-2">{label}</div>
      <div className="mono" style={{ fontSize: 34, fontWeight: 700, letterSpacing: 2 }}>
        {pad(h)}:{pad(m)}:{pad(s)}
      </div>
    </div>
  );
}
