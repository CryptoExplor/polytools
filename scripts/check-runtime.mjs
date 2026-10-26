#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = fileURLToPath(new URL("..", import.meta.url));

export const REQUIRED_RUNTIME_FEATURES = [
  "fetch",
  "Request",
  "Response",
  "Headers",
  "AbortController",
  "TextEncoder",
  "TextDecoder",
  "Blob",
  "URL",
  "webCrypto",
  "ed25519",
];

export function evaluateRuntime({ nodeVersion, engineRange, features }) {
  const major = Number(nodeVersion.replace(/^v/, "").split(".")[0]);
  const engineMatch = engineRange.match(/^>=(\d+)$/);
  const engineSatisfied = Boolean(engineMatch) && Number.isInteger(major) && major >= Number(engineMatch[1]);
  const featureChecks = REQUIRED_RUNTIME_FEATURES.map((name) => ({
    name,
    ok: features[name] === true,
  }));
  return {
    nodeVersion,
    engineRange,
    engineSatisfied,
    featureChecks,
    ok: engineSatisfied && featureChecks.every((check) => check.ok),
  };
}

async function probeEd25519() {
  if (!globalThis.crypto?.subtle) return false;
  try {
    const keyPair = await crypto.subtle.generateKey({ name: "Ed25519" }, false, ["sign", "verify"]);
    const payload = new TextEncoder().encode("synthetic runtime probe");
    const signature = await crypto.subtle.sign({ name: "Ed25519" }, keyPair.privateKey, payload);
    return crypto.subtle.verify({ name: "Ed25519" }, keyPair.publicKey, signature, payload);
  } catch {
    return false;
  }
}

export async function measureRuntime(rootDir = ROOT) {
  const rootPackage = JSON.parse(readFileSync(`${rootDir}/package.json`, "utf8"));
  const features = {
    fetch: typeof globalThis.fetch === "function",
    Request: typeof globalThis.Request === "function",
    Response: typeof globalThis.Response === "function",
    Headers: typeof globalThis.Headers === "function",
    AbortController: typeof globalThis.AbortController === "function",
    TextEncoder: typeof globalThis.TextEncoder === "function",
    TextDecoder: typeof globalThis.TextDecoder === "function",
    Blob: typeof globalThis.Blob === "function",
    URL: typeof globalThis.URL === "function",
    webCrypto: Boolean(globalThis.crypto?.subtle),
    ed25519: await probeEd25519(),
  };
  return evaluateRuntime({
    nodeVersion: process.version,
    engineRange: rootPackage.engines?.node ?? ">=24",
    features,
  });
}

function main() {
  return measureRuntime().then((report) => {
    const output = {
      ...report,
      scope: "Current runtime only. CI and deployment runtimes are separate and are not inferred from this result.",
    };
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Node ${report.nodeVersion}; engine ${report.engineRange}: ${report.engineSatisfied ? "PASS" : "FAIL"}`);
      for (const check of report.featureChecks) {
        console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name}`);
      }
      console.log(output.scope);
    }
    if (!report.ok) process.exitCode = 1;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SCRIPT_PATH)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
