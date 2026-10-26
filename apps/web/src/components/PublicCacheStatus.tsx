import { fmtAgo } from "@poly/core";
import { IconRefresh } from "./icons";

/** Visible provenance for cached public metadata; never describes it as live. */
export function PublicCacheStatus({
  origin,
  savedAt,
  freshUntil,
  now,
  refreshing,
  error,
  sample,
  onRetry,
}: {
  origin: "memory" | "persistent";
  savedAt: number;
  freshUntil: number;
  now: number;
  refreshing: boolean;
  error: string | null;
  sample: boolean;
  onRetry: () => void;
}) {
  const stale = now >= freshUntil;
  const storeLabel = origin === "persistent" ? "IndexedDB" : "memory";
  const stateLabel = refreshing
    ? "Background refresh in flight"
    : error
      ? "Refresh failed; the last valid copy is retained"
      : stale
        ? "Stale cached copy awaiting revalidation"
        : "Fresh cached copy";
  const label = sample
    ? stale ? "Stale sample" : "Cached sample"
    : stale ? "Stale metadata" : "Cached metadata";

  return (
    <span className="row-flex" style={{ gap: 6 }}>
      {/* Provenance and age stay visible at every width; only the wording is compact. */}
      <span
        className={`pill ${stale || error ? "warn" : "up"}`}
        title={`Public market metadata from the ${storeLabel} cache · Saved ${new Date(savedAt).toISOString()} · ${stateLabel} · Not a live price or order book`}
      >
        <span className="dot" />
        {label} · {fmtAgo(savedAt, now)}{refreshing ? " · refreshing" : ""}
      </span>
      {error && (
        <button
          type="button"
          className="btn sm"
          onClick={onRetry}
          aria-label="Try again: refresh public metadata"
          title={`${error} The last valid cached copy is retained.`}
        >
          <IconRefresh size={12} />
          <span>Try again</span>
        </button>
      )}
    </span>
  );
}
