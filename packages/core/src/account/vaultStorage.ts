export const VAULT_FORMAT = "polytools-account-vault" as const;
export const VAULT_VERSION = 2 as const;
export const VAULT_DATABASE_NAME = "polytools-account-vault";
export const VAULT_DATABASE_VERSION = 1;

export interface EncryptedVaultEntry {
  format: typeof VAULT_FORMAT;
  version: typeof VAULT_VERSION;
  entryId: string;
  kdf: {
    name: "PBKDF2";
    hash: "SHA-256";
    salt: string;
    iterations: number;
    version: 1;
  };
  cipher: {
    name: "AES-GCM";
    iv: string;
    additionalDataVersion: 1;
  };
  ciphertext: string;
}

export interface VaultEntrySummary {
  /** Random local identifier, never a Polyester key/account identifier. */
  entryId: string;
  iterations: number;
}

/** Storage boundary contains ciphertext and random control metadata only. */
export interface VaultStorage {
  listEntries(): Promise<EncryptedVaultEntry[]>;
  getEntry(entryId: string): Promise<EncryptedVaultEntry | null>;
  putEntry(entry: EncryptedVaultEntry): Promise<void>;
  deleteEntry(entryId: string): Promise<void>;
  clearEntries(): Promise<void>;
  getGeneration(): Promise<string | null>;
  setGeneration(generation: string): Promise<void>;
  close?(): void;
}

function cloneEntry(entry: EncryptedVaultEntry): EncryptedVaultEntry {
  return {
    ...entry,
    kdf: { ...entry.kdf },
    cipher: { ...entry.cipher },
  };
}

/** Explicit synthetic/test adapter. The web app uses IndexedDbVaultStorage. */
export class MemoryVaultStorage implements VaultStorage {
  private readonly entries = new Map<string, EncryptedVaultEntry>();
  private generation: string | null = null;

  async listEntries(): Promise<EncryptedVaultEntry[]> {
    return [...this.entries.values()]
      .sort((left, right) => left.entryId.localeCompare(right.entryId))
      .map(cloneEntry);
  }

  async getEntry(entryId: string): Promise<EncryptedVaultEntry | null> {
    const entry = this.entries.get(entryId);
    return entry ? cloneEntry(entry) : null;
  }

  async putEntry(entry: EncryptedVaultEntry): Promise<void> {
    this.entries.set(entry.entryId, cloneEntry(entry));
  }

  async deleteEntry(entryId: string): Promise<void> {
    this.entries.delete(entryId);
  }

  async clearEntries(): Promise<void> {
    this.entries.clear();
  }

  async getGeneration(): Promise<string | null> {
    return this.generation;
  }

  async setGeneration(generation: string): Promise<void> {
    this.generation = generation;
  }
}

const ENTRY_STORE = "entries";
const META_STORE = "meta";
const GENERATION_KEY = "generation";

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

/** Browser persistence for authenticated ciphertext; no localStorage key fallback. */
export class IndexedDbVaultStorage implements VaultStorage {
  private database: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    if (this.database) return this.database;
    if (typeof globalThis.indexedDB === "undefined") {
      return Promise.reject(
        new Error("IndexedDB is required for the encrypted vault; plaintext fallback is disabled."),
      );
    }
    this.database = new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open(
        VAULT_DATABASE_NAME,
        VAULT_DATABASE_VERSION,
      );
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(ENTRY_STORE)) {
          database.createObjectStore(ENTRY_STORE, { keyPath: "entryId" });
        }
        if (!database.objectStoreNames.contains(META_STORE)) {
          database.createObjectStore(META_STORE, { keyPath: "key" });
        }
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () =>
        reject(request.error ?? new Error("Could not open the encrypted vault."));
      request.onblocked = () =>
        reject(new Error("Encrypted vault upgrade was blocked by another tab."));
    });
    return this.database;
  }

  async listEntries(): Promise<EncryptedVaultEntry[]> {
    const database = await this.open();
    const transaction = database.transaction(ENTRY_STORE, "readonly");
    const entries = await requestResult(
      transaction.objectStore(ENTRY_STORE).getAll() as IDBRequest<EncryptedVaultEntry[]>,
    );
    return entries.sort((left, right) => left.entryId.localeCompare(right.entryId));
  }

  async getEntry(entryId: string): Promise<EncryptedVaultEntry | null> {
    const database = await this.open();
    const transaction = database.transaction(ENTRY_STORE, "readonly");
    const entry = await requestResult(
      transaction.objectStore(ENTRY_STORE).get(entryId) as IDBRequest<
        EncryptedVaultEntry | undefined
      >,
    );
    return entry ?? null;
  }

  async putEntry(entry: EncryptedVaultEntry): Promise<void> {
    const database = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(ENTRY_STORE, "readwrite");
      transaction.objectStore(ENTRY_STORE).put(entry);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Could not persist the encrypted entry."));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Encrypted entry write was aborted."));
    });
  }

  async deleteEntry(entryId: string): Promise<void> {
    const database = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(ENTRY_STORE, "readwrite");
      transaction.objectStore(ENTRY_STORE).delete(entryId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Could not delete the encrypted entry."));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Encrypted entry deletion was aborted."));
    });
  }

  async clearEntries(): Promise<void> {
    const database = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(ENTRY_STORE, "readwrite");
      transaction.objectStore(ENTRY_STORE).clear();
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Could not clear the encrypted vault."));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Encrypted vault wipe was aborted."));
    });
  }

  async getGeneration(): Promise<string | null> {
    const database = await this.open();
    const transaction = database.transaction(META_STORE, "readonly");
    const record = await requestResult(
      transaction.objectStore(META_STORE).get(GENERATION_KEY) as IDBRequest<
        { key: string; value: string } | undefined
      >,
    );
    return typeof record?.value === "string" ? record.value : null;
  }

  async setGeneration(generation: string): Promise<void> {
    const database = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(META_STORE, "readwrite");
      transaction.objectStore(META_STORE).put({
        key: GENERATION_KEY,
        value: generation,
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("Could not update vault generation."));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("Vault generation update was aborted."));
    });
  }

  close(): void {
    if (!this.database) return;
    void this.database.then((database) => database.close()).catch(() => undefined);
    this.database = null;
  }
}
