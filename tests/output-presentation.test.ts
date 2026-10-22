import assert from "node:assert/strict";
import test from "node:test";
import { parseLiveResult } from "../lib/evaluation";
import { isLiveCalculationResult } from "../lib/live-calculation";
import type { Manifest } from "../lib/types";

const manifest = {
  id: "state-rent",
  version: "2.0.0-candidate.1",
  name: "State Rent",
  description: "Fixture",
  groups: [],
  fields: [],
  outputs: { views: [{ id: "executive-dashboard", label: "Dashboard", sheet: "Dashboard OUTPUT", sourceRange: "C4:AH44" }] },
  multipliers: [],
  runtimeSha256: "private",
  releaseStatus: "review_required",
} as unknown as Manifest;

function result(overrides: Record<string, unknown> = {}) {
  return {
    calculatorId: manifest.id,
    calculatorVersion: manifest.version,
    durationSeconds: 0.4,
    outputSheets: [{ name: "Dashboard OUTPUT", rows: [] }],
    summary: [
      { section: "Investor", label: "IRR: Ratio", value: 0.184, unit: "Ratio", format: "0.000" },
    ],
    charts: [
      {
        title: "Production (MM boe)",
        kind: "column",
        categories: [1, 2, 3],
        series: [{ name: "Oil / Liquids", values: [1.2, null, 2.5] }],
      },
    ],
    ...overrides,
  };
}

test("evaluation schema accepts bounded presentation values and strips source references", () => {
  const parsed = parseLiveResult(
    result({
      summary: [{ ...result().summary[0], sourceCell: "D35", formula: "SECRET" }],
      charts: [{
        ...result().charts[0],
        sourceRange: "MODEL!AI7:AI36",
        series: [{ name: "Gas", values: [1, 2, 3], sourceRange: "MODEL!AI7:AI36" }],
      }],
    }),
    manifest,
  );

  assert.equal(parsed.summary?.[0].label, "IRR: Ratio");
  assert.deepEqual(parsed.charts?.[0].categories, [1, 2, 3]);
  assert.equal(JSON.stringify(parsed).includes("SECRET"), false);
  assert.equal(JSON.stringify(parsed).includes("sourceRange"), false);
  assert.equal(JSON.stringify(parsed).includes("sourceCell"), false);
});

test("evaluation schema rejects non-finite and oversized presentation data", () => {
  assert.throws(() => parseLiveResult(result({
    summary: [{ label: "Bad", value: Number.POSITIVE_INFINITY }],
  }), manifest));
  assert.throws(() => parseLiveResult(result({
    charts: [{ ...result().charts[0], series: [{ name: "Bad", values: [1, Number.NaN, 3] }] }],
  }), manifest));
  assert.throws(() => parseLiveResult(result({
    charts: [{ ...result().charts[0], series: [{ name: "Short", values: [1, 2] }] }],
  }), manifest));
  assert.throws(() => parseLiveResult(result({
    charts: [{ ...result().charts[0], categories: Array.from({ length: 101 }, (_, index) => index), series: [{ name: "Long", values: Array(101).fill(1) }] }],
  }), manifest));
});

test("browser live-result parser accepts presentation data but rejects unsafe chart points", () => {
  const valid = result();
  assert.equal(isLiveCalculationResult(valid), true);
  assert.equal(isLiveCalculationResult({
    ...valid,
    charts: [{ ...valid.charts[0], series: [{ name: "Bad", values: [1, Number.POSITIVE_INFINITY, 3] }] }],
  }), false);
  assert.equal(isLiveCalculationResult({
    ...valid,
    summary: Array.from({ length: 31 }, (_, index) => ({ label: `KPI ${index}`, value: index })),
  }), false);
});
