/**
 * Standalone Node adapter — run the same backend anywhere:
 *   npx tsx adapters/node.ts          → http://0.0.0.0:8787/api/overview
 * Works on a VPS, fly.io, Render, Railway, Docker, or your laptop.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import { api } from "../src/handler";

const PORT = Number(process.env.PORT ?? 8787);

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
  return new Request(`http://${host}${path}`, { method: req.method, headers });
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
      .catch((err) => {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: String(err) }));
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
