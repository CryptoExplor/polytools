import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  CanonicalRequestError,
  hexToBytes,
  normalizePrivateKeyHex,
  normalizePublicKeyHex,
  pubKeyB64ToHex,
  pubKeyHexToB64,
  requireWebCrypto,
} from "./canonical";
import {
  Ed25519RequestSigner,
  normalizeRegisteredKeyId,
  READ_ONLY_OPERATIONS,
  signedHeaders,
  type ReadOnlyOperation,
  type SignedRequestResult,
} from "./signer";
import {
  IndexedDbVaultStorage,
  VAULT_FORMAT,
  VAULT_VERSION,
  type EncryptedVaultEntry,
  type VaultEntrySummary,
  type VaultStorage,
} from "./vaultStorage";

export const LEGACY_STORAGE_KEY = "poly-tools:vault:v1";
export const VAULT_CONTROL_STORAGE_KEY = "poly-tools:vault:v2:event";
export const VAULT_CHANNEL_NAME = "polytools-account-vault-control";
export const DEFAULT_IDLE_TIMEOUT_MS = 15 * 60 * 1000;
export const PBKDF2_ITERATIONS = 600_000;
export const POLYESTER_API_KEYS_URL =
  "https://testnet.polyester.com/account/api-keys";

const SALT_BYTES = 16;
const IV_BYTES = 12;
const MAX_PBKDF2_ITERATIONS = 10_000_000;
const MAX_FAILED_UNLOCKS = 5;
const UNLOCK_LOCKOUT_MS = 30_000;
// RFC 8410 PKCS#8 prefix for a raw 32-byte Ed25519 seed.
const RAW_ED25519_PKCS8_PREFIX = Uint8Array.from([
  0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06,
  0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
]);

export type VaultErrorCode =
  | "VAULT_LOCKED"
  | "VAULT_STALE"
  | "VAULT_AUTH_FAILED"
  | "VAULT_LOCKOUT"
  | "VAULT_NOT_FOUND"
  | "VAULT_INVALID_INPUT"
  | "VAULT_UNSUPPORTED"
  | "VAULT_STORAGE"
  | "KEY_ID_REQUIRED"
  | "OPERATION_NOT_ALLOWED"
  | "LEGACY_INVALID"
  | "LEGACY_UNSUPPORTED";

export class AccountVaultError extends Error {
  constructor(
    readonly code: VaultErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AccountVaultError";
  }
}

export interface VaultKeyMetadata {
  entryId: string;
  label: string;
  publicKeyHex: string;
  publicKeyB64: string;
  registeredKeyId?: string;
  createdAt: number;
}

export interface VaultSessionInfo extends VaultKeyMetadata {
  generation: string;
  privateKeyExtractable: boolean;
  signal: AbortSignal;
}

export interface CreateVaultKeyInput {
  label: string;
  passphrase: string;
  registeredKeyId?: string;
}

export interface ImportVaultKeyInput extends CreateVaultKeyInput {
  /** Raw 32-byte Ed25519 seed, not a Polyester key ID or vault label. */
  privateKeyHex: string;
  /** Required so the imported private/public pair can be verified locally. */
  publicKeyHex: string;
}

export interface LegacyVaultStatus {
  present: boolean;
  invalid: boolean;
  signCapableCount: number;
  publicOnlyCount: number;
  canMigrate: boolean;
}

interface LegacyVaultEntry {
  keyId: string;
  publicKeyHex?: string;
  publicKeyB64: string;
  privateKeyB64: string;
  registeredKeyId?: string;
  createdAt?: number;
}

interface LegacyStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem?(key: string, value: string): void;
}

interface VaultPayload {
  keyId: string;
  publicKey: string;
  privateKeyPkcs8: string;
  userLabel: string;
  registeredKeyId?: string;
  createdAt: number;
}

interface UnlockedSession {
  metadata: VaultKeyMetadata;
  signer: Ed25519RequestSigner;
  generation: string;
  abort: AbortController;
}

export interface VaultControlMessage {
  type: "LOCK" | "WIPE" | "VAULT_CHANGED";
  eventId: string;
  generation: string;
}

export interface VaultControlChannel {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: VaultControlMessage): void;
  close(): void;
}

export interface AccountVaultOptions {
  storage?: VaultStorage;
  legacyStorage?: LegacyStorage;
  idleTimeoutMs?: number;
  now?: () => number;
  /** Pass null to disable cross-tab broadcast in synthetic tests. */
  channel?: VaultControlChannel | null;
}

type VaultEvent = VaultControlMessage | { type: "UNLOCK"; eventId: string; generation: string };
type VaultListener = (event: VaultEvent) => void;

function defaultLegacyStorage(): LegacyStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

function randomId(): string {
  const crypto = requireWebCrypto();
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return bytesToHex(bytes);
}

function normalizeLabel(input: string): string {
  const label = typeof input === "string" ? input.trim() : "";
  if (!/^[a-zA-Z0-9._ -]{1,64}$/.test(label)) {
    throw new AccountVaultError(
      "VAULT_INVALID_INPUT",
      "Key label must be 1–64 characters using letters, numbers, spaces, hyphens, underscores, or dots.",
    );
  }
  return label;
}

function validatePassphrase(passphrase: string): string {
  if (
    typeof passphrase !== "string" ||
    passphrase.length < 12 ||
    passphrase.length > 1024
  ) {
    throw new AccountVaultError(
      "VAULT_INVALID_INPUT",
      "Use a passphrase between 12 and 1024 characters. It cannot be recovered after loss.",
    );
  }
  return passphrase;
}

function normalizeOptionalRegisteredId(input: string | undefined): string | undefined {
  if (input === undefined || input.trim() === "") return undefined;
  const normalized = normalizeRegisteredKeyId(input);
  if (!normalized) {
    throw new AccountVaultError(
      "VAULT_INVALID_INPUT",
      "Registered key ID must use Polyester's server-issued ak_... form; local labels are not accepted.",
    );
  }
  return normalized;
}

function additionalData(entry: EncryptedVaultEntry): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      format: entry.format,
      version: entry.version,
      entryId: entry.entryId,
      kdf: {
        name: entry.kdf.name,
        hash: entry.kdf.hash,
        salt: entry.kdf.salt,
        iterations: entry.kdf.iterations,
        version: entry.kdf.version,
      },
      cipher: {
        name: entry.cipher.name,
        iv: entry.cipher.iv,
        additionalDataVersion: entry.cipher.additionalDataVersion,
      },
    }),
  );
}

function validateEncryptedEntry(entry: EncryptedVaultEntry): void {
  const kdf = entry?.kdf;
  const cipher = entry?.cipher;
  if (
    !entry ||
    entry.format !== VAULT_FORMAT ||
    entry.version !== VAULT_VERSION ||
    !/^[A-Za-z0-9-]{8,80}$/.test(entry.entryId) ||
    !kdf ||
    kdf.name !== "PBKDF2" ||
    kdf.hash !== "SHA-256" ||
    kdf.version !== 1 ||
    !Number.isSafeInteger(kdf.iterations) ||
    kdf.iterations < PBKDF2_ITERATIONS ||
    kdf.iterations > MAX_PBKDF2_ITERATIONS ||
    !cipher ||
    cipher.name !== "AES-GCM" ||
    cipher.additionalDataVersion !== 1 ||
    typeof entry.ciphertext !== "string"
  ) {
    throw new AccountVaultError(
      "VAULT_AUTH_FAILED",
      "The encrypted entry is invalid or was modified. It cannot be unlocked.",
    );
  }
  try {
    if (
      base64ToBytes(entry.kdf.salt).length !== SALT_BYTES ||
      base64ToBytes(entry.cipher.iv).length !== IV_BYTES
    ) {
      throw new Error("Invalid cryptographic parameters.");
    }
    base64ToBytes(entry.ciphertext);
  } catch {
    throw new AccountVaultError(
      "VAULT_AUTH_FAILED",
      "The encrypted entry is invalid or was modified. It cannot be unlocked.",
    );
  }
}

async function deriveDataKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
  usage: "encrypt" | "decrypt",
): Promise<CryptoKey> {
  const crypto = requireWebCrypto();
  const passphraseBytes = new TextEncoder().encode(passphrase);
  try {
    const material = await crypto.subtle.importKey(
      "raw",
      passphraseBytes,
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    return await crypto.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", salt, iterations },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      [usage],
    );
  } finally {
    passphraseBytes.fill(0);
  }
}

async function encryptPayload(
  payload: VaultPayload,
  entryId: string,
  passphrase: string,
): Promise<EncryptedVaultEntry> {
  const crypto = requireWebCrypto();
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const entry: EncryptedVaultEntry = {
    format: VAULT_FORMAT,
    version: VAULT_VERSION,
    entryId,
    kdf: {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: bytesToBase64(salt),
      iterations: PBKDF2_ITERATIONS,
      version: 1,
    },
    cipher: {
      name: "AES-GCM",
      iv: bytesToBase64(iv),
      additionalDataVersion: 1,
    },
    ciphertext: "",
  };
  let plaintext: Uint8Array | null = new TextEncoder().encode(JSON.stringify(payload));
  try {
    const key = await deriveDataKey(passphrase, salt, entry.kdf.iterations, "encrypt");
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: additionalData(entry), tagLength: 128 },
      key,
      plaintext,
    );
    entry.ciphertext = bytesToBase64(ciphertext);
    return entry;
  } catch (error) {
    if (error instanceof AccountVaultError || error instanceof CanonicalRequestError) {
      throw error;
    }
    throw new AccountVaultError(
      "VAULT_STORAGE",
      "The encrypted entry could not be created. No plaintext fallback was used.",
    );
  } finally {
    plaintext?.fill(0);
    plaintext = null;
    salt.fill(0);
    iv.fill(0);
  }
}

async function importVerifiedSigner(
  pkcs8: Uint8Array,
  metadata: VaultKeyMetadata,
  now: () => number,
): Promise<Ed25519RequestSigner> {
  const crypto = requireWebCrypto();
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const publicBytes = hexToBytes(metadata.publicKeyHex);
  try {
    const publicKey = await crypto.subtle.importKey(
      "raw",
      publicBytes,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const challenge = new TextEncoder().encode("PolyTools vault key-pair verification v1");
    const signature = await crypto.subtle.sign({ name: "Ed25519" }, privateKey, challenge);
    const valid = await crypto.subtle.verify(
      { name: "Ed25519" },
      publicKey,
      signature,
      challenge,
    );
    if (!valid) throw new Error("The private/public key pair does not match.");
    return new Ed25519RequestSigner(privateKey, metadata.registeredKeyId, now);
  } finally {
    publicBytes.fill(0);
  }
}

function metadataFromPayload(payload: VaultPayload, entryId: string): VaultKeyMetadata {
  const publicKeyHex = normalizePublicKeyHex(payload.publicKey);
  if (!publicKeyHex) throw new Error("Invalid public key in encrypted entry.");
  return {
    entryId,
    label: normalizeLabel(payload.userLabel),
    publicKeyHex,
    publicKeyB64: pubKeyHexToB64(publicKeyHex),
    registeredKeyId: normalizeOptionalRegisteredId(payload.registeredKeyId),
    createdAt:
      Number.isSafeInteger(payload.createdAt) && payload.createdAt >= 0
        ? payload.createdAt
        : 0,
  };
}

async function decryptEntry(
  entry: EncryptedVaultEntry,
  passphrase: string,
  now: () => number,
): Promise<{ metadata: VaultKeyMetadata; signer: Ed25519RequestSigner }> {
  const decrypted = await decryptEntryWithPayload(entry, passphrase, now);
  try {
    return { metadata: decrypted.metadata, signer: decrypted.signer };
  } finally {
    // Ordinary unlock/signing callers never retain the serialized private key.
    decrypted.payload.privateKeyPkcs8 = "";
  }
}

/** Decrypt once for an update; the caller must clear payload.privateKeyPkcs8. */
async function decryptEntryWithPayload(
  entry: EncryptedVaultEntry,
  passphrase: string,
  now: () => number,
): Promise<{ metadata: VaultKeyMetadata; signer: Ed25519RequestSigner; payload: VaultPayload }> {
  let plaintext: Uint8Array | null = null;
  let pkcs8: Uint8Array | null = null;
  let payload: VaultPayload | null = null;
  let retainPayload = false;
  try {
    validateEncryptedEntry(entry);
    const crypto = requireWebCrypto();
    const salt = base64ToBytes(entry.kdf.salt);
    const iv = base64ToBytes(entry.cipher.iv);
    const ciphertext = base64ToBytes(entry.ciphertext);
    const key = await deriveDataKey(passphrase, salt, entry.kdf.iterations, "decrypt");
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: additionalData(entry), tagLength: 128 },
      key,
      ciphertext,
    );
    plaintext = new Uint8Array(decrypted);
    const parsedPayload = JSON.parse(new TextDecoder().decode(plaintext)) as VaultPayload;
    payload = parsedPayload;
    plaintext.fill(0);
    plaintext = null;
    if (
      !parsedPayload ||
      parsedPayload.keyId !== parsedPayload.userLabel ||
      typeof parsedPayload.privateKeyPkcs8 !== "string"
    ) {
      throw new Error("Invalid encrypted payload.");
    }
    const metadata = metadataFromPayload(parsedPayload, entry.entryId);
    pkcs8 = base64ToBytes(parsedPayload.privateKeyPkcs8);
    const signer = await importVerifiedSigner(pkcs8, metadata, now);
    retainPayload = true;
    return { metadata, signer, payload: parsedPayload };
  } catch (error) {
    if (error instanceof CanonicalRequestError) throw error;
    throw new AccountVaultError(
      "VAULT_AUTH_FAILED",
      "The entry could not be unlocked. The passphrase may be wrong or the encrypted record may have changed.",
    );
  } finally {
    plaintext?.fill(0);
    pkcs8?.fill(0);
    if (!retainPayload && payload) payload.privateKeyPkcs8 = "";
  }
}

function readLegacyEntries(storage: LegacyStorage | undefined): LegacyVaultEntry[] {
  if (!storage) return [];
  const raw = storage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return [];
  const parsed = JSON.parse(raw) as Array<Partial<LegacyVaultEntry>>;
  if (!Array.isArray(parsed)) throw new Error("Invalid legacy vault.");
  return parsed.map((entry) => {
    if (
      !entry ||
      typeof entry.keyId !== "string" ||
      typeof entry.publicKeyB64 !== "string" ||
      typeof entry.privateKeyB64 !== "string"
    ) {
      throw new Error("Invalid legacy entry.");
    }
    return entry as LegacyVaultEntry;
  });
}

export function getLegacyVaultStatus(storage = defaultLegacyStorage()): LegacyVaultStatus {
  try {
    if (!storage?.getItem(LEGACY_STORAGE_KEY)) {
      return {
        present: false,
        invalid: false,
        signCapableCount: 0,
        publicOnlyCount: 0,
        canMigrate: false,
      };
    }
    const entries = readLegacyEntries(storage);
    const signCapableCount = entries.filter((entry) => Boolean(entry.privateKeyB64)).length;
    const publicOnlyCount = entries.length - signCapableCount;
    return {
      present: true,
      invalid: false,
      signCapableCount,
      publicOnlyCount,
      canMigrate: entries.length > 0 && publicOnlyCount === 0,
    };
  } catch {
    return {
      present: true,
      invalid: true,
      signCapableCount: 0,
      publicOnlyCount: 0,
      canMigrate: false,
    };
  }
}

export function deleteLegacyVault(storage = defaultLegacyStorage()): void {
  if (!storage) return;
  storage.removeItem(LEGACY_STORAGE_KEY);
  if (storage.getItem(LEGACY_STORAGE_KEY) !== null) {
    throw new AccountVaultError(
      "VAULT_STORAGE",
      "The legacy plaintext record could not be removed. It remains quarantined and unused.",
    );
  }
}

export function vaultErrorMessage(error: unknown): string {
  if (error instanceof AccountVaultError || error instanceof CanonicalRequestError) {
    return error.message;
  }
  if (error instanceof Error && /server-registered Polyester key ID/.test(error.message)) {
    return error.message;
  }
  return "The secure vault operation failed. Check the entry state and try again; no plaintext fallback is available.";
}

export class AccountVault {
  private readonly storage: VaultStorage;
  private readonly legacyStorage?: LegacyStorage;
  private readonly idleTimeoutMs: number;
  private readonly now: () => number;
  private clockSkewMs = 0;
  private readonly channel: VaultControlChannel | null;
  private readonly ownsChannel: boolean;
  private readonly listeners = new Set<VaultListener>();
  private session: UnlockedSession | null = null;
  private generation: string | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private failedUnlocks = 0;
  private lockedUntil = 0;
  private lastEventId = "";
  private disposed = false;
  private readonly storageListener?: (event: StorageEvent) => void;
  private readonly pageHideListener?: () => void;

  constructor(options: AccountVaultOptions = {}) {
    this.storage = options.storage ?? new IndexedDbVaultStorage();
    this.legacyStorage = options.legacyStorage ?? defaultLegacyStorage();
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.now = options.now ?? Date.now;

    if (Object.prototype.hasOwnProperty.call(options, "channel")) {
      this.channel = options.channel ?? null;
      this.ownsChannel = false;
    } else if (typeof window !== "undefined" && typeof BroadcastChannel !== "undefined") {
      this.channel = new BroadcastChannel(VAULT_CHANNEL_NAME) as VaultControlChannel;
      this.ownsChannel = true;
    } else {
      this.channel = null;
      this.ownsChannel = false;
    }

    if (this.channel) {
      this.channel.onmessage = (event) => this.receiveControl(event.data);
    }
    if (typeof window !== "undefined") {
      this.storageListener = (event) => {
        if (event.key === VAULT_CONTROL_STORAGE_KEY && event.newValue) {
          try {
            this.receiveControl(JSON.parse(event.newValue));
          } catch {
            this.clearSession("LOCK");
          }
        }
      };
      this.pageHideListener = () => this.clearSession("LOCK");
      window.addEventListener("storage", this.storageListener);
      window.addEventListener("pagehide", this.pageHideListener);
    }
  }

  subscribe(listener: VaultListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private makeEvent(type: VaultEvent["type"], generation: string): VaultEvent {
    return { type, generation, eventId: randomId() } as VaultEvent;
  }

  private notify(event: VaultEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // A UI listener cannot be allowed to interrupt vault cleanup.
      }
    }
  }

  private broadcast(type: VaultControlMessage["type"], generation: string): void {
    const message = this.makeEvent(type, generation) as VaultControlMessage;
    this.lastEventId = message.eventId;
    this.notify(message);
    try {
      this.channel?.postMessage(message);
    } catch {
      // Persistent generation rotation remains the fail-closed fallback.
    }
    try {
      this.legacyStorage?.setItem?.(VAULT_CONTROL_STORAGE_KEY, JSON.stringify(message));
    } catch {
      // BroadcastChannel/generation checks do not depend on this fallback.
    }
  }

  private receiveControl(value: unknown): void {
    if (!value || typeof value !== "object") return;
    const message = value as Partial<VaultControlMessage>;
    if (
      (message.type !== "LOCK" &&
        message.type !== "WIPE" &&
        message.type !== "VAULT_CHANGED") ||
      typeof message.eventId !== "string" ||
      !/^[A-Za-z0-9-]{8,80}$/.test(message.eventId) ||
      typeof message.generation !== "string" ||
      !/^[A-Za-z0-9-]{8,80}$/.test(message.generation) ||
      message.eventId === this.lastEventId
    ) {
      return;
    }
    this.lastEventId = message.eventId;
    this.generation = message.generation;
    this.clearSession("LOCK", false);
    this.notify(message as VaultControlMessage);
  }

  private clearSession(
    type: "LOCK" | "WIPE" = "LOCK",
    emit = true,
  ): void {
    const hadSession = this.session !== null;
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const session = this.session;
    this.session = null;
    session?.abort.abort();
    if (emit && (hadSession || type === "WIPE")) {
      this.notify(this.makeEvent(type, this.generation ?? randomId()));
    }
  }

  private async ensureGeneration(): Promise<string> {
    const existing = await this.storage.getGeneration();
    if (existing) {
      this.generation = existing;
      return existing;
    }
    const generated = randomId();
    await this.storage.setGeneration(generated);
    this.generation = generated;
    return generated;
  }

  private async rotateGeneration(type: VaultControlMessage["type"]): Promise<string> {
    const generated = randomId();
    await this.storage.setGeneration(generated);
    this.generation = generated;
    this.broadcast(type, generated);
    return generated;
  }

  private installSession(metadata: VaultKeyMetadata, signer: Ed25519RequestSigner): void {
    if (!this.generation) throw new AccountVaultError("VAULT_STALE", "Vault generation is unavailable.");
    this.session = {
      metadata: { ...metadata },
      signer,
      generation: this.generation,
      abort: new AbortController(),
    };
    this.failedUnlocks = 0;
    this.lockedUntil = 0;
    this.armIdleTimer();
    this.notify(this.makeEvent("UNLOCK", this.generation));
  }

  private armIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    if (!this.session || this.idleTimeoutMs <= 0) return;
    this.idleTimer = setTimeout(() => {
      void this.lock().catch(() => this.clearSession("LOCK"));
    }, this.idleTimeoutMs);
  }

  /** Deliberate user interaction only; background polling must not call this. */
  notifyActivity(): void {
    if (this.session) this.armIdleTimer();
  }

  /**
   * Set the server-minus-local clock offset used only for signing timestamps.
   * The offset is not persisted and does not change vault metadata or lock timers.
   */
  setClockSkew(skewMs: number): void {
    if (!Number.isSafeInteger(skewMs)) {
      throw new AccountVaultError("VAULT_INVALID_INPUT", "The signing clock offset is invalid.");
    }
    this.clockSkewMs = skewMs;
  }

  getClockSkew(): number {
    return this.clockSkewMs;
  }

  private signingNow(): number {
    const adjusted = this.now() + this.clockSkewMs;
    if (!Number.isSafeInteger(adjusted) || adjusted < 0) {
      throw new AccountVaultError("VAULT_INVALID_INPUT", "The adjusted signing clock is invalid.");
    }
    return adjusted;
  }

  getSessionInfo(): VaultSessionInfo | null {
    if (!this.session) return null;
    return {
      ...this.session.metadata,
      generation: this.session.generation,
      privateKeyExtractable: this.session.signer.privateKeyExtractable,
      signal: this.session.abort.signal,
    };
  }

  async listEntries(): Promise<VaultEntrySummary[]> {
    const entries = await this.storage.listEntries();
    return entries.map((entry) => {
      validateEncryptedEntry(entry);
      return { entryId: entry.entryId, iterations: entry.kdf.iterations };
    });
  }

  getLegacyStatus(): LegacyVaultStatus {
    return getLegacyVaultStatus(this.legacyStorage);
  }

  async createKey(input: CreateVaultKeyInput): Promise<VaultKeyMetadata> {
    const passphrase = validatePassphrase(input.passphrase);
    const label = normalizeLabel(input.label);
    const registeredKeyId = normalizeOptionalRegisteredId(input.registeredKeyId);
    this.clearSession("LOCK");
    const crypto = requireWebCrypto();
    let keyPair: CryptoKeyPair | null = null;
    let pkcs8: Uint8Array | null = null;
    let payload: VaultPayload | null = null;
    try {
      keyPair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
        "sign",
        "verify",
      ])) as CryptoKeyPair;
      const publicBytes = new Uint8Array(
        await crypto.subtle.exportKey("raw", keyPair.publicKey),
      );
      pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
      keyPair = null;
      const publicKeyHex = bytesToHex(publicBytes);
      publicBytes.fill(0);
      const entryId = randomId();
      payload = {
        keyId: label,
        publicKey: publicKeyHex,
        privateKeyPkcs8: bytesToBase64(pkcs8),
        userLabel: label,
        registeredKeyId,
        createdAt: this.now(),
      };
      const metadata = metadataFromPayload(payload, entryId);
      const signer = await importVerifiedSigner(pkcs8, metadata, () => this.signingNow());
      const record = await encryptPayload(payload, entryId, passphrase);
      payload.privateKeyPkcs8 = "";
      await this.storage.putEntry(record);
      const stored = await this.storage.getEntry(entryId);
      if (!stored || stored.ciphertext !== record.ciphertext) {
        throw new AccountVaultError(
          "VAULT_STORAGE",
          "The encrypted entry could not be verified after writing.",
        );
      }
      await this.rotateGeneration("VAULT_CHANGED");
      this.installSession(metadata, signer);
      return { ...metadata };
    } catch (error) {
      if (error instanceof AccountVaultError || error instanceof CanonicalRequestError) {
        throw error;
      }
      throw new AccountVaultError(
        "VAULT_UNSUPPORTED",
        "Ed25519 key generation or nonextractable browser import failed. No plaintext fallback was used.",
      );
    } finally {
      pkcs8?.fill(0);
      if (payload) payload.privateKeyPkcs8 = "";
      keyPair = null;
    }
  }

  async importKey(input: ImportVaultKeyInput): Promise<VaultKeyMetadata> {
    const passphrase = validatePassphrase(input.passphrase);
    const label = normalizeLabel(input.label);
    const registeredKeyId = normalizeOptionalRegisteredId(input.registeredKeyId);
    const privateHex = normalizePrivateKeyHex(input.privateKeyHex);
    const publicKeyHex = normalizePublicKeyHex(input.publicKeyHex);
    if (!privateHex || !publicKeyHex) {
      throw new AccountVaultError(
        "VAULT_INVALID_INPUT",
        "Import requires a 32-byte private seed and its matching 32-byte public key, each as 64 hex characters.",
      );
    }
    this.clearSession("LOCK");
    let seed: Uint8Array | null = null;
    let pkcs8: Uint8Array | null = null;
    let payload: VaultPayload | null = null;
    try {
      seed = hexToBytes(privateHex);
      pkcs8 = new Uint8Array(RAW_ED25519_PKCS8_PREFIX.length + seed.length);
      pkcs8.set(RAW_ED25519_PKCS8_PREFIX, 0);
      pkcs8.set(seed, RAW_ED25519_PKCS8_PREFIX.length);
      const entryId = randomId();
      payload = {
        keyId: label,
        publicKey: publicKeyHex,
        privateKeyPkcs8: bytesToBase64(pkcs8),
        userLabel: label,
        registeredKeyId,
        createdAt: this.now(),
      };
      const metadata = metadataFromPayload(payload, entryId);
      const signer = await importVerifiedSigner(pkcs8, metadata, () => this.signingNow());
      const record = await encryptPayload(payload, entryId, passphrase);
      payload.privateKeyPkcs8 = "";
      await this.storage.putEntry(record);
      const stored = await this.storage.getEntry(entryId);
      if (!stored || stored.ciphertext !== record.ciphertext) {
        throw new AccountVaultError(
          "VAULT_STORAGE",
          "The encrypted entry could not be verified after writing.",
        );
      }
      await this.rotateGeneration("VAULT_CHANGED");
      this.installSession(metadata, signer);
      return { ...metadata };
    } catch (error) {
      if (error instanceof AccountVaultError || error instanceof CanonicalRequestError) {
        throw error;
      }
      throw new AccountVaultError(
        "VAULT_AUTH_FAILED",
        "The private/public key pair could not be verified and imported. No plaintext fallback was used.",
      );
    } finally {
      seed?.fill(0);
      pkcs8?.fill(0);
      if (payload) payload.privateKeyPkcs8 = "";
    }
  }

  async unlock(entryId: string, passphrase: string): Promise<VaultKeyMetadata> {
    if (this.now() < this.lockedUntil) {
      throw new AccountVaultError(
        "VAULT_LOCKOUT",
        "Too many unlock attempts failed. Wait briefly before trying again.",
      );
    }
    validatePassphrase(passphrase);
    this.clearSession("LOCK");
    const startingGeneration = await this.ensureGeneration();
    const entry = await this.storage.getEntry(entryId);
    if (!entry) {
      throw new AccountVaultError("VAULT_NOT_FOUND", "The encrypted entry no longer exists.");
    }
    try {
      const { metadata, signer } = await decryptEntry(entry, passphrase, () => this.signingNow());
      const [currentEntry, currentGeneration] = await Promise.all([
        this.storage.getEntry(entryId),
        this.storage.getGeneration(),
      ]);
      if (
        !currentEntry ||
        currentEntry.ciphertext !== entry.ciphertext ||
        currentGeneration !== startingGeneration
      ) {
        throw new AccountVaultError(
          "VAULT_STALE",
          "The vault changed while unlocking. Review the entries and try again.",
        );
      }
      this.generation = currentGeneration;
      this.installSession(metadata, signer);
      return { ...metadata };
    } catch (error) {
      if (error instanceof AccountVaultError && error.code === "VAULT_AUTH_FAILED") {
        this.failedUnlocks += 1;
        if (this.failedUnlocks >= MAX_FAILED_UNLOCKS) {
          this.lockedUntil = this.now() + UNLOCK_LOCKOUT_MS;
          this.failedUnlocks = 0;
        }
      }
      throw error;
    }
  }

  async setRegisteredKeyId(
    entryId: string,
    passphrase: string,
    registeredKeyId: string | undefined,
  ): Promise<VaultKeyMetadata> {
    validatePassphrase(passphrase);
    const normalized = normalizeOptionalRegisteredId(registeredKeyId);
    this.clearSession("LOCK");
    const entry = await this.storage.getEntry(entryId);
    if (!entry) throw new AccountVaultError("VAULT_NOT_FOUND", "The encrypted entry no longer exists.");
    const decrypted = await decryptEntryWithPayload(entry, passphrase, () => this.signingNow());
    let plaintextRecord: EncryptedVaultEntry | null = null;
    try {
      // Reuse the single authenticated decrypt for both signer verification and
      // re-encryption. The serialized key stays local and is cleared below.
      const payload = decrypted.payload;
      payload.registeredKeyId = normalized;
      const updated = await encryptPayload(payload, entryId, passphrase);
      await this.storage.putEntry(updated);
      plaintextRecord = await this.storage.getEntry(entryId);
      if (!plaintextRecord || plaintextRecord.ciphertext !== updated.ciphertext) {
        throw new AccountVaultError("VAULT_STORAGE", "The key-ID update could not be verified.");
      }
      decrypted.signer.setRegisteredKeyId(normalized);
      const metadata = { ...decrypted.metadata, registeredKeyId: normalized };
      await this.rotateGeneration("VAULT_CHANGED");
      this.installSession(metadata, decrypted.signer);
      return metadata;
    } finally {
      decrypted.payload.privateKeyPkcs8 = "";
      plaintextRecord = null;
    }
  }

  private async requireSession(): Promise<UnlockedSession> {
    const session = this.session;
    if (!session) {
      throw new AccountVaultError("VAULT_LOCKED", "Unlock an encrypted key before signing.");
    }
    const generation = await this.storage.getGeneration();
    if (
      this.session !== session ||
      !generation ||
      generation !== session.generation ||
      session.abort.signal.aborted
    ) {
      this.clearSession("LOCK");
      throw new AccountVaultError(
        "VAULT_STALE",
        "This vault session was invalidated by a lock, wipe, or another tab. Unlock again.",
      );
    }
    return session;
  }

  async signReadRequest(input: {
    operation: ReadOnlyOperation;
    /** Exact serialized path; dynamic order details is restricted below. */
    path?: string;
    query?: string;
  }): Promise<SignedRequestResult & { headers: Record<string, string> }> {
    const operation = READ_ONLY_OPERATIONS[input.operation];
    if (!operation || operation.method !== "GET") {
      throw new AccountVaultError(
        "OPERATION_NOT_ALLOWED",
        "Only registered read-only GET operations can be signed by account analytics.",
      );
    }
    let path = operation.path as string;
    if (input.operation === "orderDetails") {
      const orderId = input.path?.startsWith("/v1/spot/orders/") ? input.path.slice("/v1/spot/orders/".length) : "";
      if (!input.path || orderId.length > 256 || !/^\/v1\/spot\/orders\/[1-9A-HJ-NP-Za-km-z]+$/.test(input.path)) {
        throw new AccountVaultError(
          "OPERATION_NOT_ALLOWED",
          "Order details requires one validated order ID in its registered path.",
        );
      }
      path = input.path;
    } else if (input.path !== undefined && input.path !== operation.path) {
      throw new AccountVaultError(
        "OPERATION_NOT_ALLOWED",
        "The requested path is not the registered path for this read-only operation.",
      );
    }
    const session = await this.requireSession();
    if (!session.metadata.registeredKeyId) {
      throw new AccountVaultError(
        "KEY_ID_REQUIRED",
        "Add the server-issued ak_... key ID before signing. A local label is never used as a fallback.",
      );
    }
    try {
      const signed = await session.signer.signCanonical({
        method: operation.method,
        path,
        query: input.query,
        operation: input.operation,
      });
      await this.requireSession();
      if (this.session !== session) throw new AccountVaultError("VAULT_STALE", "Session changed while signing.");
      return { ...signed, headers: signedHeaders(signed) };
    } catch (error) {
      if (error instanceof AccountVaultError || error instanceof CanonicalRequestError) throw error;
      if (error instanceof Error && /server-registered Polyester key ID/.test(error.message)) {
        throw new AccountVaultError("KEY_ID_REQUIRED", error.message);
      }
      throw error;
    }
  }

  async lock(): Promise<void> {
    this.clearSession("LOCK");
    await this.rotateGeneration("LOCK");
  }

  async deleteEntry(entryId: string): Promise<void> {
    if (this.session?.metadata.entryId === entryId) this.clearSession("LOCK");
    await this.storage.deleteEntry(entryId);
    await this.rotateGeneration("VAULT_CHANGED");
  }

  async wipeAll(options: { includeLegacy: boolean }): Promise<void> {
    this.clearSession("WIPE");
    // Rotate first so other tabs fail closed even if a later deletion fails.
    await this.rotateGeneration("WIPE");
    await this.storage.clearEntries();
    if (options.includeLegacy) deleteLegacyVault(this.legacyStorage);
    // The first WIPE event invalidates signers before deletion; this second
    // secret-free event lets other tabs refresh the now-empty entry list.
    this.broadcast("VAULT_CHANGED", this.generation ?? randomId());
  }

  async migrateLegacyVault(passphrase: string): Promise<number> {
    validatePassphrase(passphrase);
    const status = this.getLegacyStatus();
    if (!status.present || status.invalid) {
      throw new AccountVaultError(
        "LEGACY_INVALID",
        "The legacy record is malformed and cannot be migrated. Leave it unused or explicitly delete it.",
      );
    }
    if (!status.canMigrate) {
      throw new AccountVaultError(
        "LEGACY_UNSUPPORTED",
        "This legacy vault contains public-only records. Automatic migration is disabled to avoid discarding them.",
      );
    }
    this.clearSession("LOCK");
    const legacy = readLegacyEntries(this.legacyStorage);
    const created: string[] = [];
    let committed = false;
    try {
      for (const old of legacy) {
        let pkcs8: Uint8Array | null = null;
        let payload: VaultPayload | null = null;
        try {
          const publicKeyHex = normalizePublicKeyHex(
            old.publicKeyHex ?? pubKeyB64ToHex(old.publicKeyB64),
          );
          if (!publicKeyHex || !old.privateKeyB64) throw new Error("Invalid legacy key.");
          const label = normalizeLabel(old.keyId);
          const registeredKeyId = normalizeOptionalRegisteredId(old.registeredKeyId);
          pkcs8 = base64ToBytes(old.privateKeyB64);
          const entryId = randomId();
          payload = {
            keyId: label,
            publicKey: publicKeyHex,
            privateKeyPkcs8: old.privateKeyB64,
            userLabel: label,
            registeredKeyId,
            createdAt:
              Number.isSafeInteger(old.createdAt) && (old.createdAt ?? -1) >= 0
                ? (old.createdAt as number)
                : this.now(),
          };
          const metadata = metadataFromPayload(payload, entryId);
          // Verify the original pair, then verify a freshly read/decrypted write below.
          const probe = await importVerifiedSigner(pkcs8, metadata, () => this.signingNow());
          void probe;
          const record = await encryptPayload(payload, entryId, passphrase);
          payload.privateKeyPkcs8 = "";
          await this.storage.putEntry(record);
          created.push(entryId);
          const stored = await this.storage.getEntry(entryId);
          if (!stored) throw new Error("Encrypted migration write is missing.");
          await decryptEntry(stored, passphrase, () => this.signingNow());
        } finally {
          pkcs8?.fill(0);
          if (payload) payload.privateKeyPkcs8 = "";
        }
      }
      await this.rotateGeneration("VAULT_CHANGED");
      committed = true;
      deleteLegacyVault(this.legacyStorage);
      this.broadcast("VAULT_CHANGED", this.generation ?? randomId());
      return created.length;
    } catch (error) {
      if (!committed) {
        await Promise.all(created.map((entryId) => this.storage.deleteEntry(entryId)));
      }
      if (error instanceof AccountVaultError || error instanceof CanonicalRequestError) throw error;
      throw new AccountVaultError(
        "LEGACY_INVALID",
        "Legacy migration failed. The plaintext record remains quarantined and was not used for signing.",
      );
    }
  }

  deleteLegacy(): void {
    this.clearSession("LOCK");
    deleteLegacyVault(this.legacyStorage);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearSession("LOCK");
    if (this.channel) this.channel.onmessage = null;
    if (this.ownsChannel) this.channel?.close();
    if (typeof window !== "undefined") {
      if (this.storageListener) window.removeEventListener("storage", this.storageListener);
      if (this.pageHideListener) window.removeEventListener("pagehide", this.pageHideListener);
    }
    this.storage.close?.();
    this.listeners.clear();
  }
}
