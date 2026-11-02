/**
 * Rename compatibility (PolyTools → Polyap, docs/decisions/0001-rename-to-polyap.md).
 *
 * The brand changed, but anything already stored in a user's browser, written
 * into an export, or set in a deployment's environment must keep working.
 */
import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import {
  isCiEnvironment,
  liveTestAllowed,
  liveTestOptInValue,
} from "../scripts/live-test-gate.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));

let vite;
let core;
let provenance;

before(async () => {
  vite = await createServer({
    root: rootDir,
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  core = await vite.ssrLoadModule("/packages/core/src/index.ts");
  provenance = await vite.ssrLoadModule("/apps/web/src/lib/provenance.ts");
});

after(async () => {
  if (vite) await vite.close();
});

describe("persisted identifiers keep their pre-rename values", () => {
  it("vault, cache, export, and preference identifiers are byte-for-byte unchanged", () => {
    assert.equal(core.PERSISTED_VAULT_FORMAT, "polytools-account-vault");
    assert.equal(core.PERSISTED_VAULT_DATABASE_NAME, "polytools-account-vault");
    assert.equal(core.PERSISTED_VAULT_CHANNEL_NAME, "polytools-account-vault-control");
    assert.equal(core.PERSISTED_LEGACY_VAULT_STORAGE_KEY, "poly-tools:vault:v1");
    assert.equal(core.PERSISTED_VAULT_CONTROL_STORAGE_KEY, "poly-tools:vault:v2:event");
    assert.equal(core.PERSISTED_VAULT_KEYPAIR_CHALLENGE, "PolyTools vault key-pair verification v1");
    assert.equal(core.PERSISTED_PUBLIC_CACHE_FORMAT, "polytools-public-cache@1");
    assert.equal(core.PERSISTED_PUBLIC_CACHE_DATABASE_NAME, "polytools-public-cache");
    assert.equal(core.PERSISTED_PUBLIC_CACHE_RELATIVE_BASE, "https://relative.polytools.invalid");
    assert.equal(core.PERSISTED_ACCOUNT_EXPORT_SCHEMA_VERSION, "polytools.account-export.v2");
    assert.equal(core.PERSISTED_ACCOUNT_EXPORT_FILENAME_PREFIX, "polytools-testnet");
    assert.deepEqual(core.PERSISTED_WEB_STORAGE_KEYS, {
      intro: "poly-tools:intro:v1",
      symbol: "poly-tools:symbol",
      theme: "poly-tools:theme",
      watch: "poly-tools:watch:v1",
      hubChecklist: "poly-tools:hub-checklist",
    });
  });

  it("the vault module still exports the same values under its own names", () => {
    assert.equal(core.vault.VAULT_FORMAT, core.PERSISTED_VAULT_FORMAT);
    assert.equal(core.vault.VAULT_DATABASE_NAME, core.PERSISTED_VAULT_DATABASE_NAME);
    assert.equal(core.vault.VAULT_CHANNEL_NAME, core.PERSISTED_VAULT_CHANNEL_NAME);
    assert.equal(core.vault.LEGACY_STORAGE_KEY, core.PERSISTED_LEGACY_VAULT_STORAGE_KEY);
    assert.equal(core.vault.VAULT_CONTROL_STORAGE_KEY, core.PERSISTED_VAULT_CONTROL_STORAGE_KEY);
  });
});

describe("wire-sample header stays compatible", () => {
  it("keeps sending the legacy header name and reads either name", () => {
    assert.equal(provenance.WIRE_SAMPLE_HEADER, "x-polytools-data-source");
    assert.equal(provenance.WIRE_SAMPLE_HEADER_ALIAS, "x-polyap-data-source");
    assert.equal(
      provenance.wireSampleDataSource(new Headers({ "x-polytools-data-source": "wire-samples" })),
      "wire-samples",
    );
    assert.equal(
      provenance.wireSampleDataSource(new Headers({ "x-polyap-data-source": "wire-samples" })),
      "wire-samples",
    );
    assert.equal(provenance.wireSampleDataSource(new Headers()), null);
  });
});

describe("live verification opt-in: POLYAP_LIVE_TEST with legacy fallback", () => {
  it("accepts the new name", () => {
    assert.equal(liveTestAllowed({ POLYAP_LIVE_TEST: "1" }), true);
  });

  it("still accepts the legacy POLYTOOLS_LIVE_TEST name on its own", () => {
    assert.equal(liveTestAllowed({ POLYTOOLS_LIVE_TEST: "1" }), true);
  });

  it("prefers the new name when both are set", () => {
    assert.equal(liveTestOptInValue({ POLYAP_LIVE_TEST: "0", POLYTOOLS_LIVE_TEST: "1" }), "0");
    assert.equal(liveTestAllowed({ POLYAP_LIVE_TEST: "0", POLYTOOLS_LIVE_TEST: "1" }), false);
  });

  it("treats a blank new name as unset", () => {
    assert.equal(liveTestAllowed({ POLYAP_LIVE_TEST: " ", POLYTOOLS_LIVE_TEST: "1" }), true);
  });

  it("refuses without an opt-in, and always refuses in CI", () => {
    assert.equal(liveTestAllowed({}), false);
    assert.equal(liveTestAllowed({ POLYAP_LIVE_TEST: "true" }), false);
    assert.equal(isCiEnvironment({ CI: "true" }), true);
    assert.equal(liveTestAllowed({ POLYAP_LIVE_TEST: "1", CI: "true" }), false);
    assert.equal(liveTestAllowed({ POLYTOOLS_LIVE_TEST: "1", GITHUB_ACTIONS: "1" }), false);
  });

  it("the runner refuses before reading .env when nothing opts in", () => {
    const env = { ...process.env };
    delete env.POLYAP_LIVE_TEST;
    delete env.POLYTOOLS_LIVE_TEST;
    const result = spawnSync(process.execPath, [`${rootDir}/scripts/live-test.mjs`], {
      env,
      encoding: "utf8",
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Refusing live verification\. Run only locally with POLYAP_LIVE_TEST=1/);
  });
});
