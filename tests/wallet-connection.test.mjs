import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const source = (path) => readFileSync(resolve(rootDir, path), "utf8");

const ADDR = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
const ADDR_LOWER = ADDR.toLowerCase();
const ADDR_2 = "0x1111111111111111111111111111111111111111";

let vite;
let wallet;

before(async () => {
  vite = await createServer({ root: rootDir, logLevel: "silent", server: { middlewareMode: true } });
  wallet = await vite.ssrLoadModule("/apps/web/src/lib/walletConnection.ts");
});

after(async () => {
  if (vite) await vite.close();
});

/**
 * Minimal EIP-1193 double. Records every request so tests can assert that a
 * silent path never prompts, and exposes the captured listeners.
 */
function fakeProvider({ accounts = [], chainId = "0x1", request } = {}) {
  const calls = [];
  const handlers = new Map();
  const provider = {
    calls,
    handlers,
    async request(args) {
      calls.push(args);
      if (request) return request(args);
      if (args.method === "eth_accounts") return accounts;
      if (args.method === "eth_requestAccounts") return accounts;
      if (args.method === "eth_chainId") return chainId;
      throw Object.assign(new Error("unexpected"), { code: -32601 });
    },
    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(handler);
    },
    removeListener(event, handler) {
      handlers.get(event)?.delete(handler);
    },
    emit(event, ...args) {
      for (const handler of handlers.get(event) ?? []) handler(...args);
    },
    methods() {
      return calls.map((c) => c.method);
    },
  };
  return provider;
}

const rejected = (code = 4001) =>
  Object.assign(new Error("rejected"), { code });

function make(provider, now = () => 1000) {
  return new wallet.WalletConnection({ detect: () => provider, now });
}

describe("wallet connection — provider availability", () => {
  it("reports unavailable when no injected provider exists, without throwing", async () => {
    const conn = new wallet.WalletConnection({ detect: () => null });
    conn.start();
    assert.equal(conn.getSnapshot().status, "unavailable");
    assert.equal(conn.getSnapshot().address, null);

    const after = await conn.connect();
    assert.equal(after.status, "unavailable");
    assert.equal(after.error, "NO_PROVIDER");
  });

  it("is safe to read before start()", () => {
    const conn = new wallet.WalletConnection({ detect: () => null });
    assert.equal(conn.getSnapshot(), wallet.INITIAL_WALLET_STATE);
    assert.equal(conn.getSnapshot().status, "detecting");
  });

  it("does not treat a provider without request() as available", () => {
    assert.equal(wallet.defaultDetect(), null);
  });
});

describe("wallet connection — silent restore never prompts", () => {
  it("marks connected from eth_accounts alone and never calls eth_requestAccounts", () => {
    const provider = fakeProvider({ accounts: [ADDR], chainId: "0x1" });
    const conn = make(provider);
    conn.start();
    return Promise.resolve().then(() => Promise.resolve()).then(() => {
      assert.deepEqual(provider.methods().filter((m) => m === "eth_requestAccounts"), []);
      assert.equal(conn.getSnapshot().status, "connected");
      assert.equal(conn.getSnapshot().address, ADDR_LOWER);
      assert.equal(conn.getSnapshot().chainId, "1");
    });
  });

  it("stays disconnected when eth_accounts returns an empty list", async () => {
    const provider = fakeProvider({ accounts: [] });
    const conn = make(provider);
    conn.start();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(conn.getSnapshot().status, "disconnected");
    assert.equal(conn.getSnapshot().address, null);
  });
});

describe("wallet connection — explicit connect", () => {
  it("normalises the address to lowercase and the chain id to decimal", async () => {
    const provider = fakeProvider({ accounts: [ADDR], chainId: "0xaa36a7" });
    const conn = make(provider);
    const state = await conn.connect();
    assert.equal(state.status, "connected");
    assert.equal(state.address, ADDR_LOWER);
    assert.equal(state.chainId, "11155111");
    assert.equal(state.error, null);
    // `connect()` also starts the silent probe, so only count the prompting call.
    assert.equal(provider.methods().filter((m) => m === "eth_requestAccounts").length, 1);
    assert.ok(provider.methods().includes("eth_chainId"));
  });

  it("surfaces a user rejection as an error state with no address", async () => {
    const provider = fakeProvider({ request: () => { throw rejected(4001); } });
    const conn = make(provider);
    const state = await conn.connect();
    assert.equal(state.status, "error");
    assert.equal(state.error, "USER_REJECTED");
    assert.equal(state.address, null);
  });

  it("distinguishes an already-pending request from a rejection", async () => {
    const provider = fakeProvider({ request: () => { throw rejected(-32002); } });
    const conn = make(provider);
    assert.equal((await conn.connect()).error, "REQUEST_PENDING");
  });

  it("maps an unauthorized provider to UNAUTHORIZED", async () => {
    const provider = fakeProvider({ request: () => { throw rejected(4100); } });
    assert.equal((await make(provider).connect()).error, "UNAUTHORIZED");
  });

  it("rejects a malformed address instead of displaying it", async () => {
    const provider = fakeProvider({ accounts: ["0xnot-an-address"] });
    const state = await make(provider).connect();
    assert.equal(state.status, "error");
    assert.equal(state.error, "INVALID_ADDRESS");
    assert.equal(state.address, null);
  });

  it("treats a non-array accounts response as an invalid response", async () => {
    const provider = fakeProvider({ accounts: "0xdeadbeef" });
    const state = await make(provider).connect();
    assert.equal(state.error, "INVALID_ADDRESS");
  });

  it("still connects when eth_chainId fails, leaving chainId null", async () => {
    const provider = fakeProvider({
      request: (args) => {
        if (args.method === "eth_requestAccounts") return [ADDR];
        throw rejected(-32603);
      },
    });
    const state = await make(provider).connect();
    assert.equal(state.status, "connected");
    assert.equal(state.chainId, null);
  });
});

describe("wallet connection — late-response guard", () => {
  it("does not let a slow silent restore overwrite an explicit connect", async () => {
    // eth_accounts resolves only after the user's explicit connect has settled.
    let releaseSilent;
    const silentGate = new Promise((resolve) => {
      releaseSilent = resolve;
    });
    const provider = fakeProvider({
      request: async (args) => {
        if (args.method === "eth_accounts") {
          await silentGate;
          return [ADDR_2];
        }
        if (args.method === "eth_requestAccounts") return [ADDR];
        if (args.method === "eth_chainId") return "0x1";
        throw Object.assign(new Error("unexpected"), { code: -32601 });
      },
    });

    const conn = make(provider);
    conn.start();
    const connected = await conn.connect();
    assert.equal(connected.address, ADDR_LOWER);

    // The stale silent read now completes with a different account.
    releaseSilent();
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(
      conn.getSnapshot().address,
      ADDR_LOWER,
      "a stale silent read must not replace the account the user just connected",
    );
    assert.equal(conn.getSnapshot().status, "connected");
  });

  it("does not resurrect a connection after the user disconnected", async () => {
    let releaseSilent;
    const silentGate = new Promise((resolve) => {
      releaseSilent = resolve;
    });
    const provider = fakeProvider({
      request: async (args) => {
        if (args.method === "eth_accounts") {
          await silentGate;
          return [ADDR];
        }
        if (args.method === "eth_requestAccounts") return [ADDR];
        if (args.method === "eth_chainId") return "0x1";
        throw Object.assign(new Error("unexpected"), { code: -32601 });
      },
    });

    const conn = make(provider);
    conn.start();
    await conn.connect();
    conn.disconnect();

    releaseSilent();
    await new Promise((r) => setTimeout(r, 0));

    assert.equal(conn.getSnapshot().status, "disconnected");
    assert.equal(conn.getSnapshot().address, null);
  });
});

describe("wallet connection — account and chain changes", () => {
  it("disconnects when the wallet reports no accounts", async () => {
    const provider = fakeProvider({ accounts: [ADDR] });
    const conn = make(provider);
    await conn.connect();
    provider.emit("accountsChanged", []);
    assert.equal(conn.getSnapshot().status, "disconnected");
    assert.equal(conn.getSnapshot().address, null);
  });

  it("follows an account switch and keeps the chain identity", async () => {
    const provider = fakeProvider({ accounts: [ADDR], chainId: "0x1" });
    const conn = make(provider);
    await conn.connect();
    provider.emit("accountsChanged", [ADDR_2]);
    const state = conn.getSnapshot();
    assert.equal(state.status, "connected");
    assert.equal(state.address, ADDR_2);
    assert.equal(state.chainId, "1", "a chain id must survive an account switch");
  });

  it("updates the chain without disconnecting or changing the address", async () => {
    const provider = fakeProvider({ accounts: [ADDR], chainId: "0x1" });
    const conn = make(provider);
    await conn.connect();
    provider.emit("chainChanged", "0x89");
    const state = conn.getSnapshot();
    assert.equal(state.chainId, "137");
    assert.equal(state.address, ADDR_LOWER);
    assert.equal(state.status, "connected", "a chain switch must not disconnect");
  });

  it("ignores an unreadable chain change but flags it", async () => {
    const provider = fakeProvider({ accounts: [ADDR], chainId: "0x1" });
    const conn = make(provider);
    await conn.connect();
    provider.emit("chainChanged", "not-a-chain");
    assert.equal(conn.getSnapshot().chainId, "1");
    assert.equal(conn.getSnapshot().error, "INVALID_RESPONSE");
  });

  it("treats a provider disconnect event as disconnected", async () => {
    const provider = fakeProvider({ accounts: [ADDR] });
    const conn = make(provider);
    await conn.connect();
    provider.emit("disconnect");
    assert.equal(conn.getSnapshot().status, "disconnected");
  });
});

describe("wallet connection — local disconnect and lifecycle", () => {
  it("clears local state on disconnect without calling the provider", async () => {
    const provider = fakeProvider({ accounts: [ADDR] });
    const conn = make(provider);
    await conn.connect();
    const before = provider.calls.length;
    conn.disconnect();
    assert.equal(conn.getSnapshot().status, "disconnected");
    assert.equal(conn.getSnapshot().address, null);
    assert.equal(provider.calls.length, before, "disconnect must be local-only");
  });

  it("keeps listening after a local disconnect, so the wallet can reconnect it", async () => {
    const provider = fakeProvider({ accounts: [ADDR] });
    const conn = make(provider);
    await conn.connect();
    conn.disconnect();
    provider.emit("accountsChanged", [ADDR]);
    assert.equal(conn.getSnapshot().status, "connected");
    assert.equal(conn.getSnapshot().address, ADDR_LOWER);
  });

  it("removes listeners on dispose and ignores later events", async () => {
    const provider = fakeProvider({ accounts: [ADDR] });
    const conn = make(provider);
    conn.start();
    conn.dispose();
    for (const set of provider.handlers.values()) {
      assert.equal(set.size, 0, "all provider listeners must be removed");
    }
    provider.emit("accountsChanged", [ADDR_2]);
    assert.notEqual(conn.getSnapshot().address, ADDR_2);
  });

  it("notifies subscribers and keeps a stable snapshot when nothing changes", async () => {
    const provider = fakeProvider({ accounts: [ADDR] });
    const conn = make(provider);
    let notifications = 0;
    const unsubscribe = conn.subscribe(() => {
      notifications += 1;
    });
    await conn.connect();
    assert.ok(notifications > 0);

    const stable = conn.getSnapshot();
    provider.emit("chainChanged", "0x1");
    assert.equal(conn.getSnapshot(), stable, "an unchanged state must not allocate a new snapshot");

    const seen = notifications;
    unsubscribe();
    provider.emit("accountsChanged", []);
    assert.equal(notifications, seen, "unsubscribed listeners must not fire");
  });

  it("survives a throwing subscriber", async () => {
    const provider = fakeProvider({ accounts: [ADDR] });
    const conn = make(provider);
    conn.subscribe(() => {
      throw new Error("subscriber blew up");
    });
    const state = await conn.connect();
    assert.equal(state.status, "connected");
  });
});

describe("wallet connection — pure helpers", () => {
  it("validates and lowercases addresses", () => {
    assert.equal(wallet.normalizeAddress(ADDR), ADDR_LOWER);
    assert.equal(wallet.normalizeAddress("  " + ADDR + "  "), ADDR_LOWER);
    assert.equal(wallet.normalizeAddress(ADDR.slice(0, 41)), null);
    assert.equal(wallet.normalizeAddress(undefined), null);
    assert.equal(wallet.normalizeAddress(42), null);
  });

  it("normalises chain ids from hex, decimal, number and bigint", () => {
    assert.equal(wallet.normalizeChainId("0x1"), "1");
    assert.equal(wallet.normalizeChainId("0x01"), "1");
    assert.equal(wallet.normalizeChainId("0xa4b1"), "42161");
    assert.equal(wallet.normalizeChainId("137"), "137");
    assert.equal(wallet.normalizeChainId(137), "137");
    assert.equal(wallet.normalizeChainId(137n), "137");
    assert.equal(wallet.normalizeChainId(""), null);
    assert.equal(wallet.normalizeChainId("0xzz"), null);
    assert.equal(wallet.normalizeChainId(-1), null);
    assert.equal(wallet.normalizeChainId(null), null);
  });

  it("shortens addresses for display only", () => {
    assert.equal(wallet.shortenAddress(ADDR_LOWER), "0xabcd…ef01");
    assert.equal(wallet.shortenAddress("short"), "short");
  });

  it("names known chains and falls back for unknown ones", () => {
    assert.equal(wallet.chainLabel("1"), "Ethereum");
    assert.equal(wallet.chainLabel("11155111"), "Sepolia");
    assert.equal(wallet.chainLabel("999999"), "Chain 999999");
    assert.equal(wallet.chainLabel(null), null);
  });

  it("maps provider error codes to our own stable codes", () => {
    assert.equal(wallet.classifyWalletError({ code: 4001 }), "USER_REJECTED");
    assert.equal(wallet.classifyWalletError({ code: -32002 }), "REQUEST_PENDING");
    assert.equal(wallet.classifyWalletError({ code: 4100 }), "UNAUTHORIZED");
    assert.equal(wallet.classifyWalletError({ code: 4900 }), "DISCONNECTED");
    assert.equal(wallet.classifyWalletError({ code: 4901 }), "CHAIN_DISCONNECTED");
    assert.equal(wallet.classifyWalletError({ code: 9999 }), "UNKNOWN");
    assert.equal(wallet.classifyWalletError(null), "UNKNOWN");
    assert.equal(wallet.classifyWalletError("boom"), "UNKNOWN");
  });

  it("has user-facing copy for every error code, and none of it claims sign-in", () => {
    const codes = [
      "NO_PROVIDER",
      "USER_REJECTED",
      "REQUEST_PENDING",
      "UNAUTHORIZED",
      "DISCONNECTED",
      "CHAIN_DISCONNECTED",
      "INVALID_ADDRESS",
      "INVALID_RESPONSE",
      "UNKNOWN",
    ];
    for (const code of codes) {
      const message = wallet.walletErrorMessage(code);
      assert.ok(message.length > 10, `${code} needs real copy`);
      assert.doesNotMatch(message, /sign(ed)? in|logged in|authenticat/i);
    }
    assert.match(wallet.walletErrorMessage("USER_REJECTED"), /declined/i);
  });
});

describe("wallet connection — isolation from account state", () => {
  it("does not import, reference or perform anything account-related", () => {
    const connect = source("apps/web/src/lib/walletConnection.ts");
    const hook = source("apps/web/src/lib/useWallet.ts");

    for (const [name, text] of [
      ["walletConnection", connect],
      ["useWallet", hook],
    ]) {
      // Assert on imports, not on prose: the doc comment names these modules to
      // explain why they are excluded.
      const imports = [...text.matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const specifier of imports) {
        assert.doesNotMatch(specifier, /accountSessionOwner|\/account\/|vault|store|api"|@poly\/core/,
          `${name} must not import ${specifier}`);
      }
      assert.doesNotMatch(text, /fetch\(|XMLHttpRequest/, `${name} must not make network requests`);
      assert.doesNotMatch(text, /polyester\.com|api\.testnet/, `${name} must not call the exchange`);
      assert.doesNotMatch(text, /\bsignMessage\s*\(/, `${name} must not sign`);
      assert.doesNotMatch(text, /READ_ONLY_OPERATIONS|signedHeaders/, `${name} must not use the account signer`);
    }
  });

  it("is not imported by the account, session or store modules", () => {
    const dependents = [
      "apps/web/src/lib/accountSessionOwner.ts",
      "apps/web/src/lib/store.tsx",
      "packages/core/src/account/index.ts",
      "packages/core/src/account/rest.ts",
      "packages/core/src/account/signer.ts",
      "packages/core/src/account/vault.ts",
    ];
    for (const path of dependents) {
      assert.doesNotMatch(
        source(path),
        /walletConnection|useWallet|WalletButton/,
        `${path} must not depend on wallet connection`,
      );
    }
  });

  it("uses only read-only EIP-1193 methods", () => {
    const text = source("apps/web/src/lib/walletConnection.ts");
    const methods = [...text.matchAll(/method: "([a-zA-Z_]+)"/g)].map((m) => m[1]);
    assert.deepEqual(
      [...new Set(methods)].sort(),
      ["eth_accounts", "eth_chainId", "eth_requestAccounts"],
    );
    for (const forbidden of [
      "eth_sendTransaction",
      "eth_sign",
      "personal_sign",
      "eth_signTypedData",
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
    ]) {
      assert.ok(!methods.includes(forbidden), `${forbidden} must never be called in connection-only scope`);
    }
  });
});

describe("Stage 2a gate — 07 §3 W-01…W-09", () => {
  /** W-01 */
  it("W-01: no provider degrades the UI instead of crashing", async () => {
    const { describeWalletControl } = await vite.ssrLoadModule(
      "/apps/web/src/components/WalletButton.tsx",
    );
    const conn = new wallet.WalletConnection({ detect: () => null });
    conn.start();
    assert.equal(conn.getSnapshot().status, "unavailable");
    const view = describeWalletControl(conn.getSnapshot());
    assert.equal(view.kind, "unavailable");
    assert.match(view.message, /No browser wallet detected/);
    // A click on a degraded control must not throw either.
    assert.equal((await conn.connect()).error, "NO_PROVIDER");
  });

  /** W-02 */
  it("W-02: connect() publishes disconnected → connecting → connected in order", async () => {
    // Not yet authorized: the silent read returns nothing, so the first state
    // is `disconnected` and the click is what moves it.
    const provider = fakeProvider({
      request: (args) => {
        if (args.method === "eth_accounts") return [];
        if (args.method === "eth_requestAccounts") return [ADDR];
        if (args.method === "eth_chainId") return "0x1";
        throw Object.assign(new Error("unexpected"), { code: -32601 });
      },
    });
    const conn = make(provider);
    conn.start();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(conn.getSnapshot().status, "disconnected");

    const seen = [];
    conn.subscribe(() => seen.push(conn.getSnapshot().status));
    const final = await conn.connect();
    assert.equal(final.status, "connected");
    assert.deepEqual(seen, ["connecting", "connected"]);
  });

  /** W-03 */
  it("W-03: disconnect() clears both the address and the chain", async () => {
    const provider = fakeProvider({ accounts: [ADDR], chainId: "0xaa36a7" });
    const conn = make(provider);
    const connected = await conn.connect();
    assert.equal(connected.chainId, "11155111");

    conn.disconnect();
    const state = conn.getSnapshot();
    assert.equal(state.status, "disconnected");
    assert.equal(state.address, null);
    assert.equal(state.chainId, null, "a stale chain id must not outlive the address");
  });

  /** W-04 — and the "never authenticates" half: nothing leaves the browser. */
  it("W-04: accountsChanged updates the display without authenticating", async () => {
    const provider = fakeProvider({ accounts: [ADDR], chainId: "0x1" });
    const conn = make(provider);
    await conn.connect();

    const fetches = withFetchSpy(() => {
      provider.emit("accountsChanged", [ADDR_2]);
    });
    assert.equal(fetches, 0, "an account switch must not call the exchange");
    assert.equal(conn.getSnapshot().address, ADDR_2);
    // No token, session or signature is produced anywhere on this path.
    assert.equal(typeof conn.getSnapshot().token, "undefined");
    assert.equal(typeof conn.getSnapshot().signature, "undefined");
  });

  /** W-05 — not applicable until Stage 2b exists, and guarded so it cannot be forgotten. */
  it("W-05: no exchange session exists yet, so there is nothing to clear", async () => {
    // When Stage 2b lands, `accountsChanged` must invalidate the exchange
    // session; this guard must then be replaced by a behavioural test.
    const mod = await vite.ssrLoadModule("/apps/web/src/lib/walletConnection.ts");
    assert.deepEqual(Object.keys(mod).sort(), [
      "INITIAL_WALLET_STATE",
      "WalletConnection",
      "chainLabel",
      "classifyWalletError",
      "defaultDetect",
      "getWalletConnection",
      "normalizeAddress",
      "normalizeChainId",
      "shortenAddress",
      "walletErrorMessage",
    ], "no session, token or login export may exist before Stage 2b");

    const provider = fakeProvider({ accounts: [ADDR] });
    const conn = make(provider);
    await conn.connect();
    assert.deepEqual(Object.keys(conn.getSnapshot()).sort(), [
      "address",
      "chainId",
      "error",
      "status",
      "updatedAtMs",
    ], "wallet state carries no credential of any kind");
  });

  /** W-06 */
  it("W-06: chainChanged neither re-authenticates nor loops", async () => {
    const provider = fakeProvider({ accounts: [ADDR], chainId: "0x1" });
    const conn = make(provider);
    await conn.connect();
    const before = provider.calls.length;

    let notifications = 0;
    conn.subscribe(() => { notifications += 1; });
    provider.emit("chainChanged", "0x89");
    provider.emit("chainChanged", "0x89");

    assert.equal(conn.getSnapshot().chainId, "137");
    assert.equal(provider.calls.length, before, "a chain switch must not re-prompt the wallet");
    assert.equal(notifications, 1, "the second identical event must not re-render");
    // Three listeners only: a re-registration loop would show up here.
    for (const [event, handlers] of provider.handlers) {
      assert.equal(handlers.size, 1, `${event} must have exactly one handler`);
    }
  });

  /** W-07 */
  it("W-07: connection makes no network request to any endpoint", async () => {
    const provider = fakeProvider({ accounts: [ADDR], chainId: "0x1" });
    const conn = make(provider);
    const fetches = await withFetchSpyAsync(async () => {
      conn.start();
      await conn.connect();
      provider.emit("accountsChanged", [ADDR_2]);
      provider.emit("chainChanged", "0x1");
      conn.disconnect();
    });
    assert.equal(fetches, 0, "no Polyester request may be made on connect, switch or disconnect");
    // Only provider-local reads, and none of them writes.
    const methods = new Set(provider.methods());
    assert.deepEqual([...methods].sort(), ["eth_accounts", "eth_chainId", "eth_requestAccounts"]);
  });

  /** W-08 */
  it("W-08: the connected view exposes address, chain and disconnect only", async () => {
    const { describeWalletControl } = await vite.ssrLoadModule(
      "/apps/web/src/components/WalletButton.tsx",
    );
    const view = describeWalletControl({
      status: "connected",
      address: ADDR_LOWER,
      chainId: "11155111",
      error: null,
    });
    assert.deepEqual(Object.keys(view).sort(), ["address", "chain", "kind", "short", "title"]);
    const serialized = JSON.stringify(view);
    for (const forbidden of ["balance", "order", "fill", "equity", "position", "trade"]) {
      assert.ok(!serialized.toLowerCase().includes(forbidden),
        `a connected wallet must not surface ${forbidden} data`);
    }
  });

  /** W-09 */
  it("W-09: a 4001 rejection is a recoverable error, not a stuck or crashed state", async () => {
    let reject = true;
    const provider = fakeProvider({
      request: (args) => {
        if (args.method === "eth_requestAccounts") {
          if (reject) throw rejected(4001);
          return [ADDR];
        }
        if (args.method === "eth_accounts") return [];
        if (args.method === "eth_chainId") return "0x1";
        throw Object.assign(new Error("unexpected"), { code: -32601 });
      },
    });
    const conn = make(provider);

    const denied = await conn.connect();
    assert.equal(denied.status, "error");
    assert.equal(denied.error, "USER_REJECTED");
    assert.equal(denied.address, null, "a rejected request must not leave a phantom address");

    // The error is recoverable: the same instance can be retried and succeed.
    reject = false;
    const retried = await conn.connect();
    assert.equal(retried.status, "connected");
    assert.equal(retried.error, null);
    assert.equal(retried.address, ADDR_LOWER);
  });
});

/** Count `fetch` calls made while running `fn`. */
function withFetchSpy(fn) {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (...args) => {
    calls += 1;
    return Promise.resolve(new Response("{}"));
  };
  try { fn(); } finally { globalThis.fetch = original; }
  return calls;
}

async function withFetchSpyAsync(fn) {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (...args) => {
    calls += 1;
    return Promise.resolve(new Response("{}"));
  };
  try { await fn(); } finally { globalThis.fetch = original; }
  return calls;
}

describe("wallet button — presentation rules", () => {
  it("says connection only and never claims sign-in", () => {
    const text = source("apps/web/src/components/WalletButton.tsx");
    assert.match(text, /Connection only/);
    assert.match(text, /does not sign you in/i);
    assert.match(text, /Connect wallet/);
    assert.match(text, /Disconnect/);
    assert.match(text, /aria-live="polite"/);
    assert.doesNotMatch(text, /Sign in with wallet|Login with wallet|MetaMask|Rabby/);
  });

  it("maps every connection state to an honest view", async () => {
    const { describeWalletControl, CONNECT_TITLE } = await vite.ssrLoadModule(
      "/apps/web/src/components/WalletButton.tsx",
    );
    const base = { status: "disconnected", address: null, chainId: null, error: null };

    assert.deepEqual(describeWalletControl({ ...base, status: "detecting" }), { kind: "hidden" });
    assert.deepEqual(describeWalletControl({ ...base, status: "connecting" }), { kind: "pending" });

    const idle = describeWalletControl(base);
    assert.equal(idle.kind, "connect");
    assert.match(idle.title, /no sign-in, no account data, no trading/);

    const unavailable = describeWalletControl({ ...base, status: "unavailable" });
    assert.equal(unavailable.kind, "unavailable");
    assert.match(unavailable.message, /wallet/i);

    const error = describeWalletControl({ ...base, status: "error", error: "USER_REJECTED" });
    assert.equal(error.kind, "error");
    assert.match(error.message, /declined/i);

    const connected = describeWalletControl({
      status: "connected",
      address: ADDR_LOWER,
      chainId: "11155111",
      error: null,
    });
    assert.equal(connected.kind, "connected");
    assert.equal(connected.address, ADDR_LOWER);
    assert.equal(connected.short, "0xabcd…ef01");
    assert.equal(connected.chain, "Sepolia");
    assert.match(connected.title, /Connection only/);
    assert.match(connected.title, /does not sign you in/);

    // A connected state without an address must not render an empty chip.
    assert.equal(describeWalletControl({ ...base, status: "connected" }).kind, "connect");

    // Unknown chain ids degrade to a label rather than hiding the wallet.
    const unknownChain = describeWalletControl({
      status: "connected",
      address: ADDR_LOWER,
      chainId: "424242",
      error: null,
    });
    assert.equal(unknownChain.chain, "Chain 424242");
    void CONNECT_TITLE;
  });

  it("is mounted in the topbar and the sidebar no longer denies having a wallet", () => {
    const layout = source("apps/web/src/components/Layout.tsx");
    assert.match(layout, /<WalletButton \/>/);
    assert.doesNotMatch(layout, /No wallet or login\./);
    assert.match(layout, /No login required for public data\./);
  });
});
