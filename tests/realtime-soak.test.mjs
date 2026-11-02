/**
 * Long-run behaviour of the realtime session: what happens over a real outage,
 * not the hundred milliseconds a happy-path test covers.
 *
 * Two defects motivated this file, and neither was reachable from a fast suite:
 *
 *  - The retry budget was spent after ~31 s with the defaults, and the session
 *    then stopped. Recovery required a tab switch, so an outage longer than
 *    half a minute left the page quietly polling until the user happened to
 *    blur and refocus the window.
 *  - `failureCount` was zeroed on every subscribe reply, so a server that
 *    accepted and immediately dropped produced one reconnect per second
 *    forever and the budget never tripped. Measured before the fix: 27
 *    connections in a 300 ms window at a 5 ms base delay.
 *
 * Timings are compressed (5 ms stands in for 1 s) because the arithmetic is
 * what matters; the constants are injectable so this suite does not have to
 * wait half a minute to observe half a minute.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { makeSocketClass, makeVisibility, settle } from "./support/realtimeHarness.mjs";

let vite;
let lib;
/** Every live session, so a failure cannot leave a retry loop running. */
const active = new Set();

before(async () => {
  const { createServer } = await import("vite");
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "error",
  });
  lib = await vite.ssrLoadModule("/apps/web/src/lib/realtimeSession.ts");
});

after(async () => {
  for (const stop of active) stop();
  active.clear();
  await vite?.close();
});

/** Compressed timings: 5 ms base and 20 ms cap stand in for 1 s and 30 s. */
const FAST = { retryBaseDelayMs: 5, maxDelayMs: 20, maxFailures: 3, stableAfterMs: 40 };

/**
 * A fake server whose behaviour the test controls.
 *
 * `mode = "refuse"` drops every connection as it arrives, which is what an
 * unreachable or restarting backend looks like to a browser. `"serve"` accepts
 * it. `"flap"` accepts, subscribes and drops a moment later.
 */
function makeServer({ mode = "serve" } = {}) {
  const { FakeSocket, sockets } = makeSocketClass();
  const state = { mode };

  class Server extends FakeSocket {
    constructor(url, protocols) {
      super(url, protocols);
      setTimeout(() => {
        if (state.mode === "refuse") {
          this.drop();
        } else if (state.mode === "flap") {
          this.handshake();
          setTimeout(() => this.drop(), 1);
        }
      }, 0);
    }
  }

  state.FakeSocket = Server;
  state.sockets = sockets;
  return state;
}

function start(server, overrides = {}) {
  const statuses = [];
  const stop = lib.subscribeChannel({
    channel: "public:spot:orderbook:deltas:depth:50:1:json",
    WebSocketImpl: server.FakeSocket,
    visibilityTarget: null,
    ...FAST,
    onStatus: (status, detail) => statuses.push({ status, detail }),
    onMessage: () => {},
    ...overrides,
  });
  active.add(stop);
  return {
    statuses,
    stop: () => {
      active.delete(stop);
      stop();
    },
    latest: () => server.sockets.at(-1),
    since: (index) => statuses.slice(index).map((s) => s.status),
  };
}

/**
 * Waits for a socket that is fresh and still open, then answers its handshake.
 *
 * Hand-shaking an already-dropped socket is easy to do by accident: the fake
 * still delivers the frames, the client sets itself `live`, and the test then
 * measures a session that was never really connected. `readyState === 0` means
 * the real client opened it and nothing has closed it since.
 */
async function handshakeFreshSocket(server, afterCount = 0) {
  await waitFor(
    () => {
      const socket = server.sockets.at(-1);
      return server.sockets.length > afterCount && socket !== undefined && socket.readyState === 0;
    },
    { label: "a fresh, open socket" },
  );
  const socket = server.sockets.at(-1);
  socket.handshake();
  return socket;
}

/** Polls until a condition holds, so tests do not depend on one exact delay. */
async function waitFor(predicate, { timeoutMs = 1_000, label = "condition" } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await settle(2);
  }
  throw new Error(`timed out waiting for ${label}`);
}

describe("backoff arithmetic", { timeout: 5_000 }, () => {
  const options = { baseDelayMs: 1_000, maxDelayMs: 30_000 };

  it("grows exponentially from the base delay", () => {
    // random 0.5 sits mid-band, so these are the nominal delays.
    const mid = () => 0.5;
    assert.deepEqual(
      [1, 2, 3, 4, 5].map((n) => lib.backoffDelayMs(n, options, mid)),
      [1_000, 2_000, 4_000, 8_000, 16_000],
    );
  });

  it("caps at the ceiling and stays there", () => {
    const mid = () => 0.5;
    for (const n of [6, 7, 20, 200, 5_000]) {
      assert.equal(lib.backoffDelayMs(n, options, mid), 30_000, String(n));
    }
  });

  it("spreads by a quarter of the delay, never a fixed window", () => {
    // The old code added 0-249 ms regardless of delay, which put every client
    // into the same quarter-second after a server restart. At the 30 s cap the
    // band has to be seconds wide, not milliseconds.
    const low = lib.backoffDelayMs(6, options, () => 0);
    const high = lib.backoffDelayMs(6, options, () => 0.999999);
    assert.equal(low, 22_500);
    assert.equal(high, 37_500);
    assert.ok(high - low >= 15_000, `band was ${high - low}ms`);

    // At the base delay it stays proportionally small rather than fixed.
    assert.equal(lib.backoffDelayMs(1, options, () => 0), 750);
    assert.equal(lib.backoffDelayMs(1, options, () => 0.999999), 1_250);
  });

  it("never returns a negative or non-integer delay", () => {
    for (const n of [1, 2, 9, 60]) {
      for (const r of [0, 0.5, 0.99, 1]) {
        const delay = lib.backoffDelayMs(n, options, () => r);
        assert.ok(delay >= 0 && Number.isInteger(delay), `${n}/${r} -> ${delay}`);
      }
    }
  });
});

describe("a brief blip is not an outage", { timeout: 5_000 }, () => {
  it("reconnects once and returns to live without spending the budget", async () => {
    const server = makeServer();
    const h = start(server);
    await waitFor(() => server.sockets.length === 1, { label: "first socket" });
    h.latest().handshake();
    assert.equal(h.statuses.at(-1).status, "live");

    await settle(60); // long enough to count as a stable connection
    const mark = h.statuses.length;
    h.latest().drop();
    await waitFor(() => server.sockets.length === 2, { label: "one retry" });
    await settle(30);

    assert.ok(h.since(mark).includes("reconnecting"));
    assert.ok(!h.since(mark).includes("unavailable"), "a single blip must not spend the budget");

    h.latest().handshake();
    assert.equal(h.statuses.at(-1).status, "live");
    h.stop();
  });
});

describe("an outage longer than the budget heals by itself", { timeout: 10_000 }, () => {
  it("falls back to unavailable, keeps trying, and recovers without a tab switch", async () => {
    const server = makeServer({ mode: "refuse" });
    const h = start(server);

    await waitFor(() => h.statuses.some((s) => s.status === "unavailable"), {
      label: "the failure budget to be spent",
    });
    const attemptsAtSuspension = server.sockets.length;

    // Still trying after the budget: this is the behaviour that replaced the
    // permanent stop. Waiting is longer than the capped delay on purpose.
    await waitFor(() => server.sockets.length > attemptsAtSuspension, {
      label: "a retry after suspension",
    });

    // The backend comes back. No visibility change, no remount, no user action.
    server.mode = "serve";
    await handshakeFreshSocket(server, attemptsAtSuspension);
    assert.equal(h.statuses.at(-1).status, "live");
    h.stop();
  });

  it("does not flicker back to reconnecting between slow attempts", async () => {
    // While suspended, every attempt used to re-announce `reconnecting`, which
    // both flashes the pill and re-shows a dead streamed book as if it were
    // live — the frozen-data problem this project treats as a defect.
    const server = makeServer({ mode: "refuse" });
    const h = start(server);
    await waitFor(() => h.statuses.some((s) => s.status === "unavailable"), {
      label: "suspension",
    });

    const suspendedAt = h.statuses.findIndex((s) => s.status === "unavailable");
    const before = server.sockets.length;
    await waitFor(() => server.sockets.length >= before + 2, { label: "two slow attempts" });

    const during = h.since(suspendedAt);
    assert.ok(
      during.every((status) => status === "unavailable"),
      `expected only unavailable, saw ${[...new Set(during)].join(",")}`,
    );
    h.stop();
  });
});

describe("a flapping server escalates instead of being retried forever", { timeout: 10_000 }, () => {
  it("slows down once connections stop being stable", async () => {
    // Before the fix this produced 27 connections in a 300 ms window at a 5 ms
    // base delay, because every subscribe reply reset the budget. The exact
    // count is timing-dependent; what must hold is that it is bounded well
    // below the unthrottled rate and that the budget is eventually spent.
    const server = makeServer({ mode: "flap" });
    const h = start(server);

    await waitFor(() => h.statuses.some((s) => s.status === "unavailable"), {
      label: "the budget to be spent by flapping",
      timeoutMs: 2_000,
    });
    const connections = server.sockets.length;

    assert.ok(
      connections <= 12,
      `escalation should keep this near the budget, saw ${connections} connections`,
    );
    h.stop();
  });

  it("does not treat a repeated short-lived connect as healthy", async () => {
    // The stability window is what distinguishes "recovered" from "flapped".
    // A connection that dies inside stableAfterMs must not reset the count.
    const server = makeServer({ mode: "flap" });
    const h = start(server);
    await waitFor(() => h.statuses.some((s) => s.status === "unavailable"), {
      label: "suspension from flapping",
      timeoutMs: 2_000,
    });
    h.stop();
  });
});

describe("teardown and edges", { timeout: 10_000 }, () => {
  it("opens no second socket when a suspended session is already live", async () => {
    // A session can be both: the budget was spent, then a slow attempt
    // succeeded. Visibility handling must not connect on top of a live socket,
    // and a stray reconnect timer must not either.
    const server = makeServer({ mode: "refuse" });
    const visibility = makeVisibility("hidden");
    const h = start(server, { visibilityTarget: visibility.target });

    await waitFor(() => h.statuses.some((s) => s.status === "unavailable"), {
      label: "suspension",
    });

    server.mode = "serve";
    await handshakeFreshSocket(server); // live, while the budget is still spent
    assert.equal(h.statuses.at(-1).status, "live");

    const liveCount = server.sockets.length;
    visibility.setState("visible");
    await settle(30);
    assert.equal(server.sockets.length, liveCount, "visibility must not open a second socket");
    h.stop();
  });

  it("stops cleanly while suspended, leaving no timer behind", async () => {
    const server = makeServer({ mode: "refuse" });
    const h = start(server);
    await waitFor(() => h.statuses.some((s) => s.status === "unavailable"), {
      label: "suspension",
    });

    h.stop();
    const afterStop = server.sockets.length;
    await settle(120); // several capped delays would have elapsed
    assert.equal(server.sockets.length, afterStop, "no connection attempts after stop");
  });

  it("charges one socket per session, which is the documented cost of a tab", async () => {
    // There is no cross-tab coalescing. This test exists so that cost is a
    // stated property rather than something to discover in production.
    const server = makeServer({ mode: "serve" });
    const stops = [0, 1, 2].map(() => start(server).stop);
    await settle(10);
    assert.equal(server.sockets.length, 3, "each session opens its own socket");
    for (const stop of stops) stop();
  });
});
