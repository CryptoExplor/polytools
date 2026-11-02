/**
 * Standalone Node adapter — run the same backend anywhere:
 *   npx tsx adapters/node.ts          → http://0.0.0.0:8787/api/overview
 * Works on a VPS, fly.io, Render, Railway, Docker, or your laptop.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { api } from "../src/handler";

const PORT = Number(process.env.PORT ?? 8787);

const BODYLESS_METHODS = new Set(["GET", "HEAD"]);
/** Auth payloads are a few hundred bytes; anything near this is not one. */
const MAX_BODY_BYTES = 1024 * 1024;

/**
 * Converts an incoming Node request to a Web `Request`.
 *
 * The body has to be read explicitly. An earlier version passed only method and
 * headers, which was invisible while every route was a GET — the first POST route
 * (wallet login) would have arrived empty and been rejected as `invalid_body`.
 * `duplex` is not needed because the body is buffered before construction.
 */
export async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? "localhost";
  const rawUrl = req.url ?? "/";
  const path = rawUrl.startsWith("/api")
    ? rawUrl
    : `/api${rawUrl.startsWith("/") ? "" : "/"}${rawUrl}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === "string") headers.set(k, v);
  }

  const method = (req.method ?? "GET").toUpperCase();
  let body: Uint8Array | undefined;
  if (!BODYLESS_METHODS.has(method)) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buf = chunk as Buffer;
      size += buf.length;
      if (size > MAX_BODY_BYTES) throw new Error("request body too large");
      chunks.push(buf);
    }
    if (chunks.length) body = Buffer.concat(chunks);
  }

  return new Request(`http://${host}${path}`, { method, headers, body });
}

async function send(res: ServerResponse, webRes: Response): Promise<void> {
  res.statusCode = webRes.status;
  webRes.headers.forEach((v, k) => res.setHeader(k, v));
  const buf = Buffer.from(await webRes.arrayBuffer());
  res.end(buf);
}

export function createNodeServer() {
  return createServer((req, res) => {
    toWebRequest(req)
      .then((webReq) => api(webReq, { env: process.env }))
      .then((webRes) => send(res, webRes))
      .catch((err: unknown) => {
        const message = String(err instanceof Error ? err.message : err);
        const tooLarge = message.includes("request body too large");
        res.statusCode = tooLarge ? 413 : 500;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ error: tooLarge ? "payload_too_large" : "internal_error" }));
      });
  });
}

const isMain =
  typeof process !== "undefined" &&
  Array.isArray(process.argv) &&
  process.argv[1] &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  createNodeServer().listen(PORT, "0.0.0.0", () => {
    console.log(`[poly-backend] listening on http://0.0.0.0:${PORT}/api/health`);
  });
}
