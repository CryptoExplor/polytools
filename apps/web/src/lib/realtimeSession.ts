/**
 * The socket lifecycle for one public Centrifugo channel.
 *
 * Extracted from the order-book stream so that trades and candles can share it
 * rather than reimplementing reconnect, backoff, heartbeat and visibility
 * handling three times. Everything here is channel-agnostic; the caller supplies
 * a channel name and a message handler.
 *
 * Deliberate boundaries:
 *  - **No encoding knowledge.** Frames are decoded by `@poly/core`; this file
 *    only decides when the socket is usable.
 *  - **No retry loop for content.** A malformed payload is the caller's problem;
 *    a dead socket is this module's.
 *  - **Observable state.** Every transition is reported through `onStatus` so a
 *    UI can say what is actually happening instead of guessing.
 *  - **Injectable `WebSocket` and visibility target** so the whole state machine
 *    is testable without a browser.
 */

import {
  PONG_FRAME,
  connectCommand,
  parseFrame,
  subscribeCommand,
} from "@poly/core";

export type RealtimeStatus = "connecting" | "live" | "reconnecting" | "unavailable";

export interface SubscribeChannelOptions {
  /** Exact channel name, e.g. `public:spot:market:trades:1`. */
  channel: string;
  /** A decoded publication payload from this channel. */
  onMessage: (data: unknown) => void;
  /** Fired once per successful subscribe, before any message is delivered. */
  onSubscribed?: () => void;
  onStatus: (status: RealtimeStatus, detail?: string) => void;
  wsUrl?: string;
  WebSocketImpl?: typeof WebSocket;
  subprotocols?: string[];
  maxFailures?: number;
  retryBaseDelayMs?: number;
  /** Ceiling for the backoff, so a long outage retries slowly rather than never. */
  maxDelayMs?: number;
  /**
   * How long a connection must stay subscribed before it earns back the failure
   * budget. Without this, a server that accepts-then-drops resets the count on
   * every attempt and the backoff never grows.
   */
  stableAfterMs?: number;
  visibilityTarget?: EventTarget | null;
}

/** The subprotocol carrying JSON frames; `:proto` channels need another. */
export const JSON_SUBPROTOCOL = "centrifuge-json";

export function defaultRealtimeUrl(): string {
  const configured = (import.meta.env.VITE_POLYESTER_WS_URL as string | undefined)?.trim();
  return configured || "wss://api.testnet.polyester.com/connection/websocket";
}

/** Jitter is a fraction of the delay, never a fixed millisecond count. */
const JITTER_FRACTION = 0.25;

/**
 * Exponential backoff with jitter proportional to the delay.
 *
 * Two properties matter, and the previous implementation had neither:
 *
 *  - **The spread scales with the delay.** A fixed 250 ms jitter on a 30 s delay
 *    concentrates every client into the same quarter-second, which is exactly
 *    the moment a restarted server is least able to absorb them.
 *  - **It is bounded, and it never stops.** A bounded delay keeps a dead
 *    endpoint from being retried tens of times a minute; never stopping means
 *    an outage longer than the failure budget heals on its own rather than
 *    waiting for the user to switch tabs.
 */
export function backoffDelayMs(
  failureCount: number,
  options: { baseDelayMs: number; maxDelayMs: number },
  random: () => number = Math.random,
): number {
  // Clamped: 2 ** n reaches Infinity around n = 1024, and Math.min handles it,
  // but an explicit ceiling keeps the arithmetic readable.
  const exponent = Math.min(Math.max(failureCount, 1) - 1, 30);
  const raw = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** exponent);
  const spread = raw * JITTER_FRACTION;
  return Math.max(0, Math.round(raw - spread + random() * spread * 2));
}

/**
 * Opens the channel and keeps it open until the returned function is called.
 *
 * Retry policy: exponential backoff, capped at `maxDelayMs`, with jitter
 * proportional to the delay so a fleet of clients that lost the socket together
 * does not come back in the same instant.
 *
 * Past `maxFailures` the session does **not** stop; it drops into a slow lane at
 * the cap and keeps trying, reporting `unavailable` in the meantime so the UI
 * shows polled data instead of a frozen frame. Stopping was recoverable only by
 * switching tabs, which made any outage longer than about half a minute
 * permanent until the user happened to do that.
 *
 * A connection only earns the failure budget back once it has stayed subscribed
 * for `stableAfterMs`; otherwise a server that accepts and immediately drops
 * would be retried once a second forever.
 */
export function subscribeChannel(options: SubscribeChannelOptions): () => void {
  const WebSocketImpl =
    options.WebSocketImpl ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  const maxFailures = options.maxFailures ?? 5;
  const backoff = {
    baseDelayMs: options.retryBaseDelayMs ?? 1_000,
    maxDelayMs: options.maxDelayMs ?? 30_000,
  };
  const stableAfterMs = options.stableAfterMs ?? 30_000;

  let socket: WebSocket | null = null;
  let stopped = false;
  let failureCount = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let commandId = 1;
  /** When the current connection became subscribed; null while not live. */
  let liveSince: number | null = null;

  /**
   * Past the budget we keep retrying, slowly, instead of stopping.
   *
   * Stopping was recoverable only by switching tabs, so any outage longer than
   * the budget — about 31 s with the defaults — left the page silently polling
   * until the user happened to blur and refocus the window. The slow lane is
   * the honest version: the UI keeps reporting `unavailable` (so the ladder
   * falls back to polled data rather than freezing) and recovery is automatic.
   */
  const suspended = () => failureCount > maxFailures;

  const send = (payload: string) => {
    if (socket && socket.readyState === 1) {
      try {
        socket.send(payload);
      } catch {
        // A send that throws is a dying socket; `onclose` owns recovery.
      }
    }
  };

  const detach = () => {
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    try {
      socket.close();
    } catch {
      // Already closed.
    }
    socket = null;
  };

  const stop = () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    detach();
  };

  const scheduleReconnect = () => {
    if (stopped) return;

    // A connection that never became stable does not earn back the budget, so a
    // server that accepts and immediately drops escalates instead of producing
    // one reconnect per second forever.
    const lifetimeMs = liveSince === null ? 0 : Date.now() - liveSince;
    liveSince = null;
    if (lifetimeMs >= stableAfterMs) failureCount = 0;

    failureCount += 1;
    if (suspended()) {
      options.onStatus("unavailable", "stream unavailable; showing polled data");
    } else {
      options.onStatus("reconnecting");
    }

    const delay = backoffDelayMs(failureCount, backoff);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  const connect = () => {
    if (stopped) return;
    // Never stack sockets. A timer that fires a moment after something else has
    // already connected would otherwise leave two live subscriptions and one
    // orphan nobody stops.
    if (socket && socket.readyState === 1) return;
    if (!WebSocketImpl) {
      options.onStatus("unavailable", "WebSocket unavailable in this browser");
      return;
    }
    // While suspended the status stays `unavailable`: re-emitting `reconnecting`
    // every 30 s would flash the pill and, worse, re-show the last streamed book
    // as if it were live between attempts.
    if (!suspended()) options.onStatus(failureCount === 0 ? "connecting" : "reconnecting");

    let ws: WebSocket;
    try {
      ws = new WebSocketImpl(options.wsUrl ?? defaultRealtimeUrl(), options.subprotocols ?? [
        JSON_SUBPROTOCOL,
      ]);
    } catch {
      scheduleReconnect();
      return;
    }
    socket = ws;

    ws.onopen = () => {
      if (stopped) return;
      // Refuse a framing this client cannot decode. The endpoint negotiates
      // `centrifuge-protobuf` when asked, and binary frames would decode as
      // null — a stream that looks connected and never updates. Empty is
      // accepted because a server that ignores the request may send text JSON.
      const negotiated = (ws.protocol ?? "").toLowerCase();
      if (negotiated.includes("proto")) {
        options.onStatus(
          "unavailable",
          `server negotiated "${ws.protocol}"; this client decodes JSON frames only`,
        );
        stop();
        return;
      }
      send(connectCommand(commandId++));
    };

    ws.onmessage = (event: MessageEvent) => {
      if (stopped) return;
      const frame = typeof event.data === "string" ? parseFrame(event.data) : null;
      if (!frame) return;

      switch (frame.kind) {
        case "ping":
          send(PONG_FRAME);
          return;
        case "connect":
          send(subscribeCommand(commandId++, options.channel));
          return;
        case "subscribe":
          // The budget is settled on close, once the connection's lifetime is
          // known. Zeroing it here is what let a flapping server reconnect
          // forever: every attempt looked like a fresh start.
          liveSince = Date.now();
          options.onStatus("live");
          options.onSubscribed?.();
          return;
        case "publication":
          // The channel is per-subscription; a mismatched channel means the
          // server pushed something we did not ask for.
          if (frame.channel === null || frame.channel === options.channel) {
            options.onMessage(frame.data);
          }
          return;
        case "error":
          options.onStatus("unavailable", frame.message ?? "stream rejected");
          stop();
          return;
        default:
          return;
      }
    };

    ws.onerror = () => {
      // `onclose` always follows; recovery lives there so a browser that fires
      // only one of the two cannot cause a double reconnect.
    };

    ws.onclose = () => {
      socket = null;
      if (stopped) return;
      scheduleReconnect();
    };
  };

  const visibilityTarget =
    options.visibilityTarget === undefined
      ? typeof document === "undefined"
        ? null
        : document
      : options.visibilityTarget;

  const onVisibility = () => {
    // Only the suspended state needs this nudge: it is the case where the next
    // attempt is up to `maxDelayMs` away, and a returning user should not wait.
    if (stopped || liveSince !== null || !suspended()) return;
    const state = (visibilityTarget as Document | null)?.visibilityState;
    if (state !== undefined && state !== "visible") return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    failureCount = 0;
    connect();
  };

  if (visibilityTarget) visibilityTarget.addEventListener("visibilitychange", onVisibility);

  connect();

  return () => {
    if (visibilityTarget) visibilityTarget.removeEventListener("visibilitychange", onVisibility);
    stop();
  };
}

/** Exposed for tests that need to know whether a session is subscribed. */
export const __internal = { JSON_SUBPROTOCOL };
