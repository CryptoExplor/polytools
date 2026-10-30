/**
 * Production browser/API response hardening shared by every deployment target.
 *
 * This policy is intentionally limited to resources used by the SPA. It does
 * not add HSTS, cross-origin isolation, request authentication, or rate-limit
 * claims. Development HTML is left without this CSP so Vite refresh/HMR keeps
 * its required inline preamble and WebSocket connection.
 */

const PRODUCTION_CSP_DIRECTIVES = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
  "form-action 'self'",
  "script-src 'self'",
  // React uses inline style attributes; production scripts remain external.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://assets.polyester.com",
  "media-src 'self' https://assets.polyester.com",
  // Public API facade, CoinGecko comparison, and direct signed account GETs.
  // The on-chain balance lookup is proxied through our own /api, so no third-party
  // explorer origin is reachable from the browser.
  "connect-src 'self' https://api.coingecko.com https://api.testnet.polyester.com https://*.workers.dev",
  "font-src 'self'",
  "manifest-src 'self'",
] as const;

export const PRODUCTION_CONTENT_SECURITY_POLICY =
  PRODUCTION_CSP_DIRECTIVES.join("; ");

/**
 * CSP meta supports most directives here, but frame-ancestors is ignored in
 * meta and must come from a real HTTP header. This is only a static fallback,
 * not equivalent header enforcement on GitHub Pages or similar hosts.
 */
export const META_CONTENT_SECURITY_POLICY = PRODUCTION_CSP_DIRECTIVES
  .filter((directive) => !directive.startsWith("frame-ancestors "))
  .join("; ");

export const REFERRER_POLICY = "strict-origin-when-cross-origin";

// Clipboard write is used by explicit copy buttons. WebCrypto is not a
// Permissions-Policy feature and remains available in a secure context.
export const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "bluetooth=()",
  "camera=()",
  "clipboard-read=()",
  "clipboard-write=(self)",
  "display-capture=()",
  "fullscreen=(self)",
  "geolocation=()",
  "gyroscope=()",
  "hid=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "picture-in-picture=(self)",
  "serial=()",
  "usb=()",
].join(", ");

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": PRODUCTION_CONTENT_SECURITY_POLICY,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": REFERRER_POLICY,
  "Permissions-Policy": PERMISSIONS_POLICY,
  // Legacy fallback only; frame-ancestors above is the modern control.
  "X-Frame-Options": "DENY",
};

export function applySecurityHeaders(headers: Headers): Headers {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    headers.set(name, value);
  }
  return headers;
}

/** Clone a platform/asset response while preserving its status and headers. */
export function withSecurityHeaders(response: Response): Response {
  const headers = applySecurityHeaders(new Headers(response.headers));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
