import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { createServer } from "vite";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const virtualDir = resolve(rootDir, "apps/web/src/__sdk_example_typecheck__");
let vite;
let buildTypeScriptSdkExample;

before(async () => {
  vite = await createServer({ root: rootDir, logLevel: "silent", server: { middlewareMode: true } });
  ({ buildTypeScriptSdkExample } = await vite.ssrLoadModule("/apps/web/src/lib/sdkTypescriptExamples.ts"));
});

after(async () => {
  if (vite) await vite.close();
});

describe("pinned TypeScript SDK generated examples", () => {
  it("pins the installation commands and discloses the package license restriction", () => {
    const install = buildTypeScriptSdkExample({
      step: "install",
      symbol: "BTC-USDT",
      streamTf: "1m",
      orderSide: "buy",
      orderQty: "0.001",
      orderPrice: "50000",
      keyIdInput: "ak_test_key_id",
    });
    assert.match(install, /npm install @polyester\/sdk@0\.31\.0/);
    assert.match(install, /pnpm add @polyester\/sdk@0\.31\.0/);
    assert.match(install, /bun add @polyester\/sdk@0\.31\.0/);
    assert.match(install, /separate written agreement/);
  });

  it("typechecks the generated public, streaming, and authenticated-order snippets without executing them", () => {
    const examples = ["market", "stream", "trade"].map((step) => ({
      name: step,
      source: buildTypeScriptSdkExample({
        step,
        symbol: "BTC-USDT",
        streamTf: "1m",
        orderSide: "buy",
        orderQty: "0.001",
        orderPrice: "50000",
        keyIdInput: "ak_test_key_id",
      }),
    }));
    const virtualFiles = new Map(examples.map(({ name, source }) => [
      resolve(virtualDir, `${name}.ts`),
      source,
    ]));
    const options = {
      target: ts.ScriptTarget.ES2021,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      types: ["node"],
      lib: ["lib.es2021.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    };
    const host = ts.createCompilerHost(options);
    const originalGetSourceFile = host.getSourceFile.bind(host);
    const originalFileExists = host.fileExists.bind(host);
    const originalReadFile = host.readFile.bind(host);
    host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
      const source = virtualFiles.get(resolve(fileName));
      return source === undefined
        ? originalGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
        : ts.createSourceFile(fileName, source, languageVersion, true);
    };
    host.fileExists = (fileName) => virtualFiles.has(resolve(fileName)) || originalFileExists(fileName);
    host.readFile = (fileName) => virtualFiles.get(resolve(fileName)) ?? originalReadFile(fileName);

    const program = ts.createProgram({ rootNames: [...virtualFiles.keys()], options, host });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    const details = diagnostics.map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      if (!diagnostic.file || diagnostic.start === undefined) return message;
      const location = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return `${diagnostic.file.fileName}:${location.line + 1}:${location.character + 1} ${message}`;
    }).join("\n");
    assert.equal(diagnostics.length, 0, details);
  });
});
