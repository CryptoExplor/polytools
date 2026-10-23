/**
 * Cloudflare Workers Builds compatibility helper:
 * If a Cloudflare Worker project's deploy command or non-production branch deploy
 * command is set to `npx wrangler preview` (which Wrangler v3 deprecated),
 * rewrite `wrangler preview` in `node_modules/wrangler/bin/wrangler.js` to
 * execute `wrangler deploy` so the build succeeds without requiring manual
 * dashboard command changes.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binCandidates = [
  path.join(rootDir, "node_modules", "wrangler", "bin", "wrangler.js"),
  path.join(rootDir, "backend", "node_modules", "wrangler", "bin", "wrangler.js"),
];

const SHIM_MARKER = "// [polytools-wrangler-preview-shim]";

for (const binPath of binCandidates) {
  if (!fs.existsSync(binPath)) continue;
  const source = fs.readFileSync(binPath, "utf8");
  if (source.includes(SHIM_MARKER)) continue;

  const target = "...process.argv.slice(2),";
  if (!source.includes(target)) continue;

  const replacement = `...(process.argv[2] === "preview" ? ["deploy", ...process.argv.slice(3)] : process.argv.slice(2)), ${SHIM_MARKER}`;
  fs.writeFileSync(binPath, source.replace(target, replacement), "utf8");
}
