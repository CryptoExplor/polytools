/**
 * EIP-6963 discovery and wallet selection.
 *
 * Same scope guard as the connection tests: discovery must never fetch, never
 * touch the vault, and must not change single-wallet behaviour.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const rootDir = fileURLToPath(new URL("..", import.meta.url));

const ADDR = "0xAbCdEf0123456789aBcDeF0123456789AbCdEf01";
const ADDR_LOWER = ADDR.toLowerCase();
const ADDR_2 = "0x1111111111111111111111111111111111111111";

let vite;
let discovery;
let wallet;
let button;

before(async () => {
  vite = await createServer({ root: rootDir, logLevel: "silent", server: { middlewareMode: true } });
  discovery = await vite.ssrLoadModule("/apps/web/src/lib/walletDiscovery.ts");
  wallet = await vite.ssrLoadModule("/apps/web/src/lib/walletConnection.ts");
  button = await vite.ssrLoadModule("/apps/web/src/components/WalletButton.tsx");
});

after(async () => {
  if (vite) await vite.close();
});

function fakeProvider({ accounts = [], chainId = "0x1", request } = {}) {
  const calls = [];
  const handlers = new Map();
  return {
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
    listenerCount(event) {
      return handlers.get(event)?.size ?? 0;
    },
    emit(event, ...args) {
      for (const handler of handlers.get(event) ?? []) handler(...args);
    },
    methods() {
      return calls.map((c) => c.method);
    },
  };
}

/**
 * Stands in for `window`: an event target whose `dispatchEvent` lets the test
 * decide how many wallets are installed and what they announce.
 */
function fakeTarget({ ethereum, wallets = [] } = {}) {
  const listeners = new Map();
  return {
    listeners,
    ethereum,
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event) {
      const isRequest = event?.type === discovery.EIP6963_REQUEST;
      // Registered listeners first (a test may install wallets on demand)...
      for (const listener of listeners.get(event?.type) ?? []) listener(event);
      // ...then the wallets that were declared up front answer synchronously,
      // which is what EIP-6963 requires of a real extension.
      if (isRequest) {
        for (const walletEntry of wallets) {
          this.announce(walletEntry);
        }
      }
      return true;
    },
    announce(detail) {
      for (const listener of listeners.get(discovery.EIP6963_ANNOUNCE) ?? []) {
        listener({ type: discovery.EIP6963_ANNOUNCE, detail });
      }
    },
    announceListenerCount() {
      return listeners.get(discovery.EIP6963_ANNOUNCE)?.size ?? 0;
    },
  };
}

const entry = (uuid, name, provider, rdns = `io.${name.toLowerCase()}`) => ({
  info: { uuid, name, rdns, icon: "data:image/svg+xml;base64,AA==" },
  provider,
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("EIP-6963 discovery — announcement parsing", () => {
  it("rejects everything that is not a well-formed announcement", () => {
    const { parseAnnouncement } = discovery;
    const provider = fakeProvider();
    const bad = [
      null,
      undefined,
      42,
      "announcement",
      {},
      { detail: null },
      { detail: {} },
      { detail: { info: { uuid: "x" } } }, // no provider
      { detail: { info: { uuid: "x" }, provider: {} } }, // provider has no request()
      { detail: { provider } }, // no info
      { detail: { info: { uuid: "" }, provider } }, // empty uuid
      { detail: { info: { uuid: 7 }, provider } }, // non-string uuid
    ];
    for (const candidate of bad) {
      assert.equal(parseAnnouncement(candidate), null, `should reject ${JSON.stringify(candidate)}`);
    }
  });

  it("accepts a valid announcement and keeps the provider identity", () => {
    const provider = fakeProvider();
    const parsed = discovery.parseAnnouncement({ detail: entry("uuid-1", "MetaMask", provider) });
    assert.ok(parsed);
    assert.equal(parsed.info.uuid, "uuid-1");
    assert.equal(parsed.info.name, "MetaMask");
    assert.equal(parsed.info.rdns, "io.metamask");
    assert.equal(parsed.provider, provider);
  });

  it("bounds and cleans third-party display names", () => {
    const provider = fakeProvider();
    const long = "W".repeat(80);
    const cases = [
      [{ uuid: "a", name: long }, 32],
      [{ uuid: "b", name: "  Spacey   Wallet \n" }, "Spacey Wallet".length],
      [{ uuid: "c", name: "Bad\u0000Name\u001fHere" }, "Bad Name Here".length],
      [{ uuid: "d" }, "Browser wallet".length],
      [{ uuid: "e", name: "   " }, "Browser wallet".length],
    ];
    for (const [info, maxLength] of cases) {
      const parsed = discovery.parseAnnouncement({ detail: { info, provider } });
      assert.ok(parsed, `should accept ${JSON.stringify(info)}`);
      assert.ok(parsed.info.name.length <= maxLength, `name too long: ${parsed.info.name}`);
      assert.doesNotMatch(parsed.info.name, /[\u0000-\u001f]/);
      assert.ok(parsed.info.name.length > 0);
    }
  });
});

describe("EIP-6963 discovery — collection", () => {
  it("returns nothing without a target (SSR) and never throws", async () => {
    const result = await discovery.discoverProviders({ target: null });
    assert.deepEqual(result, { providers: [], source: "none" });
  });

  it("collects every announced wallet in announcement order", async () => {
    const a = fakeProvider();
    const b = fakeProvider();
    const target = fakeTarget({
      wallets: [entry("u-a", "Alpha", a), entry("u-b", "Beta", b)],
    });
    const result = await discovery.discoverProviders({ target, timeoutMs: 0 });
    assert.equal(result.source, "eip6963");
    assert.deepEqual(result.providers.map((p) => p.info.name), ["Alpha", "Beta"]);
    assert.equal(result.providers[0].provider, a);
  });

  it("deduplicates a wallet that announces twice, keeping the first", async () => {
    const first = fakeProvider();
    const second = fakeProvider();
    const target = fakeTarget();
    const onRequest = () => {
      target.announce(entry("same-uuid", "Alpha", first));
      target.announce(entry("same-uuid", "Alpha", second));
    };
    target.addEventListener(discovery.EIP6963_REQUEST, onRequest);
    const result = await discovery.discoverProviders({ target, timeoutMs: 0 });
    assert.equal(result.providers.length, 1);
    assert.equal(result.providers[0].provider, first);
  });

  it("ignores malformed announcements without losing valid ones", async () => {
    const good = fakeProvider();
    const target = fakeTarget();
    target.addEventListener(discovery.EIP6963_REQUEST, () => {
      target.announce(null);
      target.announce({ detail: { info: { uuid: "broken" } } });
      target.announce(entry("good", "Alpha", good));
    });
    const result = await discovery.discoverProviders({ target, timeoutMs: 0 });
    assert.deepEqual(result.providers.map((p) => p.info.name), ["Alpha"]);
  });

  it("removes its listener once discovery settles", async () => {
    const target = fakeTarget({ wallets: [entry("u-a", "Alpha", fakeProvider())] });
    await discovery.discoverProviders({ target, timeoutMs: 0 });
    assert.equal(target.announceListenerCount(), 0);
  });

  it("survives a target whose event API throws", async () => {
    const target = {
      addEventListener() {
        throw new Error("nope");
      },
      removeEventListener() {},
      dispatchEvent() {
        return true;
      },
    };
    const result = await discovery.discoverProviders({ target, timeoutMs: 0 });
    assert.deepEqual(result, { providers: [], source: "none" });
  });
});

describe("EIP-6963 discovery — legacy fallback", () => {
  it("falls back to a single window.ethereum when nothing announces", async () => {
    const provider = fakeProvider();
    const target = fakeTarget({ ethereum: provider });
    const result = await discovery.discoverProviders({ target, timeoutMs: 0 });
    assert.equal(result.source, "legacy");
    assert.equal(result.providers.length, 1);
    assert.equal(result.providers[0].provider, provider);
  });

  it("prefers announcements over the legacy global", async () => {
    const legacy = fakeProvider();
    const announced = fakeProvider();
    const target = fakeTarget({ ethereum: legacy, wallets: [entry("u-a", "Alpha", announced)] });
    const result = await discovery.discoverProviders({ target, timeoutMs: 0 });
    assert.equal(result.source, "eip6963");
    assert.equal(result.providers.length, 1);
    assert.equal(result.providers[0].provider, announced);
  });

  it("expands the pre-EIP-6963 window.ethereum.providers array", () => {
    const meta = Object.assign(fakeProvider(), { isMetaMask: true });
    const phantom = Object.assign(fakeProvider(), { isPhantom: true });
    const shared = Object.assign(fakeProvider(), { providers: [meta, phantom] });
    const list = discovery.legacyProviders({ ethereum: shared });
    assert.deepEqual(list.map((p) => p.info.name), ["MetaMask", "Phantom"]);
    assert.notEqual(list[0].info.uuid, list[1].info.uuid);
  });

  it("names an unbadged legacy provider honestly", () => {
    const list = discovery.legacyProviders({ ethereum: fakeProvider() });
    assert.equal(list[0].info.name, "Browser wallet");
  });

  it("ignores a malformed window.ethereum", () => {
    assert.deepEqual(discovery.legacyProviders({ ethereum: {} }), []);
    assert.deepEqual(discovery.legacyProviders({ ethereum: null }), []);
    assert.deepEqual(discovery.legacyProviders(null), []);
  });
});

describe("EIP-6963 discovery — scope guard", () => {
  it("makes no network request while discovering", async () => {
    const calls = [];
    const original = globalThis.fetch;
    globalThis.fetch = (...args) => {
      calls.push(args);
      return Promise.reject(new Error("no network allowed"));
    };
    try {
      const target = fakeTarget({
        ethereum: fakeProvider(),
        wallets: [entry("u-a", "Alpha", fakeProvider()), entry("u-b", "Beta", fakeProvider())],
      });
      await discovery.discoverProviders({ target, timeoutMs: 0 });
      assert.equal(calls.length, 0);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("Wallet selection — re-pointing the connection", () => {
  it("switches to the chosen provider and reads its accounts", async () => {
    const a = fakeProvider({ accounts: [] });
    const b = fakeProvider({ accounts: [ADDR] });
    const connection = new wallet.WalletConnection({ detect: () => a });
    connection.start();
    await tick();
    assert.equal(connection.getSnapshot().status, "disconnected");

    connection.setProvider(b);
    await tick();
    const state = connection.getSnapshot();
    assert.equal(state.status, "connected");
    assert.equal(state.address, ADDR_LOWER);
  });

  it("detaches the previous provider so it can no longer move the UI", async () => {
    const a = fakeProvider({ accounts: [] });
    const b = fakeProvider({ accounts: [ADDR] });
    const connection = new wallet.WalletConnection({ detect: () => a });
    connection.start();
    await tick();
    connection.setProvider(b);
    await tick();

    assert.equal(a.listenerCount("accountsChanged"), 0);
    assert.equal(a.listenerCount("chainChanged"), 0);
    assert.equal(b.listenerCount("accountsChanged"), 1);

    // The wallet the user moved away from reports a change...
    a.emit("accountsChanged", [ADDR_2]);
    assert.equal(connection.getSnapshot().address, ADDR_LOWER, "stale wallet moved the state");

    // ...while the selected one is still live.
    b.emit("accountsChanged", [ADDR_2]);
    assert.equal(connection.getSnapshot().address, ADDR_2);
  });

  it("reports unavailable when the selection is cleared", async () => {
    const a = fakeProvider({ accounts: [ADDR] });
    const connection = new wallet.WalletConnection({ detect: () => a });
    connection.start();
    await tick();
    connection.setProvider(null);
    assert.equal(connection.getSnapshot().status, "unavailable");
    assert.equal(a.listenerCount("accountsChanged"), 0);
  });

  it("does not re-detect the legacy global after a selection", async () => {
    const legacy = fakeProvider({ accounts: [] });
    const chosen = fakeProvider({ accounts: [ADDR] });
    let detections = 0;
    const connection = new wallet.WalletConnection({
      detect: () => {
        detections += 1;
        return legacy;
      },
    });
    connection.start();
    await tick();
    connection.setProvider(chosen);
    await tick();
    await connection.connect();
    assert.equal(detections, 1, "connect() re-detected after the user chose a wallet");
    assert.equal(connection.getSnapshot().address, ADDR_LOWER);
  });

  it("is a no-op when the same provider is selected again", async () => {
    const a = fakeProvider({ accounts: [ADDR] });
    const connection = new wallet.WalletConnection({ detect: () => a });
    connection.start();
    await tick();
    const first = connection.getSnapshot();
    connection.setProvider(a);
    const second = connection.getSnapshot();
    assert.equal(first.status, second.status);
    assert.equal(first.address, second.address);
    assert.equal(second.updatedAtMs, first.updatedAtMs);
  });
});

describe("Wallet selection — UI contract", () => {
  it("keeps the single-wallet button copy and view shape unchanged", () => {
    const legacyState = {
      status: "disconnected",
      address: null,
      chainId: null,
      error: null,
      updatedAtMs: 1,
    };
    const view = button.describeWalletControl(legacyState);
    assert.deepEqual(Object.keys(view).sort(), ["kind", "title"]);
    assert.equal(view.kind, "connect");
    assert.equal(button.CONNECT_TITLE, view.title);
  });

  it("per-wallet buttons repeat the no-sign-in claim", () => {
    const title = button.walletChoiceTitle("Phantom");
    assert.match(title, /^Connect Phantom\./);
    assert.match(title, /no sign-in/i);
    assert.match(title, /no account data/i);
    assert.match(title, /no trading/i);
  });
});

describe("Wallet selection — one control, however many wallets", () => {
  const providerEntry = (uuid, name) => ({
    info: { uuid, name, rdns: `io.${name.toLowerCase()}` },
    provider: fakeProvider(),
  });
  // `before()` has not run when the describe body executes, so build views lazily.
  const connectView = () =>
    button.describeWalletControl({ status: "disconnected", address: null, chainId: null, error: null, updatedAtMs: 1 });
  const connectedView = () =>
    button.describeWalletControl({ status: "connected", address: ADDR_LOWER, chainId: "1", error: null, updatedAtMs: 1 });

  it("connects directly with no wallet or exactly one", () => {
    assert.equal(button.walletClickAction([], connectView()), "connect");
    assert.equal(button.walletClickAction([providerEntry("a", "Alpha")], connectView()), "connect");
  });

  it("opens the menu only when there is a real choice", () => {
    assert.equal(
      button.walletClickAction([providerEntry("a", "Alpha"), providerEntry("b", "Beta")], connectView()),
      "menu",
    );
    // Eight installed wallets are still ONE button.
    const eight = Array.from({ length: 8 }, (_, i) => providerEntry(`u${i}`, `Wallet ${i}`));
    assert.equal(button.walletClickAction(eight, connectView()), "menu");
  });

  it("never opens the menu for a connected wallet", () => {
    const many = Array.from({ length: 8 }, (_, i) => providerEntry(`u${i}`, `Wallet ${i}`));
    assert.equal(button.walletClickAction(many, connectedView()), "connect");
  });
});
