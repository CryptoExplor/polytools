#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = fileURLToPath(new URL("..", import.meta.url));

export const SDK_PACKAGES = [
  {
    ecosystem: "npm",
    name: "@polyester/sdk",
    pinnedVersion: "0.31.0",
    registryUrl: "https://registry.npmjs.org/@polyester%2Fsdk",
  },
  {
    ecosystem: "pypi",
    name: "polyester-sdk",
    pinnedVersion: "0.1.0a55",
    registryUrl: "https://pypi.org/pypi/polyester-sdk/json",
  },
  {
    ecosystem: "crates",
    name: "polyester-sdk",
    pinnedVersion: "0.1.0-alpha.49",
    registryUrl: "https://crates.io/api/v1/crates/polyester-sdk",
  },
];

export function extractExternalLinks(text, source = "synthetic") {
  const urls = new Map();
  const pattern = /(["'`])(https:\/\/[^"'`\s]+)\1/g;
  for (const match of text.matchAll(pattern)) {
    const url = match[2];
    if (url.includes("${")) continue;
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") continue;
    if (parsed.hostname === "assets.polyester.com") continue;
    urls.set(url, { kind: "link", url, source });
  }
  return [...urls.values()];
}

export function collectBrandAssets(brand) {
  const assets = new Map();
  const add = (url, group) => {
    if (typeof url !== "string" || !url.startsWith("https://")) return;
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return;
    assets.set(url, { kind: "asset", url, source: "apps/web/src/brand.ts", group });
  };

  add(brand.BRAND_KIT_ZIP_URL, "brand-archive");
  add(brand.SCAN_BRAND_KIT_ZIP_URL, "brand-archive");
  for (const asset of brand.BRAND_LOGO_ASSETS ?? []) add(asset.url, "logo");
  for (const asset of brand.BRAND_IMAGERY_ASSETS ?? []) {
    add(asset.previewUrl, "imagery-preview");
    add(asset.downloadUrl, "imagery-download");
  }
  for (const avatar of brand.POLYBOT_AVATARS ?? []) add(avatar.url, "avatar");
  for (const token of brand.TOKEN_BRAND_SPECS ?? []) {
    for (const angle of ["front", "side", "low-angle"]) {
      add(brand.getTokenPackshotUrl(token.symbol, angle), `token-${angle}`);
    }
  }
  return [...assets.values()];
}

export function sdkPinMatchesSource(pkg, sdkGuideSource) {
  if (pkg.ecosystem === "npm") {
    return Boolean(pkg.pinnedVersion) &&
      sdkGuideSource.includes(`npm install ${pkg.name}@${pkg.pinnedVersion}`) &&
      sdkGuideSource.includes(`pnpm add ${pkg.name}@${pkg.pinnedVersion}`) &&
      sdkGuideSource.includes(`bun add ${pkg.name}@${pkg.pinnedVersion}`);
  }
  if (pkg.ecosystem === "pypi") {
    return sdkGuideSource.includes(`${pkg.name}==${pkg.pinnedVersion}`);
  }
  if (pkg.ecosystem === "crates") {
    return sdkGuideSource.includes(`${pkg.name} = "${pkg.pinnedVersion}"`);
  }
  return false;
}

export async function loadExternalInventory(rootDir = DEFAULT_ROOT) {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root: rootDir,
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    const brand = await vite.ssrLoadModule("/apps/web/src/brand.ts");
    const sdkGuideSource = readFileSync(`${rootDir}/apps/web/src/pages/SdkGuide.tsx`, "utf8");
    const sdkExamplesSource = readFileSync(`${rootDir}/apps/web/src/lib/sdkTypescriptExamples.ts`, "utf8");
    const sdkSource = `${sdkGuideSource}\n${sdkExamplesSource}`;
    const hubSource = readFileSync(`${rootDir}/apps/web/src/pages/Hub.tsx`, "utf8");
    const links = new Map();
    for (const item of [
      ...extractExternalLinks(sdkGuideSource, "apps/web/src/pages/SdkGuide.tsx"),
      ...extractExternalLinks(hubSource, "apps/web/src/pages/Hub.tsx"),
    ]) {
      links.set(item.url, item);
    }
    return {
      links: [...links.values()],
      assets: collectBrandAssets(brand),
      sdk: SDK_PACKAGES.map((pkg) => ({
        ...pkg,
        sourceMatches: sdkPinMatchesSource(pkg, sdkSource),
      })),
    };
  } finally {
    await vite.close();
  }
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkUrl(item, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const baseInit = {
    redirect: "follow",
    headers: { "User-Agent": "PolyTools-External-Freshness/1.0" },
  };
  try {
    let method = "HEAD";
    let response = await fetchWithTimeout(fetchImpl, item.url, {
      ...baseInit,
      method,
    }, timeoutMs);
    if (response.status === 405 || response.status === 501) {
      method = "GET";
      response = await fetchWithTimeout(fetchImpl, item.url, {
        ...baseInit,
        method,
        headers: { ...baseInit.headers, Range: "bytes=0-0" },
      }, timeoutMs);
    }
    await response.body?.cancel?.();
    return {
      ...item,
      ok: response.status >= 200 && response.status < 400,
      status: response.status,
      method,
      finalUrl: response.url || item.url,
      error: null,
    };
  } catch (error) {
    return {
      ...item,
      ok: false,
      status: null,
      method: null,
      finalUrl: null,
      error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 240) : "Unknown fetch failure",
    };
  }
}

export async function checkUrls(items, options = {}) {
  const concurrency = Math.max(1, Math.min(8, options.concurrency ?? 4));
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await checkUrl(items[index], options);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

export function sdkRegistryVersionInfo(pkg, data) {
  let latestVersion = null;
  let pinnedVersionAvailable = null;
  let publishedLicense = null;
  let repository = null;
  let maintainers = [];
  if (pkg.ecosystem === "npm") {
    latestVersion = data?.["dist-tags"]?.latest ?? null;
    const pinnedMetadata = pkg.pinnedVersion ? data?.versions?.[pkg.pinnedVersion] : null;
    if (pkg.pinnedVersion) pinnedVersionAvailable = Boolean(pinnedMetadata);
    publishedLicense = pinnedMetadata?.license ?? data?.license ?? null;
    const repositoryMetadata = pinnedMetadata?.repository ?? data?.repository;
    repository = typeof repositoryMetadata === "string"
      ? repositoryMetadata
      : repositoryMetadata?.url ?? null;
    maintainers = Array.isArray(data?.maintainers)
      ? data.maintainers.map((entry) => entry?.name).filter((name) => typeof name === "string")
      : [];
  } else if (pkg.ecosystem === "pypi") {
    latestVersion = data?.info?.version ?? null;
    if (pkg.pinnedVersion) {
      pinnedVersionAvailable = Array.isArray(data?.releases?.[pkg.pinnedVersion]) &&
        data.releases[pkg.pinnedVersion].length > 0;
    }
  } else if (pkg.ecosystem === "crates") {
    latestVersion = data?.crate?.max_version ?? null;
    if (pkg.pinnedVersion) {
      pinnedVersionAvailable = Array.isArray(data?.versions) &&
        data.versions.some((entry) => entry?.num === pkg.pinnedVersion);
    }
  }
  return {
    latestVersion,
    pinnedVersion: pkg.pinnedVersion,
    pinnedVersionAvailable,
    publishedLicense,
    repository,
    maintainers,
    status: pkg.pinnedVersion
      ? pinnedVersionAvailable ? "pinned-present" : "pinned-missing"
      : "unpinned",
  };
}

export async function checkSdkRegistry(pkg, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 10_000;
  try {
    const response = await fetchWithTimeout(fetchImpl, pkg.registryUrl, {
      method: "GET",
      redirect: "follow",
      headers: { Accept: "application/json", "User-Agent": "PolyTools-SDK-Freshness/1.0" },
    }, timeoutMs);
    if (!response.ok) {
      await response.body?.cancel?.();
      return { ...pkg, ok: false, httpStatus: response.status, status: "registry-error", error: `Registry HTTP ${response.status}` };
    }
    const data = await response.json();
    const versions = sdkRegistryVersionInfo(pkg, data);
    return {
      ...pkg,
      ...versions,
      ok: typeof versions.latestVersion === "string" && versions.pinnedVersionAvailable !== false,
      httpStatus: response.status,
      error: null,
    };
  } catch (error) {
    return {
      ...pkg,
      ok: false,
      httpStatus: null,
      status: "registry-error",
      error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 240) : "Unknown registry failure",
    };
  }
}

function printHuman(report) {
  console.log(`External inventory: ${report.counts.links} links, ${report.counts.assets} assets, ${report.counts.sdk} SDK packages`);
  console.log(`Mode: ${report.network ? "opt-in public network checks" : "offline inventory only (no network)"}`);
  for (const pkg of report.sdk) {
    const pin = pkg.pinnedVersion ?? "unpinned";
    const latest = pkg.latestVersion ? `; latest=${pkg.latestVersion}` : "";
    const license = pkg.publishedLicense ? `; license=${pkg.publishedLicense}` : "";
    const repository = pkg.repository ? `; repository=${pkg.repository}` : "";
    const maintainers = pkg.maintainers?.length ? `; maintainers=${pkg.maintainers.join(",")}` : "";
    const error = pkg.error ? `; ${pkg.error}` : "";
    console.log(`SDK ${pkg.ecosystem}:${pkg.name} pin=${pin}; sourceMatches=${pkg.sourceMatches}${latest}${license}${repository}${maintainers}${error}`);
  }
  const failures = [...report.links, ...report.assets, ...report.sdk].filter((item) => item.ok === false);
  for (const failure of failures) {
    console.log(`FAIL ${failure.url ?? failure.registryUrl}: ${failure.error ?? `HTTP ${failure.status}`}`);
  }
  console.log(`Summary: ${report.counts.checked} checked, ${report.counts.failed} failed, ${report.counts.sourceMismatches} source pin mismatches`);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args.find((arg) => !arg.startsWith("--")) ?? "inventory";
  if (!["inventory", "links", "assets", "sdk", "all"].includes(command)) {
    throw new Error("Usage: check-external-content.mjs [inventory|links|assets|sdk|all] [--network] [--json] [--ecosystem=npm,pypi]");
  }
  const network = args.includes("--network");
  const ecosystemArg = args.find((arg) => arg.startsWith("--ecosystem="))?.split("=")[1];
  const ecosystems = ecosystemArg ? new Set(ecosystemArg.split(",")) : null;
  const inventory = await loadExternalInventory();
  const report = {
    generatedAt: new Date().toISOString(),
    command,
    network,
    links: command === "inventory" || command === "links" || command === "all" ? inventory.links : [],
    assets: command === "inventory" || command === "assets" || command === "all" ? inventory.assets : [],
    sdk: (command === "sdk" || command === "all" || command === "inventory" ? inventory.sdk : [])
      .filter((pkg) => !ecosystems || ecosystems.has(pkg.ecosystem)),
  };

  if (network) {
    if (report.links.length) report.links = await checkUrls(report.links);
    if (report.assets.length) report.assets = await checkUrls(report.assets);
    report.sdk = await Promise.all(report.sdk.map((pkg) => checkSdkRegistry(pkg)));
  }

  const selected = [...report.links, ...report.assets, ...report.sdk];
  report.counts = {
    links: report.links.length,
    assets: report.assets.length,
    sdk: report.sdk.length,
    checked: network ? selected.length : 0,
    failed: network ? selected.filter((item) => item.ok === false).length : 0,
    sourceMismatches: report.sdk.filter((pkg) => pkg.sourceMatches === false).length,
  };
  if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);
  if (report.counts.failed > 0 || report.counts.sourceMismatches > 0) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SCRIPT_PATH)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
