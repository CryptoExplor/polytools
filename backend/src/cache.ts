/**
 * Tiny in-memory TTL cache with single-flight request coalescing.
 * Per-isolate on serverless platforms — that's fine, this is a hot cache,
 * not a source of truth. The MCP endpoint stays the origin.
 */

interface Entry {
  value: unknown;
  expiresAt: number;
}

const store = new Map<string, Entry>();
const flights = new Map<string, Promise<unknown>>();

export async function cached<T>(
  key: string,
  ttlMs: number,
  producer: () => Promise<T>,
): Promise<T> {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value as T;

  const inFlight = flights.get(key);
  if (inFlight) return inFlight as Promise<T>;

  const p = producer()
    .then((value) => {
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => flights.delete(key));

  flights.set(key, p);
  return p;
}

export function cacheStats(): { keys: number; inFlight: number } {
  return { keys: store.size, inFlight: flights.size };
}
