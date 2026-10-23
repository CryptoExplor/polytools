export interface PrivatePartition {
  /** Random local vault/session generation, never a Polyester identifier. */
  sessionGeneration: string;
  /** Verified internal scope key, held only in memory. */
  scopeKey: string;
  operation: string;
  filters: Record<string, unknown>;
}

function stable(value: unknown): string {
  if (value === undefined) return '{"$undefined":true}';
  if (typeof value === "bigint") return `{"$bigint":${JSON.stringify(value.toString())}}`;
  if (typeof value === "number" && !Number.isFinite(value)) throw new Error("Non-finite filter values are not allowed.");
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
}

function keyOf(partition: PrivatePartition): string {
  if (!partition.sessionGeneration || !partition.scopeKey || !partition.operation) {
    throw new Error("A private cache partition requires session, scope, and operation.");
  }
  return stable([
    partition.sessionGeneration,
    partition.scopeKey,
    partition.operation,
    partition.filters,
  ]);
}

function clone<T>(value: T): T {
  if (typeof structuredClone !== "function") {
    throw new Error("Structured cloning is required for private memory snapshots.");
  }
  return structuredClone(value);
}

/** Memory-only private response store; it has no durable storage adapter. */
export class MemoryDatasetStore {
  private readonly values = new Map<string, unknown>();
  private unbindLifecycle?: () => void;

  /** Clear all private snapshots at every vault session boundary. */
  bindLifecycle(
    subscribe: (listener: (event: { type: string }) => void) => () => void,
  ): () => void {
    this.unbindLifecycle?.();
    const unbind = subscribe((event) => {
      const type = event.type.toUpperCase();
      if (["LOCK", "WIPE", "VAULT_CHANGED", "IMPORT", "UNLOCK"].includes(type)) this.clear();
    });
    this.unbindLifecycle = unbind;
    return () => {
      unbind();
      if (this.unbindLifecycle === unbind) this.unbindLifecycle = undefined;
    };
  }

  dispose(): void {
    this.unbindLifecycle?.();
    this.unbindLifecycle = undefined;
    this.clear();
  }

  get<T>(partition: PrivatePartition): T | undefined {
    const key = keyOf(partition);
    return this.values.has(key) ? clone(this.values.get(key) as T) : undefined;
  }

  set<T>(partition: PrivatePartition, value: T): T {
    this.values.set(keyOf(partition), clone(value));
    return clone(value);
  }

  /** Accept a response only while the captured partition is still current. */
  setIfCurrent<T>(
    partition: PrivatePartition,
    value: T,
    current: Pick<PrivatePartition, "sessionGeneration" | "scopeKey" | "operation" | "filters">,
  ): T | undefined {
    if (keyOf(partition) !== keyOf(current)) return undefined;
    return this.set(partition, value);
  }

  delete(partition: PrivatePartition): void {
    this.values.delete(keyOf(partition));
  }

  clearSession(sessionGeneration: string): void {
    for (const key of [...this.values.keys()]) {
      // Keys are JSON arrays; inspect only the local generation, never expose
      // the scope/filter payload to callers or logs.
      try {
        const parsed = JSON.parse(key) as unknown[];
        if (parsed[0] === sessionGeneration) this.values.delete(key);
      } catch {
        this.values.delete(key);
      }
    }
  }

  clear(): void {
    this.values.clear();
  }

  get size(): number {
    return this.values.size;
  }
}
