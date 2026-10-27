import assert from "node:assert/strict";
import test from "node:test";
import {
  clearCanceledCalculationAttempt,
  selectLiveCalculationState,
  type LastSuccessfulCalculation,
} from "../app/useLiveCalculation";
import type { LiveCalculationResult } from "../lib/live-calculation";

const result: LiveCalculationResult = {
  calculatorId: "state-rent",
  calculatorVersion: "1.0.0",
  durationSeconds: 0.2,
  outputSheets: [
    {
      name: "OUTPUT",
      rows: [{ cells: [{ column: 1, value: "Contractor NPV" }] }],
    },
  ],
};

const lastSuccess: LastSuccessfulCalculation = {
  scope: "state-rent@1.0.0",
  inputKey: "inputs-a",
  inputs: { C5: "Oil" },
  result,
};

test("edited inputs keep the last successful outputs visible and mark them stale", () => {
  const state = selectLiveCalculationState({
    scope: lastSuccess.scope,
    inputKey: "inputs-b",
    enabled: true,
    validationErrors: [],
    snapshot: null,
    lastSuccess,
  });

  assert.equal(state.status, "idle");
  assert.equal(state.result, result);
  assert.equal(state.isStale, true);
});

test("an old failed attempt does not replace the stale state for newer inputs", () => {
  const state = selectLiveCalculationState({
    scope: lastSuccess.scope,
    inputKey: "inputs-b",
    enabled: true,
    validationErrors: [],
    snapshot: {
      inputKey: "inputs-a",
      status: "error",
      error: "The previous request failed.",
    },
    lastSuccess,
  });

  assert.equal(state.status, "idle");
  assert.equal(state.result, result);
  assert.equal(state.isStale, true);
});

test("an active evaluation retains prior outputs while the new input set is pending", () => {
  const state = selectLiveCalculationState({
    scope: lastSuccess.scope,
    inputKey: "inputs-b",
    enabled: true,
    validationErrors: [],
    snapshot: { inputKey: "inputs-b", status: "updating" },
    lastSuccess,
  });

  assert.equal(state.status, "updating");
  assert.equal(state.result, result);
  assert.equal(state.isStale, true);
});

test("invalid edits keep previous outputs visible and surface the current input errors", () => {
  const state = selectLiveCalculationState({
    scope: lastSuccess.scope,
    inputKey: "inputs-invalid",
    enabled: true,
    validationErrors: ["Enter a positive volume."],
    snapshot: null,
    lastSuccess,
  });

  assert.equal(state.status, "invalid");
  assert.deepEqual(state.errors, ["Enter a positive volume."]);
  assert.equal(state.result, result);
  assert.equal(state.isStale, true);
});

test("switching calculator scope clears outputs from the previous version", () => {
  const state = selectLiveCalculationState({
    scope: "state-rent@2.0.0",
    inputKey: "version-2-inputs",
    enabled: true,
    validationErrors: [],
    snapshot: null,
    lastSuccess,
  });

  assert.equal(state.status, "idle");
  assert.equal(state.result, null);
  assert.equal(state.isStale, false);
});

test("a saved output set matching current inputs remains current", () => {
  const state = selectLiveCalculationState({
    scope: lastSuccess.scope,
    inputKey: lastSuccess.inputKey,
    enabled: true,
    validationErrors: [],
    snapshot: { inputKey: lastSuccess.inputKey, status: "success" },
    lastSuccess,
  });

  assert.equal(state.status, "success");
  assert.equal(state.result, result);
  assert.equal(state.isStale, false);
});

test("cancelling a request clears its pending marker if the inputs later return to that key", () => {
  const canceled = clearCanceledCalculationAttempt(
    { inputKey: "inputs-a", status: "updating" },
    "inputs-a",
  );
  const state = selectLiveCalculationState({
    scope: lastSuccess.scope,
    inputKey: "inputs-a",
    enabled: true,
    validationErrors: [],
    snapshot: canceled,
    lastSuccess: null,
  });

  assert.equal(canceled, null);
  assert.equal(state.status, "idle");
});
