#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { TextDecoder } from "node:util";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const utf8Strict = new TextDecoder("utf-8", { fatal: true });

export function inspectText(path, text) {
  const violations = [];
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].replace(/\r$/, "");
    const trailing = line.match(/[ \t]+$/)?.[0] ?? "";
    const markdownBreak = path.endsWith(".md") && trailing === "  ";
    if (trailing && !markdownBreak) {
      violations.push({ path, line: index + 1, kind: "trailing-whitespace" });
    }
    if (/^(?:<{7}|={7}|>{7})(?:\s|$)/.test(line)) {
      violations.push({ path, line: index + 1, kind: "conflict-marker" });
    }
  }
  if (text.length > 0 && !text.endsWith("\n")) {
    violations.push({ path, line: lines.length, kind: "missing-final-newline" });
  }
  return violations;
}

export function repositoryFiles(rootDir = ROOT) {
  const output = execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: rootDir, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  );
  return output.split("\0").filter(Boolean).filter((path) => {
    try {
      return statSync(`${rootDir}/${path}`).isFile();
    } catch {
      return false;
    }
  });
}

function main() {
  const files = repositoryFiles();
  const violations = [];
  let binaryFiles = 0;
  let largeFiles = 0;
  for (const path of files) {
    const data = readFileSync(`${ROOT}/${path}`);
    if (data.includes(0)) {
      binaryFiles += 1;
      continue;
    }
    if (data.byteLength > 5 * 1024 * 1024) {
      largeFiles += 1;
      continue;
    }
    try {
      violations.push(...inspectText(path, utf8Strict.decode(data)));
    } catch {
      binaryFiles += 1;
    }
  }
  const report = {
    filesListed: files.length,
    filesChecked: files.length - binaryFiles - largeFiles,
    binaryFilesSkipped: binaryFiles,
    largeFilesSkipped: largeFiles,
    includesUntrackedNotIgnored: true,
    violations,
  };
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Whitespace: ${report.filesChecked}/${report.filesListed} Git tracked + untracked/non-ignored files checked; ${binaryFiles} binary and ${largeFiles} large files skipped`);
    for (const violation of violations) {
      console.log(`${violation.path}:${violation.line}: ${violation.kind}`);
    }
    console.log(`Violations: ${violations.length}`);
  }
  if (violations.length) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(SCRIPT_PATH)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
