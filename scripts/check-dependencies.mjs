#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = fileURLToPath(new URL("..", import.meta.url));

function increment(target, key) {
  target[key] = (target[key] ?? 0) + 1;
}

export function summarizeDependencyLock(lock) {
  const allLicenses = {};
  const productionLicenses = {};
  const missingLicense = [];
  const workspaceLinks = [];
  let packages = 0;
  let productionPackages = 0;
  let developmentPackages = 0;

  for (const [path, entry] of Object.entries(lock.packages ?? {})) {
    if (!path.includes("node_modules/")) continue;
    if (entry.link === true) {
      workspaceLinks.push({ path, resolved: entry.resolved ?? null });
      continue;
    }
    packages += 1;
    const license = typeof entry.license === "string" && entry.license.trim()
      ? entry.license.trim()
      : "UNKNOWN";
    increment(allLicenses, license);
    if (entry.dev === true) developmentPackages += 1;
    else {
      productionPackages += 1;
      increment(productionLicenses, license);
    }
    if (license === "UNKNOWN") {
      missingLicense.push({ path, name: entry.name ?? null, version: entry.version ?? null });
    }
  }

  return {
    lockfileVersion: lock.lockfileVersion ?? null,
    packages,
    productionPackages,
    developmentPackages,
    licenses: allLicenses,
    productionLicenses,
    missingLicense,
    workspaceLinks,
    note: "Lockfile license metadata inventory, not a legal compatibility opinion or vulnerability audit.",
  };
}

export function checkWorkspaceLockVersions(lock, rootPackage, workspacePackages) {
  const mismatches = [];
  if (lock.packages?.[""]?.version !== rootPackage.version) {
    mismatches.push({ path: "", expected: rootPackage.version, actual: lock.packages?.[""]?.version ?? null });
  }
  for (const [path, pkg] of Object.entries(workspacePackages)) {
    if (lock.packages?.[path]?.version !== pkg.version) {
      mismatches.push({ path, expected: pkg.version, actual: lock.packages?.[path]?.version ?? null });
    }
  }
  return mismatches;
}

function main() {
  const lock = JSON.parse(readFileSync(`${ROOT}/package-lock.json`, "utf8"));
  const rootPackage = JSON.parse(readFileSync(`${ROOT}/package.json`, "utf8"));
  const workspacePackages = Object.fromEntries(
    ["apps/web", "backend", "packages/core"].map((path) => [
      path,
      JSON.parse(readFileSync(`${ROOT}/${path}/package.json`, "utf8")),
    ]),
  );
  const summary = summarizeDependencyLock(lock);
  const workspaceVersionMismatches = checkWorkspaceLockVersions(lock, rootPackage, workspacePackages);
  const report = { ...summary, workspaceVersionMismatches };
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Lockfile v${summary.lockfileVersion}: ${summary.packages} external package paths (${summary.productionPackages} production, ${summary.developmentPackages} development), ${summary.workspaceLinks.length} workspace links`);
    console.log(`All licenses: ${Object.entries(summary.licenses).map(([name, count]) => `${name}=${count}`).join(", ")}`);
    console.log(`Production licenses: ${Object.entries(summary.productionLicenses).map(([name, count]) => `${name}=${count}`).join(", ")}`);
    console.log(`Missing license metadata: ${summary.missingLicense.length}`);
    console.log(`Workspace lock version mismatches: ${workspaceVersionMismatches.length}`);
    console.log(summary.note);
  }
  if (summary.lockfileVersion !== 3 || summary.missingLicense.length || workspaceVersionMismatches.length) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SCRIPT_PATH)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
