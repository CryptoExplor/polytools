/**
 * The Centrifugo JSON frame layer, reduced to what a public order-book
 * subscription needs.
 *
 * Centrifugo is a general realtime server; Polyester uses it for every channel.
 * This module understands only five frame shapes and refuses to guess at the
 * rest, so a protocol change surfaces as `unknown` rather than as a silently
 * ignored book update.
 *
 * Frames (JSON, one object per WebSocket text message):
 *   client → {"id":1,"connect":{}}
 *   server → {"id":1,"connect":{...}}
 *   client → {"id":2,"subscribe":{"channel":"..."}}
 *   server → {"id":2,"subscribe":{...}}
 *   server → {"push":{"channel":"...","pub":{"data":{...}}}}
 *   server → {}                       heartbeat; the client answers {"}
 *   server → {"id":N,"error":{...}}   a command failed
 *
 * Encoding is channel-specific. Only the `:json` variant is used here; the
 * `:proto` variant carries binary payloads that this client does not decode.
 */

export interface ConnectReply {
  kind: "connect";
  client: string | null;
}

export interface SubscribeReply {
  kind: "subscribe";
  channel: string | null;
}

export interface Publication {
  kind: "publication";
  channel: string | null;
  data: unknown;
}

export interface PingFrame {
  kind: "ping";
}

export interface ErrorFrame {
  kind: "error";
  id: number | null;
  code: number | null;
  message: string | null;
}

export interface UnknownFrame {
  kind: "unknown";
}

export type CentrifugeFrame =
  | ConnectReply
  | SubscribeReply
  | Publication
  | PingFrame
  | ErrorFrame
  | UnknownFrame;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `{"id":1,"connect":{}}` — no token, because public channels need none. */
export function connectCommand(id: number): string {
  return JSON.stringify({ id, connect: {} });
}

/** `{"id":2,"subscribe":{"channel":"..."}}` */
export function subscribeCommand(id: number, channel: string): string {
  return JSON.stringify({ id, subscribe: { channel } });
}

/** The heartbeat reply. Centrifugo sends an empty object and expects one back. */
export const PONG_FRAME = "{}";

export function interpretFrame(raw: unknown): CentrifugeFrame {
  if (isRecord(raw)) {
    if (raw.error !== undefined && raw.id !== undefined) {
      const error = isRecord(raw.error) ? raw.error : {};
      return {
        kind: "error",
        id: typeof raw.id === "number" ? raw.id : null,
        code: typeof error.code === "number" ? error.code : null,
        message: typeof error.message === "string" ? error.message : null,
      };
    }
    if (raw.connect !== undefined) {
      const reply = isRecord(raw.connect) ? raw.connect : {};
      return { kind: "connect", client: typeof reply.client === "string" ? reply.client : null };
    }
    if (raw.subscribe !== undefined) {
      const reply = isRecord(raw.subscribe) ? raw.subscribe : {};
      return {
        kind: "subscribe",
        channel: typeof reply.channel === "string" ? reply.channel : null,
      };
    }
    if (raw.push !== undefined) {
      const push = isRecord(raw.push) ? raw.push : {};
      const pub = isRecord(push.pub) ? push.pub : {};
      return {
        kind: "publication",
        channel: typeof push.channel === "string" ? push.channel : null,
        // `data` is the channel payload; absent means an empty publication
        // (used for invalidations, which this channel does not send).
        data: pub.data,
      };
    }
    // A bare `{}` is the heartbeat.
    const keys = Object.keys(raw);
    if (keys.length === 0) return { kind: "ping" };
    if (keys.length === 1 && keys[0] === "id") return { kind: "ping" };
  }
  return { kind: "unknown" };
}

/** Parses a text frame, returning `null` rather than throwing on garbage. */
export function parseFrame(text: string): CentrifugeFrame | null {
  try {
    return interpretFrame(JSON.parse(text));
  } catch {
    return null;
  }
}
