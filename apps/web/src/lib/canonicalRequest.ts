/**
 * Validation for the Ed25519 canonical-string inspector on the SDK page.
 *
 * The inspector shows exactly what gets signed, so a malformed field there
 * teaches a signing rule that does not exist. This module rejects the inputs a
 * reader is most likely to mistype and explains the rule that applies; it never
 * rewrites the value, because the point of the panel is to show what you typed.
 *
 * Scope: display validation only. Nothing here signs, sends, or stores anything.
 */

export type CanonicalField = "timestamp" | "path" | "query" | "body";

export interface CanonicalIssue {
  field: CanonicalField;
  message: string;
}

export interface CanonicalValidation {
  ok: boolean;
  issues: CanonicalIssue[];
}

const PATH_PATTERN = /^\/[A-Za-z0-9\-._~!$&'()*+,;=:@/%]*$/;
const TIMESTAMP_PATTERN = /^\d{1,16}$/;

/** A query string is `key=value` pairs separated by `&`, or empty. */
export function queryIssues(query: string): CanonicalIssue[] {
  const trimmed = query.trim().replace(/^\?/, "");
  if (!trimmed) return [];
  const issues: CanonicalIssue[] = [];
  const pairs = trimmed.split("&");
  pairs.forEach((pair, index) => {
    if (!pair) {
      issues.push({ field: "query", message: `Query pair ${index + 1} is empty (double '&').` });
      return;
    }
    const separator = pair.indexOf("=");
    if (separator < 0) {
      issues.push({
        field: "query",
        message: `Query pair "${pair}" has no value. Write it as key=value, or key= for an empty value.`,
      });
      return;
    }
    const key = pair.slice(0, separator);
    if (!key) {
      issues.push({ field: "query", message: `Query pair ${index + 1} has an empty key.` });
    }
    if (/\s/.test(pair)) {
      issues.push({
        field: "query",
        message: `Pair "${pair}" contains a raw space. Encode it as + or %20 before signing.`,
      });
    }
  });
  return issues;
}

export function pathIssues(path: string): CanonicalIssue[] {
  const trimmed = path.trim();
  if (!trimmed) {
    return [{ field: "path", message: "Enter a request path, for example /v1/orders." }];
  }
  if (!trimmed.startsWith("/")) {
    return [{ field: "path", message: "The path must start with '/'." }];
  }
  if (trimmed.includes("?")) {
    return [
      {
        field: "path",
        message: "The path must not contain the query string; put it in the query field instead.",
      },
    ];
  }
  if (!PATH_PATTERN.test(trimmed)) {
    return [
      {
        field: "path",
        message: "The path contains characters that are not allowed unencoded in a request line.",
      },
    ];
  }
  return [];
}

export function timestampIssues(timestamp: string): CanonicalIssue[] {
  const trimmed = timestamp.trim();
  if (!trimmed) {
    return [{ field: "timestamp", message: "Enter the X-API-TIMESTAMP value in milliseconds." }];
  }
  if (!TIMESTAMP_PATTERN.test(trimmed)) {
    return [
      {
        field: "timestamp",
        message: "The timestamp must be whole milliseconds since the Unix epoch (digits only).",
      },
    ];
  }
  // A value in seconds is the common mistake: 10 digits is January 1970-2001 in ms.
  if (trimmed.length === 10) {
    return [
      {
        field: "timestamp",
        message:
          "Ten digits is a seconds timestamp. Polyester signs milliseconds, so multiply by 1000.",
      },
    ];
  }
  return [];
}

export function bodyIssues(body: string, method: string): CanonicalIssue[] {
  if (method === "GET") {
    return body.trim()
      ? [{ field: "body", message: "GET requests are signed with an empty body hash." }]
      : [];
  }
  const trimmed = body.trim();
  if (!trimmed) {
    return [{ field: "body", message: `A ${method} request needs a body to hash.` }];
  }
  try {
    JSON.parse(trimmed);
  } catch {
    return [
      {
        field: "body",
        message: "The body is not valid JSON. The signature covers the exact bytes you send.",
      },
    ];
  }
  return [];
}

export function validateCanonicalRequest(input: {
  timestamp: string;
  path: string;
  query: string;
  body: string;
  method: string;
}): CanonicalValidation {
  const issues = [
    ...timestampIssues(input.timestamp),
    ...pathIssues(input.path),
    ...queryIssues(input.query),
    ...bodyIssues(input.body, input.method),
  ];
  // One message per field keeps the notice actionable.
  const seen = new Set<CanonicalField>();
  const deduped = issues.filter((issue) => {
    if (seen.has(issue.field)) return false;
    seen.add(issue.field);
    return true;
  });
  return { ok: deduped.length === 0, issues: deduped };
}
