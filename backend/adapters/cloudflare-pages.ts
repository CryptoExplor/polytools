/**
 * Cloudflare Pages Functions adapter.
 * Also re-exported from ../functions/api/[[path]].ts so a Pages project
 * rooted at this folder picks it up automatically.
 */

import { api } from "../src/handler";

interface CfEventContext {
  request: Request;
  env: Record<string, string | undefined>;
}

export const onRequest = (ctx: CfEventContext): Promise<Response> =>
  api(ctx.request, { env: ctx.env });
