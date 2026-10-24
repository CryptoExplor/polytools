export interface CursorPage<T> {
  rows: readonly T[];
  /** Empty/null means exhausted; any nonempty string is opaque and continued. */
  nextPageToken?: string | null;
}

export interface CursorIngestionResult<T> {
  rows: T[];
  pagesFetched: number;
  cursorExhausted: boolean;
  stoppedAtCap: boolean;
  repeatedCursor: boolean;
  error?: unknown;
}

export class CursorIngestionError extends Error {
  constructor(readonly code: "ABORTED" | "REPEATED_CURSOR" | "INVALID_PAGE" | "RESOURCE_LIMIT", message: string) {
    super(message);
    this.name = "CursorIngestionError";
  }
}

function abortError(): CursorIngestionError {
  return new CursorIngestionError("ABORTED", "Cursor ingestion was aborted.");
}

/**
 * Follow an opaque cursor chain without parsing or normalizing tokens. Errors
 * return the already validated prefix so callers can label it partial.
 */
export async function collectCursorPages<T>(options: {
  fetchPage: (pageToken?: string) => Promise<CursorPage<T>>;
  maxPages?: number;
  signal?: AbortSignal;
  onPage?: (page: CursorPage<T>, pageNumber: number) => void;
}): Promise<CursorIngestionResult<T>> {
  const maxPages = options.maxPages ?? 1000;
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 10_000) {
    throw new CursorIngestionError("RESOURCE_LIMIT", "Cursor page cap must be between 1 and 10000.");
  }
  const rows: T[] = [];
  const seenCursors = new Set<string>();
  let cursor: string | undefined;
  let pagesFetched = 0;

  while (true) {
    if (options.signal?.aborted) {
      return { rows, pagesFetched, cursorExhausted: false, stoppedAtCap: false, repeatedCursor: false, error: abortError() };
    }
    let page: CursorPage<T>;
    try {
      page = await options.fetchPage(cursor);
    } catch (error) {
      return { rows, pagesFetched, cursorExhausted: false, stoppedAtCap: false, repeatedCursor: false, error };
    }
    if (!page || !Array.isArray(page.rows) ||
      (page.nextPageToken !== undefined && page.nextPageToken !== null && typeof page.nextPageToken !== "string")) {
      return {
        rows,
        pagesFetched,
        cursorExhausted: false,
        stoppedAtCap: false,
        repeatedCursor: false,
        error: new CursorIngestionError("INVALID_PAGE", "The cursor page shape is incompatible."),
      };
    }
    pagesFetched += 1;
    rows.push(...page.rows);
    options.onPage?.(page, pagesFetched);
    const next = page.nextPageToken ?? "";
    if (next === "") {
      return { rows, pagesFetched, cursorExhausted: true, stoppedAtCap: false, repeatedCursor: false };
    }
    if (seenCursors.has(next)) {
      return {
        rows,
        pagesFetched,
        cursorExhausted: false,
        stoppedAtCap: false,
        repeatedCursor: true,
        error: new CursorIngestionError("REPEATED_CURSOR", "The server repeated an opaque cursor; history is incomplete."),
      };
    }
    seenCursors.add(next);
    if (pagesFetched >= maxPages) {
      return { rows, pagesFetched, cursorExhausted: false, stoppedAtCap: true, repeatedCursor: false };
    }
    // The exact string is passed to the next request, including reserved bytes.
    cursor = next;
  }
}
