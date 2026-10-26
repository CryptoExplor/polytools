import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [ciWorkflow, pagesWorkflow] = await Promise.all([
  readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"),
  readFile(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8"),
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
