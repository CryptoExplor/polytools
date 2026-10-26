#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = `${ROOT}/apps/web/dist`;

function attribute(tag, name) {
  return tag.match(new RegExp(`\\b${name}=["']([^"']+)["']`, "i"))?.[1] ?? null;
}

function localAssetKey(url) {
  if (!url || /^https?:\/\//i.test(url) || url.startsWith("data:")) return null;
  return url.split(/[?#]/, 1)[0].replace(/^\//, "");
}

export function analyzeBuild({ html, appSource, files }) {
  const fileMap = new Map(files.map((file) => [file.key.replaceAll("\\", "/"), file]));
  const scriptUrls = [...html.matchAll(/<script\b[^>]*>/gi)]
    .map((match) => attribute(match[0], "src"))
    .filter(Boolean);
  const stylesheetUrls = [...html.matchAll(/<link\b[^>]*>/gi)]
    .filter((match) => /rel=["']stylesheet["']/i.test(match[0]))
    .map((match) => attribute(match[0], "href"))
    .filter(Boolean);
  const otherLinkedUrls = [...html.matchAll(/<link\b[^>]*>/gi)]
    .filter((match) => /rel=["'](?:icon|apple-touch-icon|manifest)["']/i.test(match[0]))
    .map((match) => attribute(match[0], "href"))
    .filter(Boolean);

  const measure = (urls) => {
    const assets = urls.map((url) => {
      const key = localAssetKey(url);
      const file = key ? fileMap.get(key) : null;
      if (!file) throw new Error(`Built HTML references missing local asset: ${url}`);
      const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data);
      return {
        url,
        key,
        bytes: data.byteLength,
        gzipBytes: gzipSync(data, { level: 9 }).byteLength,
      };
    });
    return {
      requests: assets.length,
      bytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
      gzipBytes: assets.reduce((sum, asset) => sum + asset.gzipBytes, 0),
      assets,
    };
  };

  const importLines = appSource.split("\n").filter((line) => /^\s*import\s/.test(line));
  return {
    initialJs: measure(scriptUrls),
    initialCss: measure(stylesheetUrls),
    otherLinkedRequests: otherLinkedUrls.length,
    staticPageImports: importLines.filter((line) => /from\s+["']\.\/pages\//.test(line)).length,
    dynamicPageImports: (appSource.match(/import\s*\(\s*["']\.\/pages\//g) ?? []).length,
    totalBuildFiles: files.length,
  };
}

export function evaluatePerformanceBudget(metrics, budget) {
  const checks = [
    ["initialJs.bytes", metrics.initialJs.bytes, budget.initialJsBytes],
    ["initialJs.gzipBytes", metrics.initialJs.gzipBytes, budget.initialJsGzipBytes],
    ["initialCss.bytes", metrics.initialCss.bytes, budget.initialCssBytes],
    ["initialCss.gzipBytes", metrics.initialCss.gzipBytes, budget.initialCssGzipBytes],
  ];
  return checks.map(([name, actual, maximum]) => ({
    name,
    actual,
    maximum,
    ok: actual <= maximum,
  }));
}

function walk(directory, prefix = "") {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const key = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...walk(`${directory}${sep}${entry.name}`, key));
    else if (entry.isFile()) files.push(key);
  }
  return files;
}

export function measureCurrentBuild(dist = DIST, appPath = `${ROOT}/apps/web/src/App.tsx`) {
  if (!existsSync(`${dist}/index.html`)) {
    throw new Error("apps/web/dist/index.html is missing; run npm run build first");
  }
  const keys = walk(dist);
  const files = keys.map((key) => ({ key, data: readFileSync(`${dist}/${key}`) }));
  return analyzeBuild({
    html: readFileSync(`${dist}/index.html`, "utf8"),
    appSource: readFileSync(appPath, "utf8"),
    files,
  });
}

function printHuman(metrics, checks) {
  for (const [label, group] of [["JS", metrics.initialJs], ["CSS", metrics.initialCss]]) {
    console.log(`${label}: ${group.requests} initial request(s), ${group.bytes} bytes, ${group.gzipBytes} gzip-9 bytes`);
    for (const asset of group.assets) console.log(`  ${asset.key}: ${asset.bytes} bytes`);
  }
  console.log(`Other linked icon/manifest requests: ${metrics.otherLinkedRequests}`);
  console.log(`App page imports: ${metrics.staticPageImports} static, ${metrics.dynamicPageImports} dynamic`);
  console.log(`Build files: ${metrics.totalBuildFiles}`);
  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}: ${check.actual} <= ${check.maximum}`);
  }
}

function main() {
  const metrics = measureCurrentBuild();
  const budget = JSON.parse(readFileSync(`${ROOT}/scripts/performance-budget.json`, "utf8"));
  const checks = evaluatePerformanceBudget(metrics, budget);
  const report = {
    generatedAt: new Date().toISOString(),
    methodology: "Built index request shape and local file bytes; gzip level 9. Not Web Vitals or browser timing.",
    metrics,
    budgetChecks: checks,
  };
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else printHuman(metrics, checks);
  if (checks.some((check) => !check.ok)) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SCRIPT_PATH)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
