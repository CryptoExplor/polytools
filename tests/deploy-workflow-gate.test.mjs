import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Normalise line endings: a Windows checkout with core.autocrlf turns LF into
// CRLF, and every pattern below is written against LF. Without this the gate
// fails on Windows for a reason that has nothing to do with deployment.
const readWorkflow = async (path) =>
  (await readFile(new URL(path, import.meta.url), "utf8")).replace(/\r\n/g, "\n");

const [ciWorkflow, pagesWorkflow] = await Promise.all([
  readWorkflow("../.github/workflows/ci.yml"),
  readWorkflow("../.github/workflows/pages.yml"),
]);

describe("Pages deployment verification gate", () => {
  it("exposes the full Verify workflow as a reusable workflow", () => {
    assert.match(ciWorkflow, /^on:\n  pull_request:\n  workflow_call:\n/m);
    for (const command of [
      "npm run check:runtime",
      "npm run check:whitespace",
      "npm run check:external",
      "npm run check:dependencies",
      "npm test",
      "npm run typecheck",
      "npm run build",
      "npm run check:performance",
    ]) {
      assert.ok(ciWorkflow.includes(command), `Verify should retain ${command}`);
    }
  });

  it("makes Pages build and deploy wait for Verify to succeed", () => {
    assert.match(pagesWorkflow, /  verify:\n    uses: \.\/\.github\/workflows\/ci\.yml/);
    assert.match(pagesWorkflow, /  build-deploy:\n    needs: verify\n/);
  });
});
