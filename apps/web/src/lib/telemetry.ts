export function telemetryFallback(pending: boolean): "Pending" | "Unknown" {
  return pending ? "Pending" : "Unknown";
}

export function formatBooleanTelemetry(
  value: boolean | undefined,
  pending: boolean,
): string {
  return typeof value === "boolean" ? String(value) : telemetryFallback(pending);
}

export function formatCountTelemetry(
  value: number | undefined,
  pending: boolean,
  suffix = "",
): string {
  return typeof value === "number" && Number.isFinite(value)
    ? `${value}${suffix}`
    : telemetryFallback(pending);
}
