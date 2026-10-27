import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const page = readFileSync(
  fileURLToPath(new URL("../apps/web/src/pages/Calc.tsx", import.meta.url)),
  "utf8",
);

describe("calculator liquidation model disclosure", () => {
  it("keeps the estimate explicitly generic and avoids unsupported venue outcomes", () => {
    assert.match(page, /Textbook 1\/L sketch only/);
    assert.match(page, /does not model Polyester's spot\/lending risk behavior/);
    assert.match(page, /or predict an actual\s+liquidation price/);
    assert.doesNotMatch(page, /Actual liquidation occurs slightly\s+closer to entry/i);
  });
});
