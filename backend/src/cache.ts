/**
 * Tiny in-memory TTL cache with single-flight request coalescing.
 * Per-isolate on serverless platforms — that's fine, this is a hot cache,
 * not a source of truth. The MCP endpoint stays the origin.
 */

interface Entry {
  value: unknown;
  expiresAt: number;
}

const MAX_KEYS = 200;
const store = new Map<string, Entry>();
const flights = new Map<string, Promise<unknown>>();

function sweepExpired(now: number): void {
  for (const [k, v] of store.entries()) {
    if (v.expiresAt <= now) store.delete(k);
  }
}

function evictSoonestExpiring(): void {
  let targetKey: string | undefined;
  let minExpiresAt = Infinity;
  for (const [k, v] of store.entries()) {
    if (v.expiresAt < minExpiresAt) {
      minExpiresAt = v.expiresAt;
      targetKey = k;
    }
  }
  if (targetKey !== undefined) {
    store.delete(targetKey);
  }
}

export async function cached<T>(
  key: string,
  ttlMs: number,
  producer: () => Promise<T>,
): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;

  const inFlight = flights.get(key);
  if (inFlight) return inFlight as Promise<T>;

  const p = producer()
    .then((value) => {
      const writeNow = Date.now();
      if (store.size >= MAX_KEYS) {
        sweepExpired(writeNow);
        while (store.size >= MAX_KEYS) {
          evictSoonestExpiring();
        }
      }
      store.set(key, { value, expiresAt: writeNow + ttlMs });
      return value;
    })
    .finally(() => flights.delete(key));

  flights.set(key, p);
  return p;
}

export function cacheStats(): { keys: number; inFlight: number } {
  return { keys: store.size, inFlight: flights.size };
}

export function clearCache(): void {
  store.clear();
  flights.clear();
}
