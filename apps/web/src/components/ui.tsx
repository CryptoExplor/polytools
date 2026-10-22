import { useEffect, useMemo, useState, type ReactNode } from "react";
import { fmtAgo, splitSymbol } from "@poly/core";
import { useApp } from "../lib/store";
import { useNow } from "../lib/hooks";
import {
  IconAlert,
  IconCheck,
  IconCopy,
  IconInfo,
  IconPause,
  IconPlay,
  IconRefresh,
} from "./icons";

/* ---------- Page Header ---------- */

export function PageHeader({
  title,
  subtitle,
  badge,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div className="page-header-info">
        <h2>
          {title}
          {badge}
        </h2>
        {subtitle && <p className="page-header-desc">{subtitle}</p>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </div>
  );
}

/* ---------- High-Density Terminal Metric Strip ---------- */

export function MetricStrip({ children }: { children: ReactNode }) {
  return <div className="metric-strip">{children}</div>;
}

export function MetricCell({
  label,
  value,
  sub,
  trend,
  tooltip,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  trend?: "up" | "down" | "flat" | "warn";
  tooltip?: string;
}) {
  return (
    <div className="metric-cell" title={tooltip}>
      <div className="metric-label">{label}</div>
      <div className={`metric-value ${trend ?? ""}`}>{value}</div>
      {sub !== undefined && sub !== null && <div className="metric-sub">{sub}</div>}
    </div>
  );
}

/* ---------- Cards & Panels ---------- */

export function Card({
  title,
  subtitle,
  children,
  actions,
  flush,
  footer,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  flush?: boolean;
  footer?: ReactNode;
}) {
  return (
    <section className={`panel ${flush ? "panel-flush" : ""}`}>
      {(title || actions || subtitle) && (
        <div className="panel-header">
          <div className="panel-title-wrap">
            {title && <h3 className="panel-title">{title}</h3>}
            {subtitle && <span className="panel-subtitle">{subtitle}</span>}
          </div>
          {actions && <div className="row-flex">{actions}</div>}
        </div>
      )}
      {children}
      {footer && <div className="panel-footer">{footer}</div>}
    </section>
  );
}

export function Stat({
  label,
  value,
  sub,
  trend,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  trend?: "up" | "down" | "flat" | "warn";
}) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className={`value ${trend ?? ""}`}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Pill({
  kind,
  children,
  title,
  liveDot,
}: {
  kind?: "up" | "down" | "accent" | "warn" | "info";
  children: ReactNode;
  title?: string;
  liveDot?: boolean;
}) {
  return (
    <span className={`pill ${kind ?? ""}`} title={title}>
      {liveDot && <span className="dot live" />}
      {children}
    </span>
  );
}

/* ---------- Data Freshness & Poll Controls ---------- */

export function DataFreshness({
  updatedAt,
  refreshing,
  error,
  intervalSec,
  paused,
  onTogglePause,
  onRefresh,
}: {
  updatedAt: number | null;
  refreshing?: boolean;
  error?: string | null;
  intervalSec?: number;
  paused?: boolean;
  onTogglePause?: () => void;
  onRefresh?: () => void;
}) {
  const now = useNow(1000);
  const ageMs = updatedAt ? Math.max(0, now - updatedAt) : null;
  const staleThresholdMs = (intervalSec ?? 5) * 3500;
  const isStale = ageMs !== null && ageMs > staleThresholdMs;

  return (
    <div className="row-flex" style={{ gap: 6 }}>
      <span
        className={`pill ${
          error
            ? "warn"
            : paused
              ? ""
              : updatedAt
                ? isStale
                  ? "warn"
                  : "up"
                : ""
        }`}
        title={
          updatedAt
            ? `Last successful update: ${new Date(updatedAt).toISOString()}${
                intervalSec ? ` · Polling every ${intervalSec}s` : ""
              }`
            : "Waiting for initial response"
        }
      >
        <span className={`dot ${!paused && !error && updatedAt ? "live" : ""}`} />
        {paused
          ? "Paused"
          : refreshing && !updatedAt
            ? "Syncing…"
            : updatedAt
              ? `Updated ${fmtAgo(updatedAt, now)}`
              : "No data yet"}
      </span>
      {onTogglePause && (
        <button
          type="button"
          className="btn sm ghost icon-btn"
          onClick={onTogglePause}
          title={paused ? "Resume live polling" : "Pause live polling"}
          aria-label={paused ? "Resume live polling" : "Pause live polling"}
        >
          {paused ? <IconPlay size={13} /> : <IconPause size={13} />}
        </button>
      )}
      {onRefresh && (
        <button
          type="button"
          className="btn sm ghost"
          onClick={onRefresh}
          disabled={refreshing}
          title="Refresh now"
          aria-label="Refresh data now"
        >
          <IconRefresh size={13} />
          <span>{refreshing ? "Syncing" : "Refresh"}</span>
        </button>
      )}
    </div>
  );
}

/* ---------- Error, Empty, Loading States ---------- */

export function ErrorBox({
  error,
  onRetry,
  hasStaleData,
}: {
  error: string | null;
  onRetry?: () => void;
  hasStaleData?: boolean;
}) {
  if (!error) return null;
  return (
    <div className="notice error" role="alert">
      <div className="row-flex" style={{ gap: 10 }}>
        <IconAlert size={16} style={{ color: "var(--down)", flexShrink: 0 }} />
        <div>
          <div>
            <strong>Upstream request failed:</strong> {error}{" "}
          </div>
          <div className="faint" style={{ marginTop: 2 }}>
            {hasStaleData
              ? "Showing last known data snapshot while automatic background retry continues."
              : "Automatic polling remains active and will recover as soon as the endpoint responds."}
          </div>
        </div>
      </div>
      {onRetry && (
        <button type="button" className="btn sm" onClick={onRetry}>
          <IconRefresh size={13} /> Retry now
        </button>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon ?? <IconInfo size={18} />}</div>
      <h4>{title}</h4>
      {description && <p>{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Loading({ lines = 5 }: { lines?: number }) {
  return (
    <div className="grid" style={{ gap: 10, padding: "8px 0" }} aria-busy="true" aria-label="Loading data">
      {Array.from({ length: lines }).map((_, i) => (
        <div className="skeleton" key={i} style={{ width: `${94 - (i % 5) * 8}%` }} />
      ))}
    </div>
  );
}

/* ---------- Technical Term Tooltip ---------- */

export function TermTip({ label, tip }: { label: ReactNode; tip: string }) {
  return (
    <span className="term-tip" title={tip} tabIndex={0} aria-label={`${typeof label === "string" ? label : ""} (${tip})`}>
      {label}
    </span>
  );
}

/* ---------- Copy Button ---------- */

export function CopyButton({
  text,
  label = "Copy",
  copiedLabel = "Copied",
  size = "sm",
}: {
  text: string;
  label?: string;
  copiedLabel?: string;
  size?: "sm" | "md";
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* ignore clipboard error */
    }
  };

  return (
    <button
      type="button"
      className={`btn ${size === "sm" ? "sm" : ""} ${copied ? "primary" : "ghost"}`}
      onClick={(e) => void handleCopy(e)}
      aria-label={`Copy ${label}`}
    >
      {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
      <span>{copied ? copiedLabel : label}</span>
    </button>
  );
}

/* ---------- Accessible Confirmation Modal ---------- */

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = true,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={onCancel} role="presentation">
      <div
        className="modal-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="confirm-dialog-title">{title}</h3>
        <div>{typeof message === "string" ? <p>{message}</p> : message}</div>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel} autoFocus>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`btn ${danger ? "danger" : "primary"}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Symbol Visuals & Selector ---------- */

const PALETTE = [
  "#5e6ad2",
  "#0ea5e9",
  "#d97706",
  "#10b981",
  "#e11d48",
  "#7c3aed",
  "#0d9488",
  "#ea580c",
  "#2563eb",
  "#9333ea",
];

export function assetColor(asset: string): string {
  let h = 0;
  for (let i = 0; i < asset.length; i++) h = (h * 31 + asset.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function SymBadge({ asset }: { asset: string }) {
  return (
    <span className="sym-badge" style={{ background: assetColor(asset) }} aria-hidden="true">
      {asset.slice(0, 3)}
    </span>
  );
}

const FALLBACK_SYMBOLS = [
  "BTC-USDT",
  "ETH-USDT",
  "SOL-USDT",
  "HYPE-USDT",
  "XRP-USDT",
  "BNB-USDT",
  "DOGE-USDT",
  "AVAX-USDT",
  "LTC-USDT",
  "BCH-USDT",
  "POL-USDT",
  "TRX-USDT",
  "ETC-USDT",
  "USDC-USDT",
  "ETH-USDC",
  "SOL-USDC",
  "ETH-BTC",
  "XRP-BTC",
];

export function SymbolSelect({
  value,
  onChange,
  ariaLabel = "Select market pair",
}: {
  value: string;
  onChange: (s: string) => void;
  ariaLabel?: string;
}) {
  const { symbols, pairBySymbol } = useApp();
  const options = symbols.length ? symbols : FALLBACK_SYMBOLS;
  const pair = pairBySymbol.get(value);
  const [base] = splitSymbol(value);

  return (
    <div className="row-flex" style={{ gap: 6 }}>
      <SymBadge asset={base} />
      <select
        className="select mono"
        style={{ width: "auto", fontWeight: 600, paddingRight: 28 }}
        value={value}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
      >
        {!options.includes(value) && <option value={value}>{value}</option>}
        {options.map((s) => {
          const p = pairBySymbol.get(s);
          const disabled = p && p.status !== "enabled";
          return (
            <option key={s} value={s}>
              {s}
              {disabled ? ` (${p.status})` : ""}
            </option>
          );
        })}
      </select>
      {pair && (
        <span
          className="faint mono hide-sm"
          title={`Tick size: ${pair.tickSize} · Step size: ${pair.stepSize} · Min notional: ${pair.minNotionalQuote} ${pair.quoteAsset}`}
        >
          tick {pair.tickSize}
        </span>
      )}
    </div>
  );
}

/* ---------- Sparkline (Dependency-free SVG) ---------- */

export function Sparkline({
  data,
  width = 110,
  height = 28,
  stroke = "var(--accent)",
}: {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
}) {
  const geom = useMemo(() => {
    if (data.length < 2) return null;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const span = max - min || 1;
    const stepX = width / (data.length - 1);
    const pts = data.map((v, i) => ({
      x: i * stepX,
      y: height - 4 - ((v - min) / span) * (height - 8),
    }));
    const line = pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(" ");
    const area = `${line} L${width.toFixed(1)},${height} L0,${height} Z`;
    const up = data[data.length - 1] >= data[0];
    const last = pts[pts.length - 1];
    return { line, area, up, last };
  }, [data, width, height]);

  if (!geom) {
    return (
      <span className="faint mono" style={{ fontSize: 11 }} title="Collecting session ticks">
        1 tick
      </span>
    );
  }

  const color = stroke === "var(--accent)" ? (geom.up ? "var(--up)" : "var(--down)") : stroke;
  const fill =
    stroke === "var(--accent)"
      ? geom.up
        ? "var(--up-soft)"
        : "var(--down-soft)"
      : "var(--accent-soft)";

  return (
    <svg width={width} height={height} aria-hidden="true" style={{ display: "inline-block", verticalAlign: "middle" }}>
      <path d={geom.area} fill={fill} />
      <path d={geom.line} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={geom.last.x} cy={geom.last.y} r="2" fill={color} />
    </svg>
  );
}

/* ---------- Interactive JSON Inspector (Lifecycle Payloads) ---------- */

export function JsonView({ value, depth = 0 }: { value: unknown; depth?: number }) {
  if (value === null || value === undefined) return <span className="faint mono">null</span>;
  if (typeof value === "boolean") {
    return <span className="mono" style={{ color: "var(--warn)" }}>{String(value)}</span>;
  }
  if (typeof value === "number") {
    return <span className="mono" style={{ color: "var(--info)" }}>{String(value)}</span>;
  }
  if (typeof value === "string") {
    const isLongId = value.length >= 24 && !value.includes(" ");
    return (
      <span className="row-flex" style={{ justifyContent: "flex-end", gap: 6, display: "inline-flex" }}>
        <span className="mono" style={{ color: depth === 0 ? "var(--text-primary)" : "var(--up)" }}>
          {value}
        </span>
        {isLongId && <CopyButton text={value} label="Copy" />}
      </span>
    );
  }
  if (Array.isArray(value)) {
    if (!value.length) return <span className="faint mono">[]</span>;
    return (
      <div style={{ marginLeft: depth ? 12 : 0 }}>
        {value.map((v, i) => (
          <div key={i} className="kv">
            <span className="k mono">[{i}]</span>
            <span className="v">
              <JsonView value={v} depth={depth + 1} />
            </span>
          </div>
        ))}
      </div>
    );
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (!entries.length) return <span className="faint mono">{"{}"}</span>;
  return (
    <div style={{ marginLeft: depth ? 12 : 0 }}>
      {entries.map(([k, v]) => (
        <div key={k} className="kv">
          <span className="k mono">{k}</span>
          <span className="v" style={{ maxWidth: "74%" }}>
            <JsonView value={v} depth={depth + 1} />
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------- Countdown (Testnet Daily Claim 00:00 UTC) ---------- */

export function Countdown({ to, label }: { to: number; label: string }) {
  const now = useNow(1000);
  const ms = Math.max(0, to - now);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");

  // Progress through current 24h UTC window
  const dayMs = 86_400_000;
  const elapsedPct = Math.min(100, Math.max(0, ((dayMs - ms) / dayMs) * 100));

  return (
    <div>
      <div className="faint mb-2">{label}</div>
      <div
        className="mono"
        style={{
          fontSize: 32,
          fontWeight: 700,
          letterSpacing: 1.5,
          color: "var(--text-primary)",
        }}
        aria-live="polite"
      >
        {pad(h)}h : {pad(m)}m : {pad(s)}s
      </div>
      <div className="range mt-2" style={{ width: "100%", height: 6 }}>
        <div
          className="fill"
          style={{
            width: `${elapsedPct.toFixed(1)}%`,
            background: "var(--accent)",
          }}
        />
      </div>
      <div className="between faint mt-1">
        <span>00:00 UTC start</span>
        <span>{elapsedPct.toFixed(0)}% of UTC day elapsed</span>
        <span>00:00 UTC reset</span>
      </div>
    </div>
  );
}
