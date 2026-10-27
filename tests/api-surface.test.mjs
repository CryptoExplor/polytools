/**
 * The API surface catalogue must stay true to the installed SDK.
 *
 * The catalogue exists because the guide previously described endpoints from
 * memory. These tests make regression impossible: if an RPC disappears from the
 * SDK, or a row is added that the SDK does not declare, this fails.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const GEN_DIR = resolve(rootDir, "node_modules/@polyester/sdk/dist/gen");

let vite;
let surface;

before(async () => {
  vite = await createServer({ root: rootDir, logLevel: "silent", server: { middlewareMode: true } });
  surface = await vite.ssrLoadModule("/apps/web/src/lib/apiSurface.ts");
});

after(async () => {
  if (vite) await vite.close();
});

/** Every RPC declared by the installed SDK, as `pkg.Service/Method`. */
function declaredRpcs() {
  const found = new Set();
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!name.endsWith(".d.ts")) continue;
      const text = readFileSync(path, "utf8");
      for (const match of text.matchAll(/@generated from rpc ([A-Za-z0-9_.]+)/g)) {
        const parts = match[1].split(".");
        const method = parts.pop();
        found.add(`${parts.join(".")}/${method}`);
      }
    }
  };
  walk(GEN_DIR);
  return found;
}

describe("API surface — every row is declared by the installed SDK", () => {
  it("finds RPCs in the generated protos at all", () => {
    const rpcs = declaredRpcs();
    assert.ok(rpcs.size > 50, `expected a populated proto tree, found ${rpcs.size} RPCs`);
  });

  it("lists no RPC that the SDK does not declare", () => {
    const declared = declaredRpcs();
    const missing = surface.API_SURFACE.filter((entry) => !declared.has(entry.rpc)).map((e) => e.rpc);
    assert.deepEqual(missing, [], `catalogue references RPCs absent from the SDK: ${missing.join(", ")}`);
  });

  it("has no duplicate entries", () => {
    const seen = new Set();
    for (const entry of surface.API_SURFACE) {
      assert.ok(!seen.has(entry.rpc), `duplicate catalogue entry: ${entry.rpc}`);
      seen.add(entry.rpc);
    }
  });

  it("derives service and method from the rpc string consistently", () => {
    for (const entry of surface.API_SURFACE) {
      const [service, method] = entry.rpc.split("/");
      assert.equal(entry.service, service, `${entry.rpc}: service mismatch`);
      assert.equal(entry.method, method, `${entry.rpc}: method mismatch`);
    }
  });
});

describe("API surface — read/write classification", () => {
  // `Me` is the one read that carries no verb: it returns the caller identity.
  const READ_PREFIXES = ["Get", "List", "Preview", "Me"];
  const WRITE_PREFIXES = ["Create", "Update", "Claim", "Cancel", "Start", "Login", "Accept", "Social", "Delete"];

  it("classifies by side effect, not by who may call it", () => {
    for (const entry of surface.API_SURFACE) {
      const isRead = READ_PREFIXES.some((p) => entry.method.startsWith(p));
      const isWrite = WRITE_PREFIXES.some((p) => entry.method.startsWith(p));
      assert.ok(isRead || isWrite, `${entry.rpc}: unclassifiable method name`);
      assert.equal(
        entry.mode,
        isRead ? "read" : "write",
        `${entry.rpc} is marked "${entry.mode}" but its name implies otherwise`,
      );
    }
  });

  it("counts agree with the entries", () => {
    const counts = surface.surfaceCounts();
    assert.equal(counts.total, surface.API_SURFACE.length);
    assert.equal(counts.reads + counts.writes, counts.total);
    assert.equal(
      counts.writes,
      surface.API_SURFACE.filter((e) => e.mode === "write").length,
    );
  });
});

describe("API surface — PolyTools stays read-only", () => {
  /**
   * Two auth calls are now made for real, from the server, for wallet login:
   * the challenge request and the signature-for-token exchange. Neither places
   * an order, cancels one, moves funds, or changes a profile — but they are
   * POSTs with a server-side effect, so the old blanket rule ("no write RPC in
   * application code, ever") would either be violated or be quietly deleted.
   * Instead it is narrowed to the property that actually matters, and the
   * exception is pinned to one named file.
   */
  const AUTH_TRANSPORT_RPCS = new Set([
    "auth.v1.AuthService/CreateWalletChallenge",
    "auth.v1.AuthService/LoginWithWallet",
  ]);
  const AUTH_TRANSPORT_FILE = "backend/src/authProxy.ts";

  const APP_SOURCES = [
    "apps/web/src",
    "packages/core/src",
    "backend/src",
  ];

  function* walk(relative) {
    let entries = [];
    try {
      entries = readdirSync(resolve(rootDir, relative), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) yield* walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name) && entry.name !== "apiSurface.ts") yield path;
    }
  }

  function references(rpc) {
    const hits = [];
    for (const dir of APP_SOURCES) {
      for (const file of walk(dir)) {
        if (readFileSync(resolve(rootDir, file), "utf8").includes(rpc)) hits.push(file);
      }
    }
    return hits;
  }

  it("places no order and mutates no trading or account state, anywhere", () => {
    const offenders = [];
    for (const entry of surface.API_SURFACE) {
      if (entry.mode !== "write" || AUTH_TRANSPORT_RPCS.has(entry.rpc)) continue;
      for (const file of references(entry.rpc)) offenders.push(`${file} → ${entry.rpc}`);
    }
    assert.deepEqual(offenders, [], `application code calls a mutating RPC: ${offenders.join(", ")}`);
  });

  it("confines the two login RPCs to the named auth transport file", () => {
    const where = new Map();
    for (const rpc of AUTH_TRANSPORT_RPCS) where.set(rpc, references(rpc));
    for (const [rpc, files] of where) {
      assert.deepEqual(files, [AUTH_TRANSPORT_FILE], `${rpc} may only appear in ${AUTH_TRANSPORT_FILE}`);
    }
  });

  it("keeps the browser out of the exchange's auth API entirely", () => {
    // Login is server-side on purpose: the exchange sends no CORS header to our
    // origin, so an in-page call cannot work. The frontend must call /api/auth/*.
    const offenders = [];
    for (const file of walk("apps/web/src")) {
      const text = readFileSync(resolve(rootDir, file), "utf8");
      for (const rpc of AUTH_TRANSPORT_RPCS) {
        if (text.includes(rpc) || text.includes("auth.v1.AuthService/")) offenders.push(`${file} → ${rpc}`);
      }
    }
    assert.deepEqual(offenders, [], `frontend must not call the auth API directly: ${offenders.join(", ")}`);
  });
});

describe("API surface — documented auth is not invented", () => {
  it("states 'public' only for the one documented public method", () => {
    const publicRpcs = surface.API_SURFACE.filter((e) => e.auth === "public").map((e) => e.rpc);
    assert.deepEqual(publicRpcs, ["auth.v1.AuthService/CreateWalletChallenge"]);
  });

  it("uses 'interactive-session' only where the reference says API keys may not act", () => {
    const interactive = surface.API_SURFACE.filter((e) => e.auth === "interactive-session").map((e) => e.rpc);
    assert.deepEqual(interactive, ["auth.v1.AuthService/AcceptTerms"]);
  });

  it("leaves the rest explicitly unspecified rather than guessed", () => {
    const unspecified = surface.API_SURFACE.filter((e) => e.auth === "unspecified");
    assert.ok(unspecified.length > 0, "unspecified is the honest default for undocumented methods");
  });
});

describe("API surface — encoding notes cover the fields that bite", () => {
  it("documents every scale-sensitive field", () => {
    const notes = surface.ENCODING_NOTES;
    for (const key of ["priceTicks", "qtyScaled", "u128Amounts", "symbolId"]) {
      assert.ok(notes[key] && notes[key].length > 40, `missing encoding note: ${key}`);
    }
  });

  it("warns that a fixed price divider is wrong", () => {
    assert.match(surface.ENCODING_NOTES.priceTicks, /referencePriceScale/);
    assert.match(surface.ENCODING_NOTES.priceTicks, /not by a fixed 1e9/i);
  });

  it("warns that reading only the low word truncates", () => {
    assert.match(surface.ENCODING_NOTES.u128Amounts, /hi \* 2\^64 \+ lo/);
    assert.match(surface.ENCODING_NOTES.u128Amounts, /truncates silently/i);
  });
});

describe("API surface — lookups", () => {
  it("finds an entry by rpc path", () => {
    assert.equal(surface.findSurface("orderbook.v1.OrderbookService/GetOrderBook")?.mode, "read");
    assert.equal(surface.findSurface("nope.v1.Nope/Nope"), null);
  });

  it("groups by service in the documented order", () => {
    const groups = surface.surfaceByService();
    assert.equal(groups[0].service, "auth.v1.AuthService");
    const total = groups.reduce((sum, g) => sum + g.entries.length, 0);
    assert.equal(total, surface.API_SURFACE.length);
  });

  it("searches across rpc, summary and field names", () => {
    const byName = surface.API_SURFACE.filter((e) => surface.matchesSurfaceQuery(e, "orderbook"));
    assert.ok(byName.length >= 1);
    const byField = surface.API_SURFACE.filter((e) => surface.matchesSurfaceQuery(e, "symbolId"));
    assert.ok(byField.some((e) => e.method === "GetOrderBook"));
    assert.equal(surface.API_SURFACE.filter((e) => surface.matchesSurfaceQuery(e, "")).length, surface.API_SURFACE.length);
  });
});
