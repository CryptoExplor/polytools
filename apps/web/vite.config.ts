import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";

const coreSrc = fileURLToPath(
  new URL("../../packages/core/src/index.ts", import.meta.url),
);
const handlerModule = fileURLToPath(
  new URL("../../backend/src/handler.ts", import.meta.url),
);

/**
 * Dev-only: mount the SAME backend handler used by every production adapter
 * inside the Vite dev server, so `npm run dev` is a full-stack preview
 * with zero extra processes. Requests to /api/* never leave the sandbox.
 */
function devApiPlugin(): Plugin {
  return {
    name: "poly-dev-api",
    configureServer(server) {
      server.middlewares.use(
        "/api",
        (req: IncomingMessage, res: ServerResponse, next: () => void) => {
          void (async () => {
            try {
              const { api } = (await server.ssrLoadModule(handlerModule)) as {
                api: (r: Request, o?: { env?: Record<string, string | undefined> }) => Promise<Response>;
              };
              const path = `/api${req.url ?? "/"}`;
              const webReq = new Request(`http://localhost${path}`, {
                method: req.method ?? "GET",
              });
              const webRes = await api(webReq, { env: process.env });
              res.statusCode = webRes.status;
              webRes.headers.forEach((v, k) => res.setHeader(k, v));
              res.end(Buffer.from(await webRes.arrayBuffer()));
            } catch (err) {
              res.statusCode = 502;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: String(err) }));
            }
          })().catch(next);
        },
      );
    },
  };
}

export default defineConfig({
  plugins: [react(), devApiPlugin()],
  resolve: {
    alias: { "@poly/core": coreSrc },
  },
  server: {
    host: true,
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: true,
    port: 4173,
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
