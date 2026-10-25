import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  SDK_PACKAGES,
  checkSdkRegistry,
  checkUrl,
  collectBrandAssets,
  extractExternalLinks,
  sdkPinMatchesSource,
  sdkRegistryVersionInfo,
} from "../scripts/check-external-content.mjs";
import {
  analyzeBuild,
  evaluatePerformanceBudget,
} from "../scripts/check-build-performance.mjs";
import {
  REQUIRED_RUNTIME_FEATURES,
  evaluateRuntime,
} from "../scripts/check-runtime.mjs";
import {
  checkWorkspaceLockVersions,
  summarizeDependencyLock,
} from "../scripts/check-dependencies.mjs";
import { inspectText, repositoryFiles } from "../scripts/check-whitespace.mjs";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const source = (path) => readFileSync(`${rootDir}/${path}`, "utf8");

describe("P3-3 external content inventory and synthetic freshness checks", () => {
  it("extracts concrete links, expands brand assets, and validates SDK source pins", () => {
    const links = extractExternalLinks(`
      const one = "https://testnet.polyester.com/docs";
      const duplicate = 'https://testnet.polyester.com/docs';
      const asset = "https://assets.polyester.com/a.svg";
      const dynamic = \`https://example.com/\${id}\`;
    `);
    assert.deepEqual(links.map((item) => item.url), ["https://testnet.polyester.com/docs"]);

    const assets = collectBrandAssets({
      BRAND_KIT_ZIP_URL: "https://assets.polyester.com/brand.zip",
      SCAN_BRAND_KIT_ZIP_URL: "https://assets.polyester.com/scan.zip",
      BRAND_LOGO_ASSETS: [{ url: "https://assets.polyester.com/logo.svg" }],
      BRAND_IMAGERY_ASSETS: [{
        previewUrl: "https://assets.polyester.com/poster.webp",
        downloadUrl: "https://assets.polyester.com/loop.mp4",
      }],
      POLYBOT_AVATARS: [{ url: "https://assets.polyester.com/avatar.png" }],
      TOKEN_BRAND_SPECS: [{ symbol: "BTC" }],
      getTokenPackshotUrl: (symbol, angle) => `https://assets.polyester.com/${symbol}/${angle}.webp`,
    });
    assert.equal(assets.length, 9);
    assert.deepEqual(
      assets.filter((item) => item.group.startsWith("token-")).map((item) => item.group),
      ["token-front", "token-side", "token-low-angle"],
    );

    const guide = source("apps/web/src/pages/SdkGuide.tsx");
    for (const pkg of SDK_PACKAGES) {
      assert.equal(sdkPinMatchesSource(pkg, guide), true, `${pkg.ecosystem} source pin`);
    }
  });

  it("uses bounded read-only URL checks with HEAD-to-range-GET fallback", async () => {
    const calls = [];
    const result = await checkUrl(
      { kind: "asset", url: "https://assets.polyester.com/synthetic.svg" },
      {
        fetchImpl: async (url, init) => {
          calls.push({ url, init });
          return calls.length === 1
            ? new Response(null, { status: 405 })
            : new Response("x", { status: 206 });
        },
      },
    );
    assert.equal(result.ok, true);
    assert.equal(result.status, 206);
    assert.equal(result.method, "GET");
    assert.deepEqual(calls.map((call) => call.init.method), ["HEAD", "GET"]);
    assert.equal(calls[1].init.headers.Range, "bytes=0-0");
    assert.ok(calls.every((call) => call.init.method !== "POST"));

    const failed = await checkUrl(
      { kind: "link", url: "https://example.invalid" },
      { fetchImpl: async () => { throw new Error("synthetic offline"); } },
    );
    assert.equal(failed.ok, false);
    assert.ok(failed.error.includes("synthetic offline"));
  });

  it("parses npm, PyPI, and crates versions without executing SDK examples", async () => {
    const npm = SDK_PACKAGES.find((pkg) => pkg.ecosystem === "npm");
    const pypi = SDK_PACKAGES.find((pkg) => pkg.ecosystem === "pypi");
    const crates = SDK_PACKAGES.find((pkg) => pkg.ecosystem === "crates");
    assert.equal(
      sdkRegistryVersionInfo(npm, { "dist-tags": { latest: "1.2.3" } }).status,
      "unpinned",
    );
    assert.equal(
      sdkRegistryVersionInfo(pypi, {
        info: { version: "0.1.0a55" },
        releases: { "0.1.0a55": [{}] },
      }).pinnedVersionAvailable,
      true,
    );
    assert.equal(
      sdkRegistryVersionInfo(crates, {
        crate: { max_version: "0.1.0-alpha.50" },
        versions: [{ num: "0.1.0-alpha.50" }],
      }).pinnedVersionAvailable,
      false,
    );

    let method;
    const checked = await checkSdkRegistry(pypi, {
      fetchImpl: async (_url, init) => {
        method = init.method;
        return new Response(JSON.stringify({
          info: { version: "0.1.0a55" },
          releases: { "0.1.0a55": [{}] },
        }), { status: 200 });
      },
    });
    assert.equal(checked.ok, true);
    assert.equal(checked.status, "pinned-present");
    assert.equal(method, "GET");
  });
});

describe("P3-4/P3-6 measured build and repository assurance helpers", () => {
  it("measures initial build bytes/requests and evaluates a real byte budget", () => {
    const html = `<!doctype html><html><head>
      <script type="module" src="/assets/app.js"></script>
      <link rel="stylesheet" href="/assets/app.css">
      <link rel="icon" href="/favicon.svg">
    </head></html>`;
    const appSource = `import Dashboard from "./pages/Dashboard";\nimport Hub from "./pages/Hub";\nconst Lazy = lazy(() => import("./pages/Lazy"));`;
    const metrics = analyzeBuild({
      html,
      appSource,
      files: [
        { key: "assets/app.js", data: Buffer.from("console.log('synthetic')") },
        { key: "assets/app.css", data: Buffer.from("body{color:red}") },
        { key: "favicon.svg", data: Buffer.from("<svg/>") },
      ],
    });
    assert.equal(metrics.initialJs.requests, 1);
    assert.equal(metrics.initialCss.requests, 1);
    assert.equal(metrics.otherLinkedRequests, 1);
    assert.equal(metrics.staticPageImports, 2);
    assert.equal(metrics.dynamicPageImports, 1);
    assert.ok(metrics.initialJs.gzipBytes > 0);

    const budget = {
      initialJsBytes: metrics.initialJs.bytes,
      initialJsGzipBytes: metrics.initialJs.gzipBytes,
      initialCssBytes: metrics.initialCss.bytes,
      initialCssGzipBytes: metrics.initialCss.gzipBytes,
    };
    assert.ok(evaluatePerformanceBudget(metrics, budget).every((check) => check.ok));
    assert.ok(evaluatePerformanceBudget(metrics, { ...budget, initialJsBytes: 1 }).some((check) => !check.ok));
  });

  it("checks the current engine/features without claiming another runtime", () => {
    const features = Object.fromEntries(REQUIRED_RUNTIME_FEATURES.map((name) => [name, true]));
    assert.equal(evaluateRuntime({ nodeVersion: "v24.0.0", engineRange: ">=24", features }).ok, true);
    assert.equal(evaluateRuntime({ nodeVersion: "v22.22.3", engineRange: ">=24", features }).ok, false);
    assert.equal(evaluateRuntime({
      nodeVersion: "v24.0.0",
      engineRange: ">=24",
      features: { ...features, ed25519: false },
    }).ok, false);
  });

  it("inventories lockfile licenses and workspace version drift", () => {
    const lock = {
      lockfileVersion: 3,
      packages: {
        "": { version: "0.1.0" },
        "node_modules/a": { version: "1.0.0", license: "MIT" },
        "node_modules/b": { version: "2.0.0", license: "ISC", dev: true },
        "node_modules/c": { version: "3.0.0" },
        "node_modules/@poly/web": { link: true, resolved: "apps/web" },
      },
    };
    const summary = summarizeDependencyLock(lock);
    assert.equal(summary.packages, 3);
    assert.equal(summary.productionPackages, 2);
    assert.equal(summary.developmentPackages, 1);
    assert.deepEqual(summary.licenses, { MIT: 1, ISC: 1, UNKNOWN: 1 });
    assert.equal(summary.missingLicense.length, 1);
    assert.deepEqual(summary.workspaceLinks, [{ path: "node_modules/@poly/web", resolved: "apps/web" }]);
    assert.deepEqual(
      checkWorkspaceLockVersions(lock, { version: "0.2.0" }, {}),
      [{ path: "", expected: "0.2.0", actual: "0.1.0" }],
    );
  });

  it("checks untracked non-ignored files and handles Markdown/conflict/newline rules", () => {
    assert.equal(inspectText("new.ts", "const x = 1;  \n")[0].kind, "trailing-whitespace");
    assert.deepEqual(inspectText("note.md", "line  \n"), []);
    assert.equal(inspectText("note.md", "line   \n")[0].kind, "trailing-whitespace");
    assert.ok(inspectText("new.ts", "const x = 1;").some((item) => item.kind === "missing-final-newline"));
    assert.ok(inspectText("new.ts", "<<<<<<< HEAD\n").some((item) => item.kind === "conflict-marker"));

    const files = repositoryFiles(rootDir);
    assert.ok(files.includes("scripts/check-whitespace.mjs"), "untracked script must be included");
    assert.ok(!files.includes("apps/web/dist/index.html"), "ignored build output must be excluded");
  });
});
