import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseCalculationInputs } from "../lib/calculation-diagnostics";
import type { Manifest } from "../lib/types";

const manifest = {
  groups: [{ id: "fiscal", name: "Economics & Fiscal Controls" }, { id: "schedule", name: "Development Schedule" }],
  fields: [
    { id: "gas", label: "Gas price multiplier", group: "fiscal", type: "number" },
    { id: "capex", label: "Capex multiplier", group: "fiscal", type: "number" },
    { id: "well5", label: "New wells", group: "schedule", type: "number", year: 5 },
    { id: "fluid", label: "Primary fluid", group: "fiscal", type: "select", optionLabels: { NG: "Natural gas" } },
    { id: "optional", label: "Optional value", group: "fiscal", type: "number" },
  ],
} as unknown as Manifest;
const working = { gas: 1, capex: 1, well5: 3, fluid: "NG", optional: null };

test("a single changed input names the exact field and both values", () => {
  const diagnosis = diagnoseCalculationInputs(manifest, working, { ...working, gas: 0 });
  assert.deepEqual(diagnosis.changes, [{ id: "gas", label: "Gas price multiplier", section: "Economics & Fiscal Controls", previous: "1", current: "0" }]);
  assert.deepEqual(diagnosis.workingInputs, working);
});

test("multiple changes remain separate candidates, with year-specific schedule labels", () => {
  const diagnosis = diagnoseCalculationInputs(manifest, working, { ...working, gas: 0, well5: 0 });
  assert.equal(diagnosis.changes.length, 2);
  assert.equal(diagnosis.changes[1].label, "New wells · Year 5");
  assert.equal(diagnosis.changes[1].section, "Development Schedule");
  assert.equal(diagnosis.changes[1].current, "0");
});

test("missing success evidence cannot produce an invented culprit or restore action", () => {
  assert.deepEqual(diagnoseCalculationInputs(manifest, null, { ...working, gas: 0 }), { changes: [], workingInputs: null });
  assert.deepEqual(diagnoseCalculationInputs(manifest, working, working).changes, []);
});

test("diagnostic restoration is a copy of the verified inputs and does not mutate drafts", () => {
  const failed = { ...working, capex: 10 };
  const diagnosis = diagnoseCalculationInputs(manifest, working, failed);
  diagnosis.workingInputs!.capex = 20;
  assert.equal(working.capex, 1);
  assert.equal(failed.capex, 10);
});

test("choice labels, explicit blanks and small numeric values remain understandable", () => {
  const diagnosis = diagnoseCalculationInputs(manifest, working, { ...working, fluid: "Oil", optional: 1e-12 });
  assert.equal(diagnosis.changes[0].previous, "Natural gas");
  assert.equal(diagnosis.changes[1].previous, "Not set");
  assert.equal(diagnosis.changes[1].current, "1e-12");
  const withoutOptional = { gas: 1, capex: 1, well5: 3, fluid: "NG" };
  assert.deepEqual(diagnoseCalculationInputs(manifest, working, withoutOptional).changes, []);
  assert.deepEqual(diagnoseCalculationInputs(manifest, working, { ...working, optional: "" }).changes, []);
});

test("only mapped inputs can be presented as changed fields", () => {
  const diagnosis = diagnoseCalculationInputs(manifest, working, { ...working, unknown: "private" });
  assert.deepEqual(diagnosis.changes, []);
  assert.equal(JSON.stringify(diagnosis).includes("private"), false);
});
