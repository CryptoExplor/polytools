/**
 * Bounded public-data cache with memory + optional IndexedDB persistence.
 *
 * This module is deliberately public-only. Do not pass account responses,
 * credentials, signing material, cursors, or user-assisted accounting inputs.
 */

export const PUBLIC_CACHE_FORMAT = "polytools-public-cache@1" as const;
export const PUBLIC_CACHE_DATABASE_NAME = "polytools-public-cache";
export const PUBLIC_CACHE_DATABASE_VERSION = 1;

const ENTRY_STORE = "entries";
const MAX_FUTURE_SKEW_MS = 0;

export interface PublicCachePolicy {
  /** Endpoint payload schema, independent of the storage format version. */
  schema: string;
  /** Maximum fresh lifetime; response Cache-Control can only shorten it. */
  freshMs: number;
  /** Maximum age for visibly stale fallback, measured from save time. */
  maxAgeMs: number;
  /** Oversized values are returned to the caller but are not cached. */
  maxBytes: number;
}

export interface ResolvedPublicCachePolicy extends PublicCachePolicy {
  persist: boolean;
}

export interface PublicCacheEntry<T = unknown> {
  format: typeof PUBLIC_CACHE_FORMAT;
  key: string;
  schema: string;
  savedAt: number;
  freshUntil: number;
  expiresAt: number;
  value: T;
}

export interface PublicCacheHit<T> {
  entry: PublicCacheEntry<T>;
  origin: "memory" | "persistent";
  fresh: boolean;
}

export interface PublicFetchResponse {
  data: unknown;
  cacheControl?: string | null;
}

export interface PublicNetworkResult<T> {
  value: T;
  savedAt: number;
  /** Null means the valid network value was intentionally not cached. */
  entry: PublicCacheEntry<T> | null;
}

export interface PublicCacheStorage {
  get(key: string): Promise<unknown>;
  putIfNewer(entry: PublicCacheEntry): Promise<void>;
  delete(key: string, savedAt?: number): Promise<void>;
  getAll(): Promise<unknown[]>;
}

export class PublicCacheError extends Error {
  constructor(readonly code: "INVALID_DATA" | "STALE_RESPONSE", message: string) {
    super(message);
    this.name = "PublicCacheError";
  }
}

function clone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function byteSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function validTime(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function directives(cacheControl: string | null | undefined): Map<string, string | true> {
  const result = new Map<string, string | true>();
  for (const part of (cacheControl ?? "").split(",")) {
    const [rawName, rawValue] = part.trim().split("=", 2);
    const name = rawName?.trim().toLowerCase();
    if (name) result.set(name, rawValue?.replace(/^"|"$/g, "") ?? true);
  }
  return result;
}

/** Resolve browser persistence/freshness conservatively from HTTP directives. */
export function resolvePublicCachePolicy(
  base: PublicCachePolicy,
  cacheControl?: string | null,
): ResolvedPublicCachePolicy {
  const parsed = directives(cacheControl);
  if (parsed.has("no-store") || parsed.has("private")) {
    return { ...base, freshMs: 0, maxAgeMs: 0, persist: false };
  }

  let freshMs = 0;
  const rawMaxAge = parsed.get("max-age");
  if (typeof rawMaxAge === "string" && /^\d+$/.test(rawMaxAge)) {
    const seconds = Number(rawMaxAge);
    if (Number.isFinite(seconds)) freshMs = Math.min(base.freshMs, seconds * 1000);
  }
  if (parsed.has("no-cache")) freshMs = 0;

  return {
    ...base,
    freshMs,
    // must-revalidate responses are not retained for offline/stale reuse.
    maxAgeMs: parsed.has("must-revalidate") ? freshMs : base.maxAgeMs,
    persist: true,
  };
}

export function publicCacheLoadDecision(options: {
  offline: boolean;
  fresh: boolean;
  force: boolean;
}): "offline" | "use-fresh" | "revalidate" {
  if (options.offline) return "offline";
  if (options.fresh && !options.force) return "use-fresh";
  return "revalidate";
}

/** Explicit synthetic/test adapter; browser persistence uses IndexedDB below. */
export class MemoryPublicCacheStorage implements PublicCacheStorage {
  private readonly entries = new Map<string, PublicCacheEntry>();

  async get(key: string): Promise<unknown> {
    const entry = this.entries.get(key);
    return entry ? clone(entry) : null;
  }

  async putIfNewer(entry: PublicCacheEntry): Promise<void> {
    const existing = this.entries.get(entry.key);
    if (existing && existing.savedAt >= entry.savedAt) return;
    this.entries.set(entry.key, clone(entry));
  }

  async delete(key: string, savedAt?: number): Promise<void> {
    const existing = this.entries.get(key);
    if (savedAt !== undefined && existing?.savedAt !== savedAt) return;
    this.entries.delete(key);
  }

  async getAll(): Promise<unknown[]> {
    return [...this.entries.values()].map(clone);
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionResult(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

/** Separate public-only database; it never shares the encrypted vault store. */
export class IndexedDbPublicCacheStorage implements PublicCacheStorage {
  private database: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    if (typeof globalThis.indexedDB === "undefined") {
      return Promise.reject(new Error("IndexedDB is unavailable; using memory-only public caching."));
    }
    const opening = new Promise<IDBDatabase>((resolve, reject) => {
      const request = globalThis.indexedDB.open(
        PUBLIC_CACHE_DATABASE_NAME,
        PUBLIC_CACHE_DATABASE_VERSION,
      );
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(ENTRY_STORE)) {
          database.createObjectStore(ENTRY_STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error ?? new Error("Could not open the public cache."));
      request.onblocked = () => reject(new Error("Public cache upgrade was blocked by another tab."));
    });
    this.database = opening;
    void opening.catch(() => {
      if (this.database === opening) this.database = null;
    });
    return opening;
  }

  async get(key: string): Promise<unknown> {
    const database = await this.open();
    const transaction = database.transaction(ENTRY_STORE, "readonly");
    return (await requestResult(
      transaction.objectStore(ENTRY_STORE).get(key) as IDBRequest<unknown>,
    )) ?? null;
  }

  async putIfNewer(entry: PublicCacheEntry): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(ENTRY_STORE, "readwrite");
    const done = transactionResult(transaction);
    const store = transaction.objectStore(ENTRY_STORE);
    const existing = await requestResult(
      store.get(entry.key) as IDBRequest<PublicCacheEntry | undefined>,
    );
    // Equal timestamps retain the first valid writer instead of replacing it
    // with a potentially older response from another tab.
    if (!existing || !validTime(existing.savedAt) || existing.savedAt < entry.savedAt) {
      store.put(entry);
    }
    await done;
  }

  async delete(key: string, savedAt?: number): Promise<void> {
    const database = await this.open();
    const transaction = database.transaction(ENTRY_STORE, "readwrite");
    const done = transactionResult(transaction);
    const store = transaction.objectStore(ENTRY_STORE);
    if (savedAt === undefined) {
      store.delete(key);
    } else {
      const existing = await requestResult(
        store.get(key) as IDBRequest<PublicCacheEntry | undefined>,
      );
      if (existing?.savedAt === savedAt) store.delete(key);
    }
    await done;
  }

  async getAll(): Promise<unknown[]> {
    const database = await this.open();
    const transaction = database.transaction(ENTRY_STORE, "readonly");
    return requestResult(
      transaction.objectStore(ENTRY_STORE).getAll() as IDBRequest<unknown[]>,
    );
  }
}

export class PublicDataCache {
  private readonly memory = new Map<string, PublicCacheEntry>();
  private readonly flights = new Map<string, Promise<PublicNetworkResult<unknown>>>();
  private readonly generations = new Map<string, number>();
  private readonly storage: PublicCacheStorage | null;
  private readonly now: () => number;
  private readonly maxEntries: number;

  constructor(options: {
    storage?: PublicCacheStorage | null;
    now?: () => number;
    maxEntries?: number;
  } = {}) {
    this.storage = options.storage ?? null;
    this.now = options.now ?? Date.now;
    this.maxEntries = Math.max(1, Math.floor(options.maxEntries ?? 8));
  }

  private generation(key: string): number {
    return this.generations.get(key) ?? 0;
  }

  private assertCurrent(key: string, generation: number): void {
    if (this.generation(key) !== generation) {
      throw new PublicCacheError("STALE_RESPONSE", "A newer public-cache operation superseded this response.");
    }
  }

  private decodeEntry<T>(
    raw: unknown,
    key: string,
    policy: PublicCachePolicy,
    decode: (value: unknown) => T | null,
    now: number,
  ): PublicCacheEntry<T> | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const candidate = raw as Partial<PublicCacheEntry>;
    if (
      candidate.format !== PUBLIC_CACHE_FORMAT ||
      candidate.key !== key ||
      candidate.schema !== policy.schema ||
      !validTime(candidate.savedAt) ||
      !validTime(candidate.freshUntil) ||
      !validTime(candidate.expiresAt) ||
      candidate.savedAt > now + MAX_FUTURE_SKEW_MS ||
      candidate.freshUntil < candidate.savedAt ||
      candidate.expiresAt < candidate.freshUntil ||
      candidate.expiresAt <= now ||
      candidate.freshUntil - candidate.savedAt > policy.freshMs ||
      candidate.expiresAt - candidate.savedAt > policy.maxAgeMs
    ) return null;

    let value: T | null;
    try {
      value = decode(candidate.value);
    } catch {
      return null;
    }
    if (value === null) return null;
    const entry: PublicCacheEntry<T> = {
      format: PUBLIC_CACHE_FORMAT,
      key,
      schema: policy.schema,
      savedAt: candidate.savedAt,
      freshUntil: candidate.freshUntil,
      expiresAt: candidate.expiresAt,
      value,
    };
    return byteSize(entry) <= policy.maxBytes ? entry : null;
  }

  private pruneMemory(): void {
    if (this.memory.size <= this.maxEntries) return;
    const oldest = [...this.memory.values()]
      .sort((left, right) => left.savedAt - right.savedAt)
      .slice(0, this.memory.size - this.maxEntries);
    for (const entry of oldest) {
      if (this.memory.get(entry.key)?.savedAt === entry.savedAt) this.memory.delete(entry.key);
    }
  }

  private async deletePersistent(key: string, savedAt?: number): Promise<void> {
    try {
      await this.storage?.delete(key, savedAt);
    } catch {
      // Storage failure must not block the network or in-memory fallback.
    }
  }

  async read<T>(
    key: string,
    policy: PublicCachePolicy,
    decode: (value: unknown) => T | null,
  ): Promise<PublicCacheHit<T> | null> {
    let now = this.now();
    const memory = this.memory.get(key);
    if (memory) {
      const entry = this.decodeEntry(memory, key, policy, decode, now);
      if (entry) return { entry, origin: "memory", fresh: now < entry.freshUntil };
      this.memory.delete(key);
      // A newer valid persistent copy may have been written by another tab.
    }

    let raw: unknown = null;
    try {
      raw = await this.storage?.get(key);
    } catch {
      // IndexedDB can be denied or evicted; memory/network remain available.
    }
    if (raw === null || raw === undefined) return null;
    // IndexedDB latency must not make an already-expired record look reusable.
    now = this.now();
    const entry = this.decodeEntry(raw, key, policy, decode, now);
    if (!entry) {
      await this.deletePersistent(key);
      return null;
    }
    this.memory.set(key, clone(entry));
    this.pruneMemory();
    return { entry, origin: "persistent", fresh: now < entry.freshUntil };
  }

  refresh<T>(options: {
    key: string;
    policy: PublicCachePolicy;
    decode: (value: unknown) => T | null;
    fetcher: () => Promise<PublicFetchResponse>;
  }): Promise<PublicNetworkResult<T>> {
    const existing = this.flights.get(options.key);
    if (existing) return existing as Promise<PublicNetworkResult<T>>;

    const generation = this.generation(options.key);
    const operation = this.performRefresh<T>(options, generation);
    const tracked: Promise<PublicNetworkResult<T>> = operation.finally(() => {
      if (this.flights.get(options.key) === tracked) this.flights.delete(options.key);
    });
    this.flights.set(options.key, tracked as Promise<PublicNetworkResult<unknown>>);
    return tracked;
  }

  private async performRefresh<T>(
    options: {
      key: string;
      policy: PublicCachePolicy;
      decode: (value: unknown) => T | null;
      fetcher: () => Promise<PublicFetchResponse>;
    },
    generation: number,
  ): Promise<PublicNetworkResult<T>> {
    const response = await options.fetcher();
    this.assertCurrent(options.key, generation);
    const value = options.decode(response.data);
    if (value === null) {
      throw new PublicCacheError("INVALID_DATA", "The public response failed runtime validation.");
    }

    const savedAt = this.now();
    const policy = resolvePublicCachePolicy(options.policy, response.cacheControl);
    if (!policy.persist) {
      this.memory.delete(options.key);
      await this.deletePersistent(options.key);
      this.assertCurrent(options.key, generation);
      return { value, savedAt, entry: null };
    }

    const entry: PublicCacheEntry<T> = {
      format: PUBLIC_CACHE_FORMAT,
      key: options.key,
      schema: options.policy.schema,
      savedAt,
      freshUntil: savedAt + policy.freshMs,
      expiresAt: savedAt + policy.maxAgeMs,
      value,
    };
    if (byteSize(entry) > options.policy.maxBytes) {
      return { value, savedAt, entry: null };
    }

    this.assertCurrent(options.key, generation);
    this.memory.set(options.key, clone(entry));
    this.pruneMemory();
    try {
      await this.storage?.putIfNewer(clone(entry));
    } catch {
      // A valid in-memory copy is still useful when durable storage fails.
    }

    if (this.generation(options.key) !== generation) {
      if (this.memory.get(options.key)?.savedAt === savedAt) this.memory.delete(options.key);
      await this.deletePersistent(options.key, savedAt);
      throw new PublicCacheError("STALE_RESPONSE", "A newer public-cache operation superseded this response.");
    }
    return { value, savedAt, entry };
  }

  /** Invalidate a key and prevent an older in-flight response from winning. */
  async invalidate(key: string): Promise<void> {
    this.generations.set(key, this.generation(key) + 1);
    this.memory.delete(key);
    this.flights.delete(key);
    await this.deletePersistent(key);
  }

  /** Remove expired/outdated records and bound retained entries by save time. */
  async cleanup(allowedSchemas: readonly string[]): Promise<void> {
    const now = this.now();
    const schemas = new Set(allowedSchemas);
    const reusable = (raw: unknown): raw is PublicCacheEntry => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
      const entry = raw as Partial<PublicCacheEntry>;
      return entry.format === PUBLIC_CACHE_FORMAT &&
        typeof entry.key === "string" &&
        typeof entry.schema === "string" &&
        schemas.has(entry.schema) &&
        validTime(entry.savedAt) &&
        validTime(entry.expiresAt) &&
        entry.savedAt <= now &&
        entry.expiresAt > now;
    };

    for (const [key, entry] of [...this.memory.entries()]) {
      if (!reusable(entry)) this.memory.delete(key);
    }
    this.pruneMemory();

    let records: unknown[] = [];
    try {
      records = (await this.storage?.getAll()) ?? [];
    } catch {
      return;
    }
    const valid = records.filter(reusable)
      .sort((left, right) => right.savedAt - left.savedAt);
    const retain = new Set(valid.slice(0, this.maxEntries).map((entry) => entry.key));
    for (const raw of records) {
      if (!reusable(raw)) {
        const key = raw && typeof raw === "object" && typeof (raw as { key?: unknown }).key === "string"
          ? (raw as { key: string }).key
          : null;
        if (key) await this.deletePersistent(key);
      } else if (!retain.has(raw.key)) {
        await this.deletePersistent(raw.key);
      }
    }
  }
}
