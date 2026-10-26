export const WIRE_SAMPLE_DATA_SOURCE = "wire-samples" as const;
export const WIRE_SAMPLE_HEADER = "x-polytools-data-source";

export function isWireSamplePayload(value: unknown): boolean {
  return Boolean(
    value && typeof value === "object" &&
    (value as { dataSource?: unknown }).dataSource === WIRE_SAMPLE_DATA_SOURCE,
  );
}
