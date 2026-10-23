/**
 * Root Cloudflare Pages Functions catch-all: serves every /api/* route
 * from the shared backend handler when deployed as a Cloudflare Pages project
 * from the repository root.
 */

export { onRequest } from "../../backend/adapters/cloudflare-pages";
