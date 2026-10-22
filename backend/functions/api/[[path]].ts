/**
 * Cloudflare Pages Functions catch-all: serves every /api/* route
 * from the shared handler. Deploy this folder (or the monorepo root)
 * as a Pages project with:
 *   Build command : npm run build   (frontend, apps/web)
 *   Output dir    : apps/web/dist
 *   Functions dir : backend/functions
 */

export { onRequest } from "../../adapters/cloudflare-pages";
