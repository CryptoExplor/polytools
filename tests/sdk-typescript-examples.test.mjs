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
    const details = typecheckExamples(examples);
    assert.equal(details.length, 0, details.join("\n"));
  });

  it("still typechecks when user input contains quotes, backslashes, and newlines", () => {
    // Every interpolated value is copied out of the UI into a snippet. A value
    // with a quote used to end the generated string literal early.
    // `streamTf` stays a valid enum member: the SDK types it as a union, so a
    // bogus value is rejected by the compiler rather than by quoting.
    const hostile = {
      symbol: 'BTC"USDT\\',
      streamTf: "1m",
      orderQty: '1"',
      orderPrice: "5\\000",
      keyIdInput: 'ak_x"y\\z',
    };
    const examples = ["market", "stream", "trade"].map((step) => ({
      name: `hostile-${step}`,
      source: buildTypeScriptSdkExample({
        step,
        orderSide: "buy",
        ...hostile,
      }),
    }));
    const details = typecheckExamples(examples);
    assert.equal(details.length, 0, details.join("\n"));

    const trade = examples.find((example) => example.name === "hostile-trade").source;
    // The values survive as literals instead of terminating the snippet.
    assert.ok(trade.includes('qty: "1\\""'), "a quote in the quantity must be escaped");
    assert.ok(trade.includes('requireSymbolIdByPairSymbol("BTC\\"USDT\\\\")'));
    assert.ok(trade.includes('ak_x\\"y\\\\z'), "a quote in the key ID must be escaped");
    // The environment-variable form must keep its own literal quotes.
    assert.ok(trade.includes('process.env.POLYESTER_API_KEY_ID ?? "'));
    assert.ok(!/qty: "1""/.test(trade), "an unescaped quote would still be present");
  });

  it("documents that the secret must be 0x-prefixed hex", () => {
    const trade = buildTypeScriptSdkExample({
      step: "trade",
      symbol: "BTC-USDT",
      streamTf: "1m",
      orderSide: "buy",
      orderQty: "0.001",
      orderPrice: "50000",
      keyIdInput: "ak_test_key_id",
    });
    // evmHexToBytes() rejects a bare hex string, so the example must say so and
    // normalize the value rather than passing the env var straight through.
    assert.match(trade, /0x-prefixed/);
    assert.match(trade, /Invalid hex value/);
    assert.match(trade, /evmHexToBytes\("0x" \+ /);
    assert.doesNotMatch(trade, /evmHexToBytes\(process\.env/);
  });

  it("keeps the generated snippets free of unescaped interpolations", () => {
    const rendered = ["market", "stream", "trade"].map((step) => buildTypeScriptSdkExample({
      step,
      symbol: "BTC-USDT",
      streamTf: "1m",
      orderSide: "buy",
      orderQty: "0.001",
      orderPrice: "50000",
      keyIdInput: "ak_test_key_id",
    })).join("\n");
    assert.ok(rendered.includes('requireSymbolIdByPairSymbol("BTC-USDT")'));
    assert.ok(rendered.includes('qty: "0.001"'));
    assert.ok(rendered.includes('price: "50000"'));
  });
});

/**
 * Compile the generated snippets in memory with the same strict options as the
 * app, returning formatted diagnostics instead of throwing.
 */
function typecheckExamples(examples) {
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
    return diagnostics.map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      if (!diagnostic.file || diagnostic.start === undefined) return message;
      const location = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return `${diagnostic.file.fileName}:${location.line + 1}:${location.character + 1} ${message}`;
    });
}
