import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
let vite;
let canonical;

before(async () => {
  vite = await createServer({ root: rootDir, logLevel: "silent", server: { middlewareMode: true } });
  canonical = await vite.ssrLoadModule("/apps/web/src/lib/canonicalRequest.ts");
});

after(async () => {
  if (vite) await vite.close();
});

const VALID = {
  timestamp: "1767225600000",
  path: "/v1/orders",
  query: "symbol=BTC-USD&limit=10",
  body: "",
  method: "GET",
};

function check(overrides) {
  return canonical.validateCanonicalRequest({ ...VALID, ...overrides });
}

describe("SDK canonical-string inspector validation", () => {
  it("accepts a well-formed GET request and reports no issues", () => {
    const result = check({});
    assert.equal(result.ok, true);
    assert.deepEqual(result.issues, []);
  });

  it("accepts a well-formed POST request with a JSON body", () => {
    const result = check({ method: "POST", path: "/v1/orders", body: '{"symbol":"BTC-USD","qty":1}' });
    assert.equal(result.ok, true);
  });

  it("explains a missing path instead of rendering an empty signature line", () => {
    const result = check({ path: "" });
    assert.equal(result.ok, false);
    assert.equal(result.issues.length, 1);
    assert.equal(result.issues[0].field, "path");
    assert.match(result.issues[0].message, /Enter a request path/);
  });

  it("rejects a path without a leading slash", () => {
    const [issue] = check({ path: "v1/orders" }).issues;
    assert.equal(issue.field, "path");
    assert.match(issue.message, /must start with '\//);
  });

  it("rejects a query string smuggled into the path", () => {
    const [issue] = check({ path: "/v1/orders?symbol=BTC-USD" }).issues;
    assert.equal(issue.field, "path");
    assert.match(issue.message, /query field instead/);
  });

  it("rejects unencoded characters in the path", () => {
    const [issue] = check({ path: "/v1/orders BTC" }).issues;
    assert.equal(issue.field, "path");
    assert.match(issue.message, /not allowed unencoded/);
  });

  it("rejects a seconds timestamp and says why", () => {
    const [issue] = check({ timestamp: "1767225600" }).issues;
    assert.equal(issue.field, "timestamp");
    assert.match(issue.message, /multiply by 1000/);
  });

  it("rejects a non-numeric timestamp", () => {
    const [issue] = check({ timestamp: "2026-01-01T00:00:00Z" }).issues;
    assert.equal(issue.field, "timestamp");
    assert.match(issue.message, /digits only/);
  });

  it("explains empty query pairs, missing values, and empty keys", () => {
    const doubled = canonical.queryIssues("symbol=BTC-USD&&limit=10");
    assert.equal(doubled.length, 1);
    assert.match(doubled[0].message, /double '&'/);

    const noValue = canonical.queryIssues("symbol");
    assert.equal(noValue.length, 1);
    assert.match(noValue[0].message, /no value/);

    const noKey = canonical.queryIssues("=BTC-USD");
    assert.equal(noKey.length, 1);
    assert.match(noKey[0].message, /empty key/);
  });

  it("flags a raw space in a query pair but accepts an empty value", () => {
    assert.match(canonical.queryIssues("symbol=BTC USD")[0].message, /raw space/);
    assert.deepEqual(canonical.queryIssues("symbol="), []);
    assert.deepEqual(canonical.queryIssues("?"), []);
    assert.deepEqual(canonical.queryIssues(""), []);
  });

  it("requires an empty body for GET and a JSON body for writes", () => {
    const getBody = canonical.bodyIssues("{}", "GET");
    assert.equal(getBody.length, 1);
    assert.match(getBody[0].message, /empty body hash/);

    const emptyPost = canonical.bodyIssues("   ", "POST");
    assert.equal(emptyPost.length, 1);
    assert.match(emptyPost[0].message, /needs a body to hash/);

    const badJson = canonical.bodyIssues("{not json", "POST");
    assert.equal(badJson.length, 1);
    assert.match(badJson[0].message, /not valid JSON/);

    assert.deepEqual(canonical.bodyIssues('{"a":1}', "DELETE"), []);
  });

  it("reports at most one issue per field so the notice stays actionable", () => {
    const result = check({
      timestamp: "not-a-number",
      path: "/v1/orders?x=1",
      query: "a&=b&&c d",
      body: "{oops",
    });
    assert.equal(result.ok, false);
    const fields = result.issues.map((issue) => issue.field);
    assert.deepEqual([...fields].sort(), ["body", "path", "query", "timestamp"]);
    assert.equal(new Set(fields).size, fields.length);
  });

  it("never rewrites the values it is asked to check", () => {
    const input = {
      timestamp: " 1767225600000 ",
      path: "  /v1/orders  ",
      query: " symbol=BTC-USD ",
      body: "",
      method: "GET",
    };
    const before = JSON.stringify(input);
    assert.equal(canonical.validateCanonicalRequest(input).ok, true);
    assert.equal(JSON.stringify(input), before);
    // The message quotes the typed value rather than a normalised one.
    assert.match(canonical.queryIssues("limit=ten units")[0].message, /limit=ten units/);
  });

  it("stays display-only: no network, storage, or signing in the module", () => {
    const source = readFileSync(new URL("../apps/web/src/lib/canonicalRequest.ts", import.meta.url), "utf8");
    for (const forbidden of ["fetch(", "localStorage", "sessionStorage", "XMLHttpRequest", "sign(", "navigator.sendBeacon"]) {
      assert.equal(source.includes(forbidden), false, `${forbidden} must not appear in the inspector validator`);
    }
  });
});
