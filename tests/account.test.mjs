import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const PASSPHRASE = "synthetic vault passphrase";
const OTHER_PASSPHRASE = "another synthetic passphrase";
const RFC8032_SEED = "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";
const RFC8032_PUBLIC = "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
const REGISTERED_ID = "ak_synthetic_read_only";

/** @type {import('vite').ViteDevServer} */
let vite;
/** @type {any} */
let core;
const localValues = new Map();
const liveVaults = [];

function syntheticPkcs8() {
  const prefix = Buffer.from("302e020100300506032b657004220420", "hex");
  return Buffer.concat([prefix, Buffer.from(RFC8032_SEED, "hex")]);
}

function makeChannelBus() {
  const channels = new Set();
  return {
    create() {
      const channel = {
        onmessage: null,
        postMessage(message) {
          for (const peer of channels) {
            if (peer !== channel) peer.onmessage?.({ data: message });
          }
        },
        close() {
          channels.delete(channel);
        },
      };
      channels.add(channel);
      return channel;
    },
  };
}

function makeVault(options = {}) {
  const storage = options.storage ?? new core.vault.MemoryVaultStorage();
  const instance = new core.vault.AccountVault({
    storage,
    legacyStorage: globalThis.localStorage,
    channel: null,
    ...options,
  });
  liveVaults.push(instance);
  return { instance, storage };
}

async function makeImportedVault(options = {}) {
  const made = makeVault(options);
  const metadata = await made.instance.importKey({
    label: "synthetic-readonly",
    passphrase: PASSPHRASE,
    registeredKeyId: REGISTERED_ID,
    privateKeyHex: RFC8032_SEED,
    publicKeyHex: RFC8032_PUBLIC,
  });
  return { ...made, metadata };
}

async function verifyWithPublicKey(signature, canonical) {
  const publicKey = await crypto.subtle.importKey(
    "raw",
    Buffer.from(RFC8032_PUBLIC, "hex"),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    { name: "Ed25519" },
    publicKey,
    Buffer.from(signature.signatureB64, "base64"),
    new TextEncoder().encode(canonical),
  );
}

before(async () => {
  globalThis.localStorage = {
    getItem: (key) => (localValues.has(key) ? localValues.get(key) : null),
    setItem: (key, value) => localValues.set(key, String(value)),
    removeItem: (key) => localValues.delete(key),
    clear: () => localValues.clear(),
  };
  vite = await createServer({
    root: rootDir,
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  core = await vite.ssrLoadModule("/packages/core/src/index.ts");
});

beforeEach(() => {
  localValues.clear();
});

after(async () => {
  for (const instance of liveVaults) instance.dispose();
  if (vite) await vite.close();
});

describe("Encrypted account vault and read-only signer (synthetic keys only)", () => {
  it("persists only authenticated ciphertext and keeps the unlocked Ed25519 key nonextractable", async () => {
    const { instance, storage, metadata } = await makeImportedVault();
    const session = instance.getSessionInfo();
    assert.equal(session.privateKeyExtractable, false);
    assert.equal(session.signal.aborted, false);
    assert.equal(session.publicKeyHex, RFC8032_PUBLIC);

    const persisted = JSON.stringify(await storage.listEntries());
    assert.equal(persisted.includes(RFC8032_SEED), false);
    assert.equal(persisted.includes(RFC8032_PUBLIC), false);
    assert.equal(persisted.includes("synthetic-readonly"), false);
    assert.equal(persisted.includes(REGISTERED_ID), false);
    assert.equal(persisted.includes("privateKeyPkcs8"), false);
    assert.equal(localValues.has(core.vault.LEGACY_STORAGE_KEY), false);

    const record = await storage.getEntry(metadata.entryId);
    assert.equal(record.format, "polytools-account-vault");
    assert.equal(record.version, 2);
    assert.equal(record.kdf.iterations, 600_000);
    assert.equal(Buffer.from(record.kdf.salt, "base64").length, 16);
    assert.equal(Buffer.from(record.cipher.iv, "base64").length, 12);
  });

  it("fails closed for a wrong passphrase and ciphertext, IV, salt, or AAD tampering", async () => {
    let clock = 1_773_964_800_123;
    const { instance, storage, metadata } = await makeImportedVault({ now: () => clock });
    await instance.lock();
    const original = await storage.getEntry(metadata.entryId);

    await assert.rejects(
      () => instance.unlock(metadata.entryId, OTHER_PASSPHRASE),
      (error) => error?.code === "VAULT_AUTH_FAILED",
    );

    const flipBase64Byte = (value, index = 0) => {
      const bytes = Buffer.from(value, "base64");
      bytes[index] ^= 1;
      return bytes.toString("base64");
    };
    const variants = [
      { ...original, ciphertext: flipBase64Byte(original.ciphertext, 4) },
      {
        ...original,
        cipher: { ...original.cipher, iv: flipBase64Byte(original.cipher.iv) },
      },
      {
        ...original,
        kdf: { ...original.kdf, salt: flipBase64Byte(original.kdf.salt) },
      },
      {
        ...original,
        kdf: { ...original.kdf, iterations: original.kdf.iterations + 1 },
      },
    ];

    for (const variant of variants) {
      await storage.putEntry(variant);
      await assert.rejects(
        () => instance.unlock(metadata.entryId, PASSPHRASE),
        (error) => error?.code === "VAULT_AUTH_FAILED",
      );
      assert.equal(instance.getSessionInfo(), null);
      await storage.putEntry(original);
    }

    await assert.rejects(
      () => instance.unlock(metadata.entryId, PASSPHRASE),
      (error) => error?.code === "VAULT_LOCKOUT",
    );
    clock += 30_001;
    const unlocked = await instance.unlock(metadata.entryId, PASSPHRASE);
    assert.equal(unlocked.publicKeyHex, RFC8032_PUBLIC);
  });

  it("starts a reloaded vault locked and can unlock the same encrypted record", async () => {
    const { storage, metadata } = await makeImportedVault();
    const { instance: reloaded } = makeVault({ storage });
    assert.equal(reloaded.getSessionInfo(), null);
    assert.deepEqual(await reloaded.listEntries(), [
      { entryId: metadata.entryId, iterations: 600_000 },
    ]);
    await reloaded.unlock(metadata.entryId, PASSPHRASE);
    assert.equal(reloaded.getSessionInfo().label, "synthetic-readonly");
    assert.equal(reloaded.getSessionInfo().privateKeyExtractable, false);
  });

  it("independently verifies Ed25519 signatures and rejects one-bit canonical mutations", async () => {
    const { instance } = await makeImportedVault();
    const signed = await instance.signReadRequest({
      operation: "fills",
      query: "symbol=BTC-USDT&limit=10",
    });
    const lines = signed.canonicalString.split("\n");
    assert.equal(lines.length, 5);
    assert.equal(lines[1], "GET");
    assert.equal(lines[2], "/v1/spot/trades");
    assert.equal(lines[3], "limit=10&symbol=BTC-USDT");
    assert.equal(lines[4], core.vault.EMPTY_BODY_SHA256);
    assert.equal(signed.keyId, REGISTERED_ID);
    assert.equal(signed.operation, "fills");
    assert.equal(signed.headers["X-API-KEY-ID"], REGISTERED_ID);
    assert.equal(signed.headers["X-API-TIMESTAMP"], signed.timestamp);
    assert.equal(signed.headers["X-API-SIGNATURE"], signed.signatureB64);
    assert.equal(await verifyWithPublicKey(signed, signed.canonicalString), true);

    const mutations = [
      `${Number(lines[0]) + 1}\n${lines.slice(1).join("\n")}`,
      [lines[0], lines[1], "/v1/balances", lines[3], lines[4]].join("\n"),
      [lines[0], lines[1], lines[2], "limit=11&symbol=BTC-USDT", lines[4]].join("\n"),
      [lines[0], lines[1], lines[2], lines[3], "0".repeat(64)].join("\n"),
    ];
    for (const canonical of mutations) {
      assert.equal(await verifyWithPublicKey(signed, canonical), false);
    }

    await assert.rejects(
      () => instance.signReadRequest({ operation: "createOrder" }),
      (error) => error?.code === "OPERATION_NOT_ALLOWED",
    );
    await assert.rejects(
      () => instance.signReadRequest({ operation: "fills", query: "a=first&a-b=second" }),
      (error) => error?.code === "AMBIGUOUS_QUERY_CONTRACT",
    );
  });

  it("never falls back to a local label and re-encrypts a validated registered key ID", async () => {
    const { instance, metadata } = await makeVaultWithNoRegisteredId();
    await assert.rejects(
      () => instance.signReadRequest({ operation: "balances" }),
      (error) => error?.code === "KEY_ID_REQUIRED",
    );
    await assert.rejects(
      () => instance.setRegisteredKeyId(metadata.entryId, PASSPHRASE, "local-label"),
      (error) => error?.code === "VAULT_INVALID_INPUT",
    );
    const subtle = crypto.subtle;
    const originalDeriveKey = subtle.deriveKey;
    let keyDerivations = 0;
    subtle.deriveKey = async function (...args) {
      keyDerivations += 1;
      return originalDeriveKey.apply(this, args);
    };
    let updated;
    try {
      updated = await instance.setRegisteredKeyId(
        metadata.entryId,
        PASSPHRASE,
        REGISTERED_ID,
      );
    } finally {
      subtle.deriveKey = originalDeriveKey;
    }
    // One decrypt for signer verification plus one encrypt for the update;
    // the old implementation performed a second decrypt as well.
    assert.equal(keyDerivations, 2);
    assert.equal(updated.registeredKeyId, REGISTERED_ID);
    const signed = await instance.signReadRequest({ operation: "balances" });
    assert.equal(signed.keyId, REGISTERED_ID);
  });

  it("allocates distinct monotonic timestamps for concurrent calls and fresh retries", async () => {
    const fixedNow = 1_773_964_800_123;
    const { instance } = await makeImportedVault({ now: () => fixedNow });
    const signed = await Promise.all(
      Array.from({ length: 16 }, () => instance.signReadRequest({ operation: "balances" })),
    );
    const timestamps = signed.map((result) => result.timestamp);
    assert.equal(new Set(timestamps).size, timestamps.length);
    const numeric = timestamps.map(BigInt);
    assert.ok(numeric.every((timestamp) => timestamp >= BigInt(fixedNow)));
    assert.ok(numeric.every((timestamp, index) => index === 0 || timestamp > numeric[index - 1]));
    const retry = await instance.signReadRequest({ operation: "balances" });
    assert.equal(timestamps.includes(retry.timestamp), false);
  });

  it("aborts and discards the session on idle lock", async () => {
    const { instance } = await makeImportedVault({ idleTimeoutMs: 25 });
    const signal = instance.getSessionInfo().signal;
    await new Promise((resolve) => setTimeout(resolve, 90));
    assert.equal(instance.getSessionInfo(), null);
    assert.equal(signal.aborted, true);
    await assert.rejects(
      () => instance.signReadRequest({ operation: "balances" }),
      (error) => error?.code === "VAULT_LOCKED" || error?.code === "VAULT_STALE",
    );
  });

  it("coordinates cross-tab lock/wipe and fails a missed-message tab closed on its next sign", async () => {
    const bus = makeChannelBus();
    const storage = new core.vault.MemoryVaultStorage();
    const first = makeVault({ storage, channel: bus.create() }).instance;
    const second = makeVault({ storage, channel: bus.create() }).instance;
    const metadata = await first.importKey({
      label: "synthetic-readonly",
      passphrase: PASSPHRASE,
      registeredKeyId: REGISTERED_ID,
      privateKeyHex: RFC8032_SEED,
      publicKeyHex: RFC8032_PUBLIC,
    });
    await second.unlock(metadata.entryId, PASSPHRASE);
    const secondSignal = second.getSessionInfo().signal;

    await first.lock();
    assert.equal(first.getSessionInfo(), null);
    assert.equal(second.getSessionInfo(), null);
    assert.equal(secondSignal.aborted, true);

    // This tab deliberately has no channel, simulating a missed control event.
    const stale = makeVault({ storage, channel: null }).instance;
    await stale.unlock(metadata.entryId, PASSPHRASE);
    await second.wipeAll({ includeLegacy: true });
    await assert.rejects(
      () => stale.signReadRequest({ operation: "balances" }),
      (error) => error?.code === "VAULT_STALE",
    );
    assert.equal(stale.getSessionInfo(), null);
    assert.equal((await storage.listEntries()).length, 0);
  });

  it("migrates only after encrypted read-back verification and removes the legacy plaintext record", async () => {
    const pkcs8 = syntheticPkcs8();
    localValues.set(
      core.vault.LEGACY_STORAGE_KEY,
      JSON.stringify([
        {
          keyId: "synthetic-legacy",
          publicKeyHex: RFC8032_PUBLIC,
          publicKeyB64: Buffer.from(RFC8032_PUBLIC, "hex").toString("base64"),
          privateKeyB64: pkcs8.toString("base64"),
          registeredKeyId: REGISTERED_ID,
          createdAt: 1_700_000_000_000,
        },
      ]),
    );
    const { instance, storage } = makeVault();
    assert.deepEqual(instance.getLegacyStatus(), {
      present: true,
      invalid: false,
      signCapableCount: 1,
      publicOnlyCount: 0,
      canMigrate: true,
    });
    assert.equal(await instance.migrateLegacyVault(PASSPHRASE), 1);
    assert.equal(localValues.has(core.vault.LEGACY_STORAGE_KEY), false);
    const entries = await storage.listEntries();
    assert.equal(entries.length, 1);
    const persisted = JSON.stringify(entries);
    assert.equal(persisted.includes(RFC8032_SEED), false);
    assert.equal(persisted.includes(pkcs8.toString("base64")), false);
    await instance.unlock(entries[0].entryId, PASSPHRASE);
    assert.equal(instance.getSessionInfo().label, "synthetic-legacy");
    assert.equal(instance.getSessionInfo().privateKeyExtractable, false);
  });

  it("keeps plaintext quarantined and rolls back new entries when migration is interrupted", async () => {
    const legacyJson = JSON.stringify([
      {
        keyId: "synthetic-legacy",
        publicKeyHex: RFC8032_PUBLIC,
        publicKeyB64: Buffer.from(RFC8032_PUBLIC, "hex").toString("base64"),
        privateKeyB64: syntheticPkcs8().toString("base64"),
        registeredKeyId: REGISTERED_ID,
        createdAt: 1_700_000_000_000,
      },
    ]);
    localValues.set(core.vault.LEGACY_STORAGE_KEY, legacyJson);
    const storage = new core.vault.MemoryVaultStorage();
    storage.putEntry = async () => {
      throw new Error("synthetic interrupted write");
    };
    const { instance } = makeVault({ storage });
    await assert.rejects(() => instance.migrateLegacyVault(PASSPHRASE));
    assert.equal(localValues.get(core.vault.LEGACY_STORAGE_KEY), legacyJson);
    assert.equal((await storage.listEntries()).length, 0);
    assert.equal(instance.getSessionInfo(), null);
  });

  it("wipes encrypted and legacy records without touching unrelated public preferences", async () => {
    localValues.set("poly-tools:theme", "dark");
    localValues.set(core.vault.LEGACY_STORAGE_KEY, "malformed legacy plaintext");
    const { instance, storage } = await makeImportedVault();
    await instance.wipeAll({ includeLegacy: true });
    assert.equal(localValues.get("poly-tools:theme"), "dark");
    assert.equal(localValues.has(core.vault.LEGACY_STORAGE_KEY), false);
    assert.equal((await storage.listEntries()).length, 0);
    assert.equal(instance.getSessionInfo(), null);
  });

  it("applies a validated server clock offset to signing timestamps", async () => {
    const localNow = 1_900_000_000_000;
    const { instance } = await makeImportedVault({ now: () => localNow });
    instance.setClockSkew(7_500);
    assert.equal(instance.getClockSkew(), 7_500);
    const signed = await instance.signReadRequest({ operation: "balances" });
    assert.equal(signed.timestamp, String(localNow + 7_500));
    assert.equal(signed.canonicalString.split("\n")[0], signed.timestamp);
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      assert.throws(() => instance.setClockSkew(invalid), (error) => error?.code === "VAULT_INVALID_INPUT");
    }
  });

  it("does not substitute the empty-body hash when WebCrypto is unavailable", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      await assert.rejects(
        () => core.vault.sha256Hex("nonempty synthetic body"),
        (error) => error?.code === "CRYPTO_UNAVAILABLE",
      );
    } finally {
      if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
    }
  });
});

async function makeVaultWithNoRegisteredId() {
  const made = makeVault();
  const metadata = await made.instance.importKey({
    label: "synthetic-readonly",
    passphrase: PASSPHRASE,
    privateKeyHex: RFC8032_SEED,
    publicKeyHex: RFC8032_PUBLIC,
  });
  return { ...made, metadata };
}
