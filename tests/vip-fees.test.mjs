/**
 * The public VIP fee catalog.
 *
 * `GET /v1/vip/tiers` is a public operation — no key, no session, no wallet —
 * and it is the only authoritative statement of what a trade costs on the
 * exchange. These tests pin three things that are easy to get quietly wrong:
 *
 *   1. rejection is by `code`, not by message text;
 *   2. VIP0's missing portfolio-value threshold stays `null`, never `0`;
 *   3. `0.005` stays `0.005` — rounding it to two decimals would invent a 100%
 *      overcharge on the best tier in the catalog.
 */

import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

/**
 * The response as the exchange serves it right now (fetched from
 * `GET https://api.testnet.polyester.com/v1/vip/tiers`). ProtoJSON omits
 * default values, so VIP0 arrives with neither `tier` nor `aopThresholdUsd` —
 * that absence is part of the fixture, because it is the part a hand-written
 * mock would have got wrong.
 */
const d18 = (value) => `${value}.000000000000000000`;

const LIVE_SCHEDULE = {
  effectiveFrom: "2026-08-11T00:00:00Z",
  policyVersion: "1",
  retentionThresholdBp: 9500,
  tiers: [
    {
      makerFeeRatePercent: "0.100000000",
      takerFeeRatePercent: "0.150000000",
      volumeThresholdUsd: d18("0"),
    },
    {
      aopThresholdUsd: d18("50000"),
      makerFeeRatePercent: "0.080000000",
      takerFeeRatePercent: "0.135000000",
      tier: 1,
      volumeThresholdUsd: d18("100000"),
    },
    {
      aopThresholdUsd: d18("100000"),
      makerFeeRatePercent: "0.065000000",
      takerFeeRatePercent: "0.120000000",
      tier: 2,
      volumeThresholdUsd: d18("500000"),
    },
    {
      aopThresholdUsd: d18("250000"),
      makerFeeRatePercent: "0.050000000",
      takerFeeRatePercent: "0.105000000",
      tier: 3,
      volumeThresholdUsd: d18("1000000"),
    },
    {
      aopThresholdUsd: d18("500000"),
      makerFeeRatePercent: "0.040000000",
      takerFeeRatePercent: "0.090000000",
      tier: 4,
      volumeThresholdUsd: d18("5000000"),
    },
    {
      aopThresholdUsd: d18("1000000"),
      makerFeeRatePercent: "0.030000000",
      takerFeeRatePercent: "0.080000000",
      tier: 5,
      volumeThresholdUsd: d18("10000000"),
    },
    {
      aopThresholdUsd: d18("2500000"),
      makerFeeRatePercent: "0.020000000",
      takerFeeRatePercent: "0.070000000",
      tier: 6,
      volumeThresholdUsd: d18("25000000"),
    },
    {
      aopThresholdUsd: d18("5000000"),
      makerFeeRatePercent: "0.015000000",
      takerFeeRatePercent: "0.060000000",
      tier: 7,
      volumeThresholdUsd: d18("50000000"),
    },
    {
      aopThresholdUsd: d18("10000000"),
      makerFeeRatePercent: "0.012500000",
      takerFeeRatePercent: "0.055000000",
      tier: 8,
      volumeThresholdUsd: d18("100000000"),
    },
    {
      aopThresholdUsd: d18("25000000"),
      makerFeeRatePercent: "0.010000000",
      takerFeeRatePercent: "0.050000000",
      tier: 9,
      volumeThresholdUsd: d18("250000000"),
    },
    {
      aopThresholdUsd: d18("100000000"),
      makerFeeRatePercent: "0.005000000",
      takerFeeRatePercent: "0.045000000",
      tier: 10,
      volumeThresholdUsd: d18("500000000"),
    },
  ],
};

let core;
let handler;
let vite;

before(async () => {
  const { createServer } = await import("vite");
  vite = await createServer({
    configFile: false,
    server: { middlewareMode: true },
    appType: "custom",
    logLevel: "error",
  });
  core = await vite.ssrLoadModule("/packages/core/src/index.ts");
  handler = await vite.ssrLoadModule("/backend/src/handler.ts");
});

after(async () => {
  // Without this the run hangs for minutes on Vite's open watchers.
  await vite?.close();
});

function rejectsWith(fn, code) {
  assert.throws(fn, (error) => {
    assert.equal(error?.code, code);
    return true;
  });
}

describe("parseVipFeeSchedule", () => {
  it("accepts the shape the exchange actually serves", () => {
    const parsed = core.parseVipFeeSchedule(LIVE_SCHEDULE);
    assert.equal(parsed.policyVersion, "1");
    assert.equal(parsed.retentionThresholdBp, 9500);
    assert.equal(parsed.tiers.length, 11);
    // VIP0 arrives without a `tier` key; position pins it, not the payload.
    assert.equal(parsed.tiers[0].tier, 0);
    assert.equal(parsed.tiers[0].aopThresholdUsd, null);
    assert.equal(parsed.tiers[10].tier, 10);
  });

  it("does not mistake an omitted VIP0 tier for a malformed row", () => {
    // This is the bug a hand-written fixture hides: strictness here would have
    // rejected the real response and blanked the page.
    assert.equal("tier" in LIVE_SCHEDULE.tiers[0], false);
    assert.equal(core.parseVipFeeSchedule(LIVE_SCHEDULE).tiers[0].tier, 0);
  });

  it("keeps a missing portfolio threshold as null rather than zero", () => {
    const parsed = core.parseVipFeeSchedule({ ...LIVE_SCHEDULE, tiers: [LIVE_SCHEDULE.tiers[0]] });
    assert.equal(parsed.tiers[0].aopThresholdUsd, null);
    assert.notEqual(parsed.tiers[0].aopThresholdUsd, "0");
  });

  it("rejects a non-object body", () => {
    rejectsWith(() => core.parseVipFeeSchedule(null), "not_an_object");
    rejectsWith(() => core.parseVipFeeSchedule("{}"), "not_an_object");
    rejectsWith(() => core.parseVipFeeSchedule([]), "not_an_object");
  });

  it("rejects an unusable policy version", () => {
    rejectsWith(
      () => core.parseVipFeeSchedule({ ...LIVE_SCHEDULE, policyVersion: undefined }),
      "invalid_policy_version",
    );
    rejectsWith(
      () => core.parseVipFeeSchedule({ ...LIVE_SCHEDULE, policyVersion: "0" }),
      "invalid_policy_version",
    );
  });

  it("rejects an unparseable effective date", () => {
    rejectsWith(
      () => core.parseVipFeeSchedule({ ...LIVE_SCHEDULE, effectiveFrom: "not-a-date" }),
      "invalid_effective_from",
    );
  });

  it("rejects a retention threshold outside 1..10000 bp", () => {
    rejectsWith(
      () => core.parseVipFeeSchedule({ ...LIVE_SCHEDULE, retentionThresholdBp: 0 }),
      "invalid_retention_threshold",
    );
    rejectsWith(
      () => core.parseVipFeeSchedule({ ...LIVE_SCHEDULE, retentionThresholdBp: 10_001 }),
      "invalid_retention_threshold",
    );
  });

  it("rejects an empty catalog", () => {
    rejectsWith(
      () => core.parseVipFeeSchedule({ ...LIVE_SCHEDULE, tiers: [] }),
      "invalid_tiers",
    );
  });

  it("rejects rows that are not contiguous from tier 0", () => {
    // Dropping VIP0 must not silently renumber the rest.
    rejectsWith(
      () => core.parseVipFeeSchedule({ ...LIVE_SCHEDULE, tiers: [LIVE_SCHEDULE.tiers[1]] }),
      "invalid_tier_row",
    );
  });

  it("rejects a negative taker rate but allows a negative maker rebate", () => {
    const base = { ...LIVE_SCHEDULE.tiers[0] };
    const rebate = { ...base, makerFeeRatePercent: "-0.001" };
    assert.equal(
      core.parseVipFeeSchedule({ ...LIVE_SCHEDULE, tiers: [rebate] }).tiers[0]
        .makerFeeRatePercent,
      "-0.001",
    );
    rejectsWith(
      () =>
        core.parseVipFeeSchedule({
          ...LIVE_SCHEDULE,
          tiers: [{ ...base, takerFeeRatePercent: "-0.15" }],
        }),
      "invalid_tier_row",
    );
  });

  it("rejects a non-string rate rather than coercing a number", () => {
    rejectsWith(
      () =>
        core.parseVipFeeSchedule({
          ...LIVE_SCHEDULE,
          tiers: [{ ...LIVE_SCHEDULE.tiers[0], takerFeeRatePercent: 0.15 }],
        }),
      "invalid_tier_row",
    );
  });
});

describe("formatting", () => {
  it("keeps three decimals when the rate needs them", () => {
    assert.equal(core.formatPercent("0.150000000"), "0.15%");
    assert.equal(core.formatPercent("0.005000000"), "0.005%");
    assert.equal(core.formatPercent("0.100000000"), "0.1%");
  });

  it("does not turn the best tier into the worst one", () => {
    // Two-decimal rounding would render VIP10's 0.005% maker rate as 0.01%.
    assert.notEqual(core.formatPercent("0.005000000"), core.formatPercent("0.010000000"));
  });

  it("renders thresholds without trailing zeros", () => {
    assert.equal(core.formatUsdThreshold("100000.000000000000000000"), "$100,000");
    assert.equal(core.formatUsdThreshold("500000000.000000000000000000"), "$500,000,000");
    assert.equal(core.formatUsdThreshold("250000.000000000000000000"), "$250,000");
    assert.equal(core.formatUsdThreshold("0.000000000000000000"), "$0");
    assert.equal(core.formatUsdThreshold(null), null);
  });
});

describe("GET /api/fees/tiers", () => {
  const fakeFetch = (body, status = 200) => async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });

  it("serves the catalog through our own origin", async () => {
    const response = await handler.api(
      new Request("https://example.com/api/fees/tiers"),
      { fetch: fakeFetch(LIVE_SCHEDULE) },
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "public, max-age=300");
    const body = await response.json();
    assert.equal(body.policyVersion, "1");
    assert.equal(body.tiers.length, 11);
    assert.equal(body.tiers[10].takerFeeRatePercent, "0.045000000");
  });

  it("reports an unreachable exchange as a typed failure", async () => {
    const response = await handler.api(new Request("https://example.com/api/fees/tiers"), {
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, "tiers_unreachable");
  });

  it("reports an upstream error status as a typed failure", async () => {
    const response = await handler.api(
      new Request("https://example.com/api/fees/tiers"),
      { fetch: fakeFetch({ message: "nope" }, 500) },
    );
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, "tiers_error");
  });

  it("rejects a 200 that does not satisfy the contract", async () => {
    const response = await handler.api(
      new Request("https://example.com/api/fees/tiers"),
      { fetch: fakeFetch({ tiers: "not-an-array" }) },
    );
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, "tiers_invalid_response");
  });
});
