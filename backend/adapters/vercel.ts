/**
 * Vercel adapter — Edge runtime, pure Web API in/out.
 * Re-exported from ../api/[...path].ts so a Vercel project deploys it
 * without any extra configuration.
 */

import { api } from "../src/handler";

export const config = { runtime: "edge" } as const;

export default function handler(request: Request): Promise<Response> {
  // Vercel injects env into process.env on both runtimes.
  const env = (globalThis as { process?: { env?: Record<string, string> } })
    .process?.env;
  return api(request, { env });
}
