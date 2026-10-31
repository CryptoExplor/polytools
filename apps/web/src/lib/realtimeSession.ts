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
  visibilityTarget?: EventTarget | null;
}

/** The subprotocol carrying JSON frames; `:proto` channels need another. */
export const JSON_SUBPROTOCOL = "centrifuge-json";

export function defaultRealtimeUrl(): string {
  const configured = (import.meta.env.VITE_POLYESTER_WS_URL as string | undefined)?.trim();
  return configured || "wss://api.testnet.polyester.com/connection/websocket";
}

/**
 * Opens the channel and keeps it open until the returned function is called.
 *
 * Retry policy: capped exponential backoff with jitter proportional to the
 * delay, and a hard stop after `maxFailures` consecutive failures so a dead
 * endpoint does not retry at a user forever. A stopped session resumes once,
 * when the page becomes visible again — a hidden tab is the most common reason
 * a socket dies, and it is the one case where retrying is clearly worth it.
 */
export function subscribeChannel(options: SubscribeChannelOptions): () => void {
  const WebSocketImpl =
    options.WebSocketImpl ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  const maxFailures = options.maxFailures ?? 5;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? 1_000;

  let socket: WebSocket | null = null;
  let stopped = false;
  let failureCount = 0;
  let gaveUp = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let commandId = 1;
  let subscribed = false;

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
    subscribed = false;
    failureCount += 1;
    if (failureCount > maxFailures) {
      gaveUp = true;
      options.onStatus("unavailable", "stream unavailable; showing polled data");
      return;
    }
    options.onStatus("reconnecting");
    const delay = Math.min(30_000, retryBaseDelayMs * 2 ** (failureCount - 1));
    const jitter = Math.floor(Math.random() * Math.min(delay, 250));
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay + jitter);
  };

  const connect = () => {
    if (stopped) return;
    if (!WebSocketImpl) {
      options.onStatus("unavailable", "WebSocket unavailable in this browser");
      return;
    }
    options.onStatus(failureCount === 0 ? "connecting" : "reconnecting");

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
          failureCount = 0;
          subscribed = true;
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
    if (stopped || !gaveUp) return;
    const state = (visibilityTarget as Document | null)?.visibilityState;
    if (state !== undefined && state !== "visible") return;
    gaveUp = false;
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
