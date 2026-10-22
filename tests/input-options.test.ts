import assert from "node:assert/strict";
import test from "node:test";
import { changeInput, inputOptions, optionLabel } from "../lib/input-options";
import { initialInputs, validateInputs } from "../lib/validation";
import type { Manifest } from "../lib/types";

const legacyManifest: Manifest = {
  id: "state-rent",
  version: "1.0.0-candidate.1",
  name: "Legacy state rent",
  description: "Legacy cell-address behavior fixture.",
  releaseStatus: "review_required",
  groups: [],
  fields: [
    {
      id: "C5", cell: "C5", label: "Primary fluid", unit: "", group: "reservoir",
      type: "select", default: "NG", required: true, blankOnNew: true, options: ["NG", "oil"],
    },
    {
      id: "C6", cell: "C6", label: "Volume unit", unit: "", group: "reservoir",
      type: "select", default: "scf(gas)", required: true, blankOnNew: true,
      options: ["barrels(oil)", "tonnes(oil)", "scf(gas)", "m3(gas)"],
    },
    {
      id: "C7", cell: "C7", label: "Rate unit", unit: "", group: "reservoir",
      type: "select", default: "scf(gas)", required: true, blankOnNew: true,
      options: ["barrels(oil)", "tonnes(oil)", "scf(gas)", "m3(gas)"],
    },
  ],
  outputs: [],
  multipliers: [],
  runtimeSha256: "",
};

test("legacy C5 controls C6/C7 without changing the stored workbook values", () => {
  const baseline = initialInputs(legacyManifest, "example");
  const volumeUnit = legacyManifest.fields.find((field) => field.id === "C6")!;
  assert.deepEqual(inputOptions(legacyManifest, volumeUnit, baseline), ["scf(gas)", "m3(gas)"]);

  const oil = changeInput(legacyManifest, baseline, "C5", "oil");
  assert.equal(oil.C6, null);
  assert.equal(oil.C7, null);
  assert.equal(baseline.C6, "scf(gas)");
  assert.deepEqual(inputOptions(legacyManifest, volumeUnit, oil), ["barrels(oil)", "tonnes(oil)"]);
  assert.ok(validateInputs({ ...baseline, C5: "oil" }, legacyManifest, true).some((error) => error.includes("must match")));
  assert.deepEqual(inputOptions(legacyManifest, volumeUnit, { ...baseline, C5: null }), []);
  assert.deepEqual(inputOptions({ ...legacyManifest, id: "another-calculator" }, volumeUnit, oil), volumeUnit.options);
});

test("option labels do not replace exact workbook option values", () => {
  assert.equal(optionLabel("oil"), "Oil");
  assert.equal(optionLabel("Oil"), "Oil");
  assert.equal(optionLabel("NG"), "Natural gas");
  assert.equal(optionLabel("CTR"), "CTR");
  assert.equal(optionLabel("m3(gas)"), "m³ (Gas)");
});
