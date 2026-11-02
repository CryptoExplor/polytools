export const WIRE_SAMPLE_DATA_SOURCE = "wire-samples" as const;
/**
 * Wire identifier — DO NOT RENAME. The dev server sends this header on
 * wire-sample fallbacks; existing deployments and tools read it. The client
 * also accepts the newer `x-polyap-data-source` alias when reading.
 */
export const WIRE_SAMPLE_HEADER = "x-polytools-data-source";
export const WIRE_SAMPLE_HEADER_ALIAS = "x-polyap-data-source";

/** Reads the data-source marker from either the legacy header or its alias. */
export function wireSampleDataSource(headers: Pick<Headers, "get">): string | null {
  return headers.get(WIRE_SAMPLE_HEADER) ?? headers.get(WIRE_SAMPLE_HEADER_ALIAS);
}

export function isWireSamplePayload(value: unknown): boolean {
  return Boolean(
    value && typeof value === "object" &&
    (value as { dataSource?: unknown }).dataSource === WIRE_SAMPLE_DATA_SOURCE,
  );
}
