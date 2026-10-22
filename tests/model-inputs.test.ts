import assert from "node:assert/strict";
import test from "node:test";
import { changeInput, inputOptions, isFluidUnit, optionLabel } from "../lib/input-options";
import { initialInputs, validateInputs } from "../lib/validation";
import type { Field, Manifest } from "../lib/types";

type ExtendedField = Field & {
  role?: string;
  dependsOn?: string;
  optionsByDependencyValue?: Record<string, string[]>;
  optionLabels?: Record<string, string>;
  radioGroup?: string;
};

const prefix = "state-rent@2.0.0-candidate.1:ui!";
const fieldId = (cell: string) => `${prefix}${cell.toLowerCase()}`;

function field(
  cell: string,
  label: string,
  type: string,
  defaultValue: string | number,
  extra: Partial<ExtendedField> = {},
): ExtendedField {
  return {
    id: fieldId(cell), cell, label, unit: "", group: "reservoir", type,
    default: defaultValue, required: true, blankOnNew: false, ...extra,
  };
}

function makeModelManifest(): Manifest {
  const primaryFluidId = fieldId("H9");
  const unitOptions = ["barrels(oil)", "tonnes(oil)", "scf(gas)", "m3(gas)"];
  const byFluid = {
    Oil: ["barrels(oil)", "tonnes(oil)"],
    NG: ["scf(gas)", "m3(gas)"],
  };
  const fields: ExtendedField[] = [
    field("H9", "Primary reservoir fluid", "select", "NG", {
      options: ["Oil", "NG"], role: "primaryFluid",
      optionLabels: { Oil: "Oil", NG: "Natural gas" },
    }),
    field("H10", "In-place volume unit", "select", "scf(gas)", {
      options: unitOptions, role: "inPlaceVolumeUnit", dependsOn: primaryFluidId,
      optionsByDependencyValue: byFluid,
      optionLabels: { "barrels(oil)": "Barrels (Oil)", "tonnes(oil)": "Tonnes (Oil)", "scf(gas)": "scf (Gas)", "m3(gas)": "m³ (Gas)" },
    }),
    field("H12", "Initial flow rate unit", "select", "scf(gas)", {
      options: unitOptions, role: "initialFlowRateUnit", dependsOn: primaryFluidId,
      optionsByDependencyValue: byFluid,
    }),
    field("O8", "Facilities completion year 1", "milestone", "X", {
      group: "schedule", required: false, blankOnNew: true, radioGroup: "facilities-completion-year",
    }),
    field("O9", "Facilities completion year 2", "milestone", "", {
      group: "schedule", required: false, blankOnNew: true, radioGroup: "facilities-completion-year",
    }),
    field("O10", "Facilities completion year 3", "milestone", "", {
      group: "schedule", required: false, blankOnNew: true, radioGroup: "facilities-completion-year",
    }),
    field("AC9", "Gas capacity tier 1", "number", 200, { group: "costs" }),
    field("AC10", "Gas capacity tier 2", "number", 400, { group: "costs" }),
    field("AC11", "Gas capacity tier 3", "number", 600, { group: "costs" }),
    field("AC18", "Oil capacity tier 1", "number", 100, { group: "costs" }),
    field("AC19", "Oil capacity tier 2", "number", 200, { group: "costs" }),
    field("AC20", "Oil capacity tier 3", "number", 300, { group: "costs" }),
    field("I20", "Optional note", "text", "", {
      required: false, blankOnNew: true,
    }),
  ];
  return {
    id: "state-rent",
    version: "2.0.0-candidate.1",
    name: "State Rent Economics",
    description: "Manifest metadata fixture.",
    releaseStatus: "review_required",
    groups: [],
    inputSheet: "UI",
    fields: fields as Field[],
    outputs: { views: [] },
    multipliers: [],
    runtimeSha256: "fixture",
    inputRules: {
      ascending: [
        {
          label: "Gas facility capacity tiers",
          fields: [fieldId("AC9"), fieldId("AC10"), fieldId("AC11")],
        },
        {
          label: "Oil facility capacity tiers",
          fields: [fieldId("AC18"), fieldId("AC19"), fieldId("AC20")],
        },
      ],
    },
  } as unknown as Manifest;
}

test("versioned fluid dependency filters exact workbook values and clears incompatible units", () => {
  const manifest = makeModelManifest();
  const baseline = initialInputs(manifest, "example");
  const volumeUnit = manifest.fields.find((item) => item.cell === "H10")!;
  const rateUnit = manifest.fields.find((item) => item.cell === "H12")!;
  assert.equal(isFluidUnit(manifest, rateUnit), true);
  assert.equal(isFluidUnit(manifest, { ...rateUnit, role: "initialRateUnit" }), true);
  assert.deepEqual(inputOptions(manifest, volumeUnit, baseline), ["scf(gas)", "m3(gas)"]);
  assert.equal(optionLabel("Oil"), "Oil");

  const oil = changeInput(manifest, baseline, fieldId("H9"), "Oil");
  assert.equal(oil[fieldId("H10")], null);
  assert.equal(oil[fieldId("H12")], null);
  assert.equal(baseline[fieldId("H10")], "scf(gas)");
  assert.deepEqual(inputOptions(manifest, volumeUnit, oil), ["barrels(oil)", "tonnes(oil)"]);
  assert.deepEqual(inputOptions(manifest, rateUnit, oil), ["barrels(oil)", "tonnes(oil)"]);

  const selectedOilUnits = {
    ...oil,
    [fieldId("H10")]: "barrels(oil)",
    [fieldId("H12")]: "tonnes(oil)",
  };
  const gas = changeInput(manifest, selectedOilUnits, fieldId("H9"), "NG");
  assert.equal(gas[fieldId("H10")], null);
  assert.equal(gas[fieldId("H12")], null);
});

test("selecting a milestone clears other years in its declared radio group", () => {
  const manifest = makeModelManifest();
  const baseline = initialInputs(manifest, "example");
  const selected = changeInput(manifest, baseline, fieldId("O9"), "X");
  assert.equal(selected[fieldId("O8")], "");
  assert.equal(selected[fieldId("O9")], "X");
  assert.equal(selected[fieldId("O10")], "");
  assert.equal(baseline[fieldId("O8")], "X");
  assert.equal(validateInputs(selected, manifest, true).some((error) => error.includes("Choose exactly one")), false);
});

test("completed inputs require strictly increasing capacity tiers", () => {
  const manifest = makeModelManifest();
  const baseline = initialInputs(manifest, "example");
  assert.deepEqual(validateInputs(baseline, manifest, true), []);

  const duplicateTier = {
    ...baseline,
    [fieldId("AC10")]: 200,
  };
  assert.ok(validateInputs(duplicateTier, manifest, true).some((error) => error.includes("Gas facility capacity tiers")));

  const descending = {
    ...baseline,
    [fieldId("AC10")]: 700,
  };
  assert.ok(validateInputs(descending, manifest, true).some((error) => error.includes("Gas facility capacity tiers")));
  assert.ok(validateInputs(descending, manifest, true).every((error) => !error.includes("Oil facility capacity tiers")));
});

test("incomplete forms and blank optional fields remain usable", () => {
  const manifest = makeModelManifest();
  const blank = initialInputs(manifest, "blank");
  assert.deepEqual(validateInputs(blank, manifest, false), []);

  const completeWithOptionalBlank = {
    ...initialInputs(manifest, "example"),
    [fieldId("I20")]: null,
  };
  assert.deepEqual(validateInputs(completeWithOptionalBlank, manifest, true), []);
});
