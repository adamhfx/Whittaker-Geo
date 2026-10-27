import assert from "node:assert/strict";
import test from "node:test";
import { planModelUpgrade, updatedCalculationName } from "../lib/model-updates";
import type { Field, InputValues, Manifest } from "../lib/types";

function field(
  id: string,
  label: string,
  overrides: Partial<Field> = {},
): Field {
  return {
    id,
    cell: "A1",
    label,
    unit: "unit",
    group: "reservoir",
    type: "number",
    default: null,
    required: false,
    blankOnNew: false,
    ...overrides,
  };
}

function manifest(
  version: string,
  fields: Field[],
  overrides: Partial<Manifest> = {},
): Manifest {
  return {
    id: "state-rent",
    version,
    name: "State Rent",
    description: "Test model",
    groups: [{ id: "reservoir", name: "Reservoir" }],
    fields,
    releaseStatus: "approved",
    outputs: [],
    multipliers: [],
    runtimeSha256: "test",
    ...overrides,
  };
}

test("matches semantic fields across version prefixes and changed cells, preserving 0, blank, and changed defaults", () => {
  const source = manifest("2.0.0", [
    field("state-rent@2.0.0:ui!a1", "Discount rate", {
      unit: "%",
      role: "discountRate",
      default: 19,
      min: 0,
      max: 100,
    }),
    field("state-rent@2.0.0:ui!a2", "Royalty rate", {
      unit: "%",
      role: "royaltyRate",
      default: 0,
      min: 0,
      max: 100,
    }),
    field("state-rent@2.0.0:ui!a3", "Optional label", {
      type: "text",
      default: "legacy",
      blankOnNew: true,
    }),
    field("state-rent@2.0.0:ui!a4", "Optional adjustment", {
      default: 2,
      blankOnNew: true,
      year: 1,
    }),
  ]);
  const target = manifest("2.1.0", [
    field("state-rent@2.1.0:ui!g18", "Discount rate", {
      unit: "%",
      role: "discountRate",
      default: 15,
      min: 0,
      max: 100,
    }),
    field("state-rent@2.1.0:ui!g19", "Royalty rate", {
      unit: "%",
      role: "royaltyRate",
      default: 5,
      min: 0,
      max: 100,
    }),
    field("state-rent@2.1.0:ui!g20", "Optional label", {
      type: "text",
      default: "new",
      blankOnNew: true,
    }),
    field("state-rent@2.1.0:ui!g21", "Optional adjustment", {
      default: 8,
      blankOnNew: true,
      year: 1,
    }),
  ]);
  const saved: InputValues = {
    "state-rent@2.0.0:ui!a1": 19,
    "state-rent@2.0.0:ui!a2": 0,
    "state-rent@2.0.0:ui!a3": "",
    "state-rent@2.0.0:ui!a4": null,
  };

  const plan = planModelUpgrade(source, target, saved);
  assert.deepEqual(plan.inputs, {
    "state-rent@2.1.0:ui!g18": 19,
    "state-rent@2.1.0:ui!g19": 0,
    "state-rent@2.1.0:ui!g20": "",
    "state-rent@2.1.0:ui!g21": null,
  });
  assert.equal(plan.copiedCount, 4);
  assert.equal(plan.removedCount, 0);
  assert.deepEqual(plan.reviewFields, []);
  assert.deepEqual(plan.defaultChanges, [
    {
      id: "state-rent@2.1.0:ui!g18",
      label: "Discount rate",
      current: 19,
      newDefault: 15,
    },
    {
      id: "state-rent@2.1.0:ui!g19",
      label: "Royalty rate",
      current: 0,
      newDefault: 5,
    },
    {
      id: "state-rent@2.1.0:ui!g20",
      label: "Optional label",
      current: "",
      newDefault: "new",
    },
    {
      id: "state-rent@2.1.0:ui!g21",
      label: "Optional adjustment",
      current: null,
      newDefault: 8,
    },
  ]);
});

test("does not map by position or unit and leaves new fields at their blank-mode values", () => {
  const source = manifest("2.0.0", [
    field("state-rent@2.0.0:ui!a1", "Oil rate", { unit: "m³", default: 17 }),
    field("state-rent@2.0.0:ui!a2", "Removed field", { year: 2 }),
  ]);
  const target = manifest(
    "2.1.0",
    [
      field("state-rent@2.1.0:ui!g18", "Gas rate", {
        unit: "m³",
        default: 4,
        blankOnNew: true,
        group: "economics",
      }),
      field("state-rent@2.1.0:ui!a1", "Oil rate", {
        unit: "bbl",
        default: 6,
        blankOnNew: true,
      }),
      field("state-rent@2.1.0:ui!g20", "New schedule amount", {
        group: "schedule",
        year: 1,
        default: 9,
        blankOnNew: true,
      }),
    ],
    {
      groups: [
        { id: "economics", name: "Economics" },
        { id: "reservoir", name: "Reservoir" },
        { id: "schedule", name: "Schedule" },
      ],
    },
  );

  const plan = planModelUpgrade(source, target, {
    "state-rent@2.0.0:ui!a1": 17,
    "state-rent@2.0.0:ui!a2": 9,
  });
  assert.deepEqual(plan.inputs, {
    "state-rent@2.1.0:ui!g18": null,
    "state-rent@2.1.0:ui!a1": null,
    "state-rent@2.1.0:ui!g20": 0,
  });
  assert.equal(plan.copiedCount, 0);
  assert.equal(plan.removedCount, 2);
  assert.deepEqual(
    plan.reviewFields.map(({ id }) => id),
    [
      "state-rent@2.1.0:ui!g18",
      "state-rent@2.1.0:ui!a1",
      "state-rent@2.1.0:ui!g20",
    ],
  );
});

test("ambiguous semantic matches are only disambiguated by a same normalized id", () => {
  const source = manifest("2.0.0", [
    field("state-rent@2.0.0:ui!a1", "Plant rate", { year: 1 }),
    field("state-rent@2.0.0:ui!a2", "Plant rate", { year: 1 }),
  ]);
  const target = manifest("2.1.0", [
    field("state-rent@2.1.0:ui!a1", "Plant rate", { year: 1 }),
    field("state-rent@2.1.0:ui!b2", "Plant rate", { year: 1 }),
  ]);
  const plan = planModelUpgrade(source, target, {
    "state-rent@2.0.0:ui!a1": 11,
    "state-rent@2.0.0:ui!a2": 22,
  });
  assert.equal(plan.inputs["state-rent@2.1.0:ui!a1"], 11);
  assert.equal(plan.inputs["state-rent@2.1.0:ui!b2"], null);
  assert.equal(plan.copiedCount, 1);
  assert.equal(plan.removedCount, 0);
  assert.equal(plan.reviewFields.length, 1);
});

test("rejects saved numbers and choices outside the target model, and reports them for review", () => {
  const source = manifest("2.0.0", [
    field("state-rent@2.0.0:ui!a1", "New limit", { max: 100 }),
    field("state-rent@2.0.0:ui!a2", "Contract type", {
      type: "select",
      options: ["old"],
      default: "old",
    }),
  ]);
  const target = manifest("2.1.0", [
    field("state-rent@2.1.0:ui!b1", "New limit", { max: 10, default: 3 }),
    field("state-rent@2.1.0:ui!b2", "Contract type", {
      type: "select",
      options: ["new"],
      default: "new",
    }),
  ]);
  const plan = planModelUpgrade(source, target, {
    "state-rent@2.0.0:ui!a1": 40,
    "state-rent@2.0.0:ui!a2": "old",
  });
  assert.deepEqual(plan.inputs, {
    "state-rent@2.1.0:ui!b1": 3,
    "state-rent@2.1.0:ui!b2": "new",
  });
  assert.equal(plan.copiedCount, 0);
  assert.equal(plan.reviewFields.length, 2);
});

test("checks dependent options against the fully migrated inputs", () => {
  const source = manifest("2.0.0", [
    field("state-rent@2.0.0:ui!a1", "Primary fluid", {
      type: "select",
      role: "primaryFluid",
      unit: "",
      options: ["oil", "NG"],
      default: "NG",
    }),
    field("state-rent@2.0.0:ui!a2", "Volume unit", {
      type: "select",
      role: "inPlaceVolumeUnit",
      unit: "volume",
      dependsOn: "state-rent@2.0.0:ui!a1",
      options: ["m3(gas)", "barrels(oil)"],
      optionsByDependencyValue: { NG: ["m3(gas)"], oil: ["m3(gas)"] },
      default: "m3(gas)",
    }),
  ]);
  const target = manifest("2.1.0", [
    field("state-rent@2.1.0:ui!g1", "Primary fluid", {
      type: "select",
      role: "primaryFluid",
      unit: "",
      options: ["oil", "NG"],
      default: "NG",
    }),
    field("state-rent@2.1.0:ui!g2", "Volume unit", {
      type: "select",
      role: "inPlaceVolumeUnit",
      unit: "volume",
      blankOnNew: true,
      dependsOn: "state-rent@2.1.0:ui!g1",
      options: ["m3(gas)", "barrels(oil)"],
      optionsByDependencyValue: { NG: ["barrels(oil)"], oil: ["barrels(oil)"] },
      default: "m3(gas)",
    }),
  ]);
  const plan = planModelUpgrade(source, target, {
    "state-rent@2.0.0:ui!a1": "NG",
    "state-rent@2.0.0:ui!a2": "m3(gas)",
  });
  assert.deepEqual(plan.inputs, {
    "state-rent@2.1.0:ui!g1": "NG",
    "state-rent@2.1.0:ui!g2": null,
  });
  assert.equal(plan.copiedCount, 1);
  assert.deepEqual(
    plan.reviewFields.map(({ id }) => id),
    ["state-rent@2.1.0:ui!g2"],
  );
});

test("requires the same calculator and a different version", () => {
  const source = manifest("2.0.0", []);
  assert.throws(
    () => planModelUpgrade(source, manifest("2.0.0", []), {}),
    /different calculator version/,
  );
  assert.throws(
    () => planModelUpgrade(source, manifest("2.1.0", [], { id: "other" }), {}),
    /same calculator/,
  );
});

test("names updated copies clearly and stays within the database limit", () => {
  assert.equal(
    updatedCalculationName("Legacy project", "2.1.0"),
    "Legacy project (updated to 2.1.0)",
  );
  assert.equal(
    updatedCalculationName("Legacy project (updated to 2.1.0)", "2.1.0"),
    "Legacy project (updated to 2.1.0)",
  );
  assert.equal(updatedCalculationName("x".repeat(120), "2.1.0").length, 120);
  assert.ok(updatedCalculationName("", "v".repeat(100)).length <= 120);
});
