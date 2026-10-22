/**
 * Server-side MCP session pool: one McpClient per MCP URL, reused across
 * requests inside an isolate. The client itself handles session
 * re-initialization on expiry.
 */

import { McpClient, PolyesterData } from "../../packages/core/src/index";

const pool = new Map<string, PolyesterData>();

export function dataFor(mcpUrl: string): PolyesterData {
  let d = pool.get(mcpUrl);
  if (!d) {
    d = new PolyesterData(
      new McpClient({ url: mcpUrl, clientName: "poly-tools-backend" }),
    );
    pool.set(mcpUrl, d);
  }
  return d;
}
