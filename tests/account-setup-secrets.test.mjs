import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const portfolioSource = await readFile(
  new URL("../apps/web/src/pages/Portfolio.tsx", import.meta.url),
  "utf8",
);

describe("account setup secret lifecycle", () => {
  it("clears passphrases and imported private-key text on vault changes other than unlock", () => {
    const eventBranch = portfolioSource.match(/if \(event\.type !== "UNLOCK"\) \{([\s\S]*?)\n\s*\}/);
    assert.ok(eventBranch, "vault lifecycle listener should handle non-unlock events");
    for (const setter of ["setPrivateKeyInput", "setPassphrase", "setConfirmPassphrase"]) {
      assert.ok(eventBranch[1].includes(`${setter}("")`), `${setter} should be cleared on vault lifecycle changes`);
    }
  });

  it("clears setup secrets when navigating away from API setup and on pagehide", () => {
    const routeEffect = portfolioSource.match(/useEffect\(\(\) => \{\s*if \(section === "api"\) return;([\s\S]*?)\n\s*\}, \[section\]\);/);
    assert.ok(routeEffect, "setup secret cleanup should follow account-section changes");
    for (const setter of ["setPrivateKeyInput", "setPassphrase", "setConfirmPassphrase"]) {
      assert.ok(routeEffect[1].includes(`${setter}("")`), `${setter} should be cleared after leaving API setup`);
    }
    assert.match(portfolioSource, /window\.addEventListener\("pagehide", clearSensitiveOutput\)/);
  });
});
