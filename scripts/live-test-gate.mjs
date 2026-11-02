// Opt-in gate for scripts/live-test.mjs, kept separate so it can be unit-tested
// without ever reading .env or touching the network.
//
// POLYAP_LIVE_TEST is the current name. POLYTOOLS_LIVE_TEST is the legacy name
// from before the rename to Polyap and is still honoured as a fallback.

export const LIVE_TEST_ENV = "POLYAP_LIVE_TEST";
export const LEGACY_LIVE_TEST_ENV = "POLYTOOLS_LIVE_TEST";

/** True when running under CI, where live verification is never allowed. */
export function isCiEnvironment(env = process.env) {
  return /^(?:1|true)$/i.test(env.CI ?? "") || /^(?:1|true)$/i.test(env.GITHUB_ACTIONS ?? "");
}

/**
 * The opt-in value: POLYAP_LIVE_TEST when set to a non-blank value, otherwise
 * the legacy POLYTOOLS_LIVE_TEST. Blank counts as unset.
 */
export function liveTestOptInValue(env = process.env) {
  const current = (env[LIVE_TEST_ENV] ?? "").trim();
  if (current) return current;
  return (env[LEGACY_LIVE_TEST_ENV] ?? "").trim();
}

/** Whether the owner explicitly opted in to live verification outside CI. */
export function liveTestAllowed(env = process.env) {
  return !isCiEnvironment(env) && liveTestOptInValue(env) === "1";
}
